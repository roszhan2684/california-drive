import { CITIES, type CityDef, type TimePreset, type WeatherKind } from '../world/cities.ts';
import { arrowNav, el, esc, focusFirst, qs, show } from './dom.ts';
import { mapFrame, outlinePath, project } from './caMap.ts';

/** Public builds (GitHub Pages) ship without the branded M3; see PUBLIC_BUILD in vehicles.ts. */
const PUBLIC = import.meta.env?.VITE_PUBLIC_BUILD === '1';

export class TitleScreen {
  readonly root: HTMLElement;
  constructor(ui: HTMLElement, h: { drive(): void; select(): void; garage(): void; controls(): void; graphics(): void; about(): void }, lastCity: string) {
    this.root = el('section', 'screen title hidden', `
      <div class="vignette"></div>
      <h1 class="logo">California<span>Drive</span></h1>
      <p class="tagline">Pick a California city, drop into ${PUBLIC ? 'the driver\u2019s seat' : 'an M3 Competition'} and just drive. Streets, hills and skylines are built from open map data. No account, no saves, nothing leaves your browser.</p>
      <div class="menu" role="menu" aria-label="Main menu">
        <button class="primary" data-a="drive" role="menuitem">Drive <span>${esc(CITIES.find((c) => c.id === lastCity)?.name ?? 'San Francisco')} →</span></button>
        <button data-a="select" role="menuitem">City Select <kbd>Map</kbd></button>
        <button data-a="garage" role="menuitem">Garage <kbd>Paint · Specs</kbd></button>
        <button data-a="controls" role="menuitem">Controls</button>
        <button data-a="graphics" role="menuitem">Graphics &amp; Audio</button>
        <button data-a="about" role="menuitem">About &amp; Licenses</button>
      </div>
      <div class="title-foot">Map data © OpenStreetMap contributors (ODbL) · Elevation: AWS Terrain Tiles (USGS 3DEP)<br/>Traffic, debris &amp; glyphs: Kenney (CC0) · Textures &amp; sky: Poly Haven (CC0) · Fonts: OFL · Audio synthesized in code.${PUBLIC ? '' : ' BMW and M3 are trademarks of BMW AG; fan-made, not affiliated.'}</div>
    `);
    ui.appendChild(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('.menu button').forEach((b) => b.addEventListener('click', () => (h as any)[b.dataset.a!]()));
    arrowNav(qs(this.root, '.menu'));
  }
  show(on: boolean) {
    show(this.root, on);
    if (on) focusFirst(this.root);
  }
}

const TIME_LABELS: [TimePreset, string][] = [['dawn', 'Dawn'], ['day', 'Day'], ['golden', 'Golden hour'], ['dusk', 'Dusk'], ['night', 'Night']];
const WEATHER_LABELS: [WeatherKind, string][] = [['clear', 'Clear'], ['overcast', 'Overcast'], ['fog', 'Fog'], ['rain', 'Rain'], ['snow', 'Snow']];

export class CitySelect {
  readonly root: HTMLElement;
  private sel: CityDef;
  private time: TimePreset;
  private weather: WeatherKind;
  private available: Set<string>;
  private card: HTMLElement;
  private h: { drive(city: string, time: TimePreset, weather: WeatherKind): void; proving(): void; back(): void; focus?(c: CityDef): void };
  private pinEls = new Map<string, HTMLButtonElement>();

