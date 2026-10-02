import { invoke } from '@tauri-apps/api/core';
import { writable } from 'svelte/store';
import { buildTrackUrn } from '$lib/utils/trackUrn';

export interface DownloadedCoverCacheState {
  proxyPort: number;
  cachedUrns: Set<string>;
}

export const downloadedCoverCache = writable<DownloadedCoverCacheState>({
  proxyPort: 0,
  cachedUrns: new Set<string>()
});

/**
 * Ask the two artwork CDNs used by Lomify for an image close to its rendered size.
 * A 48px list row does not need a decoded 500x500 bitmap (roughly 1 MB in RGBA) for
 * every visible item. Unknown and local URLs stay untouched.
 */
export function coverUrlAtSize(url: string, requestedSize: number): string {
  if (!url) return '';
  const size = Math.max(32, Math.min(1000, Math.round(requestedSize)));

  if (url.includes('avatars.yandex.net') || url.includes('.yandex.net/get-music-content')) {
    // The CDN has named presets, not arbitrary dimensions (240x240 can 404).
    const preset = [100, 200, 400, 1000].find(value => value >= size) ?? 1000;
    return url
      .replace('%%', `${preset}x${preset}`)
      .replace(/\/\d+x\d+(?=($|[?#]))/, `/${preset}x${preset}`);
  }

  if (url.includes('sndcdn.com')) {
    const supported = [50, 120, 200, 300, 500];
    const soundCloudSize = supported.find((candidate) => candidate >= size) ?? 500;
    return url.replace(
      /-(t\d+x\d+|large|badge|small|tiny|mini|crop)(?=\.(jpg|jpeg|png)(?:$|[?#]))/i,
      `-t${soundCloudSize}x${soundCloudSize}`
    );
  }

  return url;
}

function encodePayload(values: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodeURIComponent(btoa(binary));
}

/**
 * Return the local cover endpoint only for tracks whose audio is on disk. The
 * endpoint reads `audio_covers/` first and uses the original URL only to
 * backfill downloads made by older versions.
 */
export function coverUrlForTrack(
  track: any,
  state: DownloadedCoverCacheState
): string {
  const remoteUrl = `${track?.coverUrl ?? ''}`.trim();
  if (!remoteUrl || !state.proxyPort || !track) return remoteUrl;

  const urn = buildTrackUrn(track);
  if (!state.cachedUrns.has(urn)) return remoteUrl;

  const payload = encodePayload([urn, remoteUrl]);
  return `http://127.0.0.1:${state.proxyPort}/downloaded-cover/${payload}`;
}

/** Try the original artwork if the local cover is unavailable, then show the icon beneath it. */
export function handleArtworkError(event: Event, remoteUrl: string, size?: number): void {
  const image = event.currentTarget as HTMLImageElement | null;
  if (!image) return;
  const fallback = size ? coverUrlAtSize(remoteUrl, size) : remoteUrl;
  if (image.dataset.remoteFallback !== '1' && image.src.startsWith('http://127.0.0.1:') && fallback) {
    image.dataset.remoteFallback = '1';
    image.src = fallback;
    return;
  }
  if (image.dataset.cdnFallback !== '1' && remoteUrl && image.src !== remoteUrl) {
    image.dataset.cdnFallback = '1';
    image.src = remoteUrl;
    return;
  }
  image.hidden = true;
}

export function handleArtworkLoad(event: Event): void {
  const image = event.currentTarget as HTMLImageElement | null;
  if (!image) return;
  image.hidden = false;
  delete image.dataset.remoteFallback;
  delete image.dataset.cdnFallback;
}

/** Initialize the native proxy port and keep the synchronous URN set current. */
export async function initDownloadedCoverCache(): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => {};
  }

  try {
    const [[, proxyPort], urns] = await Promise.all([
      invoke<[number, number]>('get_server_ports'),
      invoke<string[]>('track_list_cached')
    ]);
    downloadedCoverCache.set({ proxyPort, cachedUrns: new Set(urns) });
  } catch (error) {
    console.warn('[covers] не удалось открыть локальные обложки', error);
  }

  const onTrackCacheChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ urn?: string; cached?: boolean }>).detail;
    if (!detail?.urn) return;
    const urn = detail.urn;
    downloadedCoverCache.update((state) => {
      const cachedUrns = new Set(state.cachedUrns);
      if (detail.cached) cachedUrns.add(urn);
      else cachedUrns.delete(urn);
      return { ...state, cachedUrns };
    });
  };

  window.addEventListener('trackCacheChanged', onTrackCacheChanged);
  return () => window.removeEventListener('trackCacheChanged', onTrackCacheChanged);
}
