<script lang="ts">
  import { onMount } from 'svelte';
  import { Home, Search as SearchIcon, Library as LibraryIcon, Settings as SettingsIcon, ArrowLeft, Music2, RefreshCw, Heart, Radio, ArrowUpRight, Download, MoreHorizontal } from 'lucide-svelte';
  import { currentView, currentTrack, isPlaying, queue, likedTracks, settings, notify } from '$lib/stores';
  import { checkMobileUpdate, mobileUpdateState, openMobileUpdate } from '$lib/mobileUpdates';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileDepth } from '$lib/actions/mobileDepth';
  import { mobileTrackKey, mobileTrackMenu, openMobileTrackMenu, stopScWave } from '$lib/mobileTracks';
  import Player from './Player.svelte';
  import Search from './Search.svelte';
  import Library from './MobileLibrary.svelte';
  import Lyrics from './Lyrics.svelte';
  import MobileArtistPage from './MobileArtistPage.svelte';
  import Notifications from './Notifications.svelte';
  import MobileSettings from './MobileSettings.svelte';
  import MobileWave from './MobileWave.svelte';
  import MobileTrackMenu from './MobileTrackMenu.svelte';
  import MobileEqualizer from './MobileEqualizer.svelte';
  import ArtistTag from './ArtistTag.svelte';
  import { coverUrlAtSize, coverUrlForTrack, downloadedCoverCache, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  function waveTransition(_node: Element, _params: unknown, options: { direction: 'in' | 'out' | 'both' }) {
    const reduced = $settings.mobileMotion === false || matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { duration: reduced ? 0 : options.direction === 'out' ? 180 : 260, easing: (t: number) => 1 - Math.pow(1 - t, 4), css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 24}px)` };
  }
  let { tracks, loading, error, retry }: { tracks: any[]; loading: boolean; error: string | null; retry: () => void } = $props();
  const tabs = [
    { id: 'home', label: 'Главная', icon: Home },
    { id: 'search', label: 'Поиск', icon: SearchIcon },
    { id: 'library', label: 'Медиатека', icon: LibraryIcon },
    { id: 'settings', label: 'Настройки', icon: SettingsIcon }
  ] as const;
  let main: HTMLElement;
  let visited = $state<string[]>(['home']);
  function navigate(view: typeof $currentView) {
    if (view === $currentView) return;
    currentView.set(view);
  }
  onMount(() => {
    void checkMobileUpdate();
    const checkOnResume = () => { if (!document.hidden) void checkMobileUpdate(); };
    document.addEventListener('visibilitychange', checkOnResume);
    currentView.set('home');
    history.replaceState({ mobileView: 'home' }, '');
    let restoring = false;
    let previous = $currentView;
    const release = currentView.subscribe(view => {
      if (!visited.includes(view)) visited = [...visited, view];
      if (view === previous) return;
      previous = view;
      if (!restoring) history.pushState({ mobileView: view }, '');
    });
    const back = (e: PopStateEvent) => {
      restoring = true;
      currentView.set(e.state?.mobileView || 'home');
      restoring = false;
    };
    window.addEventListener('popstate', back);
    const androidBack = (event: Event) => {
      if ($mobileTrackMenu) {
        event.preventDefault();
        mobileTrackMenu.set(null);
        return;
      }
      if (history.state?.mobilePlayer || $currentView !== 'home') {
        event.preventDefault();
        history.back();
      }
    };
    window.addEventListener('lomify:android-back', androidBack);
    return () => {
      document.removeEventListener('visibilitychange', checkOnResume);
      release();
      window.removeEventListener('popstate', back);
      window.removeEventListener('lomify:android-back', androidBack);
    };
  });
  function play(track: any, list = tracks) {
    stopScWave();
    queue.set(list.slice(list.indexOf(track) + 1));
    currentTrack.set(track);
    isPlaying.set(true);
  }
</script>

<div class="mobile-app" use:mobileDepth={{ enabled: $settings.mobileDepthMotion === true && $settings.mobileMotion !== false, view: $currentView }} data-motion={$settings.mobileMotion === false ? 'off' : 'on'} data-blur={$settings.mobileBlur ? 'on' : 'off'} data-text-size={$settings.mobileTextSize} data-text-weight={$settings.mobileTextWeight}>
  <header class="mobile-header">
    {#if !tabs.some(t => t.id === $currentView)}
      <button class="mobile-icon-button" aria-label="Назад" onclick={() => history.back()}><ArrowLeft size={24} /></button>
    {:else}
      <img src="/mobile-icon.png" alt="" width="32" height="32" />
    {/if}
    <span>Lomify<span class="mobile-brand-accent">NEXT</span></span>
    <span class="mobile-edition">MOBILE</span>
  </header>
  <main bind:this={main} class="mobile-content" class:has-track={!!$currentTrack} tabindex="-1">
    <div class="mobile-pane" hidden={$currentView !== 'home'} use:mobileReveal={$currentView === 'home'}>
      <section class="mobile-home">
        <h1>Главная</h1>
        {#if $mobileUpdateState.status === 'available' && $mobileUpdateState.update}
          <button class="mobile-update-banner" onclick={() => openMobileUpdate($mobileUpdateState.update!.apkUrl).catch(() => notify('Не удалось открыть загрузку APK. Попробуй через настройки.', 'error'))}>
            <span class="mobile-update-banner-icon"><Download size={20} aria-hidden="true" /></span>
            <span><strong>Доступна версия {$mobileUpdateState.update.version}</strong><small>Скачать APK с GitHub</small></span>
            <ArrowUpRight size={19} aria-hidden="true" />
          </button>
        {/if}
        <button class="mobile-search-shortcut" onclick={() => navigate('search')}><SearchIcon size={22} /><span>Трек, исполнитель или альбом</span></button>
        <button class="mobile-wave-shortcut" class:is-soundcloud={$settings.searchSource !== 'yandex'} onclick={() => navigate('wave')}>
          <span class="mobile-wave-shortcut-icon"><Radio size={30} strokeWidth={1.4} /></span><span><small>{$settings.searchSource === 'yandex' ? 'ЯНДЕКС МУЗЫКА' : 'SOUNDCLOUD'}</small><strong>{$settings.mobileWaveName === 'wave' ? 'Моя Волна' : 'Моя Тусня'}</strong><span>{$settings.searchSource === 'yandex' ? 'Музыка на твоей частоте' : 'Поток из любимых треков'}</span></span><ArrowUpRight size={22} />
        </button>
        <button class="mobile-favorites" onclick={() => navigate('library')}>
          <span class="mobile-favorites-icon"><Heart size={26} /></span>
          <span><strong>Любимые треки</strong><small>{$likedTracks.length} в коллекции</small></span>
          <ArrowLeft size={20} style="transform:rotate(180deg)" />
        </button>
        <div class="mobile-section-heading"><h2>Для тебя <small>{$settings.searchSource === 'yandex' ? 'Яндекс Музыка' : 'SoundCloud'}</small></h2><button class="mobile-icon-button" aria-label="Обновить рекомендации" disabled={loading} onclick={retry}><RefreshCw size={20} /></button></div>
        {#if loading}
          <p class="mobile-hint" role="status">Загружаем музыку…</p>
          <div class="mobile-album-grid" aria-hidden="true">{#each [1,2,3,4] as item}<div class="mobile-skeleton"></div>{/each}</div>
        {:else if error}
          <div class="mobile-empty"><Music2 size={32} /><h3>Музыка пока не загрузилась</h3><p>{error}</p><button class="mobile-primary" onclick={retry}>Попробовать снова</button></div>
        {:else if tracks.length}
          <div class="mobile-album-grid">
            {#each tracks.filter(track => !$settings.mobileHiddenTracks.includes(mobileTrackKey(track))) as track}
              <div class="mobile-album">
                <button class="mobile-album-play" use:mobileHold={{ onHold: () => openMobileTrackMenu(track) }} onclick={() => play(track)} aria-label={`Слушать ${track.title}, ${track.artist}. Удерживай для меню`}>
                  <span class="mobile-album-art"><Music2 size={40} />{#if track.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(track, $downloadedCoverCache), 300)} alt="" loading="lazy" decoding="async" onerror={(event) => handleArtworkError(event, track.coverUrl, 300)} onload={handleArtworkLoad} />{/if}</span>
                </button>
                <div class="mobile-album-caption">
                  <button class="mobile-album-title" onclick={() => play(track)}><strong>{track.title}</strong></button>
                  <button class="mobile-icon-button mobile-album-menu" aria-label={`Меню трека ${track.title}`} onclick={() => openMobileTrackMenu(track)}><MoreHorizontal size={21} aria-hidden="true" /></button>
                </div>
                <div class="mobile-album-artist"><ArtistTag artist={track.artist} artists={track.artists} /></div>
              </div>
            {/each}
          </div>
        {:else}<div class="mobile-empty"><p>Найди первый трек и добавь его в любимые.</p><button class="mobile-primary" onclick={() => navigate('search')}>Найти музыку</button></div>{/if}
      </section>
    </div>
    {#each tabs.filter(tab => tab.id !== 'home') as tab (tab.id)}
      {#if visited.includes(tab.id)}
        <div class="mobile-pane" hidden={$currentView !== tab.id} use:mobileReveal={$currentView === tab.id}>
          {#if tab.id === 'search'}<Search />
          {:else if tab.id === 'library'}<Library />
          {:else}<MobileSettings />{/if}
        </div>
      {/if}
    {/each}
    {#if $currentView === 'wave'}
      <div class="mobile-pane mobile-wave-pane" transition:waveTransition><MobileWave /></div>
    {/if}
    {#if $currentView === 'equalizer'}<div class="mobile-pane" use:mobileReveal={true}><MobileEqualizer /></div>{/if}
    {#if $currentView === 'lyrics' || $currentView === 'artist'}
      <div class="mobile-pane" use:mobileReveal={true}>
        {#if $currentView === 'lyrics'}<Lyrics letterSync={$settings.mobileLyricsLetterSync} mobileMode={true} />{:else}<MobileArtistPage />{/if}
      </div>
    {/if}
  </main>
  <Player mobile />
  <nav class="mobile-nav" aria-label="Основные разделы">
    <span class="mobile-nav-indicator" aria-hidden="true" style:transform={`translateX(${Math.max(0, tabs.findIndex(tab => tab.id === $currentView)) * 100}%)`} style:opacity={tabs.some(tab => tab.id === $currentView) ? 1 : 0}></span>
    {#each tabs as tab}
      <button class:active={$currentView === tab.id} aria-current={$currentView === tab.id ? 'page' : undefined} onclick={() => navigate(tab.id)}><tab.icon size={23} aria-hidden="true" /><span>{tab.label}</span></button>
    {/each}
  </nav>
  <Notifications />
  <MobileTrackMenu />
</div>
