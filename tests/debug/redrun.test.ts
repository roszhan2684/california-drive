import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { TrafficSystem } from '../../src/traffic/traffic.ts';
import { getCity } from '../../src/world/cities.ts';
import { LocalProjection } from '../../src/world/projection.ts';
it('redrun', () => {
  const d = JSON.parse(readFileSync('public/cities/sf/district.json', 'utf8'));
  const net = new RoadNetwork(d);
  const dims = [{ length: 4.75, width: 1.84 }];
  const sys = new TrafficSystem(net, { cap: 30, spawnMin: 40, spawnMax: 320, despawn: 420, speedFactor: 0.9, variantDims: dims }, null, 7);
  const c = new LocalProjection(d.origin).toLocal(getCity('sf')!.spawn.lat, getCity('sf')!.spawn.lon);
  const player = { x: c.x, y: 0, z: c.z, vx: 0, vz: 0, heading: 0 };
  let prev = 0;
  const age = new Map<number, number>();
  for (let i = 0; i < 18000; i++) {
    const snap = sys.agents.map(a => ({ id: a.id, edge: a.edge, s: a.s, v: a.v, turn: !!a.turn, len: net.edgeLen[a.edge] }));
    sys.update(1/30, player);
    for (const a of sys.agents) age.set(a.id, (age.get(a.id) ?? 0) + 1);
    if (sys.stats.redRunViolations > prev) {
      prev = sys.stats.redRunViolations;
      const a = sys.agents.find(x => x.turn && x.turn.t < 2);
      const s = snap.find(x => x.id === a?.id);
      if (prev < 12) console.log('violation', JSON.stringify(s), 'age frames', age.get(a?.id ?? -1), 'deg', a ? net.degree(a.turn!.node) : -1);
    }
  }
});
