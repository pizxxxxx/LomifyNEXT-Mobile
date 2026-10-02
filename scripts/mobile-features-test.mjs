// Pure mobile collection and SoundCloud Wave tests. No network, accounts or app storage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { writable, get } from 'svelte/store';

const source = readFileSync(new URL('../src/lib/mobileTracks.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const notices = [];
const stores = {
  currentTrack: writable(null), isPlaying: writable(false), queue: writable([]),
  likedTracks: writable([]), playlists: writable([]), listenStats: writable({}),
  searchHistory: writable([]), settings: writable({ searchSource: 'yandex', mobileHiddenTracks: [], waveGenre: '' }),
  notify: (...args) => notices.push(args)
};
let stoppedYandex = false;
const exports = {};
const dependencies = {
  'svelte/store': { writable, get },
  './stores': stores,
  './api': { getTrendingTracks: async () => [] },
  './waveFilters': { trackMatchesWaveGenre: () => true },
  './wave': { stopWave: () => { stoppedYandex = true; } }
};
vm.runInNewContext(outputText, {
  exports, require: id => { assert(id in dependencies, `Unexpected import ${id}`); return dependencies[id]; },
  crypto: { randomUUID: () => 'test-id' }, console, Map, Set
});

const liked = Array.from({ length: 3 }, (_, index) => ({ id: `${index + 1}`, source: 'soundcloud', title: `Track ${index + 1}`, artist: 'Artist' }));
stores.likedTracks.set(liked);
assert.equal(await exports.startScWave(), true);
assert(stoppedYandex);
assert.equal(get(stores.settings).searchSource, 'soundcloud');
assert.equal(get(stores.currentTrack).mobileScWave, true);
assert.equal(get(stores.queue).length, 2);
assert.equal(get(stores.isPlaying), true);
console.log('PASS SoundCloud Wave starts from likes and takes over the queue');

stores.queue.set([]);
await exports.refillScWave();
assert.equal(get(stores.queue).length, 2);
assert(get(stores.queue).every(track => track.mobileScWave));
console.log('PASS SoundCloud Wave rotates liked tracks after queue exhaustion');

const hidden = get(stores.queue)[0];
exports.hideMobileTrack(hidden);
assert(exports.isMobileHidden(hidden));
assert.equal(get(stores.queue).length, 1);
const playlistId = exports.createMobilePlaylist(' My Mix ');
assert.equal(playlistId, 'mobile_test-id');
exports.addMobileTrackToPlaylist(playlistId, liked[0]);
exports.addMobileTrackToPlaylist(playlistId, liked[0]);
assert.equal(get(stores.playlists)[0].tracks.length, 1);
assert.equal(get(stores.playlists)[0].title, 'My Mix');
console.log('PASS hidden tracks and duplicate-safe playlist addition');

exports.stopScWave();
assert.equal(get(exports.scWaveActive), false);
assert(notices.length >= 2);

const playing = get(stores.currentTrack);
const likesBefore = get(stores.likedTracks);
const requested = { id: 'requested', source: 'yandex', title: 'Next', artist: 'Artist' };
stores.queue.set([liked[0], requested, liked[1]]);
exports.queueMobileTrackNext(requested);
assert.equal(get(stores.currentTrack), playing, 'queueing must leave current playback alone');
assert.equal(get(stores.likedTracks), likesBefore, 'queue and station playback never add likes');
assert.equal(get(stores.queue)[0].id, 'requested');
assert.equal(get(stores.queue).filter(track => track.id === 'requested').length, 1);
assert.equal(requested.mobileQueuedNext, undefined, 'source metadata is not mutated');
assert.equal(exports.mobileNextQueueIndex(get(stores.queue), true, () => .99), 0, 'explicit next overrides shuffle');
assert.equal(exports.mobileNextQueueIndex([liked[0], get(stores.queue)[0]], true, () => 0), 1);
assert.equal(exports.mobileNextQueueIndex(liked, true, () => .99), 2);
console.log('PASS explicit next, shuffle priority, deduplication and unchanged likes/playback');

// Leaving the wave page must not allow a delayed discovery feed to take over audio.
for (const reason of ['abort', 'stop', 'track', 'source']) {
  stores.likedTracks.set([]);
  stores.currentTrack.set(null);
  stores.isPlaying.set(false);
  stores.settings.update(s => ({ ...s, searchSource: 'soundcloud', mobileHiddenTracks: [] }));
  const previousQueue = [requested];
  stores.queue.set(previousQueue);
  let reply;
  dependencies['./api'].getTrendingTracks = () => new Promise(resolve => { reply = resolve; });
  const controller = new AbortController();
  const pending = exports.startScWave({ signal: controller.signal });
  if (reason === 'abort') controller.abort();
  if (reason === 'stop') exports.stopScWave();
  if (reason === 'track') stores.currentTrack.set(requested);
  if (reason === 'source') stores.settings.update(s => ({ ...s, searchSource: 'yandex' }));
  reply(liked);
  assert.equal(await pending, false);
  assert.equal(get(stores.queue), previousQueue);
  assert.equal(get(stores.isPlaying), false);
  assert.equal(get(exports.scWaveActive), false);
  assert.notEqual(get(stores.currentTrack)?.mobileScWave, true);
  console.log(`PASS late SoundCloud start ignored after ${reason}`);
}
{
  const controller = new AbortController();
  controller.abort();
  stoppedYandex = false;
  assert.equal(await exports.startScWave({ signal: controller.signal }), false);
  assert.equal(stoppedYandex, false, 'an already cancelled request must leave the station alone');
  console.log('PASS already cancelled SoundCloud start has no side effects');
}
{
  stores.currentTrack.set(null);
  stores.settings.update(s => ({ ...s, searchSource: 'soundcloud' }));
  const replies = [];
  dependencies['./api'].getTrendingTracks = () => new Promise(resolve => replies.push(resolve));
  const first = exports.startScWave(), second = exports.startScWave();
  replies[1]([{ ...liked[0], id: 'new' }]);
  assert.equal(await second, true);
  replies[0]([{ ...liked[1], id: 'stale' }]);
  assert.equal(await first, false);
  assert.equal(get(stores.currentTrack).id, 'new');
  assert.equal(get(stores.isPlaying), true);
  console.log('PASS latest SoundCloud start wins, without a late queue replacement');
}
