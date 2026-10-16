import type { DistrictData, RoadEdge, RoadNode } from './types.ts';
import { distPointSeg } from './geom.ts';

export interface RoadHit {
  edge: RoadEdge;
  seg: number;
  t: number;
  x: number;
  z: number;
  y: number;
  dist: number;
  /** Heading along the edge a->b (radians, 0 = -z/north, positive clockwise toward +x). */
  heading: number;
  /** Distance along the edge from a. */
  s: number;
}

const GRID = 40;

/** Graph view over district roads with spatial queries and routing. */
export class RoadNetwork {
  readonly nodes: RoadNode[];
  readonly edges: RoadEdge[];
  /** Edge ids incident to each node. */
  readonly adj: number[][];
  readonly edgeLen: Float32Array;
  readonly cum: Float32Array[];
  private grid = new Map<number, number[]>();

  constructor(d: Pick<DistrictData, 'nodes' | 'edges'>) {
    this.nodes = d.nodes;
    this.edges = d.edges;
    this.adj = d.nodes.map(() => []);
    this.edgeLen = new Float32Array(d.edges.length);
    this.cum = [];
    for (const e of d.edges) {
      this.adj[e.a].push(e.id);
      if (e.b !== e.a) this.adj[e.b].push(e.id);
      const c = new Float32Array(e.p.length / 2);
      for (let i = 1; i < c.length; i++) c[i] = c[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]);
      this.cum[e.id] = c;
      this.edgeLen[e.id] = c[c.length - 1];
      for (let i = 0; i < c.length - 1; i++) {
        const ax = e.p[i * 2], az = e.p[i * 2 + 1], bx = e.p[i * 2 + 2], bz = e.p[i * 2 + 3];
        const pad = e.w / 2 + 2;
        const gx0 = Math.floor((Math.min(ax, bx) - pad) / GRID), gx1 = Math.floor((Math.max(ax, bx) + pad) / GRID);
        const gz0 = Math.floor((Math.min(az, bz) - pad) / GRID), gz1 = Math.floor((Math.max(az, bz) + pad) / GRID);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const k = key(gx, gz);
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(e.id * 4096 + i);
        }
      }
    }
  }

  degree(n: number) {
    return this.adj[n].length;
  }

  /** Nearest road centerline point within maxDist (meters). */
  nearest(x: number, z: number, maxDist = 60, filter?: (e: RoadEdge) => boolean): RoadHit | null {
    let best: RoadHit | null = null;
    const r = Math.ceil(maxDist / GRID);
    const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
    const seen = new Set<number>();
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const arr = this.grid.get(key(gx + dx, gz + dz));
      if (!arr) continue;
      for (const code of arr) {
        if (seen.has(code)) continue;
        seen.add(code);
        const eid = Math.floor(code / 4096), i = code % 4096;
        const e = this.edges[eid];
        if (filter && !filter(e)) continue;
        const ax = e.p[i * 2], az = e.p[i * 2 + 1], bx = e.p[i * 2 + 2], bz = e.p[i * 2 + 3];
        const h = distPointSeg(x, z, ax, az, bx, bz);
        if (h.d < maxDist && (!best || h.d < best.dist)) {
          const y = e.h[i] + (e.h[i + 1] - e.h[i]) * h.t;
          const s = this.cum[eid][i] + h.t * (this.cum[eid][i + 1] - this.cum[eid][i]);
          best = { edge: e, seg: i, t: h.t, x: h.x, z: h.z, y, dist: h.d, heading: Math.atan2(bx - ax, -(bz - az)), s };
        }
      }
    }
    return best;
  }

  /** Point at distance s along edge (clamped). */
  pointAt(eid: number, s: number, out = { x: 0, y: 0, z: 0, heading: 0 }) {
    const e = this.edges[eid];
    const c = this.cum[eid];
    s = Math.max(0, Math.min(c[c.length - 1], s));
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid; else hi = mid;
    }
    const L = c[hi] - c[lo] || 1;
    const t = (s - c[lo]) / L;
    const ax = e.p[lo * 2], az = e.p[lo * 2 + 1], bx = e.p[hi * 2], bz = e.p[hi * 2 + 1];
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    out.y = e.h[lo] + (e.h[hi] - e.h[lo]) * t;
    out.heading = Math.atan2(bx - ax, -(bz - az));
    return out;
  }

  other(eid: number, n: number) {
    const e = this.edges[eid];
    return e.a === n ? e.b : e.a;
  }

  /** Can a car travel along eid starting from node n? */
  canTravel(eid: number, fromNode: number) {
    const e = this.edges[eid];
    return e.a === fromNode ? e.lf > 0 : e.lb > 0;
  }

  /** A* over nodes respecting one-way streets. Returns node sequence and edge sequence. */
  route(from: number, to: number, respectOneway = true): { nodes: number[]; edges: number[] } | null {
    if (from === to) return { nodes: [from], edges: [] };
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const cameEdge = new Int32Array(N).fill(-1);
    const open: number[] = [from];
    const f = new Float64Array(N).fill(Infinity);
    const inOpen = new Uint8Array(N);
    g[from] = 0;
    const tn = this.nodes[to];
    const hfn = (n: number) => Math.hypot(this.nodes[n].x - tn.x, this.nodes[n].z - tn.z);
    f[from] = hfn(from);
    inOpen[from] = 1;
    let iter = 0;
    while (open.length && iter++ < 200000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open.splice(bi, 1);
      inOpen[cur] = 0;
      if (cur === to) {
        const nodes = [to], edges: number[] = [];
        let c = to;
        while (came[c] !== -1) { edges.push(cameEdge[c]); c = came[c]; nodes.push(c); }
        return { nodes: nodes.reverse(), edges: edges.reverse() };
      }
      for (const eid of this.adj[cur]) {
        if (respectOneway && !this.canTravel(eid, cur)) continue;
        const nb = this.other(eid, cur);
        const ng = g[cur] + this.edgeLen[eid];
        if (ng < g[nb]) {
          g[nb] = ng; came[nb] = cur; cameEdge[nb] = eid; f[nb] = ng + hfn(nb);
          if (!inOpen[nb]) { open.push(nb); inOpen[nb] = 1; }
        }
      }
    }
    return null;
  }

  nearestNode(x: number, z: number, minDegree = 1): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.adj[i].length < minDegree) continue;
      const d = Math.hypot(this.nodes[i].x - x, this.nodes[i].z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Connected components (undirected). Returns component id per node. */
  components(): Int32Array {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    let id = 0;
    for (let s = 0; s < this.nodes.length; s++) {
      if (comp[s] !== -1) continue;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const n = stack.pop()!;
        for (const e of this.adj[n]) {
          const o = this.other(e, n);
          if (comp[o] === -1) { comp[o] = id; stack.push(o); }
        }
      }
      id++;
    }
    return comp;
  }

  /** Flattened polyline (x,y,z triples) following a route of edges from a start node. */
  routePolyline(startNode: number, edges: number[]): number[] {
    const out: number[] = [];
    let n = startNode;
    for (const eid of edges) {
      const e = this.edges[eid];
      const fwd = e.a === n;
      const cnt = e.p.length / 2;
      for (let k = 0; k < cnt; k++) {
        const i = fwd ? k : cnt - 1 - k;
        if (out.length && k === 0) continue;
        out.push(e.p[i * 2], e.h[i], e.p[i * 2 + 1]);
      }
      n = fwd ? e.b : e.a;
    }
    return out;
  }
}

function key(x: number, z: number) {
  return (x + 32768) * 65536 + (z + 32768);
}
