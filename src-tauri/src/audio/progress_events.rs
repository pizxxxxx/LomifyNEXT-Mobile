/// Keep mobile progress live while playing, but let a paused WebView stay idle.
/// A seek, resume or newly loaded track still gets its first progress event.
#[derive(Default)]
pub(super) struct MobileProgressEvents {
    last: Option<(f64, bool)>,
}

impl MobileProgressEvents {
    pub(super) fn reset(&mut self) {
        self.last = None;
    }

    pub(super) fn should_emit(&mut self, position: f64, playing: bool) -> bool {
        let changed = self.last.is_none_or(|(old_position, old_playing)| {
            old_playing != playing || (old_position - position).abs() >= 0.001
        });
        if playing || changed {
            self.last = Some((position, playing));
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::MobileProgressEvents;

    #[test]
    fn pause_is_quiet_but_seeking_and_resuming_remain_live() {
        let mut events = MobileProgressEvents::default();
        assert!(events.should_emit(0.0, false));
        for _ in 0..600 {
            assert!(!events.should_emit(0.0, false));
        }
        assert!(events.should_emit(30.0, false));
        assert!(!events.should_emit(30.0, false));
        assert!(events.should_emit(30.0, true));
        assert!(events.should_emit(30.0, true));
        assert!(events.should_emit(30.1, true));
        assert!(events.should_emit(30.1, false));
        assert!(!events.should_emit(30.1, false));
        events.reset();
        assert!(events.should_emit(30.1, false));
    }
}
