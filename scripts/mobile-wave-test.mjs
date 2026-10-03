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
  const stations = [];
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
      WAVE_STATION: 'user:onyourwave',
      yandexWaveBatch: (token, tail, station) => { stations.push(station); return new Promise(resolve => requests.push(resolve)); },
      yandexWaveFeedback: (...args) => { feedback.push(args); return Promise.resolve(); }
    }
  });
  const batch = (prefix, n = 10) => ({ batchId: prefix, tracks: Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, title: `${prefix} ${i}`, artist: 'Test', source: 'yandex' })) });
  return { wave, stores, requests, feedback, notices, batch, stations };
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

// Audio-driven oval motion regression checks.
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mobileWaveMotion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports });
const { MobileWaveMotion } = exports;
const bins = new Float32Array(64);
const motion = new MobileWaveMotion();
const energy = (bass, body = .015) => { bins.fill(0); bins.fill(bass, 9, 22); bins.fill(body, 25, 40); };
energy(.08);
motion.update(bins, 0);
assert(motion.bass > .3, 'Quiet tracks should still visibly expand the ovals');
assert(motion.rotation > 1, 'A real bass onset should rotate the oval');
for (let now = 50; now <= 1500; now += 50) motion.update(bins, now);
assert(motion.rotation > 0 && motion.rotation < 1, 'A sustained note must not invent new beats');
const rotations = [];
for (let beat = 0; beat < 6; beat++) {
  const start = 1600 + beat * 500;
  for (let frame = 0; frame < 10; frame++) {
    energy(frame === 0 ? .5 : frame === 1 ? .3 : .02);
    motion.update(bins, start + frame * 50);
    if (frame === 0) rotations.push(motion.rotation);
    assert(Math.abs(motion.rotation) <= 5.3 && Math.abs(motion.lightRotation) <= 4.91);
    assert(motion.bass >= 0 && motion.bass <= 1 && motion.body >= 0 && motion.body <= 1);
  }
}
for (let index = 1; index < rotations.length; index++) assert(rotations[index] * rotations[index - 1] < 0, 'Separate bass hits should alternate rotation');
bins.fill(0); motion.update(bins, 5000);
assert.equal(motion.bass + motion.body + motion.beat + motion.rotation + motion.lightRotation, 0, 'One silence event must settle everything without a timer');
bins.fill(.9, 0, 6); motion.update(bins, 5100);
assert.equal(motion.beat, 0, 'Sub-bass alone must not cause false kicks');
bins.fill(NaN); motion.update(bins, 5200);
assert.equal(motion.rotation, 0);
energy(1, 1);
for (let now = 6000; now < 15000; now += 50) motion.update(bins, now);
assert(motion.rotation < 1, 'Loud sustained audio must also settle');
motion.reset();
assert.equal(motion.rotation + motion.bass + motion.body + motion.beat, 0);
console.log('PASS: quiet/loud audio, kick alternation, sustained notes, angle limits, silence, sub-bass noise and reset');

// A loud held bass masks the average energy increase, while separate bands still
// contain real kick transients. This reproduces "only the first bar animates".
{
  const dense = new MobileWaveMotion();
  const frame = new Float32Array(64);
  let previousBeatAt = -Infinity, onsets = 0;
  for (let index = 0; index < 2400; index++) {
    const phase = index % 10;
    frame.fill(.28);
    frame.fill(.75, 6, 23);
    frame[9] = .99; // held harmonic, not a new beat
    frame.fill(phase === 0 ? .84 : phase === 1 ? .81 : .75, 13, 22);
    dense.update(frame, index * 50);
    if (dense.beat > .85 && index * 50 - previousBeatAt > 180) { onsets++; previousBeatAt = index * 50; }
  }
  assert(onsets >= 200, `Dense 120-second track lost its beats: ${onsets}/240`);
  console.log(`PASS dense two-minute track: ${onsets}/240 beats detected after the first bar`);
}

// Seed selection is a station change, not a one-off similar-tracks query.
{
  const {wave,stores,requests,feedback,stations,batch}=setup();
  assert.equal(wave.waveSeedForTrack({id:'123:456',title:'Seed',artist:'Artist',source:'yandex'}).id,'123');
  assert.equal(wave.waveSeedForTrack({id:123,source:'soundcloud'}),null);
  assert.equal(wave.waveSeedForTrack({id:'../../other',source:'yandex'}),null);
  const seed={id:'123',source:'yandex',title:'Seed',artist:'Artist'};
  const pending=wave.startWave({seedTrack:seed});
  assert.equal(stations.at(-1),'track:123');requests.shift()(batch('seed'));assert.equal(await pending,true);
  assert.equal(get(wave.waveSeed).title,'Seed');
  assert.equal(get(stores.currentTrack).waveStationId,'track:123');
  assert.equal(feedback[0][2].station,'track:123');
  assert(feedback.some(event=>event[1]==='trackStarted'));
  wave.waveTrackDone(get(stores.currentTrack),20,'skip');
  assert(feedback.every(event=>event[2].station==='track:123'));
  stores.queue.set([]);const refill=wave.waveRefill();assert.equal(stations.at(-1),'track:123');requests.shift()(batch('more'));await refill;
  assert(get(stores.queue).every(track=>track.waveStationId==='track:123'));
  const personal=wave.startWave({seedTrack:null});assert.equal(stations.at(-1),'user:onyourwave');requests.shift()(batch('personal'));await personal;
  assert.equal(get(wave.waveSeed),null);
  console.log('PASS seeded station, compound IDs, feedback, refill and return to personal radio');
}
{
 const {wave,stores,requests,batch}=setup();
 const first=wave.startWave({seedTrack:{id:'123',source:'yandex',title:'Seed'}});requests.shift()(batch('first'));await first;
 const cancelled=new AbortController();const pending=wave.startWave({seedTrack:{id:'456',source:'yandex',title:'Other'},signal:cancelled.signal});cancelled.abort();requests.shift()(batch('late'));assert.equal(await pending,false);
 assert.equal(get(wave.waveSeed).id,'123');assert.equal(get(stores.currentTrack).id,'first-0');
 stores.queue.set([]);const old=wave.waveRefill();const late=requests.shift();const restart=wave.startWave({seedTrack:{id:'789',source:'yandex',title:'New'}});requests.shift()(batch('new'));await restart;late(batch('stale'));await old;
 assert(get(stores.queue).every(track=>track.waveStationId==='track:789'));
 console.log('PASS cancelled seed preserves playback; old refill cannot enter another seed station');
}
