<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { MoreHorizontal, Music2, RefreshCw } from 'lucide-svelte';
  import { currentTrack, currentView, isPlaying, queue, settings } from '$lib/stores';
  import { yandexMoodTracks, YANDEX_MOODS, type YandexMood } from '$lib/yandexDiscovery';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { afterMobilePaint } from '$lib/utils/mobilePaint';
  import { mobileTrackKey, openMobileTrackMenu, stopScWave } from '$lib/mobileTracks';
  import { coverUrlAtSize } from '$lib/offlineCovers';

  let mood = $state<YandexMood | null>(null);
  let tracks = $state<any[]>([]);
  let busy = $state(false);
  let error = $state('');
  let controller: AbortController | null = null;
  let scheduled: (() => void) | undefined;
  let generation = 0;
  let account = '';
  const visible = $derived(tracks.filter(track => !$settings.mobileHiddenTracks.includes(mobileTrackKey(track))));
  const title = $derived(YANDEX_MOODS.find(item => item.id === mood)?.title || '');
  function cancel() { ++generation; scheduled?.(); scheduled = undefined; controller?.abort(); busy = false; }
  async function load(selected: YandexMood, run: number) {
    const token = $settings.yandexToken;
    controller = new AbortController();
    try {
      const result = await yandexMoodTracks(token, selected, controller.signal);
      if (run !== generation || token !== $settings.yandexToken) return;
      tracks = result;
      if (!result.length) error = 'Яндекс не вернул треки. Попробуй другое настроение.';
    } catch (reason) {
      if (run === generation) error = reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'Не удалось подобрать музыку. Попробуй ещё раз.';
    } finally { if (run === generation) busy = false; }
  }
  function choose(selected: YandexMood) {
    cancel(); mood = selected; tracks = []; error = ''; busy = true;
    const run = generation;
    scheduled = afterMobilePaint(() => { scheduled = undefined; void load(selected, run); }, 300);
  }
  function play(track: any) { stopScWave(); queue.set(visible.slice(visible.indexOf(track) + 1)); currentTrack.set(track); isPlaying.set(true); }
  $effect(() => {
    const token = $settings.yandexToken, active = $currentView === 'search';
    untrack(() => {
      if (account !== token) { cancel(); tracks = []; mood = null; error = ''; account = token; }
      if (!active) cancel();
    });
  });
  onDestroy(cancel);
</script>

<section class="mobile-discovery-search" use:mobileReveal={true}>
  <h2>Какое настроение?</h2>
  <p class="mobile-hint">Выбери, что хочется услышать. Яндекс подберёт треки с учётом твоего вкуса.</p>
  {#if !$settings.yandexToken}<p class="mobile-hint" role="status">Подключи Яндекс Музыку в настройках, чтобы получить подборку.</p>{/if}
  <div class="mobile-mood-choices" aria-label="Настроение музыки">
    {#each YANDEX_MOODS as item}<button aria-pressed={mood === item.id} disabled={!$settings.yandexToken} onclick={() => choose(item.id)}><strong>{item.title}</strong><span>{item.detail}</span></button>{/each}
  </div>
  {#if mood}
    <div class="mobile-section-heading"><h3>{title}</h3><button class="mobile-icon-button" aria-label="Обновить подборку по настроению" disabled={busy} onclick={() => mood && choose(mood)}><RefreshCw size={18} aria-hidden="true" /></button></div>
  {/if}
  {#if busy}<p class="mobile-hint" role="status">Яндекс подбирает музыку…</p>{/if}
  {#if error}<p class="mobile-search-error" role="status">{error}</p>{/if}
  {#if visible.length}<div class="mobile-lyric-results" use:mobileReveal={true}>
    {#each visible as track (track.id)}<article class="mobile-lyric-result">
      <button class="mobile-lyric-cover" onclick={() => play(track)} use:mobileHold={{ onHold: () => openMobileTrackMenu(track) }} aria-label={`Слушать ${track.title}, ${track.artist}`}><Music2 size={40} aria-hidden="true" />{#if track.coverUrl}<img src={coverUrlAtSize(track.coverUrl, 400)} alt="" loading="lazy" decoding="async" />{/if}</button>
      <div class="mobile-lyric-caption"><div><strong>{track.title}</strong><small>{track.artist}</small></div><button class="mobile-icon-button" aria-label={`Меню трека ${track.title}`} onclick={() => openMobileTrackMenu(track)}><MoreHorizontal size={20} aria-hidden="true" /></button></div>
    </article>{/each}
  </div>{/if}
  <p class="mobile-hint mobile-mood-note">Подбор по четырём настроениям. Свободное описание для Яндекса пока недоступно в Lomify.</p>
</section>
