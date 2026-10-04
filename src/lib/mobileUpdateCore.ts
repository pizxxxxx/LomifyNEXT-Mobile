export const MOBILE_RELEASES_URL = 'https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases';
export const MOBILE_RELEASES_API = 'https://api.github.com/repos/pizxxxxx/LomifyNEXT-Mobile/releases?per_page=10';
export const MOBILE_IOS_RELEASES_API = 'https://api.github.com/repos/pizxxxxx/LomifyNEXT-Mobile/releases?per_page=100';

export interface GitHubRelease {
  tag_name?: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  body?: string | null;
  assets: { name: string; browser_download_url: string }[];
}

/** Select the newest IPA from a combined release or the historical iOS releases. */
export function findLatestIOSRelease(releases: GitHubRelease[]): string | null {
  return latestIOSUpdate(releases)?.releaseUrl ?? null;
}

export interface IOSUpdate {
  version: string;
  ipaUrl: string;
  releaseUrl: string;
  notes: string;
}

function latestIOSUpdate(releases: GitHubRelease[]): IOSUpdate | null {
  let best: IOSUpdate | null = null;
  for (const release of releases) {
    if (release.draft || !Array.isArray(release.assets)) continue;
    if (!release.tag_name || release.html_url !== `${MOBILE_RELEASES_URL}/tag/${release.tag_name}`) continue;
    for (const asset of release.assets) {
      const version = /^LomifyNEXT-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)\.ipa$/i.exec(asset.name)?.[1];
      if (!version || asset.browser_download_url !== `${MOBILE_RELEASES_URL}/download/${release.tag_name}/${asset.name}`) continue;
      if (best && compareMobileVersions(version, best.version) <= 0) continue;
      best = { version, ipaUrl: asset.browser_download_url, releaseUrl: release.html_url, notes: (release.body || '').slice(0, 1000) };
    }
  }
  return best;
}

/** Asset versions are authoritative, including releases shared with Android. */
export function findIOSUpdate(releases: GitHubRelease[], currentVersion: string): IOSUpdate | null {
  if (!parseVersion(currentVersion)) return null;
  const latest = latestIOSUpdate(releases);
  return latest && compareMobileVersions(latest.version, currentVersion) > 0 ? latest : null;
}

export interface AndroidUpdate {
  version: string;
  apkUrl: string;
  releaseUrl: string;
  notes: string;
}

export type MobileUpdate = (AndroidUpdate & { platform: 'android' }) | (IOSUpdate & { platform: 'ios' });

export function mobileUpdateLink(update: MobileUpdate): string {
  // AltStore installation needs the IPA and its instructions; Android opens its APK.
  return update.platform === 'ios' ? update.releaseUrl : update.apkUrl;
}

type ParsedVersion = { numbers: [number, number, number]; rank: number; sequence: number };

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/i.exec(value);
  if (!match) return null;
  const rank = match[4] ? ({ alpha: 0, beta: 1, rc: 2 } as const)[match[4].toLowerCase() as 'alpha' | 'beta' | 'rc'] : 3;
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], rank, sequence: Number(match[5] || 0) };
}

export function compareMobileVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Некорректный номер версии');
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  }
  return Math.sign(a.rank - b.rank) || Math.sign(a.sequence - b.sequence);
}

function assetVersion(name: string): string | null {
  // The release tag can disagree with the uploaded APK. The installable asset is authoritative.
  const match = /^LomifyNEXT[-_](v?\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)[-_](?:arm64|aarch64)\.apk$/i.exec(name);
  return match?.[1].replace(/^v/i, '') ?? null;
}

function isExpectedApkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      url.pathname.startsWith('/pizxxxxx/LomifyNEXT-Mobile/releases/download/') &&
      url.pathname.toLowerCase().endsWith('.apk');
  } catch { return false; }
}

export function findAndroidUpdate(releases: GitHubRelease[], currentVersion: string): AndroidUpdate | null {
  if (!parseVersion(currentVersion)) return null;
  let best: AndroidUpdate | null = null;
  for (const release of releases) {
    if (release.draft || !Array.isArray(release.assets)) continue;
    for (const asset of release.assets) {
      const version = assetVersion(asset.name);
      if (!version || !isExpectedApkUrl(asset.browser_download_url)) continue;
      if (compareMobileVersions(version, currentVersion) <= 0 || (best && compareMobileVersions(version, best.version) <= 0)) continue;
      best = {
        version,
        apkUrl: asset.browser_download_url,
        releaseUrl: typeof release.html_url === 'string' && release.html_url.startsWith(MOBILE_RELEASES_URL) ? release.html_url : MOBILE_RELEASES_URL,
        notes: (release.body || '').slice(0, 1000)
      };
    }
  }
  return best;
}
