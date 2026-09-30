<script lang="ts">
  import { onMount } from 'svelte';
  import { Disc3, Info, Loader2, MoreHorizontal, Music2, Play, RefreshCw, UserRound, ChevronLeft, Star, Share2 } from 'lucide-svelte';
  import { currentArtist, currentTrack, isPlaying, queue, settings, notify } from '$lib/stores';
  import { getArtistAlbums, getArtistProfile, getArtistTracks, getAlbumTracks, trackByArtist, type ArtistSource } from '$lib/api';
  import { coverUrlAtSize, coverUrlForTrack, downloadedCoverCache, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { mobileTrackMenu, stopScWave } from '$lib/mobileTracks';
  import { loadMobileArtists, mobileArtistKey, mobileSavedArtists, toggleMobileArtist } from '$lib/mobileArtists';

  let source = $state<ArtistSource>($settings.searchSource === 'yandex' && $settings.yandexToken ? 'yandex' : 'soundcloud');
  let tab = $state<'tracks' | 'albums'>('tracks');
  let tracks = $state.raw<any[]>([]);
  let albums = $state.raw<any[]>([]);
  let profile = $state<Awaited<ReturnType<typeof getArtistProfile>>>(null);
  let loadingTracks = $state(true);
  let loadingAlbums = $state(true);
  let loadError = $state(false);
  let retry = $state(0);
  let visibleCount = $state(40);
  let openAlbum = $state<any | null>(null);
  let albumTracks = $state<any[] | null>(null);
  let albumRequest = 0;
  let avatar = $derived(profile?.avatarUrl || profile?.bannerUrl || tracks[0]?.artistAvatarUrl || tracks[0]?.coverUrl || '');
  let featuredAlbum = $derived(albums[0]);
  let showAbout = $state(false);
  let isSaved = $derived($mobileSavedArtists.some(artist => mobileArtistKey(artist.name) === mobileArtistKey($currentArtist)));
  onMount(loadMobileArtists);

  function saveArtist() {
    const saved = toggleMobileArtist($currentArtist, avatar);
    notify(saved ? 'Исполнитель добавлен в медиатеку' : 'Исполнитель убран из медиатеки', 'success');
  }

  async function shareArtist() {
    const url = profile?.permalink;
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: $currentArtist, url });
      else { await navigator.clipboard.writeText(url); notify('Ссылка на исполнителя скопирована', 'success'); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify('Не удалось поделиться ссылкой. Попробуй ещё раз.', 'info');
    }
  }

  $effect(() => {
    const name = $currentArtist.trim();
    const selectedSource = source;
    void retry;
    let current = true;
    albumRequest++;
    tracks = [];
    albums = [];
    profile = null;
    showAbout = false;
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
    {#if avatar}<img class="mobile-artist-portrait" src={coverUrlAtSize(avatar, 800)} alt="" loading="eager" decoding="async" onerror={(event) => handleArtworkError(event, avatar, 800)} onload={handleArtworkLoad} />{:else}<UserRound class="mobile-artist-portrait-fallback" size={120} aria-hidden="true" />{/if}
    <div class="mobile-artist-toolbar">
      <button class="mobile-icon-button mobile-glass-button" type="button" aria-label="Назад" onclick={() => history.back()}><ChevronLeft size={27} aria-hidden="true" /></button>
      {#if profile?.permalink}<button class="mobile-icon-button mobile-glass-button" type="button" aria-label="Поделиться исполнителем" onclick={() => void shareArtist()}><Share2 size={23} aria-hidden="true" /></button>{/if}
    </div>
    <div class="mobile-artist-hero-content">
      <div class="mobile-artist-identity">
        <h1>{$currentArtist}</h1>
      </div>
      <div class="mobile-artist-hero-actions">
        <button class="mobile-icon-button mobile-glass-button" type="button" aria-label="Об исполнителе" aria-expanded={showAbout} onclick={() => showAbout = !showAbout}><Info size={24} aria-hidden="true" /></button>
        <button class="mobile-artist-main-play" type="button" disabled={!tracks.length} aria-label="Слушать треки исполнителя" onclick={() => play(tracks[0], tracks)}>{#if loadingTracks}<Loader2 class="animate-spin" size={29} aria-hidden="true" />{:else}<Play size={32} fill="currentColor" aria-hidden="true" />{/if}</button>
        <button class="mobile-icon-button mobile-glass-button" type="button" aria-label={isSaved ? 'Убрать исполнителя из медиатеки' : 'Добавить исполнителя в медиатеку'} aria-pressed={isSaved} onclick={saveArtist}><Star size={24} fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true" /></button>
      </div>
    </div>
  </header>

  <div class="mobile-artist-body">
  {#if showAbout}<section class="mobile-artist-about" aria-label="Об исполнителе"><h2>{$currentArtist}</h2>{#if profile?.description}<p>{profile.description}</p>{/if}<p>{source === 'yandex' ? 'Яндекс Музыка' : 'SoundCloud'} · Треки: {tracks.length} · Релизы: {albums.length}</p></section>{/if}
  <div class="mobile-artist-source" role="group" aria-label="Источник музыки">
    <button type="button" aria-pressed={source === 'soundcloud'} onclick={() => selectSource('soundcloud')}>SoundCloud</button>
    <button type="button" aria-pressed={source === 'yandex'} aria-disabled={!$settings.yandexToken} onclick={() => selectSource('yandex')}>Яндекс Музыка</button>
  </div>

  {#if featuredAlbum && !openAlbum}
    <button type="button" class="mobile-artist-featured" onclick={() => void showAlbum(featuredAlbum)}>
      <span class="mobile-artist-featured-art">{#if featuredAlbum.coverUrl}<img src={coverUrlAtSize(featuredAlbum.coverUrl, 240)} alt="" loading="lazy" decoding="async" />{:else}<Disc3 size={32} aria-hidden="true" />{/if}</span>
      <span class="mobile-artist-featured-copy"><small>{featuredAlbum.year || 'Релиз исполнителя'}</small><strong>{featuredAlbum.title}</strong><small>{featuredAlbum.trackCount === 1 ? 'Сингл' : 'Альбом'}</small></span>
      <ChevronLeft class="mobile-artist-featured-arrow" size={21} aria-hidden="true" />
    </button>
  {/if}

  <div class="mobile-artist-heading">
    <h2>{tab === 'tracks' ? 'Популярные треки' : 'Релизы'}</h2>
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
      <div class="mobile-artist-track-list" use:mobileReveal={true}>
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
    <div class="mobile-artist-album-detail" use:mobileReveal={String(openAlbum.id)}>
      <button type="button" class="mobile-artist-back" onclick={closeAlbum}><ChevronLeft size={19} aria-hidden="true" /> Все релизы</button>
      <div class="mobile-artist-album-head">
        <span class="mobile-artist-album-art">{#if openAlbum.coverUrl}<img src={coverUrlAtSize(openAlbum.coverUrl, 240)} alt="" loading="lazy" decoding="async" />{:else}<Disc3 size={34} aria-hidden="true" />{/if}</span>
        <div><h3>{openAlbum.title}</h3><p>{openAlbum.year || 'Релиз'}{#if openAlbum.trackCount} · {openAlbum.trackCount} треков{/if}</p><button class="mobile-secondary" disabled={!albumTracks?.length} onclick={playAlbum}><Play size={17} fill="currentColor" aria-hidden="true" /> Слушать</button></div>
      </div>
      {#if albumTracks === null}<div class="mobile-artist-status" role="status"><Loader2 size={22} class="animate-spin" /> Загружаем релиз</div>
      {:else if !albumTracks.length}<p class="mobile-hint">Треки этого релиза не загрузились. Вернись к списку и попробуй снова.</p>
      {:else}<div class="mobile-artist-track-list" use:mobileReveal={true}>{#each albumTracks as track, index (index)}
        <div class="mobile-artist-track"><button type="button" class="mobile-artist-track-main" use:mobileHold={{ onHold: () => mobileTrackMenu.set(track) }} onclick={() => play(track, albumTracks || [])}><span class="mobile-artist-track-art">{#if track.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(track, $downloadedCoverCache), 120)} alt="" loading="lazy" decoding="async" onerror={(event) => handleArtworkError(event, track.coverUrl, 120)} onload={handleArtworkLoad} />{:else}<Music2 size={22} aria-hidden="true" />{/if}</span><span class="mobile-artist-track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span></button><button type="button" class="mobile-icon-button mobile-artist-track-menu" aria-label={`Действия с треком ${track.title}`} onclick={() => mobileTrackMenu.set(track)}><MoreHorizontal size={22} aria-hidden="true" /></button></div>
      {/each}</div>{/if}
    </div>
  {:else if loadingAlbums}
    <div class="mobile-artist-status" role="status"><Loader2 size={22} class="animate-spin" /> Загружаем релизы</div>
  {:else if albums.length}
    <div class="mobile-artist-album-grid" use:mobileReveal={true}>
      {#each albums as album (album.id)}
        <button type="button" class="mobile-artist-album" onclick={() => showAlbum(album)}>
          <span class="mobile-artist-album-art">{#if album.coverUrl}<img src={coverUrlAtSize(album.coverUrl, 300)} alt="" loading="lazy" decoding="async" />{:else}<Disc3 size={35} aria-hidden="true" />{/if}</span>
          <strong>{album.title}</strong><small>{album.year || ''}{#if album.trackCount} · {album.trackCount} треков{/if}</small>
        </button>
      {/each}
    </div>
  {:else}<div class="mobile-artist-empty"><Disc3 size={26} aria-hidden="true" /><p>Релизов пока нет.</p></div>{/if}
  </div>
</section>
