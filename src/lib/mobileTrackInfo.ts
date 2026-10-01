import { getTrackInfo } from '$lib/api';
import { getYandexTrackMetadata } from '$lib/yandex';

export type TrackInfoRow = { label: string; value: string };
const number = new Intl.NumberFormat('ru-RU');

/** Fetch on opening information, never during scrolling or in the background. */
export async function loadMobileTrackInfo(track: any, yandexToken: string): Promise<any> {
  if (!track.id || track.isLocal || track.source === 'Локальный') return track;
  if (track.source === 'yandex') {
    if (!yandexToken) return track;
    const metadata = await getYandexTrackMetadata(yandexToken, String(track.id));
    if (!metadata) throw new Error('Metadata unavailable');
    return { ...track, ...metadata };
  }
  if (track.source !== 'soundcloud') return track;
  const raw = await getTrackInfo(track.id);
  if (!raw) throw new Error('Metadata unavailable');
  return { ...track,
    genre: raw.genre || track.genre,
    albumTitle: raw.publisher_metadata?.album_title || track.albumTitle,
    releaseDate: raw.release_date || '',
    publishedAt: raw.created_at || raw.display_date || '',
    playbackCount: raw.playback_count ?? null,
    likesCount: raw.likes_count ?? raw.favoritings_count ?? null,
    duration: raw.duration ?? track.duration,
    label: raw.label_name || track.label,
    bpm: raw.bpm ?? track.bpm,
    isrc: raw.isrc || raw.publisher_metadata?.isrc || track.isrc
  };
}

/** Missing totals stay missing; personal listens never become service totals. */
export function mobileTrackInfoRows(track: any, history: Record<string, any> = {}): TrackInfoRow[] {
  const rows: TrackInfoRow[] = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) rows.push({ label, value: value.trim() });
  };
  add('Источник', track.source === 'yandex' ? 'Яндекс Музыка' : track.source === 'soundcloud' ? 'SoundCloud' : track.source || 'Локальный файл');
  add('Альбом', track.albumTitle);
  const genres = [...new Set([track.genre, ...(Array.isArray(track.genres) ? track.genres : [])]
    .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))];
  add(genres.length > 1 ? 'Жанры' : 'Жанр', genres.join(', '));
  const date = track.releaseDate || track.publishedAt;
  if (date) {
    const parsed = new Date(date);
    if (Number.isFinite(parsed.getTime())) add(track.releaseDate ? 'Дата выпуска' : 'Опубликован',
      track.releaseDatePrecision === 'year' ? String(parsed.getUTCFullYear()) : parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  }
  const seconds = Math.floor(Number(track.duration) / 1000);
  if (Number.isFinite(seconds) && seconds > 0) add('Длительность', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  add('Лейбл', track.label);
  if (typeof track.bpm === 'number' && Number.isFinite(track.bpm) && track.bpm > 0) add('Темп', `${number.format(track.bpm)} BPM`);
  add('ISRC', track.isrc);
  for (const [key, label] of [['playbackCount', 'Прослушиваний в SoundCloud'], ['likesCount', 'Лайков в SoundCloud']] as const) {
    if (track.source === 'soundcloud' && typeof track[key] === 'number' && Number.isFinite(track[key]) && track[key] >= 0) add(label, number.format(track[key]));
  }
  const own = history[`${track.title}-${track.artist}`];
  const sameSource = !own?.source || own.source === track.source;
  const sameId = own?.id == null || track.id == null || String(own.id) === String(track.id);
  if (sameSource && sameId && typeof own?.count === 'number' && own.count > 0) add('Твои прослушивания в Lomify', number.format(own.count));
  return rows;
}
