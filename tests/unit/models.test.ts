import { describe, expect, it } from 'vitest';
import { trafficVariants } from '../../src/vehicle/trafficModels.ts';
import { propGeometries } from '../../src/world/props.ts';

describe('procedural models', () => {
  it('builds every traffic variant with merged body + lights', () => {
    const v = trafficVariants();
    expect(v.length).toBe(4);
    for (const t of v) {
      expect(t.body).toBeTruthy();
      expect(t.lights).toBeTruthy();
      expect(t.body.getAttribute('color')).toBeTruthy();
      expect(t.body.getAttribute('position').count).toBeGreaterThan(100);
      t.body.computeBoundingSphere();
      expect(Number.isFinite(t.body.boundingSphere!.radius)).toBe(true);
    }
  });
  it('builds all prop geometries', () => {
    const g = propGeometries();
    for (const [k, v] of Object.entries(g)) {
      const list = Array.isArray(v) ? v : [v];
      for (const geo of list) expect(geo, k).toBeTruthy();
    }
  });
});
