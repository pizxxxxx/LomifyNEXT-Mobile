import { isIOS } from '$lib/mobile';

/** Direct manipulation of the player's header; the lyric scroller keeps its gestures. */
export function mobileSwipeDismiss(node: HTMLElement, dismiss: () => void) {
  if (!isIOS) return {};
  let pointer: number | null = null;
  let startX = 0, startY = 0, lastTime = 0, velocity = 0, distance = 0;
  let dragging = false, suppressClick = false;
  let touchGesture = false;
  type GestureEvent = Pick<PointerEvent, 'pointerId' | 'isPrimary' | 'button' | 'target' | 'clientX' | 'clientY' | 'timeStamp' | 'type' | 'preventDefault'>;
  let samples: { y: number; time: number }[] = [];
  function sample(y: number, time: number) {
    samples.push({ y, time });
    // Average a short window instead of letting one noisy pointer event set inertia.
    while (samples.length > 2 && samples[1].time <= time - 80) samples.shift();
    const first = samples[0];
    velocity = time > first.time ? (y - first.y) / (time - first.time) : 0;
    lastTime = time;
  }
  const down = (event: GestureEvent) => {
    if (pointer !== null || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const target = event.target as Element;
    if (!target.closest('.mobile-now-header, .mobile-now-artwork, .mobile-now-track-heading')) return;
    const control = target.closest('button, a, input, textarea');
    if (control && !control.classList.contains('mobile-now-dismiss') && !control.classList.contains('mobile-now-artwork')) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastTime = event.timeStamp;
    velocity = distance = 0;
    samples = [{ y: startY, time: lastTime }];
    delete node.dataset.swipeReleased;
    node.style.removeProperty('--mobile-player-dismiss-velocity');
  };
  const move = (event: GestureEvent) => {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pointer = null; return; }
      if (dy < 8 || dy < Math.abs(dx) * 1.25) return;
      dragging = suppressClick = true;
      node.dataset.swipeDragging = 'true';
      if (!touchGesture) node.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    sample(event.clientY, event.timeStamp);
    distance = Math.max(0, dy);
    node.style.setProperty('--mobile-player-dismiss-y', `${distance}px`);
  };
  const end = (event: GestureEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (!dragging) return;
    const released = event.type === 'pointerup' || event.type === 'touchend';
    // Include the release position, but a held finger no longer counts as a flick.
    if (event.timeStamp - lastTime >= 80) velocity = 0;
    else sample(event.clientY, event.timeStamp);
    if (released) {
      distance = Math.max(0, event.clientY - startY);
      node.style.setProperty('--mobile-player-dismiss-y', `${distance}px`);
    }
    dragging = false;
    delete node.dataset.swipeDragging;
    if (!touchGesture && node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    const flick = velocity > .55 && distance > 28;
    if (released && (distance > Math.min(140, node.clientHeight * .16) || flick)) {
      node.dataset.swipeReleased = 'true';
      node.style.setProperty('--mobile-player-dismiss-velocity', String(Math.max(0, velocity)));
      // Keep the drag offset fixed. The Svelte outro owns the entire remaining
      // movement, so a CSS translate transition cannot race it to the bottom.
      dismiss();
    } else node.style.setProperty('--mobile-player-dismiss-y', '0px');
  };
  // iOS implicitly captures a touch on the handle. Transferring that capture to
  // the panel emits a bubbling lostpointercapture from the handle, not a cancel.
  // Track the finger with Touch Events instead, as the edge-back gesture does.
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && pointer === null) { touchGesture = false; down(event); }
  };
  const pointerMove = (event: PointerEvent) => { if (!touchGesture && event.pointerType !== 'touch') move(event); };
  const pointerEnd = (event: PointerEvent) => { if (!touchGesture && event.pointerType !== 'touch') end(event); };
  const lostCapture = (event: PointerEvent) => { if (event.target === node) pointerEnd(event); };
  function touchEvent(event: TouchEvent, touch: Touch): GestureEvent {
    return { pointerId: touch.identifier, isPrimary: true, button: 0, target: event.target,
      clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp,
      type: event.type, preventDefault: () => event.preventDefault() };
  }
  const cancelTouch = (event: TouchEvent) => {
    if (pointer === null || !touchGesture) return;
    end({ pointerId: pointer, isPrimary: true, button: 0, target: event.target,
      clientX: startX, clientY: startY + distance, timeStamp: event.timeStamp,
      type: 'touchcancel', preventDefault: () => event.preventDefault() });
  };
  const touchDown = (event: TouchEvent) => {
    if (event.touches.length !== 1) { cancelTouch(event); return; }
    if (pointer !== null) return;
    touchGesture = true;
    down(touchEvent(event, event.touches[0]));
  };
  const touchMove = (event: TouchEvent) => {
    if (!touchGesture) return;
    if (event.touches.length !== 1) { cancelTouch(event); return; }
    const touch = [...event.changedTouches].find(item => item.identifier === pointer);
    if (touch) move(touchEvent(event, touch));
  };
  const touchEnd = (event: TouchEvent) => {
    if (!touchGesture) return;
    const touch = [...event.changedTouches].find(item => item.identifier === pointer);
    if (touch) end(touchEvent(event, touch));
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  node.addEventListener('pointerdown', pointerDown);
  node.addEventListener('pointermove', pointerMove);
  node.addEventListener('pointerup', pointerEnd);
  node.addEventListener('pointercancel', pointerEnd);
  node.addEventListener('lostpointercapture', lostCapture);
  node.addEventListener('touchstart', touchDown, { passive: true });
  node.addEventListener('touchmove', touchMove, { passive: false });
  node.addEventListener('touchend', touchEnd);
  node.addEventListener('touchcancel', touchEnd);
  node.addEventListener('click', click, true);
  return { destroy() {
    node.removeEventListener('pointerdown', pointerDown);
    node.removeEventListener('pointermove', pointerMove);
    node.removeEventListener('pointerup', pointerEnd);
    node.removeEventListener('pointercancel', pointerEnd);
    node.removeEventListener('lostpointercapture', lostCapture);
    node.removeEventListener('touchstart', touchDown);
    node.removeEventListener('touchmove', touchMove);
    node.removeEventListener('touchend', touchEnd);
    node.removeEventListener('touchcancel', touchEnd);
    node.removeEventListener('click', click, true);
  } };
}
