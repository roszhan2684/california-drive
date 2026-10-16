// Optional activities. None of them block free roam; all results live in the session store.
import type { CityDef, LatLon } from '../world/cities.ts';
import type { LocalProjection } from '../world/projection.ts';
import type { RoadNetwork } from '../world/roadGraph.ts';
import type { SessionStore } from '../core/session.ts';
import { GhostRecorder, type GhostFrame } from './ghost.ts';

export type ActivityKind = 'scenic' | 'timeTrial' | 'drift' | 'speedTrap' | 'parking' | 'slalom' | 'photo';

export interface Marker {
  id: string;
  kind: ActivityKind;
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  radius: number;
  /** Activities that need an explicit start (T) show a prompt. */
  manual: boolean;
}

export interface Checkpoint { x: number; y: number; z: number; heading: number }

export interface PlayerSample {
  x: number; y: number; z: number;
  speed: number;
  heading: number;
  bodySlip: number;
  onGround: boolean;
  collided: boolean;
  quat: { x: number; y: number; z: number; w: number };
}

export interface HudActivity {
  title: string;
  primary: string;
  secondary: string;
  progress: number;
}

export interface Cone { x: number; y: number; z: number; side: 1 | -1; hit: boolean; passed: boolean }

export type ActivityEvent = { kind: 'toast'; title: string; sub?: string; tone?: 'good' | 'info' | 'bad' } | { kind: 'start'; id: string } | { kind: 'finish'; id: string };

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export { fmtTime };

interface Active {
  marker: Marker;
  t: number;
  checkpoints: Checkpoint[];
  next: number;
  route: number[];
  score: number;
  combo: number;
  driftIdle: number;
  holdTime: number;
  penalty: number;
  cones: Cone[];
  bay?: { x: number; z: number; heading: number };
  distance: number;
  lastX: number;
  lastZ: number;
}

export class ActivityManager {
  readonly markers: Marker[] = [];
  active: Active | null = null;
  prompt: string | null = null;
  hud: HudActivity | null = null;
  /** Polyline of the active route (x,y,z...) for minimap and chevrons. */
  route: number[] = [];
  readonly ghosts = new Map<string, GhostFrame[]>();
  ghostFrames: GhostFrame[] | null = null;
  private recorder = new GhostRecorder();
  private trapCooldown = new Map<string, number>();
  private units: 'mph' | 'kmh' = 'mph';
  private net: RoadNetwork;
  private proj: LocalProjection;
  private city: CityDef;
  private session: SessionStore;
  private routes = new Map<string, { pts: number[]; cps: Checkpoint[] }>();
  private driftZone: Marker | null = null;
  readonly photoSpots: { id: string; name: string; x: number; y: number; z: number; tx: number; ty: number; tz: number }[] = [];

