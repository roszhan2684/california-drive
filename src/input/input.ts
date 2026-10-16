import type { DriveInput } from '../physics/vehicle/vehicle.ts';
import { PAD, type Action, type KeyBindings } from './bindings.ts';

/**
 * Keyboard steering filter: ramps towards the target with a speed-sensitive rate and
 * returns to center faster than it leaves it. Pure so it can be unit tested.
 */
export function filterKeyboardSteer(current: number, left: boolean, right: boolean, speed: number, dt: number): number {
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const speedFactor = 1 / (1 + speed / 28);
  const rateOut = 2.6 * (0.45 + 0.55 * speedFactor);
  const rateBack = 4.2;
  const rate = target === 0 || Math.sign(target) !== Math.sign(current) ? rateBack : rateOut;
  const d = target - current;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

function deadzone(v: number, dz = 0.12) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

export type InputSource = 'keyboard' | 'gamepad';

export class InputManager {
  keys: KeyBindings;
  private down = new Set<string>();
  private pressedQueue = new Map<Action, number>();
  private padPrev: boolean[] = [];
  private steerKb = 0;
  private throttleKb = 0;
  private brakeKb = 0;
  enabled = true;
  lastSource: InputSource = 'keyboard';
  lookX = 0;
  lookY = 0;
  private target: EventTarget;
  private onKeyDown = (e: Event) => this.keyDown(e as KeyboardEvent);
  private onKeyUp = (e: Event) => this.keyUp(e as KeyboardEvent);
  private onBlur = () => this.down.clear();

  constructor(keys: KeyBindings, target: EventTarget = window) {
    this.keys = keys;
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private actionsFor(code: string): Action[] {
    const out: Action[] = [];
    for (const [a, codes] of Object.entries(this.keys) as [Action, string[]][]) if (codes.includes(code)) out.push(a);
    return out;
  }

  private keyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const acts = this.actionsFor(e.code);
    if (acts.length && this.enabled) {
      if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
    }
    if (!e.repeat) for (const a of acts) this.pressedQueue.set(a, (this.pressedQueue.get(a) ?? 0) + 1);
    this.down.add(e.code);
    this.lastSource = 'keyboard';
  }

  private keyUp(e: KeyboardEvent) {
    this.down.delete(e.code);
  }

  held(a: Action): boolean {
    return this.keys[a].some((c) => this.down.has(c)) || this.padHeld(a);
  }

  /** Edge-triggered: true once per press. */
  consume(a: Action): boolean {
    const n = this.pressedQueue.get(a) ?? 0;
    if (n <= 0) return false;
    if (n === 1) this.pressedQueue.delete(a);
    else this.pressedQueue.set(a, n - 1);
    return true;
  }

  clearPressed() {
    this.pressedQueue.clear();
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  private padHeld(a: Action): boolean {
    const p = this.pad();
    if (!p) return false;
    const idx = (PAD as Record<string, number>)[a];
    return idx !== undefined && !!p.buttons[idx]?.pressed && a !== 'throttle' && a !== 'brake';
  }

  /** Poll gamepad edges once per frame. */
  pollPad() {
    const p = this.pad();
    if (!p) return;
    const map: [Action, number][] = [
      ['camera', PAD.camera], ['reset', PAD.reset], ['gearUp', PAD.gearUp], ['gearDown', PAD.gearDown], ['pause', PAD.pause],
      ['photo', PAD.photo], ['horn', PAD.horn], ['headlights', PAD.headlights], ['wipers', PAD.wipers],
      ['indicatorLeft', PAD.indicatorLeft], ['indicatorRight', PAD.indicatorRight], ['activity', PAD.activity],
    ];
    for (const [a, i] of map) {
      const now = !!p.buttons[i]?.pressed;
      if (now && !this.padPrev[i]) { this.pressedQueue.set(a, (this.pressedQueue.get(a) ?? 0) + 1); this.lastSource = 'gamepad'; }
      this.padPrev[i] = now;
    }
    this.lookX = deadzone(p.axes[PAD.lookX] ?? 0, 0.18);
    this.lookY = deadzone(p.axes[PAD.lookY] ?? 0, 0.18);
  }

  /** Build the analog driving input for this frame. */
  drive(speed: number, dt: number): DriveInput {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const left = this.held('steerLeft'), right = this.held('steerRight');
    this.steerKb = filterKeyboardSteer(this.steerKb, left, right, speed, dt);
    const tk = this.held('throttle'), bk = this.held('brake');
    this.throttleKb += ((tk ? 1 : 0) - this.throttleKb) * Math.min(1, dt * (tk ? 9 : 14));
    this.brakeKb += ((bk ? 1 : 0) - this.brakeKb) * Math.min(1, dt * (bk ? 12 : 16));
    let steer = this.steerKb, throttle = this.throttleKb, brake = this.brakeKb;
    let handbrake = this.held('handbrake') ? 1 : 0;
    const p = this.pad();
    if (p) {
      const s = deadzone(p.axes[PAD.steerAxis] ?? 0);
      const th = p.buttons[PAD.throttleTrigger]?.value ?? 0;
      const br = p.buttons[PAD.brakeTrigger]?.value ?? 0;
      if (Math.abs(s) > 0 || th > 0.02 || br > 0.02) {
        this.lastSource = 'gamepad';
        // mild non-linearity for precision around center
        steer = Math.abs(s) > Math.abs(steer) ? Math.sign(s) * Math.pow(Math.abs(s), 1.4) : steer;
        throttle = Math.max(throttle, th);
        brake = Math.max(brake, br);
      }
      if (p.buttons[PAD.handbrake]?.pressed) handbrake = 1;
    }
    return { throttle, brake, steer, handbrake };
  }

  /** Wait for the next key press (for remapping). */
  captureNextKey(): Promise<string> {
    return new Promise((resolve) => {
      const h = (e: Event) => {
        const ke = e as KeyboardEvent;
        ke.preventDefault();
        ke.stopPropagation();
        this.target.removeEventListener('keydown', h, true);
        resolve(ke.code);
      };
      this.target.addEventListener('keydown', h, true);
    });
  }
}
