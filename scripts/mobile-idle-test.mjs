// Native bridge regression: idle list mutations must not cause layout/readback work.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let now = 0, sequence = 0, reads = 0, bounds = 0;
const frames = new Map(), listeners = new Map(), nativeCalls = [];
const pending = [];
let holdCalls = false;
class Element {
  constructor(tag = 'div', className = '') {
    this.tag = tag; this.className = className; this.children = []; this.attrs = new Map();
    this.disabled = false; this.isConnected = true; this.x = 10; this.y = 500; this.width = 44; this.height = 44;
    if (className === 'mobile-pane') { this.x = this.y = 0; this.width = 390; this.height = 844; }
    this.dataset = new Proxy({}, { get: (_object, key) => this.attrs.get('data-' + String(key).replace(/[A-Z]/g, v => '-' + v.toLowerCase())), set: (_object, key, value) => { this.attrs.set('data-' + String(key).replace(/[A-Z]/g, v => '-' + v.toLowerCase()), value); return true; }, deleteProperty: (_object, key) => this.attrs.delete('data-' + String(key).replace(/[A-Z]/g, v => '-' + v.toLowerCase())) });
  }
  append(child) { this.children.push(child); child.parent = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selectors) {
    return selectors.split(',').some(selector => {
      const value = selector.trim();
      const tag = value.match(/^[a-z]+/)?.[0];
      if (tag && tag !== this.tag) return false;
      if ([...value.matchAll(/\.([\w-]+)/g)].some(match => !this.className.split(' ').includes(match[1]))) return false;
      if ([...value.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].some(match => !this.attrs.has(match[1]) || match[2] && this.attrs.get(match[1]) !== match[2])) return false;
      return true;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); }
  getClientRects() { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() { bounds++; return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.y, bottom: this.y + this.height }; }
}
const body = new Element('body');
const document = {
  body, hidden: false, documentElement: { scrollHeight: 3200 },
  querySelector: selector => body.querySelector(selector),
  querySelectorAll: selector => body.querySelectorAll(selector),
  createElement: () => ({ getContext: () => ({ fillRect() {}, getImageData() { reads++; return { data: [255, 136, 77, 255] }; } }) }),
  addEventListener: (name, fn) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); },
  removeEventListener: (name, fn) => listeners.get(name)?.delete(fn)
};
const window = document;
let mutations;
class MutationObserver { constructor(fn) { mutations = fn; } observe() {} disconnect() {} }
class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
const environment = { Element, CustomEvent, document, window, MutationObserver, ResizeObserver,
  innerWidth: 390, innerHeight: 844, scrollY: 0,
  performance: { now: () => now },
  getComputedStyle: () => ({ getPropertyValue: () => '#ff884d' }),
  requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
  cancelAnimationFrame: id => frames.delete(id), console
};
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { ...environment, exports, require: name => { assert(name in imports, name); return imports[name]; } });
  return exports;
}
const overlays = load('../src/lib/utils/iosOverlayChanges.ts');
const { iosGlassButton } = load('../src/lib/actions/iosGlassButton.ts', {
  '@tauri-apps/api/core': { isTauri: () => true, invoke: (_command, payload) => { nativeCalls.push(payload); return holdCalls ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(true); } },
  '@tauri-apps/api/event': { listen: async () => () => {} },
  '$lib/mobile': { isIOS: true }, '$lib/utils/iosOverlayChanges': overlays
});
async function flush() {
  for (let step = 0; step < 60; step++) {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    if (!frames.size) return;
    const tasks = [...frames.values()]; frames.clear(); now += 17; tasks.forEach(fn => fn());
  }
  assert.fail('Unbounded animation-frame loop');
}
function dispatch(type, target) { for (const fn of listeners.get(type) ?? []) fn({ type, target }); }
function attribute(target, attributeName = 'style') { return { type: 'attributes', target, attributeName }; }
const panel = new Element('div', 'mobile-player'); body.append(panel);
const button = new Element('button'); panel.append(button); button.setAttribute('aria-label', 'Воспроизвести');
const action = iosGlassButton(button, { symbol: 'play.fill' });
await flush();
assert.equal(reads, 1); assert.equal(nativeCalls.length, 1);
assert(button.hasAttribute('data-ios-glass-ready'));
const pane = new Element('div', 'mobile-pane'); body.append(pane);
const row = new Element('div', 'mobile-track-row'); pane.append(row);
const progress = new Element('div', 'mobile-mini-progress'); panel.append(progress);
const icon = new Element('svg'); button.append(icon);
reads = bounds = 0;
for (let i = 0; i < 600; i++) {
  mutations([attribute(row), attribute(progress), attribute(icon, 'class')]);
  dispatch('pointermove', row); dispatch('scroll', pane);
}
assert.equal(frames.size, 0, 'Ordinary list scrolling and paused-progress DOM changes must stay idle');
assert.equal(bounds, 0); assert.equal(reads, 0); assert.equal(nativeCalls.length, 1);
console.log('PASS 600 list/progress mutations: no native calls, layout reads or canvas readbacks');
const dialog = new Element('dialog'); dialog.setAttribute('open', ''); body.append(dialog);
mutations([{ type: 'childList', target: body, addedNodes: [dialog], removedNodes: [] }]); await flush();
assert.equal(nativeCalls.at(-1).buttons.length, 0);
assert(!button.hasAttribute('data-ios-glass-ready'));
body.children = body.children.filter(node => node !== dialog);
mutations([{ type: 'childList', target: body, addedNodes: [], removedNodes: [dialog] }]); await flush();
assert.equal(nativeCalls.at(-1).buttons.length, 1);
assert(button.hasAttribute('data-ios-glass-ready'));
console.log('PASS opening and closing a dialog hides and restores native controls');
const artistPane = new Element('div', 'mobile-pane'); body.append(artistPane);
const artistButton = new Element('button'); artistPane.append(artistButton);
const artistAction = iosGlassButton(artistButton, { symbol: 'play.fill' }); await flush();
artistButton.y = 200;
dispatch('scroll', artistPane); await flush();
assert.equal(nativeCalls.at(-1).buttons.find(item => item.id !== nativeCalls[0].buttons[0].id).y, 200);
assert.equal(reads, 0, 'Moving controls must reuse the cached tint');
console.log('PASS scrolling artist controls updates their native coordinates');
artistPane.y = 90; artistPane.height = 700;
artistButton.y = 60; dispatch('scroll', artistPane); await flush();
assert.equal(nativeCalls.at(-1).buttons.find(item => item.symbol === 'play.fill' && item.y === 60).clipY, 90);
artistButton.y = 20; dispatch('scroll', artistPane); await flush();
assert.equal(nativeCalls.at(-1).buttons.length, 1, 'Artist buttons outside their scrolling pane must disappear');
artistButton.y = 200;
const directCalls = [];
window.webkit = { messageHandlers: { lomifyControls: { postMessage: payload => directCalls.push(payload) } } };
const beforeDirect = nativeCalls.length;
for (let i = 0; i < 20; i++) { artistButton.y = 200 - i * 4; dispatch('scroll', artistPane); await flush(); }
assert.equal(nativeCalls.length, beforeDirect, 'Live scroll positions must not wait for Rust IPC replies');
assert.equal(directCalls.at(-1).buttons.find(item => item.y === 124).y, 124);
console.log('PASS clipping and 20 live-scroll updates use the direct WebKit bridge');
artistPane.className = 'mobile-pane mobile-artist-pane';
body.dataset.iosScroll = 'artist';
mutations([attribute(body,'data-ios-scroll')]); await flush();
assert.equal(directCalls.at(-1).buttons.find(item=>item.rootScroll).y,124);
const beforeRootCalls=directCalls.length;
bounds=0;
for(let i=0;i<600;i++)dispatch('scroll',document);
await flush();
assert.equal(directCalls.length,beforeRootCalls);
assert.equal(bounds,0,'Root scroll must not measure UIKit buttons');
assert.equal(directCalls.at(-1).rootMode,true);
console.log('PASS 600 root-scroll events: zero layout reads or geometry messages');
delete body.dataset.iosScroll;
mutations([attribute(body,'data-ios-scroll')]); await flush();

