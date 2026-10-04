import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let now = 0, enabled = true;
const calls = [], handlers = new Map();
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mobileHaptics.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports, performance: { now: () => now }, require: name => ({
  '@tauri-apps/api/core': { isTauri: () => enabled, invoke: async (...args) => { calls.push(args); throw new Error('No Taptic Engine'); } },
  './mobile': { isMobile: true }
}[name]) });
exports.mobileHaptic('light');
assert.equal(calls.length, 1, 'First interaction gets feedback');
exports.mobileHaptic('selection');
assert.equal(calls.length, 1, 'One gesture cannot double-fire');
now = 70;
const node = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
const action = exports.mobileHaptics(node);
const button = { disabled: false, dataset: {}, matches: () => false, closest: () => true };
handlers.get('click')({ target: { closest: () => button } });
assert.equal(calls.length, 2);
assert.equal(calls[1][1].kind, 'selection');
now = 150;
button.dataset.iosGlassReady = 'true';
handlers.get('click')({ target: { closest: () => button } });
assert.equal(calls.length, 2, 'UIKit emits its own feedback without a second JS pulse');
button.dataset.iosGlassReady = undefined;
button.disabled = true;
handlers.get('click')({ target: { closest: () => button } });
assert.equal(calls.length, 2, 'Disabled controls remain silent');
enabled = false;
exports.mobileHaptic();
assert.equal(calls.length, 2, 'Browser preview does not vibrate');
action.destroy();
assert.equal(handlers.size, 0);
await new Promise(resolve => setImmediate(resolve));
console.log('PASS mobile haptics: first tap, throttle, UIKit deduplication, disabled controls, unsupported hardware and cleanup');
