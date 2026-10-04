import { invoke, isTauri } from '@tauri-apps/api/core';
import { isMobile } from './mobile';

let lastFeedback = -Infinity;
export function mobileHaptic(kind: 'selection' | 'light' = 'selection'): void {
  if (!isMobile || !isTauri()) return;
  const now = performance.now();
  if (now - lastFeedback < 60) return;
  lastFeedback = now;
  void invoke('mobile_haptic', { kind }).catch(() => { /* Unsupported hardware is silent. */ });
}

/** Feedback for deliberate taps, never scroll frames, loading or auto playback. */
export function mobileHaptics(node: HTMLElement) {
  const click = (event: MouseEvent) => {
    const button = (event.target as Element)?.closest<HTMLButtonElement>('button');
    if (!button || button.disabled || button.dataset.iosGlassReady === 'true') return;
    if (button.matches('[data-haptic]') || button.closest('.mobile-nav, .mobile-player, .mobile-track-dialog, .mobile-update-notice') ||
      button.matches('.mobile-album-play, .mobile-wave-start, .mobile-wave-shortcut, .mobile-track-play, .mobile-favorites')) {
      mobileHaptic(button.dataset.haptic === 'light' ? 'light' : 'selection');
    }
  };
  node.addEventListener('click', click);
  return { destroy() { node.removeEventListener('click', click); } };
}
