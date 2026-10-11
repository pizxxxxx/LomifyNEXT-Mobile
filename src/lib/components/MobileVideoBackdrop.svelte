<script module lang="ts">
  const videoCache = new Map<string, { expires: number; request: Promise<string> }>();
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from '$lib/stores';
  import { getYandexBackgroundVideoUrl, normalizeYandexBackgroundVideoUrl } from '$lib/yandex';
  import { mobileDecorativeVideo } from '$lib/actions/mobileDecorativeVideo';

  type VideoTrack = { source: string; id?: string; backgroundVideoUrl?: string } | null;
  let { track, active = true, variant }: {
    track: VideoTrack;
    active?: boolean;
    variant: 'player' | 'lyrics';
  } = $props();

  let resolvedUrl = $state('');
  let failedUrl = $state('');
  let visible = $state(true);
  let reducedMotion = $state(false);
  let directUrl = $derived(track?.source === 'yandex' ? normalizeYandexBackgroundVideoUrl(track.backgroundVideoUrl) : '');
  let trackId = $derived(track?.source === 'yandex' ? String(track.id || '').split(':')[0] : '');
  let token = $derived($settings.yandexToken);
  let videoUrl = $derived(directUrl || resolvedUrl);
  let allowed = $derived(!reducedMotion && $settings.mobileVideoBackground !== false &&
    (variant !== 'lyrics' || $settings.mobileLyricsVideoBackground !== false));
  let enabled = $derived(active && visible && allowed);
  let showVideo = $derived(allowed && !!videoUrl && failedUrl !== videoUrl);

  $effect(() => {
    const id = trackId;
    // Resolve by media identity, not playback/visibility or the track object.
    // Enrichment and pause must not reset readiness on an already loaded <video>.
    const shouldResolve = allowed && !!id && !!token && !directUrl;
    resolvedUrl = '';
    failedUrl = '';
    if (!shouldResolve || !id) return;
    let cancelled = false;
    const cacheKey = `${token}:${id}`;
    let entry = videoCache.get(cacheKey);
    if (!entry || entry.expires <= Date.now()) {
      const request = getYandexBackgroundVideoUrl(token, id).catch(error => {
        videoCache.delete(cacheKey);
        throw error;
      });
      entry = { request, expires: Date.now() + 300_000 };
      videoCache.set(cacheKey, entry);
      if (videoCache.size > 40) videoCache.delete(videoCache.keys().next().value!);
    }
    void entry.request.then(url => { if (!cancelled) resolvedUrl = url; }).catch(() => { /* Theme stays visible. */ });
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
  {#if showVideo}
    {#key videoUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={videoUrl} use:mobileDecorativeVideo={enabled} muted loop playsinline preload="metadata" onerror={() => failedUrl = videoUrl} aria-hidden="true"></video>
    {/key}
  {/if}
</div>
