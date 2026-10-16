// Hand-traced, simplified California outline (lat, lon). Stylized; not survey-accurate.
export const CA_OUTLINE: [number, number][] = [
  [42.0, -124.21], [42.0, -120.0], [39.0, -120.0], [38.2, -119.0], [37.4, -117.95], [36.4, -116.6], [35.0, -114.63],
  [34.87, -114.63], [34.3, -114.14], [33.7, -114.5], [33.03, -114.47], [32.72, -114.72], [32.53, -117.12],
  [32.7, -117.25], [33.2, -117.4], [33.6, -117.9], [33.75, -118.3], [33.9, -118.42], [34.03, -118.75], [34.1, -119.15],
  [34.4, -119.7], [34.45, -120.45], [34.9, -120.65], [35.4, -120.9], [35.7, -121.3], [36.0, -121.5], [36.3, -121.9],
  [36.6, -121.95], [36.95, -122.0], [37.2, -122.4], [37.5, -122.5], [37.78, -122.51], [37.82, -122.48], [38.0, -122.98],
  [38.3, -123.05], [38.7, -123.45], [38.95, -123.73], [39.4, -123.82], [39.8, -123.85], [40.1, -124.1], [40.44, -124.4],
  [40.8, -124.2], [41.2, -124.1], [41.75, -124.2], [42.0, -124.21],
];

const LAT0 = 37.2;
const K = Math.cos((LAT0 * Math.PI) / 180);

export interface MapFrame { x0: number; y0: number; scale: number; width: number; height: number }

export function mapFrame(width: number, height: number, pad = 30): MapFrame {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lat, lon] of CA_OUTLINE) {
    const x = lon * K, y = -lat;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  return { x0: minX - (width / scale - (maxX - minX)) / 2, y0: minY - (height / scale - (maxY - minY)) / 2, scale, width, height };
}

export function project(f: MapFrame, lat: number, lon: number): [number, number] {
  return [(lon * K - f.x0) * f.scale, (-lat - f.y0) * f.scale];
}

export function outlinePath(f: MapFrame): string {
  return CA_OUTLINE.map(([lat, lon], i) => { const [x, y] = project(f, lat, lon); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z';
}
