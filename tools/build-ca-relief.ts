// Builds the California relief heightmap used by the 3D city-select screen.
// Source: AWS Terrain Tiles (Terrarium encoding; USGS 3DEP / SRTM etc. — see ASSET_LICENSES.md).
// Output: public/relief/ca-relief.bin (Int16 LE metres, row-major north→south) + ca-relief.json header.
// Usage: node --experimental-strip-types tools/build-ca-relief.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { TerrariumSampler } from './lib/fetchers.ts';

const S = 32.3, N = 42.2, W = -124.7, E = -113.8;
const COLS = 300, ROWS = 340;

const sampler = new TerrariumSampler('data/raw/terrarium', 7);
await sampler.preload(S, W, N, E);
const out = new Int16Array(COLS * ROWS);
let min = Infinity, max = -Infinity;
for (let r = 0; r < ROWS; r++) {
  const lat = N - ((N - S) * r) / (ROWS - 1);
  for (let c = 0; c < COLS; c++) {
    const lon = W + ((E - W) * c) / (COLS - 1);
    let h = sampler.sample(lat, lon);
    if (!Number.isFinite(h)) h = 0;
    h = Math.max(-500, Math.min(4500, h));
    out[r * COLS + c] = Math.round(h);
    min = Math.min(min, h); max = Math.max(max, h);
  }
}
mkdirSync('public/relief', { recursive: true });
writeFileSync('public/relief/ca-relief.bin', Buffer.from(out.buffer));
writeFileSync('public/relief/ca-relief.json', JSON.stringify({ cols: COLS, rows: ROWS, s: S, n: N, w: W, e: E, min: Math.round(min), max: Math.round(max), source: 'AWS Terrain Tiles (Terrarium), z7' }, null, 1));
console.log(`relief ${COLS}x${ROWS}, ${min.toFixed(0)}..${max.toFixed(0)} m`);
