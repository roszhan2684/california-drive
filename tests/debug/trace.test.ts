import { it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../../src/physics/world.ts';
import { buildProvingGroundPhysics } from '../../src/physics/provingGround.ts';
import { VehicleSim } from '../../src/physics/vehicle/vehicle.ts';
import { VIREO_S6 } from '../../src/physics/vehicle/config.ts';
it('trace', async () => {
  await initPhysics();
  const pw = new PhysicsWorld(120); buildProvingGroundPhysics(pw);
  const car = new VehicleSim(pw, VIREO_S6, 0, 0.75, 900, 0);
  for (let i = 0; i < 120; i++) { car.step({ throttle: 0, brake: 1, steer: 0, handbrake: 0 }, pw.dt); pw.step(); }
  console.log('settled y', car.position.y.toFixed(3), car.wheels.map(w=>w.compression.toFixed(3)+'/'+w.load.toFixed(0)).join(' '), 'yaw', car.yaw);
  for (let i = 0; i < 600; i++) {
    car.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, pw.dt); pw.step();
    if (i % 30 === 0) { const t = car.telemetry; console.log((i/120).toFixed(2), 'v', (t.forwardSpeed*3.6).toFixed(1), 'g', t.gear, 'rpm', t.rpm.toFixed(0), 'thr', t.throttle.toFixed(2), 'tcs', t.tcsActive, 'kR', car.wheels[2].slipRatio.toFixed(3), 'fxR', car.wheels[2].fx.toFixed(0), 'loadR', car.wheels[2].load.toFixed(0),'loadF', car.wheels[0].load.toFixed(0), 'yaw', car.yaw.toFixed(4), 'x', car.position.x.toFixed(3)); }
  }
});
