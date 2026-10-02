use std::sync::atomic::{AtomicBool, Ordering};

// A system pause must survive a decoder finishing after the WebView sleeps.
static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn request_play() { PAUSED.store(false, Ordering::Release); }
pub fn request_pause() { PAUSED.store(true, Ordering::Release); }
pub fn blocked() -> bool { PAUSED.load(Ordering::Acquire) }

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
}
