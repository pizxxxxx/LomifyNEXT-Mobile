<script lang="ts">
  import { Disc3, Loader2, MoreHorizontal, Music2, Play, RefreshCw, UserRound, ChevronLeft } from 'lucide-svelte';
  import { currentArtist, currentTrack, isPlaying, queue, settings, notify } from '$lib/stores';
  import { getArtistAlbums, getArtistProfile, getArtistTracks, getAlbumTracks, trackByArtist, type ArtistSource } from '$lib/api';
  import { coverUrlAtSize, coverUrlForTrack, downloadedCoverCache, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileTrackMenu, stopScWave } from '$lib/mobileTracks';

  let source = $state<ArtistSource>($settings.searchSource === 'yandex' && $settings.yandexToken ? 'yandex' : 'soundcloud');
  let tab = $state<'tracks' | 'albums'>('tracks');
  let tracks = $state<any[]>([]);
  let albums = $state<any[]>([]);
  let profile = $state<Awaited<ReturnType<typeof getArtistProfile>>>(null);
  let loadingTracks = $state(true);
  let loadingAlbums = $state(true);
  let loadError = $state(false);
  let retry = $state(0);
  let visibleCount = $state(40);
  let openAlbum = $state<any | null>(null);
  let albumTracks = $state<any[] | null>(null);
  let albumRequest = 0;
  let avatar = $derived(profile?.avatarUrl || tracks[0]?.artistAvatarUrl || tracks[0]?.coverUrl || '');

  $effect(() => {
    const name = $currentArtist.trim();
    const selectedSource = source;
    void retry;
    let current = true;
    albumRequest++;
    tracks = [];
    albums = [];
    profile = null;
    openAlbum = null;
    albumTracks = null;
    tab = 'tracks';
    visibleCount = 40;
    loadingTracks = !!name;
    loadingAlbums = !!name;
    loadError = false;
    if (name) {
      void getArtistProfile(name, selectedSource).then(result => {
        if (current) profile = result;
      }).catch(() => {});
      void getArtistTracks(name, selectedSource).then(result => {
        if (!current) return;
        const matching = result.filter((track: any) => trackByArtist(track, name));
        tracks = matching.length ? matching : result;
      }).catch(() => { if (current) loadError = true; }).finally(() => {
        if (current) loadingTracks = false;
      });
      void getArtistAlbums(name, selectedSource).then(result => {
        if (current) albums = result;
      }).catch(() => {}).finally(() => {
        if (current) loadingAlbums = false;
      });
    }
    return () => { current = false; albumRequest++; };
  });

  function selectSource(next: ArtistSource) {
    if (next === source) return;
    if (next === 'yandex' && !$settings.yandexToken) {
      notify('Сначала подключи Яндекс Музыку в настройках.', 'info');
      return;
    }
    source = next;
  }

  function play(track: any, list: any[]) {
    if (!track) return;
    stopScWave();
    const index = list.findIndex(item => item === track || (item.id && item.id === track.id && item.source === track.source));
    queue.set(index < 0 ? [] : list.slice(index + 1));
    currentTrack.set(track);
    isPlaying.set(true);
  }

  async function showAlbum(album: any) {
    const request = ++albumRequest;
    openAlbum = album;
    tab = 'albums';
    albumTracks = null;
    try {
      const result = await getAlbumTracks(album);
      if (request === albumRequest) albumTracks = result;
    } catch {
      if (request === albumRequest) albumTracks = [];
    }
  }

  function closeAlbum() {
    albumRequest++;
    openAlbum = null;
    albumTracks = null;
  }

  function playAlbum() {
    if (albumTracks?.length) play(albumTracks[0], albumTracks);
  }
</script>

