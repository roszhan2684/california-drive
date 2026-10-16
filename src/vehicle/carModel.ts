// Procedural "Vireo S6" — a fictional rear-engine sports coupe built entirely in code.
// No real manufacturer's design, logo, badge or model name is reproduced.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry, SpotLight, TorusGeometry, Vector2,
} from 'three';
import { withFog } from '../render/fog.ts';
import { VIREO_S6 } from '../physics/vehicle/config.ts';
import { addWheelDetail, drilledDisc, flakePaint, setFlake } from './carDetail.ts';

export interface Paint { name: string; color: string; matte?: boolean }

export const PAINTS: Paint[] = [
  { name: 'Sunset Orange', color: '#d8521f' },
  { name: 'Pacific Blue', color: '#1f4f8f' },
  { name: 'Fog Gray', color: '#8f969c' },
  { name: 'Chalk White', color: '#e9e6df' },
  { name: 'Midnight Black', color: '#121315' },
  { name: 'Coastal Green', color: '#2f5a45' },
  { name: 'Signal Yellow', color: '#e3b51c' },
  { name: 'Racing Silver', color: '#b9bcbf' },
  { name: 'Bay Red', color: '#a5161b' },
];

const L = 4.52;
const Z0 = -L / 2;
const GROUND = -0.75;

export type Key = [number, number][];
export function curve(keys: Key, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1][1];
}
export const gauss = (x: number, mu: number, w: number) => Math.exp(-((x - mu) * (x - mu)) / (2 * w * w));

const HALF_W: Key = [[0, 0.62], [0.05, 0.82], [0.12, 0.9], [0.235, 0.93], [0.4, 0.88], [0.55, 0.885], [0.77, 0.97], [0.9, 0.94], [0.97, 0.86], [1, 0.74]];
const TOP: Key = [[0, -0.24], [0.04, -0.12], [0.12, -0.03], [0.25, 0.04], [0.37, 0.09], [0.5, 0.12], [0.62, 0.14], [0.82, 0.17], [0.92, 0.16], [0.955, 0.18], [0.975, 0.14], [1, 0.02]];
const BOTTOM: Key = [[0, -0.42], [0.05, -0.56], [0.15, -0.6], [0.85, -0.6], [0.95, -0.55], [1, -0.4]];

const WHEEL_Y = VIREO_S6.wheels[0].y - (VIREO_S6.suspension.restLength - 0.075);
const WR = VIREO_S6.wheelRadius;

function bodySection(t: number, ringN: number, out: number[]) {
  const z = Z0 + t * L;
  const w = curve(HALF_W, t);
  let top = curve(TOP, t);
  let bottom = curve(BOTTOM, t);
  // wheel arches
  for (const wz of [VIREO_S6.wheels[0].z, VIREO_S6.wheels[2].z]) {
    const dz = z - wz;
    const ar = WR + 0.07;
    if (Math.abs(dz) < ar) bottom = Math.max(bottom, WHEEL_Y + Math.sqrt(ar * ar - dz * dz) + 0.03);
  }
  const fenderF = 0.085 * gauss(t, 0.235, 0.075);
  const fenderR = 0.07 * gauss(t, 0.77, 0.1);
  top = Math.max(top, bottom + 0.06);
  const mid = (top + bottom) / 2, hh = (top - bottom) / 2;
  const n = 4.4;
  for (let k = 0; k < ringN; k++) {
    const a = (k / ringN) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    let y = mid + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (s > 0) {
      const side = Math.pow(Math.min(1, Math.abs(x) / w), 2);
      y += (fenderF + fenderR) * side * Math.min(1, s * 3);
      // gentle hood/deck crown
      y += 0.015 * (1 - side) * s;
    }
    // slight tumble-under at the sills
    if (s < -0.2) x *= 0.97;
    out.push(x, y, z);
  }
}

const CABIN_Z0 = -0.64, CABIN_Z1 = 1.9;
const CABIN_TOP: Key = [[0, 0.1], [0.32, 0.555], [0.38, 0.575], [0.6, 0.57], [0.78, 0.47], [0.92, 0.3], [1, 0.19]];

