import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { writable, derived, get } from 'svelte/store';

const source = readFileSync(new URL('../src/lib/mobileUpdateCore.ts', import.meta.url), 'utf8');
function compileCore(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, Error, Math, Number, String });
  return exports;
}
const core = compileCore(source);
// Exact snapshot from released iOS 1.0.27 (commit de91a280), not a copy of
// today's selector: a release must also reach apps that have not upgraded yet.
const legacyCore = compileCore(readFileSync(new URL('./fixtures/mobile-update-core-1.0.27.ts', import.meta.url), 'utf8'));

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
const combined29 = { ...makeRelease('v1.0.29', ['LomifyNEXT-1.0.29-arm64.apk', 'LomifyNEXT-1.0.29.ipa']), prerelease: true };
assert.equal(core.findLatestIOSRelease([ios25, combined29]), combined29.html_url,
  'The common release contains the latest installable iOS version');
assert.equal(core.findAndroidUpdate([ios25, combined29], '1.0.28')?.version, '1.0.29');
assert.equal(core.findLatestIOSRelease([{ ...combined29, assets: combined29.assets.slice(0, 1) }, ios25]), ios25.html_url,
  'A combined release without its IPA must not hide a working iOS download');
assert.equal(legacyCore.findLatestIOSRelease([combined29, ios25]), ios25.html_url,
  'Reproduce the installed app bug: old iOS cannot see a plain v-prefixed common release');
