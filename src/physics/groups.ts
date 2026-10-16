import type { SurfaceKind } from '../world/types.ts';

/** Collision group bits. */
export const G = {
  TERRAIN: 0x0001,
  ROAD: 0x0002,
  STATIC: 0x0004,
  CHASSIS: 0x0008,
  TRAFFIC: 0x0010,
  BOUNDS: 0x0020,
  PROP: 0x0040,
  RAY: 0x0080,
} as const;
export const ALL = 0xffff;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export type Surface = SurfaceKind | 'terrain' | 'grass' | 'wall' | 'vehicle' | 'water';

/** Grip multiplier per surface (dry). */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  concrete: 0.96,
  cobble: 0.86,
  dirt: 0.68,
  terrain: 0.74,
  grass: 0.62,
  wall: 0.4,
  vehicle: 0.5,
  water: 0.3,
};

