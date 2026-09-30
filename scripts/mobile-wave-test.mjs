// Pure Wave regression tests: real module and filters, mocked accounts/network/audio stores.
// No app data, credentials, or network requests are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { writable, get } from 'svelte/store';

function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: id => {
    assert(id in dependencies, `Unexpected import ${id}`); return dependencies[id];
  }, DOMException, console, Map, Set });
  return exports;
}
const filters = compile('../src/lib/waveFilters.ts');
function setup() {
  const requests = [];
  const feedback = [];
  const notices = [];
  const stores = {
    settings: writable({ yandexToken: 'fake-test-account', searchSource: 'yandex' }),
    queue: writable([]), currentTrack: writable(null), isPlaying: writable(false),
    notify: (...args) => notices.push(args)
  };
  const wave = compile('../src/lib/wave.ts', {
    'svelte/store': { writable, get }, './stores': stores, './waveFilters': filters,
    './yandex': {
      yandexWaveBatch: () => new Promise(resolve => requests.push(resolve)),
      yandexWaveFeedback: (...args) => { feedback.push(args); return Promise.resolve(); }
    }
  });
  const batch = (prefix, n = 10) => ({ batchId: prefix, tracks: Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, title: `${prefix} ${i}`, artist: 'Test', source: 'yandex' })) });
  return { wave, stores, requests, feedback, notices, batch };
}
{
  const { wave, stores, requests, feedback, batch } = setup();
  const pending = wave.startWave(); requests.shift()(batch('first'));
  assert.equal(await pending, true);
  assert.equal(get(stores.currentTrack).id, 'first-0');
  assert.equal(get(stores.queue).length, 9);
  assert.equal(get(wave.waveActive), true);
  assert.equal(feedback[0][1], 'radioStarted');
  wave.waveTrackDone(get(stores.currentTrack), 12, 'skip');
  assert.equal(feedback.at(-1)[1], 'skip');
  const count = feedback.length;
  wave.waveTrackDone(get(stores.currentTrack), 0, 'dropped');
  assert.equal(feedback.length, count);
  stores.currentTrack.set({ id: 'queued-manual', mobileQueuedNext: true });
  assert.equal(get(wave.waveActive), true, 'explicit queue insert must preserve the station');
  assert.equal(feedback.length, count, 'manual insert does not send station feedback');
  stores.currentTrack.set({ id: 'manual' });
  assert.equal(get(wave.waveActive), false);
  console.log('PASS wave start, queue, feedback and manual-track handoff');
}
for (const reason of ['abort', 'stop', 'account', 'track']) {
  const { wave, stores, requests, notices, batch } = setup();
  const controller = new AbortController();
  const pending = wave.startWave({ signal: controller.signal });
  if (reason === 'abort') controller.abort();
  if (reason === 'stop') wave.stopWave();
  if (reason === 'account') stores.settings.set({ yandexToken: '' });
  if (reason === 'track') stores.currentTrack.set({ id: 'manual' });
  requests.shift()(batch('late'));
  assert.equal(await pending, false);
  assert.equal(get(stores.queue).length, 0);
  assert.notEqual(get(stores.currentTrack)?.id, 'late-0');
  assert.equal(notices.length, 0);
  console.log(`PASS late start ignored after ${reason}`);
}
{
  const { wave, stores, requests, batch } = setup();
  const first = wave.startWave(), second = wave.startWave();
  const oldReply = requests.shift(); requests.shift()(batch('new'));
  assert.equal(await second, true); oldReply(batch('old'));
  assert.equal(await first, false);
  assert.equal(get(stores.currentTrack).id, 'new-0');
  console.log('PASS newest start wins');
}
{
  const { wave, stores, requests, batch } = setup();
  const first = wave.startWave(); requests.shift()(batch('first')); await first;
  stores.queue.set([]);
  const refill = wave.waveRefill(); const oldReply = requests.shift();
  const restart = wave.startWave(); requests.shift()(batch('new')); await restart;
  oldReply(batch('stale')); await refill;
  assert.equal(get(stores.queue).length, 9);
  assert(get(stores.queue).every(t => t.id.startsWith('new-')));
  console.log('PASS old refill cannot leak into restarted station');
}
assert.equal(filters.trackMatchesWaveFilters({ genre: 'rock' }, { waveGenre: 'rock' }), true);
assert.equal(filters.trackMatchesWaveFilters({ genre: 'jazz' }, { waveGenre: 'rock' }), false);
console.log('PASS desktop genre filters reused');
