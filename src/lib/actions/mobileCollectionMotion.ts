type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
type Options = { key: string | false; from: Rect | null };

/** Move the real cover between its shelf and header; the list paints once. */
export function mobileCollectionMotion(node: HTMLElement, initial: Options) {
  let previous: string | false = false;
  let frame = 0;
  let animations: Animation[] = [];
  function clear() {
    cancelAnimationFrame(frame);
    animations.forEach(animation => animation.cancel());
    animations = [];
  }
  function update(options: Options) {
    if (options.key === previous) return;
    const oldKey = previous;
    previous = options.key;
    clear();
    if (!options.key || node.closest('[data-motion="off"], [data-input="keyboard"], [data-edge-back]') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const detail = options.key === 'likes' || options.key.startsWith('playlist:');
    const key = detail ? options.key : oldKey;
    const cover = detail ? node.querySelector<HTMLElement>('.mobile-playlist-detail-cover') :
      [...node.querySelectorAll<HTMLElement>('[data-collection-cover]')].find(item => item.dataset.collectionCover === key);
    // Capture final geometry after DOM work, while animation clocks are paused.
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!node.isConnected || previous !== options.key) return;
      if (cover && options.from?.width && options.from.height) {
        const to = cover.getBoundingClientRect(), from = options.from;
        const animation = cover.animate([
          { transform: `translate3d(${from.left - to.left}px,${from.top - to.top}px,0) scale(${from.width / to.width},${from.height / to.height})` },
          { transform: 'none' }
        ], { duration: 560, easing: 'cubic-bezier(.22, 1, .36, 1)' });
        cover.style.transformOrigin = 'top left';
        animations.push(animation);
      } else if (cover) {
        animations.push(cover.animate([{ opacity: .4, transform: 'translate3d(0,16px,0) scale(.96)' }, { opacity: 1, transform: 'none' }],
          { duration: 460, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
      }
      const content = detail ? [...node.querySelectorAll<HTMLElement>('.mobile-playlist-detail-head > div, .playlist-sync-control, .mobile-library-heading, .mobile-library-actions, .mobile-track-list, .mobile-empty')] :
        cover && options.from ? [...node.querySelectorAll<HTMLElement>('.mobile-library-page-heading, .mobile-library-collections, .mobile-recent-grid')] : [node];
      for (const [index, part] of content.entries()) {
        const animation = part.animate([{ opacity: 0, transform: 'translate3d(0,12px,0)' }, { opacity: 1, transform: 'none' }],
          { duration: detail ? 420 : 300, delay: detail ? Math.min(index, 2) * 70 + 80 : 0, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'backwards' });
        animations.push(animation);
      }
      node.dispatchEvent(new CustomEvent('lomify:layout-motion', { bubbles: true, detail: { duration: 640 } }));
      for (const animation of animations) animation.pause();
      frame = requestAnimationFrame(() => { frame = 0; animations.forEach(animation => animation.play()); });
    });
  }
  update(initial);
  return { update, destroy: clear };
}
