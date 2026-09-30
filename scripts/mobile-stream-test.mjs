// Signed-link reuse and forced refresh; fake transport only, no real account/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { get, writable } from 'svelte/store';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/yandex.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const settings = writable({ mobileDataSaver: false });
const calls = [];
const exports = {};
let clock = Date.now();
class Clock extends Date { static now() { return clock; } }
vm.runInNewContext(outputText, {
  exports, URL, URLSearchParams, crypto: webcrypto, TextEncoder, Uint8Array, Date: Clock,
  btoa: text => Buffer.from(text, 'binary').toString('base64'), console,
  window: { __TAURI_INTERNALS__: {} },
  require: id => {
    if (id === 'svelte/store') return { get };
    if (id === './stores') return { settings };
    if (id === './mobile') return { isMobile: true };
    if (id === 'md5') return { default: () => 'fake-signature' };
    if (id === '@tauri-apps/plugin-http') return { fetch: async url => {
      calls.push(url);
      let result;
      if (url.includes('get-file-info')) result = { downloadInfo: { urls: [`https://audio.example/${calls.length}.mp3`] } };
      else if (url.includes('download-info')) result = [{ codec: 'mp3', bitrateInKbps: 192, downloadInfoUrl: 'https://info.example/high' }, { codec: 'mp3', bitrateInKbps: 64, downloadInfoUrl: 'https://info.example/low' }];
      else return { ok: true, status: 200, text: async () => '<host>audio.example</host><path>/low.mp3</path><ts>1</ts><s>test</s>' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ result }) };
    } };
    throw new Error(`Unexpected dependency ${id}`);
  }
});
const [a, b] = await Promise.all([exports.getYandexStreamUrl('fake-token-a', '42'), exports.getYandexStreamUrl('fake-token-a', '42')]);
assert.equal(a, b);
assert.equal(calls.length, 1, 'concurrent resolve and preload share one request');
assert.equal(await exports.getYandexStreamUrl('fake-token-a', '42'), a);
assert.equal(calls.length, 1, 'recent signed URL is reused');
assert.notEqual(await exports.getYandexStreamUrl('fake-token-a', '42', { fresh: true }), a);
assert.equal(calls.length, 2, 'CDN failure forces a new request');
await exports.getYandexStreamUrl('fake-token-b', '42');
assert.equal(calls.length, 3, 'accounts never share signed links');
clock += 91_000;
await exports.getYandexStreamUrl('fake-token-a', '42');
assert.equal(calls.length, 4, 'expired links are not reused');
settings.set({ mobileDataSaver: true });
const saverUrl = await exports.getYandexStreamUrl('fake-token-a', '42');
assert(calls[4].includes('/download-info'), 'data saver actually selects legacy bitrate variants');
assert.equal(calls[5], 'https://info.example/low');
assert(saverUrl.includes('/get-mp3/'), 'selected low-bitrate variant resolves successfully');
assert.equal(calls.length, 6, 'successful low-bitrate resolution does not fall back to another route');
console.log('PASS concurrent link reuse, forced refresh, account isolation, expiry and data saver bitrate');
