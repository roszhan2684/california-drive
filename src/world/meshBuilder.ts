export interface MeshBuf {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array | null;
  uv: Float32Array | null;
  /** Optional per-vertex scalar (facade type for buildings). */
  ex?: Float32Array | null;
  idx: Uint32Array;
}

/** Growable vertex/index builder producing transferable typed arrays. */
export class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  ex: number[] = [];
  idx: number[] = [];
  readonly hasCol: boolean;
  readonly hasUv: boolean;
  readonly hasEx: boolean;
  /** Value written to the extra attribute for subsequent vertices. */
  exValue = 0;

  constructor(hasCol = false, hasUv = false, hasEx = false) {
    this.hasCol = hasCol;
    this.hasUv = hasUv;
    this.hasEx = hasEx;
  }

  get count() {
    return this.pos.length / 3;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, r = 1, g = 1, b = 1, u = 0, w = 0): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    if (this.hasCol) this.col.push(r, g, b);
    if (this.hasUv) this.uv.push(u, w);
    if (this.hasEx) this.ex.push(this.exValue);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /** Triangle with winding corrected so its geometric normal points along (nx,ny,nz). */
  triFacing(a: number, b: number, c: number, nx: number, ny: number, nz: number) {
    const p = this.pos;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Quad a-b-c-d (in order around the perimeter) facing n. */
  quadFacing(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) {
    this.triFacing(a, b, c, nx, ny, nz);
    this.triFacing(a, c, d, nx, ny, nz);
  }

  /** Axis-aligned-in-yaw box (center x,y,z; half sizes; yaw rotation). */
  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, r = 1, g = 1, b = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corner = (sx: number, sy: number, sz: number): [number, number, number] => {
      const lx = sx * hx, lz = sz * hz;
      return [x + lx * c + lz * s, y + sy * hy, z - lx * s + lz * c];
    };
    const faces: [number[], [number, number, number]][] = [
      [[1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1], [c, 0, -s]],
      [[-1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1], [-c, 0, s]],
      [[-1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1], [0, 1, 0]],
      [[-1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1], [0, -1, 0]],
      [[-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1], [s, 0, c]],
      [[1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1], [-s, 0, -c]],
    ];
    for (const [q, n] of faces) {
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) {
        const p = corner(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]);
        ids.push(this.v(p[0], p[1], p[2], n[0], n[1], n[2], r, g, b));
      }
      this.quadFacing(ids[0], ids[1], ids[2], ids[3], n[0], n[1], n[2]);
    }
  }

  build(): MeshBuf {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      col: this.hasCol ? new Float32Array(this.col) : null,
      uv: this.hasUv ? new Float32Array(this.uv) : null,
      ex: this.hasEx ? new Float32Array(this.ex) : null,
      idx: new Uint32Array(this.idx),
    };
  }
}

export function transferables(m: MeshBuf | null | undefined): ArrayBuffer[] {
  if (!m) return [];
  const out: ArrayBuffer[] = [m.pos.buffer as ArrayBuffer, m.nrm.buffer as ArrayBuffer, m.idx.buffer as ArrayBuffer];
  if (m.col) out.push(m.col.buffer as ArrayBuffer);
  if (m.uv) out.push(m.uv.buffer as ArrayBuffer);
  if (m.ex) out.push(m.ex.buffer as ArrayBuffer);
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  // sRGB -> linear for vertex colors
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
