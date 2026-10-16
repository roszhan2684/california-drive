// Adaptive traffic around the player: lane following, signals, stop/yield, IDM car following,
// spawn/despawn bubble, deadlock recovery. Pure simulation; physics bodies are optional.

import type { RoadNetwork } from '../world/roadGraph.ts';
import { SignalSystem } from './signals.ts';
import { LANE_W, ROAD_LIFT } from '../world/chunkGen.ts';
import { RAPIER, G, groups, type PhysicsWorld } from '../physics/world.ts';

export interface Vec3 { x: number; y: number; z: number }

interface Turn {
  node: number;
  p0: Vec3; p1: Vec3; p2: Vec3; p3: Vec3;
  len: number;
  t: number;
  next: { edge: number; dir: 1 | -1; lane: number };
  vMax: number;
}

export interface Agent {
  id: number;
  edge: number;
  dir: 1 | -1;
  lane: number;
  s: number;
  v: number;
  vDesired: number;
  len: number;
  width: number;
  variant: number;
  color: number;
  turn: Turn | null;
  next: { edge: number; dir: 1 | -1; lane: number } | null;
  stuck: number;
  startled: number;
  braking: boolean;
  reserved: number;
  waitingRed: boolean;
  x: number; y: number; z: number; heading: number; pitch: number;
  body: RAPIER.RigidBody | null;
  /** Turn indicator for the upcoming/current junction: -1 left, 0 off, 1 right. */
  signal: -1 | 0 | 1;
  /** Accumulated wheel rotation (rad) and front-wheel steer angle (rad), for the view. */
  wheelRot: number;
  steer: number;
}

export interface TrafficOptions {
  cap: number;
  spawnMin: number;
  spawnMax: number;
  despawn: number;
  speedFactor: number;
  /** Per-variant size and relative spawn weight (default 1; 0 never spawns). */
  variantDims: { length: number; width: number; height?: number; weight?: number }[];
  /** Return true when a world point is visible to the player (avoid pop-in). */
  isVisible?: (x: number, y: number, z: number) => boolean;
}

export interface PlayerState { x: number; y: number; z: number; vx: number; vz: number; heading: number }

const IDM = { a: 1.8, b: 2.6, s0: 2.2, T: 1.25, bMax: 9 };

export class TrafficSystem {
  readonly net: RoadNetwork;
  readonly signals: SignalSystem;
  readonly agents: Agent[] = [];
  opts: TrafficOptions;
  private nextId = 1;
  private physics: PhysicsWorld | null;
  private nodeR: Float32Array;
  private reservation = new Map<number, { id: number; since: number }>();
  private spawnEdges: number[];
  private time = 0;
  private rand: () => number;
  stats = { spawned: 0, despawned: 0, deadlockRecoveries: 0, redRunViolations: 0 };

