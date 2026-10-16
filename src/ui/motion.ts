// UI motion borrowed from Godot's Tween API (Tween.TRANS_* × Tween.EASE_*), plus a damped spring.
// Godot's default curve for UI pop-ins, TRANS_BACK + EASE_OUT, overshoots and then settles, so a panel
// lands with some mechanical weight instead of sliding in linearly.
//
//   tween(panel).prop('opacity', 0, 1, 0.25).prop('y', 14, 0, 0.45, 'back', 'out')
//   tween(el).parallel(false).prop(...).interval(0.2).callback(() => ...)

export type Trans = 'linear' | 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
export type Ease = 'in' | 'out' | 'in_out' | 'out_in';

const PI = Math.PI;

/** "In" curves (t: 0..1 → 0..1); the other ease modes are derived from these, as in Godot. */
const IN: Record<Trans, (t: number) => number> = {
  linear: (t) => t,
  sine: (t) => 1 - Math.cos((t * PI) / 2),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  quint: (t) => t * t * t * t * t,
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  elastic: (t) => (t === 0 || t === 1 ? t : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * PI) / 3))),
  bounce: (t) => 1 - bounceOut(1 - t),
};

function bounceOut(t: number) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export function ease(t: number, trans: Trans = 'quad', mode: Ease = 'out'): number {
  t = Math.max(0, Math.min(1, t));
  const f = IN[trans];
  switch (mode) {
    case 'in': return f(t);
    case 'out': return 1 - f(1 - t);
    case 'in_out': return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;
    case 'out_in': return t < 0.5 ? (1 - f(1 - t * 2)) / 2 : 0.5 + f(t * 2 - 1) / 2;
  }
}

let reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Follows the in-game "Reduced motion" setting: tweens jump to their end state. */
export function setReducedMotion(on: boolean) {
  reduced = on;
}
export function reducedMotion() {
  return reduced;
}

/** Transform channels composed into one CSS transform; everything else is written as a style property. */
type Channel = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate' | 'opacity' | 'blur' | 'clip';

interface Step {
  start: number;
  dur: number;
  run: (k: number) => void;
  done?: boolean;
}

const live = new Set<Tween>();
let raf = 0;
let last = 0;

function loop(now: number) {
  // wall-clock time so UI timing holds at low frame rates; only long stalls (hidden tab) are clamped
  const dt = last ? Math.min(0.5, (now - last) / 1000) : 0;
  last = now;
  for (const t of live) t.advance(dt);
  raf = live.size ? requestAnimationFrame(loop) : 0;
  if (!raf) last = 0;
}

const states = new WeakMap<HTMLElement | SVGElement, Partial<Record<Channel, number>>>();
const owners = new WeakMap<HTMLElement | SVGElement, Tween>();

function apply(el: HTMLElement | SVGElement) {
  const s = states.get(el)!;
  const tf: string[] = [];
  if (s.x !== undefined || s.y !== undefined) tf.push(`translate(${(s.x ?? 0).toFixed(2)}px, ${(s.y ?? 0).toFixed(2)}px)`);
  if (s.rotate !== undefined) tf.push(`rotate(${s.rotate.toFixed(2)}deg)`);
  if (s.scale !== undefined) tf.push(`scale(${s.scale.toFixed(4)})`);
  if (s.scaleX !== undefined || s.scaleY !== undefined) tf.push(`scale(${(s.scaleX ?? 1).toFixed(4)}, ${(s.scaleY ?? 1).toFixed(4)})`);
  const st = el.style;
  st.setProperty('--tw', tf.join(' ') || 'translate(0px, 0px)');
  if (s.opacity !== undefined) st.opacity = s.opacity.toFixed(3);
  if (s.blur !== undefined) st.filter = s.blur > 0.01 ? `blur(${s.blur.toFixed(2)}px)` : '';
  if (s.clip !== undefined) st.clipPath = s.clip >= 99.9 ? '' : `circle(${s.clip.toFixed(2)}% at 50% 50%)`;
}

/**
 * A Godot-style tween bound to one element. Steps run in sequence by default; call `parallel()` to make
 * following steps start together with the previous one. Starting a new tween on an element kills the old one.
 */
export class Tween {
  private steps: Step[] = [];
  private cursor = 0;
  private groupStart = 0;
  private isParallel = false;
  private t = 0;
  private finished: (() => void)[] = [];
  readonly el: HTMLElement | SVGElement;

  constructor(el: HTMLElement | SVGElement) {
    this.el = el;
    owners.get(el)?.kill();
    owners.set(el, this);
    if (!states.has(el)) states.set(el, {});
    el.classList.add('tw');
  }

  /** Subsequent steps run alongside the previous one (Godot: `set_parallel(true)`). */
  parallel(on = true) {
    this.isParallel = on;
    return this;
  }

  private push(dur: number, delay: number, run: (k: number) => void) {
    const start = (this.isParallel ? this.groupStart : this.cursor) + delay;
    if (!this.isParallel) this.groupStart = start;
    this.steps.push({ start, dur: Math.max(1e-4, dur), run });
    this.cursor = Math.max(this.cursor, start + dur);
    return this;
  }

