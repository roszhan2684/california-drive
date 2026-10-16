// City importer: bounded OpenStreetMap extract + open DEM -> compact district JSON.
// Usage: node --experimental-strip-types tools/import-city.ts <cityId|all>
// Output: public/cities/<id>/district.json
// Data: (c) OpenStreetMap contributors, ODbL. Elevation: AWS Terrain Tiles (USGS 3DEP & others).

import { mkdirSync, writeFileSync } from 'node:fs';
import { CITIES, type CityDef } from '../src/world/cities.ts';
import { LocalProjection, bboxOrigin } from '../src/world/projection.ts';
import { encodeHeights, Heightfield } from '../src/world/heightfield.ts';
import { hash01, pointInPoly, polyArea, polyBounds, polyCentroid, simplifyRing } from '../src/world/geom.ts';
import type { Building, DistrictData, RoadClass, RoadEdge, RoadNode, SurfaceKind } from '../src/world/types.ts';
import { fetchOverpass, TerrariumSampler } from './lib/fetchers.ts';

const CHUNK = 320;
const PAD = 160; // terrain padding beyond the road bbox
const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|living_street';

function overpassQuery(c: CityDef): string {
  const [s, w, n, e] = c.bbox;
  const bb = `${s},${w},${n},${e}`;
  const alpine = c.biome === 'alpine';
  return `[out:json][timeout:180][bbox:${bb}];
(
  way["highway"~"^(${DRIVABLE})$"];
  way["highway"="service"]["name"];
  ${alpine ? 'way["highway"="service"];' : ''}
)->.roads;
.roads out body geom;
node(w.roads)["highway"~"^(traffic_signals|stop)$"];
out body;
(
  way["building"];
  way["building:part"];
  relation["building"]["type"="multipolygon"];
);
out body geom;
(
  way["leisure"~"^(park|garden|pitch|golf_course)$"];
  way["landuse"~"^(grass|recreation_ground|forest|meadow|village_green)$"];
  way["natural"~"^(wood|scrub|grassland)$"];
);
out body geom;
node["natural"="tree"];
out skel;
way["man_made"="pier"];
out body geom;`;
}

