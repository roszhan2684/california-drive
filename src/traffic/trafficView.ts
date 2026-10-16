import { Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3, type Scene } from 'three';
import type { Materials } from '../render/materials.ts';
import { isResponding, trafficVariants, TRAFFIC_COLORS } from '../vehicle/trafficModels.ts';
import type { TrafficSystem } from './traffic.ts';

const _m = new Matrix4();
const _w = new Matrix4();
const _t = new Matrix4();
const _q = new Quaternion();
const _qp = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);
const _mirror = new Matrix4().makeScale(-1, 1, 1);
const _flip = new Matrix4().makeRotationY(Math.PI);
const WHITE = new Color(1, 1, 1);

/**
 * Instanced rendering of traffic agents. Per variant: body, lights, spinning wheels and
 * blinking turn indicators; plus one shared blob contact shadow per car.
 */
export class TrafficView {
  private bodies: InstancedMesh[] = [];
  private lights: InstancedMesh[] = [];
  private wheels: InstancedMesh[] = [];
  private blinkers: InstancedMesh[] = [];
  /** Lightbar halves for emergency variants (null for everything else). */
  private beacons: ([InstancedMesh, InstancedMesh] | null)[] = [];
  private shadows: InstancedMesh;
  private colors = TRAFFIC_COLORS.map((c) => new Color(c));
  private lc = new Color();
  private time = 0;

  constructor(scene: Scene, mats: Materials, cap: number) {
    for (const v of trafficVariants()) {
      const b = new InstancedMesh(v.bare, mats.parkedBody, cap);
      b.castShadow = true;
      b.receiveShadow = true;
      const l = new InstancedMesh(v.lights, mats.vehicleLights, cap);
      const w = new InstancedMesh(v.wheel, mats.parkedBody, cap * 4);
      w.castShadow = true;
      const k = new InstancedMesh(v.indicators, mats.vehicleLights, cap * 2);
      for (const m of [b, l, w, k]) { m.frustumCulled = false; m.count = 0; }
      // wheel colours come from vertex colours only
      for (let i = 0; i < cap * 4; i++) w.setColorAt(i, WHITE);
      scene.add(b, l, w, k);
      if (v.beaconL && v.beaconR) {
        const pair: [InstancedMesh, InstancedMesh] = [new InstancedMesh(v.beaconL, mats.vehicleLights, cap), new InstancedMesh(v.beaconR, mats.vehicleLights, cap)];
        for (const m of pair) { m.frustumCulled = false; m.count = 0; scene.add(m); }
        this.beacons.push(pair);
      } else this.beacons.push(null);
      this.bodies.push(b);
      this.lights.push(l);
      this.wheels.push(w);
      this.blinkers.push(k);
    }
    this.shadows = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mats.contactShadow, cap);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.userData.noAO = true;
    this.shadows.count = 0;
    scene.add(this.shadows);
  }

  update(sys: TrafficSystem, night: number, dt = 1 / 60) {
    this.time += dt;
    const vars = trafficVariants();
    const counts = this.bodies.map(() => 0);
    const blinkCounts = this.bodies.map(() => 0);
    let ns = 0;
    for (const a of sys.agents) {
      const vi = a.variant % this.bodies.length;
      const i = counts[vi];
      if (i >= this.bodies[vi].instanceMatrix.count) continue;
      counts[vi]++;
      const v = vars[vi];
      _q.setFromAxisAngle(_y, -a.heading).multiply(_qp.setFromAxisAngle(_x, a.pitch));
      _m.compose(_p.set(a.x, a.y, a.z), _q, _s);
      this.bodies[vi].setMatrixAt(i, _m);
      this.bodies[vi].setColorAt(i, v.tint === false ? WHITE : this.colors[a.color % this.colors.length]);
      const bc = this.beacons[vi];
      if (bc) {
        // responding units: alternating left/right double-strobe; others show a dim, unlit bar
        let l = 0.25, r = 0.25;
        if (isResponding(a.id, v.emergency)) {
          const ph = (this.time * 1.6 + a.id * 0.173) % 1;
          const strobe = (ph * 6) % 1 < 0.55 ? 1 : 0.15;
          const on = 3.2 + night * 2;
          l = ph < 0.5 ? on * strobe : 0.2;
          r = ph >= 0.5 ? on * strobe : 0.2;
        }
        bc[0].setMatrixAt(i, _m);
        bc[1].setMatrixAt(i, _m);
        bc[0].setColorAt(i, this.lc.setScalar(l));
        bc[1].setColorAt(i, this.lc.setScalar(r));
      }
      this.lights[vi].setMatrixAt(i, _m);
      const lvl = 0.12 + night * 1.6 + (a.braking ? 1.6 : 0);
      this.lights[vi].setColorAt(i, this.lc.setScalar(lvl));
      // wheels: hub offset → steer (front) → spin about the axle → face the rim outward
      const wp = v.wheelPos;
      for (let k = 0; k < 4; k++) {
        _w.makeTranslation(wp[k * 3], wp[k * 3 + 1], wp[k * 3 + 2]);
        if (k < 2) _w.multiply(_t.makeRotationY(-a.steer));
        _w.multiply(_t.makeRotationX(-a.wheelRot));
        if (wp[k * 3] < 0) _w.multiply(_flip);
        this.wheels[vi].setMatrixAt(i * 4 + k, _t.multiplyMatrices(_m, _w));
      }
      // indicators (~1.5 Hz) and hazards when startled
      const sides = a.startled > 0 ? 2 : a.signal;
      if (sides !== 0 && (this.time * 1.5 + a.id * 0.37) % 1 < 0.55) {
        const bk = this.blinkers[vi];
        if (sides === 1 || sides === 2) bk.setMatrixAt(blinkCounts[vi]++, _m);
        if (sides === -1 || sides === 2) bk.setMatrixAt(blinkCounts[vi]++, _t.multiplyMatrices(_m, _mirror));
      }
      // contact shadow
      _m.compose(_p.set(a.x, a.y + 0.04, a.z), _q, _s.set(v.width + 0.5, 1, v.length + 0.7));
      this.shadows.setMatrixAt(ns++, _m);
      _s.set(1, 1, 1);
    }
    const blink = 2.2 + night * 1.2;
    this.bodies.forEach((b, vi) => {
      b.count = counts[vi];
      this.lights[vi].count = b.count;
      this.wheels[vi].count = b.count * 4;
      const bk = this.blinkers[vi];
      bk.count = blinkCounts[vi];
      for (let j = 0; j < bk.count; j++) bk.setColorAt(j, this.lc.setScalar(blink));
      const bc = this.beacons[vi];
      if (bc) bc[0].count = bc[1].count = b.count;
      for (const m of [b, this.lights[vi], this.wheels[vi], bk, ...(bc ?? [])]) {
        m.visible = m.count > 0;
        if (!m.visible) continue;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
    this.shadows.count = ns;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [...this.bodies, ...this.lights, ...this.wheels, ...this.blinkers, ...this.beacons.flatMap((b) => b ?? [])]) { m.removeFromParent(); m.dispose(); }
    this.shadows.geometry.dispose();
    this.shadows.removeFromParent();
    this.shadows.dispose();
  }
}
