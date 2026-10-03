import { mapYandexTrack, normalizeYandexToken, ymJson } from './yandex';

const API = 'https://api.music.yandex.net';

export const YANDEX_MOODS = [
  { id: 'calm', title: 'Спокойное', detail: 'Выдохнуть и замедлиться' },
  { id: 'active', title: 'Бодрое', detail: 'Собраться и двигаться' },
  { id: 'fun', title: 'Весёлое', detail: 'Поднять настроение' },
  { id: 'sad', title: 'Грустное', detail: 'Побыть наедине с собой' },
] as const;
export type YandexMood = typeof YANDEX_MOODS[number]['id'];

/** An isolated recommendation batch; never writes settings on the user's Wave. */
export async function yandexMoodTracks(rawToken: string, mood: YandexMood, signal?: AbortSignal): Promise<any[]> {
  const token = normalizeYandexToken(rawToken);
  if (!token) throw new Error('Подключи Яндекс Музыку в настройках.');
  if (!YANDEX_MOODS.some(item => item.id === mood)) throw new Error('Выбери настроение из списка.');
  const result = await ymJson(`${API}/rotor/session/new`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ seeds: ['user:onyourwave', `settingMoodEnergy:${mood}`], queue: [],
      includeTracksInResponse: true, includeWaveModel: false, interactive: false, incognito: true }),
  });
  if (Array.isArray(result?.acceptedSeeds) && !result.acceptedSeeds.some((seed: any) =>
    seed === `settingMoodEnergy:${mood}` || (seed?.type === 'settingMoodEnergy' && (seed.tag === mood || seed.value === mood))))
    throw new Error('Яндекс не принял это настроение. Попробуй другое.');
  const seen = new Set<string>();
  return (Array.isArray(result?.sequence) ? result.sequence : []).flatMap((item: any) => {
    if (item?.type !== 'track') return [];
    const track = mapYandexTrack(item.track);
    if (!track || seen.has(String(track.id))) return [];
    seen.add(String(track.id)); return [track];
  }).slice(0, 24);
}

export async function yandexSearchSuggestions(rawToken: string, part: string, signal?: AbortSignal): Promise<string[]> {
  const token = normalizeYandexToken(rawToken);
  if (!token || part.trim().length < 2) return [];
  const result = await ymJson(`${API}/search/suggest?part=${encodeURIComponent(part.trim())}`, token, { signal });
  return [...new Set<string>((Array.isArray(result?.suggestions) ? result.suggestions : [])
    .filter((text: unknown): text is string => typeof text === 'string' && !!text.trim())
    .map((text: string) => text.trim()))].slice(0, 6);
}

/** Preserve the server's order and ignore album/artist contexts, which aren't songs. */
export function yandexHistoryEntries(result: any, limit = 24): Array<{ id: string; track: any | null }> {
  const entries: Array<{ id: string; track: any | null }> = [];
  const seen = new Set<string>();
  for (const tab of Array.isArray(result?.historyTabs) ? result.historyTabs : []) {
    for (const group of Array.isArray(tab?.items) ? tab.items : []) {
      for (const item of Array.isArray(group?.tracks) ? group.tracks : []) {
        if (item?.type !== 'track') continue;
        const data = item.data;
        const id = String(data?.itemId?.trackId ?? data?.fullModel?.id ?? '').split(':')[0];
        if (!/^\d+$/.test(id) || seen.has(id)) continue;
        seen.add(id);
        entries.push({ id, track: data?.fullModel ? mapYandexTrack(data.fullModel) : null });
        if (entries.length >= limit) return entries;
      }
    }
  }
  return entries;
}

export async function yandexRecentTracks(rawToken: string, signal?: AbortSignal): Promise<any[]> {
  const token = normalizeYandexToken(rawToken);
  if (!token) return [];
  const result = await ymJson(`${API}/music-history?fullModelsCount=24`, token, { signal });
  const entries = yandexHistoryEntries(result);
  const missing = entries.filter(entry => !entry.track).map(entry => entry.id);
  const tracks = new Map(entries.filter(entry => entry.track).map(entry => [entry.id, entry.track]));
  if (missing.length) {
    const raw = await ymJson(`${API}/tracks?trackIds=${missing.join(',')}`, token, { signal });
    for (const item of Array.isArray(raw) ? raw : []) {
      const track = mapYandexTrack(item);
      if (track) tracks.set(String(track.id).split(':')[0], track);
    }
  }
  return entries.map(entry => tracks.get(entry.id)).filter(Boolean);
}
