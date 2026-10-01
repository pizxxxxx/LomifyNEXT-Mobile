/** Measure once per layout change; CSS composites the reversible artwork zoom. */
export function mobilePlayerArtwork(panel: HTMLElement) {
  const middle = panel.querySelector<HTMLElement>('.mobile-now-middle')!;
  const bottom = panel.querySelector<HTMLElement>('.mobile-now-bottom')!;
  const header = panel.querySelector<HTMLElement>('.mobile-now-header')!;
  let frame = 0;
  function measure() {
    frame = 0;
    const size = Math.max(80, Math.min(panel.clientWidth - 64, middle.clientHeight - 24, 380));
    const scale = Math.max(panel.clientWidth / size, panel.clientHeight / size) * 1.02;
    const values = {
      '--player-art-size': `${size}px`,
      '--player-art-scale': String(scale),
      '--player-art-shift-x': `${panel.clientWidth / 2 - (middle.offsetLeft + middle.clientWidth / 2)}px`,
      '--player-art-shift': `${panel.clientHeight / 2 - (middle.offsetTop + middle.clientHeight / 2)}px`,
      '--player-heading-shift': `${header.offsetTop + header.offsetHeight + 8 - bottom.offsetTop}px`
    };
    for (const [key, value] of Object.entries(values)) {
      if (panel.style.getPropertyValue(key) !== value) panel.style.setProperty(key, value);
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  const observer = new ResizeObserver(schedule);
  [panel, middle, bottom, header].forEach(node => observer.observe(node));
  schedule();
  return { destroy() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
