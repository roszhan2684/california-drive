import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { apertureFor, focalToFov, letterboxFrac } from '../../src/ui/photo.ts';
import { wheelBlurOpacity } from '../../src/vehicle/carDetail.ts';
import { radarPoints } from '../../src/ui/garage.ts';
import { VEHICLES } from '../../src/vehicle/vehicles.ts';
import { hypsoColor, inCalifornia } from '../../src/game/reliefScene.ts';

describe('photo lens maths', () => {
  it('maps full-frame focal lengths to vertical FOV', () => {
    expect(focalToFov(50)).toBeCloseTo(27.0, 0);
    expect(focalToFov(24)).toBeCloseTo(53.1, 0);
    expect(focalToFov(135)).toBeLessThan(focalToFov(85));
  });
  it('letterbox bars only when the target is wider than the screen', () => {
    expect(letterboxFrac(0, 16 / 9)).toBe(0);
    expect(letterboxFrac(1.5, 16 / 9)).toBe(0);
    expect(letterboxFrac(2.39, 16 / 9)).toBeCloseTo((1 - (16 / 9) / 2.39) / 2, 5);
  });
  it('wider apertures and longer lenses blur more', () => {
    expect(apertureFor(0, 50)).toBe(0);
    expect(apertureFor(1.4, 50)).toBeGreaterThan(apertureFor(5.6, 50));
    expect(apertureFor(2.8, 135)).toBeGreaterThan(apertureFor(2.8, 35));
  });
});

describe('car detail', () => {
  it('wheel blur fades in with wheel speed and saturates', () => {
    expect(wheelBlurOpacity(0)).toBe(0);
    expect(wheelBlurOpacity(10)).toBe(0);
    expect(wheelBlurOpacity(-80)).toBeCloseTo(0.92, 5);
    expect(wheelBlurOpacity(30)).toBeGreaterThan(wheelBlurOpacity(20));
  });
});

describe('garage radar', () => {
  it('places every axis inside the chart radius', () => {
    for (const v of Object.values(VEHICLES)) {
      const pts = radarPoints(v.specs, 92, 120, 120);
      expect(pts.length).toBe(6);
      for (const [x, y] of pts) expect(Math.hypot(x - 120, y - 120)).toBeLessThanOrEqual(92 + 1e-6);
    }
  });
  it('spec sheet power matches each torque curve peak (±5%)', () => {
    for (const v of Object.values(VEHICLES)) {
      const peak = Math.max(...v.config.engine.torqueCurve.filter(([r]) => r <= v.config.engine.limiterRpm).map(([rpm, nm]) => (nm * rpm) / 9549 * 1.341));
      expect(Math.abs(peak - v.specs.hp) / v.specs.hp).toBeLessThan(0.05);
    }
  });
});

describe('california relief', () => {
  it('classifies cities inside and neighbours outside the state outline', () => {
    expect(inCalifornia(37.77, -122.42)).toBe(true); // SF
    expect(inCalifornia(34.05, -118.25)).toBe(true); // LA
    expect(inCalifornia(36.17, -115.14)).toBe(false); // Las Vegas, NV
    expect(inCalifornia(42.5, -122.8)).toBe(false); // Medford, OR
  });
  it('tints low ground green-gold and peaks white', () => {
    const c = new Color();
    hypsoColor(50, c);
    expect(c.g).toBeGreaterThan(c.b);
    hypsoColor(4300, c);
    expect(c.r).toBeCloseTo(1, 5);
  });
});
