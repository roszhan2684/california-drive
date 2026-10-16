import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Object3D, SphereGeometry, TorusGeometry, Vector3, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityDef, LandmarkDef } from './cities.ts';
import type { Heightfield } from './heightfield.ts';
import type { LocalProjection } from './projection.ts';
import { RAPIER, G, groups, type PhysicsWorld } from '../physics/world.ts';
import type { Materials } from '../render/materials.ts';

function col(g: BufferGeometry, hex: string, shade = 1) {
  const c = new Color(hex).multiplyScalar(shade);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}

function ni(g: BufferGeometry) {
  const r = g.index ? g.toNonIndexed() : g;
  if (r !== g) g.dispose();
  r.deleteAttribute('uv');
  return r;
}

interface Built { opaque: BufferGeometry[]; glass: BufferGeometry[]; colliders: { kind: 'cyl' | 'box'; x: number; y: number; z: number; a: number; b: number; c: number }[] }

function fluted(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius * 0.55;
  const tower = new CylinderGeometry(r, r * 1.05, H * 0.86, 24, 6);
  const p = tower.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const f = 1 + 0.045 * Math.cos(a * 12);
    p.setXYZ(i, x * f, p.getY(i), z * f);
  }
  tower.computeVertexNormals();
  return {
    opaque: [
      col(ni(new CylinderGeometry(def.radius, def.radius * 1.05, 3, 24).translate(0, 1.5, 0)), base, 0.9),
      col(ni(tower.translate(0, 3 + H * 0.43, 0)), base),
      col(ni(new CylinderGeometry(r * 1.02, r * 1.02, H * 0.08, 24, 1, true).translate(0, 3 + H * 0.82, 0)), '#3a3530'),
      col(ni(new CylinderGeometry(r * 1.12, r * 1.12, 1.2, 24).translate(0, 3 + H * 0.9, 0)), base),
      col(ni(new CylinderGeometry(r * 0.9, r * 1.0, H * 0.06, 24).translate(0, 3 + H * 0.95, 0)), base, 0.95),
    ],
    glass: [],
    colliders: [{ kind: 'cyl', x: 0, y: H / 2, z: 0, a: H / 2, b: def.radius, c: 0 }],
  };
}

function pyramid(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius;
  const body = new ConeGeometry(r * 1.2, H * 0.88, 4, 12, false).rotateY(Math.PI / 4).translate(0, H * 0.44, 0);
  const spire = new ConeGeometry(r * 0.22, H * 0.14, 4).rotateY(Math.PI / 4).translate(0, H * 0.93, 0);
  const wings = [-1, 1].map((s) => new BoxGeometry(r * 0.38, H * 0.7, r * 0.5).translate(s * r * 0.55, H * 0.35, 0));
  return {
    opaque: [col(ni(body), base), col(ni(spire), base, 0.95), ...wings.map((w) => col(ni(w), base, 0.92))],
    glass: [],
    colliders: [{ kind: 'box', x: 0, y: H * 0.25, z: 0, a: r * 0.8, b: H * 0.25, c: r * 0.8 }],
  };
}

function clockTower(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius;
  const hall = new BoxGeometry(r * 2.4, 16, r * 9).translate(0, 8, 0);
  const tower = new BoxGeometry(r * 1.1, H * 0.78, r * 1.1).translate(0, H * 0.39, 0);
  const cap = new ConeGeometry(r * 0.85, H * 0.22, 4).rotateY(Math.PI / 4).translate(0, H * 0.89, 0);
  const clocks = [0, 1, 2, 3].map((k) => new CylinderGeometry(r * 0.38, r * 0.38, 0.2, 20).rotateX(Math.PI / 2).translate(0, H * 0.66, r * 0.56).rotateY((k * Math.PI) / 2));
  return {
    opaque: [col(ni(hall), base, 0.92), col(ni(tower), base), col(ni(cap), '#7d8c88'), ...clocks.map((c) => col(ni(c), '#f2efe6', 1.1))],
    glass: [],
    colliders: [
      { kind: 'box', x: 0, y: 8, z: 0, a: r * 1.2, b: 8, c: r * 4.5 },
      { kind: 'box', x: 0, y: H * 0.39, z: 0, a: r * 0.55, b: H * 0.39, c: r * 0.55 },
    ],
  };
}

