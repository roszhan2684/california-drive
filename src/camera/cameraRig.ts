import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { G } from '../physics/groups.ts';
import { VIREO_MOUNTS, type CameraMounts, type MountName } from '../vehicle/carModel.ts';
import type { PhysicsWorld, RAPIER } from '../physics/world.ts';

export type CameraMode = 'chase' | 'close' | 'bumper' | 'hood' | 'cockpit' | 'dashboard' | 'wheel' | 'side' | 'orbit';

export const CAMERA_CYCLE: CameraMode[] = ['chase', 'close', 'hood', 'cockpit', 'dashboard', 'bumper', 'wheel', 'side'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Cinematic chase', close: 'Close chase', bumper: 'Bumper', hood: 'Hood', cockpit: 'Cockpit', dashboard: 'Dashboard',
  wheel: 'Wheel', side: 'Side tracking', orbit: 'Orbit / photo',
};

export function isInterior(m: CameraMode) {
  return m === 'cockpit' || m === 'dashboard';
}

export interface CameraTuning {
  chaseDistance: number;
  chaseHeight: number;
  closeDistance: number;
  closeHeight: number;
  stiffness: number;
  yawStiffness: number;
  lookAhead: number;
  fovKick: number;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  chaseDistance: 6.4, chaseHeight: 1.85, closeDistance: 4.4, closeHeight: 1.35, stiffness: 9, yawStiffness: 4.5, lookAhead: 0.12, fovKick: 16,
};

export interface CameraInput {
  dt: number;
  pos: Vector3;
  quat: Quaternion;
  vel: Vector3;
  speed: number;
  yawRate: number;
  steer: number;
  accel: number;
  lookBack: boolean;
  lookX: number;
  lookY: number;
  roughness: number;
}

