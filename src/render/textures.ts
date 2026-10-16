import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { rng } from '../world/geom.ts';

/** Tileable value-noise RGBA texture: R fine grain, G mid patches, B large blotches, A cellular cracks. Generated in code (no external asset). */
export function makeNoiseTexture(size = 256, seed = 7): DataTexture {
  const rand = rng(seed);
  const lattice = (n: number) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (a: number, b: number) => g[((b % n) + n) % n * n + (((a % n) + n) % n)];
      const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
      const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const f1 = lattice(64), f2 = lattice(16), f3 = lattice(8), f4 = lattice(128);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const grain = f4(u * 128, v * 128) * 0.6 + f1(u * 64, v * 64) * 0.4;
      const mid = f2(u * 16, v * 16) * 0.65 + f1(u * 64, v * 64) * 0.35;
      const big = f3(u * 8, v * 8) * 0.7 + f2(u * 16, v * 16) * 0.3;
      const crack = Math.abs(f2(u * 16, v * 16) - 0.5) < 0.012 ? 1 : 0;
      const i = (y * size + x) * 4;
      data[i] = grain * 255;
      data[i + 1] = mid * 255;
      data[i + 2] = big * 255;
      data[i + 3] = crack * 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Soft radial gradient used for light pools, particles and glows. */
export function makeRadialTexture(size = 64, power = 2): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const d = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - d, power);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = a * 255;
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Canvas texture helper (main thread only). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): { tex: CanvasTexture; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return { tex, canvas, ctx };
}
