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
  draft: false, prerelease: tag.includes('beta'), html_url: `https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/tag/${tag}`,
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

const bad = makeRelease('v2.0.0', ['LomifyNEXT-2.0.0-arm64.apk']);
bad.assets[0].browser_download_url = 'https://example.com/malicious.apk';
assert.equal(core.findAndroidUpdate([bad], '1.0.0-beta.2'), null, 'unexpected download host is rejected');
bad.assets[0].browser_download_url = 'http://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/download/v2.0.0/LomifyNEXT-2.0.0-arm64.apk';
assert.equal(core.findAndroidUpdate([bad], '1.0.0-beta.2'), null, 'non-TLS download is rejected');

console.log('PASS Android release selection, version ordering and download URL checks');
