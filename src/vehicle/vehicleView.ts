import { wheelBlurOpacity } from './carDetail.ts';
import { Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import type { VehicleSim } from '../physics/vehicle/vehicle.ts';
import { RPM_PER_RADS } from '../physics/vehicle/powertrain.ts';
import type { CarRig } from './carModel.ts';

export interface LightState {
  headlights: boolean;
  highBeam: boolean;
  indicator: -1 | 0 | 1;
  hazards: boolean;
  wipers: boolean;
  parkingBrake: boolean;
}

const _q = new Quaternion();
const _v = new Vector3();

/** Drives the procedural car mesh from simulation state (interpolated transform, wheels, lights, gauges). */
export class VehicleView {
  readonly rig: CarRig;
  lights: LightState = { headlights: false, highBeam: false, indicator: 0, hazards: false, wipers: false, parkingBrake: false };
  private time = 0;
  private gaugeTimer = 0;
  private heat = 0;
  wiperPhase = 0;
  /** 0..1 reveal ignition ramp for headlights/dash. */
  ignition = 1;
  interiorVisible = false;
  units: 'mph' | 'kmh' = 'mph';
  private wiperT = 0;

  constructor(rig: CarRig) {
    this.rig = rig;
  }

  get blink(): boolean {
    return Math.floor(this.time * 3) % 2 === 0;
  }

  update(dt: number, sim: VehicleSim, pos: Vector3, quat: Quaternion, brake: number, steerInput: number) {
    this.time += dt;
    const r = this.rig;
    r.root.position.copy(pos);
    r.root.quaternion.copy(quat);
    _q.copy(quat).invert();
    for (let i = 0; i < 4; i++) {
      const w = sim.wheels[i];
      const wr = r.wheels[i];
      _v.copy(w.center).sub(sim.position).applyQuaternion(_q);
      // the sim position is the latest physics state; correct for interpolation by using local offsets only
      wr.pivot.position.y += (_v.y - wr.pivot.position.y) * Math.min(1, dt * 30);
      wr.pivot.rotation.y = -w.steer;
      wr.spin.rotation.x = -w.spin;
      if (wr.blur) {
        const o = wheelBlurOpacity(w.omega);
        wr.blur.visible = o > 0.01;
        (wr.blur.material as MeshStandardMaterial).opacity = o;
      }
    }
    r.steeringWheel.rotation.z = -sim.steerAngle * 7.5;

    const L = this.lights;
    const ign = this.ignition;
    const blinkOn = this.blink;
    const head = L.headlights ? ign : 0;
    r.headlightMat.emissiveIntensity = head * (L.highBeam ? 7 : 4.5) + 0.0;
    if (r.drl) r.drl.emissiveIntensity = ign * (sim.engineOn ? 3.2 : 0.4);
    r.tailMat.emissiveIntensity = head * 2.2;
    const braking = brake > 0.05;
    r.brakeMat.emissiveIntensity = braking ? 7 : head * 1.4;
    const left = L.hazards || L.indicator === -1, right = L.hazards || L.indicator === 1;
    r.indicatorL.emissiveIntensity = left && blinkOn ? 6 : 0;
    r.indicatorR.emissiveIntensity = right && blinkOn ? 6 : 0;
    r.reverseMat.emissiveIntensity = sim.gearbox.gear === -1 ? 5 : 0;
    const spotI = head * (L.highBeam ? 260 : 150);
    r.spotL.intensity = spotI;
    r.spotR.intensity = spotI;
    r.spotL.distance = r.spotR.distance = L.highBeam ? 140 : 80;
    r.spotL.angle = r.spotR.angle = L.highBeam ? 0.38 : 0.5;
    r.spotL.visible = r.spotR.visible = spotI > 0;

    // brake heat glow (only visible after hard braking at speed)
    this.heat += brake * sim.telemetry.speed * dt * 0.012;
    this.heat -= this.heat * dt * 0.18;
    this.heat = Math.min(1.6, this.heat);
    r.discMat.emissiveIntensity = Math.max(0, this.heat - 0.55) * 3;

    // wipers: continuous sweep while on, park smoothly when switched off
    if (L.wipers) this.wiperT += dt * 2.4;
    else if (this.wiperPhase > 0.002) this.wiperT += dt * 2.4;
    else this.wiperT = 0;
    this.wiperPhase = (1 - Math.cos(this.wiperT)) / 2;
    const sweep = Math.sin(this.wiperPhase * Math.PI / 2) * 1.6;
    for (const w of r.wipers) w.rotation.y = sweep;

    // gauges
    this.gaugeTimer -= dt;
    if (this.interiorVisible && this.gaugeTimer <= 0) {
      this.gaugeTimer = 1 / 15;
      this.drawGauges(sim, left && blinkOn, right && blinkOn);
    }
    r.dashMat.color.setScalar(0.25 + 0.75 * ign);
    void steerInput;
  }

  private drawGauges(sim: VehicleSim, left: boolean, right: boolean) {
    const { ctx, tex, canvas } = this.rig.gauge;
    const t = sim.telemetry;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.62, R = H * 0.5;
    const maxRpm = sim.cfg.engine.limiterRpm;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1b222b';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    const frac = Math.min(1, t.rpm / maxRpm);
    const red = sim.cfg.engine.redlineRpm / maxRpm;
    ctx.strokeStyle = frac > red ? '#ff3b30' : '#f5a524';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac); ctx.stroke();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, R + 12, a0 + (a1 - a0) * red, a1); ctx.stroke();
    const spd = this.units === 'mph' ? t.speed * 2.23694 : t.speed * 3.6;
    ctx.fillStyle = '#e8eef5';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(spd)), cx, cy + 10);
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#8fa0b3';
    ctx.fillText(this.units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 40);
    const g = t.gear === -1 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillStyle = '#f5a524';
    ctx.fillText(g, W - 60, 60);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#8fa0b3';
    ctx.fillText(`${Math.round(t.rpm / 100) * 100} rpm`, 90, 50);
    ctx.fillStyle = '#2ecc71';
    if (left) ctx.fillText('◀', 40, H - 20);
    if (right) ctx.fillText('▶', W - 40, H - 20);
    if (this.lights.headlights) { ctx.fillStyle = this.lights.highBeam ? '#4aa3ff' : '#2ecc71'; ctx.fillText('◉', 90, H - 20); }
    if (t.absActive || t.tcsActive || t.escActive) { ctx.fillStyle = '#f5a524'; ctx.fillText(t.absActive ? 'ABS' : t.tcsActive ? 'TCS' : 'ESC', W - 90, H - 20); }
    void RPM_PER_RADS;
    tex.needsUpdate = true;
  }
}