function cabinSection(u: number, ringN: number, out: number[]) {
  const z = CABIN_Z0 + u * (CABIN_Z1 - CABIN_Z0);
  const t = (z - Z0) / L;
  const base = curve(TOP, t) + 0.035 * 0 - 0.02;
  const top = Math.max(base + 0.02, curve(CABIN_TOP, u));
  const wBase = curve(HALF_W, t) * (0.86 - 0.06 * Math.pow(u, 2));
  const wTop = wBase * 0.74;
  const n = 4;
  for (let k = 0; k < ringN; k++) {
    // upper half ring only (from right sill over the roof to left sill)
    const a = (k / (ringN - 1)) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const yy = base + (top - base) * Math.pow(s, 2 / n);
    const f = (yy - base) / Math.max(0.001, top - base);
    const w = wBase + (wTop - wBase) * f;
    const x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    out.push(x, yy, z);
  }
}

export function loftGeometry(sections: number[][], ringN: number, closedRing: boolean, capEnds: boolean): BufferGeometry {
  const pos: number[] = [];
  for (const s of sections) pos.push(...s);
  const idx: number[] = [];
  const S = sections.length;
  const segs = closedRing ? ringN : ringN - 1;
  for (let i = 0; i < S - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % ringN;
      const a = i * ringN + k, b = i * ringN + k2, c = (i + 1) * ringN + k2, d = (i + 1) * ringN + k;
      idx.push(a, b, d, b, c, d);
    }
  }
  if (capEnds) {
    for (const [i, flip] of [[0, true], [S - 1, false]] as const) {
      const cx = sections[i].filter((_, j) => j % 3 === 0).reduce((p, v) => p + v, 0) / ringN;
      const cy = sections[i].filter((_, j) => j % 3 === 1).reduce((p, v) => p + v, 0) / ringN;
      const cz = sections[i][2];
      const ci = pos.length / 3;
      pos.push(cx, cy, cz);
      for (let k = 0; k < ringN; k++) {
        const a = i * ringN + k, b = i * ringN + ((k + 1) % ringN);
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Split a lofted geometry into N non-indexed geometries, classifying per quad (6 indices) so edges follow the grid. */
export function splitQuadsN(g: BufferGeometry, n: number, classify: (x: number, y: number, z: number) => number): BufferGeometry[] {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.getIndex()!;
  const P: number[][] = Array.from({ length: n }, () => []), N: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < idx.count; i += 6) {
    const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2), idx.getX(i + 3), idx.getX(i + 4), idx.getX(i + 5)];
    const uniq = [...new Set(ids)];
    let cx = 0, cy = 0, cz = 0;
    for (const v of uniq) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); }
    const c = Math.max(0, Math.min(n - 1, classify(cx / uniq.length, cy / uniq.length, cz / uniq.length)));
    for (const v of ids) { P[c].push(pos.getX(v), pos.getY(v), pos.getZ(v)); N[c].push(nrm.getX(v), nrm.getY(v), nrm.getZ(v)); }
  }
  return P.map((p, i) => {
    const r = new BufferGeometry();
    r.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    r.setAttribute('normal', new BufferAttribute(new Float32Array(N[i]), 3));
    return r;
  });
}

/** Split a lofted geometry into two non-indexed geometries, deciding per quad (6 indices) so edges follow the grid. */
export function splitQuads(g: BufferGeometry, pred: (x: number, y: number, z: number) => boolean): [BufferGeometry, BufferGeometry] {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.getIndex()!;
  const A: number[] = [], AN: number[] = [], B: number[] = [], BN: number[] = [];
  for (let i = 0; i < idx.count; i += 6) {
    const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2), idx.getX(i + 3), idx.getX(i + 4), idx.getX(i + 5)];
    const uniq = [...new Set(ids)];
    let cx = 0, cy = 0, cz = 0;
    for (const v of uniq) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); }
    const into = pred(cx / uniq.length, cy / uniq.length, cz / uniq.length);
    for (const v of ids) {
      (into ? A : B).push(pos.getX(v), pos.getY(v), pos.getZ(v));
      (into ? AN : BN).push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    }
  }
  const mk = (p: number[], n: number[]) => {
    const r = new BufferGeometry();
    r.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    r.setAttribute('normal', new BufferAttribute(new Float32Array(n), 3));
    return r;
  };
  return [mk(A, AN), mk(B, BN)];
}

