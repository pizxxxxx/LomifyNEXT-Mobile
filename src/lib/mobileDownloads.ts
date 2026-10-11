import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import { getAudioUrl } from './api';
import { notify } from './stores';
import { buildTrackUrn } from './utils/trackUrn';
import { downloadedCoverCache } from './offlineCovers';

type DownloadJob = { status: 'queued' | 'downloading' | 'error'; progress: number; error?: string };
export const mobileDownloads = writable<any[]>([]);
export const mobileDownloadJobs = writable<Record<string, DownloadJob>>({});
const STORAGE_KEY = 'lomifynext_mobile_downloads';
const pending: any[] = [];
let running = false;

function persist(tracks: any[]) {
  // Keep display metadata, never signed stream URLs or account credentials.
  mobileDownloads.set(tracks);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks)); }
  catch { /* The audio is cached even if WebView metadata storage is full. */ }
}
function publish(urn: string, cached: boolean) {
  window.dispatchEvent(new CustomEvent('trackCacheChanged', { detail: { urn, cached } }));
}
function updateJob(urn: string, job?: DownloadJob) {
  mobileDownloadJobs.update(jobs => {
    const next = { ...jobs };
    if (job) next[urn] = job;
    else delete next[urn];
    return next;
  });
}

export async function initMobileDownloads() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) mobileDownloads.set(stored.filter(t => t?.id && t?.title));
    const urns = new Set(await invoke<string[]>('track_list_cached'));
    persist(get(mobileDownloads).filter(track => urns.has(buildTrackUrn(track))));
  } catch { /* Keep metadata available if the native bridge is temporarily busy. */ }
  return listen<{ urn: string; downloaded: number; total?: number }>('track:download-progress', ({ payload }) => {
    const job = get(mobileDownloadJobs)[payload.urn];
    if (!job || job.status !== 'downloading' || !payload.total) return;
    const progress = Math.min(99, Math.floor(payload.downloaded / payload.total * 100));
    if (progress !== job.progress) updateJob(payload.urn, { ...job, progress });
  });
}

export function queueMobileDownloads(tracks: any[]) {
  let added = 0;
  const cached = get(downloadedCoverCache).cachedUrns;
  for (const track of tracks) {
    const urn = buildTrackUrn(track);
    const job = get(mobileDownloadJobs)[urn];
    if (!track?.id || track.isLocal || cached.has(urn) || job?.status === 'queued' || job?.status === 'downloading') continue;
    pending.push({ ...track });
    updateJob(urn, { status: 'queued', progress: 0 });
    added++;
  }
  if (added) void drain();
  else notify('Эти треки уже скачаны или стоят в очереди.', 'info');
}

// One transfer at a time keeps bandwidth and memory available for playback.
async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const track = pending.shift();
      const urn = buildTrackUrn(track);
      updateJob(urn, { status: 'downloading', progress: 0 });
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const url = await getAudioUrl(track, { fullTrackRequired: true, fresh: attempt > 0, silent: true });
            if (!url) throw new Error('Источник не дал ссылку на полный трек.');
            await invoke('track_ensure_cached', { request: {
              urn, url, urls: [url], coverUrl: track.coverUrl || null,
              durationMs: Number(track.duration) || null, hq: false
            } });
            break;
          } catch (error) {
            // Match playback: one new resolution replaces an expired CDN URL.
            // Permanent access/disk errors are not helped by another transfer.
            if (attempt > 0 || permanentDownloadError(error)) throw error;
          }
        }
        const metadata = { id: track.id, source: track.source, title: track.title, artist: track.artist,
          coverUrl: track.coverUrl || '', duration: track.duration || 0, genre: track.genre || '' };
        persist([...get(mobileDownloads).filter(t => buildTrackUrn(t) !== urn), metadata]);
        publish(urn, true);
        updateJob(urn);
      } catch (error) {
        updateJob(urn, { status: 'error', progress: 0, error: downloadErrorMessage(error) });
      }
    }
  } finally { running = false; }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
function permanentDownloadError(error: unknown): boolean {
  return /no space|disk full|cache (write|flush|create)|permission denied|DRM|preview|превью|полный трек|недоступен|not available|HTTP (404|410)/i.test(errorText(error));
}
function downloadErrorMessage(error: unknown): string {
  const message = errorText(error);
  if (/no space|disk full|os error 28/i.test(message)) return 'Недостаточно места на устройстве.';
  if (/cache (write|flush|create)|permission denied/i.test(message)) return 'Не удалось сохранить файл на устройстве.';
  if (/DRM|preview|превью|полный трек|недоступен|not available|HTTP (404|410)/i.test(message)) return 'Источник не отдал полный трек для скачивания.';
  if (/HTTP (401|403)|токен|авторизац/i.test(message)) return 'Источник отклонил загрузку. Проверь подключение аккаунта.';
  return 'Не удалось скачать трек. Проверь сеть и повтори.';
}

export function stopMobileDownloadQueue() {
  for (const track of pending.splice(0)) updateJob(buildTrackUrn(track));
  notify('Очередь остановлена. Текущий трек докачается.', 'info');
}

export async function removeMobileDownload(track: any) {
  const urn = buildTrackUrn(track);
  try {
    await invoke('track_remove_cached', { urn });
    if (await invoke<boolean>('track_is_cached', { urn })) throw new Error('Still cached');
    persist(get(mobileDownloads).filter(t => buildTrackUrn(t) !== urn));
    publish(urn, false);
    notify('Скачанный файл удалён. Трек остаётся в медиатеке.', 'info');
  } catch { notify('Не удалось удалить скачанный файл. Попробуй ещё раз.', 'error'); }
}
