import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/actions/mobileDecorativeVideo.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {}, timers = new Map();
let timerId = 0;
vm.runInNewContext(compiled, { exports, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
function flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); }
function video(withFrameCallback) {
  const listeners = new Map(), classes = new Set(), frames = new Map();
  let plays = 0, pauses = 0, reject = true;
  const node = { readyState: 0, currentTime: 1.5, paused: true, ended: false, error: null,
    classList: { add: value => classes.add(value), contains: value => classes.has(value) }, setAttribute() {},
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    play() { plays++; if (reject) return Promise.reject(new Error('Autoplay')); node.paused = false; return Promise.resolve(); },
    pause() { pauses++; node.paused = true; listeners.get('pause')?.(); }
  };
  if (withFrameCallback) Object.assign(node, { requestVideoFrameCallback: fn => { frames.set(1, fn); return 1; }, cancelVideoFrameCallback: id => frames.delete(id) });
  return { node, listeners, classes, frames, allowPlay: () => reject = false, counts: () => ({ plays, pauses }) };
}
for (const withFrameCallback of [false, true]) {
  const v = video(withFrameCallback), { node, listeners, classes, frames } = v;
  const action = exports.mobileDecorativeVideo(node, true);
  await Promise.resolve();
  assert.equal(node.muted, true);
  assert.equal(node.defaultMuted, true);
  node.readyState = 2;
  v.allowPlay();
  listeners.get('loadeddata')();
  if (withFrameCallback) {
    assert(!classes.has('ready'), 'Fade waits for a presented frame');
    listeners.get('canplay')();
    assert.equal(frames.size, 1, 'Only one frame callback is queued');
    frames.get(1)(); frames.clear();
  }
  assert(classes.has('ready'));
  action.update(false);
  assert(classes.has('ready'), 'Pause retains the loaded frame');
  assert.equal(timers.size, 0, 'User pause must not resume itself');
  action.update(true);
  assert.equal(node.currentTime, 1.5, 'Resume does not seek or reload');
  assert.equal(v.counts().plays, 3, 'Foreground retries a previously blocked play');
  action.update(true);
  assert.equal(v.counts().plays, 3, 'Unchanged active state does not call play again');
  node.paused = true; listeners.get('pause')();
  assert.equal(timers.size, 1);
  flushTimers();
  assert.equal(v.counts().plays, 4, 'One unexpected WebKit pause is recovered');
  node.paused = true; listeners.get('pause')(); flushTimers();
  assert.equal(v.counts().plays, 4, 'Repeated browser pauses must not cause a retry loop');
  action.update(false); action.update(true);
  node.paused = true; listeners.get('pause')();
  action.update(false); flushTimers();
  assert.equal(v.counts().plays, 5, 'User pause cancels a pending recovery');
  action.destroy();
  assert.equal(listeners.size, 0);
  action.update(true); flushTimers();
  assert.equal(v.counts().plays, 5, 'Destroyed controller cannot restart video');
}
const pending = video(true);
pending.node.readyState = 2;
pending.allowPlay();
const action = exports.mobileDecorativeVideo(pending.node, true);
pending.node.paused = true; pending.listeners.get('pause')();
action.destroy();
assert.equal(timers.size, 0);
assert.equal(pending.frames.size, 0, 'Destroy cancels the pending frame callback');
console.log('PASS decorative video: first frame, muted autoplay, retained pause/resume, bounded recovery and cleanup');
