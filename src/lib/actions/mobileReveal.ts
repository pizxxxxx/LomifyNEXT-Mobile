// Retained tabs animate without remounting their search/filter/scroll state.
export function mobileReveal(node: HTMLElement, active: boolean | string) {
  let animation: Animation | undefined;
  let previous: boolean | string = false;
  function update(visible: boolean | string) {
    if (visible === previous) return;
    previous = visible;
    const interrupted = animation?.playState === 'running' ? getComputedStyle(node) : null;
    const from = interrupted ? { opacity: interrupted.opacity, transform: interrupted.transform } : null;
    animation?.cancel();
    animation = undefined;
    if (!visible || node.closest('[data-motion="off"], [data-input="keyboard"]')) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    animation = node.animate(
      reduced ? [{ opacity: from?.opacity ?? .8 }, { opacity: 1 }] :
        [from ?? { opacity: .75, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: reduced ? 120 : 200, easing: getComputedStyle(node).getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23, 1, 0.32, 1)' }
    );
  }
  update(active);
  return { update, destroy: () => animation?.cancel() };
}
