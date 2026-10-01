import { playlistsStorageReady } from './stores';
import { flushStoredState } from './storePersistence';
export const playlistSyncReady = playlistsStorageReady;
export async function persistSyncedPlaylists(): Promise<void> {
  if (!await flushStoredState('lomifynext_playlists')) throw new Error('Не удалось сохранить плейлисты на устройстве.');
}
