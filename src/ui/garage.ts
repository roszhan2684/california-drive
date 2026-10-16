import { AVAILABLE_VEHICLES, type VehicleDef, type VehicleId, type VehicleSpecs } from '../vehicle/vehicles.ts';
import type { Paint } from '../vehicle/carModel.ts';
import { el, esc, focusFirst, qs, show } from './dom.ts';
import { tween } from './motion.ts';

/** Radar axes, each normalised to 0..1 against a broad sports-car range. */
const AXES: { label: string; v: (s: VehicleSpecs) => number; fmt: (s: VehicleSpecs) => string }[] = [
  { label: 'Power', v: (s) => s.hp / 650, fmt: (s) => `${s.hp} hp` },
  { label: 'Torque', v: (s) => s.nm / 800, fmt: (s) => `${s.nm} N·m` },
  { label: 'Launch', v: (s) => (8 - s.zeroTo100) / 5.5, fmt: (s) => `${s.zeroTo100.toFixed(1)} s` },
  { label: 'Top speed', v: (s) => (s.topKmh - 180) / 150, fmt: (s) => `${s.topKmh} km/h` },
  { label: 'Braking', v: (s) => (48 - s.brake100) / 18, fmt: (s) => `${s.brake100.toFixed(1)} m` },
  { label: 'Lightness', v: (s) => (2100 - s.kg) / 900, fmt: (s) => `${s.kg} kg` },
];

export function radarPoints(s: VehicleSpecs, r: number, cx: number, cy: number): [number, number][] {
  return AXES.map((a, i) => {
    const t = Math.max(0.06, Math.min(1, a.v(s)));
    const ang = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
    return [cx + Math.cos(ang) * r * t, cy + Math.sin(ang) * r * t];
  });
}

function radar(s: VehicleSpecs, ghost: VehicleSpecs | null): string {
  const R = 92, C = 120;
  const ring = (k: number) => AXES.map((_, i) => { const a = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2; return `${(C + Math.cos(a) * R * k).toFixed(1)},${(C + Math.sin(a) * R * k).toFixed(1)}`; }).join(' ');
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const labels = AXES.map((a, i) => {
    const ang = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2;
    const x = C + Math.cos(ang) * (R + 18), y = C + Math.sin(ang) * (R + 14);
    const anchor = Math.abs(Math.cos(ang)) < 0.2 ? 'middle' : Math.cos(ang) > 0 ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"><tspan class="k">${esc(a.label)}</tspan><tspan x="${x.toFixed(1)}" dy="13" class="v">${esc(a.fmt(s))}</tspan></text>`;
  }).join('');
  return `<svg class="radar" viewBox="-30 -10 300 262" role="img" aria-label="Performance radar">
    ${[0.25, 0.5, 0.75, 1].map((k) => `<polygon class="ring" points="${ring(k)}"/>`).join('')}
    ${AXES.map((_, i) => { const a = -Math.PI / 2 + (i / AXES.length) * Math.PI * 2; return `<line class="ring" x1="${C}" y1="${C}" x2="${(C + Math.cos(a) * R).toFixed(1)}" y2="${(C + Math.sin(a) * R).toFixed(1)}"/>`; }).join('')}
    ${ghost ? `<polygon class="ghost" points="${pts(radarPoints(ghost, R, C, C))}"/>` : ''}
    <polygon class="shape" points="${pts(radarPoints(s, R, C, C))}"/>
    ${labels}
  </svg>`;
}

export interface GarageHandlers {
  back(): void;
  drive(): void;
  vehicle(id: VehicleId): void;
  paint(p: Paint): void;
  current(): { def: VehicleDef; paint: Paint };
}

/** Showroom: turntable car (rendered by the title scene), vehicle + paint picker and a spec radar. */
export class GarageScreen {
  readonly root: HTMLElement;
  private h: GarageHandlers;
  private panel: HTMLElement;

  constructor(ui: HTMLElement, h: GarageHandlers) {
    this.h = h;
    this.root = el('section', 'screen garage hidden', `
      <button class="btn back" data-a="back">← Back</button>
      <div class="drag-hint">Drag to turn · scroll to zoom</div>
      <aside class="gpanel panel"></aside>`);
    ui.appendChild(this.root);
    this.panel = qs(this.root, '.gpanel');
    qs(this.root, '[data-a=back]').addEventListener('click', () => h.back());
  }

  show(on: boolean) {
    const was = !this.root.classList.contains('hidden');
    show(this.root, on);
    if (on && !was) tween(this.panel).parallel().prop('opacity', 0, 1, 0.25, 'sine', 'out').prop('x', 40, 0, 0.6, 'back', 'out');
    if (on) { this.render(); focusFirst(this.panel); }
  }

  render() {
    const { def, paint } = this.h.current();
    const other = AVAILABLE_VEHICLES.find((v) => v.id !== def.id) ?? null;
    const s = def.specs;
    this.panel.innerHTML = `
      <div class="seg" role="tablist" aria-label="Vehicle">${AVAILABLE_VEHICLES.map((v) => `<button role="tab" aria-pressed="${v.id === def.id}" data-v="${v.id}">${esc(v.name.replace('BMW ', ''))}</button>`).join('')}</div>
      <div class="eyebrow">${def.branded ? 'Fan-made tribute · not affiliated' : 'Original design'}</div>
      <h2>${esc(def.name)}</h2>
      <p class="tag">${esc(def.tagline)}</p>
      ${radar(s, other?.specs ?? null)}
      <div class="legend"><span class="me">${esc(def.name.replace('BMW ', ''))}</span>${other ? `<span class="gh">${esc(other.name.replace('BMW ', ''))}</span>` : ''}</div>
      <div class="specs">
        <div><b>${s.hp}</b><span>hp</span></div>
        <div><b>${s.nm}</b><span>N·m</span></div>
        <div><b>${s.zeroTo100.toFixed(1)}</b><span>0–100 s</span></div>
        <div><b>${s.topKmh}</b><span>km/h</span></div>
      </div>
      <p class="layout">${esc(s.layout)} · ${s.kg} kg</p>
      <div class="eyebrow">Paint · ${esc(paint.name)}</div>
      <div class="paints">${def.paints.map((p, i) => `<button class="pswatch${p.color === paint.color && !!p.matte === !!paint.matte ? ' on' : ''}" data-p="${i}" title="${esc(p.name)}" aria-label="${esc(p.name)}" style="--c:${p.color}"></button>`).join('')}</div>
      <button class="btn primary drive" data-a="drive">Drive this car →</button>`;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => { this.h.vehicle(b.dataset.v as VehicleId); this.render(); }));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => { this.h.paint(def.paints[Number(b.dataset.p)]); this.render(); }));
    qs(this.panel, '[data-a=drive]').addEventListener('click', () => this.h.drive());
  }
}
