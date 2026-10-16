import { Quaternion, Vector3 } from 'three';
import { RAPIER, G, groups, PhysicsWorld, SURFACE_GRIP, type Surface } from '../world.ts';
import { DEFAULT_ASSISTS, type AssistSettings, type VehicleConfig } from './config.ts';
import { Gearbox, RPM_PER_RADS, engineTorque } from './powertrain.ts';
import { tireForce, type TireForce } from './tire.ts';

export interface DriveInput {
  throttle: number;
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: number;
  gearUp?: boolean;
  gearDown?: boolean;
}

export const NO_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

export interface WheelState {
  contact: boolean;
  compression: number;
  prevCompression: number;
  load: number;
  omega: number;
  /** Accumulated spin angle for visuals. */
  spin: number;
  steer: number;
  slipRatio: number;
  slipAngle: number;
  slip: number;
  fx: number;
  fy: number;
  surface: Surface;
  /** World-space wheel center. */
  center: Vector3;
  /** World-space contact point. */
  contactPoint: Vector3;
  normal: Vector3;
  absScale: number;
  /** Lateral/longitudinal slide speed at the contact patch (m/s), drives skid VFX/audio. */
  slideSpeed: number;
}

export interface Telemetry {
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  yawRate: number;
  bodySlip: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  shifting: boolean;
  absActive: boolean;
  tcsActive: boolean;
  escActive: boolean;
  wheelsOnGround: number;
  airborneTime: number;
  engineOn: boolean;
  limiter: boolean;
  load: number;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _anchor = new Vector3();
const _f = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const _force = new Vector3();
const _vel = new Vector3();
const _tf: TireForce = { fx: 0, fy: 0, slip: 0 };

const RAY_LIFT = 0.3;
const WHEEL_SUBSTEPS = 6;

export class VehicleSim {
  readonly cfg: VehicleConfig;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: WheelState[];
  readonly gearbox: Gearbox;
  readonly telemetry: Telemetry;
  assists: AssistSettings = { ...DEFAULT_ASSISTS };
  /** Multiplier for weather (wet/snow). */
  gripScale = 1;
  engineOn = true;
  engineRpm: number;
  steerAngle = 0;
  /** When true, wheel rays and chassis ignore terrain (inside tunnels). */
  ignoreTerrain = false;
  private physics: PhysicsWorld;
  private tcsFactor = 1;
  private reverseHold = 0;
  private wheelBase: number;
  private prevGear = 1;
  onShift?: (gear: number, up: boolean) => void;

  constructor(physics: PhysicsWorld, cfg: VehicleConfig, x: number, y: number, z: number, yaw: number) {
    this.physics = physics;
    this.cfg = cfg;
    const fz = cfg.wheels.filter((w) => w.front)[0].z;
    const rz = cfg.wheels.filter((w) => !w.front)[0].z;
    this.wheelBase = Math.abs(rz - fz);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.15)
      .setLinearDamping(0.0);
    this.body = physics.world.createRigidBody(desc);
    const he = cfg.halfExtents;
    const cd = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setDensity(0)
      .setFriction(0.25)
      .setRestitution(0.08)
      .setCollisionGroups(groups(G.CHASSIS, G.TERRAIN | G.ROAD | G.STATIC | G.TRAFFIC | G.BOUNDS | G.PROP))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(9000);
    this.collider = physics.world.createCollider(cd, this.body);
    physics.setSurface(this.collider, 'vehicle');
    this.body.setAdditionalMassProperties(cfg.mass, cfg.com, cfg.inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.gearbox = new Gearbox(cfg.gearbox);
    this.engineRpm = cfg.engine.idleRpm;
    this.wheels = cfg.wheels.map(() => ({
      contact: false, compression: 0, prevCompression: 0, load: 0, omega: 0, spin: 0, steer: 0,
      slipRatio: 0, slipAngle: 0, slip: 0, fx: 0, fy: 0, surface: 'asphalt' as Surface,
      center: new Vector3(), contactPoint: new Vector3(), normal: new Vector3(0, 1, 0), absScale: 1, slideSpeed: 0,
    }));
    this.telemetry = {
      speed: 0, forwardSpeed: 0, lateralSpeed: 0, yawRate: 0, bodySlip: 0, rpm: this.engineRpm, gear: 1, throttle: 0, brake: 0,
      shifting: false, absActive: false, tcsActive: false, escActive: false, wheelsOnGround: 0, airborneTime: 0, engineOn: true, limiter: false, load: 0,
    };
  }

