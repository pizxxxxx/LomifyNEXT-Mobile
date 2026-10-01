<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { readFftInto, FFT_BINS } from '$lib/fft';
  import { MobileWaveMotion } from '$lib/mobileWaveMotion';
  import { ArrowLeft, SlidersHorizontal, ChevronDown, RefreshCw, ArrowUpRight, Loader2, Music2 } from 'lucide-svelte';
  import { settings, currentTrack, currentView, isPlaying, progress, lyricsStatus } from '$lib/stores';
  import { getLyrics } from '$lib/api';
  import { handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';
  import { startWave, waveActive } from '$lib/wave';
  import { WAVE_GENRES, WAVE_LANGUAGES, describeWaveFilters } from '$lib/waveFilters';
  import { mobileConnectionRequest } from '$lib/mobile';
  import MusicServiceIcon from './MusicServiceIcon.svelte';
  import { MorphIcon } from 'morphicons/svelte';
  import { Play as PlayData, Pause as PauseData } from 'lucide';
  import { isScWaveTrack, refillScWave, scWaveActive, startScWave, stopScWave } from '$lib/mobileTracks';

  let busy = $state(false);
  let error = $state('');
  let tuning = $state(false);
  let language = $state($settings.waveLanguage || '');
  let genre = $state($settings.waveGenre || '');
  let content = $state($settings.waveContent || 'all');
  let controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const source = $derived($settings.searchSource === 'yandex' ? 'yandex' : 'soundcloud');
  const waveName = $derived($settings.mobileWaveName === 'wave' ? 'Моя волна' : 'Моя тусня');
  const waveObject = $derived($settings.mobileWaveName === 'wave' ? 'мою волну' : 'мою тусню');
  const active = $derived(source === 'soundcloud' ? ($scWaveActive && isScWaveTrack($currentTrack)) : ($waveActive && !!$currentTrack?.waveBatchId));
  const playing = $derived(active && $isPlaying);
  const filters = $derived(describeWaveFilters($settings));
  const canListen = $derived(source === 'soundcloud' || !!$settings.yandexToken);
  // Original line geometry, computed once. Music only changes the layer transforms.
  const ribbons = Array.from({ length: 9 }, (_, index) => Array.from({ length: 121 }, (_, point) => {
    const angle = point / 120 * Math.PI * 2;
    const x = 300 + (226 + index * 3) * Math.cos(angle);
    const y = 230 + (141 + index * 2) * Math.sin(angle) + 18 * Math.sin(angle * 3 + index * .12) + 10 * Math.cos(angle * 2);
    return `${point ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') + 'Z');
  let visual: HTMLElement;
  let pageHidden = $state(false);
  let reduceMotion = $state(false);
  let bassGlow: HTMLSpanElement;
  let voiceGlow: HTMLSpanElement;
  let unlistenFft: (() => void) | null = null;
  const fft = new Float32Array(FFT_BINS);
  const waveMotion = new MobileWaveMotion();
  let lastFftAt = 0;
  function resetWaveMotion() {
    waveMotion.reset();
    lastFftAt = 0;
    if (!bassGlow || !voiceGlow) return;
    for (const layer of [bassGlow, voiceGlow]) {
      layer.style.scale = '1';
      layer.style.rotate = '0deg';
      layer.style.opacity = '';
    }
  }
  $effect(() => {
    const enabled = $settings.mobileVisualizer !== false && $settings.mobileMotion !== false && !reduceMotion && playing && !pageHidden;
    void invoke('audio_visualizer_set_enabled', { enabled }).catch(() => {});
    if (!enabled) resetWaveMotion();
  });
  $effect(() => { $currentTrack?.id; resetWaveMotion(); });
  let lyricLine = $state('');
  let lyricTimeline: { time: number; text: string }[] = [];
  let lyricGeneration = 0;
  $effect(() => {
    const track = $currentTrack;
    const enabled = $settings.mobileWaveLyrics;
    const generation = ++lyricGeneration;
    lyricTimeline = [];
    lyricLine = '';
    if (!track || !enabled || $lyricsStatus !== 'found') return;
    void getLyrics(track.title, track.artist, track).then(text => {
      if (generation !== lyricGeneration || !text) return;
      lyricTimeline = (text as string).split('\n').map((line: string) => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return match ? { time: Number(match[1]) * 60 + Number(match[2]), text: match[3] } : null;
      }).filter((line: { time: number; text: string } | null): line is { time: number; text: string } => !!line && !!line.text);
    }).catch(() => {});
  });
  onMount(() => {
    let disposed = false;
    const syncVisualizerVisibility = () => { pageHidden = document.hidden; };
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => { reduceMotion = motionPreference.matches; };
    document.addEventListener('visibilitychange', syncVisualizerVisibility);
    motionPreference.addEventListener('change', syncMotionPreference);
    syncVisualizerVisibility();
    syncMotionPreference();
    void listen<number[]>('audio:fft', event => {
        if (!visual || pageHidden || reduceMotion || !playing || $settings.mobileVisualizer === false || $settings.mobileMotion === false) return;
        const now = performance.now();
        if (now - lastFftAt < 45) return;
        if (!readFftInto(event.payload, fft)) return;
        lastFftAt = now;
        const motion = waveMotion.update(fft, now);
        // Two existing SVG layers: no path rebuild, layout reads or idle frame loop.
        const pulse = motion.bass * .085 + motion.beat * .035;
        bassGlow.style.scale = `${(1 + pulse).toFixed(3)} ${(1 + pulse * 1.15).toFixed(3)}`;
        voiceGlow.style.scale = (1 + motion.body * .06 + motion.beat * .018).toFixed(3);
        bassGlow.style.rotate = `${motion.rotation.toFixed(2)}deg`;
        voiceGlow.style.rotate = `${motion.lightRotation.toFixed(2)}deg`;
        bassGlow.style.opacity = (.6 + motion.bass * .24 + motion.beat * .06).toFixed(3);
        voiceGlow.style.opacity = (.45 + motion.body * .27).toFixed(3);
      }).then(stop => { if (disposed) stop(); else unlistenFft = stop; }).catch(() => {});
    const unsubscribeProgress = progress.subscribe(position => {
      if (!lyricTimeline.length || !$settings.mobileWaveLyrics) return;
      let found = '';
      for (const line of lyricTimeline) {
        if (line.time > position - .08) break;
        found = line.text;
      }
      if (found !== lyricLine) lyricLine = found;
    });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', syncVisualizerVisibility);
      motionPreference.removeEventListener('change', syncMotionPreference);
      unsubscribeProgress();
      unlistenFft?.();
      void invoke('audio_visualizer_set_enabled', { enabled: false }).catch(() => {});
    };
  });

  function connect() {
    mobileConnectionRequest.set('yandex');
    currentView.set('settings');
  }
  function cancel(message = 'Загрузка отменена. Можно попробовать ещё раз.') {
    controller?.abort(); controller = null; clearTimeout(timeout); busy = false; error = message;
  }
  async function collect() {
    if (busy) return;
    if (source === 'soundcloud') {
      busy = true; error = '';
      try {
        const started = await startScWave();
        if (!started) error = 'Не удалось собрать поток. Добавь любимые треки SoundCloud или попробуй ещё раз с интернетом.';
        else void refillScWave();
      } catch { error = 'Не удалось загрузить SoundCloud. Проверь интернет и попробуй ещё раз.'; }
      finally { busy = false; }
      return;
    }
    if (!$settings.yandexToken) { connect(); return; }
    stopScWave();
    settings.update(s => ({ ...s, searchSource: 'yandex' }));
    busy = true; error = '';
    const request = new AbortController(); controller = request;
    timeout = setTimeout(() => cancel('Яндекс долго не отвечает. Проверь интернет или ослабь фильтры и повтори.'), 25000);
    try {
      const started = await startWave({ signal: request.signal });
      if (!request.signal.aborted && !started) error = `Не удалось запустить ${waveObject}. Проверь подключение и подписку Плюс. Если выбраны фильтры, попробуй их сбросить.`;
    } finally {
      if (controller === request) { clearTimeout(timeout); controller = null; busy = false; }
    }
  }
  function primary() {
    if (busy) { cancel(); return; }
    if (active) isPlaying.set(!$isPlaying);
    else void collect();
  }
  function applyFilters() {
    settings.update(s => ({ ...s, waveLanguage: language, waveGenre: genre, waveContent: content }));
    tuning = false;
    void collect();
  }
  onDestroy(() => { controller?.abort(); clearTimeout(timeout); });
</script>

<section class="mobile-wave-page">
  <div class="mobile-wave-toolbar">
    <button class="mobile-icon-button" aria-label="Назад" onclick={() => history.back()}><ArrowLeft size={22} /></button>
    <span><MusicServiceIcon service={source} size={19} />{source === 'soundcloud' ? 'SoundCloud' : 'Яндекс Музыка'}</span>
  </div>
  <div class="mobile-wave-stage">
    <div bind:this={visual} class="mobile-wave-ribbons" aria-hidden="true">
      <span bind:this={bassGlow} class="mobile-wave-ribbon-layer">
        <svg viewBox="0 0 600 460" fill="none" focusable="false"><path d={ribbons[4]} stroke-width="14" opacity=".07" />{#each ribbons as path, index}<path d={path} stroke-width={index === 4 ? 2 : 1} opacity={.25 + (4 - Math.abs(index - 4)) * .12} />{/each}</svg>
      </span>
      <span bind:this={voiceGlow} class="mobile-wave-ribbon-layer mobile-wave-ribbon-light">
        <svg viewBox="0 0 600 460" fill="none" focusable="false"><path d={ribbons[2]} stroke-width="1.2" /><path d={ribbons[6]} stroke-width="1.2" /></svg>
      </span>
    </div>
    <div class="mobile-wave-center">
      <h1 class="mobile-wave-title"><button class="mobile-wave-start" onclick={canListen ? primary : connect} aria-label={!canListen ? 'Подключить Яндекс Музыку' : busy ? `Отменить загрузку: ${waveName}` : playing ? `Приостановить ${waveObject}` : `Слушать ${waveObject}`}>
        {#if busy}<Loader2 size={30} class="animate-spin" />{:else}<MorphIcon icon={playing ? PauseData : PlayData} size={30} fill="currentColor" spring="snappy" reducedMotion="user" />{/if}
        <span>{waveName}</span>
      </button></h1>
      {#if canListen}<button class="mobile-wave-tune-button" aria-expanded={tuning} aria-controls="mobile-wave-filters" onclick={() => tuning = !tuning}><SlidersHorizontal size={16} />Настроить<ChevronDown size={15} class={tuning ? 'turned' : ''} /></button>
      {:else}<button class="mobile-wave-tune-button" onclick={connect}>Подключить Яндекс<ArrowUpRight size={16} /></button>{/if}
      {#if busy}<p class="mobile-wave-status" role="status">Собираем музыку… Нажми, чтобы отменить.</p>{:else if filters && canListen}<p class="mobile-wave-status">{filters}</p>{/if}
    </div>
  </div>
  {#if !canListen}<p class="mobile-wave-status">Для прослушивания подключи аккаунт с подпиской Плюс.<br />Инструкция откроется в настройках.</p>{/if}
  {#if error}<p class="mobile-error" role="alert">{error}</p>{/if}
  {#if canListen}
    <div class="mobile-wave-tuning" id="mobile-wave-filters" hidden={!tuning}>
      <div class="mobile-wave-filter-content">
        <fieldset disabled={busy}><legend>Жанр</legend><div class="mobile-wave-chips"><button aria-pressed={!genre} onclick={() => genre = ''}>Любой</button>{#each WAVE_GENRES as option}<button aria-pressed={genre === option.id} onclick={() => genre = option.id}>{option.label}</button>{/each}</div></fieldset>
        {#if source !== 'soundcloud'}<fieldset disabled={busy}><legend>Язык</legend><div class="mobile-wave-chips">{#each WAVE_LANGUAGES as option}<button aria-pressed={language === option.id} onclick={() => language = option.id}>{option.label}</button>{/each}</div></fieldset>
        <fieldset disabled={busy}><legend>Вокал</legend><div class="mobile-wave-chips">{#each [{id:'all', label:'Любой'}, {id:'lyrics', label:'С текстом'}, {id:'instrumental', label:'Без слов'}] as option}<button aria-pressed={content === option.id} onclick={() => content = option.id}>{option.label}</button>{/each}</div></fieldset>{/if}
        <p class="mobile-hint">Условия применятся после нажатия кнопки. С узкими фильтрами подбор может занять больше времени.</p>
        <button class="mobile-primary" disabled={busy} onclick={applyFilters}><Music2 size={18} /> Применить и слушать</button>
        <button class="mobile-text-button" disabled={busy} onclick={() => { language = ''; genre = ''; content = 'all'; }}>Сбросить выбор</button>
      </div>
    </div>
    {#if active && $currentTrack}
      <div class="mobile-wave-listening">
        <button class="mobile-wave-current" onclick={() => window.dispatchEvent(new Event('lomify:open-player'))} aria-label={`Открыть плеер: ${$currentTrack.title}`}>
          <span class="mobile-wave-current-art" aria-hidden="true">{#if $currentTrack.coverUrl}<img src={$currentTrack.coverUrl} alt="" onerror={(event) => handleArtworkError(event, $currentTrack.coverUrl)} onload={handleArtworkLoad} />{:else}<Music2 size={24} />{/if}</span>
          <span class="mobile-wave-current-copy"><strong>{$currentTrack.title}</strong><small>{$currentTrack.artist}</small></span><ArrowUpRight size={19} />
        </button>
        {#if lyricLine && $settings.mobileWaveLyrics}<button class="mobile-wave-lyric" onclick={() => window.dispatchEvent(new Event('lomify:open-player'))} aria-label="Открыть текст песни в плеере">{lyricLine}</button>{/if}
        <button class="mobile-text-button mobile-wave-refresh" disabled={busy} onclick={collect}><RefreshCw size={16} />Собрать заново</button>
      </div>
    {:else}<p class="mobile-wave-footer">{source === 'soundcloud' ? 'Из твоих любимых треков SoundCloud' : 'Музыка, подобранная для тебя'}</p>{/if}
  {/if}
</section>
