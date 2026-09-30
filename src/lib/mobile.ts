import { writable } from 'svelte/store';

/** One-shot navigation request from the wave's sign-in button. Never contains credentials. */
export const mobileConnectionRequest = writable<'yandex' | null>(null);

/** Native Android and iOS use the phone shell, including tablets and landscape. */
export const isMobile = typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (import.meta.env.DEV && new URLSearchParams(location.search).has('mobile')));
