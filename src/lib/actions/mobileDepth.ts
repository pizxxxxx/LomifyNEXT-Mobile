type DepthOptions = { enabled: boolean; view: string };

/** One sensor listener and at most three gently moving panels per visible screen. */
export function mobileDepth(node: HTMLElement, initial: DepthOptions) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let options = initial;
  let listening = false;
  let frame = 0;
  let selectionFrame = 0;
  let baseBeta: number | null = null;
  let baseGamma: number | null = null;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let panels: HTMLElement[] = [];

  function clearPanels() {
    for (const panel of panels) {
      panel.style.removeProperty('translate');
      panel.style.removeProperty('will-change');
    }
    panels = [];
  }

  function render() {
    frame = 0;
    x += (targetX - x) * .18;
    y += (targetY - y) * .18;
    const settled = Math.abs(targetX - x) < .005 && Math.abs(targetY - y) < .005;
    for (const [index, panel] of panels.entries()) {
      const depth = index === 0 ? 1 : .72;
      panel.style.setProperty('translate', `${(x * 5 * depth).toFixed(2)}px ${(y * 3 * depth).toFixed(2)}px`);
    }
    if (!settled) frame = requestAnimationFrame(render);
  }

  function onOrientation(event: DeviceOrientationEvent) {
    if (event.beta === null || event.gamma === null) return;
    if (baseBeta === null || baseGamma === null) {
      baseBeta = event.beta;
      baseGamma = event.gamma;
      return;
    }
    const landscape = Math.abs(screen.orientation?.angle ?? 0) === 90;
    const dx = landscape ? event.beta - baseBeta : event.gamma - baseGamma;
    const dy = landscape ? event.gamma - baseGamma : event.beta - baseBeta;
    targetX = Math.max(-1, Math.min(1, dx / 24));
    targetY = Math.max(-1, Math.min(1, dy / 30));
    if (!frame) frame = requestAnimationFrame(render);
  }

  function resetCalibration() {
    baseBeta = null;
    baseGamma = null;
    targetX = 0;
    targetY = 0;
    if (panels.length && !frame) frame = requestAnimationFrame(render);
  }

  function sync() {
    const shouldListen = options.enabled && !motion.matches && !document.hidden && 'DeviceOrientationEvent' in window;
    if (!shouldListen) {
      if (listening) window.removeEventListener('deviceorientation', onOrientation);
      listening = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearPanels();
      resetCalibration();
      x = 0;
      y = 0;
      return;
    }
    clearPanels();
    panels = [...node.querySelectorAll<HTMLElement>('.mobile-wave-shortcut, .mobile-favorites, .mobile-profile-card, .mobile-artist-hero')]
      .filter(panel => panel.getClientRects().length > 0)
      .slice(0, 3);
    for (const panel of panels) panel.style.setProperty('will-change', 'translate');
    resetCalibration();
    if (!listening) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      listening = true;
    }
  }

  function scheduleSync() {
    if (selectionFrame) cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      sync();
    });
  }

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('orientationchange', resetCalibration);
  motion.addEventListener('change', sync);
  scheduleSync();

  return {
    update(next: DepthOptions) { options = next; scheduleSync(); },
    destroy() {
      options = { ...options, enabled: false };
      if (selectionFrame) cancelAnimationFrame(selectionFrame);
      sync();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('orientationchange', resetCalibration);
      motion.removeEventListener('change', sync);
    }
  };
}
