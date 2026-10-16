// Kenney "Car Kit" (CC0, https://kenney.nl/assets/car-kit) baked into the game's instanced traffic format.
// Each GLB is rotated to face -Z, stretched to real-world dimensions, and its palette texture is baked into
// vertex colours so the models share the procedural traffic material (one draw call per variant).
// Window glass is darkened, the body paint becomes white so instance colours can tint it, and the
// headlight / taillight / lightbar faces are lifted into separate emissive geometries.
import { BufferAttribute, BufferGeometry, Box3, BoxGeometry, ImageLoader, Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Biome } from '../world/cities.ts';
import type { TrafficVariant } from './trafficModels.ts';

export interface FleetSpec {
  file: string;
  name: string;
  /** Real-world length, width and height (m). */
  L: number; W: number; H: number;
  /** Relative spawn weight; the procedural sedan/SUV/hatch/van are 1 each. */
  weight: number;
  /** Body paint takes the per-instance traffic colour (otherwise livery colours are kept). */
  tint: boolean;
  emergency?: 'police' | 'ambulance' | 'fire';
  /** Roof sign that glows with the lights at night. */
  roofSign?: boolean;
  /** Also used for parked cars. */
  parked?: boolean;
  /** Not spawned in these biomes. */
  notIn?: Biome[];
}

export const FLEET: FleetSpec[] = [
  { file: 'sedan-sports', name: 'sport coupe', L: 4.6, W: 1.9, H: 1.32, weight: 0.4, tint: true, parked: true },
  { file: 'hatchback-sports', name: 'hot hatch', L: 4.3, W: 1.82, H: 1.45, weight: 0.35, tint: true, parked: true },
  { file: 'suv-luxury', name: 'luxury SUV', L: 5.0, W: 2.0, H: 1.8, weight: 0.45, tint: true, parked: true },
  { file: 'truck', name: 'pickup', L: 5.7, W: 2.03, H: 1.9, weight: 0.5, tint: true, parked: true },
  { file: 'van', name: 'panel van', L: 5.3, W: 2.0, H: 2.15, weight: 0.3, tint: true, parked: true },
  { file: 'taxi', name: 'taxi', L: 4.9, W: 1.86, H: 1.78, weight: 0.4, tint: false, roofSign: true, parked: true, notIn: ['alpine'] },
  { file: 'police', name: 'police interceptor', L: 5.1, W: 1.98, H: 1.62, weight: 0.22, tint: false, emergency: 'police' },
  { file: 'ambulance', name: 'ambulance', L: 6.6, W: 2.35, H: 2.85, weight: 0.07, tint: false, emergency: 'ambulance', notIn: ['alpine'] },
  { file: 'firetruck', name: 'fire engine', L: 9.4, W: 2.5, H: 3.2, weight: 0.04, tint: false, emergency: 'fire', notIn: ['alpine'] },
  { file: 'delivery', name: 'box truck', L: 7.2, W: 2.45, H: 3.3, weight: 0.25, tint: false, parked: true, notIn: ['alpine'] },
  { file: 'garbage-truck', name: 'garbage truck', L: 8.4, W: 2.5, H: 3.4, weight: 0.07, tint: false, notIn: ['alpine'] },
];

/** Linear-space glass colour (matches the procedural traffic cabins). */
const GLASS: [number, number, number] = [0.03, 0.038, 0.05];

export interface Palette { w: number; h: number; px: Uint8ClampedArray }

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Sample the palette at a UV (glTF UVs have a top-left origin). Returns linear RGB. */
export function samplePalette(p: Palette, u: number, v: number): [number, number, number] {
  const x = Math.min(p.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * p.w)));
  const y = Math.min(p.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * p.h)));
  const i = (y * p.w + x) * 4;
  return [srgbToLinear(p.px[i]), srgbToLinear(p.px[i + 1]), srgbToLinear(p.px[i + 2])];
}

/** Window glass lives in the bottom-left (white → pale blue) swatch of the Kenney colormap; only windows use it. */
export function isGlassUV(u: number, v: number) {
  return u < 0.125 && v > 0.75;
}

