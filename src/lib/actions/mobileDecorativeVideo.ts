/** Keep one decoder/frame through pause, lyrics and visibility changes. */
export function mobileDecorativeVideo(node: HTMLVideoElement, active: boolean) {
  let playing = active;
  let destroyed = false;
  let frame: number | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retriedPause = false;
  node.muted = true;
  node.defaultMuted = true;
  node.setAttribute('disableremoteplayback', '');
  node.setAttribute('disablepictureinpicture', '');
  function ready() {
    if (destroyed || node.readyState < 2 || node.classList.contains('ready')) return;
    if (typeof node.requestVideoFrameCallback === 'function') {
      if (frame === undefined) frame = node.requestVideoFrameCallback(() => {
        frame = undefined;
        if (!destroyed) node.classList.add('ready');
      });
    } else node.classList.add('ready');
  }
  function sync() {
    if (destroyed) return;
    ready();
    if (playing) {
      if (node.paused) void node.play().catch(() => { /* A later foreground update can retry. */ });
    }
    else node.pause();
  }
  function unexpectedPause() {
    if (destroyed || !playing || !node.paused || node.ended || node.error || retriedPause) return;
    // WebKit can pause a decorative video during a visibility/compositing change.
    // Retry once per activation, without seeking, replacing the node or polling.
    retriedPause = true;
    retry = setTimeout(() => { retry = undefined; sync(); }, 120);
  }
  node.addEventListener('loadeddata', sync);
  node.addEventListener('canplay', sync);
  node.addEventListener('playing', ready);
  node.addEventListener('pause', unexpectedPause);
  sync();
  return {
    update(next: boolean) {
      if (next !== playing) retriedPause = false;
      playing = next;
      if (!playing) { clearTimeout(retry); retry = undefined; }
      sync();
    },
    destroy() {
      destroyed = true;
      clearTimeout(retry);
      if (frame !== undefined) node.cancelVideoFrameCallback(frame);
      node.pause();
      node.removeEventListener('loadeddata', sync);
      node.removeEventListener('canplay', sync);
      node.removeEventListener('playing', ready);
      node.removeEventListener('pause', unexpectedPause);
    }
  };
}
