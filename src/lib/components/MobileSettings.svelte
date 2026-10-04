<script lang="ts">
  import { pushMobileHistory } from '$lib/mobileNavigation';
  import { ArrowLeft, Check, ChevronRight, Palette, AudioLines, Music2, Radio, ShieldCheck, Download, RefreshCw, ExternalLink, Pencil, Type, Library, AlignLeft } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';
  import { mobileConnectionRequest, isIOS } from '$lib/mobile';
  import { settings, currentView, listenStats } from '$lib/stores';
  import { APP_VERSION } from '$lib/version';
  import { withCount } from '$lib/utils/plural';
  import { checkMobileUpdate, isAndroidUpdateTarget, mobileUpdateState, openMobileUpdate, openLatestIOSRelease } from '$lib/mobileUpdates';
  import { MOBILE_RELEASES_URL, mobileUpdateLink } from '$lib/mobileUpdateCore';
  import MobileConnections from './MobileConnections.svelte';
  import { allowMobilePlaylistReimport, removedMobilePlaylistCount } from '$lib/mobileTracks';
  let updateOpenError = $state('');
  let checkingIOSRelease = $state(false);
  let removedPlaylistCount = $state(removedMobilePlaylistCount());
  let editingProfile = $state(false);
  let profileDraft = $state('');
  let profileName = $derived(($settings.searchSource === 'yandex' ? $settings.yandexUser?.displayName : $settings.scUser?.username) || $settings.customProfileName || 'Мой профиль');
  let profileAvatar = $derived(($settings.searchSource === 'yandex' ? $settings.yandexUser?.avatarUrl : $settings.scUser?.avatarUrl) || '');
  function saveProfile() {
    const name = profileDraft.trim().slice(0, 48);
    if (!name) return;
    settings.update(s => ({ ...s, customProfileName: name }));
    editingProfile = false;
  }
  async function openUpdate(url: string) {
    updateOpenError = '';
    try { await openMobileUpdate(url); }
    catch { updateOpenError = 'Не удалось открыть браузер. Перейди на страницу релизов GitHub вручную.'; }
  }
  async function checkIOSRelease() {
    if (checkingIOSRelease) return;
    updateOpenError = '';
    checkingIOSRelease = true;
    try { await openLatestIOSRelease(); }
    catch (error) { updateOpenError = error instanceof Error ? error.message : 'Не удалось открыть iOS-релиз. Попробуй ещё раз.'; }
    finally { checkingIOSRelease = false; }
  }
  const accents = [
    { id: 'red-dragon', name: 'Коралл', color: '#ff9866' },
    { id: 'default', name: 'Зелёная', color: '#1DB954' },
    { id: 'toxic-sludge', name: 'Лайм', color: '#bada55' },
    { id: 'dragon-sc', name: 'SC Prime', color: '#ff5500' },
    { id: 'n1xoy', name: 'Красная', color: '#B00000' },
    { id: 'night-city', name: 'Лимон', color: '#fce205' },
    { id: 'vice-city', name: 'Роза', color: '#ff2a85' },
    { id: 'abyss-water', name: 'Океан', color: '#00d2ff' },
    { id: 'purple-haze', name: 'Фиолет', color: '#9b59b6' },
    { id: 'martian-dust', name: 'Терракота', color: '#ff7e5f' },
    { id: 'blood-moon', name: 'Бордо', color: '#8a0303' },
    { id: 'electric-indigo', name: 'Индиго', color: '#6600ff' },
    { id: 'dracula', name: 'Дракула', color: '#bd93f9' }
  ];
  const currentAccent = $derived(accents.find(a => a.id === $settings.theme)?.name || 'Свой цвет');
  function chooseAccent(id: string) {
    settings.update(s => ({ ...s, theme: id, accentFromCover: false }));
  }
  const uiFonts = [
    { id: 'onest', name: 'Onest' }, { id: 'inter', name: 'Inter' },
    { id: 'manrope', name: 'Manrope' }, { id: 'golos', name: 'Golos Text' },
    { id: 'rubik', name: 'Rubik' }
  ];
  const lyricFonts = [...uiFonts, { id: 'jost', name: 'Jost' }, { id: 'comfortaa', name: 'Comfortaa' },
    { id: 'playfair', name: 'Playfair Display' }, { id: 'caveat', name: 'Caveat' }];

  const pageTitles = {
    overview: 'Настройки', connections: 'Музыка и аккаунты', playback: 'Воспроизведение',
    station: 'Станция', lyrics: 'Текст песни', library: 'Медиатека',
    appearance: 'Оформление', typography: 'Шрифт интерфейса', updates: 'Обновления', about: 'О приложении'
  };
  type SettingsPage = keyof typeof pageTitles;
  let page = $state<SettingsPage>('overview');
  let root: HTMLDivElement;
  let heading: HTMLHeadingElement;
  let overviewScroll = 0;
  let connectionsVisited = $state(false);
  const groups = [
    { title: 'Музыка', items: [
      { id: 'connections', title: 'Музыка и аккаунты', icon: Music2 },
      { id: 'playback', title: 'Воспроизведение', icon: AudioLines },
      { id: 'station', title: 'Станция', icon: Radio },
      { id: 'lyrics', title: 'Текст песни', icon: AlignLeft },
      { id: 'library', title: 'Медиатека', icon: Library }
    ] },
    { title: 'Интерфейс', items: [
      { id: 'appearance', title: 'Оформление', icon: Palette },
      { id: 'typography', title: 'Шрифт интерфейса', icon: Type }
    ] },
    { title: 'Приложение', items: [
      { id: 'updates', title: 'Обновления', icon: Download },
      { id: 'about', title: 'О приложении', icon: ShieldCheck }
    ] }
  ] as const;
  function rowValue(id: SettingsPage) {
    if (id === 'connections') return $settings.searchSource === 'yandex' ? 'Яндекс' : 'SoundCloud';
    if (id === 'station') return $settings.mobileWaveName === 'wave' ? 'Моя Волна' : 'Моя Тусня';
    if (id === 'appearance') return $settings.accentFromCover ? 'Из обложки' : currentAccent;
    if (id === 'typography') return uiFonts.find(font => font.id === $settings.mobileUiFont)?.name || 'Onest';
    if (id === 'updates') return APP_VERSION;
    return '';
  }
  function pageFromState(state: any): SettingsPage {
    const candidate = state?.mobileSettingsSection;
    return Object.hasOwn(pageTitles, candidate) ? candidate : 'overview';
  }
  async function showPage(next: SettingsPage, focus = true) {
    page = next;
    if (next === 'connections') connectionsVisited = true;
    await tick();
    if (page !== next) return;
    root?.closest<HTMLElement>('.mobile-pane')?.scrollTo({ top: next === 'overview' ? overviewScroll : 0, behavior: 'instant' });
    if (focus) heading?.focus({ preventScroll: true });
  }
  function openPage(next: SettingsPage) {
    if (page === next) return;
    if (page === 'overview') overviewScroll = root?.closest<HTMLElement>('.mobile-pane')?.scrollTop || 0;
    pushMobileHistory({ ...history.state, mobileView: 'settings', mobileSettingsSection: next });
    void showPage(next);
  }
  function backToOverview() {
    if (history.state?.mobileSettingsSection) history.back();
    else void showPage('overview');
  }
  onMount(() => {
    const syncLocation = (state: any, focus = true) => {
      if (state?.mobileView === 'settings' && !state.mobilePlayer) {
        const next = pageFromState(state);
        if (next !== page) void showPage(next, focus);
      }
    };
    const onBack = (event: PopStateEvent) => syncLocation(event.state);
    window.addEventListener('popstate', onBack);
    const unsubscribe = currentView.subscribe(view => { if (view === 'settings') syncLocation(history.state, false); });
    return () => { window.removeEventListener('popstate', onBack); unsubscribe(); };
  });
  $effect(() => {
    if ($currentView === 'settings' && $mobileConnectionRequest && page !== 'connections') openPage('connections');
  });
