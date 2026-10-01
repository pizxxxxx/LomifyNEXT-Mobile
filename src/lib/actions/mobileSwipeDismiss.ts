import { isIOS } from '$lib/mobile';

/** Direct manipulation of the player's header; the lyric scroller keeps its gestures. */
export function mobileSwipeDismiss(node: HTMLElement, dismiss: () => void) {
  if (!isIOS) return {};
  let pointer: number | null = null;
  let startX = 0, startY = 0, lastY = 0, lastTime = 0, velocity = 0, distance = 0;
  let dragging = false, suppressClick = false;
  const down = (event: PointerEvent) => {
    suppressClick = false;
    if (pointer !== null || !event.isPrimary || event.button !== 0) return;
    const target = event.target as Element;
    if (!target.closest('.mobile-now-header, .mobile-now-artwork, .mobile-now-track-heading')) return;
    const control = target.closest('button, a, input, textarea');
    if (control && !control.classList.contains('mobile-now-dismiss') && !control.classList.contains('mobile-now-artwork')) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = distance = 0;
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pointer = null; return; }
      if (dy < 8 || dy < Math.abs(dx) * 1.25) return;
      dragging = suppressClick = true;
      node.dataset.swipeDragging = 'true';
      node.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const elapsed = event.timeStamp - lastTime;
    if (elapsed > 0) velocity = (event.clientY - lastY) / elapsed;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    distance = Math.max(0, dy);
    node.style.setProperty('--mobile-player-dismiss-y', `${distance}px`);
  };
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (!dragging) return;
    dragging = false;
    delete node.dataset.swipeDragging;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    const flick = event.timeStamp - lastTime < 120 && velocity > .55 && distance > 28;
    if (event.type !== 'pointercancel' && (distance > Math.min(140, node.clientHeight * .16) || flick)) {
      node.style.setProperty('--mobile-player-dismiss-y', `${node.clientHeight}px`);
      dismiss();
    } else node.style.setProperty('--mobile-player-dismiss-y', '0px');
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('click', click, true);
  return { destroy() {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
    node.removeEventListener('click', click, true);
  } };
}
