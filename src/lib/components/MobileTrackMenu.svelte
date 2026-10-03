<script lang="ts">
  import { onDestroy, untrack, tick } from 'svelte';
  import { Heart, Radio, ListPlus, EyeOff, Play, Pause, X, Plus, Music2, Download, Trash2, UserRound, Info, ArrowLeft, Check, ChevronRight } from 'lucide-svelte';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { openMobileWave } from '$lib/mobileWaveNavigation';
  import { waveSeedForTrack } from '$lib/wave';
  import { get } from 'svelte/store';
  import { currentTrack, isPlaying, likedTracks, playlists, settings, listenStats } from '$lib/stores';
  import { loadMobileTrackInfo, mobileTrackInfoRows } from '$lib/mobileTrackInfo';
  import { isTrackLiked, removeMobileLikedTrack, setTrackLiked } from '$lib/likes';
  import { getAudioUrl } from '$lib/api';
  import { addMobileTrackToPlaylist, createMobilePlaylist, hideMobileTrack, mobileTrackMenu, mobileTrackMenuPlaylistId, queueMobileTrackNext, removeMobileTrackFromPlaylist } from '$lib/mobileTracks';
  import { notify } from '$lib/stores';
  import { mobileDownloadJobs, queueMobileDownloads, removeMobileDownload } from '$lib/mobileDownloads';
  import { downloadedCoverCache, coverUrlAtSize, coverUrlForTrack, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  import { buildTrackUrn } from '$lib/utils/trackUrn';
  import { splitArtists } from '$lib/utils/artists';
  import { withCount } from '$lib/utils/plural';
  import { goToArtist } from '$lib/utils/navigation';

  let dialog: HTMLDialogElement;
  let preview: HTMLAudioElement | null = null;
  let previewGeneration = 0;
  let previewStatus = $state('');
  let previewing = $state(false);
  let choosingPlaylist = $state(false);
  let creatingPlaylist = $state(false);
  let playlistName = $state('');
  let showingInfo = $state(false);
  let infoTrack = $state<any | null>(null);
  let infoStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let infoGeneration = 0;
  const infoRows = $derived(infoTrack ? mobileTrackInfoRows(infoTrack, $listenStats.history) : []);
  let resumeMain = false;
  let mainTrackKey = '';
  const requested = $derived($mobileTrackMenu);
  let selected = $state<any | null>(null);
  let menuAnimation: Animation | null = null;
  let backdropAnimation: Animation | null = null;
  let menuGeneration = 0;
  let motionFrame = 0;
  let afterClose: (() => void) | null = null;
  let requestGeneration = 0;
  const liked = $derived(selected ? isTrackLiked($likedTracks, selected) : false);
  const downloaded = $derived(selected ? $downloadedCoverCache.cachedUrns.has(buildTrackUrn(selected)) : false);
  const downloadBusy = $derived(selected && !!$mobileDownloadJobs[buildTrackUrn(selected)] && $mobileDownloadJobs[buildTrackUrn(selected)].status !== 'error');
  const trackWave = $derived(waveSeedForTrack(selected));

  function changeLike() {
    if (liked) { removeMobileLikedTrack(selected); notify('Убрано из любимых только в Lomify', 'info'); }
    else { setTrackLiked(selected, true); notify('Добавлено в любимые', 'success'); }
  }
  function startTrackWave() {
    const track = selected;
    afterClose = () => openMobileWave(track);
    close();
  }

  function stopPreview() {
    ++previewGeneration;
    preview?.pause();
    if (preview) preview.src = '';
    preview = null;
    previewing = false;
    if (resumeMain && get(currentTrack) && `${get(currentTrack)?.source}:${get(currentTrack)?.id}` === mainTrackKey) isPlaying.set(true);
    resumeMain = false;
  }

  async function startPreview(track: any) {
    if (!$settings.mobilePreview || !track) return;
    stopPreview();
    const generation = ++previewGeneration;
    resumeMain = get(isPlaying);
    mainTrackKey = `${get(currentTrack)?.source}:${get(currentTrack)?.id}`;
    if (resumeMain) isPlaying.set(false);
    previewStatus = 'Готовим фрагмент';
    try {
      const url = await getAudioUrl(track, { silent: true });
      if (generation !== previewGeneration || !get(mobileTrackMenu)) return;
      if (!url) throw new Error('У трека нет доступного фрагмента');
      const audio = new Audio(url);
      preview = audio;
      audio.volume = .7;
      audio.preload = 'auto';
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 20) audio.currentTime = Math.min(audio.duration * .3, Math.max(0, audio.duration - 12));
      };
      audio.onerror = () => { if (generation === previewGeneration) { previewStatus = 'Превью недоступно для этого потока'; stopPreview(); } };
      await audio.play();
      if (generation !== previewGeneration) { audio.pause(); return; }
      previewing = true;
      previewStatus = 'Играет короткий фрагмент';
      setTimeout(() => { if (generation === previewGeneration) { previewStatus = 'Фрагмент завершён'; stopPreview(); } }, 12000);
    } catch {
      if (generation === previewGeneration) { previewStatus = 'Превью недоступно для этого трека'; stopPreview(); }
    }
  }

  function close() {
    ++infoGeneration;
    stopPreview();
    mobileTrackMenu.set(null);
    mobileTrackMenuPlaylistId.set(null);
  }
  async function showTrackInfo() {
    stopPreview();
    showingInfo = true;
    const track = selected;
    infoTrack = track;
    infoStatus = 'loading';
    const generation = ++infoGeneration;
    try {
      const metadata = await loadMobileTrackInfo(track, $settings.yandexToken);
      if (generation !== infoGeneration) return;
      infoTrack = metadata;
      infoStatus = 'ready';
    } catch {
      if (generation === infoGeneration) infoStatus = 'error';
    }
  }
  function backToActions() { ++infoGeneration; showingInfo = false; }
  function onDialogClose() { if (!dialog.open) close(); }
  function animateMenu(open: boolean) {
    const generation = ++menuGeneration;
    const wasOpen = dialog.open;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motionOff = $settings.mobileMotion === false;
    const duration = motionOff || reduced ? 0 : open ? 420 : 280;
    const fromOpacity = wasOpen ? getComputedStyle(dialog).opacity : '0';
    const fromTransform = wasOpen ? getComputedStyle(dialog).transform : 'translate3d(0,48px,0)';
    const backdropOpacity = wasOpen ? getComputedStyle(dialog, '::backdrop').opacity : '0';
    menuAnimation?.cancel();
    backdropAnimation?.cancel();
    cancelAnimationFrame(motionFrame);
    menuAnimation = backdropAnimation = null;
    if (open && !wasOpen) dialog.showModal();
    if (!open && !wasOpen) { selected = null; return; }
    dialog.inert = !open;
    const finish = () => {
      if (generation !== menuGeneration) return;
      const navigation = !open ? afterClose : null;
      if (!open) { afterClose = null; dialog.close(); selected = null; }
      menuAnimation?.cancel();
      backdropAnimation?.cancel();
      menuAnimation = backdropAnimation = null;
      dialog.style.willChange = '';
      navigation?.();
    };
    if (!duration) { finish(); return; }
    const easing = getComputedStyle(dialog).getPropertyValue('--ease-drawer').trim() || 'cubic-bezier(0.32, 0.72, 0, 1)';
    menuAnimation = dialog.animate([
      { opacity: fromOpacity, transform: fromTransform },
      { opacity: open ? 1 : 0, transform: open ? 'none' : 'translate3d(0,32px,0)' }
    ], { duration, easing, fill: 'both' });
    backdropAnimation = dialog.animate([{ opacity: backdropOpacity }, { opacity: open ? 1 : 0 }], {
      duration, easing, fill: 'both', pseudoElement: '::backdrop'
    });
    menuAnimation.onfinish = finish;
    dialog.style.willChange = 'transform, opacity';
    menuAnimation.pause(); backdropAnimation.pause();
    motionFrame = requestAnimationFrame(() => { motionFrame = requestAnimationFrame(() => {
      motionFrame = 0;
      if (generation === menuGeneration) { menuAnimation?.play(); backdropAnimation?.play(); }
    }); });
  }
  function addTo(id: string) {
    if (!selected) return;
    addMobileTrackToPlaylist(id, selected);
    close();
  }
  function createAndAdd() {
    const id = createMobilePlaylist(playlistName);
    if (!id) return;
    addTo(id);
    playlistName = '';
    creatingPlaylist = false;
  }
  $effect(() => {
    if (!dialog) return;
    const track = requested;
    const request = ++requestGeneration;
    untrack(() => {
      if (track) {
        afterClose = null;
        selected = track;
        stopPreview();
        previewStatus = '';
        choosingPlaylist = false;
        creatingPlaylist = false;
        ++infoGeneration;
        showingInfo = false;
        infoTrack = null;
        infoStatus = 'idle';
      }
      // Mount the heading/actions before showModal chooses focus and starts motion.
      if (track) void tick().then(() => { if (request === requestGeneration) animateMenu(true); });
      else animateMenu(false);
    });
  });
  onDestroy(() => { ++infoGeneration; ++requestGeneration; ++menuGeneration; cancelAnimationFrame(motionFrame); menuAnimation?.cancel(); backdropAnimation?.cancel(); stopPreview(); });
