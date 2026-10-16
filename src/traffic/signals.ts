import type { RoadNetwork } from '../world/roadGraph.ts';

export type Light = 0 | 1 | 2; // green, yellow, red

export const GREEN_TIME = 16;
export const YELLOW_TIME = 3.5;
export const ALL_RED_TIME = 1.5;
export const CYCLE = 2 * (GREEN_TIME + YELLOW_TIME + ALL_RED_TIME);

/** Two-phase signal controller for one junction. Approaches are grouped by axis. */
export class SignalController {
  readonly node: number;
  /** approach edge id -> phase group (0/1) */
  readonly group = new Map<number, 0 | 1>();
  offset: number;

  constructor(net: RoadNetwork, node: number, offset: number, refAngle?: number) {
    this.node = node;
    this.offset = offset;
    const n = net.nodes[node];
    const dirs: { eid: number; ang: number }[] = [];
    for (const eid of net.adj[node]) {
      const e = net.edges[eid];
      // direction from the node into the edge
      const i = e.a === node ? 1 : e.p.length / 2 - 2;
      const ang = Math.atan2(e.p[i * 2 + 1] - n.z, e.p[i * 2] - n.x);
      dirs.push({ eid, ang });
    }
    const ref = refAngle ?? (dirs.length ? dirs[0].ang : 0);
    for (const d of dirs) {
      let diff = Math.abs(((d.ang - ref) % Math.PI + Math.PI) % Math.PI);
      diff = Math.min(diff, Math.PI - diff);
      this.group.set(d.eid, diff < Math.PI / 4 ? 0 : 1);
    }
  }

  /** Light shown to traffic arriving from edge eid at time t. */
  state(eid: number, t: number): Light {
    const g = this.group.get(eid) ?? 0;
    let c = (((t + this.offset) % CYCLE) + CYCLE) % CYCLE;
    if (g === 1) c = (c + CYCLE / 2) % CYCLE;
    if (c < GREEN_TIME) return 0;
    if (c < GREEN_TIME + YELLOW_TIME) return 1;
    return 2;
  }
}

export class SignalSystem {
  readonly controllers = new Map<number, SignalController>();
  /** Signalized nodes that belong to the same physical intersection share one cluster id. */
  readonly cluster = new Map<number, number>();
  time = 0;

  constructor(net: RoadNetwork) {
    const sig = net.nodes.map((n, i) => (n.sig && net.degree(i) >= 2 ? i : -1)).filter((i) => i >= 0);
    // union nearby signal nodes (divided roads produce several OSM nodes per junction)
    const parent = new Map<number, number>(sig.map((i) => [i, i]));
    const find = (i: number): number => { let r = i; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(i, r); return r; };
    for (let a = 0; a < sig.length; a++) for (let b = a + 1; b < sig.length; b++) {
      const A = net.nodes[sig[a]], B = net.nodes[sig[b]];
      if (Math.hypot(A.x - B.x, A.z - B.z) < 35) parent.set(find(sig[a]), find(sig[b]));
    }
    const refOf = (n: number) => {
      const e = net.edges[net.adj[n][0]];
      const nd = net.nodes[n];
      const k = e.a === n ? 1 : e.p.length / 2 - 2;
      return Math.atan2(e.p[k * 2 + 1] - nd.z, e.p[k * 2] - nd.x);
    };
    for (const i of sig) {
      const root = find(i);
      this.cluster.set(i, root);
      this.controllers.set(i, new SignalController(net, i, (root * 7.31) % CYCLE, refOf(root)));
    }
  }

  update(dt: number) {
    this.time += dt;
  }

  /** True when edge eid connects two nodes of the same signalized intersection. */
  internal(net: RoadNetwork, eid: number): boolean {
    const e = net.edges[eid];
    const ca = this.cluster.get(e.a), cb = this.cluster.get(e.b);
    return ca !== undefined && ca === cb && net.edgeLen[eid] < 45;
  }

  state(node: number, eid: number): Light | null {
    const c = this.controllers.get(node);
    return c ? c.state(eid, this.time) : null;
  }
}
