// Procedural low-poly traffic vehicles (generic shapes, no real makes/models).
import { BufferAttribute, BufferGeometry, CylinderGeometry, BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fleetVariants } from './kenneyFleet.ts';

export interface TrafficVariant {
  name: string;
  length: number;
  width: number;
  height: number;
  body: BufferGeometry;
  /** Body without wheels (moving traffic renders spinning wheels separately). */
  bare: BufferGeometry;
  lights: BufferGeometry;
  /** One right-side indicator set (front + rear amber); mirror on X for the left side. */
  indicators: BufferGeometry;
  /** Wheel centred on its hub, rim facing +X. */
  wheel: BufferGeometry;
  /** Wheel hub positions [x, y, z] x4: FL, FR, RL, RR. */
  wheelPos: number[];
  wheelR: number;
  /** Relative spawn weight (default 1). */
  weight?: number;
  /** Body takes the per-instance paint colour (default true); liveried vehicles keep their colours. */
  tint?: boolean;
  /** Emergency vehicles carry a two-sided lightbar (left / right halves flash alternately). */
  emergency?: 'police' | 'ambulance' | 'fire';
  beaconL?: BufferGeometry;
  beaconR?: BufferGeometry;
}

interface Spec { name: string; L: number; W: number; bottom: number; belt: number; roof: number; cab0: number; cab1: number; hood: number; tail: number; wheelR: number; wb: number }

const SPECS: Spec[] = [
  { name: 'sedan', L: 4.75, W: 1.84, bottom: 0.28, belt: 0.98, roof: 1.46, cab0: 0.36, cab1: 0.76, hood: 0.86, tail: 0.92, wheelR: 0.33, wb: 2.8 },
  { name: 'suv', L: 4.85, W: 1.94, bottom: 0.4, belt: 1.12, roof: 1.78, cab0: 0.3, cab1: 0.93, hood: 1.04, tail: 1.08, wheelR: 0.38, wb: 2.85 },
  { name: 'hatch', L: 4.1, W: 1.76, bottom: 0.25, belt: 0.95, roof: 1.5, cab0: 0.34, cab1: 0.94, hood: 0.84, tail: 0.98, wheelR: 0.31, wb: 2.55 },
  { name: 'van', L: 5.3, W: 2.0, bottom: 0.4, belt: 1.2, roof: 2.25, cab0: 0.16, cab1: 0.98, hood: 1.05, tail: 1.2, wheelR: 0.36, wb: 3.3 },
];

