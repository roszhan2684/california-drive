import { describe, expect, it } from 'vitest';
import { filterKeyboardSteer, InputManager } from '../../src/input/input.ts';
import { DEFAULT_KEYS, ACTION_LABELS, type Action } from '../../src/input/bindings.ts';

describe('input', () => {
  it('keyboard steering ramps in, is slower at speed and recenters quickly', () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s = filterKeyboardSteer(s, false, true, 0, 1 / 60);
    const slowSpeed = s;
    let f = 0;
    for (let i = 0; i < 6; i++) f = filterKeyboardSteer(f, false, true, 50, 1 / 60);
    expect(slowSpeed).toBeGreaterThan(f);
    let r = 1;
    for (let i = 0; i < 20; i++) r = filterKeyboardSteer(r, false, false, 30, 1 / 60);
    expect(r).toBe(0);
  });

  it('every action has a binding and a label', () => {
    for (const a of Object.keys(ACTION_LABELS) as Action[]) expect(DEFAULT_KEYS[a].length).toBeGreaterThan(0);
  });

  it('counts repeated presses within one frame and maps keys to actions', () => {
    const target = new EventTarget();
    const im = new InputManager(structuredClone(DEFAULT_KEYS), target);
    const key = (type: string, code: string) => { const e = new Event(type) as any; e.code = code; e.repeat = false; e.preventDefault = () => undefined; target.dispatchEvent(e); };
    key('keydown', 'KeyC'); key('keyup', 'KeyC');
    key('keydown', 'KeyC'); key('keyup', 'KeyC');
    expect(im.consume('camera')).toBe(true);
    expect(im.consume('camera')).toBe(true);
    expect(im.consume('camera')).toBe(false);
    key('keydown', 'KeyW');
    expect(im.held('throttle')).toBe(true);
    const d = im.drive(0, 0.5);
    expect(d.throttle).toBeGreaterThan(0.9);
    key('keyup', 'KeyW');
    im.dispose();
  });
});
