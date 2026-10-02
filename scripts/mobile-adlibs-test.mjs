import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, URL, require: name => { assert(name in imports, name); return imports[name]; } });
  return exports;
}
const { extractAdlibs, buildAdlibTimeline, activeAdlibAt } = load('../src/lib/lyricAdlibs.ts');
const source = [
  { time: 10, text: 'Ты выглядишь на больших плакатах (ooh)' },
  { time: 12, text: 'Новая строка' },
  { time: 16, text: '(yeah) Ещё одна строка' }
].map(line => ({ ...line, ...extractAdlibs(line.text) }));
const cues = buildAdlibTimeline(source, (_text, gap) => gap);
assert.equal(cues.length, 2);
assert(cues[0].start < 12, 'Suffix must not acquire an arbitrary 750ms delay');
assert.equal(activeAdlibAt(cues, 12.2)?.text, 'ooh', 'A new main lyric line must not erase the previous adlib');
assert.equal(activeAdlibAt(cues, 9), null, 'Seeking backward clears a future cue');
assert.equal(activeAdlibAt(cues, 15), null, 'Expired cue must not remain visible');
assert.equal(cues[1].start, 16, 'A prefix starts with its timestamp, not 750ms later');
assert.equal(activeAdlibAt(cues, 16)?.text, 'yeah');
const precise = extractAdlibs('Слова (<00:20.25>ooh)');
assert.equal(precise.mainText, 'Слова');
assert.equal(precise.adlibs[0].time, 20.25);
assert.equal(buildAdlibTimeline([{ time: 19, text: 'Слова (ooh)', ...precise }], () => 3)[0].start, 20.25);
assert.equal(extractAdlibs('Строка () без эдлиба').adlibs.length, 0);
assert.equal(activeAdlibAt(cues, NaN), null);

const covers = load('../src/lib/offlineCovers.ts', {
  '@tauri-apps/api/core': {}, 'svelte/store': { writable: value => value }, '$lib/utils/trackUrn': {}
});
const url = 'https://avatars.yandex.net/get-music-content/123/test/400x400';
assert.equal(covers.coverUrlAtSize(url, 240), url, 'Featured cover uses an existing CDN preset');
assert.equal(covers.coverUrlAtSize(url, 120), url.replace('400x400', '200x200'));
assert.equal(covers.coverUrlAtSize('https://example.com/local.jpg', 240), 'https://example.com/local.jpg');
const image = { src: url.replace('400x400', '200x200'), dataset: {}, hidden: false };
covers.handleArtworkError({ currentTarget: image }, url, 120);
assert.equal(image.src, url, 'Failed resized cover retries the original URL once');
covers.handleArtworkError({ currentTarget: image }, url, 120);
assert.equal(image.hidden, true, 'A failed original reveals the fallback instead of a broken image');
covers.handleArtworkLoad({ currentTarget: image });
assert.equal(image.hidden, false);
console.log('PASS adlibs: line boundary, prefix, enhanced LRC, seek and expiry; covers: CDN presets and bounded fallback');
