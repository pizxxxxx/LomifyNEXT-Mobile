<script module lang="ts">
  const videoCache = new Map<string, Promise<string>>();
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from '$lib/stores';
  import { getYandexBackgroundVideoUrl, normalizeYandexBackgroundVideoUrl } from '$lib/yandex';
  import { handleArtworkError, handleArtworkLoad } from '$lib/offlineCovers';

  type VideoTrack = { source: string; id?: string; backgroundVideoUrl?: string; coverUrl?: string } | null;
  let { track, coverUrl = '', active = true, variant }: {
    track: VideoTrack;
    coverUrl?: string;
    active?: boolean;
    variant: 'player' | 'lyrics';
  } = $props();

  let resolvedUrl = $state('');
  let failedUrl = $state('');
  let videoReady = $state(false);
  let visible = $state(true);
  let reducedMotion = $state(false);
  let directUrl = $derived(track?.source === 'yandex' ? normalizeYandexBackgroundVideoUrl(track.backgroundVideoUrl) : '');
  let videoUrl = $derived(directUrl || resolvedUrl);
  let enabled = $derived(active && visible && !reducedMotion && $settings.mobileVideoBackground !== false &&
    (variant !== 'lyrics' || $settings.mobileLyricsVideoBackground !== false));
  let showVideo = $derived(enabled && !!videoUrl && failedUrl !== videoUrl);

  function decorativeVideo(node: HTMLVideoElement) {
    node.setAttribute('disableremoteplayback', '');
    node.setAttribute('disablepictureinpicture', '');
  }

  $effect(() => {
    const id = track?.source === 'yandex' ? track.id : undefined;
    const token = $settings.yandexToken;
    const shouldResolve = enabled && !!id && !!token && !directUrl;
    resolvedUrl = '';
    failedUrl = '';
    videoReady = false;
    if (!shouldResolve || !id) return;
    let cancelled = false;
    const cacheKey = `${token}:${id}`;
    let request = videoCache.get(cacheKey);
    if (!request) {
      request = getYandexBackgroundVideoUrl(token, id).catch(error => {
        videoCache.delete(cacheKey);
        throw error;
      });
      videoCache.set(cacheKey, request);
      if (videoCache.size > 40) videoCache.delete(videoCache.keys().next().value!);
    }
    void request.then(url => { if (!cancelled) resolvedUrl = url; }).catch(() => { /* Cover or theme stays visible. */ });
    return () => { cancelled = true; };
  });

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const syncVisibility = () => { visible = !document.hidden; };
    const syncMotion = () => { reducedMotion = motion.matches; };
    syncVisibility();
    syncMotion();
    document.addEventListener('visibilitychange', syncVisibility);
    motion.addEventListener('change', syncMotion);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      motion.removeEventListener('change', syncMotion);
    };
  });
</script>

<div class:mobile-now-art={variant === 'player'} class:mobile-lyrics-backdrop={variant === 'lyrics'} class="mobile-video-backdrop" aria-hidden="true">
  {#if variant === 'player' && coverUrl}<img src={coverUrl} alt="" onerror={(event) => handleArtworkError(event, track?.coverUrl || '')} onload={handleArtworkLoad} />{/if}
  {#if showVideo}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={videoUrl} use:decorativeVideo autoplay muted loop playsinline preload="metadata" poster={coverUrl} class:ready={videoReady} onloadeddata={() => videoReady = true} onerror={() => failedUrl = videoUrl} aria-hidden="true"></video>
  {/if}
</div>
