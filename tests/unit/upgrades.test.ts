import { describe, expect, it } from 'vitest';
import { ease, Spring } from '../../src/ui/motion.ts';
import { nextLockState, pickTarget } from '../../src/ui/targetLock.ts';
import { keyFile } from '../../src/ui/glyphs.ts';
import { isGlassUV, samplePalette } from '../../src/vehicle/kenneyFleet.ts';
import { parkedVariantIndex, isResponding } from '../../src/vehicle/trafficModels.ts';
import { TrafficSystem } from '../../src/traffic/traffic.ts';
import type { Marker } from '../../src/activities/activities.ts';

describe('motion (Godot-style tweens)', () => {
  it('every curve starts at 0 and ends at 1 in every ease mode', () => {
    for (const trans of ['linear', 'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const) {
      for (const mode of ['in', 'out', 'in_out', 'out_in'] as const) {
        expect(ease(0, trans, mode), `${trans}/${mode}`).toBeCloseTo(0, 5);
        expect(ease(1, trans, mode), `${trans}/${mode}`).toBeCloseTo(1, 5);
      }
    }
  });
  it('back/out overshoots then settles (the UI pop)', () => {
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, ease(t, 'back', 'out'));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.15);
  });
  it('an under-damped spring overshoots and converges', () => {
    const s = new Spring(0, 4, 0.4);
    s.target = 1;
    let peak = 0;
    for (let i = 0; i < 240; i++) peak = Math.max(peak, s.step(1 / 60));
    expect(peak).toBeGreaterThan(1.05);
    expect(s.value).toBeCloseTo(1, 2);
  });
});

describe('target lock state machine', () => {
  it('idle → acquiring → locked → lost → idle', () => {
    expect(nextLockState('idle', true, true, 0)).toBe('acquiring');
    expect(nextLockState('acquiring', true, true, 0.2)).toBe('acquiring');
    expect(nextLockState('acquiring', true, true, 0.6)).toBe('locked');
    expect(nextLockState('locked', true, false, 3)).toBe('acquiring');
    expect(nextLockState('locked', false, false, 3)).toBe('lost');
    expect(nextLockState('lost', false, false, 0.1)).toBe('lost');
    expect(nextLockState('lost', false, false, 0.4)).toBe('idle');
    expect(nextLockState('lost', true, false, 0.1)).toBe('acquiring');
  });
  it('prefers the live checkpoint, else the nearest marker outside its start zone', () => {
    const m = (id: string, x: number, radius = 12): Marker => ({ id, kind: 'drift', name: id, x, y: 0, z: 0, heading: 0, radius } as Marker);
    const markers = [m('far', 250), m('near', 60), m('here', 5)];
    expect(pickTarget(markers, null, 0, 0)?.id).toBe('near');
    expect(pickTarget(markers, { x: 1, z: 1 }, 0, 0)?.kind).toBe('checkpoint');
    expect(pickTarget([m('out', 900)], null, 0, 0)).toBeNull();
  });
});

describe('Kenney assets', () => {
  it('maps key codes to input-prompt glyph files', () => {
    expect(keyFile('KeyW')).toBe('keyboard_w.svg');
    expect(keyFile('Digit7')).toBe('keyboard_7.svg');
    expect(keyFile('ArrowLeft')).toBe('keyboard_arrow_left.svg');
    expect(keyFile('Space')).toBe('keyboard_space.svg');
    expect(keyFile('F3')).toBe('keyboard_f3.svg');
    expect(keyFile('NumpadAdd')).toBeNull();
  });
  it('samples the palette in linear space and finds the glass swatch', () => {
    const px = new Uint8ClampedArray(4 * 4 * 4);
    px.set([255, 255, 255, 255], 0); // top-left texel: white
    px.set([188, 188, 188, 255], (3 * 4 + 3) * 4); // bottom-right: sRGB 188 ≈ linear 0.5
    const pal = { w: 4, h: 4, px };
    expect(samplePalette(pal, 0.01, 0.01)[0]).toBeCloseTo(1, 3);
    expect(samplePalette(pal, 0.99, 0.99)[1]).toBeCloseTo(0.5, 1);
    expect(isGlassUV(0.094, 0.91)).toBe(true);
    expect(isGlassUV(0.05, 0.1)).toBe(false);
    expect(isGlassUV(0.594, 0.33)).toBe(false);
  });
  it('spreads parked cars over the fleet but keeps most procedural', () => {
    const counts = new Array(10).fill(0);
    for (let r = 0; r < 100; r++) counts[parkedVariantIndex(r, 10)]++;
    expect(counts.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(64);
    expect(counts.slice(4).every((c) => c > 0)).toBe(true);
    for (let r = 0; r < 100; r++) expect(parkedVariantIndex(r, 4)).toBe(r % 4);
  });
  it('responding emergency units are stable per agent', () => {
    expect(isResponding(8, 'police')).toBe(true);
    expect(isResponding(9, 'police')).toBe(false);
    expect(isResponding(4, 'ambulance')).toBe(true);
    expect(isResponding(4, undefined)).toBe(false);
  });
});

describe('weighted traffic spawn', () => {
  it('picks variants in proportion to weight and never picks weight 0', () => {
    const sys = Object.create(TrafficSystem.prototype) as TrafficSystem;
    (sys as unknown as { opts: unknown }).opts = { variantDims: [{ length: 4, width: 2 }, { length: 4, width: 2, weight: 0 }, { length: 9, width: 2.5, weight: 3 }] };
    const hits = [0, 0, 0];
    for (let i = 0; i < 4000; i++) hits[sys.pickVariant((i + 0.5) / 4000)]++;
    expect(hits[1]).toBe(0);
    expect(hits[2] / hits[0]).toBeCloseTo(3, 1);
  });
});