function crownTower(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius;
  const tiers = [[1, 0.35], [0.88, 0.3], [0.76, 0.25]] as const;
  const glass: BufferGeometry[] = [];
  let y = 0;
  for (const [s, f] of tiers) {
    glass.push(ni(new CylinderGeometry(r * s, r * s, H * f, 28).translate(0, y + (H * f) / 2, 0)));
    y += H * f;
  }
  const crown = new TorusGeometry(r * 0.72, 0.8, 8, 28).rotateX(Math.PI / 2).translate(0, y + 2, 0);
  const top = new CylinderGeometry(r * 0.6, r * 0.7, H * 0.1, 28).translate(0, y + H * 0.05, 0);
  return {
    opaque: [col(ni(crown), '#f5f2ea', 1.3), col(ni(top), base)],
    glass,
    colliders: [{ kind: 'cyl', x: 0, y: H / 2, z: 0, a: H / 2, b: r, c: 0 }],
  };
}

function steppedTower(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius;
  const parts: BufferGeometry[] = [col(ni(new BoxGeometry(r * 3, 22, r * 1.8).translate(0, 11, 0)), base, 0.93)];
  let y = 0;
  const steps = [[1, 0.55], [0.75, 0.15], [0.6, 0.1], [0.45, 0.07]] as const;
  for (const [s, f] of steps) {
    parts.push(col(ni(new BoxGeometry(r * s, H * f, r * s).translate(0, y + (H * f) / 2, 0)), base));
    y += H * f;
  }
  parts.push(col(ni(new ConeGeometry(r * 0.32, H * 0.13, 4).rotateY(Math.PI / 4).translate(0, y + H * 0.065, 0)), '#c9c3b5'));
  return { opaque: parts, glass: [], colliders: [{ kind: 'box', x: 0, y: H / 2, z: 0, a: r / 2, b: H / 2, c: r / 2 }, { kind: 'box', x: 0, y: 11, z: 0, a: r * 1.5, b: 11, c: r * 0.9 }] };
}

function dome(def: LandmarkDef, base: string): Built {
  const H = def.height, r = def.radius;
  return {
    opaque: [
      col(ni(new BoxGeometry(r * 3.2, H * 0.32, r * 1.6).translate(0, H * 0.16, 0)), base),
      col(ni(new CylinderGeometry(r * 0.5, r * 0.55, H * 0.25, 28).translate(0, H * 0.32 + H * 0.125, 0)), base, 0.95),
      col(ni(new SphereGeometry(r * 0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1).translate(0, H * 0.57, 0)), '#d8d4c8'),
      col(ni(new CylinderGeometry(r * 0.08, r * 0.1, H * 0.12, 12).translate(0, H * 0.57 + r * 0.62, 0)), base),
    ],
    glass: [],
    colliders: [{ kind: 'box', x: 0, y: H * 0.16, z: 0, a: r * 1.6, b: H * 0.16, c: r * 0.8 }],
  };
}

/** Static part of the Ferris wheel: two A-frame towers and the axle. The wheel itself spins (see `FerrisWheel`). */
function ferrisFrame(def: LandmarkDef, base: string): Built {
  const R = ferrisRadius(def), hub = R + 2.2, half = 1.9;
  const parts: BufferGeometry[] = [];
  const strut = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, hex: string) => {
    const a = new Vector3(x0, y0, z0), b = new Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const g = new CylinderGeometry(r, r, len, 8);
    const m = new Object3D();
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    m.rotateX(Math.PI / 2);
    m.updateMatrix();
    parts.push(col(ni(g.applyMatrix4(m.matrix)), hex));
  };
  // local frame: wheel plane is X/Y, axle along Z
  for (const z of [-half, half]) {
    strut(-R * 0.62, 0, z * 1.5, 0, hub, z, 0.32, base);
    strut(R * 0.62, 0, z * 1.5, 0, hub, z, 0.32, base);
    strut(-R * 0.38, hub * 0.38, z * 1.3, R * 0.38, hub * 0.38, z * 1.3, 0.16, base);
  }
  strut(0, hub, -half - 0.6, 0, hub, half + 0.6, 0.45, '#9aa1a8');
  parts.push(col(ni(new BoxGeometry(R * 1.6, 0.6, half * 4).translate(0, 0.3, 0)), '#7b766c'));
  return { opaque: parts, glass: [], colliders: [{ kind: 'box', x: 0, y: 1.5, z: 0, a: R * 0.7, b: 1.5, c: half * 1.8 }] };
}

