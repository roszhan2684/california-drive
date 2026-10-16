// Ambient pedestrians: walk the sidewalk band of urban streets, round block corners,
// cross at junctions when allowed, and step out of the player's way. Pure logic (no three.js).
import type { RoadEdge } from '../world/types.ts';
import type { RoadNetwork } from '../world/roadGraph.ts';
import { CURB_H, ROAD_LIFT, SIDEWALK_W } from '../world/chunkGen.ts';
import type { PlayerState } from './traffic.ts';

export type PedMode = 'walk' | 'move' | 'wait' | 'idle';

export interface Pedestrian {
  id: number;
  edge: number;
  /** Walking direction along the edge: 1 = a->b, -1 = b->a. */
  dir: 1 | -1;
  /** Side of the road relative to a->b: 1 = right, -1 = left. */
  side: 1 | -1;
  /** Distance along a->b. */
  s: number;
  /** Lateral distance from the road centreline (inside the sidewalk band). */
  off: number;
  speed: number;
  mode: PedMode;
  /** Remaining time in wait/idle, or progress in a move. */
  timer: number;
  move: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; len: number; t: number; edge: number; dir: 1 | -1; side: 1 | -1; s: number } | null;
  /** Seconds left of a startled dodge. */
  dodge: number;
  dodgeDir: number;
  /** Gait phase (radians) for the view. */
  phase: number;
  x: number; y: number; z: number; heading: number;
  /** Current visual speed (m/s) for the gait. */
  gait: number;
  look: { shirt: number; pants: number; skin: number; height: number; bulk: number };
}

export interface PedOptions {
  cap: number;
  spawnMin: number;
  spawnMax: number;
  despawn: number;
  /** May a pedestrian at `node` arriving along `edge` cross now? (signals / traffic). */
  canCross?: (node: number, edge: number) => boolean;
  isVisible?: (x: number, y: number, z: number) => boolean;
}

const STRIDE = 1.45;

export function sidewalkEdge(e: RoadEdge): boolean {
  return !e.tunnel && !e.bridge && e.cls !== 'motorway' && e.cls !== 'link' && e.cls !== 'service' && e.cls !== 'trunk';
}

export class PedestrianSystem {
  readonly net: RoadNetwork;
  readonly peds: Pedestrian[] = [];
  readonly opts: PedOptions;
  private nodeR: Float32Array;
  private nextId = 1;
  private rand: () => number;
  private spawnTimer = 0;
  readonly stats = { spawned: 0, despawned: 0, crossings: 0, dodges: 0 };

  constructor(net: RoadNetwork, opts: PedOptions, seed = 1) {
    this.net = net;
    this.opts = opts;
    this.nodeR = new Float32Array(net.nodes.length);
    for (const e of net.edges) {
      this.nodeR[e.a] = Math.max(this.nodeR[e.a], e.w / 2);
      this.nodeR[e.b] = Math.max(this.nodeR[e.b], e.w / 2);
    }
    let s = seed >>> 0;
    this.rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  setCap(cap: number) {
    this.opts.cap = cap;
    while (this.peds.length > cap) this.despawn(this.peds[this.peds.length - 1]);
  }

  /** Clearance (along the edge) from a junction node, matching where sidewalks are trimmed. */
  private clearance(n: number) {
    return this.net.degree(n) >= 3 ? this.nodeR[n] + 2.5 : 0.5;
  }

  /** Usable [s0, s1] of an edge's sidewalk. */
  private range(eid: number): [number, number] {
    const e = this.net.edges[eid];
    const L = this.net.edgeLen[eid];
    return [Math.min(L / 2, this.clearance(e.a)), Math.max(L / 2, L - this.clearance(e.b))];
  }

  private bandLimits(eid: number): [number, number] {
    const hw = this.net.edges[eid].w / 2;
    return [hw + 0.35, hw + SIDEWALK_W - 0.3];
  }

  /** World position for an edge coordinate. */
  point(eid: number, s: number, side: 1 | -1, off: number, out = { x: 0, y: 0, z: 0, heading: 0 }) {
    const p = this.net.pointAt(eid, s, out);
    const h = p.heading;
    // right of a->b is (cos h, sin h)
    out.x = p.x + Math.cos(h) * off * side;
    out.z = p.z + Math.sin(h) * off * side;
    out.y = p.y + ROAD_LIFT + CURB_H;
    return out;
  }

  update(dt: number, player: PlayerState | null) {
    const px = player?.x ?? 0, pz = player?.z ?? 0;
    for (const p of [...this.peds]) if (Math.hypot(p.x - px, p.z - pz) > this.opts.despawn) this.despawn(p);
    this.spawnTimer -= dt;
    if (this.peds.length < this.opts.cap && this.spawnTimer <= 0) {
      this.spawnTimer = this.peds.length < this.opts.cap * 0.5 ? 0 : 0.25;
      for (let k = 0; k < 3 && this.peds.length < this.opts.cap; k++) this.trySpawn(px, pz);
    }
    for (const p of this.peds) this.step(p, dt, player);
  }

  private trySpawn(px: number, pz: number) {
    const o = this.opts;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rand() * Math.PI * 2;
      const r = o.spawnMin + this.rand() * (o.spawnMax - o.spawnMin);
      const hit = this.net.nearest(px + Math.cos(a) * r, pz + Math.sin(a) * r, 30, sidewalkEdge);
      if (!hit) continue;
      const eid = hit.edge.id;
      const [s0, s1] = this.range(eid);
      if (s1 - s0 < 4) continue;
      const s = s0 + this.rand() * (s1 - s0);
      const side: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
      const [b0, b1] = this.bandLimits(eid);
      const off = b0 + this.rand() * (b1 - b0);
      const q = this.point(eid, s, side, off);
      const d = Math.hypot(q.x - px, q.z - pz);
      if (d < o.spawnMin || d > o.spawnMax) continue;
      if (o.isVisible && d < o.spawnMax * 0.55 && o.isVisible(q.x, q.y + 1, q.z)) continue;
      this.spawn(eid, s, side, off, this.rand() < 0.5 ? 1 : -1);
      return;
    }
  }

