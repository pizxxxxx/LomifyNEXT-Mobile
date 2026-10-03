type Options = { active: boolean; ready: boolean; direction: number; enabled: boolean };

/** Retain scroll/search state; move only two composited panes during navigation. */
export function mobilePageMotion(node: HTMLElement, initial: Options) {
  let state = initial;
  let animation: Animation | null = null;
  let frame = 0;
  let generation = 0;
  node.hidden = !initial.active;
  node.inert = !initial.active || !initial.ready;
  if (initial.active && !initial.ready) node.style.opacity = '0';

  function update(next: Options) {
    const previous = state;
    state = next;
    if (next.active === previous.active && next.ready === previous.ready) return;
    const run = ++generation;
    const interrupted = animation?.playState === 'running' ? getComputedStyle(node) : null;
    const from = interrupted ? { opacity: interrupted.opacity, transform: interrupted.transform } : null;
    cancelAnimationFrame(frame);
    animation?.cancel(); animation = null;
    node.inert = !next.active || !next.ready;
    if (!next.active && node.hidden) return;
    node.hidden = false;
    if (next.active && !next.ready) { node.style.opacity = '0'; return; }
    const reduced = !next.enabled || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gesture = !!node.closest('[data-edge-back]');
    const finish = () => {
      if (run !== generation) return;
      node.hidden = !state.active;
      node.style.opacity = ''; node.style.willChange = '';
      delete node.dataset.pageMoving;
      animation?.cancel(); animation = null;
    };
    if (reduced || gesture) { finish(); return; }
    const direction = Math.sign(next.direction) || 1;
    const distance = Math.min(node.clientWidth * .22, 100);
    node.style.willChange = 'transform, opacity';
    node.dataset.pageMoving = next.active ? 'in' : 'out';
    node.style.opacity = '';
    const duration = next.active ? 420 : 320;
    animation = node.animate([
      from ?? { opacity: next.active ? 0 : 1, transform: next.active ? `translate3d(${direction * distance}px,0,0)` : 'none' },
      { opacity: next.active ? 1 : 0, transform: next.active ? 'none' : `translate3d(${-direction * distance}px,0,0)` }
    ], { duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    animation.pause();
    animation.onfinish = finish;
    // Mount/layout and first paint finish before the motion clock starts.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (run !== generation) return;
        node.dispatchEvent(new CustomEvent('lomify:layout-motion', { bubbles: true, detail: { duration } }));
        animation?.play();
      });
    });
  }
  return { update, destroy() { ++generation; cancelAnimationFrame(frame); animation?.cancel(); } };
}
