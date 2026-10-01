/** The native analyser supplies 64 logarithmic, compressed bands, not byte FFT data. */
export class MobileWaveMotion {
  bass = 0;
  body = 0;
  beat = 0;
  rotation = 0;
  lightRotation = 0;
  private bassPeak = .22;
  private bodyPeak = .22;
  private baseline = 0;
  private previousEnergy = 0;
  private previousBands = new Float32Array(48);
  private fluxLevel = 0;
  private previousFlux = 0;
  private lastAt = -Infinity;
  private lastBeatAt = -Infinity;
  private direction = -1;

  reset() {
    this.bass = this.body = this.beat = this.rotation = this.lightRotation = 0;
    this.bassPeak = this.bodyPeak = .22;
    this.baseline = this.previousEnergy = 0;
    this.previousBands.fill(0);
    this.fluxLevel = this.previousFlux = 0;
    this.lastAt = this.lastBeatAt = -Infinity;
    this.direction = -1;
    return this;
  }

  update(bins: Float32Array, now: number) {
    // Roughly 38–240 Hz: include the kick/body of bass, rather than only sub-bass.
    const low = this.band(bins, 6, 23);
    const mid = this.band(bins, 23, 48);
    // The analyser sends one zero frame when PCM stops, then sends nothing.
    if (low < .001 && mid < .001) return this.reset();
    const dt = Number.isFinite(this.lastAt) ? Math.max(1, Math.min(250, now - this.lastAt)) : 50;
    this.lastAt = now;
    const decay = Math.exp(-dt / 1400);
    this.bassPeak = Math.max(.22, low, this.bassPeak * decay);
    this.bodyPeak = Math.max(.22, mid, this.bodyPeak * decay);
    const bassTarget = Math.sqrt(Math.min(1, Math.max(0, low - .008) / this.bassPeak));
    const bodyTarget = Math.sqrt(Math.min(1, Math.max(0, mid - .008) / this.bodyPeak));
    const energy = low * .85 + mid * .15;
    let bassFlux = 0, bodyFlux = 0;
    for (let index = 6; index < 48; index++) {
      const value = Number.isFinite(bins[index]) ? Math.max(0, Math.min(1, bins[index])) : 0;
      const rise = Math.max(0, value - this.previousBands[index]);
      if (index < 23) bassFlux += rise;
      else bodyFlux += rise;
      this.previousBands[index] = value;
    }
    const flux = bassFlux / 17 * .8 + bodyFlux / 25 * .2;
    this.beat *= Math.exp(-dt / 170);
    // Inspect rising individual bands too: a held loud harmonic can mask every
    // subsequent kick in the aggregate energy, even though the spectrum changes.
    const energyOnset = energy > this.baseline * 1.2 + .012 && energy - this.previousEnergy > .008;
    const spectralOnset = flux > Math.max(.006, this.fluxLevel * 1.6 + .003) && flux > this.previousFlux * 1.15 + .002;
    if (energy > .025 && (energyOnset || spectralOnset) && now - this.lastBeatAt >= 180) {
      this.lastBeatAt = now;
      this.direction *= -1;
      this.beat = Math.max(.35, bassTarget);
    }
    this.baseline += (energy - this.baseline) * (1 - Math.exp(-dt / 300));
    this.previousEnergy = energy;
    this.fluxLevel += (flux - this.fluxLevel) * (1 - Math.exp(-dt / 600));
    this.previousFlux = flux;
    this.bass = this.follow(this.bass, bassTarget, dt);
    this.body = this.follow(this.body, bodyTarget, dt);
    const targetRotation = this.direction * (this.bass * .8 + this.beat * 4.5);
    this.rotation += (targetRotation - this.rotation) * (1 - Math.exp(-dt / 55));
    this.lightRotation = -this.rotation * .7 + (this.body - this.bass) * 1.2;
    return this;
  }

  private follow(current: number, target: number, dt: number) {
    return current + (target - current) * (1 - Math.exp(-dt / (target > current ? 35 : 180)));
  }

  private band(bins: Float32Array, start: number, end: number) {
    let sum = 0, peak = 0;
    for (let index = start; index < end; index++) {
      const value = Number.isFinite(bins[index]) ? Math.max(0, Math.min(1, bins[index])) : 0;
      sum += value;
      peak = Math.max(peak, value);
    }
    return peak * .65 + sum / (end - start) * .35;
  }
}