function lum(c: [number, number, number]) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function sat(c: [number, number, number]) {
  const mx = Math.max(...c), mn = Math.min(...c);
  return mx <= 1e-4 ? 0 : (mx - mn) / mx;
}

const isRed = (c: [number, number, number]) => c[0] > 0.35 && c[1] < c[0] * 0.45 && c[2] < c[0] * 0.45;
const isBlue = (c: [number, number, number]) => c[2] > 0.3 && c[0] < c[2] * 0.5 && c[1] < c[2] * 0.85;

interface Tri { p: number[]; n: [number, number, number]; c: [number, number, number]; glass: boolean; cx: number; cy: number; cz: number }

/** Flatten meshes (world transforms + an extra matrix) into triangles with a palette colour per face. */
function triangles(meshes: Mesh[], extra: Matrix4, pal: Palette): Tri[] {
  const out: Tri[] = [];
  const m = new Matrix4();
  for (const mesh of meshes) {
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()) as BufferGeometry;
    g.applyMatrix4(m.multiplyMatrices(extra, mesh.matrixWorld));
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i += 3) {
      const p: number[] = [];
      for (let k = 0; k < 3; k++) p.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      const u = uv ? (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3 : 0.5;
      const v = uv ? (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3 : 0.5;
      out.push({ p, n: [0, 0, 0], c: samplePalette(pal, u, v), glass: isGlassUV(u, v), cx: 0, cy: 0, cz: 0 });
    }
    g.dispose();
  }
  return out;
}

/** Scale/offset triangles in place and compute flat normals; degenerate triangles are removed (a zero normal shades as NaN). */
function finishTris(tris: Tri[], sx: number, sy: number, sz: number, ox: number, oy: number, oz: number) {
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const bad = new Set<Tri>();
  for (const t of tris) {
    for (let k = 0; k < 9; k += 3) {
      t.p[k] = (t.p[k] - ox) * sx;
      t.p[k + 1] = (t.p[k + 1] - oy) * sy;
      t.p[k + 2] = (t.p[k + 2] - oz) * sz;
    }
    a.fromArray(t.p, 0);
    b.fromArray(t.p, 3);
    c.fromArray(t.p, 6);
    const n = b.sub(a).cross(c.sub(a));
    const l = n.length();
    if (!(l > 1e-9)) { bad.add(t); continue; }
    t.n = [n.x / l, n.y / l, n.z / l];
    t.cx = (t.p[0] + t.p[3] + t.p[6]) / 3;
    t.cy = (t.p[1] + t.p[4] + t.p[7]) / 3;
    t.cz = (t.p[2] + t.p[5] + t.p[8]) / 3;
  }
  if (bad.size) {
    const keep = tris.filter((t) => !bad.has(t));
    tris.length = 0;
    tris.push(...keep);
  }
}

/** Build a non-indexed geometry with flat normals and per-face colours. `lift` pushes faces along their normal. */
function geometryOf(tris: Tri[], color: (t: Tri) => [number, number, number], lift = 0): BufferGeometry {
  const pos = new Float32Array(tris.length * 9);
  const nor = new Float32Array(tris.length * 9);
  const col = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    const c = color(t);
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      pos[o] = t.p[k * 3] + t.n[0] * lift;
      pos[o + 1] = t.p[k * 3 + 1] + t.n[1] * lift;
      pos[o + 2] = t.p[k * 3 + 2] + t.n[2] * lift;
      nor.set(t.n, o);
      col.set(c, o);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** Most common saturated colour by area: the body paint. */
function dominantPaint(tris: Tri[]): [number, number, number] | null {
  const bins = new Map<string, { area: number; c: [number, number, number] }>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const t of tris) {
    if (t.glass || sat(t.c) < 0.3 || lum(t.c) < 0.03) continue;
    a.fromArray(t.p, 0); b.fromArray(t.p, 3); c.fromArray(t.p, 6);
    const area = b.sub(a).cross(c.sub(a)).length();
    const key = t.c.map((x) => Math.round(Math.pow(x, 1 / 2.2) * 8)).join(',');
    const e = bins.get(key) ?? { area: 0, c: t.c };
    e.area += area;
    bins.set(key, e);
  }
  let best: { area: number; c: [number, number, number] } | null = null;
  for (const e of bins.values()) if (!best || e.area > best.area) best = e;
  return best?.c ?? null;
}