function ferrisRadius(def: LandmarkDef) {
  return (def.height - 2.8) / 2;
}

const GONDOLAS = 20;
const LEDS = 72;

/** Spinning wheel, upright gondolas and an LED rim that runs colour chases after dark. */
class FerrisWheel {
  readonly group = new Group();
  private wheel: Mesh;
  private gondolas: InstancedMesh;
  private leds: InstancedMesh;
  private R: number;
  private hub: number;
  private c = new Color();
  private m = new Matrix4();
  private geos: BufferGeometry[] = [];

  constructor(def: LandmarkDef, mats: Materials) {
    const R = (this.R = ferrisRadius(def));
    this.hub = R + 2.2;
    const parts: BufferGeometry[] = [];
    for (const z of [-1.2, 1.2]) {
      parts.push(col(ni(new TorusGeometry(R, 0.16, 6, 64).translate(0, 0, z)), def.color ?? '#f2f0ea'));
      parts.push(col(ni(new TorusGeometry(R * 0.55, 0.1, 6, 40).translate(0, 0, z)), def.color ?? '#f2f0ea', 0.95));
      for (let k = 0; k < GONDOLAS; k++) {
        const a = (k / GONDOLAS) * Math.PI * 2;
        const g = new BoxGeometry(0.08, R, 0.08).translate(0, R / 2, z).rotateZ(a);
        parts.push(col(ni(g), '#d9dadc'));
      }
    }
    for (let k = 0; k < GONDOLAS; k++) {
      const a = (k / GONDOLAS) * Math.PI * 2;
      parts.push(col(ni(new BoxGeometry(0.1, 0.1, 2.6).translate(Math.cos(a) * R, Math.sin(a) * R, 0)), '#c9cbce'));
    }
    const wheelGeo = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    wheelGeo.computeVertexNormals();
    this.wheel = new Mesh(wheelGeo, mats.landmark);
    this.wheel.position.y = this.hub;
    this.wheel.castShadow = true;
    const cab = col(ni(new BoxGeometry(1.5, 1.3, 1.5).translate(0, -1.0, 0)), '#e8e2d2');
    const roof = col(ni(new ConeGeometry(1.0, 0.5, 4).rotateY(Math.PI / 4).translate(0, -0.15, 0)), '#d2463c');
    const gGeo = mergeGeometries([cab, roof], false)!;
    cab.dispose();
    roof.dispose();
    this.gondolas = new InstancedMesh(gGeo, mats.landmark, GONDOLAS);
    this.gondolas.castShadow = true;
    const led = col(ni(new SphereGeometry(0.3, 6, 4)), '#ffffff');
    this.leds = new InstancedMesh(led, mats.vehicleLights, LEDS * 2);
    this.leds.position.y = this.hub;
    for (const m of [this.gondolas, this.leds]) m.frustumCulled = false;
    this.geos.push(wheelGeo, gGeo, led);
    this.group.add(this.wheel, this.gondolas, this.leds);
  }

  update(t: number, night: number) {
    const spin = t * 0.07;
    this.wheel.rotation.z = spin;
    for (let k = 0; k < GONDOLAS; k++) {
      const a = (k / GONDOLAS) * Math.PI * 2 + spin;
      this.m.makeTranslation(Math.cos(a) * this.R, this.hub + Math.sin(a) * this.R, 0);
      this.gondolas.setMatrixAt(k, this.m);
    }
    this.gondolas.instanceMatrix.needsUpdate = true;
    // LED chase: a rotating rainbow sweep with a white sparkle; barely visible by day
    const lvl = 0.25 + night * 2.6;
    for (let side = 0; side < 2; side++) for (let k = 0; k < LEDS; k++) {
      const a = (k / LEDS) * Math.PI * 2 + spin;
      const i = side * LEDS + k;
      this.m.makeTranslation(Math.cos(a) * this.R, Math.sin(a) * this.R, side ? 1.35 : -1.35);
      this.leds.setMatrixAt(i, this.m);
      const hue = ((k / LEDS) * 2 - t * 0.12 + side * 0.05) % 1;
      const pulse = 0.55 + 0.45 * Math.sin(k * 0.6 - t * 4);
      this.c.setHSL((hue + 1) % 1, 0.9, 0.55).multiplyScalar(lvl * pulse);
      if ((k + Math.floor(t * 9)) % 23 === 0) this.c.setScalar(lvl * 1.4);
      this.leds.setColorAt(i, this.c);
    }
    this.leds.instanceMatrix.needsUpdate = true;
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.gondolas.dispose();
    this.leds.dispose();
  }
}

