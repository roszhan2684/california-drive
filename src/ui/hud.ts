import type { Telemetry } from '../physics/vehicle/vehicle.ts';
import type { DistrictData } from '../world/types.ts';
import { Heightfield } from '../world/heightfield.ts';
import type { HudActivity, Marker } from '../activities/activities.ts';
import { el, esc, qs, show } from './dom.ts';
import type { Action, KeyBindings } from '../input/bindings.ts';
import type { InputSource } from '../input/input.ts';
import { actionGlyph, actionGlyphs } from './glyphs.ts';
import { dropIn, irisIn, popIn, popOut, reducedMotion, scrambleText, tween } from './motion.ts';
import { TargetLock } from './targetLock.ts';

const ARC_R = 98;
const SHIFT_LEDS = 10;
/** 1 g in m/s². */
const G = 9.81;
const ARC_LEN = Math.PI * 2 * ARC_R * 0.75;

export class Hud {
  readonly root: HTMLElement;
  private speed: HTMLElement;
  private unit: HTMLElement;
  private gear: HTMLElement;
  private rpmArc: SVGCircleElement;
  private redArc: SVGCircleElement;
  private tells: Record<string, HTMLElement> = {};
  private streetBox: HTMLElement;
  private streetName: HTMLElement;
  private streetArea: HTMLElement;
  private camLabel: HTMLElement;
  private actBox: HTMLElement;
  private promptBox: HTMLElement;
  private toasts: HTMLElement;
  private debugBox: HTMLElement;
  private hint: HTMLElement;
  private compass: HTMLElement;
  readonly minimap: Minimap;
  readonly lock: TargetLock;
  private hintKey = '';
  private keys: KeyBindings | null = null;
  private source: InputSource = 'keyboard';
  private promptText: string | null = null;
  private booting = 0;
  /** Seconds since the HUD booted; the control hints show from 2.4 s (after the boot log) to 16 s. */
  private hintAge = 0;
  private sysmsg: HTMLElement;
  private scan: HTMLElement;
  private acc = 0;
  private camTimer = 0;
  private streetTimer = 0;
  private lastToastKey = '';
  private digits: HTMLElement[] = [];
  private leds: HTMLElement[] = [];
  private shiftBox: HTMLElement;
  private boostBox: HTMLElement;
  private boostFill: HTMLElement;
  private boostVal: HTMLElement;
  private gDot: SVGCircleElement;
  private gTrail: SVGPolylineElement;
  private gText: HTMLElement;
  private gLong = 0;
  private gLat = 0;
  private lastFwd = 0;
  private trail: [number, number][] = [];
  private redFrac = 0.9;
  private turbo = false;
  private maxBoostBar = 1.2;

