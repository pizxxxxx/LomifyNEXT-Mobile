<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { Heart, Music2, ArrowLeft, Play, Plus, MoreHorizontal, Download, Check, Trash2, ChevronRight, Pencil, ImagePlus, Shuffle } from 'lucide-svelte';
  import { likedTracks, playlists, currentTrack, isPlaying, queue, settings, notify, currentView } from '$lib/stores';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { createMobilePlaylist, deleteMobilePlaylist, mobileTrackKey, openMobileTrackMenu, renameMobilePlaylist, restoreMobilePlaylistOrder, shuffleMobilePlaylist, stopScWave } from '$lib/mobileTracks';
  import { createMobileShakeDetector } from '$lib/mobileShake';
  import { loadMobilePlaylistCovers, mobilePlaylistCoverUrls, prepareMobilePlaylistCover, removeMobilePlaylistCover, setMobilePlaylistCover } from '$lib/mobilePlaylistCovers';
  import { clearMobileLikedTracks, flushYandexQueue, pendingYandexLikeRemovals } from '$lib/likes';
  import { mobileDownloads, mobileDownloadJobs, queueMobileDownloads, stopMobileDownloadQueue } from '$lib/mobileDownloads';
  import { coverUrlAtSize, coverUrlForTrack, downloadedCoverCache, handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  import { buildTrackUrn } from '$lib/utils/trackUrn';
  import ArtistTag from './ArtistTag.svelte';
  type LibrarySection = 'overview' | 'likes' | 'downloads' | 'playlist';
  let section = $state<LibrarySection>('overview');
  let offlineOnly = $derived(section === 'downloads');
  const downloadCount = $derived(Object.values($mobileDownloadJobs).filter(job => job.status !== 'error').length);
  let playlistId = $state<string | null>(null);
  let creating = $state(false);
  let newName = $state('');
  let editing = $state(false);
  let editName = $state('');
  let editCover = $state<Blob | null>(null);
  let editPreview = $state('');
  let editRemoveCover = $state(false);
  let editBusy = $state(false);
  let editError = $state('');
  let coverInput = $state<HTMLInputElement | null>(null);
  let editGeneration = 0;
  let confirmAction = $state<'playlist' | 'likes' | null>(null);
  let removeYandexAlso = $state(false);
  let clearingLikes = $state(false);
  let clearCount = $state(0);
  let clearStage = $state('');
  let selected = $derived($playlists.find(p => p.id === playlistId));
  let undoPlaylistId = $state<string | null>(null);
  let undoOrder = $state<string[] | null>(null);
  let tracks = $derived((selected ? selected.tracks || [] : offlineOnly ? $mobileDownloads : section === 'likes' ? $likedTracks : []).filter((track: any) => !$settings.mobileHiddenTracks.includes(mobileTrackKey(track)) && (!offlineOnly || $downloadedCoverCache.cachedUrns.has(buildTrackUrn(track)))));
  let canDownloadAll = $derived(tracks.some((track: any) => !$downloadedCoverCache.cachedUrns.has(buildTrackUrn(track))));
  // The list can contain hundreds of liked tracks. Keep only the viewport plus
  // a generous buffer in the DOM; the full array still backs queue playback.
  const ROW_HEIGHT = 88;
  const OVERSCAN = 6;
  let listElement = $state<HTMLElement | null>(null);
  let libraryRoot: HTMLElement;
  let scrollRoot: HTMLElement | null = null;
  let startIndex = $state(0);
  let windowSize = $state(24);
  let visibleStart = $derived(Math.min(startIndex, Math.max(0, tracks.length - windowSize)));
  let visibleTracks = $derived(tracks.slice(visibleStart, visibleStart + windowSize));
  function countTracks(count: number) {
    const lastTwo = count % 100;
    const word = lastTwo >= 11 && lastTwo <= 14 ? 'треков' : count % 10 === 1 ? 'трек' : count % 10 >= 2 && count % 10 <= 4 ? 'трека' : 'треков';
    return `${count} ${word}`;
  }
  let topSpacer = $derived(visibleStart * ROW_HEIGHT);
  let bottomSpacer = $derived(Math.max(0, tracks.length - visibleStart - visibleTracks.length) * ROW_HEIGHT);
  function refreshWindow() {
    if (!scrollRoot || !listElement || !scrollRoot.clientHeight) return;
    const listTop = listElement.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop;
    const row = Math.floor(Math.max(0, scrollRoot.scrollTop - listTop) / ROW_HEIGHT);
    startIndex = Math.max(0, row - OVERSCAN);
    windowSize = Math.ceil(scrollRoot.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
  }
  onMount(() => {
    void loadMobilePlaylistCovers().catch(error => console.warn('[playlists] обложки недоступны', error));
    scrollRoot = libraryRoot.closest<HTMLElement>('.mobile-pane');
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; refreshWindow(); });
    };
    scrollRoot?.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    if (scrollRoot) resize.observe(scrollRoot);
    const syncLocation = (state: any) => {
      if (state?.mobileView !== 'library') return;
      section = ['likes', 'downloads', 'playlist'].includes(state.mobileLibrarySection) ? state.mobileLibrarySection : 'overview';
      playlistId = section === 'playlist' ? String(state.mobilePlaylistId || '') : null;
      if (playlistId !== undoPlaylistId) { undoPlaylistId = null; undoOrder = null; }
      confirmAction = null;
      cancelEdit();
      startIndex = 0;
      requestAnimationFrame(schedule);
    };
    const onBack = (event: PopStateEvent) => syncLocation(event.state);
    window.addEventListener('popstate', onBack);
    const unsubscribe = currentView.subscribe(view => { if (view === 'library') syncLocation(history.state); });
    schedule();
    return () => {
      scrollRoot?.removeEventListener('scroll', schedule);
      window.removeEventListener('popstate', onBack);
      unsubscribe();
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearEditPreview();
    };
  });
  $effect(() => {
    if (section !== 'playlist' || !selected || $currentView !== 'library' || !$settings.mobileShakeShuffle) return;
    const detect = createMobileShakeDetector(() => {
      if (document.visibilityState === 'visible' && !editing && !confirmAction) shuffleSelected();
    });
    window.addEventListener('devicemotion', detect, { passive: true });
    return () => window.removeEventListener('devicemotion', detect);
  });
  function shuffleSelected() {
    if (!selected) return;
    const id = String(selected.id);
    const previous = shuffleMobilePlaylist(id);
    if (!previous) return;
    if (undoPlaylistId !== id || !undoOrder) { undoPlaylistId = id; undoOrder = previous; }
  }
  function undoShuffle() {
    if (undoPlaylistId && undoOrder) restoreMobilePlaylistOrder(undoPlaylistId, undoOrder);
    undoPlaylistId = null;
    undoOrder = null;
  }
  function openSection(next: LibrarySection, id: string | null = null) {
    history.pushState({ mobileView: 'library', mobileLibrarySection: next, mobilePlaylistId: id }, '');
    section = next;
    playlistId = next === 'playlist' ? id : null;
    undoPlaylistId = null;
    undoOrder = null;
    confirmAction = null;
    cancelEdit();
    removeYandexAlso = false;
    startIndex = 0;
    scrollRoot?.scrollTo({ top: 0 });
    requestAnimationFrame(refreshWindow);
  }
  function backToOverview() {
    cancelEdit();
    undoPlaylistId = null;
    undoOrder = null;
    if (history.state?.mobileLibrarySection) history.back();
    else { section = 'overview'; playlistId = null; }
  }
  function play(track: any) {
    stopScWave();
    queue.set(tracks.slice(tracks.indexOf(track) + 1));
    currentTrack.set(track);
    isPlaying.set(true);
  }
  function create() {
    const id = createMobilePlaylist(newName);
    if (!id) { notify('Введите название плейлиста', 'info'); return; }
    newName = '';
    creating = false;
    openSection('playlist', id);
  }
  function clearEditPreview() {
    if (editPreview) URL.revokeObjectURL(editPreview);
    editPreview = '';
    editCover = null;
  }
  function cancelEdit() {
    editGeneration++;
    clearEditPreview();
    editing = false;
    editRemoveCover = false;
    editBusy = false;
    editError = '';
  }
  function startEdit() {
    if (!selected) return;
    confirmAction = null;
    editName = selected.title || '';
    editRemoveCover = false;
    editError = '';
    editing = true;
  }
  async function chooseCover(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const generation = editGeneration;
    editBusy = true;
    editError = '';
    try {
      const blob = await prepareMobilePlaylistCover(file);
      if (!editing || generation !== editGeneration) return;
      clearEditPreview();
      editCover = blob;
      editPreview = URL.createObjectURL(blob);
      editRemoveCover = false;
    } catch (error) {
      if (generation === editGeneration) editError = error instanceof Error ? error.message : 'Не удалось открыть изображение.';
    } finally {
      if (generation === editGeneration) editBusy = false;
    }
  }
  async function saveEdit() {
    if (!selected || editBusy) return;
    const generation = editGeneration;
    const id = String(selected.id);
    const title = editName.trim().slice(0, 80);
    if (!title) { editError = 'Введите название плейлиста.'; return; }
    editBusy = true;
    editError = '';
    try {
      if (editCover) await setMobilePlaylistCover(id, editCover);
      else if (editRemoveCover) await removeMobilePlaylistCover(id);
      if (!renameMobilePlaylist(id, title)) throw new Error('Плейлист больше не найден.');
      if (generation === editGeneration) {
        cancelEdit();
        notify('Плейлист обновлён', 'success');
      }
    } catch (error) {
      if (generation === editGeneration) editError = error instanceof Error ? error.message : 'Не удалось сохранить плейлист.';
    } finally {
      if (generation === editGeneration) editBusy = false;
    }
  }
  function deleteSelectedPlaylist() {
    if (!selected || confirmAction !== 'playlist') return;
    const title = selected.title;
    const id = String(selected.id);
    if (deleteMobilePlaylist(id)) {
      void removeMobilePlaylistCover(id).catch(error => console.warn('[playlists] не удалось удалить обложку', error));
      notify(`Плейлист «${title}» удалён из Lomify`, 'success');
    }
    backToOverview();
  }
  async function clearLikes() {
    if (confirmAction !== 'likes' || clearingLikes) return;
    const remote = removeYandexAlso && !!$settings.yandexToken;
    let remoteIds: string[] = [];
    if (remote) {
      clearingLikes = true;
      clearStage = 'Получаем все лайки Яндекса...';
      try {
        const { getYandexLikeIds } = await import('$lib/yandex');
        remoteIds = await getYandexLikeIds($settings.yandexToken);
      } catch (error) {
        clearingLikes = false;
        notify('Не удалось получить все лайки Яндекса. Ничего не удалено. Проверь сеть или сними галочку.', 'error');
        console.warn('[likes] список удаляемых лайков не получен', error);
        return;
      }
    }
    const count = clearMobileLikedTracks(remote, remoteIds);
    if (remote) {
      clearStage = 'Снимаем лайки в Яндекс Музыке...';
      try {
        // A previous in-flight edit may own the first flush. The second pass sends this bulk edit.
        await flushYandexQueue();
        await flushYandexQueue();
      } catch (error) {
        console.warn('[likes] массовое снятие лайков отложено', error);
      } finally {
        clearingLikes = false;
      }
    }
    const pending = remote ? pendingYandexLikeRemovals() : 0;
    notify(pending
      ? `Из Lomify убрано ${count} треков. Яндекс не ответил: повторим при следующем запуске.`
      : `Из любимых убрано ${count} треков`, pending ? 'info' : 'success');
    confirmAction = null;
    removeYandexAlso = false;
  }
  function revealDuration(enter: boolean) {
    return $settings.mobileMotion === false || matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0 : enter ? 180 : 120;
  }
