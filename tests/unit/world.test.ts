import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CITIES } from '../../src/world/cities.ts';
import type { DistrictData } from '../../src/world/types.ts';
import { RoadNetwork } from '../../src/world/roadGraph.ts';
import { ChunkContext } from '../../src/world/chunkGen.ts';
import { Heightfield } from '../../src/world/heightfield.ts';
import { LocalProjection } from '../../src/world/projection.ts';
import { pointInPoly, polyCentroid } from '../../src/world/geom.ts';
import { chunkOptionsFor } from '../../src/world/district.ts';

const available = CITIES.filter((c) => existsSync(`public/cities/${c.id}/district.json`));

describe.each(available.map((c) => [c.id, c] as const))('district %s', (_id, city) => {
  const d: DistrictData = JSON.parse(readFileSync(`public/cities/${city.id}/district.json`, 'utf8'));
  const net = new RoadNetwork(d);
  const hf = Heightfield.fromGrid(d.elevation);
  const proj = new LocalProjection(d.origin);

  it('has no road gaps (consecutive centerline points <= 8 m)', () => {
    let worst = 0;
    for (const e of d.edges) for (let i = 2; i < e.p.length; i += 2) worst = Math.max(worst, Math.hypot(e.p[i] - e.p[i - 2], e.p[i + 1] - e.p[i - 1]));
    expect(worst).toBeLessThanOrEqual(8);
  });

  it('edges reference valid nodes and endpoints match node positions', () => {
    for (const e of d.edges) {
      const a = d.nodes[e.a], b = d.nodes[e.b];
      expect(a && b).toBeTruthy();
      expect(Math.hypot(e.p[0] - a.x, e.p[1] - a.z)).toBeLessThan(0.2);
      const n = e.p.length;
      expect(Math.hypot(e.p[n - 2] - b.x, e.p[n - 1] - b.z)).toBeLessThan(0.2);
      expect(e.h.length).toBe(e.p.length / 2);
    }
  });

  it('road network is mostly one connected component', () => {
    const comp = net.components();
    const counts = new Map<number, number>();
    for (const c of comp) counts.set(c, (counts.get(c) ?? 0) + 1);
    const largest = Math.max(...counts.values());
    expect(largest / d.nodes.length).toBeGreaterThan(0.8);
  });

  it('intersections are connected (degree >= 3 junctions exist and route)', () => {
    const junctions = d.nodes.map((_, i) => i).filter((i) => net.degree(i) >= 3);
    expect(junctions.length).toBeGreaterThan(city.biome === 'alpine' ? 2 : 50);
    const comp = net.components();
    const main = [...junctions].sort((a, b) => comp[a] - comp[b])[0];
    const sameComp = junctions.filter((j) => comp[j] === comp[main]);
    const r = net.route(sameComp[0], sameComp[sameComp.length - 1], false);
    expect(r).not.toBeNull();
  });

  it('road grades are sane', () => {
    const grades: number[] = [];
    for (const e of d.edges) for (let i = 1; i < e.h.length; i++) {
      const L = Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]);
      if (L > 2) grades.push(Math.abs(e.h[i] - e.h[i - 1]) / L);
    }
    grades.sort((a, b) => a - b);
    expect(grades[Math.floor(grades.length * 0.99)]).toBeLessThan(0.36);
  });

  it('spawn snaps to a road and is not inside a building', () => {
    const s = proj.toLocal(city.spawn.lat, city.spawn.lon);
    const hit = net.nearest(s.x, s.z, 150, (e) => !e.tunnel && e.cls !== 'service');
    expect(hit).not.toBeNull();
    for (const b of d.buildings) expect(pointInPoly(hit!.x, hit!.z, b.p)).toBe(false);
  });

  it('bridges stay above terrain and tunnels stay below the surface', () => {
    for (const e of d.edges) {
      for (let i = 0; i < e.h.length; i++) {
        const t = hf.sampleBilinear(e.p[i * 2], e.p[i * 2 + 1]);
        if (e.bridge) expect(e.h[i]).toBeGreaterThan(t - 1.0);
        if (e.tunnel && i > 0 && i < e.h.length - 1) expect(e.h[i]).toBeLessThan(t + 1.5);
      }
    }
  });

  it('landmark overrides removed overlapping buildings', () => {
    for (const l of city.landmarks) {
      const p = proj.toLocal(l.at.lat, l.at.lon);
      for (const b of d.buildings) {
        const c = polyCentroid(b.p);
        expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThan(l.radius);
      }
    }
  });

  it('generates chunks with continuous terrain seams and finite geometry', () => {
    const ctx = new ChunkContext(d, chunkOptionsFor(city, 1));
    const s = proj.toLocal(city.spawn.lat, city.spawn.lon);
    const cx = Math.floor(s.x / d.chunkSize), cz = Math.floor(s.z / d.chunkSize);
    const t0 = performance.now();
    const a = ctx.generate(cx, cz);
    const b = ctx.generate(cx + 1, cz);
    const c = ctx.generate(cx, cz + 1);
    const ms = (performance.now() - t0) / 3;
    console.log(`${city.id}: chunk gen avg ${ms.toFixed(1)} ms, tris ${a.stats.tris}, parked ${a.parked.length / 7}, lights ${a.streetlights.length / 4}, trees ${a.trees.length / 6}, signals ${a.signals.length / 6}`);
    for (const m of [a.terrain, a.roads, a.buildings, a.roofs, a.markings, a.sidewalks]) {
      if (!m) continue;
      for (const v of m.pos) expect(Number.isFinite(v)).toBe(true);
      for (const i of m.idx) expect(i).toBeLessThan(m.pos.length / 3);
    }
    const seam = (m1: Float32Array, m2: Float32Array, axis: 0 | 2, at: number) => {
      const pts1 = new Map<string, number>();
      for (let i = 0; i < m1.length; i += 3) if (Math.abs(m1[i + axis] - at) < 0.01) pts1.set(`${m1[i].toFixed(2)},${m1[i + 2].toFixed(2)}`, m1[i + 1]);
      let shared = 0;
      for (let i = 0; i < m2.length; i += 3) {
        if (Math.abs(m2[i + axis] - at) > 0.01) continue;
        const y = pts1.get(`${m2[i].toFixed(2)},${m2[i + 2].toFixed(2)}`);
        if (y !== undefined) { expect(Math.abs(y - m2[i + 1])).toBeLessThan(1e-4); shared++; }
      }
      return shared;
    };
    expect(seam(a.terrain!.pos, b.terrain!.pos, 0, (cx + 1) * d.chunkSize)).toBeGreaterThan(10);
    expect(seam(a.terrain!.pos, c.terrain!.pos, 2, (cz + 1) * d.chunkSize)).toBeGreaterThan(10);
  });

  it('every chunk generates without throwing', () => {
    const ctx = new ChunkContext(d, chunkOptionsFor(city, 1));
    const r = ctx.chunkRange();
    let tris = 0, n = 0;
    for (let cx = r.cx0; cx <= r.cx1; cx++) for (let cz = r.cz0; cz <= r.cz1; cz++) { tris += ctx.generate(cx, cz).stats.tris; n++; }
    console.log(`${city.id}: ${n} chunks, ${(tris / 1e6).toFixed(2)} M tris total`);
    expect(n).toBeGreaterThan(4);
  });
});
