import { isTauri } from '@tauri-apps/api/core';
import { isIOS } from '$lib/mobile';

/** Let UIKit scroll the artist's web content and glass controls together. */
export function iosArtistScroll(node: HTMLElement) {
  if (!isIOS || !isTauri()) return {};
  const previous = document.body.dataset.iosScroll;
  document.body.dataset.iosScroll = 'artist';
  window.scrollTo(0, 0);
  node.dispatchEvent(new CustomEvent('lomify:layout-motion', { bubbles: true, detail: { duration: 0 } }));
  return { destroy() {
    if (previous === undefined) delete document.body.dataset.iosScroll;
    else document.body.dataset.iosScroll = previous;
    window.scrollTo(0, 0);
  } };
}