</script>

<dialog bind:this={dialog} class="mobile-track-dialog" class:no-blur={$settings.mobileBlur === false} onclose={onDialogClose} oncancel={(event) => { event.preventDefault(); close(); }} aria-label="Действия с треком">
  {#if selected}
    <div class="mobile-track-menu-content">
      <span class="mobile-menu-handle" aria-hidden="true"></span>
      <div class="mobile-menu-heading">
        <div class="mobile-menu-art" aria-hidden="true"><Music2 size={26} />{#if selected.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(selected, $downloadedCoverCache), 160)} alt="" decoding="async" onerror={(event) => handleArtworkError(event, selected.coverUrl, 160)} onload={handleArtworkLoad} />{/if}</div>
        <div><h2>{selected.title}</h2><p class="mobile-menu-artist">{selected.artist}</p></div>
        <button class="mobile-icon-button mobile-menu-close" aria-label="Закрыть меню трека" onclick={close}><X size={22} /></button>
      </div>
      {#if showingInfo}
        <div use:mobileReveal={true}>
        <div class="mobile-track-info-title"><button class="mobile-icon-button" aria-label="Назад к действиям с треком" onclick={backToActions}><ArrowLeft size={22} /></button><h3>О треке</h3></div>
        <dl class="mobile-track-info">{#each infoRows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
        {#if infoTrack?.source === 'yandex'}<p class="mobile-hint">Яндекс Музыка не передаёт число прослушиваний этого трека.</p>{/if}
        {#if infoStatus === 'loading'}<p class="mobile-hint" role="status">Обновляем информацию…</p>
        {:else if infoStatus === 'error'}<p class="mobile-hint" role="status">Не удалось обновить информацию. Показаны сохранённые сведения.</p><button class="mobile-text-button" onclick={showTrackInfo}>Повторить</button>{/if}
        </div>
      {:else}
      {#if trackWave}
        <button class="mobile-menu-wave" onclick={startTrackWave}><Radio size={26} strokeWidth={1.7} aria-hidden="true" /><span><strong>Моя Волна по треку</strong><small>{selected.title}</small></span><ChevronRight size={19} aria-hidden="true" /></button>
      {/if}
      <div class="mobile-menu-quick-actions">
        <button aria-pressed={liked} onclick={changeLike}><span><Heart size={24} strokeWidth={1.7} fill={liked ? 'currentColor' : 'none'} /></span>{liked ? 'Любимое' : 'Нравится'}</button>
        <button disabled={downloadBusy || downloaded} onclick={() => queueMobileDownloads([selected])}><span>{#if downloaded}<Check size={25} strokeWidth={1.7} />{:else}<Download size={24} strokeWidth={1.7} />{/if}</span>{downloadBusy ? 'Загрузка…' : downloaded ? 'Скачано' : 'Скачать'}</button>
        {#if $settings.mobilePreview}<button aria-pressed={previewing} onclick={() => previewing ? stopPreview() : void startPreview(selected)}><span>{#if previewing}<Pause size={23} fill="currentColor" strokeWidth={0} />{:else}<Play size={23} fill="currentColor" strokeWidth={0} />{/if}</span>Превью</button>
        {:else}<button onclick={showTrackInfo}><span><Info size={24} strokeWidth={1.7} /></span>О треке</button>{/if}
      </div>
      {#if previewStatus}<p class="mobile-menu-status" role="status">{previewStatus}</p>{/if}
      <div class="mobile-menu-actions">
        <button class="mobile-menu-next" onclick={() => { queueMobileTrackNext(selected); close(); }}><ListPlus size={20} aria-hidden="true" /><span>В очередь<small>Сыграет следующим</small></span></button>
        {#each splitArtists(selected.artist, selected.artists) as artistName (artistName)}
          <button onclick={() => { close(); goToArtist(artistName); }}><UserRound size={20} aria-hidden="true" /><span>К исполнителю<small>{artistName}</small></span></button>
        {/each}
        {#if downloaded}
          <button onclick={() => { void removeMobileDownload(selected); close(); }}><Trash2 size={20} />Удалить скачанный файл</button>
        {/if}
        {#if liked && selected.source === 'yandex' && $settings.yandexToken}<button class="mobile-danger" onclick={() => { removeMobileLikedTrack(selected, true); notify('Удаляем лайк и в Яндекс Музыке', 'info'); close(); }}><Trash2 size={20} />Убрать и из Яндекс Музыки</button>{/if}
        {#if $mobileTrackMenuPlaylistId}<button onclick={() => { if (removeMobileTrackFromPlaylist($mobileTrackMenuPlaylistId!, selected)) notify('Трек убран из плейлиста', 'success'); close(); }}><Trash2 size={20} />Убрать из этого плейлиста</button>{/if}
        <button onclick={() => { choosingPlaylist = !choosingPlaylist; creatingPlaylist = false; }} aria-expanded={choosingPlaylist}><ListPlus size={20} />В плейлист</button>
        {#if choosingPlaylist}
          <div class="mobile-menu-playlists" use:mobileReveal={true}>
            {#each $playlists as playlist}<button onclick={() => addTo(playlist.id)}><span>{playlist.title}</span><small>{withCount(playlist.tracks?.length || 0, 'трек', 'трека', 'треков')}</small></button>{/each}
            {#if creatingPlaylist}<form use:mobileReveal={true} onsubmit={(event) => { event.preventDefault(); createAndAdd(); }}><label for="mobile-new-playlist">Название плейлиста</label><input id="mobile-new-playlist" bind:value={playlistName} maxlength="80" /><button class="mobile-primary" type="submit" disabled={!playlistName.trim()}>Создать и добавить</button></form>
            {:else}<button onclick={() => creatingPlaylist = true}><Plus size={18} /> Создать плейлист</button>{/if}
          </div>
        {/if}
        <button onclick={showTrackInfo}><Info size={20} aria-hidden="true" />О треке</button>
        <button onclick={() => { hideMobileTrack(selected); close(); }}><EyeOff size={20} />Не показывать больше</button>
      </div>
      {/if}
    </div>
  {/if}
</dialog>