const _m = new Matrix4();
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';
  /** Attached-camera mount points for the current car. */
  mounts: CameraMounts = VIREO_MOUNTS;
  baseFov = 62;
  reducedMotion = false;
  tuning: CameraTuning = { ...DEFAULT_CAMERA_TUNING };
  private physics: PhysicsWorld | null = null;
  private excludeBody: RAPIER.RigidBody | undefined;
  private smoothPos = new Vector3();
  private smoothYaw = 0;
  private initialized = false;
  private blendT = 1;
  private blendDur = 0.6;
  private fromPos = new Vector3();
  private fromQuat = new Quaternion();
  private fromFov = 62;
  private livePos = new Vector3();
  private liveQuat = new Quaternion();
  private trauma = 0;
  private time = 0;
  private headLook = { yaw: 0, pitch: 0, idle: 0 };
  orbit = { yaw: 0.6, pitch: 0.18, dist: 7.5 };
  private sidePos = new Vector3();
  /** Optional cinematic override (reveal sequence). */
  override: ((cam: PerspectiveCamera, dt: number) => void) | null = null;
  private lean = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(62, aspect, 0.08, 6000);
  }

  attach(physics: PhysicsWorld, body?: RAPIER.RigidBody) {
    this.physics = physics;
    this.excludeBody = body;
    this.initialized = false;
  }

  setMode(m: CameraMode, blend = true) {
    if (m === this.mode) return;
    this.startBlend(isInterior(m) || isInterior(this.mode) ? 0.35 : 0.65, blend);
    this.mode = m;
    this.headLook.yaw = this.headLook.pitch = 0;
    if (m === 'side') this.sidePos.set(NaN, 0, 0);
  }

  startBlend(dur: number, blend = true) {
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.blendDur = dur;
    this.blendT = blend ? 0 : 1;
  }

  next(dir = 1) {
    const i = CAMERA_CYCLE.indexOf(this.mode);
    this.setMode(CAMERA_CYCLE[(i + dir + CAMERA_CYCLE.length) % CAMERA_CYCLE.length]);
  }

  shake(amount: number) {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  mouseLook(dx: number, dy: number) {
    if (this.mode === 'orbit') {
      this.orbit.yaw -= dx * 0.005;
      this.orbit.pitch = MathUtils.clamp(this.orbit.pitch + dy * 0.004, -0.15, 1.3);
    } else {
      this.headLook.yaw = MathUtils.clamp(this.headLook.yaw - dx * 0.004, -2.2, 2.2);
      this.headLook.pitch = MathUtils.clamp(this.headLook.pitch - dy * 0.003, -0.6, 0.5);
      this.headLook.idle = 0;
    }
  }

  zoom(d: number) {
    this.orbit.dist = MathUtils.clamp(this.orbit.dist * (1 + d * 0.001), 3, 30);
  }

  update(inp: CameraInput) {
    const dt = inp.dt;
    this.time += dt;
    const cam = this.camera;
    if (this.override) {
      this.override(cam, dt);
      this.initialized = false;
      return;
    }
    _m.makeRotationFromQuaternion(inp.quat);
    _fwd.set(0, 0, -1).applyQuaternion(inp.quat);
    _right.set(1, 0, 0).applyQuaternion(inp.quat);
    _up.set(0, 1, 0).applyQuaternion(inp.quat);
    const flatF = _tmp.set(_fwd.x, 0, _fwd.z);
    if (flatF.lengthSq() < 1e-4) flatF.set(0, 0, -1);
    flatF.normalize();
    let targetYaw = Math.atan2(-flatF.x, -flatF.z);
    if (inp.speed > 4) {
      const vy = Math.atan2(-inp.vel.x, -inp.vel.z);
      const forwardish = inp.vel.dot(_fwd) > 0;
      if (forwardish) targetYaw = angleLerp(targetYaw, vy, 0.4 * MathUtils.clamp((inp.speed - 4) / 16, 0, 1));
    }
    if (!this.initialized) {
      this.smoothYaw = targetYaw;
      this.initialized = true;
      this.smoothPos.copy(inp.pos);
    }
    const ys = this.tuning.yawStiffness * (1 + inp.speed / 40);
    this.smoothYaw = angleLerp(this.smoothYaw, targetYaw, 1 - Math.exp(-ys * dt));
    const rm = this.reducedMotion;

    // idle head look returns to center
    this.headLook.idle += dt;
    if (this.headLook.idle > 1.6 && Math.abs(inp.lookX) < 0.01 && Math.abs(inp.lookY) < 0.01) {
      const k = 1 - Math.exp(-3 * dt);
      this.headLook.yaw -= this.headLook.yaw * k;
      this.headLook.pitch -= this.headLook.pitch * k;
    }
    if (Math.abs(inp.lookX) > 0.01 || Math.abs(inp.lookY) > 0.01) {
      this.headLook.yaw = MathUtils.clamp(this.headLook.yaw - inp.lookX * dt * 2.5, -2.2, 2.2);
      this.headLook.pitch = MathUtils.clamp(this.headLook.pitch - inp.lookY * dt * 1.5, -0.6, 0.5);
      this.headLook.idle = 0;
      if (this.mode === 'orbit') { this.orbit.yaw -= inp.lookX * dt * 2.5; this.orbit.pitch = MathUtils.clamp(this.orbit.pitch - inp.lookY * dt, -0.15, 1.3); }
    }

    let fov = this.baseFov;
    const pos = this.livePos;
    const look = _tmp2;
    let roll = 0;
    const m = this.mode;
    if (m === 'chase' || m === 'close') {
      const dist = m === 'chase' ? this.tuning.chaseDistance : this.tuning.closeDistance;
      const height = m === 'chase' ? this.tuning.chaseHeight : this.tuning.closeHeight;
      const back = new Vector3(Math.sin(this.smoothYaw), 0, Math.cos(this.smoothYaw));
      if (inp.lookBack) back.negate();
      // follow pitch on hills
      const pitchY = -_fwd.y * dist * 0.8;
      const desired = new Vector3().copy(inp.pos).addScaledVector(back, dist).add(new Vector3(0, height + (inp.lookBack ? 0 : pitchY), 0));
      if (this.headLook.yaw !== 0) desired.sub(inp.pos).applyAxisAngle(WORLD_UP, this.headLook.yaw).add(inp.pos);
      look.copy(inp.pos).addScaledVector(WORLD_UP, m === 'chase' ? 0.95 : 0.75);
      if (!inp.lookBack) look.addScaledVector(inp.vel, rm ? 0.05 : this.tuning.lookAhead).add(_fwd.clone().multiplyScalar(1.5));
      // spring
      const k = 1 - Math.exp(-this.tuning.stiffness * (rm ? 1.6 : 1) * dt);
      this.smoothPos.lerp(desired, k);
      // keep a fixed max lag distance so the car never leaves frame
      const off = this.smoothPos.clone().sub(desired);
      if (off.length() > dist * 0.6) this.smoothPos.copy(desired).add(off.setLength(dist * 0.6));
      pos.copy(this.smoothPos);
      // collision avoidance
      this.avoid(look, pos);
      fov += rm ? Math.min(inp.speed * 0.05, 4) : MathUtils.clamp(inp.speed * 0.2, 0, this.tuning.fovKick);
      if (!rm) roll = MathUtils.clamp(-inp.yawRate * inp.speed * 0.0035, -0.05, 0.05);
    } else if (m === 'side') {
      const want = new Vector3().copy(inp.pos).addScaledVector(_right, 7.5).add(new Vector3(0, 0.9, 0)).addScaledVector(_fwd, 2);
      if (!Number.isFinite(this.sidePos.x)) this.sidePos.copy(want);
      this.sidePos.lerp(want, 1 - Math.exp(-5 * dt));
      pos.copy(this.sidePos);
      look.copy(inp.pos).add(new Vector3(0, 0.5, 0));
      this.avoid(look, pos);
      fov = this.baseFov - 12;
    } else if (m === 'orbit') {
      const o = this.orbit;
      const tgt = new Vector3().copy(inp.pos).add(new Vector3(0, 0.6, 0));
      pos.set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(tgt);
      look.copy(tgt);
      this.avoid(look, pos);
      fov = this.baseFov - 8;
    } else {
      // attached cameras (local offsets in car space)
      const lo = this.mounts[m as MountName];
      // head lean with lateral/longitudinal g (cockpit only)
      if (m === 'cockpit' && !rm) {
        this.lean.lerp(new Vector3(MathUtils.clamp(-inp.yawRate * inp.speed * 0.004, -0.05, 0.05), 0, MathUtils.clamp(-inp.accel * 0.004, -0.04, 0.04)), 1 - Math.exp(-6 * dt));
      } else this.lean.set(0, 0, 0);
      pos.set(lo[0] + this.lean.x, lo[1], lo[2] + this.lean.z).applyQuaternion(inp.quat).add(inp.pos);
      let yawOff = this.headLook.yaw + (inp.lookBack ? Math.PI : 0);
      let pitchOff = this.headLook.pitch;
      if (m === 'cockpit' && !rm) yawOff += -inp.steer * 0.12;
      if (m === 'dashboard') pitchOff -= 0.22;
      if (m === 'wheel') yawOff += 0.06;
      const dir = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(1, 0, 0), pitchOff).applyAxisAngle(new Vector3(0, 1, 0), yawOff).applyQuaternion(inp.quat);
      look.copy(pos).addScaledVector(dir, 10);
      fov = m === 'dashboard' ? this.baseFov - 14 : m === 'cockpit' ? this.baseFov + 4 : m === 'bumper' ? this.baseFov + 8 : this.baseFov;
      if (!rm && (m === 'bumper' || m === 'hood')) fov += MathUtils.clamp(inp.speed * 0.15, 0, 12);
    }

    // build orientation
    _m.lookAt(pos, look, WORLD_UP);
    this.liveQuat.setFromRotationMatrix(_m);
    if (m !== 'chase' && m !== 'close' && m !== 'side' && m !== 'orbit') {
      // attached cameras roll with the car
      const carUpInCam = _up.clone();
      const fwdC = new Vector3(0, 0, -1).applyQuaternion(this.liveQuat);
      const rightC = new Vector3(1, 0, 0).applyQuaternion(this.liveQuat);
      const upProj = carUpInCam.sub(fwdC.multiplyScalar(carUpInCam.dot(fwdC))).normalize();
      roll = Math.atan2(-upProj.dot(rightC), upProj.dot(new Vector3(0, 1, 0).applyQuaternion(this.liveQuat)));
    }
    if (roll !== 0) this.liveQuat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));
    // shake: impacts + rough surfaces
    if (!rm) {
      const s = this.trauma * this.trauma * 0.6 + inp.roughness * Math.min(1, inp.speed / 25) * 0.08;
      if (s > 0.0005) {
        const t = this.time * 30;
        this.liveQuat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), noise1(t) * 0.02 * s));
        this.liveQuat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), noise1(t + 17) * 0.02 * s));
        pos.y += noise1(t + 41) * 0.05 * s;
      }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    // blend from previous camera
    // a blend from far away (spawn, skipped reveal, teleport) would sweep through the world: cut instead
    if (this.blendT < 1 && this.fromPos.distanceToSquared(this.livePos) > 60 * 60) this.blendT = 1;
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const t = this.blendT * this.blendT * (3 - 2 * this.blendT);
      cam.position.copy(this.fromPos).lerp(pos, t);
      cam.quaternion.copy(this.fromQuat).slerp(this.liveQuat, t);
      cam.fov = this.fromFov + (fov - this.fromFov) * t;
    } else {
      cam.position.copy(pos);
      cam.quaternion.copy(this.liveQuat);
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
    }
    cam.updateProjectionMatrix();
  }

  private avoid(target: Vector3, pos: Vector3) {
    if (!this.physics) return;
    const d = pos.clone().sub(target);
    const len = d.length();
    if (len < 0.01) return;
    d.divideScalar(len);
    const hit = this.physics.castRay(target.x, target.y, target.z, d.x, d.y, d.z, len, G.TERRAIN | G.STATIC | G.ROAD, this.excludeBody);
    if (hit) pos.copy(target).addScaledVector(d, Math.max(0.6, hit.toi - 0.35));
  }
}

function angleLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function noise1(x: number) {
  const i = Math.floor(x), f = x - i;
  const h = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
