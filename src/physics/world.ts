import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;
/** Rapier's compat build inlines its WASM; init once. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init().then(() => undefined) as Promise<void>;
  return ready;
}

export { G, ALL, groups, SURFACE_GRIP, type Surface } from './groups.ts';
import { G, ALL, groups, type Surface } from './groups.ts';

export interface RayHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  surface: Surface;
  collider: RAPIER.Collider;
}

/** Thin wrapper around a Rapier world with a surface registry and fixed timestep. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly dt: number;
  readonly events: RAPIER.EventQueue;
  private surfaces = new Map<number, Surface>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(hz = 120) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.dt = 1 / hz;
    this.world.timestep = this.dt;
    this.world.integrationParameters.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
  }

  step() {
    this.world.step(this.events);
  }

  setSurface(c: RAPIER.Collider, s: Surface) {
    this.surfaces.set(c.handle, s);
  }

  surfaceOf(c: RAPIER.Collider): Surface {
    return this.surfaces.get(c.handle) ?? 'asphalt';
  }

  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array, group: number, surface: Surface, friction = 0.8): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setCollisionGroups(groups(group, ALL))
      .setFriction(friction)
      .setRestitution(0.05);
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    return c;
  }

  addStaticCuboid(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, group: number, surface: Surface): RAPIER.Collider {
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(q).setCollisionGroups(groups(group, ALL)).setFriction(0.5);
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    return c;
  }

  remove(c: RAPIER.Collider) {
    this.surfaces.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  /** Cast a ray; returns null when nothing is hit within maxToi. */
  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, filter: number, excludeBody?: RAPIER.RigidBody): RayHit | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRayAndGetNormal(this.ray, maxToi, true, undefined, groups(G.RAY, filter), undefined, excludeBody);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, surface: this.surfaceOf(hit.collider), collider: hit.collider };
  }

  free() {
    this.events.free();
    this.world.free();
  }
}