  /** Animate a channel from → to (Godot: `tween_property`). */
  prop(ch: Channel, from: number, to: number, dur: number, trans: Trans = 'quad', mode: Ease = 'out', delay = 0) {
    const s = states.get(this.el)!;
    s[ch] = from;
    apply(this.el);
    return this.push(dur, delay, (k) => {
      s[ch] = from + (to - from) * ease(k, trans, mode);
      apply(this.el);
    });
  }

  /** Animate any value through a setter (SVG attributes, canvas state…) (Godot: `tween_method`). */
  method(fn: (v: number) => void, from: number, to: number, dur: number, trans: Trans = 'quad', mode: Ease = 'out', delay = 0) {
    fn(from);
    return this.push(dur, delay, (k) => fn(from + (to - from) * ease(k, trans, mode)));
  }

  interval(dur: number) {
    return this.push(dur, 0, () => {});
  }

  callback(fn: () => void) {
    let fired = false;
    return this.push(1e-4, 0, () => { if (!fired) { fired = true; fn(); } });
  }

  then(fn: () => void) {
    this.finished.push(fn);
    return this;
  }

  /** Start on the next frame (called automatically by `tween()`). */
  play() {
    live.add(this);
    if (reduced) this.advance(1e9);
    else if (!raf) raf = requestAnimationFrame(loop);
    return this;
  }

  advance(dt: number) {
    this.t += dt;
    let all = true;
    for (const s of this.steps) {
      if (s.done) continue;
      if (this.t < s.start) { all = false; continue; }
      const k = Math.min(1, (this.t - s.start) / s.dur);
      s.run(k);
      if (k >= 1) s.done = true; else all = false;
    }
    if (all) {
      live.delete(this);
      if (owners.get(this.el) === this) owners.delete(this.el);
      for (const f of this.finished) f();
      this.finished = [];
    }
  }

  kill() {
    live.delete(this);
    this.finished = [];
  }
}

export function tween(el: HTMLElement | SVGElement): Tween {
  const t = new Tween(el);
  queueMicrotask(() => t.play());
  return t;
}

/** Clear tween-owned styles so CSS takes over again. */
export function resetTween(el: HTMLElement | SVGElement) {
  owners.get(el)?.kill();
  owners.delete(el);
  states.set(el, {});
  el.style.removeProperty('--tw');
  el.style.opacity = '';
  el.style.filter = '';
  el.style.clipPath = '';
}

// ---------------------------------------------------------------- presets (one place to tune the feel)

/** Panel / sheet pop: fade + rise + slight scale with a Back overshoot. */
export function popIn(el: HTMLElement, delay = 0, from = 16) {
  return tween(el).parallel()
    .prop('opacity', 0, 1, 0.22, 'sine', 'out', delay)
    .prop('y', from, 0, 0.55, 'back', 'out', delay)
    .prop('scale', 0.94, 1, 0.5, 'back', 'out', delay);
}

export function popOut(el: HTMLElement, to = -10) {
  return tween(el).parallel()
    .prop('opacity', 1, 0, 0.2, 'sine', 'in')
    .prop('y', 0, to, 0.22, 'quad', 'in')
    .prop('scale', 1, 0.97, 0.22, 'quad', 'in');
}

/** Drop-in from above with an elastic settle (toasts). */
export function dropIn(el: HTMLElement) {
  return tween(el).parallel()
    .prop('opacity', 0, 1, 0.18, 'sine', 'out')
    .prop('y', -26, 0, 0.7, 'elastic', 'out')
    .prop('scaleX', 0.8, 1, 0.45, 'back', 'out');
}

/** Iris open (circle clip) for round widgets such as the radar. */
export function irisIn(el: HTMLElement, delay = 0) {
  return tween(el).parallel()
    .prop('clip', 0, 100, 0.7, 'back', 'out', delay)
    .prop('opacity', 0, 1, 0.2, 'linear', 'in', delay)
    .prop('rotate', -40, 0, 0.8, 'cubic', 'out', delay);
}

/**
 * Damped spring (semi-implicit Euler, sub-stepped). `zeta` < 1 overshoots: 0.5 is lively, 1 is critical.
 * Used for gauge needles and HUD values that should carry inertia.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  omega: number;
  zeta: number;

  constructor(value = 0, frequency = 6, zeta = 0.55) {
    this.value = this.target = value;
    this.omega = frequency * 2 * PI;
    this.zeta = zeta;
  }

  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -2 * this.zeta * this.omega * this.velocity - this.omega * this.omega * (this.value - this.target);
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  snap(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}

/** Typewriter + scramble reveal for short labels (cinematic callouts). */
export function scrambleText(el: HTMLElement, text: string, dur = 0.6, glyphs = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>') {
  if (reduced) { el.textContent = text; return; }
  const t0 = performance.now();
  const token = String(Math.random());
  el.dataset.scramble = token;
  const tick = () => {
    if (el.dataset.scramble !== token) return;
    const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
    const n = Math.floor(text.length * ease(k, 'cubic', 'out'));
    let s = text.slice(0, n);
    for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : glyphs[Math.floor(Math.random() * glyphs.length)];
    el.textContent = s;
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}
