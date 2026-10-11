import { cubicOut } from 'svelte/easing';

/** One compositor animation continues the sheet from its released position. */
export function createMobilePlayerTransition(node: HTMLElement, direction: 'in' | 'out', reduced: boolean) {
  const offset = Number.parseFloat(node.style.getPropertyValue('--mobile-player-dismiss-y')) || 0;
  const distance = Math.max(0, node.clientHeight - offset);
  const released = direction === 'out' && node.dataset.swipeReleased === 'true';
  const velocity = Math.max(0, Number.parseFloat(node.style.getPropertyValue('--mobile-player-dismiss-velocity')) || 0);
  const duration = reduced || distance === 0 ? 0 : released ? Math.max(280, Math.min(500, distance / Math.max(1.4, velocity))) : 480;
  // Cubic Hermite: match the finger's release speed, then reach the bottom with
  // zero speed. A bounded slope keeps the path monotonic even on a strong flick.
  const slope = distance > 0 ? Math.min(3, velocity * duration / distance) : 0;
  const easing = released
    ? (t: number) => ((slope - 2) * t + 3 - 2 * slope) * t * t + slope * t
    : cubicOut;
  node.dispatchEvent(new CustomEvent('lomify:layout-motion', { bubbles: true, detail: { duration: duration ? duration + 20 : 0 } }));
  return { duration, easing, css: (t: number) => `transform:translate3d(0,${(1 - t) * distance}px,0)` };
}