  constructor(net: RoadNetwork, opts: TrafficOptions, physics: PhysicsWorld | null = null, seed = 1) {
    this.net = net;
    this.opts = opts;
    this.physics = physics;
    this.signals = new SignalSystem(net);
    this.nodeR = new Float32Array(net.nodes.length);
    for (const e of net.edges) {
      this.nodeR[e.a] = Math.max(this.nodeR[e.a], e.w / 2);
      this.nodeR[e.b] = Math.max(this.nodeR[e.b], e.w / 2);
    }
    this.spawnEdges = net.edges.filter((e) => !e.tunnel && e.cls !== 'service' && net.edgeLen[e.id] > 40).map((e) => e.id);
    let s = seed >>> 0;
    this.rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------ geometry
  private lanes(eid: number, dir: 1 | -1) {
    const e = this.net.edges[eid];
    return dir > 0 ? e.lf : e.lb;
  }

  private laneOffset(eid: number, dir: 1 | -1, lane: number) {
    const e = this.net.edges[eid];
    const travel = (e.lf + e.lb) * LANE_W;
    const div = -travel / 2 + e.lb * LANE_W;
    return dir > 0 ? div + (lane + 0.5) * LANE_W : -div + (lane + 0.5) * LANE_W;
  }

  private startS(eid: number, dir: 1 | -1) {
    const e = this.net.edges[eid];
    const n = dir > 0 ? e.a : e.b;
    return this.net.degree(n) >= 2 ? Math.min(this.nodeR[n] + 1.5, this.net.edgeLen[eid] * 0.3) : 0;
  }

  private endS(eid: number, dir: 1 | -1) {
    const e = this.net.edges[eid];
    const n = dir > 0 ? e.b : e.a;
    const L = this.net.edgeLen[eid];
    return this.net.degree(n) >= 2 ? L - Math.min(this.nodeR[n] + 1.5, L * 0.3) : L;
  }

  endNode(a: Agent) {
    const e = this.net.edges[a.edge];
    return a.dir > 0 ? e.b : e.a;
  }

  /** World position/heading for a lane coordinate. */
  lanePoint(eid: number, dir: 1 | -1, lane: number, s: number, out: Vec3 & { heading: number }) {
    const L = this.net.edgeLen[eid];
    const p = this.net.pointAt(eid, dir > 0 ? s : L - s);
    const h = dir > 0 ? p.heading : p.heading + Math.PI;
    const off = this.laneOffset(eid, dir, lane);
    out.x = p.x + Math.cos(h) * off;
    out.z = p.z + Math.sin(h) * off;
    out.y = p.y + ROAD_LIFT;
    out.heading = h;
    return out;
  }

  // ------------------------------------------------------------ routing
  private chooseNext(a: Agent): { edge: number; dir: 1 | -1; lane: number } | null {
    const node = this.endNode(a);
    const inHeading = this.lanePoint(a.edge, a.dir, a.lane, this.endS(a.edge, a.dir), { x: 0, y: 0, z: 0, heading: 0 }).heading;
    const cands: { edge: number; dir: 1 | -1; w: number }[] = [];
    const cur = this.net.edges[a.edge];
    for (const eid of this.net.adj[node]) {
      if (eid === a.edge) continue;
      const e = this.net.edges[eid];
      if (e.tunnel && !cur.tunnel && e.cls === 'service') continue;
      const dir: 1 | -1 = e.a === node ? 1 : -1;
      if (this.lanes(eid, dir) === 0) continue;
      if (e.cls === 'service' && cur.cls !== 'service') continue;
      const out = this.lanePoint(eid, dir, 0, this.startS(eid, dir) + 2, { x: 0, y: 0, z: 0, heading: 0 }).heading;
      let d = out - inHeading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 2.6) continue; // no sharp reversals
      const w = Math.abs(d) < 0.4 ? 3 : d > 0 ? 1.4 : 1;
      cands.push({ edge: eid, dir, w });
    }
    if (!cands.length) {
      // dead end: U-turn when the road is two-way
      const back: 1 | -1 = a.dir > 0 ? -1 : 1;
      if (this.lanes(a.edge, back) > 0) return { edge: a.edge, dir: back, lane: 0 };
      return null;
    }
    let total = 0;
    for (const c of cands) total += c.w;
    let r = this.rand() * total;
    for (const c of cands) {
      r -= c.w;
      if (r <= 0) return { edge: c.edge, dir: c.dir, lane: Math.min(a.lane, this.lanes(c.edge, c.dir) - 1) };
    }
    const c = cands[cands.length - 1];
    return { edge: c.edge, dir: c.dir, lane: Math.min(a.lane, this.lanes(c.edge, c.dir) - 1) };
  }

