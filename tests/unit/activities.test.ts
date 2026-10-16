import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DistrictData } from '../../src/world/types.ts';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { LocalProjection } from '../../src/world/projection.ts';
import { getCity } from '../../src/world/cities.ts';
import { ActivityManager, fmtTime, type PlayerSample } from '../../src/activities/activities.ts';
import { SessionStore, type StorageLike } from '../../src/core/session.ts';
import { GhostRecorder, sampleGhost } from '../../src/activities/ghost.ts';

class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const d: DistrictData = JSON.parse(readFileSync('public/cities/sf/district.json', 'utf8'));
const net = new RoadNetwork(d);
const proj = new LocalProjection(d.origin);
const city = getCity('sf')!;
const q = { x: 0, y: 0, z: 0, w: 1 };
const sample = (x: number, z: number, extra: Partial<PlayerSample> = {}): PlayerSample => ({ x, y: 5, z, speed: 0, heading: 0, bodySlip: 0, onGround: true, collided: false, quat: q, ...extra });

function mgr() {
  return new ActivityManager(city, net, proj, new SessionStore(new Mem()), () => 0);
}

describe('activities', () => {
  it('creates markers for every configured activity', () => {
    const m = mgr();
    const kinds = new Set(m.markers.map((x) => x.kind));
    for (const k of ['timeTrial', 'scenic', 'drift', 'speedTrap', 'parking', 'slalom', 'photo']) expect(kinds.has(k as any)).toBe(true);
  });

  it('time trial: start prompt, checkpoints in order, finish records session best and ghost', () => {
    const m = mgr();
    const tt = m.markers.find((x) => x.kind === 'timeTrial')!;
    m.update(0.1, sample(tt.x, tt.z), false);
    expect(m.prompt).toMatch(/Press T/);
    m.update(0.1, sample(tt.x, tt.z), true);
    expect(m.active?.marker.id).toBe('timeTrial');
    // drive through every checkpoint
    let t = 0;
    let safety = 0;
    while (m.active && safety++ < 200) {
      const cp = m.currentCheckpoint()!;
      t += 5;
      m.update(5, sample(cp.x, cp.z, { speed: 20 }), false);
    }
    expect(m.active).toBeNull();
    const best = m.best('timeTrial');
    expect(best).toBeGreaterThan(0);
    expect(m.ghosts.get('timeTrial')!.length).toBeGreaterThan(0);
    expect(fmtTime(65.5)).toBe('1:05.50');
  });

  it('activity key cancels an active run', () => {
    const m = mgr();
    const sc = m.markers.find((x) => x.kind === 'scenic')!;
    m.update(0.1, sample(sc.x, sc.z), true);
    expect(m.active).not.toBeNull();
    m.update(0.1, sample(sc.x + 30, sc.z), true);
    expect(m.active).toBeNull();
  });

  it('speed trap records the best speed', () => {
    const m = mgr();
    const trap = m.markers.find((x) => x.kind === 'speedTrap')!;
    const ev = m.update(0.1, sample(trap.x, trap.z, { speed: 30 }), false);
    expect(ev.some((e) => e.kind === 'toast' && /Speed trap/.test(e.title))).toBe(true);
    expect(m.best('speedTrap')).toBe(30);
  });

  it('drift zone scores sustained slip and ends when drifting stops', () => {
    const m = mgr();
    const dz = m.markers.find((x) => x.kind === 'drift')!;
    m.update(0.1, sample(dz.x, dz.z, { speed: 15, bodySlip: 0.4 }), false);
    expect(m.active?.marker.kind).toBe('drift');
    for (let i = 0; i < 60; i++) m.update(0.05, sample(dz.x, dz.z, { speed: 15, bodySlip: 0.45 }), false);
    const score = m.active!.score;
    expect(score).toBeGreaterThan(100);
    for (let i = 0; i < 100 && m.active; i++) m.update(0.05, sample(dz.x, dz.z, { speed: 15, bodySlip: 0 }), false);
    expect(m.active).toBeNull();
    expect(m.best('drift')).toBeGreaterThan(100);
  });

  it('parking requires being stopped and aligned inside the bay', () => {
    const m = mgr();
    const pk = m.markers.find((x) => x.kind === 'parking')!;
    m.update(0.1, sample(pk.x, pk.z), true);
    const bay = m.active!.bay!;
    for (let i = 0; i < 40 && m.active; i++) m.update(0.05, sample(bay.x, bay.z, { heading: bay.heading, speed: 0 }), false);
    expect(m.active).toBeNull();
    expect(m.best('parking')).toBeGreaterThan(0);
  });

  it('ghost sampling interpolates between frames', () => {
    const r = new GhostRecorder(10);
    r.record(0, { x: 0, y: 0, z: 0 }, q, 0.1);
    r.record(1, { x: 10, y: 0, z: 0 }, q, 1);
    const f = sampleGhost(r.frames, 0.5)!;
    expect(f.x).toBeCloseTo(5, 5);
  });
});
