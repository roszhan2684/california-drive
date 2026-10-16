// Pure chunk generator: district data -> render buffers, collider buffers and prop instances.
// Runs inside a Web Worker at runtime and directly in Node tests.

import { ShapeUtils, Vector2 } from 'three';
import type { Biome } from './cities.ts';
import type { Building, DistrictData, RoadEdge } from './types.ts';
import { Heightfield } from './heightfield.ts';
import { RoadNetwork } from './roadGraph.ts';
import { distPointSeg, hash01, pointInPoly, polyBounds, polyArea, rng } from './geom.ts';
import { MeshBuilder, hexToRgb, type MeshBuf } from './meshBuilder.ts';

export const LANE_W = 3.3;
export const ROAD_LIFT = 0.09;
export const SIDEWALK_W = 2.6;
export const CURB_H = 0.15;

export interface ChunkOptions {
  biome: Biome;
  buildingPalette: string[];
  ground: string;
  treeDensity: number;
  palms: boolean;
  urban: boolean;
  /** Architectural style: SF adds Victorian bay windows/cornices and red curbs. */
  style?: 'sf' | 'city' | 'alpine';
  /** Facade material weights: brick, stucco, concrete, wood siding. */
  facadeMix?: [number, number, number, number];
  /** Probability that a street-facing building carries a neon sign. */
  neon?: number;
}

/** Facade type codes written to the building `facadeType` attribute (+4 = glass curtain wall). */
export const FACADE = { BRICK: 0, STUCCO: 1, CONCRETE: 2, SIDING: 3, CURTAIN: 4 } as const;
const PASTELS = ['#e8cfae', '#cddcc6', '#d9c9e2', '#f2e3b3', '#bfd4e6', '#e9b9a9', '#f0ece0', '#c7c0b0', '#9fb7c9'];
const NEON = ['#ff2bd6', '#22e5ff', '#ffb020', '#ff3a30', '#3dff7a', '#9b5cff'];

export interface Collider { v: Float32Array; i: Uint32Array }

export interface ChunkData {
  key: string;
  cx: number;
  cz: number;
  terrain: MeshBuf | null;
  roads: MeshBuf | null;
  neon: MeshBuf | null;
  decals: MeshBuf | null;
  sidewalks: MeshBuf | null;
  markings: MeshBuf | null;
  buildings: MeshBuf | null;
  roofs: MeshBuf | null;
  structures: MeshBuf | null;
  tunnelLights: MeshBuf | null;
  terrainCollider: Collider | null;
  roadCollider: Collider | null;
  staticCollider: Collider | null;
  /** x,y,z,yaw */
  streetlights: Float32Array;
  /** x,y,z,scale,yaw,type(0 broadleaf,1 conifer,2 palm) */
  trees: Float32Array;
  /** x,y,z,yaw,node,edge */
  signals: Float32Array;
  /** x,y,z,yaw */
  stopSigns: Float32Array;
  /** x,y,z,yaw,pitch,variant,color */
  parked: Float32Array;
  /** tunnel zone polygons for collision filtering: ax,az,bx,bz,halfWidth,yMin,yMax */
  tunnelZones: Float32Array;
  stats: { tris: number };
}

interface TunnelSeg { ax: number; az: number; bx: number; bz: number; ya: number; yb: number; hw: number }

export function chunkKey(cx: number, cz: number) {
  return `${cx},${cz}`;
}

export class ChunkContext {
  readonly d: DistrictData;
  readonly hf: Heightfield;
  readonly net: RoadNetwork;
  readonly S: number;
  readonly opts: ChunkOptions;
  private edgeSegChunks = new Map<string, { e: number; i: number }[]>();
  private nodeChunks = new Map<string, number[]>();
  private bldChunks = new Map<string, number[]>();
  private bldGrid = new Map<string, number[]>();
  private parkGrid = new Map<string, number[]>();
  private tunnelSegs: TunnelSeg[] = [];
  private nodeRadius: Float32Array;
  private palette: [number, number, number][];
  private groundRgb: [number, number, number];