  spawn(edge: number, s: number, side: 1 | -1, off: number, dir: 1 | -1): Pedestrian {
    const r = this.rand;
    const idle = r() < 0.12;
    const p: Pedestrian = {
      id: this.nextId++, edge, dir, side, s, off,
      speed: 1.05 + r() * 0.55,
      mode: idle ? 'idle' : 'walk', timer: idle ? 4 + r() * 12 : 0, move: null, dodge: 0, dodgeDir: 0,
      phase: r() * Math.PI * 2, x: 0, y: 0, z: 0, heading: 0, gait: 0,
      look: { shirt: Math.floor(r() * 64), pants: Math.floor(r() * 64), skin: Math.floor(r() * 64), height: 0.92 + r() * 0.16, bulk: 0.9 + r() * 0.22 },
    };
    this.place(p);
    this.peds.push(p);
    this.stats.spawned++;
    return p;
  }

  despawn(p: Pedestrian) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    this.stats.despawned++;
  }

  clear() {
    this.peds.length = 0;
  }

  private place(p: Pedestrian) {
    if (p.mode === 'move' && p.move) {
      const m = p.move;
      const u = Math.min(1, m.t / m.len);
      p.x = m.x0 + (m.x1 - m.x0) * u;
      p.y = m.y0 + (m.y1 - m.y0) * u;
      p.z = m.z0 + (m.z1 - m.z0) * u;
      p.heading = Math.atan2(m.x1 - m.x0, -(m.z1 - m.z0));
      return;
    }
    const q = this.point(p.edge, p.s, p.side, p.off);
    p.x = q.x; p.y = q.y; p.z = q.z;
    p.heading = p.dir > 0 ? q.heading : q.heading + Math.PI;
  }

  private step(p: Pedestrian, dt: number, player: PlayerState | null) {
    let v = 0;
    // dodge an approaching player car
    if (player) {
      const dx = p.x - player.x, dz = p.z - player.z;
      const d = Math.hypot(dx, dz);
      const pv = Math.hypot(player.vx, player.vz);
      if (d < 7 && pv > 2 && (dx * player.vx + dz * player.vz) / (d * pv + 1e-6) > 0.35 && p.dodge <= 0) {
        p.dodge = 1.4;
        // sideways, away from the car's path: perpendicular offset of us from its line of travel
        const along = (dx * player.vx + dz * player.vz) / (pv * pv);
        const wx = dx - player.vx * along, wz = dz - player.vz * along;
        const h = this.net.pointAt(p.edge, p.s).heading;
        const outward = (wx * Math.cos(h) + wz * Math.sin(h)) * p.side;
        p.dodgeDir = outward >= 0 ? 1 : -1;
        this.stats.dodges++;
      }
    }
    if (p.dodge > 0) {
      p.dodge -= dt;
      v = 3.2;
      if (p.mode === 'walk' || p.mode === 'idle' || p.mode === 'wait') {
        // dodge toward the building line or the curb, whichever is away from the car
        const [b0, b1] = this.bandLimits(p.edge);
        const toward = p.dodgeDir > 0 ? b1 : b0;
        const k = Math.min(1, dt * 3);
        p.off += (toward - p.off) * k;
      } else if (p.move) {
        p.move.t += v * dt;
      }
      if (p.mode === 'move' && p.move && p.move.t >= p.move.len) this.finishMove(p);
    } else if (p.mode === 'idle') {
      p.timer -= dt;
      if (p.timer <= 0) p.mode = 'walk';
    } else if (p.mode === 'wait') {
      p.timer -= dt;
      const node = p.dir > 0 ? this.net.edges[p.edge].b : this.net.edges[p.edge].a;
      if (p.move && (this.opts.canCross?.(node, p.edge) ?? true)) { p.mode = 'move'; this.stats.crossings++; }
      else if (p.timer <= 0) { p.move = null; this.turnCorner(p) || this.turnAround(p); }
    } else if (p.mode === 'move' && p.move) {
      v = p.speed * 1.15;
      p.move.t += v * dt;
      if (p.move.t >= p.move.len) this.finishMove(p);
    } else {
      v = p.speed;
      p.s += p.dir * v * dt;
      const [s0, s1] = this.range(p.edge);
      if ((p.dir > 0 && p.s >= s1) || (p.dir < 0 && p.s <= s0)) {
        p.s = Math.max(s0, Math.min(s1, p.s));
        this.atJunction(p);
      } else if (this.rand() < dt * 0.006) {
        p.mode = 'idle';
        p.timer = 2 + this.rand() * 6;
      }
    }
    p.gait += ((p.mode === 'walk' || p.mode === 'move' || p.dodge > 0 ? v : 0) - p.gait) * Math.min(1, dt * 6);
    p.phase = (p.phase + (p.gait * dt * Math.PI * 2) / STRIDE) % (Math.PI * 2);
    this.place(p);
  }

  private finishMove(p: Pedestrian) {
    const m = p.move!;
    p.edge = m.edge; p.dir = m.dir; p.side = m.side; p.s = m.s;
    p.move = null;
    p.mode = 'walk';
  }

  /** Candidate sidewalks leaving the node we are walking toward, with signed turn angles. */
  private exits(p: Pedestrian) {
    const e = this.net.edges[p.edge];
    const node = p.dir > 0 ? e.b : e.a;
    const L = this.net.edgeLen[p.edge];
    const hin = this.net.pointAt(p.edge, p.dir > 0 ? L : 0).heading + (p.dir > 0 ? 0 : Math.PI);
    const out: { edge: number; dir: 1 | -1; d: number }[] = [];
    for (const eid of this.net.adj[node]) {
      if (eid === p.edge) continue;
      const e2 = this.net.edges[eid];
      if (!sidewalkEdge(e2)) continue;
      const dir: 1 | -1 = e2.a === node ? 1 : -1;
      const L2 = this.net.edgeLen[eid];
      const hout = this.net.pointAt(eid, dir > 0 ? Math.min(L2, 3) : Math.max(0, L2 - 3)).heading + (dir > 0 ? 0 : Math.PI);
      let d = hout - hin;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      out.push({ edge: eid, dir, d });
    }
    return { node, out };
  }

  private startMove(p: Pedestrian, edge: number, dir: 1 | -1, sideRel: 1 | -1) {
    const side = (sideRel * dir) as 1 | -1;
    const [s0, s1] = this.range(edge);
    const s = dir > 0 ? s0 : s1;
    const [b0, b1] = this.bandLimits(edge);
    const off = Math.max(b0, Math.min(b1, p.off - this.net.edges[p.edge].w / 2 + this.net.edges[edge].w / 2));
    const a = this.point(p.edge, p.s, p.side, p.off);
    const b = this.point(edge, s, side, off);
    p.off = off;
    p.move = { x0: a.x, y0: a.y, z0: a.z, x1: b.x, y1: b.y, z1: b.z, len: Math.max(0.3, Math.hypot(b.x - a.x, b.z - a.z)), t: 0, edge, dir, side, s };
  }

  private turnCorner(p: Pedestrian): boolean {
    const { out } = this.exits(p);
    const sideRel = (p.side * p.dir) as 1 | -1; // 1 = buildings on our right
    // the corner on the building side: most clockwise exit when the block is on our right
    let best: { edge: number; dir: 1 | -1; d: number } | null = null;
    for (const c of out) {
      if (Math.abs(c.d) > 2.7) continue;
      if (!best || (sideRel > 0 ? c.d > best.d : c.d < best.d)) best = c;
    }
    if (!best || (sideRel > 0 ? best.d < 0.35 : best.d > -0.35)) return false;
    this.startMove(p, best.edge, best.dir, sideRel);
    p.mode = 'move';
    return true;
  }

  private turnAround(p: Pedestrian): boolean {
    p.dir = (-p.dir) as 1 | -1;
    p.mode = 'walk';
    return true;
  }

  private atJunction(p: Pedestrian) {
    const { out } = this.exits(p);
    const sideRel = (p.side * p.dir) as 1 | -1;
    const straight = out.reduce<{ edge: number; dir: 1 | -1; d: number } | null>((b, c) => (Math.abs(c.d) < 0.6 && (!b || Math.abs(c.d) < Math.abs(b.d)) ? c : b), null);
    if (straight && this.rand() < 0.45) {
      // cross the side street at the crosswalk, waiting for a safe moment
      this.startMove(p, straight.edge, straight.dir, sideRel);
      p.mode = 'wait';
      p.timer = 25;
      return;
    }
    if (this.turnCorner(p)) return;
    if (straight) {
      this.startMove(p, straight.edge, straight.dir, sideRel);
      p.mode = 'wait';
      p.timer = 25;
      return;
    }
    this.turnAround(p);
  }
}
