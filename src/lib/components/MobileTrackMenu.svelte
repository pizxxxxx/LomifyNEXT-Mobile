<script lang="ts">
  import { onDestroy, untrack, tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { Heart, ListPlus, EyeOff, Play, Pause, X, Plus, Music2, Download, Trash2, UserRound, Info, ArrowLeft } from 'lucide-svelte';
  import { get } from 'svelte/store';
  import { currentTrack, isPlaying, likedTracks, playlists, settings, listenStats } from '$lib/stores';
  import { loadMobileTrackInfo, mobileTrackInfoRows } from '$lib/mobileTrackInfo';
  import { isTrackLiked, removeMobileLikedTrack, setTrackLiked } from '$lib/likes';
  import { getAudioUrl } from '$lib/api';
  import { addMobileTrackToPlaylist, createMobilePlaylist, hideMobileTrack, mobileTrackMenu, mobileTrackMenuPlaylistId, queueMobileTrackNext, removeMobileTrackFromPlaylist } from '$lib/mobileTracks';
  import { notify } from '$lib/stores';
  import { mobileDownloadJobs, queueMobileDownloads, removeMobileDownload } from '$lib/mobileDownloads';
  import { downloadedCoverCache, coverUrlForTrack, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
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
  let requestGeneration = 0;
  const liked = $derived(selected ? isTrackLiked($likedTracks, selected) : false);

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
    const duration = motionOff ? 0 : reduced ? 120 : open ? 220 : 160;
    const fromOpacity = wasOpen ? getComputedStyle(dialog).opacity : '0';
    const fromTransform = wasOpen ? getComputedStyle(dialog).transform : reduced ? 'none' : 'translateY(12%)';
    const backdropOpacity = wasOpen ? getComputedStyle(dialog, '::backdrop').opacity : '0';
    menuAnimation?.cancel();
    backdropAnimation?.cancel();
    menuAnimation = backdropAnimation = null;
    if (open && !wasOpen) dialog.showModal();
    if (!open && !wasOpen) { selected = null; return; }
    dialog.inert = !open;
    const finish = () => {
      if (generation !== menuGeneration) return;
      if (!open) { dialog.close(); selected = null; }
      menuAnimation?.cancel();
      backdropAnimation?.cancel();
      menuAnimation = backdropAnimation = null;
    };
    if (!duration) { finish(); return; }
    const easing = getComputedStyle(dialog).getPropertyValue('--ease-drawer').trim() || 'cubic-bezier(0.32, 0.72, 0, 1)';
    menuAnimation = dialog.animate([
      { opacity: fromOpacity, transform: fromTransform },
      { opacity: open ? 1 : 0, transform: open || reduced ? 'none' : 'translateY(12%)' }
    ], { duration, easing, fill: 'both' });
    backdropAnimation = dialog.animate([{ opacity: backdropOpacity }, { opacity: open ? 1 : 0 }], {
      duration, easing, fill: 'both', pseudoElement: '::backdrop'
    });
    menuAnimation.onfinish = finish;
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
  function revealDuration(enter: boolean) {
    return $settings.mobileMotion === false || matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0 : enter ? 180 : 120;
  }
  $effect(() => {
    if (!dialog) return;
    const track = requested;
    const request = ++requestGeneration;
    untrack(() => {
      if (track) {
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
  onDestroy(() => { ++infoGeneration; ++requestGeneration; ++menuGeneration; menuAnimation?.cancel(); backdropAnimation?.cancel(); stopPreview(); });
</script>

<dialog bind:this={dialog} class="mobile-track-dialog" class:no-blur={$settings.mobileBlur === false} onclose={onDialogClose} oncancel={(event) => { event.preventDefault(); close(); }} aria-label="Действия с треком">
  {#if selected}
    <div class="mobile-track-menu-content">
      <div class="mobile-menu-heading">
        <div class="mobile-menu-art" aria-hidden="true"><Music2 size={26} />{#if selected.coverUrl}<img src={coverUrlForTrack(selected, $downloadedCoverCache)} alt="" onerror={(event) => handleArtworkError(event, selected.coverUrl)} onload={handleArtworkLoad} />{/if}</div>
        <div><h2>{selected.title}</h2><p class="mobile-menu-artist">{selected.artist}</p></div>
        <button class="mobile-icon-button mobile-menu-close" aria-label="Закрыть меню трека" onclick={close}><X size={22} /></button>
      </div>
      {#if showingInfo}
        <div class="mobile-track-info-title"><button class="mobile-icon-button" aria-label="Назад к действиям с треком" onclick={backToActions}><ArrowLeft size={22} /></button><h3>О треке</h3></div>
        <dl class="mobile-track-info">{#each infoRows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
        {#if infoTrack?.source === 'yandex'}<p class="mobile-hint">Яндекс Музыка не передаёт число прослушиваний этого трека.</p>{/if}
        {#if infoStatus === 'loading'}<p class="mobile-hint" role="status">Обновляем информацию…</p>
        {:else if infoStatus === 'error'}<p class="mobile-hint" role="status">Не удалось обновить информацию. Показаны сохранённые сведения.</p><button class="mobile-text-button" onclick={showTrackInfo}>Повторить</button>{/if}
      {:else}
      {#if $settings.mobilePreview}<button class="mobile-menu-preview" onclick={() => previewing ? stopPreview() : void startPreview(selected)}>{#if previewing}<Pause size={18} /> Остановить превью{:else}<Play size={18} /> Слушать превью{/if}</button>{#if previewStatus}<p class="mobile-menu-status" role="status">{previewStatus}</p>{/if}{/if}
      <div class="mobile-menu-actions">
        <button onclick={showTrackInfo}><Info size={20} aria-hidden="true" />О треке</button>
        <button class="mobile-menu-next" onclick={() => { queueMobileTrackNext(selected); close(); }}><ListPlus size={20} aria-hidden="true" /><span>В очередь<small>Сыграет следующим</small></span></button>
        {#each splitArtists(selected.artist, selected.artists) as artistName (artistName)}
          <button onclick={() => { close(); goToArtist(artistName); }}><UserRound size={20} aria-hidden="true" /><span>К исполнителю<small>{artistName}</small></span></button>
        {/each}
        {#if $downloadedCoverCache.cachedUrns.has(buildTrackUrn(selected))}
          <button onclick={() => { void removeMobileDownload(selected); close(); }}><Trash2 size={20} />Удалить скачанный файл</button>
        {:else}
          <button disabled={!!$mobileDownloadJobs[buildTrackUrn(selected)] && $mobileDownloadJobs[buildTrackUrn(selected)].status !== 'error'} onclick={() => { queueMobileDownloads([selected]); close(); }}><Download size={20} />Скачать на телефон</button>
        {/if}
        <button onclick={() => { if (liked) { removeMobileLikedTrack(selected); notify('Убрано из любимых только в Lomify', 'info'); } else { setTrackLiked(selected, true); notify('Добавлено в любимые', 'success'); } close(); }}><Heart size={20} fill={liked ? 'currentColor' : 'none'} />{liked ? 'Убрать из любимых' : 'Добавить в любимые'}</button>
        {#if liked && selected.source === 'yandex' && $settings.yandexToken}<button class="mobile-danger" onclick={() => { removeMobileLikedTrack(selected, true); notify('Удаляем лайк и в Яндекс Музыке', 'info'); close(); }}><Trash2 size={20} />Убрать и из Яндекс Музыки</button>{/if}
        {#if $mobileTrackMenuPlaylistId}<button onclick={() => { if (removeMobileTrackFromPlaylist($mobileTrackMenuPlaylistId!, selected)) notify('Трек убран из плейлиста', 'success'); close(); }}><Trash2 size={20} />Убрать из этого плейлиста</button>{/if}
        <button onclick={() => { choosingPlaylist = !choosingPlaylist; creatingPlaylist = false; }} aria-expanded={choosingPlaylist}><ListPlus size={20} />В плейлист</button>
        {#if choosingPlaylist}
          <div class="mobile-menu-playlists" in:slide|local={{ duration: revealDuration(true) }} out:slide|local={{ duration: revealDuration(false) }}>
            {#each $playlists as playlist}<button onclick={() => addTo(playlist.id)}><span>{playlist.title}</span><small>{withCount(playlist.tracks?.length || 0, 'трек', 'трека', 'треков')}</small></button>{/each}
            {#if creatingPlaylist}<form in:slide|local={{ duration: revealDuration(true) }} out:slide|local={{ duration: revealDuration(false) }} onsubmit={(event) => { event.preventDefault(); createAndAdd(); }}><label for="mobile-new-playlist">Название плейлиста</label><input id="mobile-new-playlist" bind:value={playlistName} maxlength="80" /><button class="mobile-primary" type="submit" disabled={!playlistName.trim()}>Создать и добавить</button></form>
            {:else}<button onclick={() => creatingPlaylist = true}><Plus size={18} /> Создать плейлист</button>{/if}
          </div>
        {/if}
        <button onclick={() => { hideMobileTrack(selected); close(); }}><EyeOff size={20} />Не показывать больше</button>
      </div>
      {/if}
    </div>
  {/if}
</dialog>
