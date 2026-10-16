import type { Settings } from '../core/settings.ts';
import type { QualityPreset } from '../core/quality.ts';
import { ACTION_LABELS, keyLabel, type Action } from '../input/bindings.ts';
import { CAMERA_CYCLE, CAMERA_LABELS, type CameraMode } from '../camera/cameraRig.ts';
import type { Paint } from '../vehicle/carModel.ts';
import type { WeatherKind } from '../world/cities.ts';
import { el, esc, focusFirst, qs, show } from './dom.ts';
import { popIn } from './motion.ts';
import { LICENSE_TEXT } from './licenses.ts';

export interface PauseHost {
  settings: Settings;
  inGame(): boolean;
  cityName(): string;
  resume(): void;
  applySettings(): void;
  setCamera(m: CameraMode): void;
  camera(): CameraMode;
  hour(): number;
  setHour(h: number): void;
  weather(): WeatherKind;
  setWeather(w: WeatherKind): void;
  allowSnow(): boolean;
  marine(): boolean | null;
  setMarine(on: boolean): void;
  districts(): { name: string; go(): void }[];
  activities(): { name: string; best: string; go(): void }[];
  restartCar(): void;
  setPaint(p: Paint): void;
  paint(): string;
  paints(): Paint[];
  vehicles(): { id: string; name: string; tagline: string }[];
  vehicle(): string;
  branded(): boolean;
  setVehicle(id: string): void;
  captureKey(): Promise<string>;
  resetSession(): void;
  citySelect(): void;
  quitToTitle(): void;
}

type Tab = 'resume' | 'camera' | 'world' | 'teleport' | 'activities' | 'car' | 'controls' | 'graphics' | 'audio' | 'session' | 'credits';

export class PauseMenu {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private nav: HTMLElement;
  private h: PauseHost;
  private tab: Tab = 'resume';
  private onClose: (() => void) | null = null;

  constructor(ui: HTMLElement, host: PauseHost) {
    this.h = host;
    this.root = el('section', 'screen modal hidden', `<div class="panel sheet" role="dialog" aria-modal="true" aria-label="Menu"><nav></nav><div class="body"></div></div>`);
    ui.appendChild(this.root);
    this.nav = qs(this.root, 'nav');
    this.body = qs(this.root, '.body');
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
  }

  get open() {
    return !this.root.classList.contains('hidden');
  }

  openAt(tab: Tab, onClose?: () => void) {
    this.onClose = onClose ?? null;
    this.tab = tab;
    this.renderNav();
    this.render();
    show(this.root, true);
    popIn(qs(this.root, '.sheet'), 0, 22);
    focusFirst(this.nav);
    (this.nav.querySelector(`[data-t="${tab}"]`) as HTMLElement | null)?.focus();
  }

