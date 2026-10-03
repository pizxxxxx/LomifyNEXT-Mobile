use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// System pause survives decoding and reconnecting; only an explicit play can
/// clear a disconnected route. This state never depends on WebView delivery.
pub struct PlaybackGate {
    paused: AtomicBool,
    disconnected: AtomicBool,
    interrupted: Mutex<Option<bool>>,
}
impl PlaybackGate {
    pub const fn new() -> Self {
        Self { paused: AtomicBool::new(false), disconnected: AtomicBool::new(false), interrupted: Mutex::new(None) }
    }
    pub fn pause(&self, disconnected: bool) {
        let mut interrupted = self.interrupted.lock().unwrap();
        *interrupted = None;
        if disconnected { self.disconnected.store(true, Ordering::Release); }
        self.paused.store(true, Ordering::Release);
    }
    pub fn play(&self) {
        let mut interrupted = self.interrupted.lock().unwrap();
        *interrupted = None;
        self.disconnected.store(false, Ordering::Release);
        self.paused.store(false, Ordering::Release);
    }
    pub fn blocked(&self) -> bool { self.paused.load(Ordering::Acquire) }
    pub fn can_resume_interruption(&self) -> bool { !self.disconnected.load(Ordering::Acquire) }
    pub fn begin_interruption(&self, was_playing: bool) {
        let mut interrupted = self.interrupted.lock().unwrap();
        if interrupted.is_none() {
            *interrupted = Some(was_playing && !self.blocked() && self.can_resume_interruption());
        }
        self.paused.store(true, Ordering::Release);
    }
    pub fn finish_interruption(&self, should_resume: bool) -> bool {
        let mut interrupted = self.interrupted.lock().unwrap();
        if interrupted.take() != Some(true) || !should_resume || !self.can_resume_interruption() {
            return false;
        }
        self.paused.store(false, Ordering::Release);
        true
    }
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
    #[test]
    fn interruption_captures_intent_before_pause_and_resumes_only_once() {
        let gate = PlaybackGate::new();
        gate.begin_interruption(true);
        gate.begin_interruption(false);
        assert!(gate.blocked());
        assert!(gate.finish_interruption(true));
        assert!(!gate.blocked());
        assert!(!gate.finish_interruption(true));
    }
    #[test]
    fn manual_pause_and_route_disconnect_cancel_interruption_resume() {
        for disconnected in [false, true] {
            let gate = PlaybackGate::new();
            gate.begin_interruption(true);
            gate.pause(disconnected);
            assert!(!gate.finish_interruption(true));
            assert!(gate.blocked());
        }
    }
    #[test]
    fn paused_before_call_or_system_denial_does_not_resume() {
        for (was_playing, should_resume) in [(false, true), (true, false)] {
            let gate = PlaybackGate::new();
            gate.begin_interruption(was_playing);
            assert!(!gate.finish_interruption(should_resume));
            assert!(gate.blocked());
        }
    }
}
