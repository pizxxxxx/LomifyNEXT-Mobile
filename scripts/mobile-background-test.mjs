// Run the actual player's reconciliation function, including back -> next while
// the WebView sleeps. Track objects must stay identical to the prepared queue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const text = readFileSync(new URL('../src/lib/components/Player.svelte', import.meta.url), 'utf8');
const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const source = ts.createSourceFile('Player.ts', script, ts.ScriptTarget.Latest, true);
const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncBackgroundPlayback');
assert(fn, 'Player reconciliation function must exist');
const store = value => ({ value, set(next) { this.value = next; } });
const [a, b, c] = ['a', 'b', 'c'].map(id => ({ id, duration: 180000 }));
const calls = [];
const env = {
  exports: {}, mobile: true, isIOS: true, lastBackgroundSequence: 0, repeatMode: 0,
  duration: 180, currentTime: 0, mobileDisplayTime: 0, nativeLoadedTrack: null,
  nativeCurrentSource: null, lastPlayStateSent: null, $waveActive: false,
  queue: store([c]), trackHistory: store([a]), currentTrack: store(b),
  durationStore: store(180), progress: store(0), isPlaying: store(true),
  get: state => state.value, isScWaveTrack: () => false, svelteTick: async () => {},
  invoke: async name => { calls.push(name); assert.equal(name, 'audio_is_playing'); return false; },
  backgroundCandidates: [a, b, c].map((track, index) => ({
    epoch: 5, key: track.id, track, index: [-2, -3, 0][index], source: { key: track.id }
  }))
};
vm.runInNewContext(ts.transpileModule(fn.getText(source) + '\nexports.reconcile = syncBackgroundPlayback;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, env);
const advances = [];
async function advance(key, previous = false) {
  advances.push({ sequence: advances.length + 1, key, previous, durationSecs: 180 });
  await env.exports.reconcile({ epoch: 5, sequence: advances.length, loading: false, advances });
}
await advance('a', true);
assert.equal(env.currentTrack.value, a);
assert.equal(env.queue.value.map(t => t.id).join(','), 'b,c');
assert.equal(env.trackHistory.value.length, 0);
await advance('b');
assert.equal(env.currentTrack.value, b, 'Next after Previous restores the original current track');
assert.equal(env.queue.value.map(t => t.id).join(','), 'c');
await advance('c');
await advance('b', true);
assert.equal(env.currentTrack.value, b, 'A prepared successor can become the native previous track');
assert.equal(env.queue.value.map(t => t.id).join(','), 'c');
assert.equal(env.trackHistory.value.map(t => t.id).join(','), 'a');
assert.equal(env.isPlaying.value, false, 'Restoring a paused native player must not start it through JS');
assert.equal(env.nativeCurrentSource.key, 'b');
assert.equal(calls.length, 4);
await env.exports.reconcile({ epoch: 5, sequence: 4, loading: false, advances });
assert.equal(calls.length, 4, 'Delivered history must not be replayed');
await env.exports.reconcile({ epoch: 5, sequence: 5, loading: true, advances });
assert.equal(calls.length, 4, 'Do not reconcile before the native load completes');
console.log('PASS native background: Previous -> Next, forward -> Previous, history, pause preservation and duplicate/loading guards');
