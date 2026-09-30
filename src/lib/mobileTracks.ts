import { get, writable } from 'svelte/store';
import { currentTrack, isPlaying, likedTracks, listenStats, playlists, queue, searchHistory, settings, notify } from './stores';
import { getTrendingTracks } from './api';
import { trackMatchesWaveGenre } from './waveFilters';
import { stopWave } from './wave';

export const mobileTrackMenu = writable<any | null>(null);
export const mobileTrackMenuPlaylistId = writable<string | null>(null);
export function openMobileTrackMenu(track: any, playlistId: string | null = null): void {
  mobileTrackMenuPlaylistId.set(playlistId);
  mobileTrackMenu.set(track);
}
export const scWaveActive = writable(false);
const REMOVED_PLAYLISTS_KEY = 'lomifynext_mobile_removed_imported_playlists';

function removedPlaylistIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(REMOVED_PLAYLISTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function isMobilePlaylistExcluded(id: string): boolean {
  return removedPlaylistIds().includes(id);
}

export function removedMobilePlaylistCount(): number {
  return removedPlaylistIds().length;
}

export function allowMobilePlaylistReimport(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(REMOVED_PLAYLISTS_KEY);
}

export function deleteMobilePlaylist(id: string): boolean {
  let removed = false;
  playlists.update(items => items.filter(item => {
    if (String(item.id) !== id) return true;
    removed = true;
    return false;
  }));
  if (removed && (id.startsWith('sc_playlist_') || id.startsWith('ym_playlist_')) && typeof localStorage !== 'undefined') {
    localStorage.setItem(REMOVED_PLAYLISTS_KEY, JSON.stringify([...new Set([...removedPlaylistIds(), id])]));
  }
  return removed;
}

export function removeMobileTrackFromPlaylist(id: string, track: any): boolean {
  let removed = false;
  playlists.update(items => items.map(item => {
    if (String(item.id) !== id || !Array.isArray(item.tracks)) return item;
    const tracks = item.tracks.filter((entry: any) => mobileTrackKey(entry) !== mobileTrackKey(track));
    if (tracks.length === item.tracks.length) return item;
    removed = true;
    return { ...item, tracks };
  }));
  return removed;
}
let scWaveSeen = new Set<string>();
let scWaveGeneration = 0;
let refillRequest: Promise<void> | null = null;
let discovery: any[] = [];
let discoveryUntil = 0;

export function mobileTrackKey(track: any): string {
  return `${track?.source || 'unknown'}:${track?.id || `${track?.title || ''}:${track?.artist || ''}`}`;
}

/** Explicit user choices play before recommendations, including in shuffle mode. */
export function mobileNextQueueIndex(items: any[], shuffle = false, random = Math.random): number {
  const requested = items.findIndex(track => track.mobileQueuedNext === true);
  if (requested >= 0) return requested;
  return shuffle && items.length > 1 ? Math.min(items.length - 1, Math.floor(random() * items.length)) : 0;
}

export function queueMobileTrackNext(track: any): void {
  if (!track) return;
  const entry = { ...track, mobileQueuedNext: true };
  queue.update(items => [entry, ...items.filter(item => mobileTrackKey(item) !== mobileTrackKey(track))]);
  notify('Трек сыграет следующим', 'success');
}

export function isMobileHidden(track: any): boolean {
  return get(settings).mobileHiddenTracks.includes(mobileTrackKey(track));
}

export function hideMobileTrack(track: any): void {
  const key = mobileTrackKey(track);
  settings.update(s => ({ ...s, mobileHiddenTracks: [...new Set([...s.mobileHiddenTracks, key])] }));
  queue.update(items => items.filter(item => mobileTrackKey(item) !== key));
  notify('Трек скрыт из рекомендаций. Список можно очистить в настройках.', 'info');
}

export function createMobilePlaylist(name: string): string | null {
  const title = name.trim().slice(0, 80);
  if (!title) return null;
  const id = `mobile_${crypto.randomUUID()}`;
  playlists.update(items => [{ id, title, tracks: [] }, ...items]);
  return id;
}

export function renameMobilePlaylist(id: string, name: string): boolean {
  const title = name.trim().slice(0, 80);
  if (!title) return false;
  let renamed = false;
  playlists.update(items => items.map(item => {
    if (String(item.id) !== id) return item;
    renamed = true;
    return item.title === title ? item : { ...item, title };
  }));
  return renamed;
}

/** Reorders only this local playlist and returns the old order for one-step undo. */
export function shuffleMobilePlaylist(id: string, random: () => number = Math.random): string[] | null {
  let previous: string[] | null = null;
  playlists.update(items => items.map(item => {
    if (String(item.id) !== id || !Array.isArray(item.tracks) || item.tracks.length < 2) return item;
    const shuffled = [...item.tracks];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const target = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    if (shuffled.every((track, index) => track === item.tracks[index])) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    previous = item.tracks.map(mobileTrackKey);
    return { ...item, tracks: shuffled };
  }));
  return previous;
}

/** Restores surviving tracks; tracks added after the shuffle remain at the end. */
export function restoreMobilePlaylistOrder(id: string, previous: string[]): boolean {
  let restored = false;
  playlists.update(items => items.map(item => {
    if (String(item.id) !== id || !Array.isArray(item.tracks)) return item;
    const remaining = [...item.tracks];
    const ordered: typeof remaining = [];
    for (const key of previous) {
      const index = remaining.findIndex(track => mobileTrackKey(track) === key);
      if (index >= 0) ordered.push(...remaining.splice(index, 1));
    }
    restored = true;
    return { ...item, tracks: [...ordered, ...remaining] };
  }));
  return restored;
}

export function addMobileTrackToPlaylist(id: string, track: any): void {
  let added = false;
  playlists.update(items => items.map(item => {
    if (item.id !== id || !Array.isArray(item.tracks)) return item;
    if (item.tracks.some((existing: any) => mobileTrackKey(existing) === mobileTrackKey(track))) return item;
    added = true;
    return { ...item, tracks: [...item.tracks, track] };
  }));
  notify(added ? 'Трек добавлен в плейлист' : 'Трек уже есть в плейлисте', added ? 'success' : 'info');
}

export function isScWaveTrack(track: any): boolean {
  return get(scWaveActive) && track?.source === 'soundcloud' && track?.mobileScWave === true;
}

function scWaveCandidates(): any[] {
  const s = get(settings);
  const likes = get(likedTracks).filter((track: any) => track.source === 'soundcloud');
  const unique = new Map<string, any>();
  for (const track of likes) {
    if (!isMobileHidden(track) && trackMatchesWaveGenre(track, s)) unique.set(mobileTrackKey(track), track);
  }
  return [...unique.values()];
}

export async function startScWave(): Promise<boolean> {
  const generation = ++scWaveGeneration;
  stopWave();
  scWaveSeen.clear();
  scWaveActive.set(false);
  discovery = [];
  discoveryUntil = 0;
  let candidates = scWaveCandidates();
  if (!candidates.length) {
    // No imported likes yet: use the desktop discovery feed as a starting point.
    const feed = await getTrendingTracks(get(likedTracks), get(listenStats), get(searchHistory), get(playlists));
    if (generation !== scWaveGeneration) return false;
    candidates = feed.filter((track: any) => track.source === 'soundcloud' && !isMobileHidden(track) && trackMatchesWaveGenre(track, get(settings)));
  }
  if (!candidates.length) return false;
  settings.update(s => ({ ...s, searchSource: 'soundcloud' }));
  candidates.sort(() => Math.random() - .5);
  const [first, ...rest] = candidates.slice(0, 12);
  const mark = (track: any) => ({ ...track, mobileScWave: true });
  scWaveSeen.add(mobileTrackKey(first));
  rest.forEach(track => scWaveSeen.add(mobileTrackKey(track)));
  queue.set(rest.map(mark));
  scWaveActive.set(true);
  currentTrack.set(mark(first));
  isPlaying.set(true);
  return true;
}

export async function refillScWave(): Promise<void> {
  if (refillRequest) return refillRequest;
  const generation = scWaveGeneration;
  refillRequest = (async () => {
    if (!get(scWaveActive) || !isScWaveTrack(get(currentTrack)) || get(queue).length > 3) return;
    let candidates = scWaveCandidates();
    if (Date.now() > discoveryUntil) {
      try {
        const feed = await getTrendingTracks(get(likedTracks), get(listenStats), get(searchHistory), get(playlists));
        discovery = feed.filter((track: any) => track.source === 'soundcloud');
        discoveryUntil = Date.now() + 10 * 60_000;
      } catch { /* Keep the liked-track rotation available offline. */ }
    }
    candidates = [...candidates, ...discovery.filter(track => !isMobileHidden(track) && trackMatchesWaveGenre(track, get(settings)))];
    if (generation !== scWaveGeneration || !isScWaveTrack(get(currentTrack))) return;
    let fresh = candidates.filter(track => !scWaveSeen.has(mobileTrackKey(track)));
    if (!fresh.length) {
      scWaveSeen = new Set([mobileTrackKey(get(currentTrack)), ...get(queue).map(mobileTrackKey)]);
      fresh = candidates.filter(track => !scWaveSeen.has(mobileTrackKey(track)));
      if (!fresh.length && candidates.length === 1 && get(queue).length === 0) fresh = candidates;
    }
    fresh.sort(() => Math.random() - .5);
    const selected = fresh.slice(0, 12);
    selected.forEach(track => scWaveSeen.add(mobileTrackKey(track)));
    queue.update(items => [...items, ...selected.map(track => ({ ...track, mobileScWave: true }))]);
  })().finally(() => { refillRequest = null; });
  return refillRequest;
}

export function stopScWave(): void {
  ++scWaveGeneration;
  scWaveActive.set(false);
  discovery = [];
}
