import { beforeAll, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initPhysics, PhysicsWorld, G } from '../../src/physics/world.ts';
import { VehicleSim } from '../../src/physics/vehicle/vehicle.ts';
import { M3_COMP } from '../../src/physics/vehicle/config.ts';
import { ChunkContext, ROAD_LIFT } from '../../src/world/chunkGen.ts';
import { chunkOptionsFor } from '../../src/world/district.ts';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { getCity } from '../../src/world/cities.ts';
import { LocalProjection } from '../../src/world/projection.ts';

beforeAll(async () => { await initPhysics(); });

for (const id of (process.env.CD_CITIES ?? 'oak,sf').split(',')) it(`launch ${id}`, () => {
  const city = getCity(id)!;
  const d = JSON.parse(readFileSync(`public/cities/${id}/district.json`, 'utf8'));
  const ctx = new ChunkContext(d, chunkOptionsFor(city, 1));
  const net = new RoadNetwork(d);
  const s = new LocalProjection(d.origin).toLocal(city.spawn.lat, city.spawn.lon);
  const hit = net.nearest(s.x, s.z, 300, (e) => !e.tunnel && !e.bridge && e.cls !== 'service')!;
  const pw = new PhysicsWorld(120);
  const S = d.chunkSize;
  const cx = Math.floor(hit.x / S), cz = Math.floor(hit.z / S);
  const mode = process.env.CD_MODE ?? 'all';
  if (mode === 'flat') pw.addStaticCuboid(hit.x, hit.y + ROAD_LIFT - 0.5, hit.z, 200, 0.5, 200, 0, G.ROAD, 'asphalt');
  if (mode !== 'flat') for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
    const c = ctx.generate(x, z);
    if (mode !== 'road' && c.terrainCollider) pw.addStaticTrimesh(c.terrainCollider.v, c.terrainCollider.i, G.TERRAIN, 'terrain');
    if (c.roadCollider) pw.addStaticTrimesh(c.roadCollider.v, c.roadCollider.i, G.ROAD, 'asphalt');
    if (mode !== 'road' && c.staticCollider) pw.addStaticTrimesh(c.staticCollider.v, c.staticCollider.i, G.STATIC, 'wall');
  }
  const yaw = process.env.CD_YAW !== undefined ? Number(process.env.CD_YAW) : -hit.heading;
  console.log(id, 'yaw', yaw.toFixed(3));
  const car = new VehicleSim(pw, structuredClone(M3_COMP), hit.x, hit.y + ROAD_LIFT + 0.85, hit.z, yaw);
  car.engineOn = true;
  const loads: number[] = [];
  for (let i = 0; i < 240; i++) { car.step({ throttle: 0, brake: 0, steer: 0, handbrake: 1 }, pw.dt); pw.step(); }
  for (let i = 0; i < 60; i++) { car.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, pw.dt); pw.step(); loads.push(car.wheels[0].load); }
  console.log(id, 'settled loads FL min/max', Math.min(...loads).toFixed(0), Math.max(...loads).toFixed(0), 'contacts', car.wheels.map((w) => w.contact), 'normals', car.wheels.map((w) => `${w.normal.x.toFixed(2)},${w.normal.y.toFixed(2)},${w.normal.z.toFixed(2)} ${w.surface}`).join(' | '));
  for (let i = 0; i < 360; i++) {
    car.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, pw.dt); pw.step();
    if (i % 60 === 59) console.log(id, ((i + 1) / 120).toFixed(1), 's', (car.telemetry.forwardSpeed * 3.6).toFixed(1), 'km/h tcs', car.telemetry.tcsActive, 'loads', car.wheels.map((w) => Math.round(w.load)).join(','));
  }
});
