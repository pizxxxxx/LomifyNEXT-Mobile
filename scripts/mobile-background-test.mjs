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
for (const platform of ['ios', 'android']) {
const calls = [];
const env = {
  exports: {}, mobile: true, isIOS: platform === 'ios', isAndroid: platform === 'android', usesNativeMobileAudio: true, lastBackgroundSequence: 0, repeatMode: 0,
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
console.log(`PASS ${platform} native background: Previous -> Next, forward -> Previous, history, pause preservation and duplicate/loading guards`);
}

// Prepare the actual player queue: metadata handoff precedes any network wait.
const prep = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareBackgroundNext');
const nativeSource = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'nativeSourceForTrack');
const upcoming = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), source: 'yandex', title: 'Track', artist: 'Artist' }));
const bridges = [];
const preparation = { exports: {}, mobile: true, loadGeneration: 1, backgroundPrepareRequest: 0,
  backgroundEpochBase: 100, isShuffle: false, repeatMode: 0, nativeCurrentSource: null, backgroundCandidates: [],
  queue: store(upcoming), currentTrack: store({ ...upcoming[0], id: '0' }), trackHistory: store([]),
  settings: store({ yandexToken: 'fake', autoCache: false }), $settings: { preloadNext: true },
  knownYandexPlaybackId: track => track.id, normalizeYandexToken: token => token,
  get: state => state.value, document: { hidden: false }, previousPrepareCommand: 'audio_ios_previous_prepare',
  buildUrn: track => `lomify:yandex:${track.id}`, getAudioUrl: () => new Promise(() => {}),
  invoke: async (name, args) => { bridges.push({ name, args }); return null; }, console };
vm.runInNewContext(ts.transpileModule(nativeSource.getText(source) + '\n' + prep.getText(source) + '\nexports.prepare = prepareBackgroundNext;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, preparation);
void preparation.exports.prepare(1);
await new Promise(resolve => setTimeout(resolve, 0));
const published = bridges.find(call => call.name === 'audio_background_prepare').args.candidates;
assert.equal(published.length, 20, 'No two-successor background limit');
assert(published.every(candidate => candidate.resolver.kind === 'yandex'));
assert.equal(published.at(-1).resolver.id, '20');
assert.equal(bridges.filter(call => call.name === 'audio_prefetch_url').length, 0, 'Optional network prefetch never blocks the metadata handoff');
const count = bridges.length;
preparation.document.hidden = true;
await preparation.exports.prepare(1);
assert.equal(bridges.length, count, 'Hiding must not clear or replace the prepared queue');
await preparation.exports.prepare(1, true);
assert.equal(bridges.filter(call => call.name === 'audio_background_prepare').length, 2, 'Initial loading hands off the queue even if the app was hidden during preparation');
assert.equal(bridges.at(-2).args.candidates.length, 20);
assert.equal(bridges.filter(call => call.name === 'audio_prefetch_url').length, 0, 'Hidden initial loading publishes metadata without prefetching');
console.log('PASS background preparation: 20 successors published before network; hide retains queue');
