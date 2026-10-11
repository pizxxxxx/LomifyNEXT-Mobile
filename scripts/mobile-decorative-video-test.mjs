import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/actions/mobileDecorativeVideo.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });
const listeners = new Map();
const classes = new Set();
let plays = 0, pauses = 0, reject = true;
const node = { readyState: 0, currentTime: 1.5, classList: { add: value => classes.add(value) }, setAttribute() {},
  addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
  play: () => { plays++; return reject ? Promise.reject(new Error('Autoplay')) : Promise.resolve(); },
  pause: () => pauses++ };
const action = exports.mobileDecorativeVideo(node, true);
await Promise.resolve();
assert.equal(node.muted, true);
assert.equal(node.defaultMuted, true);
node.readyState = 2;
reject = false;
listeners.get('loadeddata')();
assert(classes.has('ready'));
action.update(false);
assert(classes.has('ready'), 'Pause retains the loaded frame');
action.update(true);
assert.equal(node.currentTime, 1.5, 'Resume does not seek or reload');
assert.equal(plays, 3, 'Foreground retries a previously blocked play');
assert.equal(pauses, 1);
action.destroy();
assert.equal(listeners.size, 0);
action.update(true);
assert.equal(plays, 3, 'Destroyed controller cannot restart video');
console.log('PASS decorative video: muted autoplay, retry, retained frame, pause/resume and cleanup');
