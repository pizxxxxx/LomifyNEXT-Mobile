import { writable } from 'svelte/store';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_PACKAGE_VERSION } from './version';
import { compareMobileVersions, findAndroidUpdate, findLatestIOSRelease, MOBILE_RELEASES_API, MOBILE_IOS_RELEASES_API, MOBILE_RELEASES_URL, type AndroidUpdate, type GitHubRelease } from './mobileUpdateCore';

type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'error';
interface UpdateState { status: UpdateStatus; update: AndroidUpdate | null; checkedAt: number; installedVersion: string; message: string }
const initialState: UpdateState = { status: 'idle', update: null, checkedAt: 0, installedVersion: APP_PACKAGE_VERSION, message: '' };
export const mobileUpdateState = writable<UpdateState>(initialState);
export const isAndroidUpdateTarget = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const CACHE_KEY = 'lomifynext_mobile_update_check';
const CACHE_MS = 6 * 60 * 60 * 1000;
let pending: Promise<void> | null = null;

function cachedState(): UpdateState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as UpdateState | null;
    if (!parsed || parsed.installedVersion !== APP_PACKAGE_VERSION || !Number.isFinite(parsed.checkedAt) || Date.now() - parsed.checkedAt >= CACHE_MS) return null;
    if (parsed.status === 'current') return { ...initialState, status: 'current', checkedAt: parsed.checkedAt };
    if (parsed.status === 'available' && parsed.update?.version &&
      compareMobileVersions(parsed.update.version, APP_PACKAGE_VERSION) > 0 &&
      parsed.update?.apkUrl?.startsWith('https://github.com/pizxxxxx/LomifyNEXT-Mobile/releases/download/')) {
      return { ...initialState, status: 'available', update: parsed.update, checkedAt: parsed.checkedAt };
    }
  } catch { /* Storage is optional on restricted WebViews. */ }
  return null;
}

export async function checkMobileUpdate(force = false): Promise<void> {
  if (!isAndroidUpdateTarget) return;
  if (pending) return pending;
  if (!force) {
    const cached = cachedState();
    if (cached) { mobileUpdateState.set(cached); return; }
  }
  mobileUpdateState.update(state => ({ ...state, status: 'checking', message: '' }));
  pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const currentVersion = await getVersion().catch(() => APP_PACKAGE_VERSION);
      const response = await fetch(MOBILE_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, cache: 'no-store'
      });
      if (!response.ok) throw new Error(response.status === 403 ? 'GitHub временно ограничил запросы. Попробуй позже.' : 'Не удалось связаться с GitHub. Проверь интернет.');
      const releases = await response.json() as GitHubRelease[];
      if (!Array.isArray(releases)) throw new Error('GitHub вернул неожиданный ответ. Попробуй позже.');
      const update = findAndroidUpdate(releases, currentVersion);
      const next: UpdateState = { status: update ? 'available' : 'current', update, checkedAt: Date.now(), installedVersion: currentVersion, message: '' };
      mobileUpdateState.set(next);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* Non-persistent check is still useful. */ }
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'GitHub не ответил за 10 секунд. Попробуй позже.' :
        error instanceof Error ? error.message : 'Не удалось проверить обновления.';
      mobileUpdateState.set({ ...initialState, status: 'error', message });
    } finally { clearTimeout(timeout); pending = null; }
  })();
  return pending;
}

export async function openMobileUpdate(url: string = MOBILE_RELEASES_URL): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) await openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openLatestIOSRelease(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(MOBILE_IOS_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, cache: 'no-store'
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub временно ограничил запросы. Попробуй позже.' : 'Не удалось связаться с GitHub. Проверь интернет.');
    const releases = await response.json() as GitHubRelease[];
    if (!Array.isArray(releases)) throw new Error('GitHub вернул неожиданный ответ. Попробуй позже.');
    const url = findLatestIOSRelease(releases);
    if (!url) throw new Error('Опубликованная iOS-сборка пока не найдена. Открой все релизы GitHub ниже.');
    await openMobileUpdate(url);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('GitHub не ответил за 10 секунд. Попробуй позже.');
    throw error;
  } finally { clearTimeout(timeout); }
}