  constructor(ui: HTMLElement, available: Set<string>, initial: string, h: CitySelect['h']) {
    this.available = available;
    this.h = h;
    this.sel = CITIES.find((c) => c.id === initial) ?? CITIES[0];
    this.time = this.sel.defaultTime;
    this.weather = this.sel.defaultWeather;
    this.root = el('section', 'screen select hidden');
    const W = 600, H = 700;
    const f = mapFrame(W, H, 36);
    const nodes = CITIES.map((c) => {
      const [x, y] = project(f, c.mapAt.lat, c.mapAt.lon);
      const left = c.mapAt.lon > -120.5 || c.id === 'sj' || c.id === 'oak' || c.id === 'sac';
      const dis = !available.has(c.id);
      return `<g class="node${dis ? ' disabled' : ''}" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)}${dis ? ' (not available)' : ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle class="halo" r="9"></circle><circle class="dot" r="5"></circle>
        <text x="${left ? 12 : -12}" y="4" text-anchor="${left ? 'start' : 'end'}">${esc(c.name)}</text></g>`;
    }).join('');
    let grid = '';
    for (let lat = 33; lat <= 42; lat++) { const [, y] = project(f, lat, -120); grid += `<line class="ca-grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }
    for (let lon = -124; lon <= -114; lon++) { const [x] = project(f, 37, lon); grid += `<line class="ca-grid" y1="0" y2="${H}" x1="${x}" x2="${x}"/>`; }
    this.root.innerHTML = `
      <div class="mapwrap">
        <button class="btn back" data-a="back">← Back</button>
        <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="California map">
          <defs><linearGradient id="caFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2420"/><stop offset="1" stop-color="#1a1d22"/></linearGradient></defs>
          ${grid}
          <path class="ca-shape" d="${outlinePath(f)}"/>
          ${nodes}
        </svg>
      </div>
      <div class="pins" aria-label="Cities">${CITIES.map((c) => `<button class="pin${available.has(c.id) ? '' : ' disabled'}" data-id="${c.id}" aria-label="${esc(c.name)}"><i></i><span>${esc(c.name)}</span></button>`).join('')}</div>
      <aside class="card panel"></aside>`;
    ui.appendChild(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('.pin').forEach((b) => {
      this.pinEls.set(b.dataset.id!, b);
      b.addEventListener('click', () => this.pick(CITIES.find((x) => x.id === b.dataset.id)!));
      b.addEventListener('dblclick', () => this.go());
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (this.sel.id === b.dataset.id) this.go(); else b.click(); } });
    });
    this.card = qs(this.root, '.card');
    this.root.querySelectorAll<SVGGElement>('.node').forEach((n) => {
      const pick = () => { const c = CITIES.find((x) => x.id === n.dataset.id)!; this.pick(c); };
      n.addEventListener('click', pick);
      n.addEventListener('focus', pick);
      n.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') this.go(); });
    });
    qs(this.root, '[data-a=back]').addEventListener('click', () => h.back());
    this.renderCard();
  }

  /** Switch between the flat SVG map and HTML pins over the 3D relief (rendered by the game). */
  use3d(on: boolean) {
    this.root.classList.toggle('relief', on);
  }

  get selected(): CityDef {
    return this.sel;
  }

  /** Position the HTML pin labels from projected 3D pin heads. */
  placePins(at: (id: string) => [number, number, boolean] | null) {
    for (const [id, b] of this.pinEls) {
      const p = at(id);
      if (!p || !p[2]) { b.style.visibility = 'hidden'; continue; }
      b.style.visibility = 'visible';
      b.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
      b.classList.toggle('active', id === this.sel.id);
    }
  }

  private pick(c: CityDef) {
    this.h.focus?.(c);
    if (this.sel.id !== c.id) {
      this.sel = c;
      this.time = c.defaultTime;
      this.weather = c.defaultWeather;
    }
    this.renderCard();
  }

  private go() {
    if (!this.available.has(this.sel.id)) return;
    this.h.drive(this.sel.id, this.time, this.weather);
  }

  private renderCard() {
    const c = this.sel;
    this.root.querySelectorAll('.node').forEach((n) => n.classList.toggle('active', (n as HTMLElement).dataset.id === c.id));
    const [s, w, n, e] = c.bbox;
    const km2 = ((n - s) * 111.32) * ((e - w) * 111.32 * Math.cos(((s + n) / 2) * Math.PI / 180));
    const routes = [c.activities.scenicRoute?.name, c.activities.timeTrial?.name, c.activities.driftZone?.name, c.activities.speedTrap?.name, c.activities.parking?.name].filter(Boolean) as string[];
    const avail = this.available.has(c.id);
    this.card.innerHTML = `
      <div class="preview" style="background-image:url('${import.meta.env.BASE_URL}previews/${c.id}.jpg')"></div>
      <div class="eyebrow">${c.biome === 'alpine' ? 'Driving zone' : 'City district'} · ${esc(c.tagline)}</div>
      <h2>${esc(c.name)}</h2>
      <div class="district">${esc(c.district)}</div>
      <p class="mood">${esc(c.mood)}</p>
      <div class="stats">
        <div class="stat"><b>${km2.toFixed(1)}</b><span>km² district</span></div>
        <div class="stat"><b>${c.landmarks.length}</b><span>landmarks</span></div>
        <div class="stat"><b>${routes.length}</b><span>activities</span></div>
      </div>
      <div><div class="eyebrow" style="margin-bottom:8px">Time of day</div><div class="seg" data-g="time">${TIME_LABELS.map(([k, l]) => `<button aria-pressed="${k === this.time}" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Weather</div><div class="seg" data-g="weather">${WEATHER_LABELS.filter(([k]) => k !== 'snow' || c.biome === 'alpine').map(([k, l]) => `<button aria-pressed="${k === this.weather}" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Recommended</div><ul class="routes">${routes.map((r) => `<li>${esc(r)}</li>`).join('') || '<li>Free roam</li>'}</ul></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Jump to</div><div class="jump">${CITIES.map((x) => `<button data-j="${x.id}" aria-pressed="${x.id === c.id}"${this.available.has(x.id) ? '' : ' disabled'}>${esc(x.name)}</button>`).join('')}</div></div>
      <div class="menu" style="width:100%">
        <button class="primary" data-a="drive" ${avail ? '' : 'disabled'}>${avail ? `Drive ${esc(c.name)} →` : 'District data not imported'}</button>
        <button data-a="proving">Proving Ground <span>test track</span></button>
      </div>`;
    this.card.querySelectorAll<HTMLElement>('.seg').forEach((g) => g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      if (g.dataset.g === 'time') this.time = b.dataset.v as TimePreset;
      else this.weather = b.dataset.v as WeatherKind;
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    })));
    this.card.querySelectorAll<HTMLButtonElement>('[data-j]').forEach((b) => b.addEventListener('click', () => this.pick(CITIES.find((x) => x.id === b.dataset.j)!)));
    qs(this.card, '[data-a=drive]').addEventListener('click', () => this.go());
    qs(this.card, '[data-a=proving]').addEventListener('click', () => this.h.proving());
  }

  show(on: boolean) {
    show(this.root, on);
    if (on) (this.root.querySelector<SVGGElement>(`.node[data-id="${this.sel.id}"]`) as unknown as HTMLElement | null)?.focus?.();
  }
}

export class LoadingScreen {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private sub: HTMLElement;
  private title: HTMLElement;
  private tip: HTMLElement;
  private static TIPS = [
    'Hold Space to pull the handbrake and kick the rear out. Assists can be switched off in the pause menu.',
    'Press C to cycle cameras: chase, close, hood, cockpit, dashboard, bumper, wheel and side tracking.',
    'Karl the Fog rolls in off the Pacific in San Francisco. Climb Russian Hill to drive above it.',
    'Photo mode (F) exports a vintage California postcard. It downloads to your device and is never uploaded.',
    'Time-trial ghosts live only in this tab. Close it and they are gone for good.',
    'Hold S/↓ at a standstill to engage reverse with the automatic gearbox.',
    'Everything you hear is synthesized live: the flat-six, the tyres, the rain and the radio.',
  ];
  constructor(ui: HTMLElement) {
    this.root = el('section', 'screen loading hidden', `
      <div class="bgimg" data-r="bg"></div>
      <div class="sub" data-r="eyebrow">Loading district</div>
      <h2 data-r="title">San Francisco</h2>
      <svg class="road" viewBox="0 0 460 70" aria-hidden="true"><path class="asphalt" d="M200 0H260L460 70H0Z"/><path class="edge" d="M200 0L0 70M260 0L460 70"/><path class="dash" d="M230 0V70"/></svg>
      <div class="pct" data-r="pct">0%</div>
      <div class="bar"><i></i></div>
      <div class="sub" data-r="step">Downloading open map data…</div>
      <p class="tip" data-r="tip"></p>
      <div class="attr">Map data © OpenStreetMap contributors, ODbL · Elevation © AWS Terrain Tiles / USGS 3DEP</div>`);
    ui.appendChild(this.root);
    this.bar = qs(this.root, '.bar > i');
    this.sub = qs(this.root, '[data-r=step]');
    this.title = qs(this.root, '[data-r=title]');
    this.tip = qs(this.root, '[data-r=tip]');
    this.pct = qs(this.root, '[data-r=pct]');
    this.bg = qs(this.root, '[data-r=bg]');
  }
  private pct: HTMLElement;
  private bg: HTMLElement;
  start(name: string, id?: string) {
    this.title.textContent = name;
    this.bg.style.backgroundImage = id ? `url('${import.meta.env.BASE_URL}previews/${id}.jpg')` : '';
    this.tip.textContent = LoadingScreen.TIPS[Math.floor(Math.random() * LoadingScreen.TIPS.length)];
    this.sub.classList.remove('error');
    this.set(0, 'Downloading open map data…');
    show(this.root, true);
  }
  set(f: number, step?: string) {
    const pc = Math.round(Math.max(0, Math.min(1, f)) * 100);
    this.bar.style.width = `${pc}%`;
    this.pct.textContent = `${pc}%`;
    if (step) this.sub.textContent = step;
  }
  error(msg: string) {
    this.sub.textContent = msg;
    this.sub.classList.add('error');
  }
  hide() {
    show(this.root, false);
  }
}

export class RevealOverlay {
  readonly root: HTMLElement;
  constructor(ui: HTMLElement) {
    this.root = el('div', 'hud hidden', `
      <div class="reveal-title"><div class="eyebrow" data-r="e"></div><h1 data-r="h"></h1><p data-r="p"></p></div>
      <div class="skip">Press any key to skip</div>`);
    ui.appendChild(this.root);
  }
  show(city: string, district: string, car: string) {
    qs(this.root, '[data-r=e]').textContent = district;
    qs(this.root, '[data-r=h]').textContent = city;
    qs(this.root, '[data-r=p]').textContent = car;
    show(this.root, true);
  }
  hide() {
    show(this.root, false);
  }
}
