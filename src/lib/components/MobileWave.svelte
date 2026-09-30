<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { readFftInto, FFT_BINS } from '$lib/fft';
  import { Play, Pause, Radio, SlidersHorizontal, ChevronRight, RefreshCw, ArrowUpRight, Loader2, Music2 } from 'lucide-svelte';
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
  const waveName = $derived($settings.mobileWaveName === 'wave' ? 'Моя Волна' : 'Моя Тусня');
  const waveObject = $derived($settings.mobileWaveName === 'wave' ? 'мою волну' : 'мою тусню');
  const active = $derived(source === 'soundcloud' ? ($scWaveActive && isScWaveTrack($currentTrack)) : ($waveActive && !!$currentTrack?.waveBatchId));
  const playing = $derived(active && $isPlaying);
  const filters = $derived(describeWaveFilters($settings));
  let visual: HTMLElement;
  let pageHidden = $state(false);
  let reduceMotion = $state(false);
  let bassGlow: HTMLSpanElement;
  let voiceGlow: HTMLSpanElement;
  let unlistenFft: (() => void) | null = null;
  const fft = new Float32Array(FFT_BINS);
  let lastFftAt = 0;
  $effect(() => {
    const enabled = $settings.mobileVisualizer !== false && $settings.mobileMotion !== false && !reduceMotion && playing && !pageHidden;
    void invoke('audio_visualizer_set_enabled', { enabled }).catch(() => {});
    if (!enabled && bassGlow) {
      bassGlow.style.scale = '1';
      voiceGlow.style.scale = '1';
      bassGlow.style.opacity = '';
      voiceGlow.style.opacity = '';
    }
  });
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
        if (!visual || pageHidden || reduceMotion || !playing || !$settings.mobileVisualizer || !$settings.mobileMotion) return;
        const now = performance.now();
        if (now - lastFftAt < 45) return;
        if (!readFftInto(event.payload, fft)) return;
        lastFftAt = now;
        let bassSum = 0;
        let voiceSum = 0;
        for (let i = 0; i < 9; i++) bassSum += fft[i];
        for (let i = 9; i < 32; i++) voiceSum += fft[i];
        const bass = bassSum / 9;
        const voice = voiceSum / 23;
        // Only compositor-friendly scale and opacity change with the music.
        bassGlow.style.scale = (1 + bass * .065).toFixed(3);
        voiceGlow.style.scale = (1 + voice * .045).toFixed(3);
        bassGlow.style.opacity = Math.min(.96, .72 + bass * .28).toFixed(3);
        voiceGlow.style.opacity = Math.min(.85, .58 + voice * .3).toFixed(3);
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

