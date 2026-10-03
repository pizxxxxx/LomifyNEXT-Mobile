<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Search as SearchIcon, Quote, AudioLines, X, MoreHorizontal, Music2, LogOut } from 'lucide-svelte';
  import Search from './Search.svelte';
  import MobileYandexMood from './MobileYandexMood.svelte';
  import { mobileHold } from '$lib/actions/mobileHold';
  import { mobileReveal } from '$lib/actions/mobileReveal';
  import { currentTrack, currentView, isPlaying, queue, mobileDiscoveryHistory, settings } from '$lib/stores';
  import { mobileTrackKey, openMobileTrackMenu, stopScWave } from '$lib/mobileTracks';
  import { beginDiscoveryLogin, discoverySession, DiscoverySearchError, searchDiscovery, type DiscoveryHit, type DiscoveryMode } from '$lib/mobileDiscoverySearch';
  import { coverUrlAtSize } from '$lib/offlineCovers';
  let mode = $state<'catalog' | DiscoveryMode>('catalog');
  let query = $state('');
  let hits = $state<DiscoveryHit[]>([]);
  let busy = $state(false);
  let error = $state('');
  let preparing = $state(false);
  let hasMore = $state(false);
  let page = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  let loginController: AbortController | null = null;
  let signingIn = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let preparingSince = 0;
  let input = $state<HTMLInputElement>();
  const placeholder = $derived(mode === 'lyrics' ? 'Строка из песни' : 'Какую музыку хочется услышать?');
  const visibleHits = $derived(hits.filter(hit => !$settings.mobileHiddenTracks.includes(mobileTrackKey(hit.track))));
  function cancel() { ++generation; clearTimeout(timer); controller?.abort(); busy = false; preparing = false; }
  function switchMode(next: typeof mode) { if (mode === next) return; cancel(); cancelLogin(); mode = next; query = ''; hits = []; hasMore = false; error = ''; page = 0; }
  function schedule() { cancel(); hits = []; hasMore = false; error = ''; page = 0; preparingSince = 0; if (query.trim().length >= 2 && $discoverySession) { busy = true; timer = setTimeout(() => { void run(); }, 500); } }
  async function run(append = false) {
    cancel();
    if (mode === 'catalog' || query.trim().length < 2 || $currentView !== 'search' || document.hidden || !$discoverySession) return;
    const runId = generation;
    const searchMode = mode, text = query.trim(), session = $discoverySession;
    controller = new AbortController(); busy = true; error = '';
    const requestedPage = append ? page + 1 : 0;
    try {
      const result = await searchDiscovery(searchMode, text, session, controller.signal, requestedPage);
      if (runId !== generation) return;
      hits = append ? [...hits, ...result.hits.filter(item => !hits.some(old => old.track.id === item.track.id))] : result.hits;
      hasMore = result.hasMore; preparing = result.preparing; page = requestedPage;
      if (preparing) {
        preparingSince ||= Date.now();
        if (Date.now() - preparingSince > 60_000) { preparing = false; error = 'Подбор занял больше минуты. Попробуй позже.'; }
        else timer = setTimeout(() => { void run(); }, 2500);
        return;
      }
      preparingSince = 0;
      if (!append) mobileDiscoveryHistory.update(items => [{ query: text, mode: searchMode }, ...items.filter(item => item.query !== text || item.mode !== searchMode)].slice(0, 20));
    } catch (reason) {
      if (runId !== generation) return;
      if (reason instanceof DiscoverySearchError && reason.kind === 'login') discoverySession.set('');
      error = reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'Не удалось выполнить поиск. Попробуй ещё раз.';
    } finally { if (runId === generation) busy = false; }
  }
  async function signIn() {
    loginController?.abort(); const login = new AbortController(); loginController = login; signingIn = true; error = '';
    try { const session = await beginDiscoveryLogin(login.signal); if (login.signal.aborted) return; discoverySession.set(session); if (query.trim()) void run(); }
    catch (reason) { if (!login.signal.aborted) error = reason instanceof Error ? reason.message : 'Не удалось войти.'; }
    finally { if (loginController === login) signingIn = false; }
  }
  function cancelLogin() { loginController?.abort(); signingIn = false; }
  function play(hit: DiscoveryHit) { stopScWave(); queue.set(visibleHits.slice(visibleHits.indexOf(hit) + 1).map(item => item.track)); currentTrack.set(hit.track); isPlaying.set(true); }
  $effect(() => { if ($currentView !== 'search') untrack(() => { cancel(); cancelLogin(); }); });
  onMount(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  });
  onDestroy(() => { cancel(); cancelLogin(); });
</script>

<div class="mobile-search-modes" aria-label="Способ поиска">
  <button aria-pressed={mode === 'catalog'} onclick={() => switchMode('catalog')}><SearchIcon size={17} aria-hidden="true" />Каталог</button>
  <button aria-pressed={mode === 'lyrics'} onclick={() => switchMode('lyrics')}><Quote size={17} aria-hidden="true" />По словам</button>
  <button aria-pressed={mode === 'vibe'} onclick={() => switchMode('vibe')}><AudioLines size={17} aria-hidden="true" />Настроение</button>
