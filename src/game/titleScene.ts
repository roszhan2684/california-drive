import { BufferAttribute, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3, type WebGLRenderer } from 'three';
import { SkySystem } from '../render/sky.ts';
import { Materials } from '../render/materials.ts';
import type { CarRig, Paint } from '../vehicle/carModel.ts';
import type { VehicleDef } from '../vehicle/vehicles.ts';
import { propGeometries } from '../world/props.ts';
import { rng } from '../world/geom.ts';

function terrainH(x: number, z: number) {
  // ocean to the west, a coastal shelf for the road at x≈-8, hills rising to the east
  const sm = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const shelf = 14 + Math.sin(z * 0.03) * 0.4;
  const west = Math.max(-7, 14 + (x + 13) * 0.95) + Math.sin(z * 0.07 + x * 0.1) * 1.2;
  const east = 14 + Math.max(0, x - 2) * (0.32 + 0.12 * Math.sin(z * 0.011)) + Math.sin(x * 0.05 + z * 0.03) * 2 * sm(4, 30, x);
  return x < -13 ? Math.min(shelf, west) : x < 2 ? shelf : shelf + (east - shelf) * sm(2, 12, x);
}

/** Lightweight cinematic backdrop for the title screen: golden-hour coast, hero car, slow orbit. */
export class TitleScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sky: SkySystem;
  readonly mats = new Materials();
  car: CarRig;
  private t = Math.random() * 100;
  private disposed = false;

  constructor(renderer: WebGLRenderer, aspect: number, def: VehicleDef, paint: Paint) {
    this.camera = new PerspectiveCamera(40, aspect, 0.1, 6000);
    this.sky = new SkySystem(renderer, this.scene);
    const g = new PlaneGeometry(1600, 1600, 160, 160).rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainH(x, z);
      p.setY(i, h);
      const sand = h < 3 ? 1 : 0;
      const rock = Math.min(1, Math.abs(terrainH(x + 2, z) - terrainH(x - 2, z)) / 3);
      const c = sand ? [0.55, 0.47, 0.33] : rock > 0.6 ? [0.32, 0.3, 0.27] : [0.17, 0.2, 0.09];
      col.set(c, i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    const terrain = new Mesh(g, this.mats.terrain);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    const road = new Mesh(new PlaneGeometry(9, 1600).rotateX(-Math.PI / 2), this.mats.road);
    road.position.set(-8, 14.08, 0);
    road.receiveShadow = true;
    this.scene.add(road);
    const water = new Mesh(new PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), this.mats.water);
    water.position.y = 0;
    this.scene.add(water);
    // palms along the shelf
    const pg = propGeometries();
    const r = rng(3);
    const n = 26;
    const trunks = new InstancedMesh(pg.treeTrunk[2], this.mats.bark, n);
    const crowns = new InstancedMesh(pg.treeCrown[2], this.mats.foliage, n);
    const m = new Matrix4();
    for (let i = 0; i < n; i++) {
      const z = -300 + i * 24 + r() * 6;
      const x = 1 + r() * 4;
      const s = 0.8 + r() * 0.5;
      m.compose(new Vector3(x, terrainH(x, z) - 0.2, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), r() * 6), new Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    }
    trunks.castShadow = crowns.castShadow = true;
    this.scene.add(trunks, crowns);
    this.car = this.placeCar(def, paint);
    this.sky.update(0, 18.35, { cloud: 0.15, fog: 0.08, marine: 0, rain: 0, snow: 0, wet: 0 }, this.car.root.position, 40);
    this.sky.refreshEnv();
    this.scene.environment = this.sky.envMap;
    this.mats.update(0, 0, this.sky.night, 0);
  }

  private placeCar(def: VehicleDef, paint: Paint): CarRig {
    const car = def.build(paint.color, paint.matte);
    car.root.position.set(-6.4, 14.85, 4);
    car.root.rotation.y = 0.22;
    car.headlightMat.emissiveIntensity = 3;
    car.tailMat.emissiveIntensity = 2;
    if (car.drl) car.drl.emissiveIntensity = 3;
    car.spotL.intensity = car.spotR.intensity = 90;
    this.scene.add(car.root);
    return car;
  }

  setCar(def: VehicleDef, paint: Paint) {
    this.car.root.removeFromParent();
    this.car.dispose();
    this.car = this.placeCar(def, paint);
  }

  /** Garage mode: the camera orbits the car (drag to turn, wheel to zoom, slow auto-turn when idle). */
  setShowroom(on: boolean) {
    this.showroom = on;
    this.idle = 0;
  }

  orbit(dx: number, dy: number) {
    this.yawTarget -= dx * 0.008;
    this.pitchTarget = Math.max(0.02, Math.min(0.6, this.pitchTarget + dy * 0.004));
    this.idle = 0;
  }

  zoomBy(dy: number) {
    this.radiusTarget = Math.max(4.2, Math.min(10, this.radiusTarget * (1 + Math.sign(dy) * 0.08)));
    this.idle = 0;
  }

  private showroom = false;
  private idle = 0;
  private yaw = 2.4;
  private yawTarget = 2.4;
  private pitch = 0.16;
  private pitchTarget = 0.16;
  private radius = 6.4;
  private radiusTarget = 6.4;

  update(dt: number) {
    if (this.disposed) return;
    this.t += dt;
    const c = this.car.root.position;
    if (this.showroom) {
      this.idle += dt;
      if (this.idle > 2.5) this.yawTarget += dt * 0.16;
      const k = Math.min(1, dt * 5);
      this.yaw += (this.yawTarget - this.yaw) * k;
      this.pitch += (this.pitchTarget - this.pitch) * k;
      this.radius += (this.radiusTarget - this.radius) * k;
      const a = this.yaw + this.car.root.rotation.y;
      const cy = c.y + 0.55;
      this.camera.position.set(c.x + Math.sin(a) * Math.cos(this.pitch) * this.radius, cy + Math.sin(this.pitch) * this.radius, c.z + Math.cos(a) * Math.cos(this.pitch) * this.radius);
      // keep the car left of centre so the spec panel on the right does not cover it
      this.camera.lookAt(c.x, cy, c.z);
      this.camera.setViewOffset(innerWidth, innerHeight, innerWidth * 0.14, 0, innerWidth, innerHeight);
    } else {
      // slow dolly along the coast road, looking south past the car with the ocean and low sun to the right
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
      const u = (Math.sin(this.t * 0.06) + 1) / 2;
      this.camera.position.set(-3.0 + u * 1.2, c.y + 0.3 + u * 0.8, c.z - 10.5 + u * 3.5);
      this.camera.lookAt(c.x + 0.2, c.y + 0.25, c.z + 9);
    }
    this.sky.update(dt, 18.35, { cloud: 0.15, fog: 0.08, marine: 0, rain: 0, snow: 0, wet: 0 }, c, 40);
    this.scene.environment = this.sky.envMap;
    this.mats.update(this.t, 0, this.sky.night, 0);
    for (const w of this.car.wheels) w.spin.rotation.x = 0;
  }

  dispose() {
    this.disposed = true;
    this.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.car.dispose();
    this.sky.dispose();
  }
}
