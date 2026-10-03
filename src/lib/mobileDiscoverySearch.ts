import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { writable } from 'svelte/store';

export const DISCOVERY_API = 'https://api.scnative.space';
// Separate, memory-only session. No Yandex credentials go to this provider.
export const discoverySession = writable('');
export type DiscoveryMode = 'lyrics' | 'vibe';
export interface DiscoveryHit { track: any; matchedLine: string | null }
export class DiscoverySearchError extends Error {
  constructor(public kind: 'login' | 'unavailable' | 'limited', message: string) { super(message); }
}
async function request(path: string, session: string, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 30_000);
  try {
    const fetcher = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? nativeFetch : fetch;
    const response = await fetcher(`${DISCOVERY_API}${path}`, {
      headers: session ? { 'x-session-id': session } : {}, signal: controller.signal
    });
    if (response.status === 401) throw new DiscoverySearchError('login', 'Войди в SoundCloud для поиска по словам и настроению.');
    if (response.status === 403 || response.status === 429) throw new DiscoverySearchError('limited', 'Сервис ограничил доступ к поиску. Попробуй позже.');
    if (!response.ok) throw new DiscoverySearchError('unavailable', 'Сервис поиска сейчас не отвечает. Попробуй ещё раз.');
    return await response.json();
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
export function mapDiscoveryTrack(raw: any): any | null {
  const id = String(raw?.id ?? '').trim();
  if (!/^\d+$/.test(id) || typeof raw?.title !== 'string' || !raw.title.trim()) return null;
  return {
    id, title: raw.title, artist: raw.user?.username || raw.enrichment?.primary_artist?.name || 'Неизвестный исполнитель',
    source: 'soundcloud', discoverySearch: true, audioUrl: '',
    coverUrl: typeof raw.artwork_url === 'string' && raw.artwork_url.startsWith('https://') ? raw.artwork_url : '',
    permalinkUrl: raw.permalink_url || '', duration: Number(raw.duration) || 0,
    genre: raw.genre || '', playbackCount: Number(raw.playback_count) || 0,
    transcodings: (raw.media?.transcodings || []).map((item: any) => item.url).filter((url: unknown) => typeof url === 'string'),
  };
}
export function discoveryHits(result: any, mode: DiscoveryMode): DiscoveryHit[] {
  const seen = new Set<string>();
  return (Array.isArray(result?.items) ? result.items : []).flatMap((item: any) => {
    const track = mapDiscoveryTrack(mode === 'lyrics' ? item?.track : item);
    if (!track || seen.has(track.id)) return [];
    seen.add(track.id);
    return [{ track, matchedLine: mode === 'lyrics' && typeof item.matchedLine === 'string' ? item.matchedLine.trim().slice(0, 300) || null : null }];
  });
}
export async function searchDiscovery(mode: DiscoveryMode, query: string, session: string, signal: AbortSignal, page = 0) {
  if (query.trim().length < 2) return { hits: [], preparing: false, hasMore: false };
  if (!session) throw new DiscoverySearchError('login', 'Войди в SoundCloud для поиска по словам и настроению.');
  const params = new URLSearchParams({ q: query.trim(), limit: '20' });
  if (mode === 'lyrics') { params.set('mode', 'text'); params.set('page', String(Math.max(0, page))); }
  const raw = await request(`/search/${mode}?${params}`, session, signal);
  return { hits: discoveryHits(raw, mode), preparing: raw?.status === 'preparing', hasMore: mode === 'lyrics' && (raw?.hasMore === true || Number(raw?.total) > (page + 1) * 20) };
}
/** OAuth is initiated only by a person's explicit sign-in button. */
export async function beginDiscoveryLogin(signal: AbortSignal): Promise<string> {
  const login = await request('/auth/login', '', signal);
  const url = new URL(login?.url);
  if (url.protocol !== 'https:' || !['soundcloud.com', 'secure.soundcloud.com', 'scnative.space', 'api.scnative.space'].includes(url.hostname) || !login?.loginRequestId)
    throw new Error('Сервис не вернул доступный адрес входа.');
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) await openUrl(url.href);
  else window.open(url.href, '_blank', 'noopener,noreferrer');
  const until = Date.now() + 5 * 60_000;
  while (!signal.aborted && Date.now() < until) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    const status = await request(`/auth/login/status?id=${encodeURIComponent(login.loginRequestId)}`, '', signal);
    if (status?.status === 'completed' && typeof status.sessionId === 'string' && status.sessionId) return status.sessionId;
    if (status?.status === 'failed' || status?.status === 'expired') throw new Error('Вход не завершён. Попробуй снова.');
  }
  throw new Error('Время ожидания входа истекло. Попробуй снова.');
}