  constructor(ui: HTMLElement) {
    this.root = el('div', 'hud hidden', `
      <div class="cluster" aria-hidden="true">
        <svg viewBox="0 0 230 230">
          <circle cx="115" cy="115" r="${ARC_R}" fill="rgba(8,10,14,0.55)" stroke="rgba(255,255,255,0.07)" stroke-width="14" stroke-dasharray="${ARC_LEN} 999" transform="rotate(135 115 115)"/>
          <circle data-r="red" cx="115" cy="115" r="${ARC_R}" fill="none" stroke="#ff3b30" stroke-width="3" opacity="0.8" transform="rotate(135 115 115)"/>
          <circle data-r="rpm" cx="115" cy="115" r="${ARC_R}" fill="none" stroke="url(#rpmGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="0 999" transform="rotate(135 115 115)"/>
          <defs><linearGradient id="rpmGrad" x1="0" x2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff4f7a"/></linearGradient></defs>
        </svg>
        <div class="shift" data-r="shift">${'<i></i>'.repeat(SHIFT_LEDS)}</div>
        <div class="gear" data-r="gear">N</div>
        <div class="speed roll" data-r="speed">${'<span class="dg"><b>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</b></span>'.repeat(3)}</div>
        <div class="unit" data-r="unit">MPH</div>
        <div class="boost hidden" data-r="boost"><span>BOOST</span><div class="bb"><i></i></div><em>0.0</em></div>
        <div class="tell"><span data-t="abs">ABS</span><span data-t="tcs">TCS</span><span data-t="esc">ESC</span><span data-t="lights" class="green">◉</span><span data-t="high" class="blue">HI</span><span data-t="pb">P</span></div>
      </div>
      <div class="gmeter" aria-hidden="true"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="40" class="r"/><circle cx="45" cy="45" r="20" class="r"/><path d="M5 45H85M45 5V85" class="r"/><polyline class="trail" points=""/><circle class="dot" cx="45" cy="45" r="5"/></svg><b data-r="g">0.00 g</b></div>
      <div class="minimap"><canvas width="380" height="380"></canvas></div>
      <div class="compass" data-r="compass">N</div>
      <div class="street fade"><div class="area" data-r="area"></div><div class="name" data-r="name"></div></div>
      <div class="camlabel" data-r="cam"></div>
      <div class="activity panel hidden" data-r="act"></div>
      <div class="prompt panel hidden" data-r="prompt"></div>
      <div class="toasts" data-r="toasts" aria-live="polite"></div>
      <div class="hint panel" data-r="hint">
        <b>W A S D</b> drive · <b>Space</b> handbrake · <b>C</b> camera · <b>R</b> reset<br/>
        <b>L</b> lights · <b>H</b> horn · <b>F</b> photo · <b>T</b> activity · <b>Esc</b> menu
      </div>
      <div class="sysmsg" data-r="sys" aria-hidden="true"></div>
      <div class="scan" aria-hidden="true"></div>
      <div class="debug hidden" data-r="debug"></div>`);
    ui.appendChild(this.root);
    this.lock = new TargetLock(this.root);
    this.root.insertBefore(this.lock.root, this.root.firstChild);
    this.sysmsg = qs(this.root, '[data-r=sys]');
    this.scan = qs(this.root, '.scan');
    this.speed = qs(this.root, '[data-r=speed]');
    this.unit = qs(this.root, '[data-r=unit]');
    this.gear = qs(this.root, '[data-r=gear]');
    this.rpmArc = qs<SVGCircleElement>(this.root, '[data-r=rpm]');
    this.redArc = qs<SVGCircleElement>(this.root, '[data-r=red]');
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((t) => (this.tells[t.dataset.t!] = t));
    this.streetBox = qs(this.root, '.street');
    this.streetName = qs(this.root, '[data-r=name]');
    this.streetArea = qs(this.root, '[data-r=area]');
    this.camLabel = qs(this.root, '[data-r=cam]');
    this.actBox = qs(this.root, '[data-r=act]');
    this.promptBox = qs(this.root, '[data-r=prompt]');
    this.toasts = qs(this.root, '[data-r=toasts]');
    this.debugBox = qs(this.root, '[data-r=debug]');
    this.hint = qs(this.root, '[data-r=hint]');
    this.compass = qs(this.root, '[data-r=compass]');
    this.minimap = new Minimap(qs<HTMLCanvasElement>(this.root, '.minimap canvas'));
    this.digits = [...this.speed.querySelectorAll<HTMLElement>('.dg')];
    this.shiftBox = qs(this.root, '[data-r=shift]');
    this.leds = [...this.shiftBox.querySelectorAll<HTMLElement>('i')];
    this.leds.forEach((l, i) => (l.className = i < 4 ? 'g' : i < 7 ? 'a' : 'r'));
    this.boostBox = qs(this.root, '[data-r=boost]');
    this.boostFill = qs(this.boostBox, '.bb i');
    this.boostVal = qs(this.boostBox, 'em');
    this.gDot = qs<SVGCircleElement>(this.root, '.gmeter .dot');
    this.gTrail = qs<SVGPolylineElement>(this.root, '.gmeter .trail');
    this.gText = qs(this.root, '[data-r=g]');
  }

  setVisible(on: boolean) {
    show(this.root, on);
  }

  /** Per-car cluster setup: turbo cars show the boost gauge. */
  configure(o: { turbo: boolean; maxBoostBar?: number }) {
    this.turbo = o.turbo;
    this.maxBoostBar = o.maxBoostBar ?? 1.2;
    show(this.boostBox, o.turbo);
  }

  setRedline(frac: number) {
    if (frac === this.redFrac) return;
    this.redFrac = frac;
    const start = ARC_LEN * frac;
    this.redArc.setAttribute('stroke-dasharray', `0 ${start} ${ARC_LEN - start} 999`);
  }

