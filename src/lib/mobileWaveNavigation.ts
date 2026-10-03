import { get, writable } from 'svelte/store';
import { currentView, settings } from './stores';
import { waveSeed, waveSeedForTrack, type WaveSeed } from './wave';

export const mobileWaveRequest = writable<{ seed: WaveSeed | null; resume: boolean } | null>(null);

/** Playback is requested by a tap, never by restoring a tab/history entry. */
export function openMobileWave(track?: any): void {
  const seed = track === undefined ? get(waveSeed) : track ? waveSeedForTrack(track) : null;
  if (track && !seed) return;
  if (seed) settings.update(value => ({ ...value, searchSource: 'yandex' }));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lomify:close-player-for-navigation'));
  mobileWaveRequest.set({ seed, resume: track === undefined });
  currentView.set('wave');
}
