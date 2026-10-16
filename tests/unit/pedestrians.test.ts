import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DistrictData } from '../../src/world/types.ts';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { PedestrianSystem, sidewalkEdge } from '../../src/traffic/pedestrians.ts';
import { SIDEWALK_W } from '../../src/world/chunkGen.ts';
import { getCity } from '../../src/world/cities.ts';
import { LocalProjection } from '../../src/world/projection.ts';

const d: DistrictData = JSON.parse(readFileSync('public/cities/sf/district.json', 'utf8'));
const net = new RoadNetwork(d);
const city = getCity('sf')!;
const proj = new LocalProjection(d.origin);
const c = proj.toLocal(city.spawn.lat, city.spawn.lon);

describe('pedestrians (SF, headless)', () => {
  it('spawn on sidewalks, keep walking, stay in the sidewalk band and turn corners', () => {
    const sys = new PedestrianSystem(net, { cap: 30, spawnMin: 10, spawnMax: 110, despawn: 150 }, 3);
    const player = { x: c.x, y: 0, z: c.z, vx: 0, vz: 0, heading: 0 };
    const dt = 1 / 30;
    const edgesSeen = new Map<number, Set<number>>();
    let moving = 0, samples = 0;
    for (let i = 0; i < 3 * 60 * 30; i++) {
      sys.update(dt, player);
      for (const p of sys.peds) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
        if (!edgesSeen.has(p.id)) edgesSeen.set(p.id, new Set());
        edgesSeen.get(p.id)!.add(p.edge);
        if (p.mode === 'walk') {
          expect(sidewalkEdge(net.edges[p.edge])).toBe(true);
          const hw = net.edges[p.edge].w / 2;
          expect(p.off).toBeGreaterThanOrEqual(hw);
          expect(p.off).toBeLessThanOrEqual(hw + SIDEWALK_W);
        }
      }
      if (i % 30 === 0) { samples++; if (sys.peds.some((p) => p.gait > 0.5)) moving++; }
    }
    expect(sys.peds.length).toBeGreaterThan(15);
    expect(sys.peds.length).toBeLessThanOrEqual(30);
    expect(moving / samples).toBeGreaterThan(0.9);
    // some pedestrians reached a junction and moved on to another street
    expect([...edgesSeen.values()].filter((s) => s.size > 1).length).toBeGreaterThan(3);
  });

  it('step aside when the player drives at them', () => {
    const sys = new PedestrianSystem(net, { cap: 0, spawnMin: 10, spawnMax: 110, despawn: 500 }, 5);
    const eid = net.edges.findIndex((e) => sidewalkEdge(e) && net.edgeLen[e.id] > 60);
    const hw = net.edges[eid].w / 2;
    const p = sys.spawn(eid, net.edgeLen[eid] / 2, 1, hw + 1.2, 1);
    p.mode = 'idle'; p.timer = 100;
    const off0 = p.off;
    // car approaching along the sidewalk line from 6 m away at 12 m/s
    const q = sys.point(eid, net.edgeLen[eid] / 2 - 6, 1, hw + 1.2);
    const h = net.pointAt(eid, net.edgeLen[eid] / 2).heading;
    const player = { x: q.x, y: 0, z: q.z, vx: Math.sin(h) * 12, vz: -Math.cos(h) * 12, heading: h };
    for (let i = 0; i < 30; i++) sys.update(1 / 30, player);
    expect(sys.stats.dodges).toBe(1);
    expect(Math.abs(p.off - off0)).toBeGreaterThan(0.4);
  });
});
