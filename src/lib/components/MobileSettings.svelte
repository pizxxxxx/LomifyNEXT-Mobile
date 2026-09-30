<script lang="ts">
  import { Check, ChevronRight, Palette, AudioLines, Music2, ShieldCheck, Download, RefreshCw, ExternalLink, Pencil, Type, Library, AlignLeft } from 'lucide-svelte';
  import { settings, currentView, listenStats } from '$lib/stores';
  import { APP_VERSION } from '$lib/version';
  import { withCount } from '$lib/utils/plural';
  import { checkMobileUpdate, isAndroidUpdateTarget, mobileUpdateState, openMobileUpdate } from '$lib/mobileUpdates';
  import { MOBILE_RELEASES_URL } from '$lib/mobileUpdateCore';
  import MobileConnections from './MobileConnections.svelte';
  import { allowMobilePlaylistReimport, removedMobilePlaylistCount } from '$lib/mobileTracks';
  let updateOpenError = $state('');
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
</script>

<div class="mobile-settings">
  <h1>Настройки</h1>
  <section class="mobile-preference-group mobile-account-group" aria-labelledby="account-heading">
    <h2 id="account-heading">Аккаунт</h2>
    <div class="mobile-profile-card">
      <span class="mobile-profile-avatar">{#if profileAvatar}<img src={profileAvatar} alt="" />{:else}{profileName.charAt(0).toUpperCase()}{/if}</span>
      <div><strong>{profileName}</strong><small>{Math.floor($listenStats.listenSeconds / 3600)} ч музыки · {withCount($listenStats.tracksPlayed, 'прослушивание', 'прослушивания', 'прослушиваний')}</small></div>
      {#if !$settings.scUser && !$settings.yandexUser}<button class="mobile-icon-button" aria-label="Изменить имя профиля" onclick={() => { profileDraft = $settings.customProfileName || ''; editingProfile = !editingProfile; }}><Pencil size={19} /></button>{/if}
    </div>
    {#if editingProfile}<form class="mobile-create-playlist" onsubmit={(event) => { event.preventDefault(); saveProfile(); }}><label for="mobile-profile-name">Имя профиля</label><input id="mobile-profile-name" bind:value={profileDraft} maxlength="48" /><button class="mobile-primary" type="submit" disabled={!profileDraft.trim()}>Сохранить</button></form>{/if}
  </section>
  <details class="mobile-preference-group mobile-settings-fold">
    <summary><Palette size={18} aria-hidden="true" /><span>Оформление<small>{$settings.accentFromCover ? 'Цвет из обложки' : currentAccent} · фон и движение</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
    <div class="mobile-preference-card">
      <div class="mobile-theme-preview" aria-hidden="true">
        <img src="/mobile-icon.png" alt="" width="44" height="44" />
        <div><strong>Оформление плеера</strong><span>Цвет и движение</span></div><AudioLines size={24} />
      </div>
      <div class="mobile-preference-label"><span>Цвет акцента</span><small>{$settings.accentFromCover ? 'Из обложки' : currentAccent}</small></div>
      <div class="mobile-accent-options" role="group" aria-label="Цвет акцента">
        {#each accents as accent}
          <button class="mobile-accent-option" aria-label={accent.name} aria-pressed={$settings.theme === accent.id && !$settings.accentFromCover} onclick={() => chooseAccent(accent.id)}>
            <span style:background={accent.color}>{#if $settings.theme === accent.id && !$settings.accentFromCover}<Check size={20} aria-hidden="true" />{/if}</span><small>{accent.name}</small>
          </button>
        {/each}
      </div>
      <label class="mobile-preference-row"><span><strong>Цвет из обложки</strong><small>Меняется вместе с треком</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.accentFromCover} /></label>
      <label class="mobile-preference-row"><span><strong>Цветная глубина фона</strong><small>Фон мягко подхватывает выбранный цвет или оттенок обложки</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.globalThemeEffect} /></label>
      <label class="mobile-preference-row"><span><strong>Плавные переходы</strong><small>Разделы, плеер и отклик кнопок</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileMotion} /></label>
      <label class="mobile-preference-row"><span><strong>Видеофон Яндекса</strong><small>В полноэкранном плеере. Работает при воспроизведении, расходует трафик и заряд. Системное уменьшение движения его отключает.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileVideoBackground} /></label>
      <label class="mobile-preference-row"><span><strong>Видео за текстом</strong><small>Приглушённый видеофон остаётся за строками песни. Нужен доступный видеофон Яндекса.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileLyricsVideoBackground} disabled={!$settings.mobileVideoBackground} /></label>
      <label class="mobile-preference-row"><span><strong>Глубина от наклона</strong><small>Крупные карточки слегка двигаются при наклоне телефона. Не работает при уменьшенном движении.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileDepthMotion} /></label>
      <label class="mobile-preference-row"><span><strong>Живое свечение станции</strong><small>Медленно движется и откликается на музыку. Можно отключить для экономии заряда.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileVisualizer} /></label>
      <label class="mobile-preference-row"><span><strong>Размытие панелей</strong><small>Мини-плеер, навигация и меню. Можно выключить на слабом телефоне.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileBlur} /></label>
    </div>
  </details>
  <details class="mobile-preference-group mobile-settings-fold">
    <summary><Type size={18} aria-hidden="true" /><span>Шрифт интерфейса<small>{uiFonts.find(font => font.id === $settings.mobileUiFont)?.name || 'Onest'}</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
    <div class="mobile-preference-card">
      <label class="mobile-select-row"><span>Гарнитура</span><select bind:value={$settings.mobileUiFont}>{#each uiFonts as font}<option value={font.id}>{font.name}</option>{/each}</select></label>
      <label class="mobile-select-row"><span>Насыщенность</span><select bind:value={$settings.mobileTextWeight}><option value="normal">Обычная</option><option value="medium">Средняя</option><option value="bold">Полужирная</option></select></label>
      <p class="mobile-font-preview">Любимые треки всегда рядом</p>
    </div>
  </details>
  <details class="mobile-preference-group mobile-settings-fold"><summary><AudioLines size={18} aria-hidden="true" /><span>Воспроизведение<small>Эквалайзер, загрузка и трафик</small></span><ChevronRight size={18} aria-hidden="true" /></summary><div class="mobile-preference-card">
    <button class="mobile-preference-row mobile-setting-link" onclick={() => currentView.set('equalizer')}><span><strong>Эквалайзер</strong><small>10 полос и готовые настройки</small></span><ChevronRight size={20} aria-hidden="true" /></button>
    <label class="mobile-preference-row"><span><strong>Превью трека</strong><small>Кнопка в меню трека, без автозапуска</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobilePreview} /></label>
    <label class="mobile-preference-row"><span><strong>Экономия трафика</strong><small>Предпочитать меньший размер потока, когда источник это позволяет</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileDataSaver} /></label>
    <label class="mobile-preference-row"><span><strong>Предзагрузка следующего</strong><small>Меньше пауза между треками, больше трафик</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.preloadNext} /></label>
    {#if $settings.mobileHiddenTracks.length}<div class="mobile-preference-row"><span><strong>Скрытые треки: {$settings.mobileHiddenTracks.length}</strong><small>Вернуть их в рекомендации и поиск</small></span><button class="mobile-secondary" onclick={() => settings.update(s => ({ ...s, mobileHiddenTracks: [] }))}>Очистить</button></div>{/if}
  </div></details>
  <details class="mobile-preference-group mobile-settings-fold"><summary><Music2 size={18} aria-hidden="true" /><span>Станция<small>{$settings.mobileWaveName === 'wave' ? 'Моя Волна' : 'Моя Тусня'}</small></span><ChevronRight size={18} aria-hidden="true" /></summary><div class="mobile-preference-card">
    <div class="mobile-preference-label"><span>Название станции</span><small>Подбор музыки не меняется</small></div>
    <div class="mobile-source-options" role="group" aria-label="Название станции"><button aria-pressed={$settings.mobileWaveName === 'wave'} onclick={() => settings.update(s => ({ ...s, mobileWaveName: 'wave' }))}>Моя Волна</button><button aria-pressed={$settings.mobileWaveName !== 'wave'} onclick={() => settings.update(s => ({ ...s, mobileWaveName: 'party' }))}>Моя Тусня</button></div>
    <label class="mobile-preference-row"><span><strong>Текст в станции</strong><small>Показывать текущую строку, если есть синхронизация</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileWaveLyrics} /></label>
  </div></details>
  <details class="mobile-preference-group mobile-settings-fold"><summary><AlignLeft size={18} aria-hidden="true" /><span>Текст песни<small>Подсветка {$settings.mobileLyricsLetterSync ? 'по буквам' : 'по строкам'}</small></span><ChevronRight size={18} aria-hidden="true" /></summary><div class="mobile-preference-card">
    <label class="mobile-select-row"><span>Шрифт текста</span><select bind:value={$settings.fontFamily}>{#each lyricFonts as font}<option value={font.id}>{font.name}</option>{/each}</select></label>
    <p class="mobile-font-preview mobile-lyric-font-preview">Музыка звучит, а слова остаются</p>
    <div class="mobile-preference-label"><span>Размер текста</span><small>{$settings.mobileTextSize === 'large' ? 'Крупный' : 'Обычный'}</small></div>
    <div class="mobile-source-options" role="group" aria-label="Размер текста"><button aria-pressed={$settings.mobileTextSize !== 'large'} onclick={() => settings.update(s => ({ ...s, mobileTextSize: 'normal' }))}>Обычный</button><button aria-pressed={$settings.mobileTextSize === 'large'} onclick={() => settings.update(s => ({ ...s, mobileTextSize: 'large' }))}>Крупный</button></div>
    <div class="mobile-preference-label"><span>Подсветка текста</span><small>Режим для текста в плеере</small></div>
    <div class="mobile-source-options" role="group" aria-label="Подсветка текста"><button aria-pressed={!$settings.mobileLyricsLetterSync} onclick={() => settings.update(s => ({ ...s, mobileLyricsLetterSync: false }))}>По строкам</button><button aria-pressed={$settings.mobileLyricsLetterSync} onclick={() => settings.update(s => ({ ...s, mobileLyricsLetterSync: true }))}>По буквам</button></div>
    <label class="mobile-preference-row"><span><strong>Эдлибы</strong><small>Фразы в скобках появляются отдельно, когда звучит строка</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.lyricsAdlibs} /></label>
    <label class="mobile-preference-row"><span><strong>Сдвиг текста</strong><small>Если подсветка опережает или отстаёт: {$settings.lyricsOffset} мс</small></span><input type="range" min="-1000" max="1000" step="50" bind:value={$settings.lyricsOffset} aria-label="Сдвиг текста в миллисекундах" /></label>
  </div></details>
  <MobileConnections />
  <details class="mobile-preference-group mobile-settings-fold">
    <summary><Library size={18} aria-hidden="true" /><span>Медиатека<small>Плейлисты и любимые треки</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
    <div class="mobile-preference-card">
      <label class="mobile-preference-row"><span><strong>Перемешивание встряхиванием</strong><small>Работает только в открытом плейлисте. Порядок можно вернуть кнопкой «Отменить».</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileShakeShuffle} /></label>
      <label class="mobile-preference-row"><span><strong>Не возвращать удалённые лайки Яндекса</strong><small>Остальные новые лайки продолжат импортироваться. Действует только на этом телефоне.</small></span><input class="mobile-toggle" type="checkbox" role="switch" bind:checked={$settings.mobileSkipRemovedYandexLikes} /></label>
      {#if removedPlaylistCount > 0}<div class="mobile-preference-row"><span><strong>Удалённые импортированные плейлисты: {removedPlaylistCount}</strong><small>Разрешить снова импортировать их из аккаунтов</small></span><button class="mobile-secondary" onclick={() => { allowMobilePlaylistReimport(); removedPlaylistCount = 0; }}>Разрешить</button></div>{/if}
    </div>
  </details>
  <details class="mobile-preference-group mobile-settings-fold">
    <summary><Download size={18} aria-hidden="true" /><span>Обновления</span><ChevronRight size={18} aria-hidden="true" /></summary>
    <div class="mobile-preference-card mobile-update-card">
      <div class="mobile-update-current"><span>Установлена версия</span><strong>{APP_VERSION}</strong></div>
      {#if isAndroidUpdateTarget}
        {#if $mobileUpdateState.status === 'available' && $mobileUpdateState.update}
          <p class="mobile-update-status" role="status">Доступна версия {$mobileUpdateState.update.version}. Файл APK опубликован в GitHub Releases.</p>
          <button class="mobile-primary" onclick={() => openUpdate($mobileUpdateState.update!.apkUrl)}><Download size={18} aria-hidden="true" /> Скачать APK</button>
          <p class="mobile-hint">Откроется браузер. После загрузки открой APK и подтверди установку в Android. Для обновления без удаления данных подпись новой сборки должна совпадать с установленной.</p>
        {:else if $mobileUpdateState.status === 'checking'}
          <p class="mobile-hint" role="status">Проверяем релизы GitHub...</p>
        {:else if $mobileUpdateState.status === 'current'}
          <p class="mobile-hint" role="status">Новой Android-сборки пока нет.</p>
        {:else if $mobileUpdateState.status === 'error'}
          <p class="mobile-error" role="alert">{$mobileUpdateState.message}</p>
        {:else}
          <p class="mobile-hint">Проверка начнётся автоматически при запуске приложения.</p>
        {/if}
        <button class="mobile-secondary" disabled={$mobileUpdateState.status === 'checking'} onclick={() => checkMobileUpdate(true)}><RefreshCw size={17} aria-hidden="true" /> Проверить сейчас</button>
      {:else}
        <p class="mobile-hint">На iPhone обновления устанавливаются через TestFlight или App Store после публикации iOS-сборки. GitHub здесь показывает только новости о релизах.</p>
      {/if}
      <button class="mobile-text-button" onclick={() => openUpdate(MOBILE_RELEASES_URL)}><ExternalLink size={17} aria-hidden="true" /> Все релизы GitHub</button>
      {#if updateOpenError}<p class="mobile-error" role="alert">{updateOpenError}</p>{/if}
    </div>
  </details>
  <details class="mobile-about mobile-settings-fold">
    <summary><ShieldCheck size={18} aria-hidden="true" /><span>О приложении</span><small>{APP_VERSION}</small><ChevronRight size={18} aria-hidden="true" /></summary>
    <p class="mobile-hint">{isAndroidUpdateTarget ? 'Android-версия. Скачанные треки доступны без интернета. Управление музыкой работает в уведомлении и на экране блокировки.' : 'Версия для iPhone пока проходит проверку. Скачанные треки хранятся в данных приложения.'}</p>
  </details>
  <p class="mobile-version">LomifyNEXT · {APP_VERSION}</p>
</div>
