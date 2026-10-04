import { derived, writable } from 'svelte/store';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_PACKAGE_VERSION } from './version';
import { compareMobileVersions, findAndroidUpdate, findIOSUpdate, findLatestIOSRelease, MOBILE_RELEASES_API, MOBILE_IOS_RELEASES_API, MOBILE_RELEASES_URL, type MobileUpdate, type GitHubRelease } from './mobileUpdateCore';

type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'error';
export interface UpdateState { status: UpdateStatus; update: MobileUpdate | null; checkedAt: number; installedVersion: string; message: string }
const initialState: UpdateState = { status: 'idle', update: null, checkedAt: 0, installedVersion: APP_PACKAGE_VERSION, message: '' };
export const mobileUpdateState = writable<UpdateState>(initialState);
export const isAndroidUpdateTarget = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const isIOSUpdateTarget = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const platform = isAndroidUpdateTarget ? 'android' : isIOSUpdateTarget ? 'ios' : null;

// A dismissal lasts for this app process. A newer version can still be announced.
const dismissedVersion = writable('');
export const mobileUpdateReminder = derived([mobileUpdateState, dismissedVersion], ([state, dismissed]) =>
  state.status === 'available' && state.update?.version !== dismissed ? state.update : null);
export function dismissMobileUpdate(version: string): void { dismissedVersion.set(version); }

const CACHE_KEY = 'lomifynext_mobile_update_check';
const CACHE_MS = 6 * 60 * 60 * 1000;
let pending: Promise<void> | null = null;

function cachedState(): UpdateState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as UpdateState | null;
    const age = Date.now() - (parsed?.checkedAt ?? 0);
    if (!parsed || parsed.installedVersion !== APP_PACKAGE_VERSION || !Number.isFinite(parsed.checkedAt) || age < 0 || age >= CACHE_MS) return null;
    if (parsed.status === 'current') return { ...initialState, status: 'current', checkedAt: parsed.checkedAt };
    const update = parsed.update;
    if (parsed.status === 'available' && update?.platform === platform && compareMobileVersions(update.version, APP_PACKAGE_VERSION) > 0) {
      // Revalidate cached URLs with the same selector used for live releases.
      const name = update.platform === 'ios' ? `LomifyNEXT-${update.version}.ipa` : `LomifyNEXT-${update.version}-arm64.apk`;
      const tag = update.releaseUrl.slice(`${MOBILE_RELEASES_URL}/tag/`.length);
      const url = update.platform === 'ios' ? update.ipaUrl : update.apkUrl;
      if (update.releaseUrl !== `${MOBILE_RELEASES_URL}/tag/${tag}` || url !== `${MOBILE_RELEASES_URL}/download/${tag}/${name}`) return null;
      const releases = [{ tag_name: tag, draft: false, prerelease: false, html_url: update.releaseUrl, assets: [{ name, browser_download_url: url }] }];
      const verified = update.platform === 'ios' ? findIOSUpdate(releases, APP_PACKAGE_VERSION) : findAndroidUpdate(releases, APP_PACKAGE_VERSION);
      if (verified) return { ...initialState, status: 'available', update: { ...verified, platform } as MobileUpdate, checkedAt: parsed.checkedAt };
    }
  } catch { /* Storage is optional on restricted WebViews. */ }
  return null;
}

async function readReleases(api: string): Promise<GitHubRelease[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(api, {
      headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, cache: 'no-store'
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub временно ограничил запросы. Попробуй позже.' : 'Не удалось связаться с GitHub. Проверь интернет.');
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('GitHub вернул неожиданный ответ. Попробуй позже.');
    return releases;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('GitHub не ответил за 10 секунд. Попробуй позже.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function checkMobileUpdate(force = false): Promise<void> {
  if (!platform) return;
  if (pending) return pending;
  if (!force) {
    const cached = cachedState();
    if (cached) { mobileUpdateState.set(cached); return; }
  }
  mobileUpdateState.update(state => ({ ...state, status: 'checking', message: '' }));
  pending = (async () => {
    try {
      const currentVersion = await getVersion().catch(() => APP_PACKAGE_VERSION);
      const releases = await readReleases(platform === 'ios' ? MOBILE_IOS_RELEASES_API : MOBILE_RELEASES_API);
      const found = platform === 'ios' ? findIOSUpdate(releases, currentVersion) : findAndroidUpdate(releases, currentVersion);
      const update = found ? { ...found, platform } as MobileUpdate : null;
      const next: UpdateState = { status: update ? 'available' : 'current', update, checkedAt: Date.now(), installedVersion: currentVersion, message: '' };
      mobileUpdateState.set(next);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* Non-persistent checks still work. */ }
    } catch (error) {
      mobileUpdateState.set({ ...initialState, status: 'error', message: error instanceof Error ? error.message : 'Не удалось проверить обновления.' });
    } finally { pending = null; }
  })();
  return pending;
}

export async function openMobileUpdate(url: string = MOBILE_RELEASES_URL): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) await openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openLatestIOSRelease(): Promise<void> {
  const url = findLatestIOSRelease(await readReleases(MOBILE_IOS_RELEASES_API));
  if (!url) throw new Error('Опубликованная iOS-сборка пока не найдена. Открой все релизы GitHub ниже.');
  await openMobileUpdate(url);
}
