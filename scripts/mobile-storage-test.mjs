// Real app stores, synthetic libraries/quota failures. No account or existing app storage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as storesApi from 'svelte/store';

const get = storesApi.get;
const source = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const persistenceCode = source('../src/lib/storePersistence.ts');
const storesCode = source('../src/lib/stores.ts');

function disk() { return { legacy: new Map(), records: new Map(), created: false, full: false, databaseUnavailable: false }; }
function boot(disk) {
  const timers = new Map(); let sequence = 0;
  const indexedDB = { open() {
    const request = {};
    setImmediate(() => {
      if (disk.databaseUnavailable) { request.error = new DOMException('Test database unavailable', 'UnknownError'); request.onerror(); return; }
      request.result = {
        createObjectStore() {}, close() {},
        transaction(_table, mode) {
          const transaction = {};
          const pending = [];
          transaction.objectStore = () => ({
            get(key) { const read = {}; pending.push(() => { read.result = disk.records.get(key); }); return read; },
            put(value, key) { pending.push(() => disk.records.set(key, value)); }
          });
          setImmediate(() => { pending.forEach(fn => fn()); transaction.oncomplete?.(); });
          return transaction;
        }
      };
      if (!disk.created) { disk.created = true; request.onupgradeneeded?.(); }
      request.onsuccess();
    });
    return request;
  } };
  const environment = {
    console, indexedDB, navigator: { hardwareConcurrency: 8 },
    localStorage: {
      getItem: key => disk.legacy.get(key) ?? null,
      setItem(key, value) {
        if (disk.full || value.length > 256 * 1024) throw new DOMException('Test localStorage quota', 'QuotaExceededError');
        disk.legacy.set(key, value);
      }
    },
    window: { addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id)
  };
  const persistence = {};
  vm.runInNewContext(persistenceCode, { ...environment, exports: persistence,
    require: id => { assert.equal(id, 'svelte/store'); return storesApi; } });
  const state = {};
  vm.runInNewContext(storesCode, { ...environment, exports: state, require: id => {
    if (id === 'svelte/store') return storesApi;
    assert.equal(id, './storePersistence'); return persistence;
  } });
  state.initStore();
  return { state, persistence };
}

const tracks = Array.from({ length: 1800 }, (_, index) => ({
  id: String(index + 1), source: 'yandex', title: `Test ${index}`, artist: 'Test artist',
  artists: ['Test artist'], duration: 180000, lyricsAvailable: true,
  coverUrl: `https://example.invalid/${'cover'.repeat(80)}/${index}`
}));
const playlists = Array.from({ length: 30 }, (_, index) => ({ id: `ym_playlist_100_${index}`,
  title: `Playlist ${index}`, tracks: tracks.slice(0, 500),
  sync: { provider: 'yandex', accountId: '100', remoteId: `ym_playlist_100_${index}`, baseline: { title: `Playlist ${index}`, keys: tracks.slice(0, 500).map(track => track.id) } }
}));
const saved = disk();
saved.legacy.set('lomifynext_likes', JSON.stringify([{ id: 'legacy', title: 'Legacy', source: 'yandex' }]));
saved.legacy.set('lomifynext_settings', JSON.stringify({ yandexToken: 'test-only-token', searchSource: 'yandex' }));
const app = boot(saved);
await app.persistence.waitForStoreStorage();
const views = [];
app.state.currentView.subscribe(view => views.push(view));
assert.doesNotThrow(() => { app.state.likedTracks.set(tracks); app.state.playlists.set(playlists); });
app.state.currentView.set('settings'); app.state.currentView.set('library'); app.state.currentView.set('search');
assert.deepEqual(views, ['home', 'settings', 'library', 'search'], 'Large imports must not poison Svelte navigation');
assert.equal(await app.persistence.flushStoredState(), true);
assert.equal(JSON.parse(saved.records.get('lomifynext_likes')).length, tracks.length);
assert.equal(JSON.parse(saved.records.get('lomifynext_playlists'))[0].tracks.length, 500);
assert.equal(JSON.parse(saved.legacy.get('lomifynext_likes'))[0].id, 'legacy', 'Migration preserves legacy backup');
console.log('PASS large Yandex likes/playlists import, navigation, full metadata and preserved legacy backup');