const near = (a: [number, number, number], b: [number, number, number]) => {
  const pa = a.map((x) => Math.pow(x, 1 / 2.2)), pb = b.map((x) => Math.pow(x, 1 / 2.2));
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) < 0.22;
};

export interface FleetVariant extends TrafficVariant {
  spec: FleetSpec;
}

/** Bake one loaded Kenney vehicle scene into a traffic variant. */
export function bakeVehicle(root: Object3D, spec: FleetSpec, pal: Palette): FleetVariant {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const wheelOf = (m: Mesh) => {
    let o: Object3D | null = m;
    while (o) { if (/^wheel-(front|back)-(left|right)$/.test(o.name)) return o.name; o = o.parent; }
    return null;
  };
  const wheelMeshes = meshes.filter((m) => wheelOf(m));
  const bodyMeshes = meshes.filter((m) => !wheelOf(m));
  // Kenney cars face +Z; the game's vehicles face -Z
  const rot = new Matrix4().makeRotationY(Math.PI);
  const body = triangles(bodyMeshes, rot, pal);
  const box = new Box3();
  for (const t of body) for (let k = 0; k < 9; k += 3) box.expandByPoint(new Vector3(t.p[k], t.p[k + 1], t.p[k + 2]));
  const wheelBoxes = new Map<string, Box3>();
  const wheelTris = new Map<string, Tri[]>();
  for (const m of wheelMeshes) {
    const tris = triangles([m], rot, pal);
    const name = wheelOf(m)!;
    const wb = wheelBoxes.get(name) ?? new Box3();
    for (const t of tris) for (let k = 0; k < 9; k += 3) wb.expandByPoint(new Vector3(t.p[k], t.p[k + 1], t.p[k + 2]));
    wheelBoxes.set(name, wb);
    wheelTris.set(name, [...(wheelTris.get(name) ?? []), ...tris]);
    box.union(wb);
  }
  const size = box.getSize(new Vector3());
  const sx = spec.W / size.x, sy = spec.H / size.y, sz = spec.L / size.z;
  const ox = (box.min.x + box.max.x) / 2, oy = box.min.y, oz = (box.min.z + box.max.z) / 2;
  finishTris(body, sx, sy, sz, ox, oy, oz);
  const paint = spec.tint ? dominantPaint(body) : null;
  const paintL = paint ? lum(paint) : 1;
  const bodyColor = (t: Tri): [number, number, number] => {
    if (t.glass) return GLASS;
    if (paint && near(t.c, paint)) {
      const k = Math.max(0.55, Math.min(1.15, lum(t.c) / paintL));
      return [k, k, k];
    }
    return t.c;
  };
  const hz = spec.L / 2;
  // lights: bright faces on the nose, red faces on the tail
  const head = body.filter((t) => !t.glass && t.n[2] < -0.55 && t.cz < -hz + spec.L * 0.08 && lum(t.c) > 0.55 && sat(t.c) < 0.6 && t.cy > spec.H * 0.15 && t.cy < spec.H * 0.75);
  const tail = body.filter((t) => !t.glass && t.n[2] > 0.55 && t.cz > hz - spec.L * 0.08 && isRed(t.c) && t.cy > spec.H * 0.12);
  const roofY = spec.H * (spec.emergency === 'police' ? 0.86 : 0.8);
  const beacons = spec.emergency ? body.filter((t) => !t.glass && t.cy > roofY && (isRed(t.c) || isBlue(t.c)) && sat(t.c) > 0.45) : [];
  const sign = spec.roofSign ? body.filter((t) => !t.glass && t.cy > spec.H * 0.86 && lum(t.c) > 0.25) : [];
  const lightTris = [...head, ...tail, ...sign];
  const tailSet = new Set(tail), signSet = new Set(sign);
  const lights = lightTris.length
    ? geometryOf(lightTris, (t) => (tailSet.has(t) ? [1, 0.05, 0.03] : signSet.has(t) ? [1, 0.78, 0.32] : [1, 0.95, 0.85]), 0.012)
    : new BoxGeometry(0.01, 0.01, 0.01).toNonIndexed();
  if (!lights.getAttribute('color')) lights.setAttribute('color', new BufferAttribute(new Float32Array(lights.getAttribute('position').count * 3), 3));
  const beaconL = beacons.length ? geometryOf(beacons.filter((t) => t.cx < 0), (t) => (isBlue(t.c) ? [0.12, 0.3, 1] : [1, 0.06, 0.04]), 0.015) : undefined;
  const beaconR = beacons.length ? geometryOf(beacons.filter((t) => t.cx >= 0), (t) => (isBlue(t.c) ? [0.12, 0.3, 1] : [1, 0.06, 0.04]), 0.015) : undefined;
  const bare = geometryOf(body, bodyColor);
  // wheels: positions in FL, FR, RL, RR order (front is -Z, left is -X), geometry from one right-hand wheel
  const order = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];
  const wheelPos: number[] = [];
  let wheelR = 0.34;
  let wheel: BufferGeometry | null = null;
  const hubs = new Map<string, Vector3>();
  for (const [name, wb] of wheelBoxes) {
    const c = wb.getCenter(new Vector3());
    hubs.set(name, new Vector3((c.x - ox) * sx, (c.y - oy) * sy, (c.z - oz) * sz));
    wheelR = ((wb.max.y - wb.min.y) / 2) * sy;
  }
  const sorted = [...hubs.entries()];
  const pick = (front: boolean, left: boolean) =>
    sorted.find(([, p]) => (p.z < 0) === front && (p.x < 0) === left)?.[1] ?? new Vector3(left ? -spec.W / 2 + 0.2 : spec.W / 2 - 0.2, wheelR, front ? -spec.L * 0.32 : spec.L * 0.32);
  for (const [front, left] of [[true, true], [true, false], [false, true], [false, false]] as const) {
    const p = pick(front, left);
    wheelPos.push(p.x, p.y, p.z);
  }
  const rightName = sorted.find(([, p]) => p.x > 0)?.[0] ?? order[1];
  const wt = wheelTris.get(rightName);
  if (wt) {
    const wb = wheelBoxes.get(rightName)!;
    const c = wb.getCenter(new Vector3());
    // wheels stay round: scale the radius (y, z) by sy and the tread width by sx
    finishTris(wt, sx, sy, sy, c.x, c.y, c.z);
    wheel = geometryOf(wt, (t) => t.c);
  }
  if (!wheel) {
    wheel = new BoxGeometry(0.24, wheelR * 2, wheelR * 2).toNonIndexed();
    wheel.deleteAttribute('uv');
  }
  if (!wheel.getAttribute('color')) wheel.setAttribute('color', new BufferAttribute(new Float32Array(wheel.getAttribute('position').count * 3).fill(0.04), 3));
  // static body (parked cars) = body + four placed wheels
  const placed: BufferGeometry[] = [bare];
  for (let k = 0; k < 4; k++) {
    const g = wheel.clone();
    if (wheelPos[k * 3] < 0) g.applyMatrix4(new Matrix4().makeRotationY(Math.PI));
    g.translate(wheelPos[k * 3], wheelPos[k * 3 + 1], wheelPos[k * 3 + 2]);
    placed.push(g);
  }
  const full = mergeGeometries(placed, false)!;
  for (const g of placed.slice(1)) g.dispose();
  // turn indicators: amber blocks at the outer corners, level with the lamps
  const avgY = (list: Tri[], f: number) => (list.length ? list.reduce((s, t) => s + t.cy, 0) / list.length : spec.H * f);
  const hy = avgY(head, 0.45), ty = avgY(tail, 0.5);
  const hw = spec.W / 2;
  const ip = [
    new BoxGeometry(0.14, 0.08, 0.05).translate(hw - 0.1, hy, -hz - 0.02).toNonIndexed(),
    new BoxGeometry(0.12, 0.08, 0.05).translate(hw - 0.1, ty, hz + 0.02).toNonIndexed(),
    new BoxGeometry(0.03, 0.05, 0.12).translate(hw + 0.01, hy + 0.08, -hz + spec.L * 0.2).toNonIndexed(),
  ];
  for (const g of ip) {
    g.deleteAttribute('uv');
    g.setAttribute('color', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).map((_, i) => [1, 0.5, 0.04][i % 3]), 3));
  }
  const indicators = mergeGeometries(ip, false)!;
  for (const g of ip) g.dispose();
  return {
    name: spec.name, length: spec.L, width: spec.W, height: spec.H, body: full, bare, lights, indicators, wheel, wheelPos, wheelR,
    weight: spec.weight, tint: spec.tint, emergency: spec.emergency, beaconL, beaconR, spec,
  };
}