  setIgnoreTerrain(v: boolean) {
    if (v === this.ignoreTerrain) return;
    this.ignoreTerrain = v;
    const filter = (v ? 0 : G.TERRAIN) | G.ROAD | G.STATIC | G.TRAFFIC | G.BOUNDS | G.PROP;
    this.collider.setCollisionGroups(groups(G.CHASSIS, filter));
  }

  reset(x: number, y: number, z: number, yaw: number) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (const w of this.wheels) {
      w.omega = 0; w.compression = 0; w.prevCompression = 0; w.slip = 0; w.slipRatio = 0; w.slipAngle = 0; w.slideSpeed = 0; w.absScale = 1;
    }
    this.steerAngle = 0;
    this.tcsFactor = 1;
    this.gearbox.gear = 1;
    this.gearbox.shiftTimer = 0;
    this.engineRpm = this.cfg.engine.idleRpm;
  }

  get position(): Vector3 {
    const t = this.body.translation();
    return new Vector3(t.x, t.y, t.z);
  }

  get quaternion(): Quaternion {
    const r = this.body.rotation();
    return new Quaternion(r.x, r.y, r.z, r.w);
  }

  /** Heading yaw (rad), 0 = facing -z. */
  get yaw(): number {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(0, 0, -1).applyQuaternion(_q);
    return Math.atan2(-_v.x, -_v.z);
  }

