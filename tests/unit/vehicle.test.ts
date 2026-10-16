import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../../src/physics/world.ts';
import { buildProvingGroundPhysics, PROVING_GROUND } from '../../src/physics/provingGround.ts';
import { VehicleSim, type DriveInput } from '../../src/physics/vehicle/vehicle.ts';
import { VIREO_S6, M3_COMP, type VehicleConfig } from '../../src/physics/vehicle/config.ts';
import { FixedStep } from '../../src/core/fixedStep.ts';
import { tireCurve, curveB } from '../../src/physics/vehicle/tire.ts';
import { engineTorque } from '../../src/physics/vehicle/powertrain.ts';

beforeAll(async () => {
  await initPhysics();
});

function makeCar(x = 0, z = 0, yaw = 0, cfg: VehicleConfig = VIREO_S6) {
  const pw = new PhysicsWorld(120);
  buildProvingGroundPhysics(pw, { ...PROVING_GROUND, size: 6000 });
  const car = new VehicleSim(pw, structuredClone(cfg), x, 0.75, z, yaw);
  // settle
  for (let i = 0; i < 120; i++) { car.step({ throttle: 0, brake: 0, steer: 0, handbrake: 1 }, pw.dt); pw.step(); }
  return { pw, car };
}

function run(pw: PhysicsWorld, car: VehicleSim, seconds: number, input: DriveInput | ((t: number) => DriveInput), probe?: (t: number) => void | boolean) {
  const n = Math.round(seconds / pw.dt);
  for (let i = 0; i < n; i++) {
    const t = i * pw.dt;
    car.step(typeof input === 'function' ? input(t) : input, pw.dt);
    pw.step();
    if (probe && probe(t) === true) return t;
  }
  return seconds;
}

const kmh = (ms: number) => ms * 3.6;

describe('tire model', () => {
  it('peaks at normalized slip 1 and retains sliding grip', () => {
    const C = VIREO_S6.tire.shape;
    const B = curveB(C);
    expect(tireCurve(1, C, B)).toBeCloseTo(1, 3);
    expect(tireCurve(0.5, C, B)).toBeLessThan(1);
    expect(tireCurve(10, C, B)).toBeGreaterThan(0.6);
  });
  it('engine torque curve interpolates', () => {
    expect(engineTorque(VIREO_S6.engine.torqueCurve, 4000)).toBe(530);
    expect(engineTorque(VIREO_S6.engine.torqueCurve, 3300)).toBeGreaterThan(510);
  });
});