<section class="mobile-wave-page" class:is-soundcloud={source === 'soundcloud'}>
  <div class="mobile-wave-intro">
    <div class="mobile-wave-kicker"><MusicServiceIcon service={source} size={19} /><span>{source === 'soundcloud' ? 'SOUNDCLOUD' : 'ЯНДЕКС МУЗЫКА'}</span></div>
    <h1>{waveName}</h1>
  </div>
  <div class="mobile-wave-hero">
    <div bind:this={visual} class="mobile-wave-glow-field" class:playing={playing && !pageHidden && !reduceMotion && $settings.mobileMotion !== false && $settings.mobileVisualizer !== false} aria-hidden="true">
      <span bind:this={bassGlow} class="mobile-wave-glow glow-warm"></span>
      <span bind:this={voiceGlow} class="mobile-wave-glow glow-deep"></span>
    </div>
    <div class="mobile-wave-hero-content">
      <span class="mobile-wave-now-label">{active ? 'СЕЙЧАС В ПОТОКЕ' : 'НА ТВОЕЙ ЧАСТОТЕ'}</span>
      <div class="mobile-wave-track" aria-live="polite">
        {#if active && $currentTrack}<h2>{$currentTrack.title}</h2><p>{$currentTrack.artist}</p>
        {:else}<h2>Музыка под твой момент</h2><p>{source === 'soundcloud' ? 'Из любимых треков SoundCloud' : $settings.yandexToken ? 'Персональный поток из Яндекс Музыки' : 'Подключи Яндекс и включай'}</p>{/if}
      </div>
      <div class="mobile-wave-art" aria-hidden="true"><span class="mobile-wave-core"><Radio size={40} strokeWidth={1.3} />{#if active && $currentTrack?.coverUrl}<img src={$currentTrack.coverUrl} alt="" onerror={(event) => handleArtworkError(event, $currentTrack.coverUrl)} onload={handleArtworkLoad} />{/if}</span></div>
    </div>
  </div>
  {#if active && lyricLine && $settings.mobileWaveLyrics}<button class="mobile-wave-lyric" onclick={() => window.dispatchEvent(new Event('lomify:open-player'))} aria-label="Открыть текст песни в плеере">{lyricLine}</button>{/if}
  {#if source === 'soundcloud' || $settings.yandexToken}
    <button class="mobile-primary mobile-wave-play" onclick={primary} aria-label={busy ? `Отменить загрузку: ${waveName}` : playing ? `Приостановить ${waveObject}` : `Слушать ${waveObject}`}>
      {#if busy}<Loader2 size={22} class="animate-spin" />{:else}<MorphIcon icon={playing ? PauseData : PlayData} size={22} fill="currentColor" spring="snappy" reducedMotion="user" />{/if}
      {busy ? 'Отменить загрузку' : playing ? 'Пауза' : active ? 'Продолжить' : `Слушать ${waveObject}`}
    </button>
    {#if busy}<p class="mobile-wave-status" role="status">Собираем музыку{filters ? ' по выбранным фильтрам' : ' для тебя'}…</p>{/if}
    {#if active}<div class="mobile-wave-actions"><button class="mobile-text-button" disabled={busy} onclick={collect}><RefreshCw size={17} /> Собрать заново</button><button class="mobile-text-button" onclick={() => window.dispatchEvent(new Event('lomify:open-player'))}>Плеер <ArrowUpRight size={17} /></button></div>{/if}
  {:else}
    <button class="mobile-primary mobile-wave-play" onclick={connect}>Подключить Яндекс <ArrowUpRight size={20} /></button>
    <p class="mobile-wave-status">Пошаговая инструкция откроется в настройках.<br />Для полного прослушивания нужна подписка Плюс.</p>
  {/if}
  {#if error}<p class="mobile-error" role="alert">{error}</p>{/if}
  {#if source === 'soundcloud' || $settings.yandexToken}
    <details class="mobile-wave-tuning" bind:open={tuning}>
      <summary><SlidersHorizontal size={20} /><span><strong>Настроить {waveObject}</strong><small>{filters || 'Любой жанр и язык'}</small></span><ChevronRight size={20} class="mobile-disclosure-arrow" /></summary>
      <div class="mobile-wave-filter-content">
        <fieldset disabled={busy}><legend>Настроение жанра</legend><div class="mobile-wave-chips"><button aria-pressed={!genre} onclick={() => genre = ''}>Любой</button>{#each WAVE_GENRES as option}<button aria-pressed={genre === option.id} onclick={() => genre = option.id}>{option.label}</button>{/each}</div></fieldset>
        {#if source !== 'soundcloud'}<fieldset disabled={busy}><legend>Язык</legend><div class="mobile-wave-chips">{#each WAVE_LANGUAGES as option}<button aria-pressed={language === option.id} onclick={() => language = option.id}>{option.label}</button>{/each}</div></fieldset>
        <fieldset disabled={busy}><legend>Вокал</legend><div class="mobile-wave-chips">{#each [{id:'all', label:'Любой'}, {id:'lyrics', label:'С текстом'}, {id:'instrumental', label:'Без слов'}] as option}<button aria-pressed={content === option.id} onclick={() => content = option.id}>{option.label}</button>{/each}</div></fieldset>{/if}
        <p class="mobile-hint">Условия применятся после нажатия кнопки. С узкими фильтрами подбор может занять больше времени.</p>
        <button class="mobile-primary" disabled={busy} onclick={applyFilters}><Music2 size={18} /> Применить и слушать</button>
        <button class="mobile-text-button" disabled={busy} onclick={() => { language = ''; genre = ''; content = 'all'; }}>Сбросить выбор</button>
      </div>
    </details>
    <p class="mobile-wave-footer">{source === 'soundcloud' ? 'Подбор идёт по твоим любимым SoundCloud и рекомендациям. Музыка продолжится в других разделах.' : 'Дослушивания и пропуски помогают Яндексу подбирать следующие треки. Музыка продолжится в других разделах.'}</p>
  {/if}
</section>
