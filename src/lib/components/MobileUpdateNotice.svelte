<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Download, ArrowUpRight } from 'lucide-svelte';
  import { settings } from '$lib/stores';
  import { mobileUpdateReminder, mobileUpdateState, dismissMobileUpdate, openMobileUpdate } from '$lib/mobileUpdates';
  import { mobileUpdateLink, type MobileUpdate } from '$lib/mobileUpdateCore';
  import { hasIOSOverlayChange } from '$lib/utils/iosOverlayChanges';
  import { afterMobilePaint } from '$lib/utils/mobilePaint';

  let dialog: HTMLDialogElement;
  let selected = $state<MobileUpdate | null>(null);
  let installedVersion = $state('');
  let opening = $state(false);
  let closing = $state(false);
  let error = $state('');
  let finishExit: ReturnType<typeof setTimeout> | undefined;

  function dismiss() {
    if (!selected || closing) return;
    dismissMobileUpdate(selected.version);
    closing = true;
    const reduceMotion = $settings.mobileMotion === false || matchMedia('(prefers-reduced-motion: reduce)').matches;
    finishExit = setTimeout(() => { dialog.close(); closing = false; }, reduceMotion ? 0 : 150);
  }
  async function download() {
    if (!selected || opening) return;
    opening = true;
    error = '';
    try { await openMobileUpdate(mobileUpdateLink(selected)); dismiss(); }
    catch { error = 'Не удалось открыть браузер. Попробуй ещё раз или открой релизы в настройках.'; }
    finally { opening = false; }
  }

  onMount(() => {
    let disposed = false;
    let candidate: MobileUpdate | null = null;
    let cancelShow = () => {};
    let currentVersion = '';
    const schedule = () => {
      cancelShow();
      if (!candidate || dialog.open || document.hidden) return;
      cancelShow = afterMobilePaint(async () => {
        const active = document.activeElement;
        const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable;
        // Wait for the current sheet, keyboard or full-screen player to close.
        if (!candidate || dialog.open || document.hidden || editing || document.querySelector('dialog[open], [aria-modal="true"], .mobile-player.expanded:not([inert])')) return;
        selected = candidate;
        installedVersion = currentVersion;
        error = '';
        closing = false;
        await tick();
        if (disposed || !candidate || selected?.version !== candidate.version || document.hidden) return;
        dialog.showModal();
        dialog.querySelector<HTMLButtonElement>('[data-update-later]')?.focus({ preventScroll: true });
      }, 300);
    };
    const releaseState = mobileUpdateState.subscribe(state => { currentVersion = state.installedVersion; });
    const releaseReminder = mobileUpdateReminder.subscribe(update => { candidate = update; schedule(); });
    const observer = new MutationObserver(records => { if (hasIOSOverlayChange(records)) schedule(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'inert', 'hidden', 'open', 'aria-modal'] });
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('focusout', schedule);
    const androidBack = (event: Event) => {
      if (!dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener('lomify:android-back', androidBack, true);
    return () => {
      disposed = true;
      cancelShow();
      clearTimeout(finishExit);
      releaseState();
      releaseReminder();
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('focusout', schedule);
      window.removeEventListener('lomify:android-back', androidBack, true);
      if (dialog.open) dialog.close();
    };
  });
</script>

<dialog bind:this={dialog} class="mobile-update-notice" class:closing class:motion-off={$settings.mobileMotion === false} aria-labelledby="mobile-update-title" aria-describedby="mobile-update-description" oncancel={(event) => { event.preventDefault(); dismiss(); }} onclose={() => { if (selected) dismissMobileUpdate(selected.version); }}>
  {#if selected}
    <p class="update-eyebrow">LomifyNEXT · {selected.platform === 'ios' ? 'iOS' : 'Android'}</p>
    <h2 id="mobile-update-title">Вышла новая версия</h2>
    <p class="update-versions"><span>{installedVersion}</span><ArrowUpRight size={16} aria-hidden="true" /><strong>{selected.version}</strong></p>
    <p id="mobile-update-description">{selected.platform === 'ios' ? 'Скачай IPA с GitHub и установи через AltStore с тем же Apple ID.' : 'Скачай APK с GitHub и открой его, чтобы обновить приложение.'}</p>
    <p class="update-data-hint">Данные и любимые треки сохранятся.</p>
    {#if error}<p class="update-error" role="alert">{error}</p>{/if}
    <div class="update-actions">
      <button class="mobile-primary" disabled={opening || closing} onclick={download}><Download size={18} aria-hidden="true" />{opening ? 'Открываем…' : selected.platform === 'ios' ? 'Скачать IPA' : 'Скачать APK'}</button>
      <button class="mobile-secondary" data-update-later disabled={opening || closing} onclick={dismiss}>Позже</button>
    </div>
  {/if}
</dialog>

<style>
  .mobile-update-notice { width: min(380px, calc(100vw - 32px)); max-height: calc(100dvh - 48px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); margin: auto; padding: 24px; overflow: auto; overscroll-behavior: contain; border: 0; border-radius: 24px; background: var(--mobile-surface); color: var(--mobile-text); box-shadow: 0 0 0 1px var(--mobile-border), 0 20px 60px rgb(0 0 0 / .35); }
  .mobile-update-notice::backdrop { background: rgb(0 0 0 / .55); }
  .mobile-update-notice[open] { animation: update-enter 280ms ease-out both; }
  .mobile-update-notice[open].closing { animation: update-exit 150ms ease-out both; }
  .update-eyebrow { margin: 0 0 12px; font-size: 13px; color: var(--mobile-muted); }
  h2 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 600; letter-spacing: -.025em; }
  .update-versions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; margin: 14px 0 20px; font-size: 15px; font-variant-numeric: tabular-nums; }
  .update-versions span, .update-versions :global(svg) { color: var(--mobile-muted); }
  .update-versions strong { color: var(--mobile-accent); font-weight: 600; }
  #mobile-update-description { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
  .update-data-hint { margin: 10px 0 0; font-size: 13px; color: var(--mobile-muted); }
  .update-actions { display: grid; gap: 8px; margin-top: 24px; animation: update-enter 240ms ease-out 100ms both; }
  .update-actions button { width: 100%; min-height: 46px; border-radius: 12px; font-size: 15px; }
  .update-error { margin: 12px 0 0; color: var(--mobile-danger, #ff897f); font-size: 13px; overflow-wrap: anywhere; }
  @keyframes update-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes update-exit { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
  .mobile-update-notice.motion-off[open], .motion-off .update-actions { animation: none; }
  @media (prefers-reduced-motion: reduce) { .mobile-update-notice[open], .update-actions { animation: none; } }
</style>