  private makeTurn(a: Agent, nx: { edge: number; dir: 1 | -1; lane: number }): Turn {
    const q0 = this.lanePoint(a.edge, a.dir, a.lane, this.endS(a.edge, a.dir), { x: 0, y: 0, z: 0, heading: 0 });
    const q3 = this.lanePoint(nx.edge, nx.dir, nx.lane, this.startS(nx.edge, nx.dir), { x: 0, y: 0, z: 0, heading: 0 });
    const d = Math.hypot(q3.x - q0.x, q3.z - q0.z);
    const hl = Math.max(1, d * 0.42);
    const t0 = { x: Math.sin(q0.heading), z: -Math.cos(q0.heading) };
    const t1 = { x: Math.sin(q3.heading), z: -Math.cos(q3.heading) };
    // headings from lanePoint use the road convention (dir = (sin h, -cos h))
    const p1 = { x: q0.x + t0.x * hl, y: q0.y, z: q0.z + t0.z * hl };
    const p2 = { x: q3.x - t1.x * hl, y: q3.y, z: q3.z - t1.z * hl };
    let len = 0;
    let prev = { x: q0.x, z: q0.z };
    for (let i = 1; i <= 12; i++) {
      const p = bez(q0, p1, p2, q3, i / 12);
      len += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    let ang = q3.heading - q0.heading;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    const R = Math.abs(ang) > 0.15 ? len / Math.abs(ang) : 1e3;
    const vMax = Math.max(3.5, Math.min(25, Math.sqrt(2.6 * R)));
    return { node: this.endNode(a), p0: { x: q0.x, y: q0.y, z: q0.z }, p1, p2, p3: { x: q3.x, y: q3.y, z: q3.z }, len: Math.max(0.5, len), t: 0, next: nx, vMax };
  }

  // ------------------------------------------------------------ spawn
  /** Weighted variant choice from one uniform sample (keeps the RNG stream identical to an unweighted pick). */
  pickVariant(u: number): number {
    const dims = this.opts.variantDims;
    let total = 0;
    for (const d of dims) total += d.weight ?? 1;
    if (total <= 0) return 0;
    let x = u * total;
    for (let i = 0; i < dims.length; i++) {
      x -= dims[i].weight ?? 1;
      if (x < 0) return i;
    }
    return dims.length - 1;
  }

  spawnAt(edge: number, dir: 1 | -1, lane: number, s: number): Agent | null {
    const variant = this.pickVariant(this.rand());
    const dims = this.opts.variantDims[variant];
    const e = this.net.edges[edge];
    const a: Agent = {
      id: this.nextId++, edge, dir, lane, s, v: e.v * 0.6, vDesired: e.v * this.opts.speedFactor * (0.85 + this.rand() * 0.25),
      len: dims.length, width: dims.width, variant, color: Math.floor(this.rand() * 12), turn: null, next: null, stuck: 0, startled: 0,
      braking: false, reserved: -1, waitingRed: false, x: 0, y: 0, z: 0, heading: 0, pitch: 0, body: null,
      signal: 0, wheelRot: 0, steer: 0,
    };
    this.place(a);
    if (this.physics) {
      const pw = this.physics;
      const b = pw.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(a.x, a.y, a.z));
      const c = pw.world.createCollider(RAPIER.ColliderDesc.cuboid(dims.width / 2 - 0.05, Math.max(0.7, (dims.height ?? 1.5) * 0.45), dims.length / 2 - 0.1).setTranslation(0, Math.max(0.75, (dims.height ?? 1.5) * 0.5), 0).setCollisionGroups(groups(G.TRAFFIC, G.CHASSIS | G.TRAFFIC | G.RAY)), b);
      pw.setSurface(c, 'vehicle');
      a.body = b;
    }
    this.agents.push(a);
    this.stats.spawned++;
    return a;
  }

