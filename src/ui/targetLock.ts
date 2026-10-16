// Screen-space target lock on the nearest activity marker (or the live checkpoint).
// Built like a Rive state machine: one input (the chosen target) drives four states, and each transition
// plays a short tween. Reticle shapes are Kenney "Crosshair Pack" (CC0) SVGs used as CSS masks.
//
//   idle ──target──▶ acquiring ──0.5 s──▶ locked ──target changes──▶ acquiring
//     ▲                  │                   │
//     └──── lost ◀───────┴──── no target ────┘
import { Vector3, type Camera } from 'three';
import type { ActivityKind, Marker } from '../activities/activities.ts';
import { el } from './dom.ts';
import { scrambleText, tween } from './motion.ts';

export type LockState = 'idle' | 'acquiring' | 'locked' | 'lost';

export interface LockTarget {
  id: string;
  kind: ActivityKind | 'checkpoint';
  name: string;
  x: number; y: number; z: number;
}

const KIND_LABEL: Record<LockTarget['kind'], string> = {
  timeTrial: 'TIME TRIAL', scenic: 'SCENIC ROUTE', drift: 'DRIFT ZONE', speedTrap: 'SPEED TRAP', parking: 'PARKING', slalom: 'SLALOM', photo: 'PHOTO SPOT', checkpoint: 'CHECKPOINT',
};
export const KIND_COLOR: Record<LockTarget['kind'], string> = {
  timeTrial: '#ff5a36', scenic: '#4fd1ff', drift: '#ff3fa4', speedTrap: '#ffd23d', parking: '#58f29a', slalom: '#ff9f1c', photo: '#c58cff', checkpoint: '#ffb347',
};

/** Pure state transition, unit-testable. */
export function nextLockState(s: LockState, hasTarget: boolean, sameTarget: boolean, inState: number): LockState {
  switch (s) {
    case 'idle': return hasTarget ? 'acquiring' : 'idle';
    case 'acquiring': return !hasTarget ? 'lost' : !sameTarget ? 'acquiring' : inState > 0.5 ? 'locked' : 'acquiring';
    case 'locked': return !hasTarget ? 'lost' : sameTarget ? 'locked' : 'acquiring';
    case 'lost': return hasTarget ? 'acquiring' : inState > 0.3 ? 'idle' : 'lost';
  }
}

/** Choose what to lock: the live checkpoint, else the nearest marker within range. */
export function pickTarget(markers: Marker[], checkpoint: { x: number; y?: number; z: number } | null, px: number, pz: number, range = 320): LockTarget | null {
  if (checkpoint) return { id: 'checkpoint', kind: 'checkpoint', name: 'Next checkpoint', x: checkpoint.x, y: checkpoint.y ?? 0, z: checkpoint.z };
  let best: Marker | null = null, bd = range;
  for (const m of markers) {
    const d = Math.hypot(m.x - px, m.z - pz);
    // inside the start zone the "Press T" prompt takes over
    if (d < Math.max(10, m.radius)) continue;
    if (d < bd) { bd = d; best = m; }
  }
  return best ? { id: best.id, kind: best.kind, name: best.name, x: best.x, y: best.y, z: best.z } : null;
}

const _v = new Vector3();

