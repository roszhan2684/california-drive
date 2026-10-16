import { BoxGeometry, Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Scene } from 'three';
import type { Materials } from '../render/materials.ts';
import type { PedestrianSystem } from './pedestrians.ts';

// Clothing / skin palettes (generic, muted street colours with a few accents).
const SHIRTS = ['#2b2d31', '#e9e6df', '#1f3a5f', '#6b6f73', '#8a2d2d', '#3d5a40', '#c7a76c', '#4a3b5c', '#d8c7a9', '#151618', '#9fb4c7', '#b5542e', '#e2b13c', '#5d7d8c', '#704b36', '#c0c4c8'];
const PANTS = ['#1d2027', '#2f3b52', '#3a3a3a', '#5a4a3a', '#b9ab8e', '#24272c', '#45505e', '#121314'];
const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86e4a', '#8a5638', '#5e3a26', '#f5d6bc', '#d29b74'];

const _m = new Matrix4();
const _b = new Matrix4();
const _l = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _y = new Vector3(0, 1, 0);
const _c = new Color();

/** Code-animated, instanced pedestrians: torso, head, two legs, two arms and a blob shadow. */
export class PedestrianView {
  private torso: InstancedMesh;
  private head: InstancedMesh;
  private legs: InstancedMesh;
  private arms: InstancedMesh;
  private shadow: InstancedMesh;
  private palettes = { shirt: SHIRTS.map((c) => new Color(c)), pants: PANTS.map((c) => new Color(c)), skin: SKIN.map((c) => new Color(c)) };

  constructor(scene: Scene, mats: Materials, cap: number) {
    // proportions for a 1.75 m figure, origin at the feet; limbs pivot at hip/shoulder
    const torsoG = new BoxGeometry(0.4, 0.6, 0.22).translate(0, 0.3, 0);
    const headG = new SphereGeometry(0.115, 10, 8).scale(0.9, 1.08, 1);
    const legG = new BoxGeometry(0.15, 0.9, 0.17).translate(0, -0.45, 0);
    const armG = new BoxGeometry(0.1, 0.62, 0.11).translate(0, -0.31, 0);
    const mk = (g: BufferGeometry, n: number, shadow = true) => {
      const m = new InstancedMesh(g, mats.pedestrian, n);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.torso = mk(torsoG, cap);
    this.head = mk(headG, cap);
    this.legs = mk(legG, cap * 2);
    this.arms = mk(armG, cap * 2, false);
    this.shadow = new InstancedMesh(new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), mats.contactShadow, cap);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    this.shadow.userData.noAO = true;
    this.shadow.count = 0;
    scene.add(this.shadow);
  }

  update(sys: PedestrianSystem) {
    let n = 0;
    const cap = this.torso.instanceMatrix.count;
    for (const p of sys.peds) {
      if (n >= cap) break;
      const L = p.look;
      const swing = Math.sin(p.phase) * Math.min(0.62, p.gait * 0.36);
      const bob = Math.abs(Math.cos(p.phase)) * Math.min(0.045, p.gait * 0.025);
      const idleSway = p.gait < 0.2 ? Math.sin(p.phase * 0.3 + p.id) * 0.04 : 0;
      _q.setFromAxisAngle(_y, -p.heading);
      _b.compose(_p.set(p.x, p.y + bob, p.z), _q, _s.set(L.bulk, L.height, L.bulk));
      const shirt = this.palettes.shirt[L.shirt % SHIRTS.length];
      const pants = this.palettes.pants[L.pants % PANTS.length];
      const skin = this.palettes.skin[L.skin % SKIN.length];
      // torso leans slightly into the walk
      _l.makeTranslation(0, 0.9, 0).multiply(_m.makeRotationX(-Math.min(0.1, p.gait * 0.04)));
      this.torso.setMatrixAt(n, _m.multiplyMatrices(_b, _l));
      this.torso.setColorAt(n, shirt);
      _l.makeTranslation(0, 1.62, 0.01).multiply(_m.makeRotationY(idleSway * 4));
      this.head.setMatrixAt(n, _m.multiplyMatrices(_b, _l));
      this.head.setColorAt(n, skin);
      for (const k of [0, 1]) {
        const side = k === 0 ? -1 : 1;
        const a = swing * side;
        _l.makeTranslation(side * 0.1, 0.92, 0).multiply(_m.makeRotationX(a));
        this.legs.setMatrixAt(n * 2 + k, _m.multiplyMatrices(_b, _l));
        this.legs.setColorAt(n * 2 + k, pants);
        _l.makeTranslation(side * 0.255, 1.47, 0).multiply(_m.makeRotationX(-a * 0.8 + idleSway)).multiply(_m.makeRotationZ(side * 0.06));
        this.arms.setMatrixAt(n * 2 + k, _m.multiplyMatrices(_b, _l));
        this.arms.setColorAt(n * 2 + k, _c.copy(shirt).lerp(skin, 0.35));
      }
      _m.compose(_p.set(p.x, p.y + 0.03, p.z), _q, _s.set(1, 1, 1));
      this.shadow.setMatrixAt(n, _m);
      n++;
    }
    this.torso.count = this.head.count = this.shadow.count = n;
    this.legs.count = this.arms.count = n * 2;
    for (const m of [this.torso, this.head, this.legs, this.arms, this.shadow]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  setVisible(v: boolean) {
    for (const m of [this.torso, this.head, this.legs, this.arms, this.shadow]) m.visible = v;
  }

  dispose() {
    for (const m of [this.torso, this.head, this.legs, this.arms, this.shadow]) { m.geometry.dispose(); m.removeFromParent(); m.dispose(); }
  }
}