  /** Advance vehicle forces for one fixed physics step. Call before PhysicsWorld.step(). */
  step(input: DriveInput, dt: number) {
    const cfg = this.cfg;
    const body = this.body;
    body.resetForces(false);
    body.resetTorques(false);

    const t = body.translation();
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _right.set(1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    const lv = body.linvel();
    const av = body.angvel();
    _vel.set(lv.x, lv.y, lv.z);
    const vF = _vel.dot(_fwd);
    const vR = _vel.dot(_right);
    const speed = _vel.length();
    const yawRate = -(av.x * _up.x + av.y * _up.y + av.z * _up.z); // + = turning right

    // ---------- gear selection & pedal mapping ----------
    const gb = this.gearbox;
    gb.update(dt);
    let throttle = Math.min(1, Math.max(0, input.throttle));
    let brake = Math.min(1, Math.max(0, input.brake));
    if (this.assists.autoGearbox) {
      if (gb.gear >= 1 && vF < 0.8 && brake > 0.3 && throttle < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.25) { gb.shiftTo(-1); this.reverseHold = 0; }
      } else if (gb.gear === -1 && vF > -0.8 && throttle > 0.3 && brake < 0.1) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.15) { gb.shiftTo(1); this.reverseHold = 0; }
      } else this.reverseHold = 0;
      if (gb.gear === -1) { const tmp = throttle; throttle = brake; brake = tmp; }
    } else {
      if (input.gearUp) gb.shiftTo(gb.gear === -1 ? 0 : gb.gear + 1);
      if (input.gearDown) gb.shiftTo(gb.gear - 1);
    }
    if (!this.engineOn) throttle = 0;
    if (cfg.topSpeed && vF > cfg.topSpeed && gb.gear > 0) throttle = 0;

    // ---------- steering ----------
    const lock = cfg.steering.maxAngle / (1 + Math.abs(vF) / cfg.steering.halfLockSpeed);
    let target = Math.max(-1, Math.min(1, input.steer)) * lock;
    const bodySlip = speed > 3 ? Math.atan2(vR, Math.abs(vF)) : 0;
    if (this.assists.steerAssist && speed > 4 && vF > 0) {
      target += cfg.assists.steerAssistGain * bodySlip * (1 - Math.min(1, Math.abs(input.steer)) * 0.5);
    }
    target = Math.max(-cfg.steering.maxAngle, Math.min(cfg.steering.maxAngle, target));
    const maxD = cfg.steering.rate * dt;
    this.steerAngle += Math.max(-maxD, Math.min(maxD, target - this.steerAngle));

    // ---------- suspension rays ----------
    const sus = cfg.suspension;
    const rayMask = (this.ignoreTerrain ? 0 : G.TERRAIN) | G.ROAD | G.STATIC | G.TRAFFIC | G.PROP;
    const rayLen = RAY_LIFT + sus.restLength + cfg.wheelRadius;
    let onGround = 0;
    for (let i = 0; i < 4; i++) {
      const wd = cfg.wheels[i];
      const w = this.wheels[i];
      _anchor.set(wd.x, wd.y, wd.z).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
      const ox = _anchor.x + _up.x * RAY_LIFT, oy = _anchor.y + _up.y * RAY_LIFT, oz = _anchor.z + _up.z * RAY_LIFT;
      const hit = this.physics.castRay(ox, oy, oz, -_up.x, -_up.y, -_up.z, rayLen, rayMask, body);
      w.prevCompression = w.compression;
      let susLen = sus.restLength;
      if (hit && hit.ny * _up.y + hit.nx * _up.x + hit.nz * _up.z > 0.35) {
        susLen = Math.max(0, hit.toi - RAY_LIFT - cfg.wheelRadius);
        if (susLen < sus.restLength) {
          w.contact = true;
          w.compression = sus.restLength - susLen;
          w.surface = hit.surface;
          w.normal.set(hit.nx, hit.ny, hit.nz);
          w.contactPoint.set(ox - _up.x * hit.toi, oy - _up.y * hit.toi, oz - _up.z * hit.toi);
          onGround++;
        } else {
          w.contact = false; w.compression = 0; susLen = sus.restLength;
        }
      } else {
        w.contact = false;
        w.compression = 0;
      }
      w.center.copy(_anchor).addScaledVector(_up, -susLen);
    }

    // loads: spring + damper + anti-roll
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) { w.load = 0; continue; }
      const front = cfg.wheels[i].front;
      const k = front ? sus.stiffnessFront : sus.stiffnessRear;
      const compVel = (w.compression - w.prevCompression) / dt;
      const c = compVel > 0 ? (front ? sus.bumpDampFront : sus.bumpDampRear) : front ? sus.reboundDampFront : sus.reboundDampRear;
      let f = k * w.compression + c * compVel;
      if (w.compression > sus.maxTravel) f += (w.compression - sus.maxTravel) * k * 10;
      w.load = Math.max(0, f);
    }
    for (const [a, b, k] of [[0, 1, sus.antiRollFront], [2, 3, sus.antiRollRear]] as const) {
      const wa = this.wheels[a], wb = this.wheels[b];
      if (!wa.contact || !wb.contact) continue;
      const arb = (wa.compression - wb.compression) * k;
      wa.load = Math.max(0, wa.load + arb);
      wb.load = Math.max(0, wb.load - arb);
    }

    // ---------- engine & drivetrain ----------
    const eng = cfg.engine;
    const ratio = gb.ratio();
    const drivenOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    const wheelRpm = Math.abs(drivenOmega * ratio) * RPM_PER_RADS;
    let limiter = false;
    if (!this.engineOn) {
      this.engineRpm = Math.max(0, this.engineRpm - 3000 * dt);
    } else if (ratio === 0 || gb.shifting) {
      const free = eng.idleRpm + throttle * (eng.limiterRpm - eng.idleRpm);
      this.engineRpm += (free - this.engineRpm) * Math.min(1, dt * (gb.shifting ? 6 : 4));
    } else {
      const clutchRpm = eng.idleRpm + throttle * 2600;
      const target2 = Math.max(wheelRpm, wheelRpm < clutchRpm ? clutchRpm * (1 - Math.min(1, wheelRpm / clutchRpm) * 0.35) : eng.idleRpm);
      this.engineRpm += (target2 - this.engineRpm) * Math.min(1, dt * 18);
    }
    if (this.engineOn && this.engineRpm >= eng.limiterRpm) { throttle = 0; limiter = true; }
    // TCS: feed-forward torque limit from rear tire loads + gentle slip feedback
    let tcsActive = false;
    let tcsLimit = 1;
    if (this.assists.tcs && throttle > 0 && ratio !== 0) {
      const wl = this.wheels[2], wr = this.wheels[3];
      const grip = (SURFACE_GRIP[wl.surface] + SURFACE_GRIP[wr.surface]) * 0.5 * this.gripScale;
      const usable = (wl.load + wr.load) * cfg.tire.mu * grip * cfg.wheelRadius * 1.08;
      const full = engineTorque(eng.torqueCurve, Math.max(this.engineRpm, eng.idleRpm)) * Math.abs(ratio) * cfg.gearbox.efficiency;
      if (usable > 0 && full > usable * 0.95) tcsLimit = (usable * 0.95) / full;
      const ks = Math.max(wl.slipRatio, wr.slipRatio) * Math.sign(ratio);
      if (ks > cfg.assists.tcsSlip) this.tcsFactor = Math.max(0.25, this.tcsFactor - dt * 8);
      else this.tcsFactor = Math.min(1, this.tcsFactor + dt * 2.5);
      tcsActive = tcsLimit < 0.98 && throttle > tcsLimit || this.tcsFactor < 0.95;
    } else this.tcsFactor = Math.min(1, this.tcsFactor + dt * 3);
    const thr = Math.min(throttle, tcsLimit) * this.tcsFactor;
    let engineT = 0;
    if (this.engineOn && !gb.shifting && ratio !== 0) {
      const rpm = Math.max(this.engineRpm, eng.idleRpm);
      engineT = thr * engineTorque(eng.torqueCurve, rpm) - (1 - thr) * eng.engineBrakeNm * Math.min(1, rpm / eng.redlineRpm);
      if (wheelRpm < eng.idleRpm * 1.05 && thr < 0.05) engineT = Math.max(0, engineT); // clutch open at crawl
    }
    const wheelT = engineT * ratio * cfg.gearbox.efficiency;
    // LSD split
    const dOmega = this.wheels[2].omega - this.wheels[3].omega;
    const lockT = cfg.diff.preloadNm + cfg.diff.lockRatio * Math.abs(wheelT);
    // Coupling gain is capped so one step removes at most ~40% of the speed difference: the explicit
    // dOmega*350 term overshot (≈4× per step at 120 Hz) and made the rear wheels oscillate against each
    // other whenever left/right were not bit-for-bit symmetric (i.e. any heading other than due north).
    const lsdGain = Math.min(350, (0.4 * cfg.wheelInertia) / dt);
    const transfer = Math.max(-lockT, Math.min(lockT, dOmega * lsdGain));
    const driveT = [0, 0, wheelT / 2 - transfer, wheelT / 2 + transfer];

    // ---------- brakes, ABS, ESC ----------
    const br = cfg.brakes;
    const brakeT = [
      (brake * br.maxTorque * br.frontBias) / 2, (brake * br.maxTorque * br.frontBias) / 2,
      (brake * br.maxTorque * (1 - br.frontBias)) / 2, (brake * br.maxTorque * (1 - br.frontBias)) / 2,
    ];
    let absActive = false;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (this.assists.abs && brake > 0 && Math.abs(vF) > 2.5 && w.slipRatio < -cfg.assists.absSlip) {
        w.absScale = Math.max(0.15, w.absScale - dt * 30); absActive = true;
      } else w.absScale = Math.min(1, w.absScale + dt * 12);
      brakeT[i] *= w.absScale;
    }
    // TCS brake intervention on a spinning driven wheel (like a real traction-control system)
    if (this.assists.tcs && ratio !== 0) {
      for (const i of [2, 3]) {
        const k = this.wheels[i].slipRatio * Math.sign(ratio);
        if (k > cfg.assists.tcsSlip * 1.6) { brakeT[i] += Math.min(1500, (k - cfg.assists.tcsSlip * 1.6) * 6000); tcsActive = true; }
      }
    }
    const hb = Math.min(1, Math.max(0, input.handbrake));
    if (hb > 0) { brakeT[2] += hb * br.handbrakeTorque; brakeT[3] += hb * br.handbrakeTorque; }

    let escActive = false;
    if (this.assists.esc && hb < 0.1 && vF > 6) {
      const muG = cfg.tire.mu * 9.81 * this.gripScale;
      let rTarget = (vF * Math.tan(this.steerAngle)) / this.wheelBase;
      rTarget = Math.max(-muG / vF, Math.min(muG / vF, rTarget));
      const err = yawRate - rTarget;
      const margin = cfg.assists.escYawMargin;
      if (Math.abs(err) > margin && Math.sign(err) === Math.sign(yawRate || err)) {
        // oversteer: brake the outer front wheel
        const outer = yawRate > 0 ? 0 : 1;
        brakeT[outer] += Math.min(3000, cfg.assists.escGain * (Math.abs(err) - margin));
        this.tcsFactor = Math.min(this.tcsFactor, 0.5);
        escActive = true;
      } else if (Math.abs(bodySlip) > 0.2) {
        const outer = bodySlip > 0 ? 1 : 0;
        brakeT[outer] += Math.min(2500, cfg.assists.escGain * (Math.abs(bodySlip) - 0.2) * 3);
        this.tcsFactor = Math.min(this.tcsFactor, 0.4);
        escActive = true;
      }
    }

    // ---------- tires ----------
    const r0 = cfg.wheelRadius;
    const I = cfg.wheelInertia;
    const h = dt / WHEEL_SUBSTEPS;
    const massShare = cfg.mass / 4;
    const ack = cfg.steering.ackermann;
    for (let i = 0; i < 4; i++) {
      const wd = cfg.wheels[i];
      const w = this.wheels[i];
      let delta = 0;
      if (wd.front) {
        const inner = this.steerAngle > 0 ? !wd.left : wd.left;
        delta = this.steerAngle * (inner ? 1 + ack : 1 - ack);
      }
      w.steer = delta;
      if (!w.contact) {
        // free wheel: driven wheels spin up with drive torque, brakes stop it
        w.omega += (driveT[i] / I) * dt;
        const bd = (brakeT[i] / I) * dt + 0.5 * dt;
        w.omega = Math.abs(w.omega) <= bd ? 0 : w.omega - Math.sign(w.omega) * bd;
        w.omega = Math.max(-250, Math.min(250, w.omega));
        w.fx = 0; w.fy = 0; w.slip = 0; w.slideSpeed = 0; w.slipRatio = 0; w.slipAngle = 0;
        w.spin += w.omega * dt;
        continue;
      }
      _n.copy(w.normal);
      _f.copy(_fwd).multiplyScalar(Math.cos(delta)).addScaledVector(_right, Math.sin(delta));
      _f.addScaledVector(_n, -_f.dot(_n)).normalize();
      _s.copy(_f).cross(_n).normalize();
      const pv = body.velocityAtPoint({ x: w.contactPoint.x, y: w.contactPoint.y, z: w.contactPoint.z });
      _v2.set(pv.x, pv.y, pv.z);
      const vLong = _v2.dot(_f);
      const vLat = _v2.dot(_s);
      const grip = SURFACE_GRIP[w.surface] * this.gripScale;
      const latScale = wd.front ? 1 : cfg.tire.rearLatGrip;
      const denom = Math.max(Math.abs(vLong), 2.5);
      let fxSum = 0, fySum = 0, slipSum = 0;
      for (let sstep = 0; sstep < WHEEL_SUBSTEPS; sstep++) {
        const kappa = (w.omega * r0 - vLong) / denom;
        const alpha = Math.atan2(vLat, denom);
        tireForce(cfg.tire, kappa, alpha, w.load, grip, latScale, _tf);
        fxSum += _tf.fx; fySum += _tf.fy; slipSum += _tf.slip;
        w.slipRatio = kappa; w.slipAngle = alpha;
        let om = w.omega + (h * (driveT[i] - _tf.fx * r0)) / I;
        const bd = (h * brakeT[i]) / I;
        if (Math.abs(om) <= bd) om = 0;
        else om -= Math.sign(om) * bd;
        w.omega = om;
      }
      let fx = fxSum / WHEEL_SUBSTEPS;
      let fy = fySum / WHEEL_SUBSTEPS;
      w.slip = slipSum / WHEEL_SUBSTEPS;
      // rolling resistance
      fx -= cfg.tire.rollingResistance * w.load * Math.tanh(vLong * 2);
      // low-speed blend: viscous lateral grip avoids jitter, static hold when braking
      const maxF = cfg.tire.mu * grip * w.load;
      const absV = Math.abs(vLong);
      if (absV < 2.5) {
        const visc = Math.max(-maxF, Math.min(maxF, (-vLat * massShare) / dt * 0.35));
        const blend = absV / 2.5;
        fy = fy * blend + visc * (1 - blend);
      }
      const holding = (brakeT[i] > 50 || hb > 0.1) && absV < 0.7 && Math.abs(driveT[i]) < 50;
      if (holding) {
        fx = Math.max(-maxF, Math.min(maxF, (-vLong * massShare) / dt * 0.35));
        w.omega = 0;
      }
      w.fx = fx; w.fy = fy;
      w.slideSpeed = Math.hypot(w.omega * r0 - vLong, vLat);
      _force.copy(_f).multiplyScalar(fx).addScaledVector(_s, fy);
      // suspension along chassis up; tire forces at the contact patch raised slightly (roll-center approximation)
      _force.addScaledVector(_up, w.load);
      _v.copy(w.contactPoint).addScaledVector(_up, 0.12);
      body.addForceAtPoint({ x: _force.x, y: _force.y, z: _force.z }, { x: _v.x, y: _v.y, z: _v.z }, false);
      w.spin += w.omega * dt;
    }

    // ---------- aero ----------
    const rho = 1.225;
    const drag = 0.5 * rho * cfg.aero.cdA * speed;
    body.addForce({ x: -_vel.x * drag, y: -_vel.y * drag, z: -_vel.z * drag }, false);
    const down = 0.5 * rho * cfg.aero.clA * vF * vF;
    if (down > 0) {
      const fwdShare = cfg.aero.frontDownforceShare;
      const fzA = cfg.wheels[0].z, rzA = cfg.wheels[2].z;
      _v.set(0, 0, fzA).applyQuaternion(_q).add(_v2.set(t.x, t.y, t.z));
      body.addForceAtPoint({ x: -_up.x * down * fwdShare, y: -_up.y * down * fwdShare, z: -_up.z * down * fwdShare }, { x: _v.x, y: _v.y, z: _v.z }, false);
      _v.set(0, 0, rzA).applyQuaternion(_q).add(_v2.set(t.x, t.y, t.z));
      const rs = 1 - fwdShare;
      body.addForceAtPoint({ x: -_up.x * down * rs, y: -_up.y * down * rs, z: -_up.z * down * rs }, { x: _v.x, y: _v.y, z: _v.z }, false);
    }

    // ---------- auto gearbox ----------
    if (this.assists.autoGearbox && this.engineOn) gb.auto(this.engineRpm, throttle, brake, vF);
    if (gb.gear !== this.prevGear) {
      this.onShift?.(gb.gear, gb.gear > this.prevGear);
      this.prevGear = gb.gear;
    }

    // ---------- telemetry ----------
    const tm = this.telemetry;
    tm.speed = speed;
    tm.forwardSpeed = vF;
    tm.lateralSpeed = vR;
    tm.yawRate = yawRate;
    tm.bodySlip = bodySlip;
    tm.rpm = this.engineRpm;
    tm.gear = gb.gear;
    tm.throttle = thr;
    tm.brake = brake;
    tm.shifting = gb.shifting;
    tm.absActive = absActive;
    tm.tcsActive = tcsActive;
    tm.escActive = escActive;
    tm.wheelsOnGround = onGround;
    tm.airborneTime = onGround === 0 ? tm.airborneTime + dt : 0;
    tm.engineOn = this.engineOn;
    tm.limiter = limiter;
    tm.load = this.engineOn ? Math.max(0, engineT) / 530 : 0;
  }

  /** True when the car is upside down or on its side. */
  isFlipped(): boolean {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    return _up.set(0, 1, 0).applyQuaternion(_q).y < 0.3;
  }

  dispose() {
    this.physics.world.removeRigidBody(this.body);
  }
}
