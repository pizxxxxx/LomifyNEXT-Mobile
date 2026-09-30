import { get, writable } from 'svelte/store';

export interface MobileSavedArtist {
  name: string;
  avatarUrl: string;
}

const STORAGE_KEY = 'lomifynext_mobile_artists';
const LIMIT = 200;
let loaded = false;
export const mobileSavedArtists = writable<MobileSavedArtist[]>([]);

export function mobileArtistKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

export function loadMobileArtists(): void {
  if (loaded || typeof localStorage === 'undefined') return;
  loaded = true;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return;
    const seen = new Set<string>();
    const artists: MobileSavedArtist[] = [];
    for (const item of value) {
      if (!item || typeof item.name !== 'string') continue;
      const name = item.name.trim().slice(0, 120);
      const key = mobileArtistKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      artists.push({ name, avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl.slice(0, 4096) : '' });
      if (artists.length === LIMIT) break;
    }
    mobileSavedArtists.set(artists);
  } catch {
    // An unavailable or damaged local collection must not prevent music playback.
  }
}

export function toggleMobileArtist(name: string, avatarUrl = ''): boolean {
  loadMobileArtists();
  const cleanName = name.trim().slice(0, 120);
  const key = mobileArtistKey(cleanName);
  if (!key) return false;
  const current = get(mobileSavedArtists);
  const saved = !current.some(artist => mobileArtistKey(artist.name) === key);
  const next = saved
    ? [{ name: cleanName, avatarUrl }, ...current].slice(0, LIMIT)
    : current.filter(artist => mobileArtistKey(artist.name) !== key);
  mobileSavedArtists.set(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the in-memory collection usable. */ }
  return saved;
}
