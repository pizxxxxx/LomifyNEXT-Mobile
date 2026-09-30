<script lang="ts">
  import PlaylistSyncSettings from './PlaylistSyncSettings.svelte';
  import { playlistSyncStatus, syncPlaylists } from '$lib/playlistSync';
  import { tick } from 'svelte';
  import { mobileConnectionRequest } from '$lib/mobile';
  import { Check, ChevronRight, ExternalLink, Loader2, Music2, ShieldCheck, RefreshCw, ArrowRight } from 'lucide-svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { settings, playlists, currentView } from '$lib/stores';
  import { yandexAccountStatus, normalizeYandexToken } from '$lib/yandex';
  import MusicServiceIcon from './MusicServiceIcon.svelte';
  import { isMobilePlaylistExcluded } from '$lib/mobileTracks';

  const TOKEN_SITE = 'https://ym-token.marshal.dev';
  const TOKEN_REPO = 'https://github.com/MarshalX/yandex-music-token';
  let { yandexOpen = $bindable(false) }: { yandexOpen?: boolean } = $props();
  let scOpen = $state(false);
  let token = $state('');
  let profile = $state('');
  let showToken = $state(false);
  let busy = $state<'yandex' | 'soundcloud' | null>(null);
  let stage = $state('');
  let ymError = $state('');
  let scError = $state('');
  let ymStatus = $state('');
  let scStatus = $state('');
  let linkError = $state('');
  let confirming = $state<'yandex' | 'soundcloud' | null>(null);
  let yandexCard: HTMLDetailsElement;
  let sectionOpen = $state(false);
  $effect(() => {
    if ($currentView === 'settings' && $mobileConnectionRequest === 'yandex') {
      sectionOpen = true;
      yandexOpen = true;
      mobileConnectionRequest.set(null);
      void tick().then(() => yandexCard?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }
  });

  async function external(url: string) {
    linkError = '';
    try { await openUrl(url); }
    catch { linkError = `Браузер не открылся. Открой вручную: ${url}`; }
  }
  async function bounded<T>(request: Promise<T>, timeoutMs = 20000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([request, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function connectYandex() {
    if (busy || !token.trim()) return;
    busy = 'yandex'; stage = 'Проверяем аккаунт…'; ymError = ''; ymStatus = '';
    try {
      const candidate = normalizeYandexToken(token.trim());
      const account = await bounded(yandexAccountStatus(candidate));
      settings.update(s => ({ ...s, yandexToken: candidate, yandexUser: account, searchSource: 'yandex' }));
      token = ''; showToken = false;
      ymStatus = 'Аккаунт подключён. Теперь можно искать музыку и импортировать любимые треки с плейлистами.';
    } catch {
      ymError = 'Подключение не удалось. Скопируй заново именно токен из блока «Ваш токен готов», а не код подтверждения. Проверь интернет и повтори.';
    } finally { busy = null; stage = ''; }
  }
  function profileUrl(value: string) {
    const input = value.trim();
    const url = new URL(/^https?:\/\//i.test(input) ? input : /^(www\.|m\.)?soundcloud\.com\//i.test(input) ? `https://${input}` : `https://soundcloud.com/${input.replace(/^@/, '')}`);
    if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname)
      || url.username || url.password || !/^\/[a-z0-9_-]+\/?$/i.test(url.pathname)) {
      throw new Error('profile');
    }
    return `https://soundcloud.com/${url.pathname.split('/')[1]}`;
  }
  async function connectSoundCloud() {
    if (busy || !profile.trim()) return;
    scError = ''; scStatus = '';
    let url: string;
    try { url = profileUrl(profile); }
    catch { scError = 'Нужна ссылка на профиль вида https://soundcloud.com/никнейм, не на трек или плейлист. Короткую ссылку открой в браузере и скопируй полный адрес профиля.'; return; }
    busy = 'soundcloud'; stage = 'Находим публичный профиль…';
    try {
      const { resolveSoundCloudProfile } = await import('$lib/api');
      const account = await bounded(resolveSoundCloudProfile(url));
      if (!account) throw new Error('not-found');
      settings.update(s => ({ ...s, scUser: account }));
      profile = '';
      scStatus = 'Профиль найден. Проверь имя и нажми «Импортировать медиатеку».';
    } catch { scError = 'Профиль не найден или SoundCloud не ответил. Проверь адрес, интернет и при необходимости VPN, затем повтори.'; }
    finally { busy = null; stage = ''; }
  }
  async function importLibrary(service: 'soundcloud' | 'yandex') {
    if (busy) return;
    busy = service; stage = 'Загружаем любимые треки…';
    if (service === 'yandex') { ymError = ''; ymStatus = ''; } else { scError = ''; scStatus = ''; }
    try {
      const { syncLikes } = await import('$lib/likes');
      const result = await syncLikes({ only: service, silent: true });
      let importedPlaylists = 0;
      let failedPlaylists = 0;
      if (service === 'soundcloud' && $settings.scUser) {
        stage = 'Загружаем публичные плейлисты…';
        importedPlaylists = await syncPlaylists('soundcloud');
      }
      if (service === 'yandex' && $settings.yandexToken) {
        stage = 'Загружаем плейлисты Яндекса…';
        importedPlaylists = await syncPlaylists('yandex');
      }
      const partial = result.failed.length > 0 || result.partial.length > 0 || !!$playlistSyncStatus[service].error;
      const message = `${partial || failedPlaylists ? 'Источник ответил не полностью. ' : ''}Любимые треки: +${result.added}${result.removed ? `, убрано ${result.removed}` : ''}. Новых плейлистов: ${importedPlaylists}.${failedPlaylists ? ` Не загрузилось: ${failedPlaylists}.` : ''} ${partial || failedPlaylists ? 'Можно повторить импорт позже.' : 'Открой «Медиатеку», чтобы послушать.'}`;
      if (service === 'yandex') ymStatus = message; else scStatus = message;
    } catch {
      const message = 'Импорт не завершился. Аккаунт остался подключён, уже загруженные треки сохранены. Проверь сеть и повтори импорт.';
      if (service === 'yandex') ymError = message; else scError = message;
    } finally { busy = null; stage = ''; }
  }
  function disconnect(service: 'soundcloud' | 'yandex') {
    if (busy) return;
    if (service === 'yandex') settings.update(s => ({ ...s, yandexToken: '', yandexUser: null, searchSource: 'soundcloud' }));
    else settings.update(s => ({ ...s, scUser: null }));
    confirming = null; ymStatus = ''; scStatus = '';
  }
</script>

<details class="mobile-preference-group mobile-settings-fold mobile-connections-fold" bind:open={sectionOpen}>
  <summary><Music2 size={18} aria-hidden="true" /><span>Музыка и аккаунты<small>{$settings.searchSource === 'yandex' ? 'Яндекс Музыка' : 'SoundCloud'} · подключение и импорт</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
  <div class="mobile-settings-fold-content">
  <div class="mobile-preference-card">
    <div class="mobile-preference-label"><span>Источник музыки и станции</span></div>
    <div class="mobile-source-options" role="group" aria-label="Источник музыки и станции">
      <button aria-pressed={$settings.searchSource === 'soundcloud'} onclick={() => settings.update(s => ({ ...s, searchSource: 'soundcloud' }))}><MusicServiceIcon service="soundcloud" size={22} /><span>SoundCloud</span>{#if $settings.searchSource === 'soundcloud'}<Check size={16} aria-hidden="true" />{/if}</button>
      <button aria-pressed={$settings.searchSource === 'yandex'} onclick={() => { if ($settings.yandexToken) settings.update(s => ({ ...s, searchSource: 'yandex' })); else yandexOpen = true; }}><MusicServiceIcon service="yandex" size={22} /><span>Яндекс</span>{#if $settings.searchSource === 'yandex'}<Check size={16} aria-hidden="true" />{/if}</button>
    </div>
  </div>

  <details class="mobile-service-card is-yandex" bind:open={yandexOpen} bind:this={yandexCard}>
    <summary class="mobile-service-summary"><span class="mobile-service-mark"><MusicServiceIcon service="yandex" size={26} /></span><span><strong>Яндекс Музыка</strong><small>{$settings.yandexToken ? $settings.yandexUser?.displayName || 'Аккаунт подключён' : 'Любимые треки и твой аккаунт'}</small></span>{#if $settings.yandexToken}<Check size={18} aria-label="Подключено" />{:else}<ChevronRight class="mobile-disclosure-arrow" size={20} aria-hidden="true" />{/if}</summary>
    <div class="mobile-service-content">
      {#if !$settings.yandexToken}
        <div class="mobile-guide-heading"><span class="mobile-guide-pill">3 шага</span><span>Вход через браузер</span></div>
        <ol class="mobile-connection-steps">
          <li><span>1</span><div><h3>Получи ключ доступа</h3><p>Открой сайт ниже. Если он на английском, выбери RU. Нажми «Войти через Яндекс».</p><button class="mobile-primary" onclick={() => external(TOKEN_SITE)}>Получить токен <ExternalLink size={16} aria-hidden="true" /></button><small class="mobile-link-caption">ym-token.marshal.dev · сторонний проект MarshalX</small></div></li>
          <li><span>2</span><div><h3>Подтверди вход</h3><p>На сайте появится код. Нажми «Открыть страницу Яндекса», войди в свой Яндекс ID и введи этот код, если страница попросит. Пароль вводи только на странице Яндекса, не в Lomify.</p></div></li>
          <li><span>3</span><div><h3>Вернись с токеном</h3><p>Вернись на сайт MarshalX. В блоке «Ваш токен готов» нажми «Скопировать». Затем открой LomifyNEXT, удержи поле ниже и выбери «Вставить».</p></div></li>
        </ol>
        <div class="mobile-security-note"><ShieldCheck size={18} aria-hidden="true" /><p>Токен — секретный ключ к аккаунту. Не присылай его в чат и не показывай на скриншотах. Для полного прослушивания нужна подписка Плюс.</p></div>
        <form class="mobile-connection-form" onsubmit={(e) => { e.preventDefault(); void connectYandex(); }}>
          <label for="mobile-yandex-token">Токен Яндекс Музыки</label>
          <input id="mobile-yandex-token" type={showToken ? 'text' : 'password'} bind:value={token} placeholder="Вставь скопированный токен" disabled={busy !== null} autocomplete="off" spellcheck="false" autocapitalize="none" aria-invalid={!!ymError} aria-describedby="mobile-token-help mobile-ym-error" />
          <label class="mobile-preference-row"><span>Показать токен</span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={showToken} /></label>
          <p id="mobile-token-help" class="mobile-settings-note">Нужна длинная строка токена, не короткий код входа и не пароль. Сохранится в данных приложения на этом устройстве.</p>
          <button class="mobile-primary" disabled={busy !== null || !token.trim()}>{#if busy === 'yandex'}<Loader2 class="animate-spin" size={18} />{/if}{busy === 'yandex' ? stage : 'Подключить Яндекс Музыку'}</button>
        </form>
        <details class="mobile-guide-help"><summary>Не получилось получить токен?<ChevronRight size={16} aria-hidden="true" /></summary><p>Если код истёк, начни вход на сайте заново. Не закрывай его вкладку до появления токена. Другие способы — расширение и Android-приложение — описаны в репозитории автора.</p><button class="mobile-secondary" onclick={() => external(TOKEN_REPO)}>Инструкция MarshalX <ExternalLink size={16} aria-hidden="true" /></button></details>
      {:else}
        <div class="mobile-connected-note"><Check size={20} aria-hidden="true" /><span><strong>Аккаунт подключён</strong><small>{$settings.yandexUser?.hasPlus ? 'Плюс активен' : 'Для полных треков нужна подписка Плюс'}</small></span></div>
        <p class="mobile-hint">Любимые треки сверяются при запуске. Для общей медиатеки на телефоне и ПК включи синхронизацию плейлистов ниже.</p>
        <PlaylistSyncSettings provider="yandex" />
        <button class="mobile-primary" disabled={busy !== null} onclick={() => importLibrary('yandex')}>{#if busy === 'yandex'}<Loader2 class="animate-spin" size={18} />{:else}<RefreshCw size={18} />{/if}{busy === 'yandex' ? stage : 'Импортировать треки и плейлисты'}</button>
      {/if}
      <p id="mobile-ym-error" class="mobile-error" role="alert">{ymError}</p>
      {#if ymStatus}<p class="mobile-import-status" role="status">{ymStatus}</p>{/if}
      {#if $settings.yandexToken}
        <div class="mobile-account-actions"><button class="mobile-secondary" onclick={() => currentView.set('library')}>В медиатеку <ArrowRight size={16} /></button><button class="mobile-text-button" disabled={busy !== null} onclick={() => confirming = confirming === 'yandex' ? null : 'yandex'}>Отключить</button></div>
      {/if}
    </div>
  </details>

  <details class="mobile-service-card is-soundcloud" bind:open={scOpen}>
    <summary class="mobile-service-summary"><span class="mobile-service-mark"><MusicServiceIcon service="soundcloud" size={26} /></span><span><strong>SoundCloud</strong><small>{$settings.scUser?.username || 'Импорт по ссылке на профиль'}</small></span>{#if $settings.scUser}<Check size={18} aria-label="Подключено" />{:else}<ChevronRight class="mobile-disclosure-arrow" size={20} aria-hidden="true" />{/if}</summary>
    <div class="mobile-service-content">
      {#if !$settings.scUser}
        <div class="mobile-guide-heading"><span class="mobile-guide-pill">Без пароля</span><span>Только публичные данные</span></div>
        <ol class="mobile-connection-steps">
          <li><span>1</span><div><h3>Открой свой профиль</h3><p>На сайте SoundCloud найди свой аккаунт через поиск и открой страницу профиля. Вход в Lomify для этого не нужен.</p><button class="mobile-secondary" onclick={() => external('https://soundcloud.com')}>Открыть SoundCloud <ExternalLink size={16} aria-hidden="true" /></button></div></li>
          <li><span>2</span><div><h3>Скопируй адрес профиля</h3><p>Нажми адресную строку браузера и скопируй ссылку целиком. В ней должно быть soundcloud.com и имя профиля после одного слеша, без названия трека или /sets/.</p></div></li>
          <li><span>3</span><div><h3>Подключи медиатеку</h3><p>Вставь адрес ниже и нажми «Найти профиль». Проверь появившееся имя, затем нажми «Импортировать медиатеку».</p></div></li>
        </ol>
        <form class="mobile-connection-form" onsubmit={(e) => { e.preventDefault(); void connectSoundCloud(); }}>
          <label for="mobile-sc-profile">Ссылка на профиль или никнейм</label>
          <input id="mobile-sc-profile" type="text" inputmode="url" bind:value={profile} disabled={busy !== null} placeholder="https://soundcloud.com/твой-ник" autocomplete="off" spellcheck="false" autocapitalize="none" aria-invalid={!!scError} aria-describedby="mobile-sc-error" />
          <button class="mobile-primary" disabled={busy !== null || !profile.trim()}>{#if busy === 'soundcloud'}<Loader2 class="animate-spin" size={18} />{/if}{busy === 'soundcloud' ? stage : 'Найти профиль'}</button>
        </form>
      {:else}
        <div class="mobile-connected-note">{#if $settings.scUser.avatarUrl}<img src={$settings.scUser.avatarUrl} alt="" width="40" height="40" />{:else}<Check size={20} aria-hidden="true" />{/if}<span><strong>{$settings.scUser.username}</strong><small>Публичный профиль подключён</small></span></div>
        <PlaylistSyncSettings provider="soundcloud" />
        <button class="mobile-primary" disabled={busy !== null} onclick={() => importLibrary('soundcloud')}>{#if busy === 'soundcloud'}<Loader2 class="animate-spin" size={18} />{:else}<RefreshCw size={18} />{/if}{busy === 'soundcloud' ? stage : 'Импортировать медиатеку'}</button>
        <div class="mobile-account-actions"><button class="mobile-secondary" onclick={() => currentView.set('library')}>В медиатеку <ArrowRight size={16} /></button><button class="mobile-text-button" disabled={busy !== null} onclick={() => confirming = confirming === 'soundcloud' ? null : 'soundcloud'}>Отключить</button></div>
      {/if}
      <p id="mobile-sc-error" class="mobile-error" role="alert">{scError}</p>
      {#if scStatus}<p class="mobile-import-status" role="status">{scStatus}</p>{/if}
      <div class="mobile-security-note"><ShieldCheck size={18} aria-hidden="true" /><p>Пароль и токен SoundCloud не нужны. Импортируются публичные лайки и до 50 плейлистов с доступными треками. Лайки сверяются при запуске. Изменения из Lomify не отправляются обратно в SoundCloud.</p></div>
      <details class="mobile-guide-help"><summary>Профиль или музыка не загружаются?<ChevronRight size={16} aria-hidden="true" /></summary><p>Проверь, открывается ли профиль в браузере. Если нет — проверь интернет и при необходимости VPN. Короткую ссылку сначала открой в браузере, затем скопируй полный адрес. Приватные данные и недоступные треки импортировать нельзя.</p></details>
    </div>
  </details>
  {#if confirming}<div class="mobile-disconnect-confirm" role="group" aria-label="Подтверждение отключения"><p>Отключить {confirming === 'yandex' ? 'Яндекс Музыку' : 'SoundCloud'}? Уже сохранённые треки и плейлисты останутся.</p><div class="mobile-account-actions"><button class="mobile-secondary" onclick={() => confirming = null}>Отмена</button><button class="mobile-secondary mobile-danger" onclick={() => confirming && disconnect(confirming)}>Отключить</button></div></div>{/if}
  {#if linkError}<p class="mobile-error" role="alert">{linkError}</p>{/if}
  <p class="mobile-settings-note">Громкость регулируется кнопками телефона. Подключать аккаунты для поиска в SoundCloud необязательно.</p>
  </div>
</details>
