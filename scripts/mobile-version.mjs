// One visible version for each delivered iteration, shared by Android and iOS.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('package.json'));
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const lock = JSON.parse(read('package-lock.json'));
const current = manifest.version;
const requested = process.argv[2];
const checkOnly = requested === '--check';
const parse = value => {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected x.y.z version: ${value}`);
  return value.split('.').map(Number);
};
const parts = parse(current);
const next = checkOnly ? current : requested || `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const nextParts = parse(next);
const firstDifference = nextParts.findIndex((value, index) => value !== parts[index]);
if (!checkOnly && (firstDifference < 0 || nextParts[firstDifference] < parts[firstDifference])) {
  throw new Error(`New version must be above ${current}`);
}
for (const value of [config.version, lock.version, lock.packages[''].version]) {
  if (value !== current) throw new Error('Version metadata disagrees; correct it before incrementing.');
}
const android = config.bundle.android.versionCode + (checkOnly ? 0 : 1);
const ios = Number(config.bundle.iOS.bundleVersion) + (checkOnly ? 0 : 1);
if (!Number.isSafeInteger(android) || !Number.isSafeInteger(ios)) throw new Error('Invalid build number');
const changes = new Map();
function replace(path, pattern, oldValue, newValue, optional = false) {
  if (optional && !existsSync(join(root, path))) return;
  const source = changes.get(path) || read(path);
  let matches = 0;
  const updated = source.replace(pattern, (_, prefix, value, suffix) => {
    matches++;
    if (value !== String(oldValue)) throw new Error(`Unexpected version in ${path}: ${value}`);
    return prefix + newValue + (typeof suffix === 'string' ? suffix : '');
  });
  if (matches !== 1) throw new Error(`Expected one version field in ${path}, found ${matches}`);
  changes.set(path, updated);
}
replace('src-tauri/Cargo.toml', /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m, current, next);
replace('src-tauri/Cargo.lock', /(\[\[package\]\]\nname = "lomifynext-tauri"\nversion = ")([^"]+)(")/, current, next);
replace('src/lib/version.ts', /(APP_VERSION = ')([^']+)(')/, current, next);
replace('src/lib/version.ts', /(APP_PACKAGE_VERSION = ')([^']+)(')/, current, next);
replace('src-tauri/gen/apple/project.yml', /(CFBundleShortVersionString: )([^\s]+)/, current, next, true);
replace('src-tauri/gen/apple/project.yml', /(CFBundleVersion: ")([^"\s]+)(")/, config.bundle.iOS.bundleVersion, ios, true);
replace('src-tauri/gen/apple/lomifynext-tauri_iOS/Info.plist', /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/, current, next, true);
replace('src-tauri/gen/apple/lomifynext-tauri_iOS/Info.plist', /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/, config.bundle.iOS.bundleVersion, ios, true);
replace('src-tauri/gen/android/app/tauri.properties', /(tauri.android.versionName=)([^\s]+)/, current, next, true);
replace('src-tauri/gen/android/app/tauri.properties', /(tauri.android.versionCode=)([^\s]+)/, config.bundle.android.versionCode, android, true);
if (!checkOnly) {
  manifest.version = config.version = lock.version = lock.packages[''].version = next;
  config.bundle.android.versionCode = android;
  config.bundle.iOS.bundleVersion = String(ios);
  changes.set('package.json', JSON.stringify(manifest, null, 2) + '\n');
  changes.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  changes.set('src-tauri/tauri.conf.json', JSON.stringify(config, null, 2) + '\n');
  for (const [path, contents] of changes) writeFileSync(join(root, path), contents);
}
console.log(`${checkOnly ? 'Verified' : 'Updated'} ${next}; Android ${android}; iOS ${ios}`);