</script>

<div class="mobile-settings" bind:this={root} data-settings-page={page}>
  {#if page !== 'overview'}
    <button class="mobile-settings-back" onclick={backToOverview}><ArrowLeft size={20} strokeWidth={1.5} aria-hidden="true" /> Настройки</button>
  {/if}
  <header class="mobile-settings-heading">
    <h1 tabindex="-1" bind:this={heading}>{pageTitles[page]}</h1>
    {#if page === 'overview'}<span class="mobile-settings-build">{APP_VERSION}</span>{/if}
  </header>
  {#if page === 'overview'}
  <section class="mobile-preference-group mobile-account-group" aria-label="Профиль">
    <div class="mobile-profile-card">
      <span class="mobile-profile-avatar">{#if profileAvatar}<img src={profileAvatar} alt="" />{:else}{profileName.charAt(0).toUpperCase()}{/if}</span>
      <div><strong>{profileName}</strong><small>{withCount($listenStats.tracksPlayed, 'прослушивание', 'прослушивания', 'прослушиваний')} за {Math.floor($listenStats.listenSeconds / 3600)} ч</small></div>
      {#if !$settings.scUser && !$settings.yandexUser}<button class="mobile-icon-button" aria-label="Изменить имя профиля" onclick={() => { profileDraft = $settings.customProfileName || ''; editingProfile = !editingProfile; }}><Pencil size={19} /></button>{/if}
    </div>
    {#if editingProfile}<form class="mobile-create-playlist" onsubmit={(event) => { event.preventDefault(); saveProfile(); }}><label for="mobile-profile-name">Имя профиля</label><input id="mobile-profile-name" bind:value={profileDraft} maxlength="48" /><button class="mobile-primary" type="submit" disabled={!profileDraft.trim()}>Сохранить</button></form>{/if}
  </section>
    {#each groups as group}
      <section class="mobile-settings-menu-group" aria-label={group.title}>
        <h2>{group.title}</h2>
        <div class="mobile-settings-menu">
          {#each group.items as entry}
            <button class="mobile-settings-menu-row" onclick={() => openPage(entry.id)}>
              <entry.icon size={21} strokeWidth={1.5} aria-hidden="true" />
              <span class="mobile-settings-menu-label">{entry.title}</span>
              {#if rowValue(entry.id)}<span class="mobile-settings-menu-value">{rowValue(entry.id)}</span>{/if}
              <ChevronRight size={17} strokeWidth={1.5} aria-hidden="true" />
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
  {#if page === 'appearance'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}>
    <div class="mobile-preference-card">
      <div class="mobile-preference-label"><span>Цвет акцента</span><small>{$settings.accentFromCover ? 'Из обложки' : currentAccent}</small></div>
      <div class="mobile-accent-options" role="group" aria-label="Цвет акцента">
        {#each accents as accent}
          <button class="mobile-accent-option" aria-label={accent.name} aria-pressed={$settings.theme === accent.id && !$settings.accentFromCover} onclick={() => chooseAccent(accent.id)}>
            <span style:background={accent.color} style:color={['n1xoy', 'purple-haze', 'blood-moon', 'electric-indigo'].includes(accent.id) ? '#fff' : '#111'}>{#if $settings.theme === accent.id && !$settings.accentFromCover}<Check size={20} aria-hidden="true" />{/if}</span><small>{accent.name}</small>
          </button>
        {/each}
      </div>
      <label class="mobile-preference-row"><span><strong>Цвет из обложки</strong><small>Меняется вместе с треком</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.accentFromCover} /></label>
      <label class="mobile-preference-row"><span><strong>Цветной фон</strong><small>Оттенок выбранной темы или обложки</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.globalThemeEffect} /></label>
      <label class="mobile-preference-row"><span><strong>Плавные переходы</strong><small>Разделы, плеер и отклик кнопок</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileMotion} /></label>
      <label class="mobile-preference-row"><span><strong>Видеофон Яндекса</strong><small>Доступен во время воспроизведения. Расходует трафик и заряд; отключается при уменьшении движения.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileVideoBackground} /></label>
      <label class="mobile-preference-row"><span><strong>Видео за текстом</strong><small>Требуется включённый видеофон Яндекса</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileLyricsVideoBackground} disabled={!$settings.mobileVideoBackground} /></label>
      <label class="mobile-preference-row"><span><strong>Движение при наклоне</strong><small>Слегка двигает обложки. Отключается при уменьшении движения.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileDepthMotion} /></label>
      <label class="mobile-preference-row"><span><strong>Свечение станции</strong><small>Откликается на музыку. Выключи для экономии заряда.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileVisualizer} /></label>
      <label class="mobile-preference-row"><span><strong>Размытие панелей</strong><small>Мини-плеер и меню. Выключи, если интерфейс тормозит.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileBlur} /></label>
    </div>

    </section>
  {/if}
  {#if page === 'typography'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}>
    <div class="mobile-preference-card">
      <label class="mobile-select-row"><span>Гарнитура</span><select bind:value={$settings.mobileUiFont}>{#each uiFonts as font}<option value={font.id}>{font.name}</option>{/each}</select></label>
      <label class="mobile-select-row"><span>Толщина шрифта</span><select bind:value={$settings.mobileTextWeight}><option value="normal">Обычная</option><option value="medium">Средняя</option><option value="bold">Полужирная</option></select></label>
      <p class="mobile-font-preview">Название трека</p>
    </div>

    </section>
  {/if}
  {#if page === 'playback'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}><div class="mobile-preference-card">
    <button class="mobile-preference-row mobile-setting-link" onclick={() => currentView.set('equalizer')}><span><strong>Эквалайзер</strong><small>10 полос и готовые настройки</small></span><ChevronRight size={20} aria-hidden="true" /></button>
    <label class="mobile-preference-row"><span><strong>Превью трека</strong><small>Кнопка в меню трека, без автозапуска</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobilePreview} /></label>
    <label class="mobile-preference-row"><span><strong>Экономия трафика</strong><small>Меньший размер потока, если доступен</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileDataSaver} /></label>
    <label class="mobile-preference-row"><span><strong>Загружать следующий трек</strong><small>Меньше пауз между треками, больше трафика</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.preloadNext} /></label>
    {#if $settings.mobileHiddenTracks.length}<div class="mobile-preference-row"><span><strong>Скрытые треки: {$settings.mobileHiddenTracks.length}</strong><small>Вернуть их в рекомендации и поиск</small></span><button class="mobile-secondary" onclick={() => settings.update(s => ({ ...s, mobileHiddenTracks: [] }))}>Очистить</button></div>{/if}
  </div>
    </section>
  {/if}
  {#if page === 'station'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}><div class="mobile-preference-card">
    <div class="mobile-preference-label"><span>Название станции</span><small>Подбор музыки не меняется</small></div>
    <div class="mobile-source-options" role="group" aria-label="Название станции"><button aria-pressed={$settings.mobileWaveName === 'wave'} onclick={() => settings.update(s => ({ ...s, mobileWaveName: 'wave' }))}>Моя Волна</button><button aria-pressed={$settings.mobileWaveName !== 'wave'} onclick={() => settings.update(s => ({ ...s, mobileWaveName: 'party' }))}>Моя Тусня</button></div>
    <label class="mobile-preference-row"><span><strong>Текст в станции</strong><small>Показывать текущую строку, если есть синхронизация</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileWaveLyrics} /></label>
  </div>
    </section>
  {/if}
  {#if page === 'lyrics'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}><div class="mobile-preference-card">
    <label class="mobile-select-row"><span>Шрифт текста</span><select bind:value={$settings.fontFamily}>{#each lyricFonts as font}<option value={font.id}>{font.name}</option>{/each}</select></label>
    <p class="mobile-font-preview mobile-lyric-font-preview">Здесь будет текст песни</p>
    <div class="mobile-preference-label"><span>Размер текста</span><small>{$settings.mobileTextSize === 'large' ? 'Крупный' : 'Обычный'}</small></div>
    <div class="mobile-source-options" role="group" aria-label="Размер текста"><button aria-pressed={$settings.mobileTextSize !== 'large'} onclick={() => settings.update(s => ({ ...s, mobileTextSize: 'normal' }))}>Обычный</button><button aria-pressed={$settings.mobileTextSize === 'large'} onclick={() => settings.update(s => ({ ...s, mobileTextSize: 'large' }))}>Крупный</button></div>
    <div class="mobile-preference-label"><span>Подсветка текста</span><small>Режим для текста в плеере</small></div>
    <div class="mobile-source-options" role="group" aria-label="Подсветка текста"><button aria-pressed={!$settings.mobileLyricsLetterSync} onclick={() => settings.update(s => ({ ...s, mobileLyricsLetterSync: false }))}>По строкам</button><button aria-pressed={$settings.mobileLyricsLetterSync} onclick={() => settings.update(s => ({ ...s, mobileLyricsLetterSync: true }))}>По буквам</button></div>
    <label class="mobile-preference-row"><span><strong>Эдлибы</strong><small>Показывать фразы в скобках отдельно</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.lyricsAdlibs} /></label>
    {#if $settings.lyricsAdlibs}<label class="mobile-preference-row"><span><strong>Сдвиг эдлибов</strong><small>Отдельно от основных строк: {$settings.lyricsAdlibOffset || 0} мс</small></span><input type="range" min="-1500" max="1500" step="50" bind:value={$settings.lyricsAdlibOffset} aria-label="Сдвиг эдлибов в миллисекундах" /></label>{/if}
    <label class="mobile-preference-row"><span><strong>Сдвиг текста</strong><small>Если подсветка опережает или отстаёт: {$settings.lyricsOffset} мс</small></span><input type="range" min="-1000" max="1000" step="50" bind:value={$settings.lyricsOffset} aria-label="Сдвиг текста в миллисекундах" /></label>
  </div>
    </section>
  {/if}
  {#if page === 'library'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}>
    <div class="mobile-preference-card">
      <label class="mobile-preference-row"><span><strong>Перемешивать встряхиванием</strong><small>В открытом плейлисте. Можно отменить.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileShakeShuffle} /></label>
      <label class="mobile-preference-row"><span><strong>Сохранять удаление лайков</strong><small>Удалённые на этом телефоне лайки Яндекса не вернутся при импорте. Новые лайки продолжат загружаться.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileSkipRemovedYandexLikes} /></label>
      {#if removedPlaylistCount > 0}<div class="mobile-preference-row"><span><strong>Удалённые импортированные плейлисты: {removedPlaylistCount}</strong><small>Разрешить снова импортировать их из аккаунтов</small></span><button class="mobile-secondary" onclick={() => { allowMobilePlaylistReimport(); removedPlaylistCount = 0; }}>Разрешить</button></div>{/if}
    </div>

    </section>
  {/if}
  {#if page === 'updates'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}>
    <div class="mobile-preference-card mobile-update-card">
      <div class="mobile-update-current"><span>Установлена версия</span><strong>{APP_VERSION}</strong></div>
      {#if isAndroidUpdateTarget || isIOS}
        {#if $mobileUpdateState.status === 'available' && $mobileUpdateState.update}
          <p class="mobile-update-status" role="status">Доступна версия {$mobileUpdateState.update.version} на GitHub.</p>
          <button class="mobile-primary" onclick={() => openUpdate(mobileUpdateLink($mobileUpdateState.update!))}><Download size={18} aria-hidden="true" /> Скачать {$mobileUpdateState.update.platform === 'ios' ? 'IPA' : 'APK'}</button>
        {:else if $mobileUpdateState.status === 'checking'}
          <p class="mobile-hint" role="status">Проверяем релизы GitHub...</p>
        {:else if $mobileUpdateState.status === 'current'}
          <p class="mobile-hint" role="status">Установлена последняя {isIOS ? 'iOS' : 'Android'}-версия.</p>
        {:else if $mobileUpdateState.status === 'error'}
          <p class="mobile-error" role="alert">{$mobileUpdateState.message}</p>
        {:else}
          <p class="mobile-hint">Проверка начнётся автоматически при запуске приложения.</p>
        {/if}
        {#if isIOS}
          <button class="mobile-secondary" disabled={checkingIOSRelease || $mobileUpdateState.status === 'checking'} onclick={checkIOSRelease}><RefreshCw size={18} class={checkingIOSRelease ? 'animate-spin' : ''} aria-hidden="true" /> {checkingIOSRelease ? 'Проверяем…' : 'Проверить обновление'}</button>
          <p class="mobile-hint">Откроется последний iOS-релиз на GitHub. Установи IPA через «+» в AltStore с тем же Apple ID. Обновляй подпись раз в 7 дней, пока AltServer запущен на Mac.</p>
        {:else}
          <button class="mobile-secondary" disabled={$mobileUpdateState.status === 'checking'} onclick={() => checkMobileUpdate(true)}><RefreshCw size={17} aria-hidden="true" /> Проверить сейчас</button>
          <p class="mobile-hint">Открой скачанный APK и подтверди обновление. Подпись должна совпадать с установленной версией.</p>
        {/if}
        <p class="mobile-hint">О новой версии напомним при запуске. «Позже» откладывает напоминание до следующего запуска; скачать обновление здесь можно в любой момент.</p>
      {/if}
      <button class="mobile-text-button" onclick={() => openUpdate(MOBILE_RELEASES_URL)}><ExternalLink size={17} aria-hidden="true" /> Все релизы GitHub</button>
      {#if updateOpenError}<p class="mobile-error" role="alert">{updateOpenError}</p>{/if}
    </div>

    </section>
  {/if}
  {#if page === 'about'}
    <section class="mobile-settings-detail" aria-label={pageTitles[page]}><div class="mobile-settings-about"><img src="/mobile-icon.png" alt="" width="64" height="64" /><strong>LomifyNEXT</strong><span>Версия {APP_VERSION}</span></div><div class="mobile-preference-card">
    <p class="mobile-hint">{isAndroidUpdateTarget ? 'Android-версия. Скачанные треки доступны без интернета. Управление музыкой работает в уведомлении и на экране блокировки.' : 'Версия для iPhone. Скачанные треки доступны без интернета. Управление музыкой работает на экране блокировки.'}</p>
  <p class="mobile-hint">SoundCloud и Яндекс Музыка, любимые треки и плейлисты в одной медиатеке.</p></div>
    </section>
  {/if}
  {#if connectionsVisited}
    <div class="mobile-settings-detail" hidden={page !== 'connections'}><MobileConnections embedded /></div>
  {/if}
  {#if page === 'overview'}<p class="mobile-version">LomifyNEXT</p>{/if}
</div>
