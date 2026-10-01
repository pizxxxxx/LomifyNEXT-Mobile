import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isIOS } from '$lib/mobile';
import { hasIOSOverlayChange } from '$lib/utils/iosOverlayChanges';

type Options = { symbol: string; prominent?: boolean; selected?: boolean; iconSize?: number; style?: 'glass' | 'plain' };
type Record = { node: HTMLButtonElement; options: Options; originalHidden: string | null };
const controls = new Map<string, Record>();
let sequence = 0, frame = 0, motionUntil = 0;
let lastPayload = '', sending = false;
let observer: MutationObserver | undefined, resizeObserver: ResizeObserver | undefined;
let releaseEvents = () => {};
let generation = 0;
let accent: number[] | undefined;
let tintContext: CanvasRenderingContext2D | null | undefined;
let bridgeReady = false;
type WebKitBridge = { webkit?: { messageHandlers?: { lomifyControls?: { postMessage(payload: unknown): void } } } };
function directBridge() { return bridgeReady ? (window as typeof window & WebKitBridge).webkit?.messageHandlers?.lomifyControls : undefined; }

function schedule() { if (!frame) frame = requestAnimationFrame(flush); }
function affectsControls(target: EventTarget | null) {
  return target instanceof Element && [...controls.values()].some(record => target.contains(record.node));
}
function trackMotion(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !affectsControls(event.type.startsWith('pointer') ? target.closest('.ios-swipe-player') : target)) return;
  motionUntil = performance.now() + (event instanceof CustomEvent ? event.detail?.duration ?? 280 : 280);
  schedule();
}
function onScroll(event: Event) {
  // Artist controls are children of the same native scroll view. UIKit moves
  // them without JS layout reads or geometry messages during root scrolling.
  if (document.body.dataset.iosScroll === 'artist' && (event.target === document || event.target === window)) return;
  if (affectsControls(event.target)) schedule();
}
function onMotionEnd(event: Event) {
  if (!affectsControls(event.target)) return;
  if (event.target === document.body) accent = undefined;
  schedule();
}
function onVisibility() {
  motionUntil = 0;
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
  else schedule();
}
function markReady(record: Record, ready: boolean) {
  const node = record.node;
  if (node.hasAttribute('data-ios-glass-ready') === ready) return;
  if (ready) { node.dataset.iosGlassReady = 'true'; node.setAttribute('aria-hidden', 'true'); }
  else {
    delete node.dataset.iosGlassReady;
    if (record.originalHidden === null) node.removeAttribute('aria-hidden');
    else node.setAttribute('aria-hidden', record.originalHidden);
  }
}
function tint(): number[] {
  if (accent) return accent;
  if (tintContext === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    tintContext = canvas.getContext('2d', { willReadFrequently: true });
  }
  const context = tintContext;
  if (!context) return [1, .533, .302];
  context.fillStyle = '#ff884d';
  context.fillStyle = getComputedStyle(document.body).getPropertyValue('--mobile-accent');
  context.fillRect(0, 0, 1, 1);
  accent = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255);
  return accent;
}
function flush() {
  frame = 0;
  if (document.hidden && controls.size) return;
  const modal = document.querySelector('dialog[open]') || [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(node => node.getClientRects().length);
  const accent = tint();
  const rootMode = document.body.dataset.iosScroll === 'artist';
  const scrollEnabled = !modal && !document.querySelector('.mobile-player.expanded:not([inert])');
  const clips = new Map<HTMLElement, DOMRect>();
  const buttons = [...controls].flatMap(([id, record]) => {
    const node = record.node;
    if (modal || !node.isConnected || node.closest('[inert], [hidden]') || !node.getClientRects().length) return [];
    const rect = node.getBoundingClientRect();
    const rootScroll = rootMode && !!node.closest('.mobile-artist-pane');
    if (!rect.width || !rect.height || !rootScroll && (rect.bottom < 0 || rect.top > innerHeight)) return [];
    let clipX = 0, clipY = 0, clipRight = innerWidth, clipBottom = innerHeight;
    const pane = node.closest<HTMLElement>('.mobile-pane');
    if (pane && !rootScroll) {
      let clip = clips.get(pane);
      if (!clip) { clip = pane.getBoundingClientRect(); clips.set(pane, clip); }
      clipX = Math.max(0, clip.x); clipY = Math.max(0, clip.y);
      clipRight = Math.min(innerWidth, clip.x + clip.width); clipBottom = Math.min(innerHeight, clip.y + clip.height);
    }
    if (rootScroll) { clipY = 0; clipBottom = document.documentElement.scrollHeight; }
    if (rect.x + rect.width <= clipX || rect.x >= clipRight || !rootScroll && (rect.y + rect.height <= clipY || rect.y >= clipBottom)) return [];
    return [{ id, symbol: record.options.symbol, prominent: record.options.prominent === true,
      selected: record.options.selected === true, iconSize: record.options.iconSize ?? 20,
      style: record.options.style ?? 'glass', rootScroll,
      label: node.getAttribute('aria-label') || '', enabled: !node.disabled, tint: accent,
      x: Math.round(rect.x * 10) / 10, y: Math.round((rect.y + (rootScroll ? scrollY : 0)) * 10) / 10,
      width: rect.width, height: rect.height, clipX, clipY, clipWidth: clipRight - clipX, clipHeight: clipBottom - clipY }];
  });
  const snapshot = { buttons, viewportWidth: innerWidth, rootMode, scrollEnabled };
  const payload = JSON.stringify(snapshot);
  const bridge = directBridge();
  if (bridge && payload !== lastPayload) {
    // Scroll geometry goes straight to WebKit's main-thread handler, without
    // waiting for a Rust command response before sending the next frame.
    bridge.postMessage(snapshot);
    lastPayload = payload;
    const active = new Set(buttons.map(button => button.id));
    controls.forEach((record, id) => markReady(record, active.has(id)));
  } else if (!bridge && !sending && payload !== lastPayload) {
    sending = true;
    lastPayload = payload;
    void invoke<boolean>('ios_glass_buttons_update', snapshot)
      .then(ready => {
        bridgeReady = ready;
        const active = new Set(buttons.map(button => button.id));
        controls.forEach((record, id) => markReady(record, ready && active.has(id)));
      }).catch(error => { controls.forEach(record => markReady(record, false)); console.warn('[iOS glass controls]', error); })
      .finally(() => { sending = false; schedule(); });
  }
  if (performance.now() < motionUntil && controls.size) schedule();
}
function start() {
  const current = ++generation;
  lastPayload = '';
  accent = undefined;
  observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' && record.target === document.body && ['class', 'style', 'data-theme'].includes(record.attributeName || ''))) accent = undefined;
    if (hasIOSOverlayChange(records) || records.some(record => affectsControls(record.target))) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-ios-scroll', 'inert', 'hidden', 'open', 'disabled', 'aria-label', 'aria-pressed'] });
  resizeObserver = new ResizeObserver(schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointermove', trackMotion, { passive: true });
  window.addEventListener('pointerup', trackMotion);
  document.addEventListener('transitionrun', trackMotion, true);
  document.addEventListener('animationstart', trackMotion, true);
  document.addEventListener('lomify:layout-motion', trackMotion, true);
  document.addEventListener('transitionend', onMotionEnd, true);
  document.addEventListener('animationend', onMotionEnd, true);
  void listen<string>('ios:control', event => {
    const node = controls.get(event.payload)?.node;
    if (node?.isConnected && !node.disabled && !node.closest('[inert], [data-edge-back]')) node.click();
  }).then(release => { if (current !== generation) release(); else releaseEvents = release; }).catch(console.warn);
}
function stop() {
  ++generation;
  releaseEvents(); releaseEvents = () => {};
  observer?.disconnect(); resizeObserver?.disconnect();
  window.removeEventListener('resize', schedule);
  document.removeEventListener('scroll', onScroll, true);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pointermove', trackMotion);
  window.removeEventListener('pointerup', trackMotion);
  document.removeEventListener('transitionrun', trackMotion, true);
  document.removeEventListener('animationstart', trackMotion, true);
  document.removeEventListener('lomify:layout-motion', trackMotion, true);
  document.removeEventListener('transitionend', onMotionEnd, true);
  document.removeEventListener('animationend', onMotionEnd, true);
  cancelAnimationFrame(frame); frame = 0;
  // Empty snapshots remove native controls after their Svelte owners disappear.
  schedule();
}

/** UIKit's actual glass button; retains the existing Svelte click handler. */
export function iosGlassButton(node: HTMLButtonElement, options: Options) {
  if (!isIOS || !isTauri()) return {};
  if (!controls.size) start();
  const id = `ios-glass-${++sequence}`;
  const record = { node, options, originalHidden: node.getAttribute('aria-hidden') };
  controls.set(id, record);
  resizeObserver?.observe(node);
  schedule();
  return {
    update(next: Options) { record.options = next; schedule(); },
    destroy() {
      markReady(record, false);
      resizeObserver?.unobserve(node);
      controls.delete(id);
      if (!controls.size) stop(); else schedule();
    }
  };
}