  close() {
    show(this.root, false);
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private tabs(): [Tab, string][] {
    const g = this.h.inGame();
    const all: [Tab, string][] = [
      ['resume', g ? 'Resume' : 'Back'], ['camera', 'Camera'], ['world', 'Time & Weather'], ['teleport', 'Teleport'], ['activities', 'Activities'],
      ['car', 'Car & Assists'], ['controls', 'Controls'], ['graphics', 'Graphics'], ['audio', 'Audio'], ['session', 'Session & Privacy'], ['credits', 'Credits & Licenses'],
    ];
    return g ? all : all.filter(([t]) => ['resume', 'controls', 'graphics', 'audio', 'session', 'credits', 'car'].includes(t));
  }

  private renderNav() {
    const g = this.h.inGame();
    this.nav.innerHTML = `<h2>${g ? esc(this.h.cityName()) : 'California Drive'}</h2>` +
      this.tabs().map(([t, l]) => `<button data-t="${t}" aria-selected="${t === this.tab}">${l}</button>`).join('') +
      (g ? `<button data-x="select">City Select</button><button data-x="title">Quit to Title</button>` : '');
    this.nav.querySelectorAll<HTMLButtonElement>('button[data-t]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.t as Tab;
      if (t === 'resume') { this.close(); if (g) this.h.resume(); return; }
      this.tab = t;
      this.nav.querySelectorAll('button[data-t]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      this.render();
    }));
    this.nav.querySelector('[data-x=select]')?.addEventListener('click', () => { show(this.root, false); this.h.citySelect(); });
    this.nav.querySelector('[data-x=title]')?.addEventListener('click', () => { show(this.root, false); this.h.quitToTitle(); });
    this.nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...this.nav.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    });
  }

  private row(label: string, control: string, help = '') {
    return `<div class="row"><label>${label}${help ? `<small>${help}</small>` : ''}</label>${control}</div>`;
  }

  private seg<T extends string>(name: string, opts: [T, string][], cur: T) {
    return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
  }

  private sw(name: string, on: boolean) {
    return `<input type="checkbox" class="switch" data-sw="${name}" ${on ? 'checked' : ''} aria-label="${name}"/>`;
  }

  private range(name: string, v: number, min: number, max: number, step: number) {
    return `<input type="range" data-rg="${name}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${name}"/>`;
  }

  render() {
    const s = this.h.settings;
    const H = this.h;
    let html = '';
    switch (this.tab) {
      case 'camera':
        html = `<h3>Camera</h3>` +
          this.row('View', this.seg('cam', CAMERA_CYCLE.map((c) => [c, CAMERA_LABELS[c]] as [CameraMode, string]), H.camera())) +
          this.row('Field of view', this.range('fov', s.fov, 50, 85, 1)) +
          this.row('Reduced motion', this.sw('reducedMotion', s.reducedMotion), 'Disables camera roll, shake, FOV kick and speed blur.');
        break;
      case 'world': {
        const marine = H.marine();
        html = `<h3>Time & Weather</h3>` +
          this.row(`Time of day <small data-r="hourtxt">${fmtHour(H.hour())}</small>`, this.range('hour', H.hour(), 0, 24, 0.05)) +
          this.row('Presets', `<div class="seg" data-seg="tpreset">${[['6.6', 'Dawn'], ['13', 'Day'], ['19.2', 'Golden'], ['20', 'Dusk'], ['22.5', 'Night']].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`) +
          this.row('Weather', this.seg('weather', ([['clear', 'Clear'], ['overcast', 'Overcast'], ['fog', 'Fog'], ['rain', 'Rain'], ['snow', 'Snow']] as [WeatherKind, string][]).filter(([w]) => w !== 'snow' || H.allowSnow()), H.weather()), 'Weather changes blend smoothly; roads stay wet after rain.') +
          (marine !== null ? this.row('Karl the Fog', this.sw('marine', marine), 'The marine layer rolls in off the Pacific over the bay.') : '');
        break;
      }
      case 'teleport':
        html = `<h3>Teleport</h3><div class="grid2">${H.districts().map((d, i) => `<button class="chip" data-tp="${i}"><b>${esc(d.name)}</b><span>District</span></button>`).join('')}</div>`;
        break;
      case 'activities':
        html = `<h3>Activities</h3><p class="note">Activities are optional and never block free roam. Drive into a glowing beacon and press <kbd>T</kbd>, or jump straight to the start here. Session bests are kept in this tab only.</p><div class="grid2">${H.activities().map((a, i) => `<button class="chip" data-ac="${i}"><b>${esc(a.name)}</b><span>${esc(a.best)}</span></button>`).join('')}</div>`;
        break;
      case 'car':
        html = `<h3>Car & Assists</h3>
          <div class="grid2" style="margin-bottom:14px">${H.vehicles().map((v) => `<button class="chip" data-veh="${v.id}" aria-pressed="${v.id === H.vehicle()}"><b>${esc(v.name)}</b><span>${esc(v.tagline)}</span></button>`).join('')}</div>
          ${H.branded() ? `<p class="note">BMW, M3 and the roundel are trademarks of BMW AG. This procedural fan model is for personal, non-commercial use and isn't affiliated with BMW. Turn badges off or pick the Vireo S6 before publishing.</p>` : `<p class="note">Vireo S6: a fictional rear-engine sports coupe with no real manufacturer's logos, badges or model names.</p>`}
          <div class="grid2" style="margin-bottom:12px">${H.paints().map((p, i) => `<button class="chip" data-paint="${i}" aria-pressed="${p.color === H.paint()}"><div class="swatch" style="background:${p.color}${p.matte ? ';filter:saturate(0.8) brightness(0.9)' : ''}"></div><b>${esc(p.name)}</b>${p.matte ? '<span>Matte</span>' : ''}</button>`).join('')}</div>` +
          (H.branded() ? this.row('Manufacturer badges', this.sw('badges', s.badges), 'Roundels and M badges on the car.') : '') +
          this.row('Gearbox', this.seg('gearbox', [['auto', 'Automatic'], ['manual', 'Manual (Q/E)']], s.assists.autoGearbox ? 'auto' : 'manual')) +
          this.row('ABS', this.sw('abs', s.assists.abs), 'Prevents wheel lock under braking.') +
          this.row('Traction control', this.sw('tcs', s.assists.tcs), 'Limits wheelspin.') +
          this.row('Stability control', this.sw('esc', s.assists.esc), 'Brakes individual wheels to stop spins. Off while the handbrake is held.') +
          this.row('Steering assist', this.sw('steerAssist', s.assists.steerAssist), 'Adds automatic counter-steer in slides.') +
          (H.inGame() ? this.row('Restart car', `<button class="btn" data-a="restart">Reset to road</button>`) : '');
        break;
      case 'controls': {
        const acts = Object.keys(ACTION_LABELS) as Action[];
        html = `<h3>Controls</h3><p class="note">Click a binding and press a new key. Gamepads use the standard layout: RT throttle, LT brake/reverse, left stick steer, A handbrake, B reset, Y camera, X look back, LB/RB gears, Start menu, Back photo mode, right stick look.</p>
          <div class="keys">${acts.map((a) => `<span>${ACTION_LABELS[a]}</span><button data-key="${a}">${s.keys[a].map(keyLabel).join(' / ')}</button>`).join('')}</div>`;
        break;
      }
      case 'graphics':
        html = `<h3>Graphics</h3>` +
          this.row('Quality preset', this.seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['cinematic', 'Cinematic']] as [QualityPreset, string][], s.quality), 'Changes draw distance, shadows, effects and traffic caps.') +
          this.row('Adaptive resolution', this.sw('adaptiveResolution', s.adaptiveResolution), 'Lowers render scale when frames run long.') +
          this.row('Shadows', this.sw('shadows', s.shadows)) +
          this.row('Ambient occlusion', this.sw('ambientOcclusion', s.ambientOcclusion), 'Baked contact shading where walls meet the ground (all presets but Low).') +
          this.row('Bloom', this.sw('bloom', s.bloom)) +
          this.row('Motion blur (speed)', this.sw('motionBlur', s.motionBlur)) +
          this.row('Reflections', this.sw('reflections', s.reflections), 'Environment reflections on car paint, glass and wet roads.') +
          this.row('Volumetric fog', this.sw('volumetrics', s.volumetrics), 'Height fog and the rolling marine layer.') +
          this.row('Traffic density', this.range('trafficDensity', s.trafficDensity, 0, 1.5, 0.05)) +
          this.row('Performance overlay', this.sw('showFps', s.showFps), 'Also toggled with F3.');
        break;
      case 'audio':
        html = `<h3>Audio</h3>` +
          this.row('Master', this.range('masterVolume', s.masterVolume, 0, 1, 0.01)) +
          this.row('Effects', this.range('sfxVolume', s.sfxVolume, 0, 1, 0.01)) +
          this.row('Music', this.range('musicVolume', s.musicVolume, 0, 1, 0.01)) +
          this.row('Radio (generative music)', this.sw('music', s.music), 'Also toggled with M.');
        break;
      case 'session':
        html = `<h3>Session & Privacy</h3>
          <p class="note">California Drive has no accounts, cloud saves, leaderboards or analytics. Settings and session bests sit in this tab's <code>sessionStorage</code> only and are gone when you close it. Ghost runs exist in memory only. Nothing about you or your driving is ever sent over the network.</p>` +
          this.row('Units', this.seg('units', [['mph', 'mph'], ['kmh', 'km/h']], s.units)) +
          this.row('Minimap', this.sw('minimap', s.minimap)) +
          this.row('Target lock', this.sw('targetLock', s.targetLock), 'Reticle that locks onto the nearest activity or checkpoint.') +
          this.row('Street-name callouts', this.sw('streetNames', s.streetNames)) +
          this.row('Reset Session', `<button class="btn" data-a="reset">Wipe session data</button>`, 'Clears sessionStorage, bests, ghosts and settings immediately.');
        break;
      case 'credits':
        html = `<h3>Credits & Licenses</h3><pre class="licenses">${esc(LICENSE_TEXT)}</pre>`;
        break;
      default:
        html = '';
    }
    this.body.innerHTML = html;
    this.bind();
  }

  private bind() {
    const s = this.h.settings;
    const H = this.h;
    const apply = () => H.applySettings();
    this.body.querySelectorAll<HTMLElement>('[data-seg]').forEach((g) => g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.v!;
      switch (g.dataset.seg) {
        case 'cam': H.setCamera(v as CameraMode); break;
        case 'tpreset': H.setHour(parseFloat(v)); this.render(); return;
        case 'weather': H.setWeather(v as WeatherKind); break;
        case 'gearbox': s.assists.autoGearbox = v === 'auto'; apply(); break;
        case 'quality': s.quality = v as QualityPreset; apply(); break;
        case 'units': s.units = v as 'mph' | 'kmh'; apply(); break;
      }
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    })));
    this.body.querySelectorAll<HTMLInputElement>('[data-sw]').forEach((i) => i.addEventListener('change', () => {
      const k = i.dataset.sw!;
      if (k === 'marine') { H.setMarine(i.checked); return; }
      if (k in s.assists) (s.assists as any)[k] = i.checked;
      else (s as any)[k] = i.checked;
      apply();
    }));
    this.body.querySelectorAll<HTMLInputElement>('[data-rg]').forEach((i) => i.addEventListener('input', () => {
      const k = i.dataset.rg!;
      const v = parseFloat(i.value);
      if (k === 'hour') { H.setHour(v); const t = this.body.querySelector('[data-r=hourtxt]'); if (t) t.textContent = fmtHour(v); return; }
      (s as any)[k] = v;
      apply();
    }));
    this.body.querySelectorAll<HTMLButtonElement>('[data-tp]').forEach((b) => b.addEventListener('click', () => { H.districts()[+b.dataset.tp!].go(); this.close(); H.resume(); }));
    this.body.querySelectorAll<HTMLButtonElement>('[data-ac]').forEach((b) => b.addEventListener('click', () => { H.activities()[+b.dataset.ac!].go(); this.close(); H.resume(); }));
    this.body.querySelectorAll<HTMLButtonElement>('[data-veh]').forEach((b) => b.addEventListener('click', () => { H.setVehicle(b.dataset.veh!); this.render(); }));
    this.body.querySelectorAll<HTMLButtonElement>('[data-paint]').forEach((b) => b.addEventListener('click', () => {
      H.setPaint(H.paints()[+b.dataset.paint!]);
      this.body.querySelectorAll('[data-paint]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    this.body.querySelector('[data-a=restart]')?.addEventListener('click', () => { H.restartCar(); this.close(); H.resume(); });
    this.body.querySelector('[data-a=reset]')?.addEventListener('click', () => { H.resetSession(); this.render(); });
    this.body.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.key as Action;
      b.classList.add('listening');
      b.textContent = 'Press a key…';
      const code = await H.captureKey();
      if (code !== 'Escape') {
        for (const other of Object.keys(s.keys) as Action[]) s.keys[other] = s.keys[other].filter((c) => c !== code || other === a);
        s.keys[a] = [code, ...s.keys[a].filter((c) => c !== code)].slice(0, 2);
        apply();
      }
      this.render();
    }));
  }
}

function fmtHour(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