</script>
<section class="mobile-library" bind:this={libraryRoot}>
  {#if section === 'overview'}
    <h1>Медиатека</h1>
    <div class="mobile-section-heading mobile-library-heading"><h2>Мои коллекции</h2></div>
    <div class="mobile-library-collections">
      <button class="mobile-library-collection" onclick={() => openSection('likes')}><span class="mobile-library-collection-icon"><Heart size={24} aria-hidden="true" /></span><span><strong>Любимые треки</strong><small>{countTracks($likedTracks.length)}</small></span><ChevronRight size={20} aria-hidden="true" /></button>
      <button class="mobile-library-collection" onclick={() => openSection('downloads')}><span class="mobile-library-collection-icon"><Download size={24} aria-hidden="true" /></span><span><strong>Скачанное</strong><small>{countTracks($mobileDownloads.length)} на телефоне</small></span><ChevronRight size={20} aria-hidden="true" /></button>
    </div>
    <div class="mobile-section-heading mobile-library-heading"><h2>Плейлисты · {$playlists.length}</h2><button class="mobile-icon-button" aria-label="Создать плейлист" onclick={() => creating = !creating}><Plus size={23} /></button></div>
    {#if creating}<form class="mobile-create-playlist" in:slide|local={{ duration: revealDuration(true) }} out:slide|local={{ duration: revealDuration(false) }} onsubmit={(event) => { event.preventDefault(); create(); }}><label for="mobile-playlist-name">Название плейлиста</label><input id="mobile-playlist-name" bind:value={newName} maxlength="80" placeholder="Например, в дорогу" /><button class="mobile-primary" type="submit">Создать</button></form>{/if}
    {#if $playlists.length}<div class="mobile-playlists">{#each $playlists as playlist (playlist.id)}<button class="mobile-playlist-card" onclick={() => openSection('playlist', String(playlist.id))}><span><Music2 size={28} aria-hidden="true" />{#if $mobilePlaylistCoverUrls[String(playlist.id)]}<img src={$mobilePlaylistCoverUrls[String(playlist.id)]} alt="" loading="lazy" />{:else if playlist.tracks?.[0]?.coverUrl}<img src={playlist.tracks[0].coverUrl} alt="" loading="lazy" onerror={(event) => handleArtworkError(event, playlist.tracks[0].coverUrl)} onload={handleArtworkLoad} />{/if}</span><strong>{playlist.title}</strong><small>{countTracks(playlist.tracks?.length || 0)}</small></button>{/each}</div>{/if}
  {:else}
  <button class="mobile-library-back" onclick={backToOverview}><ArrowLeft size={20} aria-hidden="true" /> Медиатека</button>
  {#if selected && undoPlaylistId === String(selected.id) && undoOrder}<div class="mobile-playlist-undo" role="status"><span>Плейлист перемешан</span><button onclick={undoShuffle}>Отменить</button></div>{/if}
  {#if selected}
    <div class="mobile-playlist-detail-head">
      <span class="mobile-playlist-detail-cover"><Music2 size={28} aria-hidden="true" />{#if $mobilePlaylistCoverUrls[String(selected.id)]}<img src={$mobilePlaylistCoverUrls[String(selected.id)]} alt="" />{:else if selected.tracks?.[0]?.coverUrl}<img src={selected.tracks[0].coverUrl} alt="" onerror={(event) => handleArtworkError(event, selected.tracks[0].coverUrl)} onload={handleArtworkLoad} />{/if}</span>
      <div><h1>{selected.title}</h1><p>{countTracks(selected.tracks?.length || 0)} · хранится в Lomify</p></div>
    </div>
  {:else}<h1>{offlineOnly ? 'Скачанное' : 'Любимые треки'}</h1>{/if}
  {#if selected && editing}
    <form class="mobile-playlist-editor" onsubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
      <label for="mobile-playlist-edit-name">Название плейлиста</label>
      <input id="mobile-playlist-edit-name" bind:value={editName} maxlength="80" aria-invalid={!!editError && !editName.trim()} aria-describedby={editError ? 'mobile-playlist-edit-error' : undefined} />
      <span class="mobile-playlist-editor-label">Обложка</span>
      <div class="mobile-playlist-editor-cover-row">
        <span class="mobile-playlist-editor-preview"><Music2 size={28} aria-hidden="true" />{#if editPreview}<img src={editPreview} alt="Выбранная обложка" />{:else if !editRemoveCover && $mobilePlaylistCoverUrls[String(selected.id)]}<img src={$mobilePlaylistCoverUrls[String(selected.id)]} alt="Текущая обложка" />{:else if selected.tracks?.[0]?.coverUrl}<img src={selected.tracks[0].coverUrl} alt="Обложка первого трека" onerror={(event) => handleArtworkError(event, selected.tracks[0].coverUrl)} onload={handleArtworkLoad} />{/if}</span>
        <div><input class="mobile-playlist-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" bind:this={coverInput} onchange={(event) => void chooseCover(event)} /><button class="mobile-secondary" type="button" disabled={editBusy} onclick={() => coverInput?.click()}><ImagePlus size={18} aria-hidden="true" /> Выбрать фото</button>{#if editPreview || (!editRemoveCover && $mobilePlaylistCoverUrls[String(selected.id)])}<button class="mobile-playlist-reset" type="button" disabled={editBusy} onclick={() => { clearEditPreview(); editRemoveCover = true; }}>Вернуть обложку трека</button>{/if}</div>
      </div>
      <p class="mobile-playlist-editor-hint">Фото обрежется до квадрата и сохранится только на этом устройстве.</p>
      {#if editError}<p id="mobile-playlist-edit-error" class="mobile-playlist-editor-error" role="alert">{editError}</p>{/if}
      <div class="mobile-playlist-editor-actions"><button class="mobile-secondary" type="button" disabled={editBusy} onclick={cancelEdit}>Отмена</button><button class="mobile-primary" type="submit" disabled={editBusy}>{editBusy ? 'Сохраняем...' : 'Сохранить'}</button></div>
    </form>
  {/if}
  <div class="mobile-section-heading mobile-library-heading"><h2>Треки · {tracks.length}</h2>{#if tracks.length}<button class="mobile-icon-button" aria-label="Слушать все" onclick={() => play(tracks[0])}><Play size={24} /></button>{/if}</div>
  {#if selected || (!offlineOnly && ($likedTracks.length || clearingLikes)) || downloadCount || canDownloadAll}
    <div class="mobile-library-actions">
      {#if selected}<button class="mobile-secondary" disabled={(selected.tracks?.length || 0) < 2} onclick={shuffleSelected}><Shuffle size={18} aria-hidden="true" /> Перемешать</button><button class="mobile-secondary" aria-expanded={editing} onclick={() => editing ? cancelEdit() : startEdit()}><Pencil size={18} aria-hidden="true" /> {editing ? 'Закрыть' : 'Изменить'}</button><button class="mobile-secondary mobile-danger mobile-library-danger" onclick={() => { cancelEdit(); confirmAction = confirmAction === 'playlist' ? null : 'playlist'; }}><Trash2 size={18} aria-hidden="true" /> Удалить плейлист</button>{/if}
      {#if !selected && !offlineOnly && ($likedTracks.length || clearingLikes)}<button class="mobile-secondary mobile-danger mobile-library-danger" aria-label="Очистить любимые треки" disabled={clearingLikes} onclick={() => { confirmAction = confirmAction === 'likes' ? null : 'likes'; clearCount = $likedTracks.length; removeYandexAlso = false; }}><Trash2 size={18} aria-hidden="true" /> Очистить</button>{/if}
      {#if downloadCount}<div class="mobile-download-queue" role="status"><span>В очереди: {downloadCount}</span><button class="mobile-secondary" onclick={stopMobileDownloadQueue}>Остановить</button></div>
      {:else if canDownloadAll}<button class="mobile-secondary" onclick={() => queueMobileDownloads(tracks)}><Download size={18} aria-hidden="true" /> Скачать всё</button>{/if}
    </div>
  {/if}
  {#if selected && confirmAction === 'playlist'}
    <div class="mobile-destructive-confirm" role="group" aria-label="Подтверждение удаления плейлиста">
      <strong>Удалить «{selected.title}»?</strong>
      <p>Плейлист исчезнет только из Lomify. В Яндекс Музыке или SoundCloud он останется. Скачанные треки тоже останутся на телефоне.</p>
      <div><button class="mobile-secondary" onclick={() => confirmAction = null}>Отмена</button><button class="mobile-secondary mobile-danger" onclick={deleteSelectedPlaylist}>Удалить плейлист</button></div>
    </div>
  {/if}
  {#if !selected && confirmAction === 'likes'}
      <div class="mobile-destructive-confirm" role="group" aria-label="Подтверждение очистки любимых треков">
        <strong>{clearingLikes ? clearStage : `Убрать все ${clearCount} треков из любимых?`}</strong>
        <p>Плейлисты и скачанные файлы останутся. SoundCloud не изменится. Если включена защита в настройках, удалённые лайки Яндекса не вернутся при импорте.</p>
        {#if $settings.yandexToken}
          <label class="mobile-delete-remote"><input type="checkbox" disabled={clearingLikes} bind:checked={removeYandexAlso} /><span>Также снять все лайки в аккаунте Яндекс Музыки</span></label>
          {#if removeYandexAlso}<p>Это затронет и треки, которых сейчас нет на телефоне. Отменить снятие лайков в аккаунте не получится.</p>{/if}
        {/if}
        <div><button class="mobile-secondary" disabled={clearingLikes} onclick={() => confirmAction = null}>Отмена</button><button class="mobile-secondary mobile-danger" disabled={clearingLikes} onclick={() => void clearLikes()}>{clearingLikes ? 'Снимаем лайки...' : 'Очистить'}</button></div>
      </div>
  {/if}
  {#if !tracks.length}<div class="mobile-empty"><Heart size={36} /><h3>{offlineOnly ? 'Пока нет скачанных треков' : 'Здесь будет твоя музыка'}</h3><p>{offlineOnly ? 'Открой все треки, нажми три точки у нужного и выбери «Скачать на телефон».' : 'Нажми сердечко в плеере, чтобы добавить трек в любимое.'}</p></div>{/if}
  <div class="mobile-track-list" bind:this={listElement} role="list" aria-label={selected ? 'Треки плейлиста' : offlineOnly ? 'Скачанные треки' : 'Любимые треки'}>
    <div class="mobile-track-spacer" style:height={`${topSpacer}px`} aria-hidden="true"></div>
    {#each visibleTracks as track, index (mobileTrackKey(track))}
      {@const urn = buildTrackUrn(track)}
      {@const downloaded = $downloadedCoverCache.cachedUrns.has(urn)}
      {@const job = $mobileDownloadJobs[urn]}
      <div class="mobile-track-row" role="listitem" aria-posinset={visibleStart + index + 1} aria-setsize={tracks.length}>
        <div class="mobile-mini-info" use:mobileHold={{ onHold: () => openMobileTrackMenu(track, selected ? String(selected.id) : null) }}>
          <button class="mobile-mini-play" aria-label={`Слушать ${track.title}`} onclick={() => play(track)}><span class="mobile-mini-art"><Music2 size={22} />{#if track.coverUrl}<img src={coverUrlAtSize(coverUrlForTrack(track, $downloadedCoverCache), 120)} alt="" loading="lazy" decoding="async" onerror={(event) => handleArtworkError(event, track.coverUrl, 120)} onload={handleArtworkLoad} />{/if}</span></button>
          <span class="mobile-mini-copy"><button class="mobile-mini-title" onclick={() => play(track)}><span>{track.title}</span></button>{#if job?.status === 'error' || job?.status === 'downloading' || job?.status === 'queued'}<small>{job?.status === 'error' ? job.error : job?.status === 'downloading' ? `Скачивание ${job.progress ? `${job.progress}%` : ''}` : 'В очереди'}</small>{:else}<span class="mobile-mini-artist"><ArtistTag artist={track.artist} artists={track.artists} /></span>{/if}</span>
        </div>
        {#if downloaded}<span class="mobile-downloaded-mark" role="img" aria-label="Скачано"><Check size={15} aria-hidden="true" /></span>{/if}
        <button class="mobile-icon-button" aria-label={`Меню трека ${track.title}`} onclick={() => openMobileTrackMenu(track, selected ? String(selected.id) : null)}><MoreHorizontal size={22} /></button>
      </div>
    {/each}
    <div class="mobile-track-spacer" style:height={`${bottomSpacer}px`} aria-hidden="true"></div>
  </div>
  {/if}
</section>