  update(dt: number, t: Telemetry, maxRpm: number, units: 'mph' | 'kmh', lights: { on: boolean; high: boolean; parking: boolean }, heading: number, boost = 0) {
    // accelerations every frame (smoothed); the DOM updates at 20 Hz below
    if (dt > 0) {
      const aLong = (t.forwardSpeed - this.lastFwd) / dt;
      const aLat = t.forwardSpeed * t.yawRate;
      const k = Math.min(1, dt * 8);
      if (Number.isFinite(aLong) && Math.abs(aLong) < 60) this.gLong += (aLong / G - this.gLong) * k;
      this.gLat += (aLat / G - this.gLat) * k;
    }
    this.lastFwd = t.forwardSpeed;
    this.acc += dt;
    this.booting -= dt;
    // control hints arrive once the boot log has cleared the corner, slide in, and fade out later
    const wasHint = this.hintAge >= 2.4;
    this.hintAge += dt;
    this.hint.classList.toggle('fade', this.hintAge < 2.4 || this.hintAge > 16);
    if (!wasHint && this.hintAge >= 2.4 && !reducedMotion()) tween(this.hint).prop('x', -18, 0, 0.5, 'back', 'out');
    this.camTimer -= dt;
    if (this.camTimer < 0) this.camLabel.style.opacity = '0';
    this.streetTimer -= dt;
    if (this.streetTimer < 0) this.streetBox.classList.add('fade');
    if (this.acc < 1 / 20) return;
    this.acc = 0;
    const v = units === 'mph' ? t.speed * 2.23694 : t.speed * 3.6;
    this.rollDigits(Math.min(999, Math.round(v)));
    this.speed.dataset.v = String(Math.round(v));
    this.unit.textContent = units === 'mph' ? 'MPH' : 'KM/H';
    this.gear.textContent = t.gear === -1 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    const f = Math.min(1, t.rpm / maxRpm);
    if (this.booting <= 0) this.rpmArc.setAttribute('stroke-dasharray', `${(ARC_LEN * f).toFixed(1)} 999`);
    // shift lights: sweep in over the last ~22% of the rev range before the redline, flash at the limiter
    const start = this.redFrac - 0.22;
    const lit = t.gear > 0 ? Math.max(0, Math.min(1, (f - start) / (this.redFrac - start))) : 0;
    const n = Math.round(lit * SHIFT_LEDS);
    const flash = t.limiter || f >= this.redFrac;
    if (this.booting <= 0) {
      this.shiftBox.classList.toggle('flash', flash);
      this.leds.forEach((l, i) => l.classList.toggle('on', i < n));
    }
    if (this.turbo) {
      const bar = boost * this.maxBoostBar;
      this.boostFill.style.transform = `scaleX(${Math.min(1, boost).toFixed(3)})`;
      this.boostVal.textContent = bar.toFixed(1);
    }
    this.drawG();
    if (this.booting <= 0) {
      this.tells.abs.classList.toggle('on', t.absActive);
      this.tells.tcs.classList.toggle('on', t.tcsActive);
      this.tells.esc.classList.toggle('on', t.escActive);
      this.tells.lights.classList.toggle('on', lights.on);
      this.tells.high.classList.toggle('on', lights.high);
      this.tells.pb.classList.toggle('on', lights.parking);
    }
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    this.compass.textContent = `${dirs[Math.round(deg / 45) % 8]} · ${Math.round(deg)}°`;
  }

  private rollDigits(v: number) {
    const str = String(v).padStart(3, ' ');
    for (let i = 0; i < 3; i++) {
      const ch = str[i];
      const d = this.digits[i];
      const blank = ch === ' ';
      d.classList.toggle('blank', blank);
      if (!blank) (d.firstElementChild as HTMLElement).style.transform = `translateY(${-Number(ch) * 10}%)`;
    }
  }

