import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/mobileUpdateCore.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const core = {};
vm.runInNewContext(outputText, { exports: core, URL, Error, Math, Number, String });

const makeRelease = (tag, names) => ({
  tag_name: tag, draft: false, prerelease: tag.includes('beta'), html_url: `https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/tag/${tag}`,
  body: 'Test release',
  assets: names.map(name => ({ name, browser_download_url: `https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/download/${tag}/${name}` }))
});

assert.equal(core.compareMobileVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
assert.equal(core.compareMobileVersions('1.0.0', '1.0.0-beta.2'), 1);
assert.equal(core.compareMobileVersions('1.0.0-beta.1', '1.0.0-beta.1'), 0);
assert.equal(core.compareMobileVersions('1.0.0-alpha.4', '1.0.0-beta.1'), -1);
assert.equal(core.compareMobileVersions('1.0.2', '1.0.0-beta.2'), 1);

const mislabeled = makeRelease('v1.0.0', ['LomifyNEXT-1.0.0-beta.1-arm64.apk']);
assert.equal(core.findAndroidUpdate([mislabeled], '1.0.0-beta.1'), null, 'release tag is not APK version');
assert.equal(core.findAndroidUpdate([mislabeled], '1.0.0-beta.2'), null, 'older APK is not an update');

const newer = makeRelease('v1.0.0-beta.3', ['LomifyNEXT-1.0.0-beta.3-arm64.apk']);
const found = core.findAndroidUpdate([mislabeled, newer], '1.0.0-beta.2');
assert.equal(found?.version, '1.0.0-beta.3');
assert.equal(found?.apkUrl, newer.assets[0].browser_download_url);
const release102 = makeRelease('v1.0.2', ['LomifyNEXT-1.0.2-arm64.apk']);
assert.equal(core.findAndroidUpdate([release102], '1.0.0-beta.2')?.version, '1.0.2');
assert.equal(core.findAndroidUpdate([release102], '1.0.2'), null);

const otherKey28 = makeRelease('android-v1.0.28', ['LomifyNEXT-1.0.28-arm64-test.apk']);
otherKey28.prerelease = true;
assert.equal(core.findAndroidUpdate([otherKey28], '1.0.16'), null,
  'An APK with the separate Mac test signature must not be offered to old installations');
const normal28 = makeRelease('android-v1.0.28', ['LomifyNEXT-1.0.28-arm64.apk']);
normal28.prerelease = true;
assert.equal(core.findAndroidUpdate([normal28], '1.0.16')?.version, '1.0.28',
  'Prerelease alone does not exclude an APK: its installable asset name decides');
const bothSignatures28 = makeRelease('android-v1.0.28', [
  'LomifyNEXT-1.0.28-arm64-test.apk', 'LomifyNEXT-1.0.28-arm64.apk'
]);
assert.equal(core.findAndroidUpdate([bothSignatures28], '1.0.16')?.apkUrl,
  bothSignatures28.assets[1].browser_download_url,
  'When both signatures are published, select only the APK compatible with old installations');

const bad = makeRelease('v2.0.0', ['LomifyNEXT-2.0.0-arm64.apk']);
bad.assets[0].browser_download_url = 'https://example.com/malicious.apk';
assert.equal(core.findAndroidUpdate([bad], '1.0.0-beta.2'), null, 'unexpected download host is rejected');
bad.assets[0].browser_download_url = 'http://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/download/v2.0.0/LomifyNEXT-2.0.0-arm64.apk';
assert.equal(core.findAndroidUpdate([bad], '1.0.0-beta.2'), null, 'non-TLS download is rejected');

console.log('PASS Android release selection, version ordering and download URL checks');

const ios24 = { ...makeRelease('ios-v1.0.24', ['LomifyNEXT-1.0.24.ipa']), prerelease: true };
const ios25 = { ...makeRelease('ios-v1.0.25', ['LomifyNEXT-1.0.25.ipa']), prerelease: true };
const android99 = makeRelease('v9.0.0', ['LomifyNEXT-9.0.0-arm64.apk']);
assert.equal(core.findLatestIOSRelease([android99, ios24, ios25]), ios25.html_url, 'Select the latest IPA even when Android is latest and iOS is a prerelease');
assert.equal(core.findLatestIOSRelease([{ ...ios25, draft: true }, ios24]), ios24.html_url, 'Do not open drafts');
assert.equal(core.findLatestIOSRelease([{ ...ios25, assets: [] }, ios24]), ios24.html_url, 'A release without an uploaded IPA is not installable');
assert.equal(core.findLatestIOSRelease([{ ...ios25, html_url: 'https://example.com/' }, ios24]), ios24.html_url);
assert.equal(core.findLatestIOSRelease([{ ...ios25, assets: [{ ...ios25.assets[0], browser_download_url: 'https://example.com/app.ipa' }] }]), null);
assert.equal(core.findLatestIOSRelease([]), null);
console.log('PASS iOS release selection: IPA only, beta releases, version ordering, drafts, missing IPA and expected repository');

const opened = [];
let response = { ok: true, json: async () => [android99, ios24, ios25] };
const updater = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mobileUpdates.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, {
  exports: updater, window: { __TAURI_INTERNALS__: {} }, AbortController, setTimeout, clearTimeout, Error,
  fetch: async (url, options) => {
    assert.equal(url, core.MOBILE_IOS_RELEASES_API);
    assert.equal(options.cache, 'no-store');
    return response;
  },
  require: name => ({
    'svelte/store': { writable: value => ({ value }) },
    '@tauri-apps/api/app': {}, '@tauri-apps/plugin-opener': { openUrl: async url => opened.push(url) },
    './version': { APP_PACKAGE_VERSION: '1.0.25' }, './mobileUpdateCore': core
  }[name])
});
await updater.openLatestIOSRelease();
assert.deepEqual(opened, [ios25.html_url], 'Use the native browser opener with the resolved iOS release');
response = { ok: false, status: 403 };
await assert.rejects(updater.openLatestIOSRelease(), /GitHub временно ограничил/);
response = { ok: true, json: async () => ({ error: 'bad response' }) };
await assert.rejects(updater.openLatestIOSRelease(), /неожиданный ответ/);
assert.equal(opened.length, 1, 'Failed checks do not navigate to Android or an unknown URL');
console.log('PASS iOS check: uncached request, native opener, API limit and invalid response handling');
