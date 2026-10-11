// Isolated download-queue regression: no files, accounts, or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { get, writable } from 'svelte/store';

const source = readFileSync(new URL('../src/lib/mobileDownloads.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const holds = [];
const events = [];
const storage = new Map();
const cachedUrns = writable({ cachedUrns: new Set() });
const notices = [];
const resolutions = [];
let storageFull = false;
const deps = {
  '@tauri-apps/api/core': { invoke: async (name, args) => {
    if (name === 'track_list_cached') return [];
    if (name === 'track_ensure_cached') return new Promise((resolve, reject) => holds.push({ request: args.request, resolve, reject }));
    if (name === 'track_remove_cached') return true;
    if (name === 'track_is_cached') return false;
    throw new Error(`Unexpected command ${name}`);
  } },
  '@tauri-apps/api/event': { listen: async () => () => {} },
  'svelte/store': { get, writable },
  './api': { getAudioUrl: async (_track, opts) => { assert.equal(opts.fullTrackRequired, true); resolutions.push(opts); return opts.fresh ? 'https://example.invalid/fresh' : 'https://example.invalid/audio'; } },
  './stores': { notify: (...args) => notices.push(args) },
  './utils/trackUrn': { buildTrackUrn: track => `lomify:${track.source}:${track.id}` },
  './offlineCovers': { downloadedCoverCache: cachedUrns }
};
const exports = {};
vm.runInNewContext(compiled, {
  exports, require: id => { assert(id in deps, `Unexpected import ${id}`); return deps[id]; },
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (storageFull) throw new Error('QuotaExceeded'); storage.set(key, value); } },
  window: { dispatchEvent: event => events.push(event.detail) },
  CustomEvent: class { constructor(_type, init) { this.detail = init.detail; } },
  console, Set, Map
});
const one = { id: '1', source: 'soundcloud', title: 'One', artist: 'Artist', streamUrl: 'never-save-this' };
const two = { id: '2', source: 'soundcloud', title: 'Two', artist: 'Artist' };
exports.queueMobileDownloads([one, one, two]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(holds.length, 1, 'second transfer waits for first');
holds.shift().resolve({ path: '/cache/one' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(holds.length, 1, 'second transfer starts after first');
assert.equal(get(exports.mobileDownloads).length, 1);
assert(!storage.get('lomifynext_mobile_downloads').includes('never-save-this'));
holds.shift().resolve({ path: '/cache/two' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(get(exports.mobileDownloads).length, 2);
assert.deepEqual(events.map(event => event.cached), [true, true]);
await exports.removeMobileDownload(one);
assert.equal(get(exports.mobileDownloads).length, 1);
assert.equal(events.at(-1).cached, false);
assert.equal(notices.at(-1)[1], 'info');
console.log('PASS serial downloads, deduplication, private metadata, removal');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const three = { id: '3', source: 'yandex', title: 'Three', artist: 'Artist' };
exports.queueMobileDownloads([three]);
await settle();
holds.shift().reject('HTTP 403 expired signature');
await settle();
assert.equal(holds.length, 1);
assert.equal(holds[0].request.url, 'https://example.invalid/fresh');
assert.equal(resolutions.at(-1).fresh, true);
storageFull = true;
holds.shift().resolve({ path: '/cache/three' });
await settle();
assert.equal(get(exports.mobileDownloads).length, 2, 'Cached audio remains successful if metadata persistence is full');
assert.equal(get(exports.mobileDownloadJobs)['lomify:yandex:3'], undefined);
const four = { ...three, id: '4' }, five = { ...three, id: '5' };
exports.queueMobileDownloads([four, five]);
await settle();
holds.shift().reject('Cache write failed: No space left on device (os error 28)');
await settle();
assert.equal(get(exports.mobileDownloadJobs)['lomify:yandex:4'].error, 'Недостаточно места на устройстве.');
assert.equal(holds.length, 1, 'Permanent error does not retry and next track still starts');
assert.equal(holds[0].request.urn, 'lomify:yandex:5');
holds.shift().resolve({ path: '/cache/five' });
await settle();
console.log('PASS fresh signed-URL retry, full localStorage, disk error and queue continuation');