  private drawG() {
    const R = 40 / 1.5; // 1.5 g at the outer ring
    const x = Math.max(-1.5, Math.min(1.5, this.gLat)), y = Math.max(-1.5, Math.min(1.5, this.gLong));
    const cx = 45 + x * R, cy = 45 - y * R;
    this.gDot.setAttribute('cx', cx.toFixed(1));
    this.gDot.setAttribute('cy', cy.toFixed(1));
    this.trail.push([cx, cy]);
    if (this.trail.length > 14) this.trail.shift();
    this.gTrail.setAttribute('points', this.trail.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
    this.gText.textContent = `${Math.hypot(this.gLat, this.gLong).toFixed(2)} g`;
  }

  setMinimapVisible(on: boolean) {
    show(qs(this.root, '.minimap'), on);
    show(this.compass, on);
  }

  street(name: string, area: string) {
    if (this.streetName.textContent !== name) scrambleText(this.streetName, name, 0.45, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    else this.streetName.textContent = name;
    this.streetArea.textContent = area;
    this.streetBox.classList.remove('fade');
    this.streetTimer = 4.5;
  }

  camera(label: string) {
    this.camLabel.textContent = label;
    this.camLabel.style.opacity = '1';
    this.camTimer = 1.6;
  }

  toast(title: string, sub?: string, tone: 'good' | 'bad' | 'info' | 'discovery' = 'info') {
    const key = title + (sub ?? '');
    if (key === this.lastToastKey && this.toasts.childElementCount) return;
    this.lastToastKey = key;
    const t = el('div', `toast panel ${tone}`, `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild!.remove();
    dropIn(t);
    if (tone === 'discovery' || tone === 'good') scrambleText(t.querySelector('b')!, title, 0.5);
    setTimeout(() => popOut(t).then(() => { t.remove(); if (this.lastToastKey === key) this.lastToastKey = ''; }), 3200);
  }

  activity(a: HudActivity | null) {
    const was = !this.actBox.classList.contains('hidden');
    show(this.actBox, !!a);
    if (!a) return;
    if (!was) popIn(this.actBox, 0, -14);
    this.actBox.innerHTML = `<div class="t">${esc(a.title)}</div><div class="p">${esc(a.primary)}</div><div class="s">${esc(a.secondary)}</div><div class="prog"><i style="width:${Math.round(a.progress * 100)}%"></i></div>`;
  }

  prompt(text: string | null) {
    const was = !this.promptBox.classList.contains('hidden');
    show(this.promptBox, !!text);
    if (!text || text === this.promptText) { if (!text) this.promptText = null; return; }
    this.promptText = text;
    // "Press T to …" → the bound key (or pad button) as a Kenney glyph
    const m = /^Press (\S+) (.*)$/.exec(text);
    this.promptBox.innerHTML = m && this.keys ? `${actionGlyph('activity', this.keys, this.source)}<span>${esc(m[2])}</span>` : esc(text);
    if (!was) popIn(this.promptBox, 0, 12);
  }

  /** Control hints with Kenney input glyphs; re-rendered when the bindings or the last-used device change. */
  setInputHints(keys: KeyBindings, source: InputSource) {
    const key = source + JSON.stringify(keys);
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.keys = keys;
    this.source = source;
    const g = (acts: Action[], label: string) => `<span class="grp">${actionGlyphs(acts, keys, source)}<span>${label}</span></span>`;
    this.hint.innerHTML = source === 'gamepad'
      ? `${g(['throttle', 'brake'], 'drive')}${g(['steerLeft'], 'steer')}${g(['handbrake'], 'handbrake')}${g(['camera'], 'camera')}<br/>${g(['reset'], 'reset')}${g(['headlights'], 'lights')}${g(['photo'], 'photo')}${g(['activity'], 'activity')}${g(['pause'], 'menu')}`
      : `${g(['throttle', 'steerLeft', 'brake', 'steerRight'], 'drive')}${g(['handbrake'], 'handbrake')}${g(['camera'], 'camera')}${g(['reset'], 'reset')}<br/>${g(['headlights'], 'lights')}${g(['horn'], 'horn')}${g(['photo'], 'photo')}${g(['activity'], 'activity')}${g(['pause'], 'menu')}`;
    const p = this.promptText;
    this.promptText = null;
    if (p) this.prompt(p);
  }

  /**
   * Cinematic HUD boot: scan line, system log, radar iris, gauge needle sweep and a bulb check
   * (every tell-tale lit, the shift LEDs chase up and down), like a car's instrument self-test.
   */
  boot(carName: string, place: string) {
    this.hintAge = reducedMotion() ? 2.4 : 0;
    if (reducedMotion()) return;
    this.booting = 1.9;
    const cluster = qs(this.root, '.cluster'), mini = qs(this.root, '.minimap'), gm = qs(this.root, '.gmeter');
    tween(this.scan).parallel().method((v) => (this.scan.style.top = `${v}%`), 0, 100, 0.9, 'cubic', 'in_out').prop('opacity', 0, 1, 0.1).prop('opacity', 1, 0, 0.2, 'linear', 'in', 0.75);
    popIn(cluster, 0.1, 30);
    tween(gm).parallel().prop('opacity', 0, 1, 0.3, 'sine', 'out', 0.35).prop('scale', 0.6, 1, 0.5, 'back', 'out', 0.35);
    irisIn(mini, 0.2);
    // needle sweep 0 → full → 0 with inertia
    tween(this.rpmArc).method((v) => this.rpmArc.setAttribute('stroke-dasharray', `${(ARC_LEN * v).toFixed(1)} 999`), 0, 1, 0.6, 'cubic', 'out', 0.25)
      .method((v) => this.rpmArc.setAttribute('stroke-dasharray', `${(ARC_LEN * v).toFixed(1)} 999`), 1, 0, 0.7, 'back', 'in_out');
    const tells = Object.values(this.tells);
    tells.forEach((t) => t.classList.add('on'));
    this.leds.forEach((l, i) => setTimeout(() => l.classList.add('on'), 300 + i * 45));
    this.leds.forEach((l, i) => setTimeout(() => l.classList.remove('on'), 950 + (SHIFT_LEDS - i) * 45));
    setTimeout(() => tells.forEach((t) => t.classList.remove('on')), 1400);
    const lines = ['SYS.BOOT  CALIFORNIA DRIVE', `VEH  ${carName.toUpperCase()}`, `LOC  ${place.toUpperCase()}`, 'NAV  ONLINE  ·  RADAR SWEEP OK'];
    this.sysmsg.textContent = '';
    tween(this.sysmsg).prop('opacity', 0, 1, 0.15).interval(2.1).prop('opacity', 1, 0, 0.4, 'sine', 'in');
    lines.forEach((ln, i) => setTimeout(() => { this.sysmsg.textContent += (i ? '\n' : '') + ln; }, 120 + i * 220));
    this.minimap.boot();
  }

  debug(text: string | null) {
    show(this.debugBox, !!text);
    if (text !== null) this.debugBox.textContent = text;
  }
}

/** Heading-up minimap rendered from a pre-baked district canvas. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private ppm = 0.5;
  private x0 = 0;
  private z0 = 0;
  private range = 220;
  private sweep = 0;
  private sweepBoost = 0;
  private lastTime = 0;
  enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  bake(d: DistrictData) {
    const g = d.elevation;
    const w = (g.cols - 1) * g.cell, h = (g.rows - 1) * g.cell;
    this.ppm = Math.min(0.75, 2600 / Math.max(w, h));
    this.x0 = g.x0;
    this.z0 = g.z0;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * this.ppm);
    c.height = Math.ceil(h * this.ppm);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1b2027';
    ctx.fillRect(0, 0, c.width, c.height);
    const hf = Heightfield.fromGrid(g);
    if (d.waterY !== null) {
      ctx.fillStyle = '#10283a';
      const step = Math.max(1, Math.round(g.cell * this.ppm));
      for (let r = 0; r < g.rows; r++) for (let col = 0; col < g.cols; col++) {
        if (hf.at(col, r) < d.waterY - 0.3) ctx.fillRect(col * g.cell * this.ppm, r * g.cell * this.ppm, step + 1, step + 1);
      }
    }
    const poly = (p: number[], fill: string) => {
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = (p[i] - this.x0) * this.ppm, y = (p[i + 1] - this.z0) * this.ppm;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    for (const p of d.parks) poly(p, '#1f3324');
    for (const p of d.piers) poly(p, '#2a2f36');
    for (const b of d.buildings) poly(b.p, '#262c35');
    const order = ['service', 'residential', 'tertiary', 'link', 'secondary', 'primary', 'trunk', 'motorway'];
    const color: Record<string, string> = { motorway: '#ff9a52', trunk: '#ffb347', primary: '#e8d9a8', secondary: '#c9ced6', tertiary: '#a9b2bd', residential: '#7d8794', link: '#ffb347', service: '#4e5763' };
    for (const cls of order) {
      ctx.strokeStyle = color[cls];
      for (const e of d.edges) {
        if (e.cls !== cls) continue;
        ctx.lineWidth = Math.max(1.2, e.w * this.ppm * 0.9);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < e.p.length; i += 2) {
          const x = (e.p[i] - this.x0) * this.ppm, y = (e.p[i + 1] - this.z0) * this.ppm;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    this.base = c;
  }

  clear() {
    this.base = null;
  }

  /** Fast sweep for a moment (HUD boot). */
  boot() {
    this.sweepBoost = 1;
  }

  draw(px: number, pz: number, heading: number, speed: number, markers: Marker[], route: number[], checkpoint: { x: number; z: number } | null, traffic: { x: number; z: number; emergency?: string }[], time: number) {
    if (!this.base || !this.enabled) return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const dt = this.lastTime ? Math.min(0.1, Math.max(0, time - this.lastTime)) : 0;
    this.lastTime = time;
    this.range += (Math.min(420, 180 + speed * 4) - this.range) * 0.03;
    const s = (W / 2) / this.range; // px per meter on the minimap
    // radar sweep (screen space, clockwise); a boot burst spins it up, then it settles
    this.sweepBoost = Math.max(0, this.sweepBoost - dt * 0.6);
    this.sweep = (this.sweep + dt * (2.1 + this.sweepBoost * 9)) % (Math.PI * 2);
    ctx.save();
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-heading);
    const k = s / this.ppm;
    ctx.drawImage(this.base, -(px - this.x0) * s, -(pz - this.z0) * s, this.base.width * k, this.base.height * k);
    const toM = (x: number, z: number): [number, number] => [(x - px) * s, (z - pz) * s];
    if (route.length > 3) {
      ctx.strokeStyle = 'rgba(255,179,71,0.9)';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < route.length; i += 3) {
        const [x, y] = toM(route[i], route[i + 2]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    // range rings every 100 m + sweep wedge, in screen space
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.strokeStyle = 'rgba(120,255,190,0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    for (let r = 100; r * s < W / 2; r += 100) { ctx.beginPath(); ctx.arc(0, 0, r * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    if (typeof ctx.createConicGradient === 'function') {
      const g = ctx.createConicGradient(this.sweep - Math.PI, 0, 0);
      g.addColorStop(0, 'rgba(120,255,190,0)');
      g.addColorStop(0.42, 'rgba(120,255,190,0)');
      g.addColorStop(0.5, 'rgba(120,255,190,0.16)');
      g.addColorStop(0.5001, 'rgba(120,255,190,0)');
      g.addColorStop(1, 'rgba(120,255,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, W / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    const a = this.sweep;
    ctx.strokeStyle = 'rgba(150,255,205,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * W / 2, Math.sin(a) * H / 2);
    ctx.stroke();
    // traffic blips: brightest just after the sweep passes (phosphor persistence)
    const ch = Math.cos(-heading), sh = Math.sin(-heading);
    const scr = (x: number, z: number): [number, number] => {
      const [mx, my] = toM(x, z);
      return [mx * ch - my * sh, mx * sh + my * ch];
    };
    for (const t of traffic) {
      const [x, y] = scr(t.x, t.z);
      if (x * x + y * y > (W / 2) * (W / 2)) continue;
      if (t.emergency) {
        const red = Math.floor(time * 4) % 2 === 0;
        ctx.fillStyle = red ? '#ff3b30' : '#2f7bff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 12;
        ctx.fillRect(x - 4.5, y - 4.5, 9, 9);
        ctx.shadowBlur = 0;
        continue;
      }
      let since = (a - Math.atan2(y, x)) % (Math.PI * 2);
      if (since < 0) since += Math.PI * 2;
      const glow = 0.25 + 0.75 * Math.pow(1 - since / (Math.PI * 2), 3);
      ctx.fillStyle = `rgba(170,255,210,${glow.toFixed(3)})`;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    const colors: Record<string, string> = { timeTrial: '#ff5a36', scenic: '#4fd1ff', drift: '#ff3fa4', speedTrap: '#ffd23d', parking: '#58f29a', slalom: '#ff9f1c', photo: '#c58cff' };
    for (const m of markers) {
      let [x, y] = scr(m.x, m.z);
      const d = Math.hypot(x, y), R = W / 2 - 10;
      if (d > R) { x *= R / d; y *= R / d; }
      ctx.fillStyle = colors[m.kind];
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (checkpoint) {
      let [x, y] = scr(checkpoint.x, checkpoint.z);
      const d = Math.hypot(x, y), R = W / 2 - 12;
      if (d > R) { x *= R / d; y *= R / d; }
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 9 + Math.sin(time * 6) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // north marker on the rim
    ctx.rotate(-heading);
    ctx.fillStyle = '#ff7a3d';
    ctx.font = '26px "Share Tech Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -H / 2 + 22);
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
