import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const frames = new Map(), tasks = new Map();
let nextId = 0;
const document = { hidden: false };
const environment = {
  document,
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
  cancelAnimationFrame: id => frames.delete(id),
  setTimeout: fn => { tasks.set(++nextId, fn); return nextId; },
  clearTimeout: id => tasks.delete(id),
  matchMedia: () => ({ matches: reduced }),
  getComputedStyle: () => ({ opacity: '.91', transform: 'matrix(1, 0, 0, 1, 0, 3)', getPropertyValue: () => 'cubic-bezier(0.23, 1, 0.32, 1)' })
};
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { ...environment, exports });
  return exports;
}
function flush(map) { const callbacks = [...map.values()]; map.clear(); callbacks.forEach(fn => fn()); }
const { afterMobilePaint } = load('../src/lib/utils/mobilePaint.ts');
const { mobileReveal } = load('../src/lib/actions/mobileReveal.ts');
let calls = 0;
afterMobilePaint(() => calls++);
assert.equal(calls, 0);
flush(frames);
assert.equal(calls, 0, 'Mount must not run inside the paint callback');
flush(tasks);
assert.equal(calls, 1);
let cancel = afterMobilePaint(() => calls++);
cancel(); flush(frames); flush(tasks);
assert.equal(calls, 1, 'A superseded navigation must not mount');
cancel = afterMobilePaint(() => calls++);
flush(frames); cancel(); flush(tasks);
assert.equal(calls, 1, 'Cancellation after the frame must cancel the pending task');
document.hidden = true;
afterMobilePaint(() => calls++); flush(tasks);
assert.equal(calls, 2, 'Backgrounded pages must not wait forever for a frame');
document.hidden = false;

let reduced = false, off = false, keyboard = false;
const animations = [];
const node = {
  closest: () => off || keyboard,
  dispatchEvent() {},
  animate(keyframes, options) {
    const animation = { keyframes, options, pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, playState: 'running', cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  }
};
const reveal = mobileReveal(node, 'library');
assert.equal(animations.length, 1);
assert.equal(animations[0].playState, 'paused', 'DOM mount must not consume the reveal timeline');
flush(frames);
assert.equal(animations[0].playState, 'running');
assert.equal(animations[0].options.duration, 340);
reveal.update('library');
assert.equal(animations.length, 1, 'Unchanged state must not restart motion');
reveal.update('likes');
assert.equal(animations[0].cancelled, true);
assert.equal(animations[1].keyframes[0].opacity, '.91', 'Interrupted motion must continue at its current position');
assert.equal(animations[1].keyframes[0].transform, 'matrix(1, 0, 0, 1, 0, 3)');
reveal.update(false);
assert.equal(animations[1].cancelled, true);
off = true; reveal.update('settings');
assert.equal(animations.length, 2);
off = false; keyboard = true; reveal.update('search');
assert.equal(animations.length, 2);
keyboard = false; reduced = true; reveal.update('albums');
assert.equal(animations.length, 3);
assert.equal(animations[2].options.duration, 120);
assert.ok(animations[2].keyframes.every(frame => !('transform' in frame)));
reveal.destroy();
assert.equal(animations[2].cancelled, true);
console.log('Mobile motion: paint ordering, stale navigation, interruption and motion preferences passed');

// Collection cover motion starts after DOM mount, and stale routes cannot play it.
const { mobileCollectionMotion } = load('../src/lib/actions/mobileCollectionMotion.ts');
const cover = { style: {}, dataset: { collectionCover: 'likes' }, getBoundingClientRect: () => ({ left: 80, top: 120, width: 220, height: 220 }), animate: node.animate };
const title = { animate: node.animate };
const collection = { isConnected: true, closest: node.closest, querySelector: () => cover, querySelectorAll: () => [title], dispatchEvent() {} };
reduced = false;
const before = animations.length;
const motion = mobileCollectionMotion(collection, { key: false, from: null });
motion.update({ key: 'likes', from: { left: 20, top: 300, width: 132, height: 132 } });
assert.equal(animations.length, before);
flush(frames);
assert.equal(animations[before].playState, 'paused');
assert.equal(animations[before].keyframes[0].transform, 'translate3d(-60px,180px,0) scale(0.6,0.6)');
flush(frames);
assert.equal(animations[before].playState, 'running');
motion.update({ key: 'likes', from: null });
assert.equal(animations.length, before + 2, 'A row or cover update must not restart collection motion');
motion.update({ key: 'playlist:other', from: null });
motion.update({ key: false, from: null });
flush(frames);
assert.equal(animations.length, before + 2, 'Navigating away before paint must cancel the next animation');
assert(animations.slice(before).every(animation => animation.cancelled));
reduced = true;
motion.update({ key: 'likes', from: null }); flush(frames);
assert.equal(animations.length, before + 2, 'Reduced motion must keep collections static');
motion.destroy();
console.log('Collection motion: shelf-to-header geometry, mount ordering, interruption, unchanged data and reduced motion passed');
