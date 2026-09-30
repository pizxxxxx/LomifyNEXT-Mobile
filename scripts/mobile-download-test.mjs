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
const deps = {
  '@tauri-apps/api/core': { invoke: async (name, args) => {
    if (name === 'track_list_cached') return [];
    if (name === 'track_ensure_cached') return new Promise(resolve => holds.push({ request: args.request, resolve }));
    if (name === 'track_remove_cached') return true;
    if (name === 'track_is_cached') return false;
    throw new Error(`Unexpected command ${name}`);
  } },
  '@tauri-apps/api/event': { listen: async () => () => {} },
  'svelte/store': { get, writable },
  './api': { getAudioUrl: async (_track, opts) => { assert.equal(opts.fullTrackRequired, true); return 'https://example.invalid/audio'; } },
  './stores': { notify: (...args) => notices.push(args) },
  './utils/trackUrn': { buildTrackUrn: track => `lomify:${track.source}:${track.id}` },
  './offlineCovers': { downloadedCoverCache: cachedUrns }
};
const exports = {};
vm.runInNewContext(compiled, {
  exports, require: id => { assert(id in deps, `Unexpected import ${id}`); return deps[id]; },
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
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
