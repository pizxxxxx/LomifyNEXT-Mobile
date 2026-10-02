use std::sync::atomic::{AtomicBool, Ordering};

/// System pause survives decoding and reconnecting; only an explicit play can
/// clear a disconnected route. This state never depends on WebView delivery.
pub struct PlaybackGate {
    paused: AtomicBool,
    disconnected: AtomicBool,
}
impl PlaybackGate {
    pub const fn new() -> Self {
        Self { paused: AtomicBool::new(false), disconnected: AtomicBool::new(false) }
    }
    pub fn pause(&self, disconnected: bool) {
        if disconnected { self.disconnected.store(true, Ordering::Release); }
        self.paused.store(true, Ordering::Release);
    }
    pub fn play(&self) {
        self.disconnected.store(false, Ordering::Release);
        self.paused.store(false, Ordering::Release);
    }
    pub fn blocked(&self) -> bool { self.paused.load(Ordering::Acquire) }
    pub fn can_resume_interruption(&self) -> bool { !self.disconnected.load(Ordering::Acquire) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    #[test]
    fn disconnect_during_decode_cannot_restart_on_the_speaker() {
        let gate = Arc::new(PlaybackGate::new());
        let decoding = Arc::new(Barrier::new(2));
        let decoded = Arc::new(Barrier::new(2));
        let worker_gate = gate.clone();
        let begin = decoding.clone();
        let finish = decoded.clone();
        let task = std::thread::spawn(move || { begin.wait(); finish.wait(); !worker_gate.blocked() });
        decoding.wait();
        gate.pause(true);
        // The later interruption-end recommendation must not clear unplugging.
        gate.pause(false);
        assert!(!gate.can_resume_interruption());
        decoded.wait();
        assert!(!task.join().unwrap());
        gate.play();
        assert!(!gate.blocked());
        assert!(gate.can_resume_interruption());
    }
    #[test]
    fn ordinary_interruption_can_resume_but_pause_is_preserved_until_then() {
        let gate = PlaybackGate::new();
        gate.pause(false);
        assert!(gate.blocked());
        assert!(gate.can_resume_interruption());
        gate.play();
        assert!(!gate.blocked());
    }
}