let palette: Promise<Palette> | null = null;
function loadPalette(base: string): Promise<Palette> {
  palette ??= new ImageLoader().loadAsync(`${base}Textures/colormap.png`).then((img) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, px: ctx.getImageData(0, 0, c.width, c.height).data };
  });
  return palette;
}

let loader: Promise<GLTFLoader> | null = null;
export function gltfLoader(): Promise<GLTFLoader> {
  loader ??= import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  return loader;
}

export function carKitBase() {
  return `${import.meta.env.BASE_URL}media/kenney/car-kit/`;
}

/** Load a Kenney GLB and free its GPU-side resources (we only keep baked geometry). */
export async function loadKenneyScene(file: string): Promise<{ root: Object3D; pal: Palette }> {
  const base = carKitBase();
  const [gl, pal] = await Promise.all([gltfLoader(), loadPalette(base)]);
  const gltf = await gl.loadAsync(`${base}${file}.glb`);
  return { root: gltf.scene, pal };
}

export function disposeScene(root: Object3D) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && 'isTexture' in v) (v as { dispose(): void }).dispose();
      mat.dispose();
    }
  });
}

let fleet: Promise<FleetVariant[]> | null = null;
let fleetReady: FleetVariant[] | null = null;

/** Load + bake the whole fleet once per session. Resolves to [] when the files are unavailable. */
export function loadFleet(): Promise<FleetVariant[]> {
  fleet ??= (async () => {
    try {
      const out = await Promise.all(FLEET.map(async (spec) => {
        const { root, pal } = await loadKenneyScene(spec.file);
        const v = bakeVehicle(root, spec, pal);
        disposeScene(root);
        return v;
      }));
      fleetReady = out;
      return out;
    } catch (e) {
      console.warn('Kenney fleet unavailable, procedural traffic only', e);
      fleetReady = [];
      return [];
    }
  })();
  return fleet;
}

