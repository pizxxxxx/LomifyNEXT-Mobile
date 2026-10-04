// A long press opens a dialog outside the held node. Its release must never like a track.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/actions/mobileHold.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const exports = {};
const window = new EventTarget();
const timers = new Map();
let timerId = 0;
vm.runInNewContext(outputText, {
  exports, require: name => name === '$lib/mobileHaptics' ? { mobileHaptic: () => {} } : { isMobile: true }, window, navigator: {},
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
});
class Node extends EventTarget { closest() { return null; } }
const node = new Node();
const pointer = type => Object.assign(new Event(type), { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
const releaseClick = () => new Event('click', { cancelable: true });
let dialogs = 0;
const action = exports.mobileHold(node, { onHold: () => dialogs++ });
node.dispatchEvent(pointer('pointerdown'));
timers.values().next().value();
assert.equal(dialogs, 1);
window.dispatchEvent(pointer('pointerup'));
const click = releaseClick();
window.dispatchEvent(click);
assert.equal(click.defaultPrevented, true, 'release over dialog must be suppressed outside original node');
window.dispatchEvent(pointer('pointerdown'));
const intentional = releaseClick();
window.dispatchEvent(intentional);
assert.equal(intentional.defaultPrevented, false, 'a new intentional tap must still work');
action.destroy();
assert.equal(timers.size, 0);
console.log('PASS modal release cannot trigger Like; subsequent intentional taps still work');
