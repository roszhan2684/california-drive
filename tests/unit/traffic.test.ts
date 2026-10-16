import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DistrictData } from '../../src/world/types.ts';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { TrafficSystem } from '../../src/traffic/traffic.ts';
import { SignalController, CYCLE, GREEN_TIME, YELLOW_TIME } from '../../src/traffic/signals.ts';
import { getCity } from '../../src/world/cities.ts';
import { LocalProjection } from '../../src/world/projection.ts';

const d: DistrictData = JSON.parse(readFileSync('public/cities/sf/district.json', 'utf8'));
const net = new RoadNetwork(d);
const dims = [{ length: 4.75, width: 1.84 }, { length: 4.85, width: 1.94 }, { length: 4.1, width: 1.76 }, { length: 5.3, width: 2.0 }];

describe('signals', () => {
  it('cycles green -> yellow -> red and the two axes never show green together', () => {
    const node = d.nodes.findIndex((n, i) => n.sig && net.degree(i) === 4);
    expect(node).toBeGreaterThanOrEqual(0);
    const c = new SignalController(net, node, 0);
    const groups = new Set(c.group.values());
    expect(groups.size).toBe(2);
    const [e0, e1] = [...c.group.entries()].reduce<number[]>((acc, [eid, g]) => { if (acc[g] === undefined) acc[g] = eid; return acc; }, []);
    for (let t = 0; t < CYCLE * 2; t += 0.25) {
      const s0 = c.state(e0, t), s1 = c.state(e1, t);
      expect(s0 === 0 && s1 === 0).toBe(false);
    }
    expect(c.state(e0, 0.1)).toBe(0);
    expect(c.state(e0, GREEN_TIME + 0.1)).toBe(1);
    expect(c.state(e0, GREEN_TIME + YELLOW_TIME + 0.1)).toBe(2);
  });
});

describe('traffic simulation (SF, headless)', () => {
  const city = getCity('sf')!;
  const proj = new LocalProjection(d.origin);
  const center = proj.toLocal(city.spawn.lat, city.spawn.lon);
  const player = { x: center.x, y: 0, z: center.z, vx: 0, vz: 0, heading: 0 };

  it('runs 10 minutes without deadlock, respects caps and signals', () => {
    const sys = new TrafficSystem(net, { cap: 30, spawnMin: 40, spawnMax: 320, despawn: 420, speedFactor: 0.9, variantDims: dims }, null, 7);
    const dt = 1 / 30;
    let maxAgents = 0;
    let movingSamples = 0, samples = 0;
    let overlaps = 0;
    for (let i = 0; i < 10 * 60 * 30; i++) {
      sys.update(dt, player);
      maxAgents = Math.max(maxAgents, sys.agents.length);
      if (i % 30 === 0) {
        samples++;
        const moving = sys.agents.filter((a) => a.v > 0.5).length;
        if (moving > 0) movingSamples++;
        for (let a = 0; a < sys.agents.length; a++) for (let b = a + 1; b < sys.agents.length; b++) {
          const A = sys.agents[a], B = sys.agents[b];
          if (A.edge === B.edge && A.dir === B.dir && A.lane === B.lane && !A.turn && !B.turn && Math.abs(A.s - B.s) < 2) overlaps++;
        }
      }
      for (const a of sys.agents) expect(Math.hypot(a.x - player.x, a.z - player.z)).toBeLessThan(430);
    }
    console.log(`traffic: max ${maxAgents}, spawned ${sys.stats.spawned}, despawned ${sys.stats.despawned}, recoveries ${sys.stats.deadlockRecoveries}, red-runs ${sys.stats.redRunViolations}, overlaps ${overlaps}, moving ${(movingSamples / samples * 100).toFixed(0)}%`);
    expect(maxAgents).toBeLessThanOrEqual(30);
    expect(maxAgents).toBeGreaterThan(10);
    expect(movingSamples / samples).toBeGreaterThan(0.95);
    expect(sys.stats.redRunViolations).toBeLessThan(sys.stats.spawned * 0.02 + 2);
    expect(overlaps).toBeLessThan(5);
  });

  it('stops for the player car ahead (collision avoidance)', () => {
    const sys = new TrafficSystem(net, { cap: 0, spawnMin: 40, spawnMax: 320, despawn: 2000, speedFactor: 1, variantDims: dims }, null, 3);
    const e = d.edges.find((x) => x.lf > 0 && net.edgeLen[x.id] > 150 && !x.tunnel && x.cls !== 'service')!;
    const a = sys.spawnAt(e.id, 1, 0, 20)!;
    a.v = 12;
    // put the player 60 m ahead in the same lane, stationary
    const tmp = { x: 0, y: 0, z: 0, heading: 0 };
    sys.lanePoint(e.id, 1, 0, 80, tmp);
    const p = { x: tmp.x, y: tmp.y, z: tmp.z, vx: 0, vz: 0, heading: tmp.heading };
    for (let i = 0; i < 30 * 15; i++) sys.update(1 / 30, p);
    const dist = Math.hypot(a.x - p.x, a.z - p.z);
    console.log(`stopped ${dist.toFixed(1)} m behind player, v=${a.v.toFixed(2)}`);
    expect(a.v).toBeLessThan(0.3);
    expect(dist).toBeGreaterThan(3.5);
  });

  it('despawns agents outside the bubble', () => {
    const sys = new TrafficSystem(net, { cap: 20, spawnMin: 40, spawnMax: 320, despawn: 420, speedFactor: 1, variantDims: dims }, null, 5);
    for (let i = 0; i < 90; i++) sys.update(1 / 30, player);
    expect(sys.agents.length).toBeGreaterThan(5);
    const far = { ...player, x: player.x + 5000 };
    sys.update(1 / 30, far);
    expect(sys.agents.length).toBeLessThanOrEqual(2);
  });
});

describe('traffic turn signals & wheels', () => {
  const city = getCity('sf')!;
  const proj = new LocalProjection(d.origin);
  const center = proj.toLocal(city.spawn.lat, city.spawn.lon);
  it('agents indicate before turning and wheels spin with speed', () => {
    const sys = new TrafficSystem(net, { cap: 25, spawnMin: 40, spawnMax: 320, despawn: 420, speedFactor: 0.9, variantDims: dims }, null, 11);
    const player = { x: center.x, y: 0, z: center.z, vx: 0, vz: 0, heading: 0 };
    let signalling = 0, left = 0, right = 0, spun = 0;
    for (let i = 0; i < 2 * 60 * 30; i++) {
      sys.update(1 / 30, player);
      for (const a of sys.agents) {
        if (a.signal !== 0) { signalling++; if (a.signal < 0) left++; else right++; }
        if (a.v > 3 && a.wheelRot !== 0) spun++;
        expect(Math.abs(a.steer)).toBeLessThanOrEqual(0.6);
      }
    }
    expect(signalling).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(spun).toBeGreaterThan(0);
  });
});