const restarted = boot(saved);
await restarted.persistence.waitForStoreStorage();
assert.equal(get(restarted.state.likedTracks).length, 1800);
assert.equal(get(restarted.state.playlists).length, 30);
assert.equal(get(restarted.state.playlists)[0].sync.baseline.keys.length, 500);
assert.equal(get(restarted.state.likedTracks)[0].coverUrl, tracks[0].coverUrl);
assert.equal(get(restarted.state.settings).yandexToken, 'test-only-token');
restarted.state.likedTracks.set([]);
assert.equal(await restarted.persistence.flushStoredState(), true);
const cleared = boot(saved); await cleared.persistence.waitForStoreStorage();
assert.equal(get(cleared.state.likedTracks).length, 0, 'A later empty collection must not resurrect an old backup');
console.log('PASS restart hydration, account preservation and durable later edits');

saved.full = true;
restarted.state.settings.update(value => ({ ...value, mobileTextSize: 'large' }));
assert.equal(await restarted.persistence.flushStoredState(), true, 'Small settings also fall back when localStorage is full');
const settingsRestart = boot(saved); await settingsRestart.persistence.waitForStoreStorage();
assert.equal(get(settingsRestart.state.settings).mobileTextSize, 'large');
assert.equal(get(settingsRestart.state.settings).yandexToken, 'test-only-token');
console.log('PASS localStorage exhaustion also preserves settings through IndexedDB');
const normalizing = boot(saved);
normalizing.state.settings.update(value => ({ ...value, perfMode: true, crossfadeMs: 0 }));
await normalizing.persistence.waitForStoreStorage();
assert.equal(get(normalizing.state.settings).yandexToken, 'test-only-token', 'Mobile startup defaults must not discard IndexedDB credentials');
assert.equal(get(normalizing.state.settings).mobileTextSize, 'large');
assert.equal(get(normalizing.state.settings).crossfadeMs, 0);
await normalizing.persistence.flushStoredState();
console.log('PASS mobile startup normalization retains restored account and user preferences');

const failedDisk = disk(); failedDisk.full = true; failedDisk.databaseUnavailable = true;
const failing = boot(failedDisk); await failing.persistence.waitForStoreStorage();
const rendered = [];
failing.state.currentView.subscribe(value => rendered.push(value));
assert.doesNotThrow(() => { failing.state.likedTracks.set(tracks); failing.state.playlists.set(playlists); });
assert.equal(await failing.persistence.flushStoredState(), false);
failing.state.currentView.set('library'); failing.state.currentView.set('home');
assert.deepEqual(rendered, ['home', 'library', 'home'], 'Even failure of both storage APIs must leave the UI usable');
assert.equal(get(failing.state.likedTracks).length, tracks.length, 'Current session keeps imported tracks');
assert.equal(get(failing.state.notifications).length, 1, 'Persistent failure is reported without a notice storm');
failedDisk.full = false; failedDisk.databaseUnavailable = false;
assert.equal(await failing.persistence.flushStoredState(), true, 'Retry persists the pending library after storage recovers');
console.log('PASS both backends unavailable, visible failure, working navigation and durable retry');

const racingDisk = disk(); racingDisk.records.set('lomifynext_settings', JSON.stringify({ theme: 'old', yandexToken: 'old-test-token' }));
const racing = boot(racingDisk);
racing.state.settings.update(value => ({ ...value, theme: 'new', yandexToken: 'new-test-token' }));
await racing.persistence.waitForStoreStorage();
assert.equal(get(racing.state.settings).theme, 'new', 'Delayed hydration must not overwrite an explicit startup edit');
await racing.persistence.flushStoredState();
assert.equal(JSON.parse(racingDisk.records.get('lomifynext_settings')).yandexToken, 'new-test-token');
const first = [{ id: 'first' }], second = [{ id: 'second' }];
racing.state.playlists.set(first); const oldWrite = racing.persistence.flushStoredState();
racing.state.playlists.set(second); const newWrite = racing.persistence.flushStoredState();
await Promise.all([oldWrite, newWrite]);
assert.equal(JSON.parse(racingDisk.legacy.get('lomifynext_playlists'))[0].id, 'second');
console.log('PASS startup edit protection and ordered writes');
