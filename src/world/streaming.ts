import { BufferAttribute, BufferGeometry, Group, Mesh, type Material, type Scene } from 'three';
import type { ChunkData, ChunkOptions } from './chunkGen.ts';
import { ChunkContext } from './chunkGen.ts';
import type { MeshBuf } from './meshBuilder.ts';
import type { DistrictData } from './types.ts';
import type { Materials } from '../render/materials.ts';
import { G, type PhysicsWorld, type RAPIER } from '../physics/world.ts';
import { buildChunkProps, type SignalLampRef } from './props.ts';
import { parkedVariants } from '../vehicle/trafficModels.ts';

interface LoadedChunk {
  key: string;
  cx: number;
  cz: number;
  group: Group;
  colliders: RAPIER.Collider[];
  geometries: BufferGeometry[];
  signals: SignalLampRef[];
  tunnelZones: Float32Array;
  /** Lamp head positions (x,y,z) for the point-light pool and wet streaks. */
  lampHeads: number[];
}

function toGeometry(m: MeshBuf, uvName = 'uv'): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  if (m.col) g.setAttribute('color', new BufferAttribute(m.col, 3));
  if (m.uv) g.setAttribute(uvName, new BufferAttribute(m.uv, 2));
  if (m.ex) g.setAttribute('facadeType', new BufferAttribute(m.ex, 1));
  g.setIndex(new BufferAttribute(m.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Streams district chunks around a focus point using a Web Worker (with a synchronous fallback). */
export class ChunkStreamer {
  readonly group = new Group();
  readonly loaded = new Map<string, LoadedChunk>();
  private pending = new Map<string, number>();
  private ready: ChunkData[] = [];
  private worker: Worker | null = null;
  private sync: ChunkContext | null = null;
  private nextId = 1;
  private idToKey = new Map<number, string>();
  radius = 2;
  shadows = true;
  private d: DistrictData;
  private mats: Materials;
  private physics: PhysicsWorld;
  private workerReady: Promise<void>;
  onSignalsChanged?: () => void;
  readonly S: number;

  constructor(scene: Scene, d: DistrictData, opts: ChunkOptions, mats: Materials, physics: PhysicsWorld) {
    this.d = d;
    this.mats = mats;
    this.physics = physics;
    this.S = d.chunkSize;
    scene.add(this.group);
    try {
      this.worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
    if (this.worker) {
      const w = this.worker;
      this.workerReady = new Promise((res, rej) => {
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data;
          if (m.type === 'ready') res();
          else if (m.type === 'chunk') this.ready.push(m.data as ChunkData);
          else if (m.type === 'error') { console.error('chunk worker:', m.message); const k = this.idToKey.get(m.id); if (k) this.pending.delete(k); }
        };
        w.onmessage = onMsg;
        w.onerror = (e) => { console.warn('worker failed, falling back to main thread', e.message); this.worker = null; this.sync = new ChunkContext(d, opts); res(); void rej; };
      });
      w.postMessage({ type: 'init', data: d, opts });
    } else {
      this.sync = new ChunkContext(d, opts);
      this.workerReady = Promise.resolve();
    }
  }

  whenReady() {
    return this.workerReady;
  }

  private desired(fx: number, fz: number): { key: string; cx: number; cz: number; d: number }[] {
    const S = this.S;
    const g = this.d.elevation;
    const ccx = Math.floor(fx / S), ccz = Math.floor(fz / S);
    const out: { key: string; cx: number; cz: number; d: number }[] = [];
    const r = this.radius;
    const x0 = Math.floor(g.x0 / S), x1 = Math.floor((g.x0 + (g.cols - 1) * g.cell - 0.01) / S);
    const z0 = Math.floor(g.z0 / S), z1 = Math.floor((g.z0 + (g.rows - 1) * g.cell - 0.01) / S);
    for (let cx = ccx - r; cx <= ccx + r; cx++) for (let cz = ccz - r; cz <= ccz + r; cz++) {
      if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
      const d = Math.hypot((cx + 0.5) * S - fx, (cz + 0.5) * S - fz);
      if (d > (r + 0.75) * S) continue;
      out.push({ key: `${cx},${cz}`, cx, cz, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Request/unload chunks around the focus and finalize at most `budget` ready chunks. */
  update(fx: number, fz: number, budget = 1) {
    const want = this.desired(fx, fz);
    const wantKeys = new Set(want.map((w) => w.key));
    for (const w of want) {
      if (this.loaded.has(w.key) || this.pending.has(w.key)) continue;
      if (this.pending.size >= 3) break;
      const id = this.nextId++;
      this.pending.set(w.key, id);
      this.idToKey.set(id, w.key);
      if (this.worker) this.worker.postMessage({ type: 'chunk', cx: w.cx, cz: w.cz, id });
      else if (this.sync) this.ready.push(this.sync.generate(w.cx, w.cz));
    }
    // unload with hysteresis
    for (const [k, c] of this.loaded) {
      if (wantKeys.has(k)) continue;
      const d = Math.hypot((c.cx + 0.5) * this.S - fx, (c.cz + 0.5) * this.S - fz);
      if (d > (this.radius + 1.5) * this.S) this.unload(k);
    }
    let n = 0;
    while (this.ready.length && n < budget) {
      const data = this.ready.shift()!;
      this.pending.delete(data.key);
      if (this.loaded.has(data.key)) continue;
      this.finalize(data);
      n++;
    }
  }

  /** Load every chunk around a point synchronously-ish (for loading screens). */
  async preload(fx: number, fz: number, onProgress?: (f: number) => void) {
    await this.workerReady;
    const want = this.desired(fx, fz);
    const total = want.length;
    while (true) {
      this.update(fx, fz, 4);
      const done = want.filter((w) => this.loaded.has(w.key)).length;
      onProgress?.(done / total);
      if (done >= total) break;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  get pendingCount() {
    return this.pending.size + this.ready.length;
  }

  private finalize(data: ChunkData) {
    const group = new Group();
    group.name = `chunk ${data.key}`;
    const geos: BufferGeometry[] = [];
    const add = (m: MeshBuf | null, mat: Material, cast: boolean, receive = true, uvName?: string) => {
      if (!m) return;
      const g = toGeometry(m, uvName);
      geos.push(g);
      const mesh = new Mesh(g, mat);
      mesh.castShadow = cast && this.shadows;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    const M = this.mats;
    add(data.terrain, M.terrain, false);
    add(data.roads, M.road, false);
    add(data.decals, M.decal, false);
    add(data.neon, M.neon, false, false);
    add(data.sidewalks, M.sidewalk, false);
    add(data.markings, M.marking, false);
    add(data.buildings, M.building, true, true, 'facade');
    add(data.roofs, M.roof, true);
    add(data.structures, M.structure, true);
    add(data.tunnelLights, M.tunnelLight, false, false);
    const props = buildChunkProps(M, data, this.shadows);
    for (const im of props.meshes) group.add(im);
    // colliders
    const colliders: RAPIER.Collider[] = [];
    const pw = this.physics;
    if (data.terrainCollider) colliders.push(pw.addStaticTrimesh(data.terrainCollider.v, data.terrainCollider.i, G.TERRAIN, 'terrain'));
    if (data.roadCollider) colliders.push(pw.addStaticTrimesh(data.roadCollider.v, data.roadCollider.i, G.ROAD, 'asphalt'));
    if (data.staticCollider) colliders.push(pw.addStaticTrimesh(data.staticCollider.v, data.staticCollider.i, G.STATIC, 'wall'));
    const vars = parkedVariants();
    for (const p of props.parked) {
      const v = vars[p.variant];
      const cy = p.y + v.height * 0.45;
      colliders.push(pw.addStaticCuboid(p.x, cy, p.z, v.width / 2 - 0.05, v.height * 0.42, v.length / 2 - 0.1, p.yaw, G.STATIC, 'vehicle'));
    }
    this.group.add(group);
    const lampHeads: number[] = [];
    for (let i = 0; i < data.streetlights.length; i += 4) {
      const [x, y, z, h] = data.streetlights.subarray(i, i + 4);
      lampHeads.push(x + 2.5 * Math.sin(h), y + 8.1, z - 2.5 * Math.cos(h));
    }
    this.loaded.set(data.key, { key: data.key, cx: data.cx, cz: data.cz, group, colliders, geometries: geos, signals: props.signals, tunnelZones: data.tunnelZones, lampHeads });
    if (props.signals.length) this.onSignalsChanged?.();
  }

  unload(key: string) {
    const c = this.loaded.get(key);
    if (!c) return;
    for (const g of c.geometries) g.dispose();
    c.group.traverse((o) => {
      const im = o as any;
      if (im.isInstancedMesh) im.dispose();
    });
    c.group.removeFromParent();
    for (const col of c.colliders) this.physics.remove(col);
    this.loaded.delete(key);
    if (c.signals.length) this.onSignalsChanged?.();
  }

  /** Lamp heads within radius of a point (flattened x,y,z). */
  lampHeadsNear(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const r2 = r * r;
    for (const c of this.loaded.values()) {
      const L = c.lampHeads;
      for (let i = 0; i < L.length; i += 3) if ((L[i] - x) ** 2 + (L[i + 2] - z) ** 2 < r2) out.push(L[i], L[i + 1], L[i + 2]);
    }
    return out;
  }

  allSignals(): SignalLampRef[] {
    const out: SignalLampRef[] = [];
    for (const c of this.loaded.values()) out.push(...c.signals);
    return out;
  }

  /** Is (x,y,z) inside a tunnel zone of a loaded chunk? */
  inTunnel(x: number, y: number, z: number): boolean {
    for (const c of this.loaded.values()) {
      const t = c.tunnelZones;
      for (let i = 0; i < t.length; i += 7) {
        if (y < t[i + 5] || y > t[i + 6]) continue;
        const ax = t[i], az = t[i + 1], bx = t[i + 2], bz = t[i + 3];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        let u = ((x - ax) * dx + (z - az) * dz) / l2;
        u = Math.max(0, Math.min(1, u));
        if (Math.hypot(x - (ax + dx * u), z - (az + dz * u)) < t[i + 4]) return true;
      }
    }
    return false;
  }

  dispose() {
    for (const k of [...this.loaded.keys()]) this.unload(k);
    this.worker?.terminate();
    this.group.removeFromParent();
  }
}