</div>
{#if mode === 'catalog'}<Search />
{:else}
  {#if mode === 'vibe'}
    <div class="mobile-discovery-sources" aria-label="Источник музыки по настроению">
      <button aria-pressed={$settings.searchSource !== 'yandex'} onclick={() => { cancel(); cancelLogin(); hits = []; error = ''; settings.update(value => ({ ...value, searchSource: 'soundcloud' })); }}>SoundCloud</button>
      <button aria-pressed={$settings.searchSource === 'yandex'} onclick={() => { cancel(); cancelLogin(); hits = []; error = ''; settings.update(value => ({ ...value, searchSource: 'yandex' })); }}>Яндекс</button>
    </div>
  {/if}
  {#if mode === 'vibe' && $settings.searchSource === 'yandex'}<MobileYandexMood />
  {:else}
  <section class="mobile-discovery-search" use:mobileReveal={mode}>
    <h2>{mode === 'lyrics' ? 'Вспомнил строчку?' : 'Что хочется почувствовать?'}</h2>
    <p class="mobile-hint">{mode === 'lyrics' ? 'Напиши несколько слов — найдём их в тексте песни.' : 'Опиши настроение или звучание своими словами.'}</p>
    <form class="mobile-discovery-input" onsubmit={event => { event.preventDefault(); input?.blur(); void run(); }}>
      <SearchIcon size={21} aria-hidden="true" />
      <input type="search" bind:this={input} bind:value={query} {placeholder} aria-label={placeholder} oninput={schedule} autocomplete="off" />
      {#if query}<button type="button" class="mobile-icon-button" aria-label="Очистить запрос" onclick={() => { query = ''; schedule(); input?.focus(); }}><X size={19} aria-hidden="true" /></button>{/if}
    </form>
    {#if !$discoverySession}
      <div class="mobile-discovery-connect">
        <strong>Поиск SoundCloud</strong>
        <p>Для поиска по словам и описанию настроения войди через SoundCloud. Поиск использует внешний музыкальный индекс scnative.space.</p>
        {#if signingIn}<p role="status">Заверши вход в браузере, затем вернись сюда.</p><button class="mobile-text-button" onclick={cancelLogin}>Отменить вход</button>
        {:else}<button class="mobile-primary" onclick={signIn}>Войти через SoundCloud</button>{/if}
      </div>
    {:else}<div class="mobile-discovery-provider"><span>SoundCloud</span><button class="mobile-icon-button" aria-label="Выйти из поиска SoundCloud" onclick={() => { cancel(); discoverySession.set(''); hits = []; }}><LogOut size={18} aria-hidden="true" /></button></div>{/if}
    {#if error}<p class="mobile-search-error" role="status">{error}</p>{#if $discoverySession}<button class="mobile-text-button" onclick={() => run()}>Повторить поиск</button>{/if}{/if}
    {#if busy || preparing}<p class="mobile-hint" role="status">{preparing ? 'Подбираем музыку по настроению…' : 'Ищем музыку…'}</p>{/if}
    {#if visibleHits.length}
      <div class="mobile-lyric-results" use:mobileReveal={true}>
        {#each visibleHits as hit (hit.track.id)}
          <article class="mobile-lyric-result">
            <button class="mobile-lyric-cover" onclick={() => play(hit)} use:mobileHold={{ onHold: () => openMobileTrackMenu(hit.track) }} aria-label={`Слушать ${hit.track.title}, ${hit.track.artist}`} aria-describedby={hit.matchedLine ? `lyric-hit-${hit.track.id}` : undefined}>
              <Music2 size={40} aria-hidden="true" />
              {#if hit.track.coverUrl}<img src={coverUrlAtSize(hit.track.coverUrl, 400)} alt="" loading="lazy" decoding="async" />{/if}
              {#if hit.matchedLine}<blockquote id={`lyric-hit-${hit.track.id}`}><span>{hit.matchedLine}</span></blockquote>{/if}
            </button>
            <div class="mobile-lyric-caption"><div><strong>{hit.track.title}</strong><small>{hit.track.artist}</small></div><button class="mobile-icon-button" aria-label={`Меню трека ${hit.track.title}`} onclick={() => openMobileTrackMenu(hit.track)}><MoreHorizontal size={20} aria-hidden="true" /></button></div>
          </article>
        {/each}
      </div>
      {#if hasMore}<button class="mobile-text-button" disabled={busy} onclick={() => run(true)}>Ещё результаты</button>{/if}
    {:else if $discoverySession && query.trim().length >= 2 && !busy && !error && !preparing}<p class="mobile-hint">Ничего не нашли. Попробуй другую фразу.</p>
    {:else if !query.trim()}<div class="mobile-discovery-examples"><span>Например</span>{#each mode === 'lyrics' ? ['они тянут ко мне', 'где нас нет'] : ['когда всё наконец отпустило', 'ночная поездка, мягкий бас'] as example}<button onclick={() => { query = example; void run(); }}>{example}</button>{/each}</div>{/if}
    {#if !query.trim() && $mobileDiscoveryHistory.some(item => item.mode === mode)}
      <div class="mobile-discovery-examples"><div class="mobile-section-heading"><h3>Недавние запросы</h3><button class="mobile-text-button" onclick={() => mobileDiscoveryHistory.update(items => items.filter(item => item.mode !== mode))}>Очистить</button></div>
        {#each $mobileDiscoveryHistory.filter(item => item.mode === mode) as item}<button onclick={() => { query = item.query; void run(); }}>{item.query}</button>{/each}
      </div>
    {/if}
  </section>
  {/if}
{/if}