delete window.webkit;

panel.className = 'mobile-player expanded ios-swipe-player';
mutations([attribute(panel, 'class')]); await flush();
bounds = 0; dispatch('pointermove', panel); await flush(); assert(bounds > 2);
assert.equal(reads, 0, 'Player dragging must not repeat GPU color readback');
document.hidden = true; dispatch('visibilitychange', body); dispatch('pointermove', panel); await flush();
assert.equal(frames.size, 0);
document.hidden = false; dispatch('visibilitychange', body); await flush();
console.log('PASS expanded-player motion follows controls; hidden pages remain idle');
artistAction.destroy(); await flush();
holdCalls = true; action.update({ symbol: 'pause' }); await flush();
action.destroy(); await flush();
assert.equal(pending.length, 1);
pending.shift()(true); await flush();
assert.equal(nativeCalls.at(-1).buttons.length, 0, 'Unmount during IPC must eventually clear native buttons');
assert.equal(pending.length, 1); pending.shift()(true); await flush();
console.log('PASS unmount during native IPC leaves no ghost controls');

// Optional parallax must not keep a sensor listener alive on a plain track list.
environment.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
environment.screen = { orientation: { angle: 0 } };
window.DeviceOrientationEvent = class {};
const { mobileDepth } = load('../src/lib/actions/mobileDepth.ts');
const depthRoot = new Element('div', 'mobile-app'); body.append(depthRoot);
const depth = mobileDepth(depthRoot, { enabled: true, view: 'library' }); await flush();
assert.equal(listeners.get('deviceorientation')?.size ?? 0, 0);
const favorite = new Element('div', 'mobile-favorites'); let styleWrites = 0;
favorite.style = { setProperty() { styleWrites++; }, removeProperty() {} }; depthRoot.append(favorite);
depth.update({ enabled: true, view: 'home' }); await flush();
assert.equal(listeners.get('deviceorientation').size, 1);
function orientation(beta, gamma) { for (const fn of listeners.get('deviceorientation') ?? []) fn({ beta, gamma }); }
orientation(0, 0); styleWrites = 0;
for (let i = 0; i < 600; i++) orientation(.1, .1);
assert.equal(frames.size, 0); assert.equal(styleWrites, 0);
orientation(5, 5); await flush(); assert(styleWrites > 0, 'Deliberate tilt keeps the depth effect working');
favorite.setAttribute('hidden', ''); depth.update({ enabled: true, view: 'library' }); await flush();
assert.equal(listeners.get('deviceorientation').size, 0);
depth.destroy(); await flush();
console.log('PASS parallax ignores sensor jitter and sleeps on screens without visible depth panels');
