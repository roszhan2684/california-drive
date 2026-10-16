// Crash debris: Kenney "Car Kit" debris parts (CC0) thrown from hard impacts. Visual only: a tiny rigid-body
// integrator against the heightfield (bounce, friction, settle), then the parts shrink away.
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3, type Material, type Scene } from 'three';
import { bakeProp, disposeScene, loadKenneyScene } from '../vehicle/kenneyFleet.ts';

interface PieceDef { file: string; tint: boolean; minStrength: number; weight: number }

/** Body panels take the player's paint; nuts, bolts and tyres keep their own colours. */
const PIECES: PieceDef[] = [
  { file: 'debris-bolt', tint: false, minStrength: 0.15, weight: 3 },
  { file: 'debris-nut', tint: false, minStrength: 0.15, weight: 3 },
  { file: 'debris-plate-small-a', tint: true, minStrength: 0.25, weight: 2 },
  { file: 'debris-plate-a', tint: true, minStrength: 0.45, weight: 1 },
  { file: 'debris-spoiler-a', tint: true, minStrength: 0.55, weight: 0.6 },
  { file: 'debris-bumper', tint: true, minStrength: 0.6, weight: 0.8 },
  { file: 'debris-door', tint: true, minStrength: 0.85, weight: 0.3 },
  { file: 'debris-tire', tint: false, minStrength: 0.8, weight: 0.4 },
];
/** Kenney cars are ~1.5 m wide; ours are ~1.9 m. */
const SCALE = 1.25;
const CAP = 10;
const LIFE = 14;

interface Live { kind: number; slot: number; p: Vector3; v: Vector3; q: Quaternion; w: Vector3; r: number; age: number; resting: boolean }

const _m = new Matrix4();
const _dq = new Quaternion();
const _s = new Vector3();
const _axis = new Vector3();

export class CrashDebris {
  private meshes: InstancedMesh[] = [];
  private radii: number[] = [];
  private live: Live[] = [];
  private paint = new Color(1, 1, 1);
  private white = new Color(1, 1, 1);
  private ready = false;
  private disposed = false;

  private scene: Scene;
  private material: Material;

  constructor(scene: Scene, material: Material) {
    this.scene = scene;
    this.material = material;
    void this.load();
  }

  private async load() {
    try {
      const baked = await Promise.all(PIECES.map(async (p) => {
        const { root, pal } = await loadKenneyScene(p.file);
        const b = bakeProp(root, pal, SCALE, p.tint);
        disposeScene(root);
        return b;
      }));
      if (this.disposed) { for (const b of baked) b.geometry.dispose(); return; }
      baked.forEach((b) => {
        const m = new InstancedMesh(b.geometry, this.material, CAP);
        m.castShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        m.visible = false;
        this.scene.add(m);
        this.meshes.push(m);
        this.radii.push(b.radius);
      });
      this.ready = true;
    } catch (e) {
      console.warn('crash debris unavailable', e);
    }
  }

  setPaint(hex: string) {
    this.paint.set(hex);
  }

  /** Throw parts from an impact point. `strength` is 0..1, `away` points from the car toward the hit. */
  spawn(strength: number, at: Vector3, away: Vector3, carVel: Vector3) {
    if (!this.ready || strength < 0.15) return;
    const n = Math.min(6, 1 + Math.floor(strength * 5));
    const choices = PIECES.map((p, i) => ({ i, w: strength >= p.minStrength ? p.weight : 0 }));
    const total = choices.reduce((s, c) => s + c.w, 0);
    for (let k = 0; k < n; k++) {
      let x = Math.random() * total, kind = 0;
      for (const c of choices) { x -= c.w; if (x < 0) { kind = c.i; break; } }
      const used = this.live.filter((l) => l.kind === kind);
      if (used.length >= CAP) this.live.splice(this.live.indexOf(used[0]), 1);
      const slot = [...Array(CAP).keys()].find((s) => !this.live.some((l) => l.kind === kind && l.slot === s)) ?? 0;
      const sp = 3 + strength * 7;
      const v = new Vector3(away.x * sp + (Math.random() - 0.5) * 4, 2 + Math.random() * 3 + strength * 3, away.z * sp + (Math.random() - 0.5) * 4).addScaledVector(carVel, 0.6);
      this.live.push({
        kind, slot, p: at.clone().add(new Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6)), v,
        q: new Quaternion().setFromAxisAngle(_axis.set(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6),
        w: new Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
        r: this.radii[kind] * 0.35, age: 0, resting: false,
      });
    }
  }

  update(dt: number, groundY: (x: number, z: number) => number) {
    if (!this.ready) return;
    // fixed 1/60 s sub-steps so the motion is frame-rate independent (stalls over 0.25 s are dropped)
    const steps = Math.min(15, Math.ceil(Math.min(dt, 0.25) * 60));
    const h = Math.min(dt, 0.25) / Math.max(1, steps);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.age += dt;
      if (l.age > LIFE) { this.live.splice(i, 1); continue; }
      for (let k = 0; k < steps && !l.resting; k++) this.integrate(l, h, groundY);
    }
    const counts = this.meshes.map(() => 0);
    for (const l of this.live) {
      const m = this.meshes[l.kind];
      const fade = l.age > LIFE - 1.5 ? Math.max(0.001, (LIFE - l.age) / 1.5) : 1;
      _m.compose(l.p, l.q, _s.setScalar(fade));
      const i = counts[l.kind]++;
      m.setMatrixAt(i, _m);
      m.setColorAt(i, PIECES[l.kind].tint ? this.paint : this.white);
    }
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.visible = m.count > 0;
      if (!m.visible) return;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  private integrate(l: Live, h: number, groundY: (x: number, z: number) => number) {
    l.v.y -= 9.81 * h;
    l.v.multiplyScalar(1 - 0.15 * h);
    l.p.addScaledVector(l.v, h);
    const wl = l.w.length();
    if (wl > 1e-3) l.q.premultiply(_dq.setFromAxisAngle(_axis.copy(l.w).divideScalar(wl), wl * h));
    const gy = groundY(l.p.x, l.p.z) + l.r;
    if (l.p.y >= gy) return;
    l.p.y = gy;
    if (l.v.y < 0) l.v.y = -l.v.y * 0.32;
    l.v.x *= 0.72;
    l.v.z *= 0.72;
    l.w.multiplyScalar(0.6);
    if (Math.abs(l.v.y) < 0.6 && Math.hypot(l.v.x, l.v.z) < 0.4) {
      l.resting = true;
      // settle flat-ish: keep the yaw, drop most of the tilt
      const e = new Vector3(0, 1, 0).applyQuaternion(l.q);
      if (Math.abs(e.y) < 0.6) l.q.premultiply(_dq.setFromUnitVectors(e, new Vector3(0, Math.sign(e.y) || 1, 0)));
    }
  }

  clear() {
    this.live = [];
  }

  dispose() {
    this.disposed = true;
    for (const m of this.meshes) { m.removeFromParent(); m.geometry.dispose(); m.dispose(); }
    this.meshes = [];
  }
}