const BUILDERS: Record<LandmarkDef['kind'], (d: LandmarkDef, base: string) => Built> = {
  'fluted-tower': fluted, pyramid, 'clock-tower': clockTower, 'crown-tower': crownTower, 'stepped-tower': steppedTower, dome, lighthouse: fluted,
  'ferris-wheel': ferrisFrame,
};

export interface LandmarkInstance { def: LandmarkDef; x: number; y: number; z: number }

export function buildLandmarks(city: CityDef, proj: LocalProjection, hf: Heightfield, mats: Materials, physics: PhysicsWorld, waterY: number | null = null): { group: Group; instances: LandmarkInstance[]; colliders: RAPIER.Collider[]; update(t: number, night: number): void; dispose(): void } {
  const group = new Group();
  const animated: FerrisWheel[] = [];
  group.name = 'landmarks';
  const instances: LandmarkInstance[] = [];
  const colliders: RAPIER.Collider[] = [];
  const geos: BufferGeometry[] = [];
  for (const def of city.landmarks) {
    const p = proj.toLocal(def.at.lat, def.at.lon);
    let y = Infinity;
    for (let a = 0; a < 8; a++) y = Math.min(y, hf.sample(p.x + Math.cos(a) * def.radius, p.z + Math.sin(a) * def.radius));
    y = Math.min(y, hf.sample(p.x, p.z)) - 0.5;
    // over water (pier-mounted landmarks) stand on the pier deck (water + 2.2 m, see chunkGen.buildPier)
    if (def.kind === 'ferris-wheel' && waterY !== null) y = Math.max(y + 0.5, waterY + 2.2);
    const yaw = def.heading !== undefined ? -(def.heading * Math.PI) / 180 : 0;
    const b = BUILDERS[def.kind](def, def.color ?? '#e8e2d4');
    const add = (list: BufferGeometry[], mat: Material) => {
      if (!list.length) return;
      const g = mergeGeometries(list, false)!;
      for (const l of list) l.dispose();
      g.computeVertexNormals();
      geos.push(g);
      const m = new Mesh(g, mat);
      m.position.set(p.x, y, p.z);
      m.rotation.y = yaw;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    };
    add(b.opaque, mats.landmark);
    add(b.glass, mats.landmarkGlass);
    if (def.kind === 'ferris-wheel') {
      const fw = new FerrisWheel(def, mats);
      fw.group.position.set(p.x, y, p.z);
      fw.group.rotation.y = yaw;
      group.add(fw.group);
      animated.push(fw);
    }
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const c of b.colliders) {
      const desc = c.kind === 'cyl' ? RAPIER.ColliderDesc.cylinder(c.a, c.b) : RAPIER.ColliderDesc.cuboid(c.a, c.b, c.c);
      desc.setTranslation(p.x + c.x * cy + c.z * sy, y + c.y, p.z - c.x * sy + c.z * cy).setCollisionGroups(groups(G.STATIC, 0xffff));
      if (yaw) desc.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      const col2 = physics.world.createCollider(desc);
      physics.setSurface(col2, 'wall');
      colliders.push(col2);
    }
    instances.push({ def, x: p.x, y, z: p.z });
  }
  return {
    group, instances, colliders,
    update(t: number, night: number) {
      for (const a of animated) a.update(t, night);
    },
    dispose() {
      for (const a of animated) a.dispose();
      for (const g of geos) g.dispose();
      for (const c of colliders) physics.remove(c);
      group.removeFromParent();
    },
  };
}
