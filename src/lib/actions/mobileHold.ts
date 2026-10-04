import { mobileHaptic } from '$lib/mobileHaptics';
import { isMobile } from '$lib/mobile';

export function mobileHold(node: HTMLElement, options: { onHold: () => void }) {
  if (!isMobile) return { update() {}, destroy() {} };
  let activePointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heldReset: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let current = options;
  const cancel = () => { clearTimeout(timer); timer = undefined; activePointer = null; };
  const release = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    cancel();
    // Opening a modal can take pointerup away from the original button. Keep the
    // release click suppressed briefly, but never swallow a later real tap.
    if (held) {
      clearTimeout(heldReset);
      heldReset = setTimeout(() => { held = false; }, 350);
    }
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const control = (event.target as Element).closest('button, a, input, textarea');
    if (control && control !== node) return;
    if ((event.target as Element).closest('.selectable')) return;
    if (activePointer !== null) { cancel(); return; }
    clearTimeout(heldReset);
    activePointer = event.pointerId;
    startX = event.clientX; startY = event.clientY;
    held = false;
    timer = setTimeout(() => {
      if (activePointer !== event.pointerId) return;
      held = true;
      mobileHaptic('light');
      current.onHold();
    }, 460);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === activePointer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  };
  const click = (event: MouseEvent) => {
    if (!held) return;
    event.preventDefault(); event.stopImmediatePropagation();
    held = false;
  };
  const context = (event: Event) => event.preventDefault();
  const newGesture = () => { if (activePointer === null) held = false; };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointerdown', newGesture, true);
  window.addEventListener('pointercancel', release, true);
  // The release may target a newly opened dialog outside this node. Capture it
  // at the window before its Like/Download/Queue button receives the click.
  window.addEventListener('click', click, true);
  node.addEventListener('contextmenu', context);
  return {
    update(value: typeof options) { current = value; },
    destroy() {
      cancel();
      clearTimeout(heldReset);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointerdown', newGesture, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', context);
    }
  };
}
