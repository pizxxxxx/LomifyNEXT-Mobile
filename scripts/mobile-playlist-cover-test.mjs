// Offline persistence regression for custom playlist covers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { get, writable } from 'svelte/store';

const records = new Map();
const liveUrls = new Map();
let nextUrl = 0;
const urlApi = {
  createObjectURL(blob) {
    const url = `blob:test-${++nextUrl}`;
    liveUrls.set(url, blob);
    return url;
  },
  revokeObjectURL(url) { liveUrls.delete(url); }
};
const database = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction() {
    const transaction = {
      objectStore() {
        return {
          getAll() {
            const request = { result: [...records.values()] };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put(record) {
            queueMicrotask(() => { records.set(record.id, record); transaction.oncomplete?.(); });
          },
          delete(id) {
            queueMicrotask(() => { records.delete(id); transaction.oncomplete?.(); });
          }
        };
      }
    };
    return transaction;
  }
};
const indexedDB = {
  open() {
    const request = { result: database };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }
};

function loadCoverModule() {
  const source = readFileSync(new URL('../src/lib/mobilePlaylistCovers.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, require: id => {
      assert.equal(id, 'svelte/store');
      return { writable };
    },
    indexedDB, URL: urlApi, Blob, Promise, console
  });
  return exports;
}

const covers = loadCoverModule();
await covers.loadMobilePlaylistCovers();
assert.deepEqual(Object.keys(get(covers.mobilePlaylistCoverUrls)), []);
const first = new Blob(['first'], { type: 'image/jpeg' });
await covers.setMobilePlaylistCover('mobile_1', first);
const firstUrl = get(covers.mobilePlaylistCoverUrls).mobile_1;
assert.equal(liveUrls.get(firstUrl), first);
assert.equal(records.get('mobile_1').blob, first);

const replacement = new Blob(['replacement'], { type: 'image/jpeg' });
await covers.setMobilePlaylistCover('mobile_1', replacement);
assert.equal(liveUrls.has(firstUrl), false, 'replaced image URL is released');
assert.equal(records.get('mobile_1').blob, replacement);

const restored = loadCoverModule();
await restored.loadMobilePlaylistCovers();
assert.equal(liveUrls.get(get(restored.mobilePlaylistCoverUrls).mobile_1), replacement, 'image survives module reload');
await restored.removeMobilePlaylistCover('mobile_1');
assert.equal(records.has('mobile_1'), false, 'deleted playlist image is removed from IndexedDB');
assert.equal(get(restored.mobilePlaylistCoverUrls).mobile_1, undefined);
console.log('PASS playlist cover save, replacement, reload and removal');
