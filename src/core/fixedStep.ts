/** Fixed-timestep accumulator. Simulation runs at `step` seconds regardless of render rate. */
export class FixedStep {
  readonly step: number;
  readonly maxSteps: number;
  private acc = 0;

  constructor(hz = 120, maxSteps = 8) {
    this.step = 1 / hz;
    this.maxSteps = maxSteps;
  }

  /** Returns the number of fixed steps to run for this frame. */
  advance(frameDt: number): number {
    this.acc += Math.min(frameDt, this.step * this.maxSteps);
    let n = 0;
    while (this.acc >= this.step - 1e-9 && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    if (n === this.maxSteps) this.acc = Math.min(this.acc, this.step);
    return n;
  }

  /** Interpolation factor between the previous and current simulation state. */
  get alpha(): number {
    return Math.max(0, Math.min(1, this.acc / this.step));
  }

  reset() {
    this.acc = 0;
  }
}
