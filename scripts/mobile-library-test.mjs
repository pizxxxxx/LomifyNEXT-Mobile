// Offline regression tests for local deletion, source sync and playlist tombstones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { get, writable } from 'svelte/store';

const memory = new Map();
const localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: key => memory.delete(key)
};
const settings = writable({
  yandexToken: 'test-token', yandexUser: { uid: 42 }, scUser: { id: 7 },
  mobileSkipRemovedYandexLikes: true, mobileHiddenTracks: []
});
const stores = {
  likedTracks: writable([]), playlists: writable([]), settings,
  currentTrack: writable(null), isPlaying: writable(false), queue: writable([]),
  searchHistory: writable([]), listenStats: writable({}), notify: () => {}
};
const ymA = { source: 'yandex', id: '101', title: 'A', artist: 'Artist' };
const ymB = { source: 'yandex', id: '102', title: 'B', artist: 'Artist' };
const ymC = { source: 'yandex', id: '103', title: 'C', artist: 'Artist' };
const scA = { source: 'soundcloud', id: '201', title: 'SC', artist: 'Artist' };
let remoteLikes = [ymA, ymB, ymC];
const remoteEdits = [];
function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, require: id => { assert(id in dependencies, `Unexpected import ${id}`); return dependencies[id]; },
    localStorage, console, Map, Set, Promise, Date, crypto: { randomUUID: () => 'test' }
  });
  return exports;
}

const likes = loadModule('../src/lib/likes.ts', {
  'svelte/store': { get }, './stores': stores,
  './utils/plural': { withCount: (count, one, few, many) => `${count} ${count === 1 ? one : many}` },
  './yandex': {
    getYandexLikes: async () => ({ tracks: remoteLikes, complete: true }),
    yandexSetLikes: async (_token, ids, liked) => {
      remoteEdits.push({ ids: [...ids], liked });
      remoteLikes = liked ? remoteLikes : remoteLikes.filter(track => !ids.includes(track.id));
    }
  },
  './api': { getUserLikes: async () => ({ tracks: [scA], complete: true }) }
});
stores.likedTracks.set([ymA, scA]);
assert.equal(likes.removeMobileLikedTrack(ymA), true);
assert.equal(get(stores.likedTracks).length, 1);
assert.equal(remoteEdits.length, 0, 'local deletion must not change Yandex');
await likes.syncLikes({ only: 'yandex', silent: true });
assert.deepEqual(Array.from(get(stores.likedTracks), track => track.id), ['102', '103', '201'], 'other Yandex likes still import');
assert.equal(likes.clearMobileLikedTracks(false), 3);
await likes.syncLikes({ silent: true });
assert.equal(get(stores.likedTracks).length, 0, 'removed Yandex and SoundCloud likes stay hidden');
assert.equal(remoteEdits.length, 0);
settings.update(value => ({ ...value, mobileSkipRemovedYandexLikes: false }));
await likes.syncLikes({ only: 'yandex', silent: true });
assert.equal(get(stores.likedTracks).length, 3, 'disabling protection permits reimport');
assert.equal(likes.clearMobileLikedTracks(true, ['104']), 3);
await likes.flushYandexQueue();
assert.equal(likes.pendingYandexLikeRemovals(), 0);
assert.equal(remoteEdits.length, 1);
assert.deepEqual([...remoteEdits[0].ids].sort(), ['101', '102', '103', '104']);
assert.equal(remoteEdits[0].liked, false);
console.log('PASS local and remote bulk deletion, selective Yandex sync');

const mobileTracks = loadModule('../src/lib/mobileTracks.ts', {
  'svelte/store': { get, writable }, './stores': stores,
  './api': { getTrendingTracks: async () => [] },
  './waveFilters': { trackMatchesWaveGenre: () => true },
  './wave': { stopWave: () => {} }
});
stores.playlists.set([{ id: 'ym_playlist_42_1', title: 'Import', tracks: [ymA, ymB] }]);
assert(mobileTracks.renameMobilePlaylist('ym_playlist_42_1', '  На вечер  '));
assert.equal(get(stores.playlists)[0].title, 'На вечер');
assert.equal(get(stores.playlists)[0].tracks.length, 2, 'rename keeps imported tracks');
assert.equal(mobileTracks.renameMobilePlaylist('ym_playlist_42_1', '   '), false);
assert.equal(get(stores.playlists)[0].title, 'На вечер', 'empty title does not overwrite playlist');
stores.playlists.set([{ id: 'mobile_shuffle', title: 'Mix', tracks: [ymA, ymB, ymC] }]);
const originalOrder = mobileTracks.shuffleMobilePlaylist('mobile_shuffle', () => .999);
assert.deepEqual(Array.from(originalOrder), ['yandex:101', 'yandex:102', 'yandex:103']);
assert.deepEqual(Array.from(get(stores.playlists)[0].tracks, track => track.id), ['102', '101', '103'], 'shuffle must change order even on identity random draws');
assert(mobileTracks.restoreMobilePlaylistOrder('mobile_shuffle', originalOrder));
assert.deepEqual(Array.from(get(stores.playlists)[0].tracks, track => track.id), ['101', '102', '103']);
assert.equal(mobileTracks.shuffleMobilePlaylist('missing'), null);
assert.equal(mobileTracks.shuffleMobilePlaylist('mobile_shuffle', () => 0)?.length, 3);
mobileTracks.removeMobileTrackFromPlaylist('mobile_shuffle', ymB);
assert(mobileTracks.restoreMobilePlaylistOrder('mobile_shuffle', originalOrder));
assert.deepEqual(Array.from(get(stores.playlists)[0].tracks, track => track.id), ['101', '103'], 'undo does not resurrect removed tracks');
console.log('PASS playlist shuffle and safe undo');
const { createMobileShakeDetector } = loadModule('../src/lib/mobileShake.ts', {});
let shakes = 0;
const detectShake = createMobileShakeDetector(() => shakes++);
const sample = force => ({ acceleration: { x: force, y: 0, z: 0 } });
detectShake(sample(14), 1000);
detectShake(sample(14), 1040);
detectShake(sample(0), 1080);
detectShake(sample(14), 1200);
assert.equal(shakes, 1, 'two distinct peaks trigger once');
detectShake(sample(0), 1250);
detectShake(sample(14), 1320);
detectShake(sample(0), 1360);
detectShake(sample(14), 1500);
assert.equal(shakes, 1, 'cooldown prevents repeat');
console.log('PASS deliberate shake detection');
stores.playlists.set([{ id: 'ym_playlist_42_1', title: 'Import', tracks: [ymA, ymB] }]);
assert(mobileTracks.removeMobileTrackFromPlaylist('ym_playlist_42_1', ymA));
assert.equal(get(stores.playlists)[0].tracks.length, 1);
assert(mobileTracks.deleteMobilePlaylist('ym_playlist_42_1'));
assert(mobileTracks.isMobilePlaylistExcluded('ym_playlist_42_1'));
mobileTracks.allowMobilePlaylistReimport();
assert.equal(mobileTracks.isMobilePlaylistExcluded('ym_playlist_42_1'), false);
console.log('PASS playlist track removal, deletion and explicit reimport recovery');
