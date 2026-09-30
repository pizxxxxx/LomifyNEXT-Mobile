export const MOBILE_RELEASES_URL = 'https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases';
export const MOBILE_RELEASES_API = 'https://api.github.com/repos/pizxxxxx/LomifyNEXT-Mobile/releases?per_page=10';

export interface GitHubRelease {
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  body?: string | null;
  assets: { name: string; browser_download_url: string }[];
}

export interface AndroidUpdate {
  version: string;
  apkUrl: string;
  releaseUrl: string;
  notes: string;
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
