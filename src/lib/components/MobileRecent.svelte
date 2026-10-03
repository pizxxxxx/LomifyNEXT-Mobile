<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Clock3, MoreHorizontal, Music2, RefreshCw } from 'lucide-svelte';
  import { currentTrack, currentView, isPlaying, listenStats, queue, settings } from '$lib/stores';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { afterMobilePaint } from '$lib/utils/mobilePaint';
  import { mobileTrackKey, openMobileTrackMenu, stopScWave } from '$lib/mobileTracks';
  import { yandexRecentTracks } from '$lib/yandexDiscovery';
  import { coverUrlAtSize } from '$lib/offlineCovers';

  let remote = $state<any[]>([]);
  let loading = $state(false);
  let failed = $state(false);
  let expanded = $state(false);
  let account = '';
  let loadedAt = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  const local = $derived(Object.entries($listenStats.history)
    .sort(([, a], [, b]) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
    .flatMap(([key, entry]) => entry.id && entry.source ? [{ ...entry, audioUrl: '', id: String(entry.id), key }] : []).slice(0, 24));
  const recent = $derived.by(() => {
    const seen = new Set<string>();
    return [...local, ...remote].filter(track => {
      const key = mobileTrackKey(track);
      if (seen.has(key) || $settings.mobileHiddenTracks.includes(key)) return false;
      seen.add(key); return true;
    }).slice(0, 24);
  });

  async function load() {
    const token = $settings.yandexToken;
    const run = ++generation;
    controller?.abort(); controller = new AbortController();
    loading = true; failed = false;
    try {
      const tracks = await yandexRecentTracks(token, controller.signal);
      if (run !== generation || token !== $settings.yandexToken) return;
      remote = tracks; loadedAt = Date.now();
    } catch { if (run === generation) failed = true; }
    finally { if (run === generation) loading = false; }
  }
  $effect(() => {
    const token = $settings.yandexToken;
    const active = $currentView === 'home';
    if (account !== token) {
      ++generation; controller?.abort(); remote = []; loadedAt = 0; loading = false; failed = false; account = token;
    }
    if (!active || !token || Date.now() - loadedAt < 300_000) return;
    // Fetch after the tab has finished entering; no request/DOM enrichment during motion.
    return afterMobilePaint(() => { void load(); }, 500);
  });
  onDestroy(() => { ++generation; controller?.abort(); });
  function play(track: any) {
    stopScWave(); queue.set(recent.slice(recent.indexOf(track) + 1)); currentTrack.set(track); isPlaying.set(true);
  }
</script>

<section class="mobile-recent" aria-labelledby="mobile-recent-heading">
  <div class="mobile-section-heading"><h2 id="mobile-recent-heading">Недавно слушал</h2>
    {#if $settings.yandexToken}<button class="mobile-icon-button" aria-label="Обновить историю прослушивания" disabled={loading} onclick={load}><RefreshCw size={19} aria-hidden="true" /></button>{/if}
  </div>
  {#if recent.length}
    <div use:mobileReveal={true}>
      {#each recent.slice(0, expanded ? 24 : 4) as track (mobileTrackKey(track))}
        <div class="mobile-recent-row">
          <button class="mobile-history-play" onclick={() => play(track)} use:mobileHold={{ onHold: () => openMobileTrackMenu(track) }} aria-label={`Слушать ${track.title}, ${track.artist}`}>
            <span class="mobile-recent-art"><Music2 size={23} aria-hidden="true" />{#if track.coverUrl}<img src={coverUrlAtSize(track.coverUrl, 120)} loading="lazy" decoding="async" alt="" />{/if}</span>
            <span><strong>{track.title}</strong><small>{track.artist}</small></span>
          </button>
          <button class="mobile-icon-button" aria-label={`Меню трека ${track.title}`} onclick={() => openMobileTrackMenu(track)}><MoreHorizontal size={21} aria-hidden="true" /></button>
        </div>
      {/each}
    </div>
    {#if recent.length > 4}<button class="mobile-text-button" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? 'Свернуть историю' : 'Вся история'}</button>{/if}
    {#if failed}<p class="mobile-hint">История Яндекса не загрузилась. Здесь последние треки из Lomify.</p>{/if}
  {:else}
    <p class="mobile-recent-empty" role="status"><Clock3 size={20} aria-hidden="true" /><span>{loading ? 'Загружаем историю…' : failed ? 'История Яндекса не загрузилась. Нажми обновить, чтобы повторить.' : 'Здесь появится музыка, которую ты слушал.'}</span></p>
  {/if}
</section>
