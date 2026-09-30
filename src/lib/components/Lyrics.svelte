<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { currentTrack, isPlaying, progress, lyricsStatus } from '$lib/stores';
  import { getLyrics } from '$lib/api';
  import { Loader2, AlignLeft } from '@lucide/svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { fade } from 'svelte/transition';
  import { settings } from '$lib/stores';
  import MobileVideoBackdrop from './MobileVideoBackdrop.svelte';

  /** Включена ли посимвольная караоке-подсветка. Тайминг строк работает в обоих режимах. */
  export let letterSync = true;
  export let mobileMode = false;
  export let embedded = false;

  interface AdlibItem {
    text: string;
    isPrefix: boolean;
    triggerThreshold: number;
  }

  interface LyricLine {
    time: number;
    text: string;
    mainText?: string;
    adlibs?: AdlibItem[];
    pause?: boolean;
    duration?: number;
  }

  const PAUSE_MARKER = '♪♪♪';
  const PAUSE_GAP_THRESHOLD = 3.0;
  const VOWELS = new Set(Array.from('аеёиоуыэюяaeiouyАЕЁИОУЫЭЮЯAEIOUY'));
  const MAJOR_PAUSE_CHARS = new Set(['.', '!', '?', '…']);
  const MEDIUM_PAUSE_CHARS = new Set([',', ';', ':']);
  const HYPHEN_CHARS = new Set(['-', '—', '–']);
  interface CharWindow { start: number; end: number }
  const lineWindowsCache = new Map<number, CharWindow[]>();
  const ADLIB_OFFSET_SECONDS = 0.75;
  const ADLIB_VISIBLE_SECONDS = 2.8;

  function extractAdlibs(text: string): { mainText: string; adlibs: AdlibItem[] } {
    if (!text || text === PAUSE_MARKER) return { mainText: text, adlibs: [] };
    const adlibs: AdlibItem[] = [];
    const regex = /\(([^)]+)\)/gu;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const content = match[1].trim();
      if (!content) continue;
      const isPrefix = text.slice(0, match.index).trim().length === 0;
      const ratio = match.index / text.length;
      adlibs.push({
        text: content,
        isPrefix,
        triggerThreshold: isPrefix ? 0 : Math.min(.92, Math.max(.1, ratio > .72 ? .78 + adlibs.length * .04 : ratio))
      });
    }
    if (!adlibs.length) return { mainText: text, adlibs };
    const mainText = text.replace(/\(([^)]+)\)/gu, ' ').replace(/\s+([,.:!?…])/gu, '$1').replace(/\s+/gu, ' ').trim();
    return { mainText, adlibs };
  }

  let lyrics = '';
  let isLoading = false;
  let displayLines: LyricLine[] = [];
  let containerRef: HTMLElement;
  let activeIndex = -1;
  let lineRefs: HTMLElement[] = [];
  let charRefs: HTMLElement[][] = [];
  let pauseBarsRef: HTMLElement[] = [];
  let manualScroll = false;
  let lastScrollTs = 0;
  /**
   * Сколько текст «не мешает» после того, как его прокрутили руками. Раньше `manualScroll`
   * снимался только кликом по строке (`handleSeek`), поэтому одно движение колесом
   * выключало слежение навсегда: спеть могло полтрека, а текст стоял там, где его
   * оставили, и вернуть его можно было лишь щелчком — то есть с перемоткой звука.
   * Пять секунд — это заметно дольше любого «пролистну посмотреть, что дальше», но
   * достаточно быстро, чтобы не успеть решить, будто слежение сломалось.
   */
  const FOLLOW_RESUME_MS = 5000;
  let followResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let lineProgress = 0;
  let rafId: number;
  let previousLetterSync = letterSync;
  let reduceMotion = false;
  let loadGeneration = 0;
  let activeAdlib: { id: string; text: string; side: 'left' | 'right' | 'center' } | null = null;
  $: adlibsEnabled = mobileMode && $settings.lyricsAdlibs !== false;
  $: if (!adlibsEnabled && activeAdlib) activeAdlib = null;

  function lineText(line: LyricLine, withAdlibs = adlibsEnabled): string {
    return withAdlibs ? (line.mainText ?? line.text) : line.text;
  }

  function syncAdlib(position: number, idx: number) {
    const line = displayLines[idx];
    if (!adlibsEnabled || !hasTimedLyrics || !get(isPlaying) || !line || line.pause || !line.adlibs?.length) {
      if (activeAdlib) activeAdlib = null;
      return;
    }
    const next = displayLines[idx + 1];
    const duration = Math.max(.4, (next?.time ?? line.time + 2.6) - line.time);
    const singing = Math.min(duration, Math.max(.5, calculateSungDuration(lineText(line), duration)));
    const elapsed = Math.max(0, position - lyricsOffsetSecs - line.time);
    let candidate: typeof activeAdlib = null;
    for (let i = 0; i < line.adlibs.length; i++) {
      const adlib = line.adlibs[i];
      const trigger = Math.min(Math.max(.1, duration - .2), (adlib.isPrefix ? 0 : adlib.triggerThreshold * singing) + ADLIB_OFFSET_SECONDS);
      if (elapsed >= trigger && elapsed < Math.min(duration + .5, trigger + ADLIB_VISIBLE_SECONDS)) {
        candidate = { id: `${idx}:${i}`, text: adlib.text, side: adlib.text.length > 6 ? 'center' : (idx + i) % 2 ? 'right' : 'left' };
      }
    }
    if (activeAdlib?.id !== candidate?.id) activeAdlib = candidate;
  }

  function clamp01(v: number) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function calculateSungDuration(text: string, gap: number): number {
    const clean = text.replace(/\[.*?\]/g, '').trim();
    if (!clean) return Math.min(gap, 1);
    const vowels = Array.from(clean).filter(ch => VOWELS.has(ch)).length;
    const words = clean.split(/[\s\-—–]+/).filter(Boolean).length;
    const breath = gap > 2.5 ? Math.min(.8, Math.max(.3, gap * .18)) : Math.min(.3, Math.max(.1, gap * .12));
    const available = Math.max(.4, gap - breath);
    return Math.min(available, Math.max(.5, Math.max(Math.max(1, vowels) * .22 + words * .16 + .25, available * .75)));
  }

  function getLineThresholdWindows(lineIndex: number, text: string, count: number): CharWindow[] {
    const cached = lineWindowsCache.get(lineIndex);
    if (cached?.length === count) return cached;
    const chars = Array.from(text);
    const visible = chars.map((ch, index) => ({ ch, index })).filter(item => !/^\s$/u.test(item.ch));
    const weights: number[] = [];
    const pauses: number[] = [];
    for (let i = 0; i < visible.length; i++) {
      const ch = visible[i].ch;
      weights.push(VOWELS.has(ch) ? 1.35 : HYPHEN_CHARS.has(ch) || MAJOR_PAUSE_CHARS.has(ch) || MEDIUM_PAUSE_CHARS.has(ch) || /['"«»()[\]{}…♪]/u.test(ch) ? .3 : .85);
      if (i === visible.length - 1) { pauses.push(0); continue; }
      const next = visible[i + 1].ch;
      const between = chars.slice(visible[i].index + 1, visible[i + 1].index).join('');
      pauses.push(HYPHEN_CHARS.has(ch) || HYPHEN_CHARS.has(next) || /[-—–]/u.test(between) ? 2.4
        : MAJOR_PAUSE_CHARS.has(ch) || /[.!?…]/u.test(between) ? 3.8
        : MEDIUM_PAUSE_CHARS.has(ch) || /[,;:]/u.test(between) ? 2.4
        : between.length ? 1.4 : 0);
    }
    const total = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0) + pauses.reduce((sum, pause) => sum + pause, 0));
    let cursor = 0;
    const windows = weights.map((weight, i) => {
      const start = cursor / total;
      cursor += weight;
      const end = cursor / total;
      cursor += pauses[i];
      return { start, end };
    });
    lineWindowsCache.set(lineIndex, windows);
    return windows;
  }

  function buildDisplayLines(rawText: string) {
    lineWindowsCache.clear();
    const parsed: LyricLine[] = [];
    const lines = rawText.split('\n');
    for (const l of lines) {
      const match = l.match(/\[(\d+):(\d+\.\d+)\]\s*(.*)/);
      if (match) {
        const mins = parseInt(match[1]);
        const secs = parseFloat(match[2]);
        const text = match[3] || '♪';
        parsed.push({ time: mins * 60 + secs, text, ...extractAdlibs(text) });
      } else if (l.trim() && !l.startsWith('[')) {
        const text = l.trim();
        parsed.push({ time: -1, text, ...extractAdlibs(text) });
      }
    }

    // Only apply pause magic if we have synced lines
    if (parsed.length === 0 || parsed.some(p => p.time === -1)) {
      displayLines = parsed;
      return;
    }

    const out: LyricLine[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const cur = parsed[i];
      const prev = parsed[i - 1];
      if (prev) {
        const gap = cur.time - prev.time;
        if (gap >= PAUSE_GAP_THRESHOLD) {
          // The pause marker becomes the `next` line for `prev`, and the karaoke fill
          // uses `next.time - cur.time` as the line's duration. Anchoring the marker
          // 0.5s after `prev` therefore told the animation to sing a whole line in half
          // a second, which is why the text raced right before the ♪♪♪ row. Estimate how
          // long the line is actually sung instead, and park the marker after it.
          const sung = calculateSungDuration(prev.mainText || prev.text, gap);
          out.push({
            time: prev.time + sung,
            text: PAUSE_MARKER,
            pause: true,
            duration: Math.max(0.5, gap - sung - 0.1),
          });
        }
      } else if (cur.time >= PAUSE_GAP_THRESHOLD) {
        out.push({
          time: 0.05,
          text: PAUSE_MARKER,
          pause: true,
          duration: Math.max(0.5, cur.time - 0.1),
        });
      }
      out.push(cur);
    }
    displayLines = out;
  }

  $: hasTimedLyrics = displayLines.length > 0 && displayLines.every((line) => line.time >= 0);
  $: lyricsOffsetSecs = ($settings.lyricsOffset || 0) / 1000 - 0.08;

  $: if ($currentTrack) {
    loadLyrics();
  }

  async function loadLyrics() {
    const track = $currentTrack;
    const generation = ++loadGeneration;
    if (!track) return;
    isLoading = true;
    lyrics = '';
    displayLines = [];
    charRefs = [];
    activeAdlib = null;
    activeIndex = -1;
    
    let text: string | null = null;
    try {
      text = await getLyrics(track.title, track.artist, track);
    } catch (error) {
      console.error('Не удалось загрузить текст песни', error);
    }
    if (generation !== loadGeneration) return;
    // Тот же ответ нужен кнопке «Показать текст» в полноэкранном режиме — иначе она
    // продолжала бы звать в пустую панель, которую человек только что закрыл.
    lyricsStatus.set(text ? 'found' : 'none');
    if (text) {
      lyrics = text;
      buildDisplayLines(text);
      isLoading = false;
      await tick();
      syncActiveLine(get(progress), true, 'auto');
      if (letterSync && hasTimedLyrics) setupRaf();
    } else {
      lyrics = 'Текста пока нет';
      displayLines = [];
      isLoading = false;
    }
  }

  function setLineState(i: number, state: string, force = false) {
    if (!lineRefs[i]) return;
    if (!force && lineRefs[i].dataset.state === state) return;
    lineRefs[i].dataset.state = state;

    const line = displayLines[i];
    const bar = pauseBarsRef[i];

    if (state === 'past' || state === 'past-near') {
      writeLineProgress(i, 1);
      if (bar && line.pause) bar.dataset.state = 'past';
    } else if (state === 'next' || state === 'next-near') {
      writeLineProgress(i, 0);
      if (bar && line.pause) bar.dataset.state = '';
    } else if (state === 'active') {
      if (bar && line.pause) bar.dataset.state = 'active';
    }
  }

  function applyLineStates(idx: number, force = false) {
    for (let i = 0; i < lineRefs.length; i++) {
      let state;
      if (i === idx) state = 'active';
      else if (i === idx - 1) state = 'past-near';
      else if (i === idx + 1) state = 'next-near';
      else if (idx >= 0 && i < idx) state = 'past';
      else state = 'next';
      setLineState(i, state, force);
    }
  }

  function activeLineAt(position: number): number {
    if (!hasTimedLyrics) return -1;
    const adjusted = Math.max(0, Number(position) || 0) - lyricsOffsetSecs;
    let low = 0;
    let high = displayLines.length - 1;
    let found = -1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      if (displayLines[middle].time <= adjusted) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }

  /**
   * Активная строка считается прямо из общего прогресса плеера. Раньше компонент ждал
   * отдельное событие Rust-таймлайна; после смены режима оно могло остаться на прежнем
   * индексе, и тогда строка зависала, хотя сам seek продолжал работать.
   */
  function syncActiveLine(position: number, force = false, behavior?: ScrollBehavior) {
    const idx = activeLineAt(position);
    const prev = activeIndex;
    syncAdlib(position, idx);
    if (!force && idx === prev) return;

    activeIndex = idx;
    lineProgress = 0;
    applyLineStates(idx, force);

    if (idx >= 0 && idx < lineRefs.length && !manualScroll) {
      const gap = performance.now() - lastScrollTs;
      scrollToActive(
        behavior ?? (gap < 220 || prev === -1 || Math.abs(idx - prev) > 2 ? 'auto' : 'smooth')
      );
    }
  }

  function writeLineProgress(i: number, p: number) {
    const el = lineRefs[i];
    if (!el) return;
    const value = clamp01(p);
    
    // Only update line progress if it changed significantly
    const prevValue = parseFloat(el.dataset.progress || '-1');
    if (Math.abs(prevValue - value) > 0.005 || value === 0 || value === 1) {
      el.dataset.progress = value.toString();
      el.style.setProperty('--lyric-progress', `${(value * 100).toFixed(2)}%`);
      el.style.setProperty('--lyric-progress-value', value.toFixed(4));
    }

    const chars = charRefs[i];
    if (chars && chars.length > 0) {
      const windows = getLineThresholdWindows(i, lineText(displayLines[i]), chars.length);
      for (let c = 0; c < chars.length; c++) {
        if (!chars[c]) continue;
        const win = windows[c] || { start: 0, end: 1 };
        const local = value >= win.end ? 1 : value > win.start ? (value - win.start) / Math.max(.0001, win.end - win.start) : 0;
        const eased = local * local * (3 - 2 * local);
        const easedStr = eased.toFixed(3);
        
        // Cache to avoid unnecessary DOM writes
        if (chars[c].dataset.progress !== easedStr) {
          chars[c].dataset.progress = easedStr;
          chars[c].style.setProperty('--char-progress', easedStr);
        }
      }
    }

    const line = displayLines[i];
    const bar = pauseBarsRef[i];
    if (bar && line.pause) {
      if (bar.dataset.progress !== value.toString()) {
        bar.dataset.progress = value.toString();
        bar.style.width = `${(value * 100).toFixed(2)}%`;
      }
    }
  }

  function setupRaf() {
    if (rafId) cancelAnimationFrame(rafId);
    if (!letterSync || !hasTimedLyrics) {
      rafId = 0;
      return;
    }
    let lastFrameTs = 0;
    // The old loop deliberately skipped every second display refresh (33 ms), so even a
    // healthy 60 Hz screen could only show ~30 lyric frames. Keep the exact same smoothing
    // speed in wall-clock time, but feed it from every rAF: the animation stays visually the
    // same while short lines can now move at the display refresh rate.
    const LEGACY_FRAME_MS = 33;

    const tickFrame = (ts: number) => {
      if (document.visibilityState === 'hidden') {
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(tickFrame);
      const frameMs = lastFrameTs === 0 ? 1000 / 60 : Math.min(100, Math.max(1, ts - lastFrameTs));
      lastFrameTs = ts;
      if (!get(isPlaying)) return;

      const idx = activeIndex;
      if (idx < 0 || idx >= displayLines.length) return;
      const cur = displayLines[idx];
      const next = displayLines[idx + 1];
      
      const offsetSecs = lyricsOffsetSecs;
      // `get(progress)` instead of `$progress`: the auto-subscription invalidated this
      // component 10x/s (the backend tick rate) and forced a full flush + fragment
      // diff, even though the value is only ever read here inside the rAF loop. This
      // frame already runs at most every 33 ms and writes to the DOM directly.
      const adjustedProgress = Math.max(0, get(progress) - offsetSecs);
      
      const dur = Math.max(0.4, (next?.time ?? cur.time + 2.6) - cur.time);
      const target = clamp01((adjustedProgress - cur.time) / dur);

      const prev = lineProgress;
      const diff = target - prev;
      const legacyAlpha = diff > 0.18 || target > 0.92 ? 0.7 : 0.32;
      const frameAlpha = 1 - Math.pow(1 - legacyAlpha, frameMs / LEGACY_FRAME_MS);
      const smoothed = diff < 0 ? target : prev + diff * frameAlpha;
      lineProgress = smoothed;
      writeLineProgress(idx, smoothed);
    };
    rafId = requestAnimationFrame(tickFrame);
  }

  async function handleLetterModeChange() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;

    // Внутренний keyed-блок пересоздаёт строки при смене режима. Ссылки очищаем до `tick`,
    // а после него сразу восстанавливаем активную строку из текущей позиции плеера.
    lineRefs = [];
    charRefs = [];
    pauseBarsRef = [];
    await tick();
    syncActiveLine(get(progress), true, 'auto');
    if (letterSync && hasTimedLyrics) setupRaf();
  }

  $: if (letterSync !== previousLetterSync) {
    previousLetterSync = letterSync;
    void handleLetterModeChange();
  }

  /**
   * Поставить активную строку в центр контейнера. Вынесено из обработчика
   * прогресса, потому что ровно это же нужно при возврате слежения: если просто
   * снять `manualScroll` и ждать следующей строки, на длинной строке текст «оживёт» лишь
   * через несколько секунд после таймера — и выглядеть это будет как случайный рывок, а не
   * как ответ на то, что человек перестал листать.
   */
  function scrollToActive(behavior: ScrollBehavior) {
    if (!containerRef) return;
    const el = lineRefs[activeIndex];
    if (!el) return;
    containerRef.scrollTo({
      top: el.offsetTop - containerRef.clientHeight / 2 + el.clientHeight / 2,
      behavior: reduceMotion ? 'auto' : behavior
    });
    lastScrollTs = performance.now();
  }

  onMount(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => {
      reduceMotion = motionQuery.matches;
    };
    syncMotionPreference();
    motionQuery.addEventListener('change', syncMotionPreference);

    // Подписка вызывает callback сразу и затем на каждом `audio:tick`, поэтому после
    // переключения режима или seek строка восстанавливается без ожидания отдельного IPC.
    const unsubscribeProgress = progress.subscribe((position) => syncActiveLine(position));
    const unsubscribePlayback = isPlaying.subscribe((playing) => {
      if (!playing && activeAdlib) activeAdlib = null;
      else if (playing && hasTimedLyrics) syncAdlib(get(progress), activeIndex);
    });

    const onVisibility = () => {
      if (letterSync && hasTimedLyrics && document.visibilityState !== 'hidden' && !rafId) {
        setupRaf();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribeProgress();
      unsubscribePlayback();
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', syncMotionPreference);
    };
  });

  onDestroy(() => {
    loadGeneration++;
    if (rafId) cancelAnimationFrame(rafId);
    cancelFollowResume();
  });

  function splitChars(text: string) {
    return Array.from(text).map(ch => ({ ch, animated: !/^\s$/u.test(ch) }));
  }

  function splitWordsForChars(cells: {ch: string, animated: boolean}[]) {
    const groups = [];
    let cur: {ch: string, animated: boolean}[] = [];
    let curKind: boolean | null = null;
    for (const c of cells) {
      if (c.animated !== curKind) {
        if (cur.length) groups.push(cur);
        cur = [c];
        curKind = c.animated;
      } else {
        cur.push(c);
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  let lastSeekTime = 0;
  function handleSeek(time: number) {
    if (time >= 0) {
      const now = performance.now();
      if (now - lastSeekTime < 300) return;
      lastSeekTime = now;
      cancelFollowResume();
      manualScroll = false;
      const targetPosition = Math.max(0, time);
      syncActiveLine(targetPosition, true, 'auto');
      invoke('audio_seek', { position: targetPosition }).catch(e => console.error(e));
    }
  }

  function cancelFollowResume() {
    if (followResumeTimer) clearTimeout(followResumeTimer);
    followResumeTimer = null;
  }

  // Каждое движение колеса отодвигает возврат: отсчёт идёт от последнего касания, а не от
  // первого, иначе слежение включилось бы посреди длинной прокрутки и выдернуло страницу
  // из-под руки.
  function markManual() {
    manualScroll = true;
    cancelFollowResume();
    followResumeTimer = setTimeout(() => {
      followResumeTimer = null;
      manualScroll = false;
      scrollToActive('smooth');
    }, FOLLOW_RESUME_MS);
  }

  function registerChar(node: HTMLElement, { lineIndex }: { lineIndex: number }) {
    if (!charRefs[lineIndex]) charRefs[lineIndex] = [];
    charRefs[lineIndex].push(node);
    return {
      destroy() {
        if (charRefs[lineIndex]) {
          charRefs[lineIndex] = charRefs[lineIndex].filter(n => n !== node);
        }
      }
    };
  }

  /**
   * Текст без синхронизации приходит одним блоком, и раньше его так и выводили —
   * `whitespace-pre-wrap` + `leading-loose`: строки растягивались во всю ширину панели,
   * а каждая пустая строка источника превращалась в дыру. Разбираем блок сами: строка
   * остаётся строкой, а любая пачка пустых строк сворачивается в один межстрофный
   * отступ. `displayLines` для этого не годится — там пустые строки уже потеряны.
   */
  function toPlainBlocks(text: string, withAdlibs: boolean): { text: string; isBreak: boolean; adlibs: AdlibItem[] }[] {
    const blocks: { text: string; isBreak: boolean; adlibs: AdlibItem[] }[] = [];
    for (const raw of (text || '').split('\n')) {
      const line = raw.trim();
      if (line) {
        const parsed = withAdlibs ? extractAdlibs(line) : { mainText: line, adlibs: [] };
        blocks.push({ text: parsed.mainText, adlibs: parsed.adlibs, isBreak: false });
      } else if (blocks.length && !blocks[blocks.length - 1].isBreak) blocks.push({ text: '', adlibs: [], isBreak: true });
    }
    // Отступ в самом конце — такой же мусор, как лишняя пустая строка в источнике.
    if (blocks.length && blocks[blocks.length - 1].isBreak) blocks.pop();
    return blocks;
  }

  $: plainBlocks = toPlainBlocks(lyrics, adlibsEnabled);
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="h-full w-full flex-1 min-h-0" class:mobile-lyrics-view={mobileMode}>
{#if mobileMode && !embedded && $currentTrack?.source === 'yandex' && $settings.mobileVideoBackground !== false && $settings.mobileLyricsVideoBackground !== false}
  <MobileVideoBackdrop track={$currentTrack} coverUrl={$currentTrack.coverUrl} active={$isPlaying} variant="lyrics" />
{/if}
{#if mobileMode && activeAdlib && adlibsEnabled}
  {#key activeAdlib.id}
    <div class="mobile-lyrics-adlib-stage" aria-hidden="true" in:fade={{ duration: !reduceMotion && $settings.mobileMotion ? 220 : 0 }} out:fade={{ duration: !reduceMotion && $settings.mobileMotion ? 180 : 0 }}>
      <span class="mobile-lyrics-adlib is-{activeAdlib.side}" class:is-long={activeAdlib.text.length > 14}>{activeAdlib.text}</span>
    </div>
  {/key}
{/if}
<div
  class="h-full w-full flex-1 overflow-y-auto scrollbar-hide px-12 py-16 relative {!$isPlaying ? 'lyrics-paused' : ''}"
  bind:this={containerRef}
  style="mask-image: linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%); -webkit-mask-image: linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%);"
  on:wheel|passive={markManual}
  on:touchstart|passive={markManual}
  on:pointerdown={markManual}
>
  {#if isLoading}
    <div class="h-full flex items-center justify-center text-white/50">
      <Loader2 class="animate-spin w-8 h-8" />
    </div>
  {:else if hasTimedLyrics}
    {#if embedded}<div class="mobile-lyrics-edge" aria-hidden="true"></div>{/if}
    {#key letterSync}
      <div
        class="selectable flex flex-col gap-2"
        class:lyrics-line-sync={!letterSync}
        class:lyrics-letter-sync={letterSync}
      >
        {#each displayLines as line, i}
          {#if line.pause}
            <div
              bind:this={lineRefs[i]}
              class="lyric-line lyric-pause"
              style="--pause-duration: {line.duration ?? 2}s"
            >
              <span class="note-gradient-text">{PAUSE_MARKER}</span>
              <div class="lyric-pause-track">
                <div class="lyric-pause-bar" bind:this={pauseBarsRef[i]}></div>
              </div>
            </div>
          {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              bind:this={lineRefs[i]}
              class="lyric-line"
              on:click={() => handleSeek(line.time)}
            >
              <!-- Keep this condition inline: Svelte then tracks `activeIndex` as a template
                   dependency and swaps the three character-based lines at the exact line
                   change. Hiding that dependency inside a helper can leave the fragment
                   static in legacy reactivity mode. -->
              {#if letterSync && activeIndex >= 0 && Math.abs(i - activeIndex) <= 1}
                {@const cells = splitChars(lineText(line, adlibsEnabled))}
                {@const groups = splitWordsForChars(cells)}
                <span class="lyric-fill">
                  {#each groups as group}
                    {#if !group[0].animated}
                      <span>{group.map(c => c.ch).join('')}</span>
                    {:else}
                      <span class="lyric-word">
                        {#each group as c}
                          <span class="lyric-char" use:registerChar={{ lineIndex: i }}>{c.ch}</span>
                        {/each}
                      </span>
                    {/if}
                  {/each}
                </span>
              {:else}
                <span class="lyric-line-text" class:lyric-line-static={letterSync}>{lineText(line, adlibsEnabled) || '\u00A0'}</span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/key}
  {:else if displayLines.length > 0}
    <div class="selectable lyrics-plain">
      <!-- Плашка объясняет, почему ничего не подсвечивается: это не сломанное караоке,
           а текст, для которого просто нет тайминга. -->
      <div class="lyrics-plain-head">
        <AlignLeft size={11} />
        без синхронизации
      </div>
      {#each plainBlocks as block}
        {#if block.isBreak}
          <div class="lyrics-plain-break" aria-hidden="true"></div>
        {:else}
          <p class="lyrics-plain-line">
            {#each block.adlibs.filter(adlib => adlib.isPrefix) as adlib}<span class="mobile-lyrics-plain-adlib">{adlib.text}</span>{/each}
            {block.text || '\u00A0'}
            {#each block.adlibs.filter(adlib => !adlib.isPrefix) as adlib}<span class="mobile-lyrics-plain-adlib">{adlib.text}</span>{/each}
          </p>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="h-full flex flex-col items-center justify-center gap-1.5">
      <div class="display-title">{lyrics || 'Текста нет'}</div>
      <div class="empty-hint !mt-0 text-center">Для этого трека никто ещё не выложил слова.</div>
    </div>
  {/if}
  <div class={embedded ? 'mobile-lyrics-edge' : 'h-[40vh]'} aria-hidden="true"></div>
</div>
</div>
