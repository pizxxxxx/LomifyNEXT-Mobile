// Retained tabs animate without remounting their search/filter/scroll state.
export function mobileReveal(node: HTMLElement, active: boolean) {
  let animation: Animation | undefined;
  let previous = false;
  function update(visible: boolean) {
    if (visible === previous) return;
    previous = visible;
    animation?.cancel();
    if (!visible || node.closest('[data-motion="off"]')) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    animation = node.animate(
      reduced ? [{ opacity: .7 }, { opacity: 1 }] :
        [{ opacity: .7, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 160, easing: getComputedStyle(node).getPropertyValue('--ease-out').trim() }
    );
  }
  update(active);
  return { update, destroy: () => animation?.cancel() };
}
