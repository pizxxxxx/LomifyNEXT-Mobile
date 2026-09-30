// Pure metadata tests; no account token, app data or network requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/yandex.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const exports = {};
vm.runInNewContext(outputText, {
  exports,
  URL,
  console,
  require: id => {
    if (id === '@tauri-apps/plugin-http') return { fetch() { throw new Error('Network was not expected'); } };
    if (id === 'md5') return () => '';
    if (id === 'svelte/store') return { get() { return {}; } };
    if (id === './stores') return { settings: {} };
    if (id === './mobile') return { isMobile: true };
    throw new Error(`Unexpected import: ${id}`);
  }
});

const video = 'https://video-preview.s3.yandex.net/vh/sample_vmaf-preview-480.mp4';
assert.equal(exports.normalizeYandexBackgroundVideoUrl(video), video);
assert.equal(exports.normalizeYandexBackgroundVideoUrl('http://video-preview.s3.yandex.net/a.mp4'), '');
assert.equal(exports.normalizeYandexBackgroundVideoUrl('https://video-preview.s3.yandex.net.evil.example/a.mp4'), '');
assert.equal(exports.normalizeYandexBackgroundVideoUrl('https://user:pass@video-preview.s3.yandex.net/a.mp4'), '');
assert.equal(exports.mapYandexTrack({ id: 42, title: 'Test', artists: [{ name: 'Artist' }], backgroundVideoUri: video }).backgroundVideoUrl, video);
assert.equal(exports.mapYandexTrack({ id: 43, title: 'Test', cover: { videoUrl: video } }).backgroundVideoUrl, video);
assert.equal(exports.mapYandexTrack({ id: 44, title: 'Test' }).backgroundVideoUrl, '');
console.log('PASS Yandex moving artwork mapping and URL validation');