  private trySpawn(px: number, pz: number) {
    const o = this.opts;
    for (let attempt = 0; attempt < 12; attempt++) {
      const eid = this.spawnEdges[Math.floor(this.rand() * this.spawnEdges.length)];
      if (eid === undefined) return;
      const e = this.net.edges[eid];
      const s0 = this.rand() * this.net.edgeLen[eid];
      const p = this.net.pointAt(eid, s0);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < o.spawnMin || d > o.spawnMax) continue;
      if (o.isVisible && d < o.spawnMax * 0.6 && o.isVisible(p.x, p.y + 1, p.z)) continue;
      const dirs: (1 | -1)[] = [];
      if (e.lf > 0) dirs.push(1);
      if (e.lb > 0) dirs.push(-1);
      if (!dirs.length) continue;
      const dir = dirs[Math.floor(this.rand() * dirs.length)];
      const lane = Math.floor(this.rand() * this.lanes(eid, dir));
      const L = this.net.edgeLen[eid];
      const s = dir > 0 ? s0 : L - s0;
      if (s < this.startS(eid, dir) + 3 || s > this.endS(eid, dir) - 8) continue;
      // keep clear of other agents
      let clear = true;
      for (const b of this.agents) if (Math.hypot(b.x - p.x, b.z - p.z) < 18) { clear = false; break; }
      if (!clear) continue;
      this.spawnAt(eid, dir, lane, s);
      return;
    }
  }

  despawn(a: Agent) {
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
    if (a.reserved >= 0) this.release(a.reserved, a.id);
    if (a.body && this.physics) this.physics.world.removeRigidBody(a.body);
    a.body = null;
    this.stats.despawned++;
  }

  clear() {
    for (const a of [...this.agents]) this.despawn(a);
  }

  private release(node: number, id: number) {
    const r = this.reservation.get(node);
    if (r && r.id === id) this.reservation.delete(node);
  }

  private place(a: Agent) {
    const tmp = { x: 0, y: 0, z: 0, heading: 0 };
    if (a.turn) {
      const u = Math.min(1, a.turn.t / a.turn.len);
      const p = bez(a.turn.p0, a.turn.p1, a.turn.p2, a.turn.p3, u);
      const q = bez(a.turn.p0, a.turn.p1, a.turn.p2, a.turn.p3, Math.min(1, u + 0.05));
      a.x = p.x; a.z = p.z; a.y = a.turn.p0.y + (a.turn.p3.y - a.turn.p0.y) * u;
      if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-3) a.heading = Math.atan2(q.x - p.x, -(q.z - p.z));
      a.pitch = 0;
    } else {
      this.lanePoint(a.edge, a.dir, a.lane, a.s, tmp);
      a.x = tmp.x; a.y = tmp.y; a.z = tmp.z; a.heading = tmp.heading;
      const ahead = this.lanePoint(a.edge, a.dir, a.lane, Math.min(this.net.edgeLen[a.edge], a.s + 2), { x: 0, y: 0, z: 0, heading: 0 });
      const behind = this.lanePoint(a.edge, a.dir, a.lane, Math.max(0, a.s - 2), { x: 0, y: 0, z: 0, heading: 0 });
      a.pitch = Math.atan2(ahead.y - behind.y, 4);
    }
  }

  // ------------------------------------------------------------ update
  update(dt: number, player: PlayerState | null) {
    this.time += dt;
    this.signals.update(dt);
    const px = player?.x ?? 0, pz = player?.z ?? 0;
    // despawn far / stuck
    for (const a of [...this.agents]) {
      const d = Math.hypot(a.x - px, a.z - pz);
      if (player && d > this.opts.despawn) { this.despawn(a); continue; }
      if (a.stuck > 25 && !a.waitingRed) {
        if (!this.opts.isVisible || !this.opts.isVisible(a.x, a.y + 1, a.z) || a.stuck > 60) { this.stats.deadlockRecoveries++; this.despawn(a); }
      }
    }
    // stale reservations (deadlock safety)
    for (const [n, r] of this.reservation) if (this.time - r.since > 10) { this.reservation.delete(n); this.stats.deadlockRecoveries++; }
    if (player) {
      let spawns = 0;
      while (this.agents.length < this.opts.cap && spawns < 2) { this.trySpawn(px, pz); spawns++; }
    }
    for (const a of this.agents) this.step(a, dt, player);
  }

  private leaderGap(a: Agent, player: PlayerState | null): { gap: number; v: number } {
    const fx = Math.sin(a.heading), fz = -Math.cos(a.heading);
    let best = { gap: Infinity, v: 0 };
    const test = (x: number, z: number, len: number, vAlong: number) => {
      const dx = x - a.x, dz = z - a.z;
      const lon = dx * fx + dz * fz;
      if (lon <= 0 || lon > 55) return;
      const lat = Math.abs(dx * fz - dz * fx);
      const allow = 1.5 + lon * 0.02;
      if (lat > allow) return;
      const gap = lon - (a.len + len) / 2;
      if (gap < best.gap) best = { gap, v: vAlong };
    };
    for (const b of this.agents) {
      if (b === a) continue;
      const bv = b.v * Math.cos(b.heading - a.heading);
      test(b.x, b.z, b.len, bv);
    }
    if (player) {
      const pv = player.vx * fx + player.vz * fz;
      test(player.x, player.z, 4.5, pv);
    }
    return best;
  }

  private idm(v: number, v0: number, gap: number, vLead: number) {
    const dv = v - vLead;
    const sStar = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
    const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
    const inter = gap < Infinity ? Math.pow(sStar / Math.max(0.1, gap), 2) : 0;
    return Math.max(-IDM.bMax, IDM.a * (free - inter));
  }

  private step(a: Agent, dt: number, player: PlayerState | null) {
    if (player) {
      const pd = Math.hypot(player.x - a.x, player.z - a.z);
      const pv = Math.hypot(player.vx, player.vz);
      if (pd < 3.2 && pv > 2.5) a.startled = 3;
    }
    a.startled = Math.max(0, a.startled - dt);
    let v0 = a.vDesired;
    const lead = this.leaderGap(a, player);
    let gap = lead.gap, vLead = lead.v;
    a.waitingRed = false;
    if (!a.turn) {
      const endS = this.endS(a.edge, a.dir);
      const toEnd = endS - a.s;
      if (!a.next && toEnd < 60) {
        a.next = this.chooseNext(a);
        a.signal = a.next ? this.turnSignal(a, a.next) : 0;
      }
      const node = this.endNode(a);
      // signal / junction control at the stop line
      let mustStop = false;
      const light = this.signals.internal(this.net, a.edge) ? null : this.signals.state(node, a.edge);
      if (light !== null) {
        if (light === 2) mustStop = true;
        if (light === 1 && toEnd > (a.v * a.v) / (2 * 3.5) + 1) mustStop = true;
        if (mustStop) a.waitingRed = true;
      } else if (this.net.degree(node) >= 3 && !this.signals.cluster.has(node)) {
        const r = this.reservation.get(node);
        if (r && r.id !== a.id) mustStop = true;
        if (this.net.nodes[node].stop && toEnd < 6 && a.v > 1 && a.reserved !== node) mustStop = true;
      }
      if (!a.next) mustStop = true;
      if (mustStop && toEnd < gap) { gap = Math.max(0.01, toEnd - 1.2); vLead = 0; }
      // slow for the upcoming turn
      if (a.next && toEnd < 40) {
        const tv = this.makeTurnSpeed(a);
        if (tv < a.v) v0 = Math.min(v0, tv + toEnd * 0.25);
      }
      let acc = this.idm(a.v, v0, gap, vLead);
      if (a.startled > 0) acc = -IDM.bMax;
      a.braking = acc < -0.6;
      a.v = Math.max(0, a.v + acc * dt);
      a.s += a.v * dt;
      if (a.s >= endS) {
        const redHold = light === 2 || (light === 1 && a.waitingRed);
        if (!a.next || (mustStop && (a.v < 0.5 || redHold))) {
          a.s = endS;
          a.v = 0;
        } else {
          // entering the junction
          if (light === 2 && a.v > 2) this.stats.redRunViolations++;
          if (light === null && this.net.degree(node) >= 3 && !this.signals.cluster.has(node)) {
            const r = this.reservation.get(node);
            if (r && r.id !== a.id) { a.s = endS; a.v = 0; }
            else { this.reservation.set(node, { id: a.id, since: this.time }); a.reserved = node; }
          }
          if (a.s >= endS && a.v > 0) {
            a.turn = this.makeTurn(a, a.next);
            a.turn.t = a.s - endS;
            a.next = null;
          }
        }
      }
    } else {
      const t = a.turn;
      v0 = Math.min(v0, t.vMax);
      let acc = this.idm(a.v, v0, gap, vLead);
      if (a.startled > 0) acc = -IDM.bMax;
      a.braking = acc < -0.6;
      a.v = Math.max(0, a.v + acc * dt);
      t.t += a.v * dt;
      if (t.t >= t.len) {
        if (a.reserved >= 0) { this.release(a.reserved, a.id); a.reserved = -1; }
        a.edge = t.next.edge;
        a.dir = t.next.dir;
        a.lane = t.next.lane;
        a.s = this.startS(a.edge, a.dir) + (t.t - t.len);
        a.turn = null;
        a.signal = 0;
        a.vDesired = this.net.edges[a.edge].v * this.opts.speedFactor * (0.85 + (a.id % 7) * 0.04);
      }
    }
    a.stuck = a.v < 0.2 ? a.stuck + dt : 0;
    const h0 = a.heading;
    this.place(a);
    let dh = a.heading - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    a.wheelRot = (a.wheelRot + (a.v * dt) / 0.34) % (Math.PI * 2);
    const yawRate = dt > 0 ? dh / dt : 0;
    const target = a.v > 0.5 ? Math.max(-0.6, Math.min(0.6, Math.atan((2.8 * yawRate) / a.v))) : a.steer;
    a.steer += (target - a.steer) * Math.min(1, dt * 8);
  }

  /** Indicator for a junction move, from the change in heading (heading grows clockwise). */
  private turnSignal(a: Agent, nx: { edge: number; dir: 1 | -1 }): -1 | 0 | 1 {
    if (nx.edge === a.edge) return -1; // U-turn: signal left
    const hin = this.lanePoint(a.edge, a.dir, a.lane, this.endS(a.edge, a.dir), { x: 0, y: 0, z: 0, heading: 0 }).heading;
    const hout = this.lanePoint(nx.edge, nx.dir, 0, this.startS(nx.edge, nx.dir) + 2, { x: 0, y: 0, z: 0, heading: 0 }).heading;
    let d = hout - hin;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) < 0.45 ? 0 : d > 0 ? 1 : -1;
  }

  private makeTurnSpeed(a: Agent): number {
    if (!a.next) return 0;
    const q0 = this.lanePoint(a.edge, a.dir, a.lane, this.endS(a.edge, a.dir), { x: 0, y: 0, z: 0, heading: 0 });
    const q3 = this.lanePoint(a.next.edge, a.next.dir, a.next.lane, this.startS(a.next.edge, a.next.dir), { x: 0, y: 0, z: 0, heading: 0 });
    let ang = q3.heading - q0.heading;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    const d = Math.hypot(q3.x - q0.x, q3.z - q0.z);
    const R = Math.abs(ang) > 0.15 ? d / (2 * Math.sin(Math.abs(ang) / 2)) : 1e3;
    return Math.max(3.5, Math.min(25, Math.sqrt(2.6 * R)));
  }

  /** Push agent transforms into kinematic bodies (call once per frame before physics steps). */
  syncBodies() {
    for (const a of this.agents) {
      if (!a.body) continue;
      const h = -a.heading;
      const cy = Math.cos(h / 2), sy = Math.sin(h / 2);
      const cp = Math.cos(a.pitch / 2), sp = Math.sin(a.pitch / 2);
      // q = yaw(h) * pitch(p) about local x
      const q = { w: cy * cp, x: cy * sp, y: sy * cp, z: -sy * sp };
      a.body.setNextKinematicTranslation({ x: a.x, y: a.y, z: a.z });
      a.body.setNextKinematicRotation(q);
    }
  }
}

function bez(p0: Vec3 | { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }, p3: { x: number; z: number }, t: number) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z };
}
