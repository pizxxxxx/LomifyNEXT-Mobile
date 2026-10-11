// Exercise the real sync module with delayed API writes/reads; no accounts or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { writable, get } from 'svelte/store';
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/likes.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const storage = new Map();
const settings = writable({ yandexToken: 'fixture', yandexUser: { uid: '1' } });
const likedTracks = writable([]);
const writes = [];
let read;
const dependencies = {
  'svelte/store': { get }, './stores': { settings, likedTracks, notify() {} },
  './utils/plural': { withCount: n => String(n) },
  './yandex': {
    yandexSetLikes: (token, ids, liked) => new Promise(resolve => writes.push({ token, ids, liked, resolve })),
    getYandexLikes: () => new Promise(resolve => { read = resolve; })
  }
};
const exports = {};
vm.runInNewContext(compiled, { exports, require: id => dependencies[id], console,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const a = { id: '42:100', source: 'yandex', title: 'Original title', artist: 'Artist' };
exports.toggleTrackLike(a);
await settle();
assert.equal(writes.length, 1);
assert.equal(writes[0].ids.join(','), '42', 'Wave compound ID is normalized');
assert.equal(exports.isTrackLiked(get(likedTracks), { ...a, id: '42', title: 'Enriched title' }), true, 'Metadata changes preserve heart');
exports.toggleTrackLike(a); // unlike while the first like is still in flight
exports.toggleTrackLike(a); // re-like before that same request completes
writes.shift().resolve();
await settle();
assert.equal(writes.length, 1, 'Newer re-like is not erased with the completed old like');
assert.equal(writes[0].liked, true);
writes.shift().resolve();
await settle();
assert.equal(JSON.parse(storage.get('lomifynext_likes_sync')).ymQueue.add.length, 0);
const sync = exports.syncLikes({ only: 'yandex', silent: true });
await settle();
const b = { id: '43', source: 'yandex', title: 'Other', artist: 'Artist' };
exports.toggleTrackLike(b);
await settle();
writes.shift().resolve();
await settle(); // Write completes before the older read.
read({ complete: true, tracks: [] });
await sync;
assert.equal(exports.isTrackLiked(get(likedTracks), b), true, 'Stale read cannot remove a newer successful like');
exports.toggleTrackLike(b);
await settle();
exports.toggleTrackLike({ ...b, id: '44', title: 'Third' });
writes.shift().resolve();
await settle();
assert.equal(writes.length, 1, 'A different track added in flight is drained immediately');
writes.shift().resolve();
await settle();
console.log('PASS likes: compound IDs, metadata identity, rapid re-like, stale sync and edits arriving during writes');
