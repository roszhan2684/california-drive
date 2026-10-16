import { G, type PhysicsWorld } from './world.ts';

export interface ProvingGroundLayout {
  size: number;
  ramp: { x: number; z: number; width: number; length: number; height: number };
  cones: { x: number; z: number }[];
}

export const PROVING_GROUND: ProvingGroundLayout = {
  size: 2400,
  ramp: { x: 60, z: -300, width: 8, length: 14, height: 1.6 },
  cones: Array.from({ length: 8 }, (_, i) => ({ x: -60, z: -80 - i * 18 })),
};

/** Flat asphalt pad + jump ramp. Used by deterministic physics tests and the in-game proving ground. */
export function buildProvingGroundPhysics(pw: PhysicsWorld, layout = PROVING_GROUND) {
  const half = layout.size / 2;
  const v = new Float32Array([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2]);
  pw.addStaticTrimesh(v, idx, G.ROAD, 'asphalt');
  const r = layout.ramp;
  const ang = Math.atan2(r.height, r.length);
  const hyp = Math.hypot(r.height, r.length);
  // ramp: rises toward -z
  const y0 = 0, z0 = r.z + r.length / 2, z1 = r.z - r.length / 2;
  const hw = r.width / 2;
  const rv = new Float32Array([
    r.x - hw, y0, z0, r.x + hw, y0, z0, r.x + hw, r.height, z1, r.x - hw, r.height, z1,
    r.x - hw, 0, z1, r.x + hw, 0, z1,
  ]);
  const ri = new Uint32Array([0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2]);
  pw.addStaticTrimesh(rv, ri, G.ROAD, 'concrete');
  // perimeter walls
  for (const [cx, cz, hx, hz] of [[0, -half, half, 1], [0, half, half, 1], [-half, 0, 1, half], [half, 0, 1, half]] as const) {
    pw.addStaticCuboid(cx, 2, cz, hx, 2, hz, 0, G.BOUNDS, 'wall');
  }
  return { rampAngle: ang, rampLength: hyp };
}
