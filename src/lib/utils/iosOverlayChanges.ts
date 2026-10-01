const overlays = 'dialog, [aria-modal], .mobile-player.expanded';

function containsOverlay(node: Node): boolean {
  return node instanceof Element && (node.matches(overlays) || !!node.querySelector(overlays));
}

/** Virtual track rows and animated SVGs do not change native overlay visibility. */
export function hasIOSOverlayChange(records: MutationRecord[]): boolean {
  return records.some(record => {
    if (record.type === 'childList') {
      return [...record.addedNodes, ...record.removedNodes].some(containsOverlay);
    }
    const target = record.target;
    return target instanceof Element &&
      (target.matches('dialog, [aria-modal], .mobile-player') ||
        ['class', 'inert', 'hidden', 'open', 'aria-modal'].includes(record.attributeName || '') && containsOverlay(target));
  });
}