const { version: releaseVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const compatibleCommon = makeRelease(`ios-v${releaseVersion}`, [
  `LomifyNEXT-${releaseVersion}-arm64.apk`, `LomifyNEXT-${releaseVersion}.ipa`
]);
for (const selector of [core, legacyCore]) {
  assert.equal(selector.findLatestIOSRelease([compatibleCommon, combined29, ios25]), compatibleCommon.html_url,
    'One common release with an ios-v tag must be discoverable by installed old and new iOS apps');
  assert.equal(selector.findAndroidUpdate([compatibleCommon, combined29], '1.0.16')?.apkUrl,
    compatibleCommon.assets[0].browser_download_url,
    'The same common release must offer Android its APK regardless of the tag prefix');
}
assert.equal(legacyCore.findLatestIOSRelease([{ ...compatibleCommon, assets: compatibleCommon.assets.slice(0, 1) }, ios25]), ios25.html_url,
  'A common release must not be published without the IPA needed by old installations');
console.log('PASS iOS release selection: IPA only, beta releases, version ordering, drafts, missing IPA and expected repository');
console.log('PASS common release compatibility with the actual iOS 1.0.27 selector and Android');

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
    'svelte/store': { writable, derived },
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


assert.equal(core.findIOSUpdate([ios25, android99], '1.0.24')?.version, '1.0.25');
assert.equal(core.findIOSUpdate([ios25], '1.0.25'), null, 'Equal installed IPA is not an update');
assert.equal(core.findIOSUpdate([ios25], '1.0.26'), null, 'Never offer an older IPA');
assert.equal(core.findIOSUpdate([ios25], 'invalid'), null);
assert.equal(core.mobileUpdateLink({ ...core.findIOSUpdate([ios25], '1.0.24'), platform: 'ios' }), ios25.html_url);
assert.equal(core.mobileUpdateLink({ ...found, platform: 'android' }), newer.assets[0].browser_download_url);

const updaterSource = ts.transpileModule(readFileSync(new URL('../src/lib/mobileUpdates.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function boot(platform, storage = new Map(), installed = '1.0.24') {
  const exports = {};
  let calls = 0, releases = [ios25, makeRelease('ios-v1.0.25', ['LomifyNEXT-1.0.25-arm64.apk'])], failure = null, gate = null;
  vm.runInNewContext(updaterSource, {
    exports, navigator: { userAgent: platform === 'ios' ? 'iPhone' : platform === 'ipad' ? 'Macintosh' : platform === 'android' ? 'Android' : 'Macintosh', maxTouchPoints: platform === 'ipad' ? 5 : 0 },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { __TAURI_INTERNALS__: {} }, AbortController, setTimeout, clearTimeout, Error,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, platform === 'android' ? core.MOBILE_RELEASES_API : core.MOBILE_IOS_RELEASES_API);
      assert.equal(options.cache, 'no-store');
      if (gate) await gate;
      if (failure) throw failure;
      return { ok: true, json: async () => releases };
    },
    require: name => ({
      'svelte/store': { writable, derived }, '@tauri-apps/api/app': { getVersion: async () => installed },
      '@tauri-apps/plugin-opener': { openUrl: async url => opened.push(url) },
      './version': { APP_PACKAGE_VERSION: '1.0.24' }, './mobileUpdateCore': core
    }[name])
  });
  return { updater: exports, calls: () => calls, state: () => get(exports.mobileUpdateState), reminder: () => get(exports.mobileUpdateReminder),
    setReleases: value => releases = value, fail: value => failure = value, gate: value => gate = value };
}
for (const platform of ['ios', 'android', 'ipad']) {
  const storage = new Map();
  const app = boot(platform, storage);
  await app.updater.checkMobileUpdate(true);
  assert.equal(app.state().status, 'available');
  assert.equal(app.state().update.platform, platform === 'ipad' ? 'ios' : platform);
  assert.equal(app.reminder()?.version, '1.0.25');
  app.updater.dismissMobileUpdate('1.0.25');
  await app.updater.checkMobileUpdate();
  assert.equal(app.calls(), 1, 'Foreground checks use fresh cache');
  assert.equal(app.reminder(), null, 'No repeat after Later or returning from the browser');
  const restarted = boot(platform, storage);
  await restarted.updater.checkMobileUpdate(true);
  assert.equal(restarted.calls(), 1, 'Cold launch always checks live releases, even with fresh cache');
  assert.equal(restarted.reminder()?.version, '1.0.25', 'Later expires at the next cold launch');
  app.setReleases([makeRelease('ios-v1.0.26', ['LomifyNEXT-1.0.26-arm64.apk', 'LomifyNEXT-1.0.26.ipa'])]);
  await app.updater.checkMobileUpdate(true);
  assert.equal(app.reminder()?.version, '1.0.26', 'Dismissal of one version does not hide another');
  app.setReleases([ios24]);
  await app.updater.checkMobileUpdate(true);
  assert.equal(app.state().status, 'current');
  assert.equal(app.reminder(), null, 'No reminder if no newer platform build exists');
  app.fail(new Error('Offline'));
  await app.updater.checkMobileUpdate(true);
  assert.equal(app.state().status, 'error');
  assert.equal(app.reminder(), null, 'Offline checks are quiet at launch');
  assert.equal(app.state().message, 'Offline', 'Manual checks can show the error in Settings');
}
const current = boot('ios', new Map(), '1.0.25');
await current.updater.checkMobileUpdate(true);
assert.equal(current.reminder(), null, 'Compare against native installed version');
const overlapping = boot('android');
let resume;
overlapping.gate(new Promise(resolve => resume = resolve));
const checkA = overlapping.updater.checkMobileUpdate(true);
const checkB = overlapping.updater.checkMobileUpdate(true);
await new Promise(resolve => setImmediate(resolve));
assert.equal(overlapping.calls(), 1, 'Launch and foreground checks coalesce into one request');
resume();
await Promise.all([checkA, checkB]);
assert.equal(overlapping.reminder()?.version, '1.0.25');
const unsupported = boot('desktop');
await unsupported.updater.checkMobileUpdate(true);
assert.equal(unsupported.calls(), 0, 'Mobile notices do not change desktop behavior');
const cached = new Map();
const cachedApp = boot('ios', cached);
await cachedApp.updater.checkMobileUpdate(true);
const cachedKey = 'lomifynext_mobile_update_check';
const tampered = JSON.parse(cached.get(cachedKey));
tampered.update.ipaUrl = 'https://example.com/malicious.ipa';
cached.set(cachedKey, JSON.stringify(tampered));
const restored = boot('ios', cached);
await restored.updater.checkMobileUpdate();
assert.equal(restored.calls(), 1, 'Do not restore an untrusted cached download');
console.log('PASS launch reminders on iPhone, iPad and Android: native version, equal/older builds, live launch, cached resume, dismissal/restart, offline, coalescing and trusted URLs');