function colorize(g: BufferGeometry, r: number, gg: number, b: number) {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function loftBox(sections: { z: number; w: number; y0: number; y1: number }[], ring = 12, n = 3.4): BufferGeometry {
  const pos: number[] = [];
  for (const s of sections) {
    const mid = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), mid + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n), s.z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < ring; k++) {
    const k2 = (k + 1) % ring;
    const a = i * ring + k, b = i * ring + k2, c = (i + 1) * ring + k2, d = (i + 1) * ring + k;
    idx.push(a, b, d, b, c, d);
  }
  // caps
  for (const [i, flip] of [[0, true], [sections.length - 1, false]] as const) {
    const ci = pos.length / 3;
    const s = sections[i];
    pos.push(0, (s.y0 + s.y1) / 2, s.z);
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k, b = i * ring + ((k + 1) % ring);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function build(s: Spec): TrafficVariant {
  const hz = s.L / 2;
  const hw = s.W / 2;
  const body = loftBox([
    { z: -hz, w: hw * 0.86, y0: s.bottom + 0.05, y1: s.hood - 0.12 },
    { z: -hz + 0.18, w: hw * 0.97, y0: s.bottom, y1: s.hood - 0.02 },
    { z: -hz + s.L * 0.25, w: hw, y0: s.bottom, y1: s.hood },
    { z: -hz + s.L * s.cab0, w: hw, y0: s.bottom, y1: s.belt },
    { z: -hz + s.L * s.cab1, w: hw, y0: s.bottom, y1: s.belt },
    { z: hz - 0.2, w: hw * 0.98, y0: s.bottom, y1: s.tail },
    { z: hz, w: hw * 0.9, y0: s.bottom + 0.06, y1: s.tail - 0.1 },
  ]);
  colorize(body, 1, 1, 1);
  const c0 = -hz + s.L * s.cab0, c1 = -hz + s.L * s.cab1;
  const cabLen = c1 - c0;
  const cab = loftBox([
    { z: c0, w: hw * 0.86, y0: s.belt - 0.05, y1: s.belt + 0.02 },
    { z: c0 + cabLen * 0.22, w: hw * 0.82, y0: s.belt - 0.05, y1: s.roof },
    { z: c1 - cabLen * 0.16, w: hw * 0.82, y0: s.belt - 0.05, y1: s.roof },
    { z: c1, w: hw * 0.86, y0: s.belt - 0.05, y1: s.belt + 0.05 },
  ], 10, 4);
  colorize(cab, 0.05, 0.06, 0.07);
  const roofCap = new BoxGeometry(s.W * 0.7, 0.04, cabLen * 0.55).translate(0, s.roof + 0.005, (c0 + c1) / 2 + cabLen * 0.03).toNonIndexed();
  colorize(roofCap, 1, 1, 1);
  const parts: BufferGeometry[] = [body, cab, roofCap];
  for (const z of [-hz - 0.01, hz + 0.01]) {
    const bump = new BoxGeometry(s.W * 0.92, 0.16, 0.08).translate(0, s.bottom + 0.1, z).toNonIndexed();
    colorize(bump, 0.12, 0.12, 0.13);
    parts.push(bump);
  }
  const bare = mergeGeometries(parts, false)!;
  const wheelPos: number[] = [];
  const wheels: BufferGeometry[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    wheelPos.push(x * (hw - 0.12), s.wheelR, z * s.wb / 2);
    const w = new CylinderGeometry(s.wheelR, s.wheelR, 0.24, 10).rotateZ(Math.PI / 2).translate(x * (hw - 0.12), s.wheelR, z * s.wb / 2).toNonIndexed();
    colorize(w, 0.03, 0.03, 0.03);
    wheels.push(w);
  }
  const merged = mergeGeometries([...parts, ...wheels], false)!;
  for (const p of [...parts, ...wheels]) p.dispose();
  // lights: head (white, front) and tail (red, rear)
  const lp: BufferGeometry[] = [];
  for (const x of [-1, 1]) {
    const h = new BoxGeometry(0.34, 0.1, 0.04).translate(x * (hw - 0.3), s.hood - 0.16, -hz - 0.005).toNonIndexed();
    colorize(h, 1, 0.95, 0.85);
    const t = new BoxGeometry(0.34, 0.1, 0.04).translate(x * (hw - 0.28), s.tail - 0.14, hz + 0.005).toNonIndexed();
    colorize(t, 1, 0.05, 0.03);
    lp.push(h, t);
  }
  const lights = mergeGeometries(lp, false)!;
  for (const p of lp) p.dispose();
  const ip = [
    new BoxGeometry(0.14, 0.08, 0.05).translate(hw - 0.08, s.hood - 0.16, -hz - 0.01).toNonIndexed(),
    new BoxGeometry(0.12, 0.08, 0.05).translate(hw - 0.08, s.tail - 0.14, hz + 0.01).toNonIndexed(),
    new BoxGeometry(0.03, 0.05, 0.12).translate(hw + 0.01, s.hood - 0.1, -hz + 0.9).toNonIndexed(),
  ];
  for (const g of ip) colorize(g, 1, 0.5, 0.04);
  const indicators = mergeGeometries(ip, false)!;
  for (const p of ip) p.dispose();
  return { name: s.name, length: s.L, width: s.W, height: s.roof, body: merged, bare, lights, indicators, wheel: wheelGeometry(s.wheelR), wheelPos, wheelR: s.wheelR };
}

/** Tyre + five-spoke rim; spokes make the rotation readable. */
function wheelGeometry(r: number): BufferGeometry {
  const tyre = new CylinderGeometry(r, r, 0.24, 14).rotateZ(Math.PI / 2).toNonIndexed();
  colorize(tyre, 0.035, 0.035, 0.035);
  const parts: BufferGeometry[] = [tyre];
  const rim = new CylinderGeometry(r * 0.66, r * 0.66, 0.02, 14).rotateZ(Math.PI / 2).translate(0.115, 0, 0).toNonIndexed();
  colorize(rim, 0.16, 0.16, 0.17);
  parts.push(rim);
  for (let k = 0; k < 5; k++) {
    const sp = new BoxGeometry(0.03, r * 0.6, 0.07).translate(0.13, r * 0.3, 0).rotateX((k / 5) * Math.PI * 2).toNonIndexed();
    colorize(sp, 0.62, 0.63, 0.65);
    parts.push(sp);
  }
  const hub = new CylinderGeometry(r * 0.14, r * 0.14, 0.03, 8).rotateZ(Math.PI / 2).translate(0.135, 0, 0).toNonIndexed();
  colorize(hub, 0.5, 0.5, 0.52);
  parts.push(hub);
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

let cache: TrafficVariant[] | null = null;
/** The four procedural shapes (always available, also in workers and tests). */
export function proceduralVariants(): TrafficVariant[] {
  if (!cache) cache = SPECS.map(build);
  return cache;
}

/** Moving traffic: procedural shapes plus the Kenney fleet once it has loaded. */
export function trafficVariants(): TrafficVariant[] {
  const f = fleetVariants();
  return f.length ? [...proceduralVariants(), ...f] : proceduralVariants();
}

/** Map a parked car's hashed slot value (0..99) to a `parkedVariants()` index: ~64% procedural shapes. */
export function parkedVariantIndex(raw: number, n: number): number {
  const p = SPECS.length;
  return n <= p || raw < 64 ? raw % p : p + (raw % (n - p));
}

/** Parked cars: civilian vehicles only (no emergency or refuse trucks at the kerb). */
export function parkedVariants(): TrafficVariant[] {
  const f = fleetVariants().filter((v) => v.spec.parked);
  return f.length ? [...proceduralVariants(), ...f] : proceduralVariants();
}

export const TRAFFIC_COLORS = ['#e8e6e1', '#1d1f22', '#8a9096', '#b5b9bd', '#2c4a7a', '#7a1f1f', '#3e5a4a', '#c9b48a', '#f0c419', '#5b5f63', '#a33a1a', '#d9d5c9'];

/** Some emergency vehicles are "responding": lightbar flashing (and siren audible). Stable per agent id. */
export function isResponding(id: number, kind: TrafficVariant['emergency']): boolean {
  if (!kind) return false;
  return kind === 'police' ? id % 4 === 0 : id % 2 === 0;
}