export class TargetLock {
  readonly root: HTMLElement;
  private node: HTMLElement;
  private ring: HTMLElement;
  private brk: HTMLElement;
  private dot: HTMLElement;
  private kindEl: HTMLElement;
  private nameEl: HTMLElement;
  private distEl: HTMLElement;
  state: LockState = 'idle';
  private inState = 0;
  private target: LockTarget | null = null;
  private t = 0;
  private textTimer = 0;
  enabled = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'locks', `<div class="lock hidden"><i class="ring"></i><i class="brk"></i><i class="dot"></i><div class="tag"><b></b><span></span><em></em></div></div>`);
    parent.appendChild(this.root);
    this.node = this.root.firstElementChild as HTMLElement;
    [this.ring, this.brk, this.dot] = [...this.node.querySelectorAll<HTMLElement>('i')];
    this.kindEl = this.node.querySelector('b')!;
    this.nameEl = this.node.querySelector('span')!;
    this.distEl = this.node.querySelector('em')!;
  }

  private enter(s: LockState, t: LockTarget | null) {
    const prev = this.state;
    this.state = s;
    this.inState = 0;
    if (s === 'acquiring' && t) {
      this.node.classList.remove('hidden');
      this.node.style.setProperty('--c', KIND_COLOR[t.kind]);
      // brackets slam in from wide and rotated, ring fades up, label decodes
      tween(this.brk).parallel().prop('scale', 2.4, 1, 0.5, 'back', 'out').prop('rotate', 90, 0, 0.5, 'cubic', 'out').prop('opacity', 0, 1, 0.18, 'linear');
      tween(this.ring).prop('opacity', 0, 0.55, 0.4, 'sine', 'out', 0.1);
      scrambleText(this.kindEl, KIND_LABEL[t.kind], 0.45);
      scrambleText(this.nameEl, t.name, 0.6);
    } else if (s === 'locked') {
      tween(this.dot).prop('scale', 2.6, 1, 0.35, 'elastic', 'out');
    } else if (s === 'lost' && prev !== 'idle') {
      tween(this.brk).parallel().prop('scale', 1, 1.6, 0.28, 'quad', 'in').prop('opacity', 1, 0, 0.25, 'quad', 'in');
      tween(this.ring).prop('opacity', 0.55, 0, 0.2);
    } else if (s === 'idle') {
      this.node.classList.add('hidden');
    }
  }

  update(dt: number, camera: Camera, markers: Marker[], checkpoint: { x: number; y?: number; z: number } | null, px: number, pz: number, units: 'mph' | 'kmh') {
    this.t += dt;
    this.inState += dt;
    const t = this.enabled ? pickTarget(markers, checkpoint, px, pz) : null;
    const same = !!t && !!this.target && t.id === this.target.id;
    const next = nextLockState(this.state, !!t, same || this.state === 'idle', this.inState);
    if (next !== this.state || (next === 'acquiring' && !same && t)) this.enter(next, t ?? this.target);
    if (t) this.target = t;
    if (this.state === 'idle' || !this.target) return;
    // project; off-screen and behind-camera targets ride the screen edge
    const W = this.root.clientWidth, H = this.root.clientHeight;
    _v.set(this.target.x, this.target.y + 1.6, this.target.z).project(camera);
    let x = _v.x, y = _v.y;
    const behind = _v.z > 1;
    if (behind) { x = -x; y = -y; }
    const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (off) {
      const k = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.8, 1e-3);
      x /= k; y /= k;
      if (behind) y = Math.min(y, -0.62);
      // keep clear of the street callout (bottom-left) and the cluster (bottom-right)
      if (y < -0.35) x = Math.max(-0.5, Math.min(0.5, x));
      y = Math.max(-0.72, y);
    }
    this.node.classList.toggle('offscreen', off);
    this.node.style.transform = `translate(${(((x + 1) / 2) * W).toFixed(1)}px, ${(((1 - y) / 2) * H).toFixed(1)}px)`;
    this.ring.style.transform = `rotate(${(this.t * (this.state === 'locked' ? 40 : 160)) % 360}deg)`;
    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 0.1;
      const d = Math.hypot(this.target.x - px, this.target.z - pz);
      this.distEl.textContent = units === 'kmh' ? (d < 1000 ? `${Math.round(d)} M` : `${(d / 1000).toFixed(1)} KM`) : d < 305 ? `${Math.round(d * 3.281)} FT` : `${(d / 1609).toFixed(2)} MI`;
    }
  }

  reset() {
    this.state = 'idle';
    this.target = null;
    this.node.classList.add('hidden');
  }
}
