/** Two deliberate motion peaks, with a short refractory window to avoid false triggers. */
export function createMobileShakeDetector(onShake: () => void) {
  let lastPeak = 0;
  let lastShake = 0;
  let aboveThreshold = false;
  let gravity: { x: number; y: number; z: number } | null = null;
  return (event: DeviceMotionEvent, now = Date.now()) => {
    let x = event.acceleration?.x;
    let y = event.acceleration?.y;
    let z = event.acceleration?.z;
    if (x == null || y == null || z == null) {
      const raw = event.accelerationIncludingGravity;
      if (raw?.x == null || raw.y == null || raw.z == null) return;
      if (!gravity) { gravity = { x: raw.x, y: raw.y, z: raw.z }; return; }
      gravity = { x: gravity.x * .82 + raw.x * .18, y: gravity.y * .82 + raw.y * .18, z: gravity.z * .82 + raw.z * .18 };
      x = raw.x - gravity.x; y = raw.y - gravity.y; z = raw.z - gravity.z;
    }
    const strong = Math.hypot(x, y, z) >= 13;
    if (!strong) { aboveThreshold = false; return; }
    if (aboveThreshold) return;
    aboveThreshold = true;
    if (lastShake && now - lastShake < 2500) return;
    if (lastPeak && now - lastPeak >= 100 && now - lastPeak <= 900) {
      lastShake = now;
      lastPeak = 0;
      onShake();
    } else lastPeak = now;
  };
}
