import { get } from 'svelte/store';
import { mobileBackPreview, mobileCanGoBack } from '$lib/mobileNavigation';

/** One edge gesture for the phone shell and all of its nested history entries. */
export function mobileSwipeBack(stage: HTMLElement, player = false) {
  const content = player ? stage : stage.querySelector<HTMLElement>('.mobile-navigation-surface')!;
  const edge = document.createElement('div');
  edge.className = 'mobile-back-edge';
  edge.setAttribute('aria-hidden', 'true');
  stage.append(edge);
  const release = mobileCanGoBack.subscribe(available => { edge.hidden = !available; });
  let pointer: number | null = null, startX = 0, startY = 0, width = 0, x = 0;
  let lastX = 0, lastTime = 0, velocity = 0, dragging = false, settling = false;
  let preview: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reduced = false;
  function moveContent(next: number) {
    x = next;
    stage.style.setProperty('--mobile-back-x', `${x}px`);
    stage.style.setProperty('--mobile-back-progress', String(x / width));
    content.dispatchEvent(new CustomEvent('lomify:layout-motion', { bubbles: true, detail: { duration: 240 } }));
  }
  function clean() {
    clearTimeout(timer);
    preview?.remove(); preview = undefined;
    delete stage.dataset.edgeBack;
    delete stage.dataset.backReduced;
    stage.style.removeProperty('--mobile-back-x');
    stage.style.removeProperty('--mobile-back-progress');
    dragging = settling = false; pointer = null;
  }
  let touchGesture = false;
  type GestureEvent = Pick<PointerEvent, 'pointerId' | 'isPrimary' | 'button' | 'clientX' | 'clientY' | 'timeStamp' | 'type' | 'preventDefault'>;
  function down(event: GestureEvent) {
    if (event.clientX - stage.getBoundingClientRect().left > 20 || settling || !event.isPrimary || event.button !== 0 || !get(mobileCanGoBack) || content.inert ||
        document.querySelector('dialog[open], [aria-modal="true"]') || !player && history.state?.mobilePlayer) return;
    pointer = event.pointerId; startX = lastX = event.clientX; startY = event.clientY;
    lastTime = event.timeStamp; velocity = 0; width = stage.clientWidth; x = 0;
    reduced = !!stage.closest('[data-motion="off"]') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function move(event: GestureEvent) {
    if (pointer !== event.pointerId || settling) return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { pointer = null; return; }
      if (dx < 8 || dx < Math.abs(dy) * 1.2) return;
      dragging = true;
      if (!touchGesture) stage.setPointerCapture(event.pointerId);
      if (!player) {
        preview = document.createElement('div');
        preview.className = 'mobile-back-preview';
        if (document.body.dataset.iosScroll === 'artist') {
          preview.style.top = `${scrollY}px`;
          preview.style.bottom = 'auto';
          preview.style.height = `${innerHeight}px`;
        }
        preview.inert = true; preview.setAttribute('aria-hidden', 'true');
        const pane = mobileBackPreview();
        if (pane) preview.append(pane);
        stage.prepend(preview);
      }
      stage.dataset.edgeBack = 'dragging';
      stage.dataset.backReduced = String(reduced);
    }
    event.preventDefault();
    velocity = (event.clientX - lastX) / Math.max(1, event.timeStamp - lastTime);
    lastX = event.clientX; lastTime = event.timeStamp;
    moveContent(Math.max(0, Math.min(width, dx)));
  }
  function finish(event: GestureEvent) {
    if (pointer !== event.pointerId || settling) return;
    if (!touchGesture && stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!dragging) { clean(); return; }
    const commit = event.type !== 'pointercancel' && (x >= width * .33 || x >= 48 && velocity > .5 && event.timeStamp - lastTime < 100);
    settling = true; stage.dataset.edgeBack = 'settling';
    moveContent(commit ? width : 0);
    timer = setTimeout(() => {
      if (commit) history.back(); else clean();
    }, reduced ? 0 : 220);
  }
  const onPop = () => { if (dragging) requestAnimationFrame(() => requestAnimationFrame(clean)); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragging) clean(); };
  const onVisibility = () => { if (document.hidden) clean(); };
  const pointerDown = (event: PointerEvent) => { if (event.pointerType !== 'touch') { touchGesture = false; down(event); } };
  const pointerMove = (event: PointerEvent) => { if (!touchGesture) move(event); };
  const pointerFinish = (event: PointerEvent) => { if (!touchGesture) finish(event); };
  function touchEvent(event: TouchEvent, touch: Touch): GestureEvent {
    return { pointerId: touch.identifier, isPrimary: true, button: 0, clientX: touch.clientX, clientY: touch.clientY,
      timeStamp: event.timeStamp, type: event.type === 'touchcancel' ? 'pointercancel' : event.type,
      preventDefault: () => event.preventDefault() };
  }
  const touchDown = (event: TouchEvent) => {
    if (event.touches.length !== 1) { clean(); return; }
    touchGesture = true; down(touchEvent(event, event.touches[0]));
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) { clean(); return; }
    const touch = [...event.changedTouches].find(item => item.identifier === pointer);
    if (touch) move(touchEvent(event, touch));
  };
  const touchFinish = (event: TouchEvent) => {
    const touch = [...event.changedTouches].find(item => item.identifier === pointer);
    if (touch) finish(touchEvent(event, touch));
  };
  stage.addEventListener('pointerdown', pointerDown);
  stage.addEventListener('pointermove', pointerMove);
  stage.addEventListener('pointerup', pointerFinish);
  stage.addEventListener('pointercancel', pointerFinish);
  stage.addEventListener('touchstart', touchDown, { passive: true });
  stage.addEventListener('touchmove', touchMove, { passive: false });
  stage.addEventListener('touchend', touchFinish);
  stage.addEventListener('touchcancel', touchFinish);
  window.addEventListener('lomify:mobile-navigation', clean);
  window.addEventListener('popstate', onPop);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  return { destroy() { clean(); release(); edge.remove(); window.removeEventListener('lomify:mobile-navigation', clean);
    stage.removeEventListener('pointerdown', pointerDown); stage.removeEventListener('pointermove', pointerMove); stage.removeEventListener('pointerup', pointerFinish); stage.removeEventListener('pointercancel', pointerFinish);
    stage.removeEventListener('touchstart', touchDown); stage.removeEventListener('touchmove', touchMove); stage.removeEventListener('touchend', touchFinish); stage.removeEventListener('touchcancel', touchFinish); window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility); } };
}
