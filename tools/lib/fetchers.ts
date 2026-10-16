import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

const UA = 'CaliforniaDrive-importer/0.1 (open-source hobby game; one-time bounded extract)';

function ensureDir(p: string) {
  mkdirSync(dirname(p), { recursive: true });
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** One-time bounded Overpass extract, cached on disk. We never use OSM servers at game runtime. */
export async function fetchOverpass(cachePath: string, query: string): Promise<any> {
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    try {
      console.log(`  overpass: ${url} (attempt ${attempt + 1})`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      ensureDir(cachePath);
      writeFileSync(cachePath, JSON.stringify(json));
      return json;
    } catch (e) {
      lastErr = e;
      console.warn('  overpass failed:', (e as Error).message);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** AWS Open Data "Terrain Tiles" (terrarium encoding). Data sources include USGS 3DEP/NED (public domain). */
export async function fetchTerrariumTile(cacheDir: string, z: number, x: number, y: number): Promise<PNG> {
  const path = `${cacheDir}/${z}/${x}/${y}.png`;
  if (!existsSync(path)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`terrain tile ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path);
    writeFileSync(path, buf);
  }
  return PNG.sync.read(readFileSync(path));
}

export function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export class TerrariumSampler {
  private tiles = new Map<string, PNG>();
  readonly z: number;
  readonly cacheDir: string;

  constructor(cacheDir: string, z: number) {
    this.cacheDir = cacheDir;
    this.z = z;
  }

  async preload(s: number, w: number, n: number, e: number) {
    const x0 = Math.floor(lonToTileX(w, this.z)), x1 = Math.floor(lonToTileX(e, this.z));
    const y0 = Math.floor(latToTileY(n, this.z)), y1 = Math.floor(latToTileY(s, this.z));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        this.tiles.set(`${x}/${y}`, await fetchTerrariumTile(this.cacheDir, this.z, x, y));
      }
    }
    console.log(`  terrain: ${this.tiles.size} tiles at z${this.z}`);
  }

  private px(tx: number, ty: number, px: number, py: number): number {
    // Handle pixel overflow into neighbouring tiles.
    if (px >= 256) { tx++; px -= 256; }
    if (py >= 256) { ty++; py -= 256; }
    const t = this.tiles.get(`${tx}/${ty}`);
    if (!t) return NaN;
    const i = (py * t.width + px) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  }

  sample(lat: number, lon: number): number {
    const fx = lonToTileX(lon, this.z) * 256 - 0.5;
    const fy = latToTileY(lat, this.z) * 256 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const u = fx - ix, v = fy - iy;
    const get = (gx: number, gy: number) => this.px(Math.floor(gx / 256), Math.floor(gy / 256), gx % 256, gy % 256);
    const a = get(ix, iy), b = get(ix + 1, iy), c = get(ix, iy + 1), d = get(ix + 1, iy + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
}