  constructor(city: CityDef, net: RoadNetwork, proj: LocalProjection, session: SessionStore, groundY: (x: number, z: number) => number) {
    this.city = city;
    this.net = net;
    this.proj = proj;
    this.session = session;
    const A = city.activities;
    const snap = (ll: LatLon) => {
      const p = proj.toLocal(ll.lat, ll.lon);
      const h = net.nearest(p.x, p.z, 250, (e) => !e.tunnel);
      return h ? { x: h.x, y: h.y, z: h.z, heading: h.heading, edge: h.edge.id } : { x: p.x, y: groundY(p.x, p.z), z: p.z, heading: 0, edge: -1 };
    };
    const addRoute = (id: string, kind: ActivityKind, name: string, wps: LatLon[]) => {
      const built = this.buildRoute(wps);
      if (!built) return;
      this.routes.set(id, built);
      const c0 = built.cps[0];
      this.markers.push({ id, kind, name, x: c0.x, y: c0.y, z: c0.z, heading: c0.heading, radius: 9, manual: true });
    };
    if (A.timeTrial) addRoute('timeTrial', 'timeTrial', A.timeTrial.name, A.timeTrial.waypoints);
    if (A.scenicRoute) addRoute('scenic', 'scenic', A.scenicRoute.name, A.scenicRoute.waypoints);
    if (A.driftZone) {
      const p = proj.toLocal(A.driftZone.at.lat, A.driftZone.at.lon);
      this.driftZone = { id: 'drift', kind: 'drift', name: A.driftZone.name, x: p.x, y: groundY(p.x, p.z), z: p.z, heading: 0, radius: A.driftZone.radius, manual: false };
      this.markers.push(this.driftZone);
    }
    if (A.speedTrap) {
      const s = snap(A.speedTrap.at);
      this.markers.push({ id: 'speedTrap', kind: 'speedTrap', name: A.speedTrap.name, ...s, radius: 16, manual: false });
    }
    if (A.parking) {
      const s = snap(A.parking.at);
      this.markers.push({ id: 'parking', kind: 'parking', name: A.parking.name, ...s, radius: 8, manual: true });
    }
    if (A.slalom) {
      const s = snap(A.slalom.at);
      this.markers.push({ id: 'slalom', kind: 'slalom', name: A.slalom.name, ...s, radius: 8, manual: true });
    }
    for (const ps of A.photoSpots ?? []) {
      const p = proj.toLocal(ps.at.lat, ps.at.lon);
      const t = proj.toLocal(ps.lookAt.lat, ps.lookAt.lon);
      const y = groundY(p.x, p.z);
      this.photoSpots.push({ id: ps.id, name: ps.name, x: p.x, y, z: p.z, tx: t.x, ty: groundY(t.x, t.z) + 20, tz: t.z });
      this.markers.push({ id: `photo:${ps.id}`, kind: 'photo', name: ps.name, x: p.x, y, z: p.z, heading: 0, radius: 30, manual: false });
    }
  }

  setUnits(u: 'mph' | 'kmh') {
    this.units = u;
  }

  private spd(ms: number) {
    return this.units === 'mph' ? `${Math.round(ms * 2.23694)} mph` : `${Math.round(ms * 3.6)} km/h`;
  }

  private buildRoute(wps: LatLon[]): { pts: number[]; cps: Checkpoint[] } | null {
    const nodes = wps.map((w) => { const p = this.proj.toLocal(w.lat, w.lon); return this.net.nearestNode(p.x, p.z, 2); });
    if (nodes.some((n) => n < 0)) return null;
    const pts: number[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const r = this.net.route(nodes[i], nodes[i + 1], true) ?? this.net.route(nodes[i], nodes[i + 1], false);
      if (!r) return null;
      const pl = this.net.routePolyline(nodes[i], r.edges);
      if (pts.length) pl.splice(0, 3);
      pts.push(...pl);
    }
    if (pts.length < 6) return null;
    // checkpoints every ~140 m along the polyline
    const cps: Checkpoint[] = [];
    let acc = 0;
    const hd = (i: number) => {
      const j = Math.min(pts.length / 3 - 1, i + 1), k = j === i ? i - 1 : i;
      return Math.atan2(pts[j * 3] - pts[k * 3], -(pts[j * 3 + 2] - pts[k * 3 + 2]));
    };
    cps.push({ x: pts[0], y: pts[1], z: pts[2], heading: hd(0) });
    for (let i = 1; i < pts.length / 3; i++) {
      acc += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
      if (acc > 140) { cps.push({ x: pts[i * 3], y: pts[i * 3 + 1], z: pts[i * 3 + 2], heading: hd(i) }); acc = 0; }
    }
    const n = pts.length / 3 - 1;
    const last = cps[cps.length - 1];
    if (Math.hypot(last.x - pts[n * 3], last.z - pts[n * 3 + 2]) > 30) cps.push({ x: pts[n * 3], y: pts[n * 3 + 1], z: pts[n * 3 + 2], heading: hd(n) });
    else cps[cps.length - 1] = { x: pts[n * 3], y: pts[n * 3 + 1], z: pts[n * 3 + 2], heading: hd(n) };
    return { pts, cps };
  }

  best(id: string): number | undefined {
    return this.session.get<Record<string, number>>(`best.${this.city.id}`, {})[id];
  }

  private setBest(id: string, v: number, higherIsBetter: boolean): boolean {
    const all = this.session.get<Record<string, number>>(`best.${this.city.id}`, {});
    const prev = all[id];
    const better = prev === undefined || (higherIsBetter ? v > prev : v < prev);
    if (better) { all[id] = v; this.session.set(`best.${this.city.id}`, all); }
    return better;
  }

