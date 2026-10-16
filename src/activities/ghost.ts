/** In-memory run recorder for time-trial ghosts. Never persisted (discarded with the tab). */
export interface GhostFrame { t: number; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }

export class GhostRecorder {
  frames: GhostFrame[] = [];
  private acc = 0;
  readonly interval: number;

  constructor(hz = 15) {
    this.interval = 1 / hz;
  }

  reset() {
    this.frames = [];
    this.acc = 0;
  }

  record(t: number, p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }, dt: number) {
    this.acc += dt;
    if (this.frames.length && this.acc < this.interval) return;
    this.acc = 0;
    this.frames.push({ t, x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
  }
}

/** Sample a recorded run at time t (linear position, normalized-lerp rotation). */
export function sampleGhost(frames: GhostFrame[], t: number): GhostFrame | null {
  if (!frames.length) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (frames[m].t <= t) lo = m; else hi = m;
  }
  const a = frames[lo], b = frames[hi];
  const u = (t - a.t) / (b.t - a.t || 1);
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = dot < 0 ? -1 : 1;
  let qx = a.qx + (b.qx * s - a.qx) * u, qy = a.qy + (b.qy * s - a.qy) * u, qz = a.qz + (b.qz * s - a.qz) * u, qw = a.qw + (b.qw * s - a.qw) * u;
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= l; qy /= l; qz /= l; qw /= l;
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, qx, qy, qz, qw };
}
