import type { LatLon } from './cities.ts';

const R = 6378137;
const DEG = Math.PI / 180;

/** Local tangent-plane projection around an origin. +x east, +z south. */
export class LocalProjection {
  readonly mPerDegLat: number;
  readonly mPerDegLon: number;
  readonly origin: LatLon;

  constructor(origin: LatLon) {
    this.origin = origin;
    this.mPerDegLat = R * DEG;
    this.mPerDegLon = R * DEG * Math.cos(origin.lat * DEG);
  }

  toLocal(lat: number, lon: number): { x: number; z: number } {
    return {
      x: (lon - this.origin.lon) * this.mPerDegLon,
      z: -(lat - this.origin.lat) * this.mPerDegLat,
    };
  }

  toLatLon(x: number, z: number): LatLon {
    return { lat: this.origin.lat - z / this.mPerDegLat, lon: this.origin.lon + x / this.mPerDegLon };
  }
}

export function bboxOrigin(bbox: [number, number, number, number]): LatLon {
  return { lat: (bbox[0] + bbox[2]) / 2, lon: (bbox[1] + bbox[3]) / 2 };
}
