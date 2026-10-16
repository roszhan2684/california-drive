import type { VehicleConfig } from './config.ts';

export function engineTorque(curve: [number, number][], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

export const RPM_PER_RADS = 60 / (2 * Math.PI);

/** Gear index: -1 reverse, 0 neutral, 1..n forward. */
export class Gearbox {
  gear = 1;
  shiftTimer = 0;
  private sinceShift = 1;
  private cfg: VehicleConfig['gearbox'];

  constructor(cfg: VehicleConfig['gearbox']) {
    this.cfg = cfg;
  }

  get maxGear() {
    return this.cfg.ratios.length;
  }

  ratio(g = this.gear): number {
    if (g === 0) return 0;
    if (g < 0) return -this.cfg.reverse * this.cfg.final;
    return this.cfg.ratios[g - 1] * this.cfg.final;
  }

  get shifting() {
    return this.shiftTimer > 0;
  }

  shiftTo(g: number): boolean {
    g = Math.max(-1, Math.min(this.maxGear, g));
    if (g === this.gear) return false;
    this.gear = g;
    this.shiftTimer = this.cfg.shiftTime;
    this.sinceShift = 0;
    return true;
  }

  update(dt: number) {
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.sinceShift += dt;
  }

  /** Automatic logic. Returns true when a shift happened. */
  auto(rpm: number, throttle: number, brake: number, forwardSpeed: number): boolean {
    if (this.gear <= 0 || this.shifting || this.sinceShift < 0.45) return false;
    const up = this.cfg.downRpm + 900 + (this.cfg.upRpm - this.cfg.downRpm - 900) * Math.min(1, 0.25 + throttle * 0.85);
    if (rpm > up && this.gear < this.maxGear && throttle > 0.05) return this.shiftTo(this.gear + 1);
    if (rpm > this.cfg.upRpm + 300 && this.gear < this.maxGear) return this.shiftTo(this.gear + 1);
    const down = this.cfg.downRpm * (0.75 + throttle * 0.5) + brake * 1200;
    if (this.gear > 1 && rpm < down) {
      // only downshift if the lower gear stays under the redline
      const next = (rpm * this.ratio(this.gear - 1)) / this.ratio(this.gear);
      if (next < this.cfg.upRpm - 200) return this.shiftTo(this.gear - 1);
    }
    if (this.gear > 1 && Math.abs(forwardSpeed) < 2) return this.shiftTo(1);
    return false;
  }
}
