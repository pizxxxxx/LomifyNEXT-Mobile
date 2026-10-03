use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

// A system pause must survive a decoder finishing after the WebView sleeps.
pub struct PlaybackGate {
    paused: AtomicBool,
    interrupted: Mutex<Option<bool>>,
}
impl PlaybackGate {
    pub const fn new() -> Self {
        Self { paused: AtomicBool::new(false), interrupted: Mutex::new(None) }
    }
    pub fn play(&self) {
        let mut interrupted = self.interrupted.lock().unwrap();
        *interrupted = None;
        self.paused.store(false, Ordering::Release);
    }
    pub fn pause(&self) {
        let mut interrupted = self.interrupted.lock().unwrap();
        *interrupted = None;
        self.paused.store(true, Ordering::Release);
    }
    pub fn begin_interruption(&self, was_playing: bool) {
        let mut interrupted = self.interrupted.lock().unwrap();
        if interrupted.is_none() { *interrupted = Some(was_playing && !self.blocked()); }
        self.paused.store(true, Ordering::Release);
    }
    pub fn finish_interruption(&self) -> bool {
        let mut interrupted = self.interrupted.lock().unwrap();
        if interrupted.take() != Some(true) { return false; }
        self.paused.store(false, Ordering::Release);
        true
    }
    pub fn blocked(&self) -> bool { self.paused.load(Ordering::Acquire) }
}
static GATE: PlaybackGate = PlaybackGate::new();

pub fn request_play() { GATE.play(); }
pub fn request_pause() { GATE.pause(); }
pub fn blocked() -> bool { GATE.blocked() }
pub fn begin_interruption(was_playing: bool) { GATE.begin_interruption(was_playing); }
pub fn finish_interruption() -> bool { GATE.finish_interruption() }

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn system_pause_during_decode_survives_until_explicit_play() {
        request_play();
        let decoding = Arc::new(Barrier::new(2));
        let finish = Arc::new(Barrier::new(2));
        let begin = decoding.clone();
        let done = finish.clone();
        let task = std::thread::spawn(move || { begin.wait(); done.wait(); blocked() });
        decoding.wait();
        request_pause();
        finish.wait();
        assert!(task.join().unwrap());
        request_play();
        assert!(!blocked());
    }
    #[test]
    fn repeated_transient_losses_resume_once_after_gain() {
        let gate = PlaybackGate::new();
        gate.begin_interruption(true);
        gate.begin_interruption(false);
        assert!(gate.blocked());
        assert!(gate.finish_interruption());
        assert!(!gate.blocked());
        assert!(!gate.finish_interruption());
    }
    #[test]
    fn manual_pause_or_unplug_during_call_cancels_resume() {
        let gate = PlaybackGate::new();
        gate.begin_interruption(true);
        gate.pause();
        assert!(!gate.finish_interruption());
        assert!(gate.blocked());
    }
    #[test]
    fn paused_before_call_is_not_resumed() {
        let gate = PlaybackGate::new();
        gate.pause();
        gate.begin_interruption(true);
        assert!(!gate.finish_interruption());
        assert!(gate.blocked());
    }
}