describe('vehicle proving ground', () => {
  it('A1/A11 accelerates 0-100 km/h within band with sane upshifts', () => {
    const { pw, car } = makeCar(0, 900);
    const gears: number[] = [];
    car.onShift = (g, up) => { if (up) gears.push(g); };
    const t = run(pw, car, 12, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 100);
    console.log(`0-100: ${t.toFixed(2)} s, gears ${gears.join(',')}`);
    expect(t).toBeGreaterThan(3.3);
    expect(t).toBeLessThan(5.0);
  });

  it('TCS keeps launch wheelspin under control', () => {
    const { pw, car } = makeCar(0, 900);
    let worst = 0;
    run(pw, car, 2.5, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, (t) => {
      if (t > 0.3) worst = Math.max(worst, car.wheels[2].slipRatio, car.wheels[3].slipRatio);
    });
    console.log(`launch: worst rear slip ratio ${worst.toFixed(3)}`);
    expect(worst).toBeLessThan(0.45);
  });

  it('A2 reaches a plausible top speed', () => {
    const { pw, car } = makeCar(-2800, 1150, -Math.PI / 2);
    let ups = 0, badDown = 0;
    car.onShift = (_g, up) => { if (up) ups++; else if (car.telemetry.forwardSpeed > 9) badDown++; };
    // drive along +x (yaw -90deg => facing +x)
    run(pw, car, 40, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
    const v = kmh(car.telemetry.forwardSpeed);
    console.log(`top speed ${v.toFixed(1)} km/h, upshifts ${ups}`);
    expect(v).toBeGreaterThan(250);
    expect(v).toBeLessThan(320);
    expect(ups).toBeGreaterThanOrEqual(4);
    expect(badDown).toBe(0);
  });

  it('A3/A4 brakes from 100 km/h within band without locking', () => {
    const { pw, car } = makeCar(0, 900);
    run(pw, car, 10, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 100);
    const start = car.position.clone();
    let lockTime = 0;
    run(pw, car, 8, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, () => {
      if (car.telemetry.speed > 3 && car.wheels.some((w) => w.contact && w.slipRatio < -0.35)) lockTime += pw.dt;
      return car.telemetry.speed < 0.3;
    });
    const d = car.position.distanceTo(start);
    console.log(`100-0: ${d.toFixed(1)} m, lock ${lockTime.toFixed(3)} s`);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(42);
    expect(lockTime).toBeLessThan(0.15);
  });

  it('A5 is stable in a straight line at 200 km/h with no input', () => {
    const { pw, car } = makeCar(-2800, 0, -Math.PI / 2);
    run(pw, car, 25, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 200);
    const p0 = car.position.clone();
    const v0 = car.body.linvel();
    const dir = { x: v0.x, z: v0.z };
    const dl = Math.hypot(dir.x, dir.z);
    const yaw0 = car.yaw;
    let maxYaw = 0;
    run(pw, car, 5, { throttle: 0.55, brake: 0, steer: 0, handbrake: 0 }, () => { maxYaw = Math.max(maxYaw, Math.abs(car.telemetry.yawRate)); });
    const p = car.position;
    const drift = Math.abs(((p.x - p0.x) * dir.z - (p.z - p0.z) * dir.x) / dl);
    console.log(`straight: drift ${drift.toFixed(3)} m, heading change ${((car.yaw - yaw0) * 57.3).toFixed(3)} deg, max yaw ${maxYaw.toFixed(4)}`);
    expect(drift).toBeLessThan(1.0);
    expect(maxYaw).toBeLessThan(0.05);
  });

  it('A6 holds a steady circle with ESC without spinning', () => {
    const { pw, car } = makeCar(0, 300);
    run(pw, car, 8, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 60);
    let maxSlip = 0;
    run(pw, car, 8, (t) => ({ throttle: kmh(car.telemetry.forwardSpeed) < 60 ? 0.6 : 0.25, brake: 0, steer: Math.min(1, t * 2) * 0.5, handbrake: 0 }), () => {
      maxSlip = Math.max(maxSlip, Math.abs(car.telemetry.bodySlip));
    });
    console.log(`circle: max body slip ${(maxSlip * 57.3).toFixed(1)} deg, speed ${kmh(car.telemetry.speed).toFixed(1)}`);
    expect(maxSlip).toBeLessThan(15 / 57.3);
    expect(car.isFlipped()).toBe(false);
  });

  it('A7 handbrake turn produces yaw and stays upright', () => {
    const { pw, car } = makeCar(0, 300);
    run(pw, car, 8, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 60);
    let peak = 0;
    run(pw, car, 1.5, { throttle: 0, brake: 0, steer: 0.6, handbrake: 1 }, () => { peak = Math.max(peak, Math.abs(car.telemetry.yawRate)); });
    run(pw, car, 3, { throttle: 0, brake: 0.3, steer: 0, handbrake: 0 });
    console.log(`handbrake: peak yaw ${peak.toFixed(2)} rad/s`);
    expect(peak).toBeGreaterThan(0.8);
    expect(car.isFlipped()).toBe(false);
  });

  it('A8 survives a ramp jump and settles upright', () => {
    // ramp at x=60, z=-300 rising toward -z
    const { pw, car } = makeCar(60, -150);
    let airborne = false, landedAt = -1, nan = false;
    let t = 0;
    run(pw, car, 14, (tt) => ({ throttle: kmh(car.telemetry.forwardSpeed) < 80 && landedAt < 0 ? 1 : 0, brake: landedAt >= 0 && tt - landedAt > 0.5 ? 0.6 : 0, steer: 0, handbrake: 0 }), (tt) => {
      t = tt;
      const p = car.position;
      if (!Number.isFinite(p.x + p.y + p.z)) { nan = true; return true; }
      if (car.telemetry.wheelsOnGround === 0 && car.position.z < -305) airborne = true;
      if (airborne && landedAt < 0 && car.telemetry.wheelsOnGround >= 3) landedAt = tt;
      if (landedAt >= 0 && tt - landedAt > 2.5) return true;
    });
    const vy = Math.abs(car.body.linvel().y);
    console.log(`jump: airborne ${airborne}, landed ${landedAt.toFixed(2)}, vy ${vy.toFixed(3)} at ${t.toFixed(2)}`);
    expect(nan).toBe(false);
    expect(airborne).toBe(true);
    expect(landedAt).toBeGreaterThan(0);
    expect(vy).toBeLessThan(0.2);
    expect(car.isFlipped()).toBe(false);
  });

  it('A9 resets from upside down', () => {
    const { pw, car } = makeCar(0, 0);
    car.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    run(pw, car, 1, { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
    expect(car.isFlipped()).toBe(true);
    car.reset(0, 0.8, 0, 0);
    expect(car.isFlipped()).toBe(false);
    expect(car.telemetry.speed).toBeLessThan(5);
    expect(car.body.linvel().y).toBe(0);
    run(pw, car, 1, { throttle: 0, brake: 1, steer: 0, handbrake: 0 });
    expect(car.position.y).toBeGreaterThan(0.3);
  });

  it('A10 is independent of render frame rate', () => {
    const results: { x: number; z: number }[] = [];
    for (const hz of [30, 60, 144]) {
      const { pw, car } = makeCar(0, 600);
      const clock = new FixedStep(120);
      let simT = 0;
      const frames = Math.round(6 * hz);
      for (let f = 0; f < frames; f++) {
        const n = clock.advance(1 / hz);
        for (let i = 0; i < n; i++) {
          const input = { throttle: simT < 4 ? 1 : 0, brake: 0, steer: simT > 2 && simT < 3.5 ? 0.3 : 0, handbrake: 0 };
          car.step(input, pw.dt);
          pw.step();
          simT += pw.dt;
        }
      }
      const p = car.position;
      results.push({ x: p.x, z: p.z });
    }
    console.log('frame pacing', results.map((r) => `${r.x.toFixed(2)},${r.z.toFixed(2)}`).join(' | '));
    for (const r of results) expect(Math.hypot(r.x - results[0].x, r.z - results[0].z)).toBeLessThan(0.5);
  });

  it('reverses when holding brake at a standstill (auto gearbox)', () => {
    const { pw, car } = makeCar(0, 0);
    run(pw, car, 3, { throttle: 0, brake: 1, steer: 0, handbrake: 0 });
    expect(car.gearbox.gear).toBe(-1);
    expect(car.telemetry.forwardSpeed).toBeLessThan(-1);
  });

  it('holds on a slope with the brake (static friction)', () => {
    // use the ramp: park facing downhill on the ramp surface
    const { pw, car } = makeCar(60, -150);
    car.reset(60, 1.6, -300, 0);
    run(pw, car, 3, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    const p0 = car.position.clone();
    run(pw, car, 2, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
    expect(car.position.distanceTo(p0)).toBeLessThan(0.15);
  });
});

describe('M3 Competition (G80 approximation)', () => {
  it('0-100 km/h, sane shifts and launch control', () => {
    const { pw, car } = makeCar(0, 900, 0, M3_COMP);
    let worst = 0;
    const t = run(pw, car, 12, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, (tt) => {
      if (tt > 0.3) worst = Math.max(worst, car.wheels[2].slipRatio, car.wheels[3].slipRatio);
      return kmh(car.telemetry.forwardSpeed) >= 100;
    });
    console.log(`M3 0-100: ${t.toFixed(2)} s, launch slip ${worst.toFixed(3)}`);
    expect(t).toBeGreaterThan(3.4);
    expect(t).toBeLessThan(4.8);
    expect(worst).toBeLessThan(0.45);
  });

  it('respects the 290 km/h limiter', () => {
    const { pw, car } = makeCar(-2800, 1150, -Math.PI / 2, M3_COMP);
    let gears = 0;
    car.onShift = (_g, up) => { if (up) gears++; };
    run(pw, car, 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
    const v = kmh(car.telemetry.forwardSpeed);
    console.log(`M3 top speed ${v.toFixed(1)} km/h, upshifts ${gears}`);
    expect(v).toBeGreaterThan(255);
    expect(v).toBeLessThan(293);
    expect(gears).toBeGreaterThanOrEqual(6);
  });

  it('brakes 100-0 km/h within band', () => {
    const { pw, car } = makeCar(0, 900, 0, M3_COMP);
    run(pw, car, 10, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, () => kmh(car.telemetry.forwardSpeed) >= 100);
    const start = car.position.clone();
    run(pw, car, 8, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, () => car.telemetry.speed < 0.3);
    const d = car.position.distanceTo(start);
    console.log(`M3 100-0: ${d.toFixed(1)} m`);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(40);
  });

  it('is stable at 200 km/h and holds a circle with ESC', () => {
    const a = makeCar(-2800, 0, -Math.PI / 2, M3_COMP);
    run(a.pw, a.car, 25, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, () => kmh(a.car.telemetry.forwardSpeed) >= 200);
    let maxYaw = 0;
    run(a.pw, a.car, 4, { throttle: 0.6, brake: 0, steer: 0, handbrake: 0 }, () => { maxYaw = Math.max(maxYaw, Math.abs(a.car.telemetry.yawRate)); });
    expect(maxYaw).toBeLessThan(0.05);
    const b = makeCar(0, 300, 0, M3_COMP);
    run(b.pw, b.car, 8, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 }, () => kmh(b.car.telemetry.forwardSpeed) >= 60);
    let slip = 0;
    run(b.pw, b.car, 8, (t) => ({ throttle: 0.3, brake: 0, steer: Math.min(1, t * 2) * 0.5, handbrake: 0 }), () => { slip = Math.max(slip, Math.abs(b.car.telemetry.bodySlip)); });
    expect(slip).toBeLessThan(15 / 57.3);
    expect(b.car.isFlipped()).toBe(false);
  });
});

describe('heading independence', () => {
  it('launches identically whatever the heading (regression: LSD oscillation off-axis)', () => {
    const speeds: number[] = [];
    for (const yaw of [0, 0.785, Math.PI / 2, 2.4, -2.4]) {
      const { pw, car } = makeCar(0, 0, yaw, M3_COMP);
      run(pw, car, 3, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
      speeds.push(kmh(car.telemetry.forwardSpeed));
      // rear wheels must not fight each other
      expect(Math.abs(car.wheels[2].omega - car.wheels[3].omega)).toBeLessThan(1);
    }
    console.log('3 s speeds by heading', speeds.map((v) => v.toFixed(1)).join(', '));
    for (const v of speeds) expect(Math.abs(v - speeds[0])).toBeLessThan(2);
    expect(speeds[0]).toBeGreaterThan(55);
  });
});
