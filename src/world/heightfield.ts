import type { ElevationGrid } from './types.ts';

export function encodeHeights(heights: Float32Array | number[]): string {
  const i16 = new Int16Array(heights.length);
  for (let i = 0; i < heights.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(heights[i] * 10)));
  const bytes = new Uint8Array(i16.buffer);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function decodeHeights(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 10;
  return out;
}

/** Regular-grid terrain heightfield with bilinear sampling. */
export class Heightfield {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly h: Float32Array;

  constructor(x0: number, z0: number, cell: number, cols: number, rows: number, h: Float32Array) {
    this.x0 = x0;
    this.z0 = z0;
    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.h = h;
  }

  static fromGrid(g: ElevationGrid): Heightfield {
    return new Heightfield(g.x0, g.z0, g.cell, g.cols, g.rows, decodeHeights(g.data));
  }

  at(c: number, r: number): number {
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.h[r * this.cols + c];
  }

  /** Matches the triangulation used for rendering and physics (split along the c+r diagonal). */
  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    let c = Math.floor(fx);
    let r = Math.floor(fz);
    c = c < 0 ? 0 : c >= this.cols - 1 ? this.cols - 2 : c;
    r = r < 0 ? 0 : r >= this.rows - 1 ? this.rows - 2 : r;
    const u = Math.min(1, Math.max(0, fx - c));
    const v = Math.min(1, Math.max(0, fz - r));
    const h00 = this.at(c, r);
    const h10 = this.at(c + 1, r);
    const h01 = this.at(c, r + 1);
    const h11 = this.at(c + 1, r + 1);
    // Two triangles: (00,10,01) when u+v<=1, else (10,11,01).
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Smooth bilinear sample (used for road decks, which are denser than the grid). */
  sampleBilinear(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    let c = Math.floor(fx);
    let r = Math.floor(fz);
    c = c < 0 ? 0 : c >= this.cols - 1 ? this.cols - 2 : c;
    r = r < 0 ? 0 : r >= this.rows - 1 ? this.rows - 2 : r;
    const u = Math.min(1, Math.max(0, fx - c));
    const v = Math.min(1, Math.max(0, fz - r));
    const a = this.at(c, r) * (1 - u) + this.at(c + 1, r) * u;
    const b = this.at(c, r + 1) * (1 - u) + this.at(c + 1, r + 1) * u;
    return a * (1 - v) + b * v;
  }

  normal(x: number, z: number, out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }) {
    const e = this.cell * 0.5;
    const dx = this.sample(x + e, z) - this.sample(x - e, z);
    const dz = this.sample(x, z + e) - this.sample(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }
}
