// District data format produced by tools/import-city.ts and consumed at runtime.
// World axes: +x = east, +z = south (north is -z), +y = up. Units: meters.

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'link';
export type SurfaceKind = 'asphalt' | 'concrete' | 'cobble' | 'dirt';

export interface RoadNode {
  x: number;
  z: number;
  y: number;
  /** Has a traffic signal. */
  sig?: 1;
  /** Stop sign. */
  stop?: 1;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  /** Flattened x,z pairs, including both endpoints. */
  p: number[];
  /** Deck height per point (world y). */
  h: number[];
  cls: RoadClass;
  name?: string;
  /** Lanes travelling a->b. */
  lf: number;
  /** Lanes travelling b->a (0 when one-way). */
  lb: number;
  /** Total carriageway width (m). */
  w: number;
  /** Speed limit (m/s). */
  v: number;
  bridge?: 1;
  tunnel?: 1;
  surf?: SurfaceKind;
}

export interface Building {
  /** Footprint, flattened x,z, counter-clockwise when viewed from above (+y). */
  p: number[];
  /** Base y (lowest terrain under footprint). */
  b: number;
  /** Height above base. */
  h: number;
  /** Minimum height (building:part min_height) above base. */
  m?: number;
  /** Palette color index. */
  c: number;
  /** Roof style: 0 flat, 1 parapet, 2 pitched-ish (hip). */
  r?: number;
}

export interface ElevationGrid {
  /** World x of column 0. */
  x0: number;
  /** World z of row 0. */
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Base64 of Int16Array heights in decimeters (world y * 10), row-major. */
  data: string;
}

export interface DistrictData {
  version: number;
  id: string;
  origin: { lat: number; lon: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  chunkSize: number;
  waterY: number | null;
  elevation: ElevationGrid;
  nodes: RoadNode[];
  edges: RoadEdge[];
  buildings: Building[];
  /** Park/grass polygons, flattened x,z. */
  parks: number[][];
  /** Pier/plaza deck polygons. */
  piers: number[][];
  /** Trees, flattened x,z. */
  trees: number[];
  attribution: string;
  stats: Record<string, number>;
}