export function flipped(g: BufferGeometry): BufferGeometry {
  const r = g.clone();
  const p = r.getAttribute('position');
  const n = r.getAttribute('normal');
  for (let i = 0; i < p.count; i += 3) {
    for (const attr of [p, n]) {
      const x = attr.getX(i + 1), y = attr.getY(i + 1), z = attr.getZ(i + 1);
      attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
      attr.setXYZ(i + 2, x, y, z);
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return r;
}

export interface WheelRig {
  pivot: Object3D;
  spin: Object3D;
  disc: Mesh;
  /** Speed blur disc over the spokes (opacity driven by wheel speed). */
  blur?: Mesh;
}

export interface CarRig {
  root: Group;
  body: Group;
  paint: MeshPhysicalMaterial;
  wheels: WheelRig[];
  steeringWheel: Object3D;
  headlightMat: MeshStandardMaterial;
  tailMat: MeshStandardMaterial;
  brakeMat: MeshStandardMaterial;
  indicatorL: MeshStandardMaterial;
  indicatorR: MeshStandardMaterial;
  reverseMat: MeshStandardMaterial;
  discMat: MeshStandardMaterial;
  dashMat: MeshBasicMaterial;
  gauge: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture };
  spotL: SpotLight;
  spotR: SpotLight;
  wipers: Object3D[];
  interior: Group;
  exhaust: Object3D[];
  /** Camera mount points in car-local space. */
  mounts: CameraMounts;
  /** Manufacturer badges (only on branded models). */
  badges?: Object3D;
  setBadges?(on: boolean): void;
  /** Daytime running lights (on whenever the engine runs). */
  drl?: MeshStandardMaterial;
  setPaint(hex: string, matte?: boolean): void;
  dispose(): void;
}

export type MountName = 'bumper' | 'hood' | 'cockpit' | 'dashboard' | 'wheel';
export type CameraMounts = Record<MountName, [number, number, number]>;

export const VIREO_MOUNTS: CameraMounts = {
  bumper: [0, -0.32, -2.32], hood: [0, 0.32, -0.75], cockpit: [-0.36, 0.38, 0.22], dashboard: [-0.36, 0.35, 0.12], wheel: [-1.14, -0.32, 0.25],
};

/** Apply a paint (metallic/clearcoat or matte) to a car paint material. */
export function applyPaint(m: MeshPhysicalMaterial, hex: string, matte = false) {
  m.color.set(hex);
  m.roughness = matte ? 0.62 : 0.4;
  m.clearcoat = matte ? 0.15 : 0.8;
  m.clearcoatRoughness = matte ? 0.55 : 0.08;
  m.metalness = matte ? 0.35 : 0.2;
  setFlake(m, !matte);
}

export function buildCar(paintHex = PAINTS[0].color): CarRig {
  const root = new Group();
  root.name = 'Vireo S6';
  const body = new Group();
  root.add(body);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const paint = track(flakePaint(new MeshPhysicalMaterial({ color: new Color(paintHex), metalness: 0.2, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 0.55 }), 'carpaint'));
  const trim = track(withFog(new MeshStandardMaterial({ color: 0x111214, roughness: 0.55, metalness: 0.2 }), undefined, 'cartrim'));
  const glass = track(withFog(new MeshPhysicalMaterial({ color: 0x0b0e12, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.72, clearcoat: 1, clearcoatRoughness: 0.02 }), undefined, 'carglass'));
  const liner = track(withFog(new MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.9, side: DoubleSide }), undefined, 'carliner'));
  const leather = track(withFog(new MeshStandardMaterial({ color: 0x2a211d, roughness: 0.7 }), undefined, 'carleather'));
  const chrome = track(withFog(new MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.15, metalness: 1 }), undefined, 'carchrome'));
  const tireMat = track(withFog(new MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }), undefined, 'cartire'));
  const rimMat = track(withFog(new MeshStandardMaterial({ color: 0x9da1a5, roughness: 0.28, metalness: 0.95 }), undefined, 'carrim'));
  const discMat = track(withFog(new MeshStandardMaterial({ color: 0x55585b, roughness: 0.4, metalness: 0.9, emissive: new Color(1, 0.25, 0.02), emissiveIntensity: 0 }), undefined, 'cardisc'));
  drilledDisc(discMat);
  const caliperMat = track(withFog(new MeshStandardMaterial({ color: 0xb8860b, roughness: 0.4, metalness: 0.3 }), undefined, 'carcaliper'));
  const lightMat = (color: number, emissive: number) => track(new MeshStandardMaterial({ color, emissive: new Color(emissive), emissiveIntensity: 0, roughness: 0.2, metalness: 0.1 }));
  const headlightMat = lightMat(0xdfe6ee, 0xeaf2ff);
  const tailMat = lightMat(0x8a0d0d, 0xff1a10);
  const brakeMat = lightMat(0x8a0d0d, 0xff2010);
  const indicatorL = lightMat(0x3a2205, 0xff8a00);
  const indicatorR = lightMat(0x3a2205, 0xff8a00);
  const reverseMat = lightMat(0x202020, 0xffffff);

  // ---- body shell
  const RING = 30, SECT = 96;
  const sections: number[][] = [];
  for (let i = 0; i < SECT; i++) { const s: number[] = []; bodySection(i / (SECT - 1), RING, s); sections.push(s); }
  const bodyGeo = track(loftGeometry(sections, RING, true, true));
  const shell = new Mesh(bodyGeo, paint);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // ---- greenhouse: glass + painted pillars/roof + interior liner
  const CR = 26, CS = 48;
  const csec: number[][] = [];
  for (let i = 0; i < CS; i++) { const s: number[] = []; cabinSection(i / (CS - 1), CR, s); csec.push(s); }
  const cabGeo = loftGeometry(csec, CR, false, false);
  const isPaint = (x: number, y: number, z: number) => {
    const u = (z - CABIN_Z0) / (CABIN_Z1 - CABIN_Z0);
    const t = (z - Z0) / L;
    const base = curve(TOP, t);
    const top = curve(CABIN_TOP, u);
    const rel = (y - base) / Math.max(0.01, top - base);
    const wb = curve(HALF_W, t) * 0.86;
    const side = Math.abs(x) / (wb * (1 - 0.26 * rel));
    if (rel < 0.12) return true; // window frame / sill
    if (u > 0.3 && u < 0.7 && rel > 0.78) return true; // roof panel
    if (u < 0.33 && side > 0.95) return true; // A pillars
    if (u > 0.7 && side > 0.72) return true; // C pillars / rear quarter
    if (u > 0.5 && u < 0.56 && side > 0.75) return true; // B pillar
    return false;
  };
  const [cabPaintGeo, cabGlassGeo] = splitQuads(cabGeo, isPaint);
  cabGeo.dispose();
  track(cabPaintGeo); track(cabGlassGeo);
  const cabPaint = new Mesh(cabPaintGeo, paint);
  cabPaint.castShadow = true;
  body.add(cabPaint);
  const cabGlass = new Mesh(cabGlassGeo, glass);
  cabGlass.castShadow = true;
  cabGlass.renderOrder = 2;
  body.add(cabGlass);
  const linerGeo = track(flipped(cabPaintGeo));
  const interior = new Group();
  interior.add(new Mesh(linerGeo, liner));
  body.add(interior);

  // ---- details
  const add = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: Object3D = body) => {
    track(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };
  // headlights: slim LED strips following the nose
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(0.34, 0.05, 0.16), headlightMat, sx * 0.6, -0.09, -2.02, -0.35, sx * -0.28, 0);
    add(new SphereGeometry(0.055, 12, 8), headlightMat, sx * 0.66, -0.13, -2.0);
    add(new BoxGeometry(0.12, 0.03, 0.05), sx < 0 ? indicatorL : indicatorR, sx * 0.74, -0.2, -1.98);
    // front intakes
    add(new BoxGeometry(0.42, 0.12, 0.1), trim, sx * 0.48, -0.36, -2.16);
    // side intake (rear engine)
    add(new BoxGeometry(0.06, 0.12, 0.42), trim, sx * 0.93, 0.0, 0.72, 0, 0, 0);
    // mirrors
    add(new BoxGeometry(0.06, 0.04, 0.04), trim, sx * 0.86, 0.14, -0.42);
    add(new SphereGeometry(0.075, 12, 8).scale(1.4, 0.75, 0.9), paint as MeshPhysicalMaterial, sx * 0.97, 0.17, -0.42);
    // door handle
    add(new BoxGeometry(0.02, 0.025, 0.14), chrome, sx * 0.885, 0.04, 0.15);
    // exhaust tips
  }
  add(new BoxGeometry(1.0, 0.1, 0.1), trim, 0, -0.38, -2.18);
  // full-width tail light bar + brake + reverse
  add(new BoxGeometry(1.62, 0.045, 0.04), tailMat, 0, 0.055, 2.215);
  add(new BoxGeometry(0.34, 0.03, 0.03), brakeMat, 0, 0.19, 2.12);
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(0.2, 0.06, 0.04), brakeMat, sx * 0.72, 0.03, 2.2);
    add(new BoxGeometry(0.1, 0.035, 0.03), reverseMat, sx * 0.42, -0.3, 2.24);
    add(new BoxGeometry(0.1, 0.03, 0.03), sx < 0 ? indicatorL : indicatorR, sx * 0.86, 0.03, 2.17);
  }
  // diffuser + plate recess
  add(new BoxGeometry(1.3, 0.12, 0.25), trim, 0, -0.5, 2.1);
  add(new BoxGeometry(0.52, 0.12, 0.02), trim, 0, -0.18, 2.255);
  const exhaust: Object3D[] = [];
  for (const sx of [-1, 1]) {
    const e = add(new CylinderGeometry(0.045, 0.05, 0.14, 14), chrome, sx * 0.17, -0.44, 2.24, Math.PI / 2, 0, 0);
    exhaust.push(e);
  }
  // ducktail lip
  add(new BoxGeometry(1.3, 0.025, 0.14), trim, 0, 0.205, 2.0, 0.12, 0, 0);

  // ---- interior
  const dash = add(new BoxGeometry(1.46, 0.14, 0.42), leather, 0, 0.1, -0.5);
  dash.castShadow = false;
  add(new BoxGeometry(0.42, 0.11, 0.12), trim, -0.36, 0.19, -0.5, -0.25, 0, 0, interior);
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(0.46, 0.12, 0.5), leather, sx * 0.36, -0.36, 0.25, 0, 0, 0, interior);
    add(new BoxGeometry(0.46, 0.62, 0.12), leather, sx * 0.36, -0.06, 0.52, -0.22, 0, 0, interior);
    add(new BoxGeometry(0.05, 0.38, 1.25), leather, sx * 0.82, -0.18, 0.05, 0, 0, 0, interior);
  }
  add(new BoxGeometry(0.22, 0.2, 0.9), trim, 0, -0.35, 0.0, 0, 0, 0, interior);
  // gauge cluster with live canvas
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gaugeTex = track(new CanvasTexture(canvas));
  const dashMat = track(new MeshBasicMaterial({ map: gaugeTex, toneMapped: false }));
  add(new PlaneGeometry(0.34, 0.12), dashMat, -0.36, 0.2, -0.435, -0.3, 0, 0, interior);
  // steering wheel
  const steeringWheel = new Group();
  steeringWheel.position.set(-0.36, 0.0, -0.27);
  steeringWheel.rotation.x = -0.32;
  interior.add(steeringWheel);
  add(new TorusGeometry(0.17, 0.02, 10, 32), leather, 0, 0, 0, 0, 0, 0, steeringWheel);
  add(new BoxGeometry(0.3, 0.035, 0.02), trim, 0, -0.02, 0, 0, 0, 0, steeringWheel);
  add(new BoxGeometry(0.035, 0.15, 0.02), trim, 0, -0.08, 0, 0, 0, 0, steeringWheel);
  add(new CylinderGeometry(0.03, 0.03, 0.25, 10), trim, 0, 0, -0.13, Math.PI / 2, 0, 0, steeringWheel);
  // wipers
  const wipers: Object3D[] = [];
  for (const wx of [-0.42, 0.12]) {
    const pivot = new Group();
    pivot.position.set(wx, 0.105, -0.6);
    pivot.rotation.x = -0.55;
    body.add(pivot);
    add(new BoxGeometry(0.5, 0.012, 0.02), trim, 0.25, 0, 0, 0, 0, 0, pivot);
    wipers.push(pivot);
  }

  // ---- wheels
  const wheels: WheelRig[] = [];
  for (const wd of VIREO_S6.wheels) {
    const pivot = new Group();
    pivot.position.set(wd.x, WHEEL_Y, wd.z);
    root.add(pivot);
    const spin = new Group();
    pivot.add(spin);
    const width = wd.front ? 0.25 : 0.29;
    const pts: Vector2[] = [];
    const ri = 0.235, ro = WR;
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      const sh = Math.sin(a);
      pts.push(new Vector2(ri + (ro - ri) * Math.pow(sh, 0.35), -width / 2 + (width * i) / 12));
    }
    const tire = add(new LatheGeometry(pts, 28), tireMat, 0, 0, 0, 0, 0, Math.PI / 2, spin);
    tire.castShadow = true;
    const outer = wd.left ? -1 : 1;
    // rim face + barrel
    add(new CylinderGeometry(0.235, 0.235, width * 0.9, 24, 1, true), rimMat, 0, 0, 0, 0, 0, Math.PI / 2, spin);
    add(new CylinderGeometry(0.06, 0.06, 0.05, 12), rimMat, outer * (width / 2 - 0.01), 0, 0, 0, 0, Math.PI / 2, spin);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const sp = add(new BoxGeometry(0.03, 0.2, 0.05), rimMat, outer * (width / 2 - 0.03), Math.cos(a) * 0.11, Math.sin(a) * 0.11, a, 0, 0, spin);
      sp.castShadow = false;
    }
    const disc = add(new CylinderGeometry(0.17, 0.17, 0.03, 24), discMat, outer * 0.02, 0, 0, 0, 0, Math.PI / 2, spin) as Mesh;
    add(new BoxGeometry(0.06, 0.12, 0.16), caliperMat, outer * 0.035, 0.11, wd.front ? 0.06 : -0.06, 0, 0, 0, pivot);
    const blur = addWheelDetail(spin, pivot, { ri, ro, width, outer, bright: 2.6 }, track);
    wheels.push({ pivot, spin, disc, blur });
  }

  // ---- headlight spot lights
  const mkSpot = (sx: number) => {
    const s = new SpotLight(0xf3f6ff, 0, 90, 0.45, 0.55, 1.4);
    s.position.set(sx * 0.62, -0.1, -2.05);
    s.target.position.set(sx * 1.2, -0.75, -22);
    root.add(s);
    root.add(s.target);
    return s;
  };
  const spotL = mkSpot(-1);
  const spotR = mkSpot(1);

  root.traverse((o) => {
    if ((o as Mesh).isMesh && !(o as Mesh).castShadow && o.parent === body) (o as Mesh).castShadow = false;
  });

  return {
    root, body, paint, wheels, steeringWheel, headlightMat, tailMat, brakeMat, indicatorL, indicatorR, reverseMat, discMat, dashMat,
    gauge: { canvas, ctx, tex: gaugeTex }, spotL, spotR, wipers, interior, exhaust, mounts: VIREO_MOUNTS,
    setPaint(hex: string, matte = false) { applyPaint(paint, hex, matte); },
    dispose() { for (const d of disposables) d.dispose(); spotL.dispose(); spotR.dispose(); },
  };
}

export const CAR_GROUND_OFFSET = GROUND;
