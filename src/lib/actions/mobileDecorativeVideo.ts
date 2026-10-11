/** Keep one decoder/frame through pause, lyrics and visibility changes. */
export function mobileDecorativeVideo(node: HTMLVideoElement, active: boolean) {
  let playing = active;
  let destroyed = false;
  node.muted = true;
  node.defaultMuted = true;
  node.setAttribute('disableremoteplayback', '');
  node.setAttribute('disablepictureinpicture', '');
  function ready() {
    if (node.readyState >= 2) node.classList.add('ready');
  }
  function sync() {
    if (destroyed) return;
    ready();
    if (playing) void node.play().catch(() => { /* A later foreground update can retry. */ });
    else node.pause();
  }
  node.addEventListener('loadeddata', sync);
  node.addEventListener('canplay', sync);
  node.addEventListener('playing', ready);
  sync();
  return {
    update(next: boolean) { playing = next; sync(); },
    destroy() {
      destroyed = true;
      node.pause();
      node.removeEventListener('loadeddata', sync);
      node.removeEventListener('canplay', sync);
      node.removeEventListener('playing', ready);
    }
  };
}
