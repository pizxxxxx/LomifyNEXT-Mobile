import { writable } from 'svelte/store';

export const mobileCanGoBack = writable(false);
type Snapshot = { content: HTMLElement; offsets: [number, number][] };
const snapshots = new Map<number, Snapshot>();
let root: HTMLElement | undefined;
let position = 0;

function capture() {
  const pane = root?.querySelector<HTMLElement>('.mobile-content > .mobile-pane:not([hidden]):not([inert])');
  if (!pane) return;
  const surface = root?.querySelector<HTMLElement>('.mobile-navigation-surface');
  if (!surface) return;
  const content = surface.cloneNode(false) as HTMLElement;
  content.style.height = `${innerHeight}px`;
  content.style.minHeight = '0';
  const header = surface.querySelector('.mobile-header');
  if (header) content.append(header.cloneNode(true));
  const main = pane.parentElement!.cloneNode(false) as HTMLElement;
  main.style.flex = '1';
  main.style.overflow = 'hidden';
  main.removeAttribute('inert');
  const copiedPane = pane.cloneNode(true) as HTMLElement;
  copiedPane.style.height = '100%';
  copiedPane.style.overflowY = 'auto';
  main.append(copiedPane);
  content.append(main);
  const originals = [pane, ...pane.querySelectorAll<HTMLElement>('*')];
  const copies = [copiedPane, ...copiedPane.querySelectorAll<HTMLElement>('*')];
  const offsets = originals.map(node => [node.scrollLeft, node.scrollTop] as [number, number]);
  if (document.body.dataset.iosScroll === 'artist') offsets[0] = [0, scrollY];
  copies.forEach(node => {
    node.removeAttribute('id');
    node.removeAttribute('data-ios-glass-ready');
    if (node instanceof HTMLMediaElement) { node.removeAttribute('autoplay'); node.removeAttribute('src'); }
  });
  content.inert = true;
  content.setAttribute('aria-hidden', 'true');
  snapshots.set(position, { content, offsets });
  // DOM previews are bounded and never persisted to storage.
  while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
}

export function initializeMobileNavigation(node: HTMLElement, initialView = 'home') {
  root = node;
  position = 0;
  snapshots.clear();
  history.replaceState({ mobileView: initialView, mobilePosition: 0 }, '');
  mobileCanGoBack.set(false);
  const onPop = (event: PopStateEvent) => {
    capture();
    position = event.state?.mobilePosition ?? 0;
    mobileCanGoBack.set(position > 0);
  };
  window.addEventListener('popstate', onPop);
  return () => { window.removeEventListener('popstate', onPop); root = undefined; snapshots.clear(); mobileCanGoBack.set(false); };
}

export function pushMobileHistory(state: Record<string, unknown>) {
  window.dispatchEvent(new Event('lomify:mobile-navigation'));
  capture();
  for (const key of snapshots.keys()) if (key > position) snapshots.delete(key);
  history.pushState({ ...state, mobilePosition: ++position }, '');
  mobileCanGoBack.set(position > 0);
}

export function mobileBackPreview(): HTMLElement | null {
  const snapshot = snapshots.get(position - 1);
  if (!snapshot) return null;
  const copy = snapshot.content.cloneNode(true) as HTMLElement;
  // Scroll positions only take effect after the preview joins the document.
  requestAnimationFrame(() => {
    const pane = copy.querySelector<HTMLElement>('.mobile-pane')!;
    [pane, ...pane.querySelectorAll<HTMLElement>('*')].forEach((node, index) => {
      const offset = snapshot.offsets[index];
      if (offset) { node.scrollLeft = offset[0]; node.scrollTop = offset[1]; }
    });
  });
  return copy;
}