  constructor(d: DistrictData, opts: ChunkOptions) {
    this.d = d;
    this.opts = opts;
    this.S = d.chunkSize;
    this.hf = Heightfield.fromGrid(d.elevation);
    this.net = new RoadNetwork(d);
    this.palette = opts.buildingPalette.map(hexToRgb);
    this.groundRgb = hexToRgb(opts.ground);
    this.nodeRadius = new Float32Array(d.nodes.length);
    for (const e of d.edges) {
      this.nodeRadius[e.a] = Math.max(this.nodeRadius[e.a], e.w / 2);
      this.nodeRadius[e.b] = Math.max(this.nodeRadius[e.b], e.w / 2);
      for (let i = 0; i < e.p.length / 2 - 1; i++) {
        const mx = (e.p[i * 2] + e.p[i * 2 + 2]) / 2, mz = (e.p[i * 2 + 1] + e.p[i * 2 + 3]) / 2;
        push(this.edgeSegChunks, this.keyOf(mx, mz), { e: e.id, i });
        if (e.tunnel) {
          this.tunnelSegs.push({ ax: e.p[i * 2], az: e.p[i * 2 + 1], bx: e.p[i * 2 + 2], bz: e.p[i * 2 + 3], ya: e.h[i], yb: e.h[i + 1], hw: e.w / 2 });
        }
      }
    }
    d.nodes.forEach((n, i) => push(this.nodeChunks, this.keyOf(n.x, n.z), i));
    d.buildings.forEach((b, i) => {
      const bb = polyBounds(b.p);
      push(this.bldChunks, this.keyOf((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2), i);
      for (let gx = Math.floor(bb.minX / 32); gx <= Math.floor(bb.maxX / 32); gx++)
        for (let gz = Math.floor(bb.minZ / 32); gz <= Math.floor(bb.maxZ / 32); gz++) push(this.bldGrid, `${gx},${gz}`, i);
    });
    d.parks.forEach((p, i) => {
      const bb = polyBounds(p);
      for (let gx = Math.floor(bb.minX / 64); gx <= Math.floor(bb.maxX / 64); gx++)
        for (let gz = Math.floor(bb.minZ / 64); gz <= Math.floor(bb.maxZ / 64); gz++) push(this.parkGrid, `${gx},${gz}`, i);
    });
  }

  keyOf(x: number, z: number) {
    return chunkKey(Math.floor(x / this.S), Math.floor(z / this.S));
  }

  /** Chunk index range covering the terrain grid. */
  chunkRange() {
    const g = this.d.elevation;
    return {
      cx0: Math.floor(g.x0 / this.S), cx1: Math.floor((g.x0 + (g.cols - 1) * g.cell - 0.01) / this.S),
      cz0: Math.floor(g.z0 / this.S), cz1: Math.floor((g.z0 + (g.rows - 1) * g.cell - 0.01) / this.S),
    };
  }

  insideBuilding(x: number, z: number, margin = 0): boolean {
    const arr = this.bldGrid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
    if (!arr) return false;
    for (const i of arr) {
      const b = this.d.buildings[i];
      if (pointInPoly(x, z, b.p)) return true;
      if (margin > 0) {
        for (let k = 0; k < b.p.length; k += 2) {
          const k2 = (k + 2) % b.p.length;
          if (distPointSeg(x, z, b.p[k], b.p[k + 1], b.p[k2], b.p[k2 + 1]).d < margin) return true;
        }
      }
    }
    return false;
  }

  /** Distance to the nearest building wall (capped at max). */
  buildingDistance(x: number, z: number, max = 4): number {
    let best = max;
    for (let gx = Math.floor((x - max) / 32); gx <= Math.floor((x + max) / 32); gx++)
      for (let gz = Math.floor((z - max) / 32); gz <= Math.floor((z + max) / 32); gz++) {
        const arr = this.bldGrid.get(`${gx},${gz}`);
        if (!arr) continue;
        for (const i of arr) {
          const p = this.d.buildings[i].p;
          for (let k = 0; k < p.length; k += 2) {
            const k2 = (k + 2) % p.length;
            const d = distPointSeg(x, z, p[k], p[k + 1], p[k2], p[k2 + 1]).d;
            if (d < best) best = d;
          }
        }
      }
    return best;
  }

  /** Baked ambient occlusion factor for ground near walls (1 = open). */
  groundAO(x: number, z: number): number {
    if (!this.opts.urban) return 1;
    const d = this.buildingDistance(x, z, 3.5);
    return 0.55 + 0.45 * Math.min(1, d / 3.5);
  }

  inPark(x: number, z: number): boolean {
    const arr = this.parkGrid.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`);
    if (!arr) return false;
    for (const i of arr) if (pointInPoly(x, z, this.d.parks[i])) return true;
    return false;
  }

  /** Distance to nearest road edge (beyond its half width); negative when on a road. */
  roadClearance(x: number, z: number, max = 30): number {
    const h = this.net.nearest(x, z, max, (e) => !e.tunnel);
    if (!h) return max;
    return h.dist - h.edge.w / 2;
  }

  /** Tunnel cover check: returns road y if (x,z) is within a tunnel corridor. */
  tunnelAt(x: number, z: number, extra = 0): number | null {
    for (const t of this.tunnelSegs) {
      const h = distPointSeg(x, z, t.ax, t.az, t.bx, t.bz);
      if (h.d < t.hw + extra) return t.ya + (t.yb - t.ya) * h.t;
    }
    return null;
  }

  groundAt(x: number, z: number) {
    const t = this.hf.sample(x, z);
    return this.d.waterY !== null ? Math.max(t, this.d.waterY + 0.5) : t;
  }

  generate(cx: number, cz: number): ChunkData {
    const key = chunkKey(cx, cz);
    const x0 = cx * this.S, z0 = cz * this.S, x1 = x0 + this.S, z1 = z0 + this.S;
    const terrain = new MeshBuilder(true);
    const terrainCol: number[] = [], terrainIdx: number[] = [];
    this.buildTerrain(x0, z0, x1, z1, terrain, terrainCol, terrainIdx);

    const roads = new MeshBuilder(false);
    const sidewalks = new MeshBuilder(true);
    const markings = new MeshBuilder(true);
    const structures = new MeshBuilder(true);
    const tunnelLights = new MeshBuilder(false);
    const roadCol = new MeshBuilder(false);
    const staticCol = new MeshBuilder(false);
    const streetlights: number[] = [], signals: number[] = [], stopSigns: number[] = [], parked: number[] = [], trees: number[] = [];
    const tunnelZones: number[] = [];
    const decals = new MeshBuilder(true);

    const segs = this.edgeSegChunks.get(key) ?? [];
    const byEdge = new Map<number, number[]>();
    for (const s of segs) push(byEdge, s.e, s.i);
    for (const [eid, idxs] of byEdge) {
      idxs.sort((a, b) => a - b);
      this.buildRoadSegments(this.d.edges[eid], idxs, roads, sidewalks, markings, structures, tunnelLights, roadCol, staticCol, tunnelZones);
      this.buildDecals(this.d.edges[eid], idxs, decals);
      this.placeEdgeProps(this.d.edges[eid], idxs, streetlights, parked, trees);
    }
    for (const n of this.nodeChunks.get(key) ?? []) this.buildNode(n, roads, markings, roadCol, signals, stopSigns);

    const buildings = new MeshBuilder(true, true, true);
    const roofs = new MeshBuilder(true);
    const neon = new MeshBuilder(true);
    for (const bi of this.bldChunks.get(key) ?? []) this.buildBuilding(this.d.buildings[bi], bi, buildings, roofs, staticCol, neon);
    for (const pier of this.d.piers) {
      const c = polyBounds(pier);
      const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
      if (mx >= x0 && mx < x1 && mz >= z0 && mz < z1) this.buildPier(pier, structures, roadCol);
    }
    this.placeTrees(x0, z0, x1, z1, trees);

    const terrainMesh = terrain.count ? terrain.build() : null;
    const tris = (m: MeshBuilder) => m.idx.length / 3;
    return {
      key, cx, cz,
      terrain: terrainMesh,
      roads: roads.count ? roads.build() : null,
      neon: neon.count ? neon.build() : null,
      decals: decals.count ? decals.build() : null,
      sidewalks: sidewalks.count ? sidewalks.build() : null,
      markings: markings.count ? markings.build() : null,
      buildings: buildings.count ? buildings.build() : null,
      roofs: roofs.count ? roofs.build() : null,
      structures: structures.count ? structures.build() : null,
      tunnelLights: tunnelLights.count ? tunnelLights.build() : null,
      terrainCollider: terrainIdx.length ? { v: new Float32Array(terrainCol), i: new Uint32Array(terrainIdx) } : null,
      roadCollider: roadCol.count ? { v: new Float32Array(roadCol.pos), i: new Uint32Array(roadCol.idx) } : null,
      staticCollider: staticCol.count ? { v: new Float32Array(staticCol.pos), i: new Uint32Array(staticCol.idx) } : null,
      streetlights: new Float32Array(streetlights),
      trees: new Float32Array(trees),
      signals: new Float32Array(signals),
      stopSigns: new Float32Array(stopSigns),
      parked: new Float32Array(parked),
      tunnelZones: new Float32Array(tunnelZones),
      stats: { tris: tris(terrain) + tris(roads) + tris(sidewalks) + tris(markings) + tris(buildings) + tris(roofs) + tris(structures) },
    };
  }

  // ---------------------------------------------------------------- terrain
  private buildTerrain(x0: number, z0: number, x1: number, z1: number, mb: MeshBuilder, colV: number[], colI: number[]) {
    const g = this.hf;
    const c0 = Math.max(0, Math.round((x0 - g.x0) / g.cell)), c1 = Math.min(g.cols - 1, Math.round((x1 - g.x0) / g.cell));
    const r0 = Math.max(0, Math.round((z0 - g.z0) / g.cell)), r1 = Math.min(g.rows - 1, Math.round((z1 - g.z0) / g.cell));
    if (c1 <= c0 || r1 <= r0) return;
    const w = c1 - c0 + 1;
    const waterY = this.d.waterY;
    const alpine = this.opts.biome === 'alpine';
    const base = this.groundRgb;
    const grass: [number, number, number] = alpine ? hexToRgb('#4f5a34') : hexToRgb('#5d7a3e');
    const sand = hexToRgb('#c9b58c');
    const rock = hexToRgb('#8b877e');
    const seabed = hexToRgb('#5f5a49');
    const n = { x: 0, y: 1, z: 0 };
    const cut = new Uint8Array(w * (r1 - r0 + 1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = g.x0 + c * g.cell, z = g.z0 + r * g.cell;
        const y = g.at(c, r);
        g.normal(x, z, n);
        const noise = (hash01(c * 73856093 ^ r * 19349663) - 0.5) * 0.08;
        let col: [number, number, number] = base;
        if (alpine) {
          col = n.y < 0.72 ? rock : grass;
          if (n.y >= 0.72 && n.y < 0.82) col = mix(rock, grass, (n.y - 0.72) / 0.1);
        } else if (this.inPark(x, z)) col = grass;
        if (waterY !== null) {
          if (y < waterY - 0.5) col = seabed;
          else if (y < waterY + 1.6 && this.opts.biome === 'coastal') col = sand;
        }
        const ao = this.groundAO(x, z);
        mb.v(x, y, z, n.x, n.y, n.z, col[0] * (1 + noise) * ao, col[1] * (1 + noise) * ao, col[2] * (1 + noise) * ao);
        colV.push(x, y, z);
        const ty = this.tunnelAt(x, z, 2.5);
        if (ty !== null && y - ty < 10) cut[(r - r0) * w + (c - c0)] = 1;
      }
    }
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i00 = (r - r0) * w + (c - c0), i10 = i00 + 1, i01 = i00 + w, i11 = i01 + 1;
        if (!(cut[i00] && cut[i01] && cut[i10])) { mb.tri(i00, i01, i10); colI.push(i00, i01, i10); }
        if (!(cut[i10] && cut[i01] && cut[i11])) { mb.tri(i10, i01, i11); colI.push(i10, i01, i11); }
      }
    }
  }

  // ---------------------------------------------------------------- roads
  private surfaceY(e: RoadEdge, i: number, x: number, z: number) {
    if (e.bridge || e.tunnel) return e.h[i] + ROAD_LIFT;
    return Math.max(this.groundAt(x, z), e.h[i] - 0.3) + ROAD_LIFT;
  }

  private buildRoadSegments(e: RoadEdge, idxs: number[], roads: MeshBuilder, side: MeshBuilder, mark: MeshBuilder, struct: MeshBuilder, tlights: MeshBuilder, roadCol: MeshBuilder, staticCol: MeshBuilder, zones: number[]) {
    const p = e.p;
    const cnt = p.length / 2;
    const L = e.lf + e.lb;
    const travel = L * LANE_W;
    const hw = e.w / 2;
    const urban = this.opts.urban;
    const hasSidewalk = urban && !e.tunnel && e.cls !== 'motorway' && e.cls !== 'link' && e.cls !== 'service' && !e.bridge;
    const nodeA = this.d.nodes[e.a], nodeB = this.d.nodes[e.b];
    const degA = this.net.degree(e.a), degB = this.net.degree(e.b);
    const clearA = degA >= 3 ? this.nodeRadius[e.a] + 2 : 0;
    const clearB = degB >= 3 ? this.nodeRadius[e.b] + 2 : 0;
    const cum = this.net.cum[e.id];
    const len = cum[cnt - 1];
    // per-point right vectors with miter
    const rightAt = (i: number): [number, number, number] => {
      let dx = 0, dz = 0;
      if (i > 0) { const l = Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]) || 1; dx += (p[i * 2] - p[i * 2 - 2]) / l; dz += (p[i * 2 + 1] - p[i * 2 - 1]) / l; }
      if (i < cnt - 1) { const l = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]) || 1; dx += (p[i * 2 + 2] - p[i * 2]) / l; dz += (p[i * 2 + 3] - p[i * 2 + 1]) / l; }
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // miter scale relative to segment direction
      let miter = 1;
      if (i > 0 && i < cnt - 1) {
        const sl = Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]) || 1;
        const sdx = (p[i * 2] - p[i * 2 - 2]) / sl, sdz = (p[i * 2 + 1] - p[i * 2 - 1]) / sl;
        miter = 1 / Math.max(0.5, dx * sdx + dz * sdz);
      }
      return [-dz * miter, dx * miter, 1];
    };
    const across = e.w >= 12 ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1];
    for (const i of idxs) {
      const j = i + 1;
      const ri = rightAt(i), rj = rightAt(j);
      const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
      // asphalt ribbon
      const rowI: number[] = [], rowJ: number[] = [];
      const colRowI: number[] = [], colRowJ: number[] = [];
      for (const a of across) {
        const ax = xi + ri[0] * hw * a, az = zi + ri[1] * hw * a;
        const bx = xj + rj[0] * hw * a, bz = zj + rj[1] * hw * a;
        const ay = this.surfaceY(e, i, ax, az), by = this.surfaceY(e, j, bx, bz);
        rowI.push(roads.v(ax, ay, az, 0, 1, 0));
        rowJ.push(roads.v(bx, by, bz, 0, 1, 0));
        colRowI.push(roadCol.v(ax, ay, az, 0, 1, 0));
        colRowJ.push(roadCol.v(bx, by, bz, 0, 1, 0));
      }
      for (let k = 0; k < across.length - 1; k++) {
        roads.quadFacing(rowI[k], rowJ[k], rowJ[k + 1], rowI[k + 1], 0, 1, 0);
        roadCol.quadFacing(colRowI[k], colRowJ[k], colRowJ[k + 1], colRowI[k + 1], 0, 1, 0);
      }
      const si = cum[i], sj = cum[j];
      const nearEnd = (s: number) => s < clearA || s > len - clearB;
      // sidewalks + curbs (trimmed away from junctions)
      const sw0 = Math.max(si, clearA + 0.5), sw1 = Math.min(sj, len - clearB - 0.5);
      if (hasSidewalk && sw1 > sw0 + 0.2) {
        const sw = hexToRgb('#b8b4aa');
        const nearJ = this.opts.style === 'sf' && ((degA >= 3 && sw0 < clearA + 7) || (degB >= 3 && sw1 > len - clearB - 7));
        const curb = nearJ ? hexToRgb('#a3271d') : hexToRgb('#a29d93');
        const span = sj - si || 1;
        const ta = (sw0 - si) / span, tb = (sw1 - si) / span;
        const pax = xi + (xj - xi) * ta, paz = zi + (zj - zi) * ta, pbx = xi + (xj - xi) * tb, pbz = zi + (zj - zi) * tb;
        const rax = ri[0] + (rj[0] - ri[0]) * ta, raz = ri[1] + (rj[1] - ri[1]) * ta;
        const rbx = ri[0] + (rj[0] - ri[0]) * tb, rbz = ri[1] + (rj[1] - ri[1]) * tb;
        for (const sideSign of [-1, 1]) {
          const in0 = hw, out0 = hw + SIDEWALK_W;
          const pts = [[in0, 0], [in0, CURB_H], [out0, CURB_H]] as const;
          const ids: number[][] = [];
          const cids: number[][] = [];
          for (const [off, lift] of pts) {
            const ax = pax + rax * off * sideSign, az = paz + raz * off * sideSign;
            const bx = pbx + rbx * off * sideSign, bz = pbz + rbz * off * sideSign;
            const drop = lift === 0 ? 0.02 : 0;
            const ay = this.surfaceY(e, i, ax, az) + lift - drop, by = this.surfaceY(e, j, bx, bz) + lift - drop;
            const c = lift === 0 ? curb : sw;
            const aoA = off === out0 ? this.groundAO(ax, az) : 1, aoB = off === out0 ? this.groundAO(bx, bz) : 1;
            ids.push([side.v(ax, ay, az, 0, 1, 0, c[0] * aoA, c[1] * aoA, c[2] * aoA), side.v(bx, by, bz, 0, 1, 0, c[0] * aoB, c[1] * aoB, c[2] * aoB)]);
            cids.push([roadCol.v(ax, ay, az, 0, 1, 0), roadCol.v(bx, by, bz, 0, 1, 0)]);
          }
          const fnx = -rax * sideSign, fnz = -raz * sideSign;
          const P = side.pos;
          const t0 = ids[1][0], t1 = ids[1][1], b0 = ids[0][0], b1 = ids[0][1];
          const ct0 = side.v(P[t0 * 3], P[t0 * 3 + 1], P[t0 * 3 + 2], fnx, 0, fnz, curb[0], curb[1], curb[2]);
          const ct1 = side.v(P[t1 * 3], P[t1 * 3 + 1], P[t1 * 3 + 2], fnx, 0, fnz, curb[0], curb[1], curb[2]);
          const cb0 = side.v(P[b0 * 3], P[b0 * 3 + 1], P[b0 * 3 + 2], fnx, 0, fnz, curb[0], curb[1], curb[2]);
          const cb1 = side.v(P[b1 * 3], P[b1 * 3 + 1], P[b1 * 3 + 2], fnx, 0, fnz, curb[0], curb[1], curb[2]);
          side.quadFacing(cb0, cb1, ct1, ct0, fnx, 0, fnz);
          side.quadFacing(ids[1][0], ids[1][1], ids[2][1], ids[2][0], 0, 1, 0);
          roadCol.quadFacing(cids[1][0], cids[1][1], cids[2][1], cids[2][0], 0, 1, 0);
        }
      }
      // markings
      if (e.cls !== 'service' && !(nearEnd(si) && nearEnd(sj))) {
        const s0 = Math.max(si, clearA), s1 = Math.min(sj, len - clearB);
        if (s1 > s0 + 0.5) {
          const t0 = (s0 - si) / (sj - si || 1), t1 = (s1 - si) / (sj - si || 1);
          const lerpP = (t: number) => [xi + (xj - xi) * t, zi + (zj - zi) * t] as const;
          const [mx0, mz0] = lerpP(t0), [mx1, mz1] = lerpP(t1);
          const dx = mx1 - mx0, dz = mz1 - mz0, dl = Math.hypot(dx, dz) || 1;
          const rx = -dz / dl, rz = dx / dl;
          const yAt = (x: number, z: number, t: number) => (e.bridge || e.tunnel ? e.h[i] + (e.h[j] - e.h[i]) * t + ROAD_LIFT : this.surfaceY(e, i, x, z)) + 0.025;
          const strip = (off: number, width: number, c: [number, number, number], dashed: boolean) => {
            const segLen = dl;
            const pieces: [number, number][] = [];
            if (!dashed) pieces.push([0, segLen]);
            else {
              // dashes aligned to absolute distance along the edge
              const period = 12, dash = 3;
              const start = s0;
              let k = Math.floor(start / period) * period;
              for (; k < s1; k += period) {
                const a = Math.max(k, s0) - s0, b = Math.min(k + dash, s1) - s0;
                if (b > a) pieces.push([a, b]);
              }
            }
            for (const [a, b] of pieces) {
              const ax = mx0 + (dx / dl) * a + rx * off, az = mz0 + (dz / dl) * a + rz * off;
              const bx = mx0 + (dx / dl) * b + rx * off, bz = mz0 + (dz / dl) * b + rz * off;
              const hwd = width / 2;
              const ta = t0 + (t1 - t0) * (a / segLen), tb = t0 + (t1 - t0) * (b / segLen);
              const v0 = mark.v(ax - rx * hwd, yAt(ax - rx * hwd, az - rz * hwd, ta), az - rz * hwd, 0, 1, 0, c[0], c[1], c[2]);
              const v1 = mark.v(bx - rx * hwd, yAt(bx - rx * hwd, bz - rz * hwd, tb), bz - rz * hwd, 0, 1, 0, c[0], c[1], c[2]);
              const v2 = mark.v(bx + rx * hwd, yAt(bx + rx * hwd, bz + rz * hwd, tb), bz + rz * hwd, 0, 1, 0, c[0], c[1], c[2]);
              const v3 = mark.v(ax + rx * hwd, yAt(ax + rx * hwd, az + rz * hwd, ta), az + rz * hwd, 0, 1, 0, c[0], c[1], c[2]);
              mark.quadFacing(v0, v1, v2, v3, 0, 1, 0);
            }
          };
          const yellow: [number, number, number] = [0.85, 0.62, 0.08];
          const white: [number, number, number] = [0.82, 0.82, 0.8];
          const div = -travel / 2 + e.lb * LANE_W;
          if (e.lf > 0 && e.lb > 0) {
            if (L >= 2 && e.cls !== 'residential') { strip(div - 0.12, 0.1, yellow, false); strip(div + 0.12, 0.1, yellow, false); }
            else strip(div, 0.12, yellow, true);
          }
          for (let k = 1; k < e.lf; k++) strip(div + k * LANE_W, 0.12, white, true);
          for (let k = 1; k < e.lb; k++) strip(div - k * LANE_W, 0.12, white, true);
          if (e.cls === 'primary' || e.cls === 'secondary' || e.cls === 'trunk' || e.cls === 'motorway' || e.cls === 'link') {
            strip(-travel / 2 - 0.1, 0.12, e.lb === 0 && e.cls !== 'motorway' ? white : e.lb === 0 ? yellow : white, false);
            strip(travel / 2 + 0.1, 0.12, white, false);
          }
        }
      }
      // bridge deck sides, railings, piers
      if (e.bridge) {
        const yi = e.h[i] + ROAD_LIFT, yj = e.h[j] + ROAD_LIFT;
        const conc = hexToRgb('#9c978d');
        for (const sgn of [-1, 1]) {
          const ax = xi + ri[0] * hw * sgn, az = zi + ri[1] * hw * sgn, bx = xj + rj[0] * hw * sgn, bz = zj + rj[1] * hw * sgn;
          const nx = ri[0] * sgn, nz = ri[1] * sgn;
          // outer deck face
          const a0 = struct.v(ax, yi - 1.2, az, nx, 0, nz, conc[0], conc[1], conc[2]);
          const a1 = struct.v(bx, yj - 1.2, bz, nx, 0, nz, conc[0], conc[1], conc[2]);
          const a2 = struct.v(bx, yj + 1.0, bz, nx, 0, nz, conc[0], conc[1], conc[2]);
          const a3 = struct.v(ax, yi + 1.0, az, nx, 0, nz, conc[0], conc[1], conc[2]);
          struct.quadFacing(a0, a1, a2, a3, nx, 0, nz);
          // inner railing face
          const b0 = struct.v(ax, yi, az, -nx, 0, -nz, conc[0], conc[1], conc[2]);
          const b1 = struct.v(bx, yj, bz, -nx, 0, -nz, conc[0], conc[1], conc[2]);
          const b2 = struct.v(bx, yj + 1.0, bz, -nx, 0, -nz, conc[0], conc[1], conc[2]);
          const b3 = struct.v(ax, yi + 1.0, az, -nx, 0, -nz, conc[0], conc[1], conc[2]);
          struct.quadFacing(b0, b1, b2, b3, -nx, 0, -nz);
          const c0 = staticCol.v(ax, yi - 0.2, az, 0, 0, 0), c1 = staticCol.v(bx, yj - 0.2, bz, 0, 0, 0), c2 = staticCol.v(bx, yj + 1.1, bz, 0, 0, 0), c3 = staticCol.v(ax, yi + 1.1, az, 0, 0, 0);
          staticCol.quadFacing(c0, c1, c2, c3, -nx, 0, -nz);
        }
        // underside
        const u: number[] = [];
        for (const [x, z, y] of [[xi - ri[0] * hw, zi - ri[1] * hw, yi], [xj - rj[0] * hw, zj - rj[1] * hw, yj], [xj + rj[0] * hw, zj + rj[1] * hw, yj], [xi + ri[0] * hw, zi + ri[1] * hw, yi]] as const)
          u.push(struct.v(x, y - 1.2, z, 0, -1, 0, conc[0] * 0.7, conc[1] * 0.7, conc[2] * 0.7));
        struct.quadFacing(u[0], u[1], u[2], u[3], 0, -1, 0);
        // pillars every ~24 m where the deck is high enough
        if (Math.floor(sj / 24) !== Math.floor(si / 24)) {
          const gy = this.hf.sample(xj, zj);
          if (yj - gy > 3) struct.box(xj, (yj - 1.2 + gy - 1) / 2, zj, 0.8, (yj - 1.2 - gy + 1) / 2, 0.8, 0, conc[0], conc[1], conc[2]);
        }
      }
      // tunnel interior
      if (e.tunnel) {
        const yi = e.h[i] + ROAD_LIFT, yj = e.h[j] + ROAD_LIFT;
        const ti = this.hf.sample(xi, zi), tj = this.hf.sample(xj, zj);
        const boredI = ti - yi >= 10, boredJ = tj - yj >= 10;
        const tile = hexToRgb('#c8c2b0');
        const H = 6;
        const hw2 = hw + 0.6;
        for (const sgn of [-1, 1]) {
          const ax = xi + ri[0] * hw2 * sgn, az = zi + ri[1] * hw2 * sgn, bx = xj + rj[0] * hw2 * sgn, bz = zj + rj[1] * hw2 * sgn;
          const topI = boredI ? yi + H : Math.max(ti, yi + 1.2) + 0.3, topJ = boredJ ? yj + H : Math.max(tj, yj + 1.2) + 0.3;
          const nx = -ri[0] * sgn, nz = -ri[1] * sgn;
          const w0 = struct.v(ax, yi - 0.2, az, nx, 0, nz, tile[0], tile[1], tile[2]);
          const w1 = struct.v(bx, yj - 0.2, bz, nx, 0, nz, tile[0], tile[1], tile[2]);
          const w2 = struct.v(bx, topJ, bz, nx, 0, nz, tile[0], tile[1], tile[2]);
          const w3 = struct.v(ax, topI, az, nx, 0, nz, tile[0], tile[1], tile[2]);
          struct.quadFacing(w0, w1, w2, w3, nx, 0, nz);
          const c0 = staticCol.v(ax, yi - 0.2, az, 0, 0, 0), c1 = staticCol.v(bx, yj - 0.2, bz, 0, 0, 0), c2 = staticCol.v(bx, yj + H, bz, 0, 0, 0), c3 = staticCol.v(ax, yi + H, az, 0, 0, 0);
          staticCol.quadFacing(c0, c1, c2, c3, nx, 0, nz);
        }
        if (boredI || boredJ) {
          const dark = hexToRgb('#4a4842');
          const c: number[] = [];
          for (const [x, z, y] of [[xi - ri[0] * hw2, zi - ri[1] * hw2, yi + H], [xj - rj[0] * hw2, zj - rj[1] * hw2, yj + H], [xj + rj[0] * hw2, zj + rj[1] * hw2, yj + H], [xi + ri[0] * hw2, zi + ri[1] * hw2, yi + H]] as const)
            c.push(struct.v(x, y, z, 0, -1, 0, dark[0], dark[1], dark[2]));
          struct.quadFacing(c[0], c[1], c[2], c[3], 0, -1, 0);
          // light strip
          const l: number[] = [];
          for (const [x, z, y] of [[xi - ri[0] * 0.25, zi - ri[1] * 0.25, yi + H - 0.05], [xj - rj[0] * 0.25, zj - rj[1] * 0.25, yj + H - 0.05], [xj + rj[0] * 0.25, zj + rj[1] * 0.25, yj + H - 0.05], [xi + ri[0] * 0.25, zi + ri[1] * 0.25, yi + H - 0.05]] as const)
            l.push(tlights.v(x, y, z, 0, -1, 0));
          tlights.quadFacing(l[0], l[1], l[2], l[3], 0, -1, 0);
          // portal facade where bored meets open cut
          if (boredI !== boredJ) {
            const [px, pz, py, pt] = boredI ? [xj, zj, yj, tj] : [xi, zi, yi, ti];
            const rr = boredI ? rj : ri;
            const fn = boredI ? 1 : -1;
            const dx = (xj - xi) * fn, dz = (zj - zi) * fn, dl = Math.hypot(dx, dz) || 1;
            const conc = hexToRgb('#a8a294');
            const f: number[] = [];
            for (const [x, z, y] of [[px - rr[0] * (hw2 + 2), pz - rr[1] * (hw2 + 2), py + H], [px + rr[0] * (hw2 + 2), pz + rr[1] * (hw2 + 2), py + H], [px + rr[0] * (hw2 + 2), pz + rr[1] * (hw2 + 2), Math.max(pt + 2, py + H + 2)], [px - rr[0] * (hw2 + 2), pz - rr[1] * (hw2 + 2), Math.max(pt + 2, py + H + 2)]] as const)
              f.push(struct.v(x, y, z, dx / dl, 0, dz / dl, conc[0], conc[1], conc[2]));
            struct.quadFacing(f[0], f[1], f[2], f[3], dx / dl, 0, dz / dl);
          }
        }
        zones.push(xi, zi, xj, zj, hw + 1.5, Math.min(yi, yj) - 2, Math.max(yi, yj) + H + 1);
      }
    }
    void nodeA; void nodeB;
  }

  private buildNode(n: number, roads: MeshBuilder, mark: MeshBuilder, roadCol: MeshBuilder, signals: number[], stopSigns: number[]) {
    const deg = this.net.degree(n);
    if (deg < 2) return;
    const node = this.d.nodes[n];
    const r = this.nodeRadius[n];
    const elevated = this.net.adj[n].some((eid) => this.d.edges[eid].bridge || this.d.edges[eid].tunnel);
    const yAt = (x: number, z: number) => (elevated ? node.y + ROAD_LIFT - 0.004 : Math.max(this.groundAt(x, z), node.y - 0.3) + ROAD_LIFT - 0.004);
    const SEG = 14;
    const c = roads.v(node.x, yAt(node.x, node.z), node.z, 0, 1, 0);
    const cc = roadCol.v(node.x, yAt(node.x, node.z), node.z, 0, 1, 0);
    const ring: number[] = [], cring: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = node.x + Math.cos(a) * r, z = node.z + Math.sin(a) * r;
      ring.push(roads.v(x, yAt(x, z), z, 0, 1, 0));
      cring.push(roadCol.v(x, yAt(x, z), z, 0, 1, 0));
    }
    for (let k = 0; k < SEG; k++) {
      roads.triFacing(c, ring[k], ring[(k + 1) % SEG], 0, 1, 0);
      roadCol.triFacing(cc, cring[k], cring[(k + 1) % SEG], 0, 1, 0);
    }
    if (deg < 3 && !node.sig && !node.stop) return;
    // per-approach furniture: crosswalks, stop lines, signals, stop signs
    const white: [number, number, number] = [0.82, 0.82, 0.8];
    const urban = this.opts.urban;
    for (const eid of this.net.adj[n]) {
      const e = this.d.edges[eid];
      if (e.cls === 'service' || e.tunnel) continue;
      const fromA = e.a === n;
      const len = this.net.edgeLen[eid];
      if (len < r + 8) continue;
      const pt = this.net.pointAt(eid, fromA ? r + 1.8 : len - r - 1.8);
      // direction pointing away from the node
      const dirH = fromA ? pt.heading : pt.heading + Math.PI;
      const dx = Math.sin(dirH), dz = -Math.cos(dirH);
      const rx = -dz, rz = dx; // right of "away" direction
      const travel = (e.lf + e.lb) * LANE_W;
      const half = Math.min(e.w / 2, travel / 2 + 1);
      const y = (x: number, z: number) => yAt(x, z) + 0.03;
      const quad = (cx: number, cz: number, along: number, acrossW: number, col: [number, number, number]) => {
        const ax = dx * along / 2, az = dz * along / 2, bx = rx * acrossW / 2, bz = rz * acrossW / 2;
        const v0 = mark.v(cx - ax - bx, y(cx - ax - bx, cz - az - bz), cz - az - bz, 0, 1, 0, col[0], col[1], col[2]);
        const v1 = mark.v(cx + ax - bx, y(cx + ax - bx, cz + az - bz), cz + az - bz, 0, 1, 0, col[0], col[1], col[2]);
        const v2 = mark.v(cx + ax + bx, y(cx + ax + bx, cz + az + bz), cz + az + bz, 0, 1, 0, col[0], col[1], col[2]);
        const v3 = mark.v(cx - ax + bx, y(cx - ax + bx, cz - az + bz), cz - az + bz, 0, 1, 0, col[0], col[1], col[2]);
        mark.quadFacing(v0, v1, v2, v3, 0, 1, 0);
      };
      if (urban && (node.sig || (deg >= 3 && e.cls !== 'residential'))) {
        // zebra crosswalk
        for (let o = -half + 0.4; o < half - 0.2; o += 1.1) quad(pt.x + rx * o + dx * 1.5, pt.z + rz * o + dz * 1.5, 3.0, 0.55, white);
      }
      // approach lanes travel toward the node: they are the lanes on the right of the "toward node" direction
      const approaching = fromA ? e.lb > 0 : e.lf > 0;
      if (!approaching) continue;
      const div = -travel / 2 + e.lb * LANE_W;
      // toward-node right == away-left: lanes from div to the far side
      const inLanes = fromA ? e.lb : e.lf;
      const off0 = fromA ? div - inLanes * LANE_W : div; // offsets relative to a->b right
      const off1 = fromA ? div : div + inLanes * LANE_W;
      // convert a->b right offsets to "away" right: away dir == a->b dir when fromA
      const sgn = fromA ? 1 : -1;
      const so0 = off0 * sgn, so1 = off1 * sgn;
      const mid = (so0 + so1) / 2, wid = Math.abs(so1 - so0);
      const slx = pt.x + dx * 4.2 + rx * mid, slz = pt.z + dz * 4.2 + rz * mid;
      if (node.sig || node.stop || deg >= 3) quad(slx, slz, 0.45, wid, white);
      // curb-side position for poles: outside edge of the approach lanes
      const curbOff = (Math.abs(so0) > Math.abs(so1) ? so0 : so1) + Math.sign(Math.abs(so0) > Math.abs(so1) ? so0 : so1) * 1.4;
      const px = pt.x + dx * 4.5 + rx * curbOff, pz = pt.z + dz * 4.5 + rz * curbOff;
      // traffic faces the approach: yaw so the head looks along "away" direction
      const yaw = Math.atan2(dx, dz);
      if (node.sig) signals.push(px, yAt(px, pz), pz, yaw, n, eid);
      else if (node.stop || (deg >= 3 && (e.cls === 'residential' || e.cls === 'tertiary'))) stopSigns.push(px, yAt(px, pz), pz, yaw);
    }
  }

  // ---------------------------------------------------------------- props
  private placeEdgeProps(e: RoadEdge, idxs: number[], lights: number[], parked: number[], trees: number[]) {
    if (e.tunnel) return;
    const cum = this.net.cum[e.id];
    const len = this.net.edgeLen[e.id];
    const urban = this.opts.urban;
    const travel = (e.lf + e.lb) * LANE_W;
    const hasParking = urban && !e.bridge && e.cls !== 'motorway' && e.cls !== 'link' && e.cls !== 'trunk' && e.cls !== 'service' && e.w - travel > 3;
    const lit = e.cls !== 'service' && (urban || e.cls === 'primary' || e.cls === 'trunk');
    const tmp = { x: 0, y: 0, z: 0, heading: 0 };
    for (const i of idxs) {
      const s0 = cum[i], s1 = cum[i + 1];
      // streetlights every 34 m, alternating sides
      if (lit) {
        for (let k = Math.ceil(s0 / 17); k * 17 < s1; k++) {
          const s = k * 17;
          if (s < 10 || s > len - 10) continue;
          const side = k % 2 === 0 ? 1 : -1;
          if (k % 2 === 1 && e.w < 14 && e.cls !== 'primary') continue;
          this.net.pointAt(e.id, s, tmp);
          const rx = Math.cos(tmp.heading), rz = Math.sin(tmp.heading);
          const off = e.bridge ? e.w / 2 - 0.3 : e.w / 2 + 0.7;
          const x = tmp.x + rx * off * side, z = tmp.z + rz * off * side;
          if (this.insideBuilding(x, z, 0.3)) continue;
          const y = e.bridge ? tmp.y + ROAD_LIFT : this.groundAt(x, z) + (urban ? CURB_H : 0);
          lights.push(x, y, z, tmp.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
        }
      }
      // parked cars
      if (hasParking) {
        for (let k = Math.ceil(s0 / 6.4); k * 6.4 < s1; k++) {
          const s = k * 6.4;
          if (s < 14 || s > len - 14) continue;
          for (const side of [1, -1]) {
            const hsh = hash01(e.id * 7919 + k * 31 + (side > 0 ? 7 : 0));
            if (hsh > 0.5) continue;
            this.net.pointAt(e.id, s, tmp);
            const rx = Math.cos(tmp.heading), rz = Math.sin(tmp.heading);
            const off = travel / 2 + (e.w / 2 - travel / 2) / 2;
            const x = tmp.x + rx * off * side, z = tmp.z + rz * off * side;
            if (this.insideBuilding(x, z, 1.2)) continue;
            const y = this.groundAt(x, z) + ROAD_LIFT;
            const ahead = this.net.pointAt(e.id, Math.min(len, s + 2));
            const behind = this.net.pointAt(e.id, Math.max(0, s - 2));
            const pitch = Math.atan2(ahead.y - behind.y, 4);
            // US: park with the flow on each side (right side faces a->b)
            const heading = side > 0 ? tmp.heading : tmp.heading + Math.PI;
            parked.push(x, y, z, heading, side > 0 ? pitch : -pitch, Math.floor(hash01(k * 13 + e.id) * 100), Math.floor(hsh * 997) % 12);
          }
        }
      }
      // palms along boulevards
      if (this.opts.palms && (e.cls === 'primary' || e.cls === 'secondary' || e.cls === 'trunk') && !e.bridge) {
        for (let k = Math.ceil(s0 / 21); k * 21 < s1; k++) {
          const s = k * 21 + 9;
          if (s < 12 || s > len - 12) continue;
          this.net.pointAt(e.id, s, tmp);
          const rx = Math.cos(tmp.heading), rz = Math.sin(tmp.heading);
          for (const side of [1, -1]) {
            const x = tmp.x + rx * (e.w / 2 + 1.4) * side, z = tmp.z + rz * (e.w / 2 + 1.4) * side;
            if (this.insideBuilding(x, z, 0.8)) continue;
            trees.push(x, this.groundAt(x, z) + CURB_H, z, 0.9 + hash01(k * 3 + side) * 0.35, hash01(k) * 6.28, 2);
          }
        }
      }
    }
  }

  private placeTrees(x0: number, z0: number, x1: number, z1: number, out: number[]) {
    const density = this.opts.treeDensity;
    const t = this.d.trees;
    const coastal = this.opts.biome === 'coastal';
    for (let i = 0; i < t.length; i += 2) {
      const x = t[i], z = t[i + 1];
      if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
      if (hash01(i) > density) continue;
      if (this.roadClearance(x, z, 10) < 0.6 || this.insideBuilding(x, z)) continue;
      out.push(x, this.groundAt(x, z), z, 0.8 + hash01(i * 3) * 0.5, hash01(i * 7) * 6.28, coastal && this.opts.palms && hash01(i * 11) < 0.3 ? 2 : 0);
    }
    const rand = rng(Math.floor(x0 * 13 + z0 * 7) >>> 0);
    const waterY = this.d.waterY;
    if (this.opts.biome === 'alpine') {
      const step = 11 / Math.sqrt(Math.max(0.2, density));
      const n = { x: 0, y: 1, z: 0 };
      for (let x = x0; x < x1; x += step) {
        for (let z = z0; z < z1; z += step) {
          const px = x + (rand() - 0.5) * step, pz = z + (rand() - 0.5) * step;
          const cluster = Math.sin(px * 0.013) * Math.cos(pz * 0.011) + Math.sin(px * 0.031 + pz * 0.027) * 0.5;
          if (cluster < -0.35 || rand() > 0.85) continue;
          const y = this.hf.sample(px, pz);
          if (waterY !== null && y < waterY + 1) continue;
          this.hf.normal(px, pz, n);
          if (n.y < 0.8) continue;
          if (this.roadClearance(px, pz, 14) < 3.5) continue;
          if (this.insideBuilding(px, pz, 2)) continue;
          out.push(px, y, pz, 0.8 + rand() * 0.9, rand() * 6.28, 1);
        }
      }
    } else {
      // park trees
      const step = 13 / Math.sqrt(Math.max(0.2, density));
      for (let x = x0; x < x1; x += step) {
        for (let z = z0; z < z1; z += step) {
          const px = x + (rand() - 0.5) * step, pz = z + (rand() - 0.5) * step;
          if (!this.inPark(px, pz) || rand() > 0.6) continue;
          if (this.roadClearance(px, pz, 12) < 2 || this.insideBuilding(px, pz, 1)) continue;
          const y = this.hf.sample(px, pz);
          if (waterY !== null && y < waterY + 0.8) continue;
          out.push(px, y, pz, 0.8 + rand() * 0.6, rand() * 6.28, this.opts.palms && rand() < 0.35 ? 2 : 0);
        }
      }
    }
  }

  // ---------------------------------------------------------------- buildings
  private facadeType(b: Building, bi: number, victorian: boolean): number {
    if (victorian) return hash01(bi * 31) < 0.6 ? FACADE.SIDING : FACADE.STUCCO;
    if (b.h > 28) return hash01(bi * 17) < 0.6 ? FACADE.CONCRETE + FACADE.CURTAIN : FACADE.CONCRETE;
    const mix = this.opts.facadeMix ?? [0.3, 0.4, 0.3, 0];
    const tot = mix[0] + mix[1] + mix[2] + mix[3];
    let r = hash01(bi * 13) * tot;
    for (let i = 0; i < 4; i++) { r -= mix[i]; if (r <= 0) return i; }
    return FACADE.STUCCO;
  }

  /** Street-facing edge index (closest to a road) or -1. */
  private streetEdge(p: number[], minLen = 3.5): { k: number; dist: number } {
    const n = p.length / 2;
    let best = -1, bd = 1e9;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
      if (Math.hypot(bx - ax, bz - az) < minLen) continue;
      const d = this.roadClearance((ax + bx) / 2, (az + bz) / 2, 20);
      if (d < bd) { bd = d; best = k; }
    }
    return { k: best, dist: bd };
  }

  private buildBuilding(b: Building, bi: number, walls: MeshBuilder, roofs: MeshBuilder, staticCol: MeshBuilder, neon: MeshBuilder) {
    const p = b.p;
    const n = p.length / 2;
    const area = Math.abs(polyArea(p));
    const victorian = this.opts.style === 'sf' && b.h <= 17 && area < 480 && b.m === undefined;
    const col = victorian ? hexToRgb(PASTELS[Math.floor(hash01(bi * 5) * PASTELS.length)]) : this.palette[b.c % this.palette.length];
    const tint = 0.85 + hash01(bi * 2654435761) * 0.3;
    const r = col[0] * tint, g = col[1] * tint, bl = col[2] * tint;
    const yb = b.b - 1.5;
    const ym = b.m !== undefined ? b.b + b.m : yb;
    const yt = b.b + b.h;
    const seed = Math.floor(hash01(bi) * 900) * 37;
    walls.exValue = this.facadeType(b, bi, victorian);
    let u = seed;
    const colTop = Math.min(yt, b.b + 16);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const nx = dz / l, nz = -dx / l;
      const v0 = walls.v(ax, ym, az, nx, 0, nz, r, g, bl, u, ym - b.b);
      const v1 = walls.v(bx, ym, bz, nx, 0, nz, r, g, bl, u + l, ym - b.b);
      const v2 = walls.v(bx, yt, bz, nx, 0, nz, r, g, bl, u + l, yt - b.b);
      const v3 = walls.v(ax, yt, az, nx, 0, nz, r, g, bl, u, yt - b.b);
      walls.quadFacing(v0, v1, v2, v3, nx, 0, nz);
      if (b.m === undefined || b.m < 4) {
        const c0 = staticCol.v(ax, yb, az, 0, 0, 0), c1 = staticCol.v(bx, yb, bz, 0, 0, 0), c2 = staticCol.v(bx, colTop, bz, 0, 0, 0), c3 = staticCol.v(ax, colTop, az, 0, 0, 0);
        staticCol.quadFacing(c0, c1, c2, c3, nx, 0, nz);
      }
      u += l;
    }
    const street = (victorian || (this.opts.neon ?? 0) > 0) && b.m === undefined ? this.streetEdge(p) : { k: -1, dist: 1e9 };
    // San Francisco Victorian/Edwardian kit: bay window on the street face + cornice
    if (victorian) {
      const trim = hexToRgb(hash01(bi * 9) < 0.5 ? '#f2efe7' : '#dcd6c8');
      if (street.k >= 0 && street.dist < 14 && b.h > 7.5) {
        const k = street.k, k2 = (k + 1) % n;
        const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
        const l = Math.hypot(bx - ax, bz - az);
        const ex = (bx - ax) / l, ez = (bz - az) / l;
        const nx = ez, nz = -ex;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const bw = Math.min(l * 0.55, 3.8), out = 0.8;
        const y0 = b.b + 3.4, y1 = yt - 0.9;
        if (y1 - y0 > 2.2) {
          // back corners on the wall, front corners pushed out
          const pts: [number, number][] = [
            [mx - ex * bw / 2, mz - ez * bw / 2],
            [mx - ex * bw * 0.3 + nx * out, mz - ez * bw * 0.3 + nz * out],
            [mx + ex * bw * 0.3 + nx * out, mz + ez * bw * 0.3 + nz * out],
            [mx + ex * bw / 2, mz + ez * bw / 2],
          ];
          let bu = seed + 5000;
          for (let s2 = 0; s2 < 3; s2++) {
            const [qx, qz] = pts[s2], [rx, rz] = pts[s2 + 1];
            const fl = Math.hypot(rx - qx, rz - qz);
            const fnx = (rz - qz) / fl, fnz = -(rx - qx) / fl;
            // ensure outward (away from building)
            const sgn = fnx * nx + fnz * nz < 0 ? -1 : 1;
            const a0 = walls.v(qx, y0, qz, fnx * sgn, 0, fnz * sgn, r, g, bl, bu, y0 - b.b);
            const a1 = walls.v(rx, y0, rz, fnx * sgn, 0, fnz * sgn, r, g, bl, bu + fl, y0 - b.b);
            const a2 = walls.v(rx, y1, rz, fnx * sgn, 0, fnz * sgn, r, g, bl, bu + fl, y1 - b.b);
            const a3 = walls.v(qx, y1, qz, fnx * sgn, 0, fnz * sgn, r, g, bl, bu, y1 - b.b);
            walls.quadFacing(a0, a1, a2, a3, fnx * sgn, 0, fnz * sgn);
            bu += fl;
          }
          // bay roof and underside in trim colour
          for (const [yy, ny] of [[y1, 1], [y0, -1]] as const) {
            const ids = pts.map(([x, z]) => roofs.v(x, yy, z, 0, ny, 0, trim[0], trim[1], trim[2]));
            roofs.triFacing(ids[0], ids[1], ids[2], 0, ny, 0);
            roofs.triFacing(ids[0], ids[2], ids[3], 0, ny, 0);
          }
        }
      }
      // cornice band around the top
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
        const l = Math.hypot(bx - ax, bz - az);
        if (l < 0.3) continue;
        const nx = (bz - az) / l, nz = -(bx - ax) / l;
        const o = 0.32;
        const c0 = roofs.v(ax + nx * o, yt - 0.5, az + nz * o, nx, 0, nz, trim[0], trim[1], trim[2]);
        const c1 = roofs.v(bx + nx * o, yt - 0.5, bz + nz * o, nx, 0, nz, trim[0], trim[1], trim[2]);
        const c2 = roofs.v(bx + nx * o, yt + 0.15, bz + nz * o, nx, 0, nz, trim[0], trim[1], trim[2]);
        const c3 = roofs.v(ax + nx * o, yt + 0.15, az + nz * o, nx, 0, nz, trim[0], trim[1], trim[2]);
        roofs.quadFacing(c0, c1, c2, c3, nx, 0, nz);
        const d0 = roofs.v(ax, yt - 0.5, az, 0, -1, 0, trim[0] * 0.7, trim[1] * 0.7, trim[2] * 0.7);
        const d1 = roofs.v(bx, yt - 0.5, bz, 0, -1, 0, trim[0] * 0.7, trim[1] * 0.7, trim[2] * 0.7);
        const d2 = roofs.v(bx + nx * o, yt - 0.5, bz + nz * o, 0, -1, 0, trim[0] * 0.7, trim[1] * 0.7, trim[2] * 0.7);
        const d3 = roofs.v(ax + nx * o, yt - 0.5, az + nz * o, 0, -1, 0, trim[0] * 0.7, trim[1] * 0.7, trim[2] * 0.7);
        roofs.quadFacing(d0, d1, d2, d3, 0, -1, 0);
        const e0 = roofs.v(ax, yt + 0.15, az, 0, 1, 0, trim[0], trim[1], trim[2]);
        const e1 = roofs.v(bx, yt + 0.15, bz, 0, 1, 0, trim[0], trim[1], trim[2]);
        const e2 = roofs.v(bx + nx * o, yt + 0.15, bz + nz * o, 0, 1, 0, trim[0], trim[1], trim[2]);
        const e3 = roofs.v(ax + nx * o, yt + 0.15, az + nz * o, 0, 1, 0, trim[0], trim[1], trim[2]);
        roofs.quadFacing(e0, e1, e2, e3, 0, 1, 0);
      }
    }
    // neon signage on street-facing ground floors
    if (street.k >= 0 && street.dist < 10 && b.h > 5 && hash01(bi * 101) < (this.opts.neon ?? 0)) {
      const k = street.k, k2 = (k + 1) % n;
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const ex = (bx - ax) / l, ez = (bz - az) / l, nx = ez, nz = -ex;
      const c = hexToRgb(NEON[Math.floor(hash01(bi * 7) * NEON.length)]);
      const t = hash01(bi * 11);
      if (t < 0.5) {
        // horizontal sign band above the storefront
        const w = Math.min(l * 0.6, 7), cx = (ax + bx) / 2 + nx * 0.06, cz = (az + bz) / 2 + nz * 0.06;
        const y0 = b.b + 3.7, y1 = b.b + 4.25;
        const a = neon.v(cx - ex * w / 2, y0, cz - ez * w / 2, nx, 0, nz, c[0], c[1], c[2]);
        const bb = neon.v(cx + ex * w / 2, y0, cz + ez * w / 2, nx, 0, nz, c[0], c[1], c[2]);
        const cc = neon.v(cx + ex * w / 2, y1, cz + ez * w / 2, nx, 0, nz, c[0], c[1], c[2]);
        const d = neon.v(cx - ex * w / 2, y1, cz - ez * w / 2, nx, 0, nz, c[0], c[1], c[2]);
        neon.quadFacing(a, bb, cc, d, nx, 0, nz);
      } else {
        // vertical blade sign sticking out from the corner
        const px = ax + ex * Math.min(1.2, l * 0.2) + nx * 0.55, pz = az + ez * Math.min(1.2, l * 0.2) + nz * 0.55;
        neon.box(px, b.b + 4.6 + t * 1.5, pz, 0.06, 1.1, 0.42, Math.atan2(nx, nz), c[0], c[1], c[2]);
      }
    }
    if (b.m !== undefined && b.m > 0.5) {
      // underside of floating parts
      this.cap(p, ym, roofs, -1, r * 0.5, g * 0.5, bl * 0.5);
    }
    const roofShade = 0.55 + hash01(bi * 7) * 0.2;
    if (b.r === 2 && n <= 12 && area < 600 && !victorian) {
      // hipped roof to the centroid
      let cx = 0, cz = 0;
      for (let k = 0; k < n; k++) { cx += p[k * 2]; cz += p[k * 2 + 1]; }
      cx /= n; cz /= n;
      const rise = Math.min(4, Math.sqrt(area) * 0.28);
      const rc = hexToRgb(hash01(bi * 3) > 0.5 ? '#6d4c3d' : '#5a5f66');
      const apex = roofs.v(cx, yt + rise, cz, 0, 1, 0, rc[0], rc[1], rc[2]);
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k2 * 2], bz = p[k2 * 2 + 1];
        const ex = bx - ax, ez = bz - az;
        const nx0 = ez, nz0 = -ex;
        const nl = Math.hypot(nx0, rise * 2, nz0) || 1;
        const nx = nx0 / nl, ny = Math.hypot(ex, ez) / nl, nz = nz0 / nl;
        const a = roofs.v(ax, yt, az, nx, ny, nz, rc[0], rc[1], rc[2]);
        const bb = roofs.v(bx, yt, bz, nx, ny, nz, rc[0], rc[1], rc[2]);
        roofs.triFacing(a, bb, apex, nx, Math.max(0.2, ny), nz);
      }
    } else {
      this.cap(p, yt, roofs, 1, r * roofShade, g * roofShade, bl * roofShade);
      // rooftop equipment on large flat roofs
      if (b.h > 12 && area > 250) {
        const rand = rng(bi * 977);
        let cx = 0, cz = 0;
        for (let k = 0; k < n; k++) { cx += p[k * 2]; cz += p[k * 2 + 1]; }
        cx /= n; cz /= n;
        const units = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < units; k++) {
          const ox = cx + (rand() - 0.5) * 6, oz = cz + (rand() - 0.5) * 6;
          if (!pointInPoly(ox, oz, p)) continue;
          const s = 0.6 + rand();
          roofs.box(ox, yt + s * 0.6, oz, s * 1.4, s * 0.6, s, rand() * 3, 0.45, 0.45, 0.46);
        }
      }
    }
  }

  // ---------------------------------------------------------------- road decals: manholes and asphalt patches
  private buildDecals(e: RoadEdge, idxs: number[], mb: MeshBuilder) {
    if (e.tunnel || e.bridge || e.cls === 'service' || !this.opts.urban) return;
    const p = e.p;
    for (const i of idxs) {
      const h = hash01(e.id * 7919 + i * 104729);
      if (h > 0.2) continue;
      const j = i + 1;
      const t = 0.3 + hash01(i * 31 + e.id) * 0.4;
      const x = p[i * 2] + (p[j * 2] - p[i * 2]) * t, z = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t;
      const dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1];
      const dl = Math.hypot(dx, dz) || 1;
      const rx = -dz / dl, rz = dx / dl;
      const travel = (e.lf + e.lb) * LANE_W;
      const off = (hash01(e.id + i * 3) - 0.5) * travel * 0.8;
      const cx = x + rx * off, cz = z + rz * off;
      const y = this.surfaceY(e, i, cx, cz) + 0.012;
      if (h < 0.09) {
        // manhole cover with a lighter rim
        const SEG = 12;
        const c = mb.v(cx, y, cz, 0, 1, 0, 0.05, 0.05, 0.05);
        const ring: number[] = [];
        for (let k = 0; k < SEG; k++) {
          const a = (k / SEG) * Math.PI * 2;
          const rim = k % 2 === 0 ? 0.09 : 0.075;
          ring.push(mb.v(cx + Math.cos(a) * 0.38, y, cz + Math.sin(a) * 0.38, 0, 1, 0, rim, rim, rim));
        }
        for (let k = 0; k < SEG; k++) mb.triFacing(c, ring[k], ring[(k + 1) % SEG], 0, 1, 0);
      } else {
        // asphalt patch: darker, slightly rotated rectangle
        const L = 1.6 + hash01(i * 7) * 2.4, W = 1.0 + hash01(i * 3) * 1.6;
        const ang = (hash01(i * 13) - 0.5) * 0.3;
        const fx = (dx / dl) * Math.cos(ang) - rx * Math.sin(ang), fz = (dz / dl) * Math.cos(ang) - rz * Math.sin(ang);
        const sx = -fz, sz = fx;
        const shade = 0.035 + hash01(i * 17) * 0.025;
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => mb.v(cx + fx * a * L / 2 + sx * b * W / 2, y, cz + fz * a * L / 2 + sz * b * W / 2, 0, 1, 0, shade, shade, shade * 1.05));
        mb.quadFacing(q[0], q[1], q[2], q[3], 0, 1, 0);
      }
    }
  }

  private cap(p: number[], y: number, mb: MeshBuilder, ny: number, r: number, g: number, b: number) {
    const contour: Vector2[] = [];
    for (let k = 0; k < p.length; k += 2) contour.push(new Vector2(p[k], p[k + 1]));
    let tris: number[][];
    try {
      tris = ShapeUtils.triangulateShape(contour, []);
    } catch {
      return;
    }
    const base = mb.count;
    for (const v of contour) mb.v(v.x, y, v.y, 0, ny, 0, r, g, b);
    for (const t of tris) mb.triFacing(base + t[0], base + t[1], base + t[2], 0, ny, 0);
  }

  private buildPier(poly: number[], mb: MeshBuilder, roadCol: MeshBuilder) {
    const wy = this.d.waterY ?? 0;
    const top = wy + 2.2;
    const c = hexToRgb('#8f8778');
    this.cap(poly, top, mb, 1, c[0], c[1], c[2]);
    const contour: Vector2[] = [];
    for (let k = 0; k < poly.length; k += 2) contour.push(new Vector2(poly[k], poly[k + 1]));
    try {
      const tris = ShapeUtils.triangulateShape(contour, []);
      const base = roadCol.count;
      for (const v of contour) roadCol.v(v.x, top, v.y, 0, 1, 0);
      for (const t of tris) roadCol.triFacing(base + t[0], base + t[1], base + t[2], 0, 1, 0);
    } catch { /* skip */ }
    const n = poly.length / 2;
    const ccw = polyArea(poly) > 0 ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = poly[k * 2], az = poly[k * 2 + 1], bx = poly[k2 * 2], bz = poly[k2 * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const nx = ((bz - az) / l) * ccw, nz = (-(bx - ax) / l) * ccw;
      const v0 = mb.v(ax, wy - 2, az, nx, 0, nz, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6);
      const v1 = mb.v(bx, wy - 2, bz, nx, 0, nz, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6);
      const v2 = mb.v(bx, top, bz, nx, 0, nz, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
      const v3 = mb.v(ax, top, az, nx, 0, nz, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
      mb.quadFacing(v0, v1, v2, v3, nx, 0, nz);
    }
  }
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  let a = m.get(k);
  if (!a) m.set(k, (a = []));
  a.push(v);
}
