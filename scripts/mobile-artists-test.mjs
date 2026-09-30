// Saved-artist persistence tests with isolated storage. No accounts or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { get, writable } from 'svelte/store';

const key = 'lomifynext_mobile_artists';
const source = readFileSync(new URL('../src/lib/mobileArtists.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const memory = new Map();
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
function load(localStorage = storage) {
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: id => { assert.equal(id, 'svelte/store'); return { get, writable }; }, localStorage });
  return exports;
}
let artists = load();
assert.equal(artists.toggleMobileArtist('  Тихий берег  ', 'https://example.com/avatar.jpg'), true);
assert.equal(get(artists.mobileSavedArtists)[0].name, 'Тихий берег');
artists = load();
artists.loadMobileArtists();
assert.equal(get(artists.mobileSavedArtists)[0].avatarUrl, 'https://example.com/avatar.jpg', 'saved artist survives a new session');
assert.equal(artists.toggleMobileArtist('ТИХИЙ БЕРЕГ'), false, 'same artist is removed despite whitespace/case differences');
assert.equal(JSON.parse(memory.get(key)).length, 0);
assert.equal(artists.toggleMobileArtist('   '), false);

memory.set(key, JSON.stringify([null, { name: 1 }, { name: 'Ａrtist', avatarUrl: 42 }, { name: 'Artist' }, { name: ' ' }]));
artists = load(); artists.loadMobileArtists();
assert.equal(get(artists.mobileSavedArtists).length, 1, 'Unicode variants and invalid records do not duplicate artists');
assert.equal(get(artists.mobileSavedArtists)[0].avatarUrl, '');
memory.set(key, '{damaged');
artists = load(); artists.loadMobileArtists();
assert.equal(get(artists.mobileSavedArtists).length, 0);
assert.equal(artists.toggleMobileArtist('Recovered'), true, 'collection remains usable after corrupt storage');

const unavailable = load({ getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } });
assert.equal(unavailable.toggleMobileArtist('Offline'), true);
assert.equal(get(unavailable.mobileSavedArtists).length, 1, 'unavailable persistence does not break in-memory controls');
assert.equal(unavailable.toggleMobileArtist('Offline'), false);
for (let index = 0; index < 210; index++) unavailable.toggleMobileArtist(`Artist ${index}`);
assert.equal(get(unavailable.mobileSavedArtists).length, 200, 'collection has a bounded size');
console.log('PASS saved artists: reload, removal, validation, Unicode deduplication, damaged storage and size limit');