  start(m: Marker, p: PlayerSample): ActivityEvent[] {
    const a: Active = { marker: m, t: 0, checkpoints: [], next: 1, route: [], score: 0, combo: 1, driftIdle: 0, holdTime: 0, penalty: 0, cones: [], distance: 0, lastX: p.x, lastZ: p.z };
    if (m.kind === 'timeTrial' || m.kind === 'scenic') {
      const r = this.routes.get(m.id)!;
      a.checkpoints = r.cps;
      a.route = r.pts;
      this.route = r.pts;
      if (m.kind === 'timeTrial') {
        this.recorder.reset();
        this.ghostFrames = this.ghosts.get(m.id) ?? null;
      }
    } else if (m.kind === 'parking') {
      // bay 35 m ahead on the right side of the road
      const h = m.heading;
      const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
      const hit = this.net.nearest(m.x + fx * 35, m.z + fz * 35, 40);
      const off = hit ? hit.edge.w / 2 - 1.2 : 4;
      const bx = (hit?.x ?? m.x + fx * 35) + rx * off, bz = (hit?.z ?? m.z + fz * 35) + rz * off;
      a.bay = { x: bx, z: bz, heading: hit ? hit.heading : h };
    } else if (m.kind === 'slalom') {
      const h = m.heading;
      const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h);
      for (let i = 0; i < 8; i++) {
        const d = 25 + i * 16;
        const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
        a.cones.push({ x: m.x + fx * d + rx * side * 0.0, y: m.y, z: m.z + fz * d, side, hit: false, passed: false });
      }
    }
    this.active = a;
    return [{ kind: 'start', id: m.id }, { kind: 'toast', title: m.name, sub: m.kind === 'scenic' ? 'Follow the route — no timer pressure' : m.kind === 'parking' ? 'Park inside the glowing bay' : m.kind === 'slalom' ? 'Weave through the cones: left, right, left…' : 'GO!', tone: 'info' }];
  }

  cancel(): ActivityEvent[] {
    if (!this.active) return [];
    const id = this.active.marker.id;
    this.active = null;
    this.route = [];
    this.ghostFrames = null;
    this.hud = null;
    return [{ kind: 'toast', title: 'Activity cancelled', tone: 'info' }, { kind: 'finish', id }];
  }

  /** Called every frame. `startPressed` = activity key edge. */
  update(dt: number, p: PlayerSample, startPressed: boolean): ActivityEvent[] {
    const ev: ActivityEvent[] = [];
    this.prompt = null;
    // passive: speed traps
    for (const m of this.markers) {
      if (m.kind !== 'speedTrap') continue;
      const cd = (this.trapCooldown.get(m.id) ?? 0) - dt;
      this.trapCooldown.set(m.id, cd);
      if (cd <= 0 && Math.hypot(p.x - m.x, p.z - m.z) < m.radius && p.speed > 8) {
        this.trapCooldown.set(m.id, 6);
        const better = this.setBest(m.id, p.speed, true);
        ev.push({ kind: 'toast', title: `Speed trap · ${this.spd(p.speed)}`, sub: better ? 'New session best!' : `Best ${this.spd(this.best(m.id) ?? 0)}`, tone: better ? 'good' : 'info' });
      }
    }
    const a = this.active;
    if (!a) {
      // drift zone auto-start
      const dz = this.driftZone;
      if (dz && Math.hypot(p.x - dz.x, p.z - dz.z) < dz.radius && Math.abs(p.bodySlip) > 0.2 && p.speed > 7) {
        ev.push(...this.start(dz, p));
        return ev;
      }
      for (const m of this.markers) {
        if (!m.manual) continue;
        if (Math.hypot(p.x - m.x, p.z - m.z) < m.radius && p.speed < 14) {
          const bt = this.best(m.id);
          this.prompt = `Press T to start ${m.name}${bt !== undefined ? ` · best ${m.kind === 'parking' || m.kind === 'slalom' || m.kind === 'timeTrial' ? fmtTime(bt) : ''}` : ''}`;
          if (startPressed) ev.push(...this.start(m, p));
          break;
        }
      }
      this.hud = null;
      return ev;
    }
    if (startPressed) return [...ev, ...this.cancel()];
    a.t += dt;
    a.distance += Math.hypot(p.x - a.lastX, p.z - a.lastZ);
    a.lastX = p.x; a.lastZ = p.z;
    const m = a.marker;
    if (m.kind === 'timeTrial' || m.kind === 'scenic') {
      if (m.kind === 'timeTrial') this.recorder.record(a.t, p, p.quat, dt);
      const cp = a.checkpoints[a.next];
      if (cp && Math.hypot(p.x - cp.x, p.z - cp.z) < 16 && Math.abs(p.y - cp.y) < 10) {
        a.next++;
        if (a.next >= a.checkpoints.length) {
          const t = a.t;
          if (m.kind === 'timeTrial') {
            const better = this.setBest(m.id, t, false);
            if (better) this.ghosts.set(m.id, this.recorder.frames.slice());
            ev.push({ kind: 'toast', title: `${m.name} · ${fmtTime(t)}`, sub: better ? 'New session best — ghost saved for this session' : `Best ${fmtTime(this.best(m.id)!)}`, tone: better ? 'good' : 'info' });
          } else {
            const dist = this.units === 'mph' ? `${(a.distance / 1609.34).toFixed(1)} mi` : `${(a.distance / 1000).toFixed(1)} km`;
            ev.push({ kind: 'toast', title: `${m.name} complete`, sub: `${dist} in ${fmtTime(t)}`, tone: 'good' });
          }
          ev.push({ kind: 'finish', id: m.id });
          this.active = null;
          this.route = [];
          this.ghostFrames = null;
          this.hud = null;
          return ev;
        }
        ev.push({ kind: 'toast', title: `Checkpoint ${a.next}/${a.checkpoints.length - 1}`, sub: m.kind === 'timeTrial' ? fmtTime(a.t) : undefined, tone: 'info' });
      }
      const bt = this.best(m.id);
      this.hud = {
        title: m.name,
        primary: m.kind === 'timeTrial' ? fmtTime(a.t) : `${a.next - 1}/${a.checkpoints.length - 1}`,
        secondary: m.kind === 'timeTrial' ? (bt !== undefined ? `Best ${fmtTime(bt)}` : 'No best yet') : 'Scenic route · T to cancel',
        progress: (a.next - 1) / Math.max(1, a.checkpoints.length - 1),
      };
    } else if (m.kind === 'drift') {
      const inside = Math.hypot(p.x - m.x, p.z - m.z) < m.radius + 15;
      const drifting = Math.abs(p.bodySlip) > 0.17 && p.speed > 6 && p.onGround;
      if (p.collided) { a.score = Math.max(0, a.score * 0.5); a.combo = 1; ev.push({ kind: 'toast', title: 'Drift broken', sub: 'Collision', tone: 'bad' }); }
      if (drifting) {
        a.driftIdle = 0;
        a.score += Math.abs(p.bodySlip) * 57.3 * p.speed * dt * 0.6 * a.combo;
        a.holdTime += dt;
        if (a.holdTime > 2) { a.combo = Math.min(5, a.combo + 1); a.holdTime = 0; }
      } else {
        a.driftIdle += dt;
        a.holdTime = 0;
        if (a.driftIdle > 1.2) a.combo = 1;
      }
      if (!inside || a.driftIdle > 3.5) {
        const sc = Math.round(a.score);
        const better = this.setBest(m.id, sc, true);
        ev.push({ kind: 'toast', title: `${m.name} · ${sc.toLocaleString()} pts`, sub: better ? 'New session best!' : `Best ${(this.best(m.id) ?? 0).toLocaleString()}`, tone: better ? 'good' : 'info' }, { kind: 'finish', id: m.id });
        this.active = null;
        this.hud = null;
        return ev;
      }
      this.hud = { title: m.name, primary: `${Math.round(a.score).toLocaleString()}`, secondary: `×${a.combo} combo`, progress: Math.min(1, a.holdTime / 2) };
    } else if (m.kind === 'parking') {
      const b = a.bay!;
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
      const dx = p.x - b.x, dz = p.z - b.z;
      const lon = Math.abs(dx * fx + dz * fz), lat = Math.abs(dx * fz - dz * fx);
      let dh = Math.abs(p.heading - b.heading) % (Math.PI * 2);
      dh = Math.min(dh, Math.PI * 2 - dh);
      const aligned = Math.min(dh, Math.PI - dh) < 0.22;
      const ok = lon < 1.4 && lat < 0.8 && aligned && p.speed < 0.4;
      a.holdTime = ok ? a.holdTime + dt : 0;
      if (p.collided) a.penalty += 2;
      if (a.holdTime > 1.5) {
        const t = a.t + a.penalty;
        const better = this.setBest(m.id, t, false);
        ev.push({ kind: 'toast', title: `Parked! ${fmtTime(t)}`, sub: better ? 'New session best!' : `Best ${fmtTime(this.best(m.id)!)}`, tone: 'good' }, { kind: 'finish', id: m.id });
        this.active = null;
        this.hud = null;
        return ev;
      }
      this.hud = { title: m.name, primary: fmtTime(a.t + a.penalty), secondary: ok ? 'Hold still…' : `${Math.round(Math.hypot(dx, dz))} m to bay${a.penalty ? ` · +${a.penalty}s` : ''}`, progress: Math.min(1, a.holdTime / 1.5) };
    } else if (m.kind === 'slalom') {
      const h = m.heading;
      const fx = Math.sin(h), fz = -Math.cos(h);
      for (const c of a.cones) {
        if (c.passed) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        if (!c.hit && Math.hypot(dx, dz) < 1.1) { c.hit = true; a.penalty += 1; ev.push({ kind: 'toast', title: 'Cone hit +1s', tone: 'bad' }); }
        const lon = dx * fx + dz * fz;
        if (lon > 0) {
          c.passed = true;
          const lat = dx * Math.cos(h) + dz * Math.sin(h);
          if (Math.sign(lat) !== c.side && !c.hit) { a.penalty += 2; ev.push({ kind: 'toast', title: 'Missed gate +2s', tone: 'bad' }); }
        }
      }
      if (a.cones.every((c) => c.passed)) {
        const t = a.t + a.penalty;
        const better = this.setBest(m.id, t, false);
        ev.push({ kind: 'toast', title: `Slalom ${fmtTime(t)}`, sub: better ? 'New session best!' : `Best ${fmtTime(this.best(m.id)!)}`, tone: 'good' }, { kind: 'finish', id: m.id });
        this.active = null;
        this.hud = null;
        return ev;
      }
      if (a.t > 60) return [...ev, ...this.cancel()];
      this.hud = { title: m.name, primary: fmtTime(a.t + a.penalty), secondary: `${a.cones.filter((c) => c.passed).length}/${a.cones.length} gates`, progress: a.cones.filter((c) => c.passed).length / a.cones.length };
    }
    return ev;
  }

  /** Current target checkpoint for route activities. */
  currentCheckpoint(): Checkpoint | null {
    const a = this.active;
    if (!a || !a.checkpoints.length) return null;
    return a.checkpoints[a.next] ?? null;
  }

  activeTime(): number {
    return this.active?.t ?? 0;
  }

  /** Photo mode check: returns a newly captured spot or null. */
  checkPhoto(cam: { x: number; y: number; z: number; dx: number; dy: number; dz: number }): string | null {
    const got = new Set(this.session.get<string[]>(`photos.${this.city.id}`, []));
    for (const s of this.photoSpots) {
      if (got.has(s.id)) continue;
      if (Math.hypot(cam.x - s.x, cam.z - s.z) > 45) continue;
      const tx = s.tx - cam.x, ty = s.ty - cam.y, tz = s.tz - cam.z;
      const l = Math.hypot(tx, ty, tz) || 1;
      if ((tx * cam.dx + ty * cam.dy + tz * cam.dz) / l > Math.cos(0.6)) {
        got.add(s.id);
        this.session.set(`photos.${this.city.id}`, [...got]);
        return s.name;
      }
    }
    return null;
  }
}
