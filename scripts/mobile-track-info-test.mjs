import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
let calls = 0;
let raw = { genre: 'Indie', playback_count: 0, likes_count: 12, duration: 185000, created_at: '2026-09-24' };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mobileTrackInfo.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
{ exports, require: name => name === '$lib/api' ? { getTrackInfo: async () => { calls++; return raw; } }
  : { getYandexTrackMetadata: async () => { calls++; return { source: 'yandex', genre: 'rock', playbackCount: null }; } } });
const sc = { source: 'soundcloud', id: 123, title: 'A', artist: 'B' };
let metadata = await exports.loadMobileTrackInfo(sc, '');
let rows = exports.mobileTrackInfoRows(metadata);
assert.equal(rows.find(row => row.label === 'Прослушиваний в SoundCloud').value, '0', 'A reported zero is valid');
assert.equal(rows.find(row => row.label === 'Длительность').value, '3:05');
assert.ok(rows.some(row => row.label === 'Опубликован'));
rows = exports.mobileTrackInfoRows({ source: 'yandex', releaseDate: '2020-01-01', releaseDatePrecision: 'year', playbackCount: null, genre: 'rock', genres: ['rock', 'pop'] });
assert.ok(!rows.some(row => /прослушиваний/i.test(row.label)), 'Unknown totals must not become zero');
assert.equal(rows.find(row => row.label === 'Дата выпуска').value, '2020', 'A release year must not invent a day');
assert.equal(rows.find(row => row.label === 'Жанры').value, 'rock, pop');
rows = exports.mobileTrackInfoRows(sc, { 'A-B': { count: 4, source: 'yandex', id: 123 } });
assert.ok(!rows.some(row => row.label === 'Твои прослушивания в Lomify'), 'Same title from another source must not inherit personal counts');
rows = exports.mobileTrackInfoRows(sc, { 'A-B': { count: 4, source: 'soundcloud', id: '123' } });
assert.equal(rows.find(row => row.label === 'Твои прослушивания в Lomify').value, '4');
await exports.loadMobileTrackInfo({ ...sc, isLocal: true }, '');
await exports.loadMobileTrackInfo({ source: 'yandex', id: 123 }, '');
assert.equal(calls, 1, 'Local files and disconnected Yandex must not make requests');
raw = null;
await assert.rejects(() => exports.loadMobileTrackInfo(sc, ''), /Metadata unavailable/);
assert.doesNotThrow(() => exports.mobileTrackInfoRows({ source: 'soundcloud', genre: null, duration: NaN, releaseDate: 'invalid', playbackCount: NaN }));
console.log('PASS track information: unknown/zero counts, source isolation, date precision, duration, missing metadata and on-demand requests');
