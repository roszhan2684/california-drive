import type { CityDef } from './cities.ts';
import type { ChunkOptions } from './chunkGen.ts';
import type { DistrictData } from './types.ts';

const PALM_CITIES = new Set(['la', 'sd', 'smc']);
const FACADE_MIX: Record<string, [number, number, number, number]> = {
  sf: [0.18, 0.35, 0.17, 0.3], la: [0.25, 0.35, 0.4, 0], sd: [0.2, 0.5, 0.3, 0], sj: [0.15, 0.45, 0.4, 0],
  oak: [0.35, 0.3, 0.35, 0], sac: [0.38, 0.32, 0.3, 0], smc: [0.1, 0.6, 0.3, 0],
};
const NEON_DENSITY: Record<string, number> = { sf: 0.1, la: 0.32, sd: 0.22, sj: 0.15, oak: 0.15, sac: 0.1, smc: 0.2 };

export function chunkOptionsFor(city: CityDef, treeDensity: number): ChunkOptions {
  return {
    biome: city.biome,
    buildingPalette: city.palette.building,
    ground: city.palette.ground,
    treeDensity,
    palms: PALM_CITIES.has(city.id),
    urban: city.biome !== 'alpine',
    style: city.id === 'sf' ? 'sf' : city.biome === 'alpine' ? 'alpine' : 'city',
    facadeMix: FACADE_MIX[city.id] ?? [0, 0.2, 0, 0.8],
    neon: NEON_DENSITY[city.id] ?? 0,
  };
}

export async function loadDistrict(cityId: string, onProgress?: (f: number) => void): Promise<DistrictData> {
  const url = `${import.meta.env.BASE_URL}cities/${cityId}/district.json`;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return (await res.json()) as DistrictData;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(buf)) as DistrictData;
}