interface OsmWay { type: 'way'; id: number; nodes: number[]; geometry: { lat: number; lon: number }[]; tags?: Record<string, string> }
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmRel { type: 'relation'; id: number; tags?: Record<string, string>; members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

function parseMeters(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  const ft = s.match(/^([\d.]+)\s*(ft|')/);
  if (ft) return parseFloat(ft[1]) * 0.3048;
  const fi = s.match(/^(\d+)'\s*(\d+)"?/);
  if (fi) return parseInt(fi[1]) * 0.3048 + parseInt(fi[2]) * 0.0254;
  const m = parseFloat(s);
  return Number.isFinite(m) ? m : undefined;
}

function parseSpeed(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const mph = v.match(/(\d+)\s*mph/);
  if (mph) return parseInt(mph[1]) * 0.44704;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n / 3.6 : undefined;
}

function roadClass(hw: string): RoadClass {
  if (hw.endsWith('_link')) return 'link';
  if (hw === 'unclassified' || hw === 'living_street') return 'residential';
  return (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service'] as const).includes(hw as any) ? (hw as RoadClass) : 'residential';
}

const DEFAULT_SPEED: Record<RoadClass, number> = {
  motorway: 29, trunk: 22, primary: 15.6, secondary: 13.4, tertiary: 11.2, residential: 11.2, service: 6.7, link: 15,
};

function surfaceKind(s: string | undefined): SurfaceKind {
  if (!s) return 'asphalt';
  if (/sett|cobble|paving_stones|brick/.test(s)) return 'cobble';
  if (/concrete/.test(s)) return 'concrete';
  if (/unpaved|dirt|gravel|ground|compacted|fine_gravel/.test(s)) return 'dirt';
  return 'asphalt';
}

async function importCity(city: CityDef) {
  console.log(`\n== ${city.name} (${city.id})`);
  const origin = bboxOrigin(city.bbox);
  const proj = new LocalProjection(origin);
  const [s, w, n, e] = city.bbox;
  const sw = proj.toLocal(s, w), ne = proj.toLocal(n, e);
  const bounds = { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z };

  // ---------- elevation ----------
  const cell = city.cell;
  const x0 = Math.floor((bounds.minX - PAD) / cell) * cell;
  const z0 = Math.floor((bounds.minZ - PAD) / cell) * cell;
  const cols = Math.ceil((bounds.maxX + PAD - x0) / cell) + 1;
  const rows = Math.ceil((bounds.maxZ + PAD - z0) / cell) + 1;
  const sampler = new TerrariumSampler('data/raw/terrarium', cell <= 8 ? 15 : 14);
  const llMin = proj.toLatLon(x0, z0 + (rows - 1) * cell), llMax = proj.toLatLon(x0 + (cols - 1) * cell, z0);
  await sampler.preload(llMin.lat, llMin.lon, llMax.lat, llMax.lon);
  const heights = new Float32Array(cols * rows);
  let nan = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ll = proj.toLatLon(x0 + c * cell, z0 + r * cell);
      let hgt = sampler.sample(ll.lat, ll.lon);
      if (!Number.isFinite(hgt)) { hgt = city.baseElevation; nan++; }
      heights[r * cols + c] = hgt - city.baseElevation;
    }
  }
  // Light 3x3 smoothing removes DEM stair-stepping without flattening hills.
  const sm = new Float32Array(heights.length);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let acc = 0, wsum = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = Math.min(rows - 1, Math.max(0, r + dr)), cc = Math.min(cols - 1, Math.max(0, c + dc));
      const wt = dr === 0 && dc === 0 ? 4 : dr === 0 || dc === 0 ? 2 : 1;
      acc += heights[rr * cols + cc] * wt; wsum += wt;
    }
    sm[r * cols + c] = acc / wsum;
  }
  const hf = new Heightfield(x0, z0, cell, cols, rows, Float32Array.from(sm, (v) => Math.round(v * 10) / 10));
  const waterY = city.waterLevel === null ? null : city.waterLevel - city.baseElevation;
  console.log(`  elevation grid ${cols}x${rows} @${cell}m (${nan} missing)`);

  // ---------- OSM ----------
  const osm = await fetchOverpass(`data/raw/${city.id}.osm.json`, overpassQuery(city));
  const elements: (OsmWay | OsmNode | OsmRel)[] = osm.elements;
  const ways = elements.filter((x): x is OsmWay => x.type === 'way' && !!x.geometry);
  const nodesTagged = elements.filter((x): x is OsmNode => x.type === 'node' && !!x.tags);
  const treesRaw = elements.filter((x): x is OsmNode => x.type === 'node' && !x.tags);
  const rels = elements.filter((x): x is OsmRel => x.type === 'relation');

  const inside = (x: number, z: number, m = 0) => x >= bounds.minX - m && x <= bounds.maxX + m && z >= bounds.minZ - m && z <= bounds.maxZ + m;
  const groundY = (x: number, z: number) => {
    const t = hf.sampleBilinear(x, z);
    return waterY !== null ? Math.max(t, waterY + 0.5) : t;
  };

  // ---------- roads ----------
  const roadWays = ways.filter((wy) => wy.tags?.highway && (new RegExp(`^(${DRIVABLE}|service)$`).test(wy.tags.highway)) && wy.tags.area !== 'yes');
  const nodeUse = new Map<number, number>();
  for (const wy of roadWays) for (const id of new Set(wy.nodes)) nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
  const special = new Map<number, Record<string, string>>();
  for (const nd of nodesTagged) if (nd.tags) special.set(nd.id, nd.tags);

  const nodeIndex = new Map<number, number>();
  const nodes: RoadNode[] = [];
  const nodeKind = new Map<number, { ground: boolean; bridgeLayer: number; tunnel: boolean }>();
  // classify nodes by incident way kinds
  for (const wy of roadWays) {
    const t = wy.tags!;
    const isBridge = t.bridge && t.bridge !== 'no';
    const isTunnel = t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage';
    const layer = parseInt(t.layer ?? (isBridge ? '1' : '0')) || (isBridge ? 1 : 0);
    for (const id of wy.nodes) {
      const k = nodeKind.get(id) ?? { ground: false, bridgeLayer: 0, tunnel: false };
      if (!isBridge && !isTunnel) k.ground = true;
      if (isBridge) k.bridgeLayer = Math.max(k.bridgeLayer, Math.max(1, layer));
      if (isTunnel) k.tunnel = true;
      nodeKind.set(id, k);
    }
  }

  const edges: RoadEdge[] = [];
  let droppedWays = 0;
  const GRADE = 0.07;
  const LAYER_H = 6.5;

  for (const wy of roadWays) {
    const t = wy.tags!;
    const cls = roadClass(t.highway);
    const isBridge = !!t.bridge && t.bridge !== 'no';
    const isTunnel = !!t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage';
    const layer = Math.max(1, parseInt(t.layer ?? '1') || 1);
    // project and clip to bounds (keep inside runs)
    const pts = wy.geometry.map((g, i) => ({ id: wy.nodes[i], ...proj.toLocal(g.lat, g.lon) }));
    const runs: typeof pts[] = [];
    let cur: typeof pts = [];
    for (const p of pts) {
      if (inside(p.x, p.z)) cur.push(p);
      else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    if (!runs.length) { droppedWays++; continue; }

    // lanes / direction
    let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || cls === 'motorway' || t.junction === 'roundabout' || (cls === 'link' && t.oneway !== 'no');
    const reverse = t.oneway === '-1';
    let lanes = parseInt(t.lanes ?? '') || 0;
    let lf = parseInt(t['lanes:forward'] ?? '') || 0;
    let lb = parseInt(t['lanes:backward'] ?? '') || 0;
    if (!lanes) lanes = cls === 'motorway' ? 3 : cls === 'trunk' || cls === 'primary' ? (oneway ? 3 : 4) : cls === 'secondary' ? (oneway ? 2 : 2) : oneway ? 1 : 2;
    if (oneway) { lf = Math.max(1, Math.min(lanes, 5)); lb = 0; }
    else if (!lf || !lb) { lf = Math.max(1, Math.floor(lanes / 2)); lb = Math.max(1, lanes - lf); }
    lf = Math.min(lf, 4); lb = Math.min(lb, 4);
    const urban = city.biome !== 'alpine';
    const parking = urban && cls !== 'motorway' && cls !== 'link' && cls !== 'trunk' && cls !== 'service';
    const width = parseMeters(t.width) ?? (lf + lb) * 3.3 + (parking ? 4.4 : cls === 'service' ? 0.4 : 1.2);
    const speed = parseSpeed(t.maxspeed) ?? DEFAULT_SPEED[cls];
    const surf = surfaceKind(t.surface);
    if (surf === 'dirt' && cls === 'service') continue; // skip rough tracks

    for (const run0 of runs) {
      const run = reverse ? [...run0].reverse() : run0;
      // node heights
      const nodeY = (id: number, x: number, z: number) => {
        const k = nodeKind.get(id);
        const g = groundY(x, z);
        if (!k || k.ground) return g;
        if (k.bridgeLayer > 0) return Math.max(g, waterY ?? -Infinity) + k.bridgeLayer * LAYER_H;
        return g;
      };
      // densify + per-point heights within fixed points (shared nodes)
      const xs: number[] = [], zs: number[] = [], fixed: (number | null)[] = [], ids: (number | null)[] = [];
      for (let i = 0; i < run.length; i++) {
        const p = run[i];
        if (i > 0) {
          const q = run[i - 1];
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          const steps = Math.floor(d / 6);
          for (let s2 = 1; s2 <= steps; s2++) {
            const f = s2 / (steps + 1);
            xs.push(q.x + (p.x - q.x) * f); zs.push(q.z + (p.z - q.z) * f); fixed.push(null); ids.push(null);
          }
        }
        xs.push(p.x); zs.push(p.z);
        const shared = (nodeUse.get(p.id) ?? 0) > 1 || i === 0 || i === run.length - 1;
        fixed.push(shared ? nodeY(p.id, p.x, p.z) : null);
        ids.push(p.id);
      }
      const N = xs.length;
      const cum = [0];
      for (let i = 1; i < N; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
      const hs = new Array<number>(N);
      let fa = 0;
      for (let fb = 1; fb < N; fb++) {
        if (fixed[fb] === null) continue;
        const ha = fixed[fa]!, hb = fixed[fb]!;
        hs[fa] = ha; hs[fb] = hb;
        const L = cum[fb] - cum[fa];
        for (let i = fa + 1; i < fb; i++) {
          const sa = cum[i] - cum[fa], sb = cum[fb] - cum[i];
          const g = groundY(xs[i], zs[i]);
          if (isBridge) {
            const plateau = Math.max(g, waterY ?? -Infinity) + layer * LAYER_H;
            // level deck between fixed ends, ramping (max GRADE) up towards layer height
            hs[i] = Math.max(ha + (hb - ha) * (sa / L), Math.min(plateau, ha + GRADE * sa, hb + GRADE * sb));
            hs[i] = Math.max(hs[i], g);
          } else if (isTunnel) {
            hs[i] = ha + (hb - ha) * (sa / L);
          } else {
            hs[i] = g;
          }
        }
        fa = fb;
      }
      // split at shared nodes into edges
      let start = 0;
      for (let i = 1; i < N; i++) {
        const id = ids[i];
        const isSplit = i === N - 1 || (id !== null && (nodeUse.get(id) ?? 0) > 1);
        if (!isSplit) continue;
        const aId = ids[start]!, bId = ids[i]!;
        if (aId === bId) { start = i; continue; }
        const ensure = (id2: number, k: number) => {
          let idx = nodeIndex.get(id2);
          if (idx === undefined) {
            idx = nodes.length;
            nodeIndex.set(id2, idx);
            const nd: RoadNode = { x: r1(xs[k]), z: r1(zs[k]), y: r2(hs[k]) };
            const sp = special.get(id2);
            if (sp?.highway === 'traffic_signals') nd.sig = 1;
            if (sp?.highway === 'stop') nd.stop = 1;
            nodes.push(nd);
          }
          return idx;
        };
        const a = ensure(aId, start), b = ensure(bId, i);
        const p: number[] = [], h: number[] = [];
        for (let k = start; k <= i; k++) { p.push(r1(xs[k]), r1(zs[k])); h.push(r2(hs[k])); }
        const edge: RoadEdge = { id: edges.length, a, b, p, h, cls, lf, lb, w: r1(width), v: r1(speed) };
        if (t.name) edge.name = t.name;
        if (isBridge) edge.bridge = 1;
        if (isTunnel) edge.tunnel = 1;
        if (surf !== 'asphalt') edge.surf = surf;
        edges.push(edge);
        start = i;
      }
    }
  }
  // Signals in OSM are often tagged on a node just before the junction; promote them to the nearest junction node.
  const degree = new Array(nodes.length).fill(0);
  for (const ed of edges) { degree[ed.a]++; degree[ed.b]++; }
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].sig || degree[i] >= 3) continue;
    let best = -1, bd = 25;
    for (let j = 0; j < nodes.length; j++) {
      if (degree[j] < 3) continue;
      const d = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z);
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) { nodes[best].sig = 1; delete nodes[i].sig; }
  }
  console.log(`  roads: ${edges.length} edges, ${nodes.length} nodes (${droppedWays} ways outside bbox)`);

  // ---------- road spatial index (for building validation) ----------
  const G = 16;
  const roadGrid = new Map<string, { x: number; z: number; r: number }[]>();
  for (const ed of edges) {
    if (ed.tunnel || ed.bridge) continue;
    for (let i = 0; i < ed.p.length - 2; i += 2) {
      const ax = ed.p[i], az = ed.p[i + 1], bx = ed.p[i + 2], bz = ed.p[i + 3];
      const d = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(d / 2));
      for (let s2 = 0; s2 <= steps; s2++) {
        const x = ax + ((bx - ax) * s2) / steps, z = az + ((bz - az) * s2) / steps;
        const key = `${Math.floor(x / G)},${Math.floor(z / G)}`;
        let arr = roadGrid.get(key);
        if (!arr) roadGrid.set(key, (arr = []));
        arr.push({ x, z, r: Math.min(ed.w * 0.5, 4) });
      }
    }
  }
  const blocksRoad = (poly: number[]) => {
    const bb = polyBounds(poly);
    for (let gx = Math.floor(bb.minX / G); gx <= Math.floor(bb.maxX / G); gx++)
      for (let gz = Math.floor(bb.minZ / G); gz <= Math.floor(bb.maxZ / G); gz++) {
        const arr = roadGrid.get(`${gx},${gz}`);
        if (!arr) continue;
        for (const q of arr) if (pointInPoly(q.x, q.z, poly)) return true;
      }
    return false;
  };

  // ---------- landmarks (overrides) ----------
  const landmarkLocal = city.landmarks.map((l) => ({ ...proj.toLocal(l.at.lat, l.at.lon), r: l.radius }));

  // ---------- buildings ----------
  type Raw = { id: number; poly: number[]; tags: Record<string, string>; part: boolean };
  const raws: Raw[] = [];
  const toPoly = (geom: { lat: number; lon: number }[]) => geom.flatMap((g) => { const p = proj.toLocal(g.lat, g.lon); return [p.x, p.z]; });
  for (const wy of ways) {
    const t = wy.tags ?? {};
    if (!t.building && !t['building:part']) continue;
    if (wy.nodes[0] !== wy.nodes[wy.nodes.length - 1]) continue;
    raws.push({ id: wy.id, poly: toPoly(wy.geometry), tags: t, part: !!t['building:part'] && !t.building });
  }
  for (const rl of rels) {
    for (const m of rl.members) {
      if (m.role !== 'outer' || !m.geometry || m.geometry.length < 4) continue;
      const f = m.geometry[0], l = m.geometry[m.geometry.length - 1];
      if (f.lat !== l.lat || f.lon !== l.lon) continue;
      raws.push({ id: rl.id * 7 + raws.length, poly: toPoly(m.geometry), tags: rl.tags ?? {}, part: false });
    }
  }
  const parts = raws.filter((r) => r.part);
  const partCentroids = parts.map((p) => polyCentroid(p.poly));
  const buildings: Building[] = [];
  let dropRoad = 0, dropSmall = 0, dropParent = 0, dropLandmark = 0;
  const pal = city.palette.building.length;
  for (const raw of raws) {
    let poly = simplifyRing(raw.poly);
    if (poly.length < 6) { dropSmall++; continue; }
    let area = polyArea(poly);
    if (area < 0) {
      const rev: number[] = [];
      for (let i = poly.length - 2; i >= 0; i -= 2) rev.push(poly[i], poly[i + 1]);
      poly = rev; area = -area;
    }
    if (area < 12) { dropSmall++; continue; }
    const cen = polyCentroid(poly);
    if (!inside(cen.x, cen.z, -2)) continue;
    if (!raw.part && parts.length) {
      // building outlines that contain building:parts are represented by the parts
      let has = false;
      const bb = polyBounds(poly);
      for (const pc of partCentroids) if (pc.x > bb.minX && pc.x < bb.maxX && pc.z > bb.minZ && pc.z < bb.maxZ && pointInPoly(pc.x, pc.z, poly)) { has = true; break; }
      if (has) { dropParent++; continue; }
    }
    if (landmarkLocal.some((l) => Math.hypot(l.x - cen.x, l.z - cen.z) < l.r + 4)) { dropLandmark++; continue; }
    if (blocksRoad(poly)) { dropRoad++; continue; }
    const t = raw.tags;
    let height = parseMeters(t.height);
    const levels = parseFloat(t['building:levels'] ?? '');
    if (height === undefined && Number.isFinite(levels)) height = levels * 3.3 + 1.5;
    const rnd = hash01(raw.id);
    if (height === undefined) {
      if (city.biome === 'alpine') height = 5 + rnd * 4;
      else if (t.building === 'garage' || t.building === 'shed' || t.building === 'roof') height = 3 + rnd * 2;
      else height = 7 + rnd * (area > 800 ? 22 : 10);
    }
    height = Math.min(420, Math.max(2.5, height));
    let minH = parseMeters(t.min_height);
    const minLevel = parseFloat(t['building:min_level'] ?? '');
    if (minH === undefined && Number.isFinite(minLevel)) minH = minLevel * 3.3;
    // base = lowest terrain under footprint
    let base = Infinity;
    for (let i = 0; i < poly.length; i += 2) base = Math.min(base, hf.sampleBilinear(poly[i], poly[i + 1]));
    base = Math.min(base, hf.sampleBilinear(cen.x, cen.z));
    if (waterY !== null) base = Math.max(base, waterY - 2);
    const top = Math.max(...Array.from({ length: poly.length / 2 }, (_, i) => hf.sampleBilinear(poly[i * 2], poly[i * 2 + 1])));
    // keep the building visibly tall on slopes
    const extra = top - base;
    const bld: Building = { p: poly.map(r1), b: r2(base), h: r1(height + extra), c: Math.floor(rnd * pal) };
    if (minH && minH > 0 && minH < height) bld.m = r1(minH + extra);
    const shape = t['roof:shape'];
    if ((shape === 'hipped' || shape === 'gabled' || shape === 'pyramidal') && height < 18) bld.r = 2;
    else if (height > 14 && area > 150) bld.r = 1;
    buildings.push(bld);
  }
  console.log(`  buildings: ${buildings.length} (dropped small ${dropSmall}, on-road ${dropRoad}, parent ${dropParent}, landmark ${dropLandmark})`);

  // ---------- parks / piers / trees ----------
  const parks: number[][] = [];
  const piers: number[][] = [];
  for (const wy of ways) {
    const t = wy.tags ?? {};
    if (wy.nodes[0] !== wy.nodes[wy.nodes.length - 1]) continue;
    const isPark = /^(park|garden|pitch|golf_course)$/.test(t.leisure ?? '') || /^(grass|recreation_ground|forest|meadow|village_green)$/.test(t.landuse ?? '') || /^(wood|scrub|grassland)$/.test(t.natural ?? '');
    const isPier = t.man_made === 'pier';
    if (!isPark && !isPier) continue;
    const poly = simplifyRing(toPoly(wy.geometry), 0.5).map(r1);
    if (poly.length < 6 || Math.abs(polyArea(poly)) < 30) continue;
    (isPier ? piers : parks).push(poly);
  }
  const trees: number[] = [];
  for (const tn of treesRaw) {
    const p = proj.toLocal(tn.lat, tn.lon);
    if (inside(p.x, p.z)) trees.push(r1(p.x), r1(p.z));
  }
  console.log(`  parks ${parks.length}, piers ${piers.length}, trees ${trees.length / 2}`);

  const data: DistrictData = {
    version: 1,
    id: city.id,
    origin,
    bounds: { minX: r1(bounds.minX), maxX: r1(bounds.maxX), minZ: r1(bounds.minZ), maxZ: r1(bounds.maxZ) },
    chunkSize: city.cell * Math.round(CHUNK / city.cell),
    waterY,
    elevation: { x0, z0, cell, cols, rows, data: encodeHeights(hf.h) },
    nodes,
    edges,
    buildings,
    parks,
    piers,
    trees,
    attribution: 'Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Terrain Tiles (USGS 3DEP and other open sources).',
    stats: { edges: edges.length, nodes: nodes.length, buildings: buildings.length, trees: trees.length / 2, droppedBuildingsOnRoad: dropRoad },
  };
  mkdirSync(`public/cities/${city.id}`, { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(`public/cities/${city.id}/district.json`, json);
  console.log(`  wrote public/cities/${city.id}/district.json (${(json.length / 1e6).toFixed(2)} MB)`);
}

function r1(v: number) { return Math.round(v * 10) / 10; }
function r2(v: number) { return Math.round(v * 100) / 100; }

const arg = process.argv[2] ?? 'sf';
const list = arg === 'all' ? CITIES : CITIES.filter((c) => c.id === arg);
if (!list.length) { console.error(`unknown city ${arg}`); process.exit(1); }
for (const c of list) {
  await importCity(c);
  if (list.length > 1) await new Promise((r) => setTimeout(r, 3000));
}