/** The baked fleet if it has finished loading (else empty). */
export function fleetVariants(): FleetVariant[] {
  return fleetReady ?? [];
}

/** Bake a small Kenney prop (debris) centred on its bounds; with `tint`, its paint turns white for instance colours. */
export function bakeProp(root: Object3D, pal: Palette, scale: number, tint: boolean): { geometry: BufferGeometry; radius: number } {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const tris = triangles(meshes, new Matrix4(), pal);
  const box = new Box3();
  for (const t of tris) for (let k = 0; k < 9; k += 3) box.expandByPoint(new Vector3(t.p[k], t.p[k + 1], t.p[k + 2]));
  const c = box.getCenter(new Vector3());
  finishTris(tris, scale, scale, scale, c.x, c.y, c.z);
  const paint = tint ? dominantPaint(tris) : null;
  const pl = paint ? lum(paint) : 1;
  const geometry = geometryOf(tris, (t) => {
    if (t.glass) return GLASS;
    if (paint && near(t.c, paint)) { const k = Math.max(0.55, Math.min(1.15, lum(t.c) / pl)); return [k, k, k]; }
    return t.c;
  });
  return { geometry, radius: (box.getSize(new Vector3()).length() / 2) * scale };
}

/** Free the fleet's GPU buffers when a world is torn down; the CPU-side geometry stays cached and re-uploads on next use. */
export function releaseFleetGPU() {
  for (const v of fleetReady ?? []) {
    for (const g of [v.body, v.bare, v.lights, v.wheel, v.indicators, v.beaconL, v.beaconR]) g?.dispose();
  }
}