<section class="mobile-artist-page" aria-label={`Исполнитель ${$currentArtist}`}>
  <header class="mobile-artist-hero">
    {#if profile?.bannerUrl}<img class="mobile-artist-banner" src={profile.bannerUrl} alt="" loading="eager" decoding="async" />{/if}
    <div class="mobile-artist-hero-content">
      <div class="mobile-artist-avatar">
        {#if avatar}<img src={coverUrlAtSize(avatar, 240)} alt="" onerror={(event) => handleArtworkError(event, avatar, 240)} onload={handleArtworkLoad} />{:else}<UserRound size={32} aria-hidden="true" />{/if}
      </div>
      <div class="mobile-artist-identity">
        <span>ИСПОЛНИТЕЛЬ</span>
        <h1>{$currentArtist}</h1>
        {#if tracks.length || albums.length}<p>{tracks.length} треков{#if albums.length} · {albums.length} релизов{/if}</p>{/if}
      </div>
    </div>
  </header>

  <div class="mobile-artist-source" role="group" aria-label="Источник музыки">
    <button type="button" aria-pressed={source === 'soundcloud'} onclick={() => selectSource('soundcloud')}>SoundCloud</button>
    <button type="button" aria-pressed={source === 'yandex'} aria-disabled={!$settings.yandexToken} onclick={() => selectSource('yandex')}>Яндекс Музыка</button>
  </div>

  <div class="mobile-artist-heading">
    <div><h2>Музыка</h2><p>{source === 'yandex' ? 'Яндекс Музыка' : 'SoundCloud'}</p></div>
    {#if tracks.length}<button class="mobile-icon-button mobile-artist-play-all" type="button" aria-label="Слушать треки исполнителя" onclick={() => play(tracks[0], tracks)}><Play size={21} fill="currentColor" aria-hidden="true" /></button>{/if}
  </div>

  {#if albums.length || loadingAlbums}
    <div class="mobile-artist-tabs" role="tablist" aria-label="Разделы исполнителя">
      <button type="button" role="tab" aria-selected={tab === 'tracks'} onclick={() => { tab = 'tracks'; closeAlbum(); }}>Треки <span>{tracks.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'albums'} onclick={() => tab = 'albums'}>Релизы <span>{albums.length}</span></button>
    </div>
  {/if}

  {#if tab === 'tracks'}
    {#if loadingTracks}
      <div class="mobile-artist-status" role="status"><Loader2 size={22} class="animate-spin" /> Загружаем треки</div>
    {:else if tracks.length}
      <div class="mobile-artist-track-list">
        {#each tracks.slice(0, visibleCount) as track, index (index)}
          <div class="mobile-artist-track">
            <button type="button" class="mobile-artist-track-main" use:mobileHold={{ onHold: () => mobileTrackMenu.set(track) }} onclick={() => play(track, tracks)} aria-label={`Слушать ${track.title}`}>
              <span class="mobile-artist-track-art">{#if track.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(track, $downloadedCoverCache), 120)} alt="" loading="lazy" decoding="async" onerror={(event) => handleArtworkError(event, track.coverUrl, 120)} onload={handleArtworkLoad} />{:else}<Music2 size={22} aria-hidden="true" />{/if}</span>
              <span class="mobile-artist-track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
            </button>
            <button type="button" class="mobile-icon-button mobile-artist-track-menu" aria-label={`Действия с треком ${track.title}`} onclick={() => mobileTrackMenu.set(track)}><MoreHorizontal size={22} aria-hidden="true" /></button>
          </div>
        {/each}
      </div>
      {#if tracks.length > visibleCount}<button type="button" class="mobile-secondary mobile-artist-more" onclick={() => visibleCount += 40}>Показать ещё</button>{/if}
    {:else}
      <div class="mobile-artist-empty"><Music2 size={26} aria-hidden="true" /><p>{loadError ? 'Не удалось загрузить треки.' : 'Треков на этой площадке пока нет.'}</p><button class="mobile-secondary" onclick={() => retry++}><RefreshCw size={17} aria-hidden="true" /> Повторить</button></div>
    {/if}
  {:else if openAlbum}
    <div class="mobile-artist-album-detail">
      <button type="button" class="mobile-artist-back" onclick={closeAlbum}><ChevronLeft size={19} aria-hidden="true" /> Все релизы</button>
      <div class="mobile-artist-album-head">
        <span class="mobile-artist-album-art">{#if openAlbum.coverUrl}<img src={coverUrlAtSize(openAlbum.coverUrl, 240)} alt="" loading="lazy" decoding="async" />{:else}<Disc3 size={34} aria-hidden="true" />{/if}</span>
        <div><h3>{openAlbum.title}</h3><p>{openAlbum.year || 'Релиз'}{#if openAlbum.trackCount} · {openAlbum.trackCount} треков{/if}</p><button class="mobile-secondary" disabled={!albumTracks?.length} onclick={playAlbum}><Play size={17} fill="currentColor" aria-hidden="true" /> Слушать</button></div>
      </div>
      {#if albumTracks === null}<div class="mobile-artist-status" role="status"><Loader2 size={22} class="animate-spin" /> Загружаем релиз</div>
      {:else if !albumTracks.length}<p class="mobile-hint">Треки этого релиза не загрузились. Вернись к списку и попробуй снова.</p>
      {:else}<div class="mobile-artist-track-list">{#each albumTracks as track, index (index)}
        <div class="mobile-artist-track"><button type="button" class="mobile-artist-track-main" use:mobileHold={{ onHold: () => mobileTrackMenu.set(track) }} onclick={() => play(track, albumTracks || [])}><span class="mobile-artist-track-art">{#if track.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(track, $downloadedCoverCache), 120)} alt="" loading="lazy" decoding="async" onerror={(event) => handleArtworkError(event, track.coverUrl, 120)} onload={handleArtworkLoad} />{:else}<Music2 size={22} aria-hidden="true" />{/if}</span><span class="mobile-artist-track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span></button><button type="button" class="mobile-icon-button mobile-artist-track-menu" aria-label={`Действия с треком ${track.title}`} onclick={() => mobileTrackMenu.set(track)}><MoreHorizontal size={22} aria-hidden="true" /></button></div>
      {/each}</div>{/if}
    </div>
  {:else if loadingAlbums}
    <div class="mobile-artist-status" role="status"><Loader2 size={22} class="animate-spin" /> Загружаем релизы</div>
  {:else if albums.length}
    <div class="mobile-artist-album-grid">
      {#each albums as album (album.id)}
        <button type="button" class="mobile-artist-album" onclick={() => showAlbum(album)}>
          <span class="mobile-artist-album-art">{#if album.coverUrl}<img src={coverUrlAtSize(album.coverUrl, 300)} alt="" loading="lazy" decoding="async" />{:else}<Disc3 size={35} aria-hidden="true" />{/if}</span>
          <strong>{album.title}</strong><small>{album.year || ''}{#if album.trackCount} · {album.trackCount} треков{/if}</small>
        </button>
      {/each}
    </div>
  {:else}<div class="mobile-artist-empty"><Disc3 size={26} aria-hidden="true" /><p>Релизов пока нет.</p></div>{/if}
</section>
