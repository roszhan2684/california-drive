import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three';
import { installFogChunks } from '../render/fog.ts';
import { loadAssets, type GameAssets } from '../render/assets.ts';
import { setMaterialAssets } from '../render/materials.ts';
import { PostFX } from '../render/post.ts';
import { SessionStore } from '../core/session.ts';
import { defaultSettings, loadSettings, saveSettings, type Settings } from '../core/settings.ts';
import { QUALITY, QualityGovernor } from '../core/quality.ts';
import { InputManager } from '../input/input.ts';
import { AudioEngine } from '../audio/audio.ts';
import { CITIES, getCity, type CityDef, type TimePreset, type WeatherKind } from '../world/cities.ts';
import { loadDistrict } from '../world/district.ts';
import type { DriveWorld, FrameInput } from './driveWorld.ts';
import { TitleScene } from './titleScene.ts';
import { GarageScreen } from '../ui/garage.ts';
import { ReliefScene } from './reliefScene.ts';
import { TitleScreen, CitySelect, LoadingScreen, RevealOverlay } from '../ui/screens.ts';
import { Hud } from '../ui/hud.ts';
import { PauseMenu, type PauseHost } from '../ui/pause.ts';
import { setReducedMotion } from '../ui/motion.ts';
import { PhotoUI, PHOTO_GRADES, apertureFor, composePostcard, downloadBlob, letterboxFrac, type PhotoFilter } from '../ui/photo.ts';
import { G } from '../physics/world.ts';
import { CAMERA_LABELS, isInterior, type CameraMode } from '../camera/cameraRig.ts';
import { GpuTimer } from '../debug/gpuTimer.ts';
import { TuningPanel } from '../debug/tuning.ts';
import { fmtTime } from '../activities/activities.ts';
import type { Paint } from '../vehicle/carModel.ts';
import { AVAILABLE_VEHICLES, vehicleDef, type VehicleDef, type VehicleId } from '../vehicle/vehicles.ts';
import { TIME_PRESETS } from '../render/sky.ts';

const _v = new Vector3();
const _v2 = new Vector3();

type State = 'title' | 'garage' | 'select' | 'loading' | 'reveal' | 'drive' | 'paused' | 'photo';

export class Game {
  readonly renderer: WebGLRenderer;
  readonly session = new SessionStore();
  settings: Settings;
  readonly input: InputManager;
  readonly audio = new AudioEngine();
  private post: PostFX;
  private title: TitleScene;
  private world: DriveWorld | null = null;
  private state: State = 'title';
  private ui: HTMLElement;
  private titleUI: TitleScreen;
  private selectUI: CitySelect;
  private garageUI!: GarageScreen;
  private relief!: ReliefScene;
  private loadingUI: LoadingScreen;
  private revealUI: RevealOverlay;
  private hud: Hud;
  private pause: PauseMenu;
  private photo: PhotoUI;
  private governor = new QualityGovernor();
  private gpu: GpuTimer;
  private tuning = new TuningPanel();
  private last = performance.now();
  private debugOn = false;
  private debugTimer = 0;
  private frameMs = 0;
  private simMs = 0;
  private renderMs = 0;
  private frames = 0;
  private resScale = 1;
  private available = new Set<string>();
  private def(): VehicleDef { return vehicleDef(this.settings.vehicle); }
  private paintFor(d: VehicleDef): Paint { return this.session.get<Paint>(`paint.${d.id}`, d.paints[0]); }
  private revealT = 0;
  private lights = { headlights: false, highBeam: false, indicator: 0 as -1 | 0 | 1, hazards: false, wipers: false, parkingBrake: false };
  private streetTimer = 0;
  private lastStreet = '';
  private lastArea = '';
  private pendingStreet = '';
  private pendingT = 0;
  private captureRequest: ((c: HTMLCanvasElement) => void) | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private tickPhase = false;
  private hornHeld = false;
  private currentCity: CityDef | null = null;
  private loadToken = 0;
  private autoSkip = false;
  private assets: GameAssets | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    installFogChunks();
    this.settings = loadSettings(this.session);
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.title = new TitleScene(this.renderer, innerWidth / innerHeight, this.def(), this.paintFor(this.def()));
    this.post = new PostFX(this.renderer, this.title.scene, this.title.camera);
    loadAssets().then((a) => {
      this.assets = a;
      setMaterialAssets(a);
      if ((this as any).noHdri) return;
      this.title.sky.setHdri(a?.hdri ?? null);
      this.world?.sky.setHdri(a?.hdri ?? null);
    });
    this.input = new InputManager(this.settings.keys);

    const lastCity = this.session.get('lastCity', 'sf');
    this.titleUI = new TitleScreen(ui, {
      drive: () => { this.gesture(); const c = getCity(this.session.get('lastCity', 'sf')) ?? CITIES[0]; this.load(c.id, c.defaultTime, c.defaultWeather); },
      select: () => { this.gesture(); this.go('select'); },
      garage: () => { this.gesture(); this.go('garage'); },
      controls: () => { this.gesture(); this.pause.openAt('controls', () => this.titleUI.show(true)); this.titleUI.show(false); },
      graphics: () => { this.gesture(); this.pause.openAt('graphics', () => this.titleUI.show(true)); this.titleUI.show(false); },
      about: () => { this.gesture(); this.pause.openAt('credits', () => this.titleUI.show(true)); this.titleUI.show(false); },
    }, lastCity);
    this.selectUI = this.makeSelect(lastCity);
    this.relief = new ReliefScene(innerWidth / innerHeight);
    this.relief.load(import.meta.env.BASE_URL).then((ok) => {
      if (!ok) return;
      for (const c of CITIES) this.relief.addPin(c.id, c.mapAt.lat, c.mapAt.lon);
      const c = this.selectUI.selected;
      this.relief.focus(c.id, c.mapAt.lat, c.mapAt.lon);
      this.selectUI.use3d(true);
      if (this.state === 'select') this.go('select');
    });
    this.garageUI = new GarageScreen(ui, {
      back: () => this.go('title'),
      drive: () => { const c = getCity(this.session.get('lastCity', 'sf')) ?? CITIES[0]; this.load(c.id, c.defaultTime, c.defaultWeather); },
      vehicle: (id) => {
        this.settings.vehicle = id;
        const d = this.def();
        this.title.setCar(d, this.paintFor(d));
        this.applySettings();
      },
      paint: (p) => { this.session.set(`paint.${this.def().id}`, p); this.title.car.setPaint(p.color, p.matte); },
      current: () => ({ def: this.def(), paint: this.paintFor(this.def()) }),
    });
    this.loadingUI = new LoadingScreen(ui);
    this.revealUI = new RevealOverlay(ui);
    this.hud = new Hud(ui);
    this.photo = new PhotoUI(ui, {
      filter: (f) => this.applyGrade(f),
      fov: (v) => {
        if (!this.world) return;
        // keep the framing when changing lens: dolly out with focal length (orbit camera)
        const prev = this.world.cam.baseFov;
        this.world.cam.baseFov = v;
        const k = Math.tan((prev * Math.PI) / 360) / Math.tan((v * Math.PI) / 360);
        this.world.cam.orbit.dist = Math.min(30, Math.max(3, this.world.cam.orbit.dist * k));
      },
      dof: (f) => { this.photoF = f; },
      letterbox: (a) => { this.photoLetterbox = a; },
      postcard: () => this.savePostcard(),
      exit: () => this.exitPhoto(),
    });
    this.pause = new PauseMenu(ui, this.pauseHost());
    this.applySettings();
    this.bindDom(canvas);
    this.resize();
    this.go('title');
    this.probeAvailability();
    const qp = new URLSearchParams(location.search);
    if (qp.get('ao') === '0') this.settings.ambientOcclusion = false;
    if (qp.get('ao') === '1') this.settings.ambientOcclusion = true;
    if (qp.get('hdri') === '0') (this as any).noHdri = true;
    const qq = qp.get('q');
    if (qq && qq in QUALITY) this.settings.quality = qq as keyof typeof QUALITY;
    this.applySettings();
    const qc = qp.get('city');
    if (qc) {
      const c = getCity(qc);
      this.autoSkip = qp.get('skip') === '1';
      this.load(c ? c.id : 'proving', (qp.get('time') as TimePreset) ?? c?.defaultTime ?? 'day', (qp.get('weather') as WeatherKind) ?? c?.defaultWeather ?? 'clear');
    }
    this.exposeDebug();
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ setup
  private async probeAvailability() {
    await Promise.all(CITIES.map(async (c) => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}cities/${c.id}/district.json`, { method: 'HEAD', credentials: 'omit' });
        if (r.ok) this.available.add(c.id);
      } catch { /* not available */ }
    }));
    const prevSel = this.selectUI;
    prevSel.root.remove();
    this.selectUI = this.makeSelect(this.session.get('lastCity', 'sf'));
    this.selectUI.use3d(this.relief.ready);
    this.selectUI.show(this.state === 'select');
  }

  private makeSelect(initial: string): CitySelect {
    return new CitySelect(this.ui, this.available, initial, {
      drive: (id, t, w) => this.load(id, t, w),
      proving: () => this.load('proving', 'day', 'clear'),
      back: () => this.go('title'),
      focus: (c) => this.relief?.focus(c.id, c.mapAt.lat, c.mapAt.lon),
    });
  }

  private gesture() {
    this.audio.init().then(() => {
      this.audio.volumes = { master: this.settings.masterVolume, music: this.settings.musicVolume, sfx: this.settings.sfxVolume };
      this.audio.setMusic(this.settings.music);
    });
  }

  private bindDom(canvas: HTMLCanvasElement) {
    addEventListener('resize', () => this.resize());
    const once = () => this.gesture();
    addEventListener('pointerdown', once, { once: true });
    addEventListener('keydown', once, { once: true });
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastPointer = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', (e) => { this.dragging = false; canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (this.state === 'garage') this.title.orbit(dx, dy);
      else this.world?.cam.mouseLook(dx, dy);
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.state === 'garage') { this.title.zoomBy(e.deltaY); e.preventDefault(); }
      else if (this.world && this.state === 'photo') { this.world.cam.zoom(e.deltaY); e.preventDefault(); }
    }, { passive: false });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.audio.suspend(); if (this.state === 'drive') this.openPause(); }
      else if (this.state !== 'paused') this.audio.resume();
    });
    addEventListener('keydown', (e) => {
      if (this.state === 'reveal' && !e.repeat) this.skipReveal();
      if ((this.state === 'select' || this.state === 'garage') && e.code === 'Escape') this.go('title');
      if (this.pause.open && e.code === 'Escape') { e.preventDefault(); this.pause.close(); if (this.world && this.state === 'paused') this.resumeGame(); }
    });
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    const q = QUALITY[this.settings.quality];
    const pr = Math.min(devicePixelRatio || 1, q.pixelRatioCap) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.title.camera.aspect = w / h;
    this.title.camera.updateProjectionMatrix();
    if (this.relief) { this.relief.camera.aspect = w / h; this.relief.camera.updateProjectionMatrix(); }
    if (this.world) {
      this.world.cam.camera.aspect = w / h;
      this.world.cam.camera.updateProjectionMatrix();
      this.world.smoke.setViewportHeight(h * pr, this.world.cam.camera.fov);
      this.world.sparks.setViewportHeight(h * pr, this.world.cam.camera.fov);
      this.world.debris.setViewportHeight(h * pr, this.world.cam.camera.fov);
    }
  }

  applySettings() {
    const s = this.settings;
    saveSettings(this.session, s);
    const q = QUALITY[s.quality];
    this.renderer.shadowMap.enabled = q.shadows && s.shadows;
    this.post.apply({ ao: q.ao && s.ambientOcclusion, bloom: q.bloom && s.bloom, smaa: q.smaa, speedBlur: q.speedBlur && s.motionBlur && !s.reducedMotion });
    this.governor.enabled = s.adaptiveResolution;
    if (!s.adaptiveResolution) this.resScale = 1;
    this.input.keys = s.keys;
    this.audio.volumes = { master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume };
    this.audio.applyVolumes();
    this.audio.setMusic(s.music);
    this.audio.setEngineProfile(this.def().sound);
    this.hud.configure({ turbo: this.def().sound.turbo, maxBoostBar: this.def().sound.turbo ? 1.7 : 0 });
    this.title.car.setBadges?.(s.badges);
    this.hud.minimap.enabled = s.minimap;
    this.hud.lock.enabled = s.targetLock;
    setReducedMotion(s.reducedMotion);
    this.hud.setMinimapVisible(s.minimap && !!this.world?.spec.district);
    this.hud.setVisible(this.state === 'drive');
    const w = this.world;
    if (w) {
      w.car.setBadges?.(s.badges);
      w.applyQuality(q, s.trafficDensity);
      w.vehicle.assists = { ...s.assists };
      w.cam.reducedMotion = s.reducedMotion;
      w.cam.baseFov = s.fov;
      w.view.units = s.units;
      w.activities?.setUnits(s.units);
      w.sky.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (w.sky.sun.shadow.map) { w.sky.sun.shadow.map.dispose(); (w.sky.sun.shadow as any).map = null; }
      w.sky.sun.castShadow = q.shadows && s.shadows;
      w.car.spotL.castShadow = q.headlightShadows;
      w.envBase = s.reflections ? 0.5 : 0.15;
      w.weather.marineEnabled = w.marineOn && s.volumetrics;
    }
    this.resize();
  }

  private applyGrade(f: PhotoFilter) {
    const g = PHOTO_GRADES[f];
    this.post.setGrade(g.contrast, g.saturation, g.lift, g.gain, g.vignette);
  }

  // ------------------------------------------------------------ state
  private go(s: State) {
    this.state = s;
    this.titleUI.show(s === 'title');
    this.selectUI.show(s === 'select');
    this.garageUI.show(s === 'garage');
    this.title.setShowroom(s === 'garage');
    this.hud.setVisible(s === 'drive');
    this.photo.show(s === 'photo');
    if (s !== 'reveal') this.revealUI.hide();
    if (s === 'select' && this.relief?.ready) {
      this.post.setScene(this.relief.scene);
      this.post.setCamera(this.relief.camera);
    } else if (s === 'title' || s === 'select' || s === 'garage') {
      this.post.setScene(this.title.scene);
      this.post.setCamera(this.title.camera);
    }
    this.input.enabled = s === 'drive';
  }

  private async load(cityId: string, time: TimePreset, weather: WeatherKind) {
    const token = ++this.loadToken;
    const city = cityId === 'proving' ? null : getCity(cityId) ?? null;
    this.go('loading');
    this.loadingUI.start(city?.name ?? 'Proving Ground', city?.id);
    this.disposeWorld();
    try {
      const district = city ? await loadDistrict(city.id, (f) => this.loadingUI.set(f * 0.3, 'Downloading open map data…')) : null;
      if (token !== this.loadToken) return;
      const { DriveWorld } = await import('./driveWorld.ts');
      if (token !== this.loadToken) return;
      const world = await DriveWorld.create({ city, district, time, weather }, this.renderer, QUALITY[this.settings.quality], this.session, innerWidth / innerHeight, this.def(), this.paintFor(this.def()), (f, step) => this.loadingUI.set(0.3 + f * 0.7, step));
      if (token !== this.loadToken) { world.dispose(); return; }
      this.world = world;
      if (!(this as any).noHdri) world.sky.setHdri(this.assets?.hdri ?? null);
      this.currentCity = city;
      if (city) this.session.set('lastCity', city.id);
      if (district) this.hud.minimap.bake(district); else this.hud.minimap.clear();
      this.hud.setMinimapVisible(!!district && this.settings.minimap);
      this.applySettings();
      this.post.setScene(world.scene);
      this.post.setCamera(world.cam.camera);
      this.applyGrade('natural');
      // headlights on automatically when dark or foggy
      world.sky.update(0, world.hour, world.weather.state, world.vehicle.position, 60);
      this.lights = { headlights: world.sky.night > 0.35 || weather === 'fog' || weather === 'rain', highBeam: false, indicator: 0, hazards: false, wipers: weather === 'rain', parkingBrake: false };
      this.loadingUI.hide();
      this.startReveal();
      if (this.autoSkip) this.skipReveal();
      const at = new URLSearchParams(location.search).get('at');
      if (at && world.proj) {
        const [la, lo] = at.split(',').map(Number);
        if (Number.isFinite(la) && Number.isFinite(lo)) {
          const q = world.proj.toLocal(la, lo);
          world.teleport(q.x, q.z, undefined, true);
        }
      }
    } catch (e) {
      console.error(e);
      this.loadingUI.error(`Could not load this district: ${(e as Error).message}`);
      setTimeout(() => { if (this.state === 'loading') this.go('select'); this.loadingUI.hide(); }, 3500);
    }
  }

  private disposeWorld() {
    this.hud.lock.reset();
    if (!this.world) return;
    this.world.dispose();
    this.world = null;
    this.tuning.dispose();
  }

  // cinematic vehicle reveal: orbit, headlight ignition, engine start, blend into chase
  private startReveal() {
    const w = this.world!;
    this.state = 'reveal';
    this.revealT = 0;
    this.revealUI.show(this.currentCity?.name ?? 'Proving Ground', this.currentCity?.district ?? 'Closed test track', `${w.def.name} · ${w.def.tagline}`);
    w.vehicle.engineOn = false;
    w.view.ignition = 0;
    const reduced = this.settings.reducedMotion;
    w.cam.override = (cam, dt) => {
      this.revealT += dt;
      const t = this.revealT;
      const p = w.renderPos;
      const yaw = -w.vehicle.yaw;
      const a = yaw + Math.PI * 0.8 - (reduced ? 0 : t * 0.32);
      const r = 6.2 - Math.min(1.2, t * 0.25);
      cam.position.set(p.x + Math.sin(a) * r, p.y + 0.55 + t * 0.12, p.z - Math.cos(a) * r);
      cam.lookAt(p.x, p.y + 0.1, p.z);
      cam.fov = 38;
      cam.updateProjectionMatrix();
      if (t > 1.0 && w.view.ignition === 0) { w.view.ignition = 0.01; }
      if (w.view.ignition > 0) w.view.ignition = Math.min(1, w.view.ignition + dt * 2.5);
      if (t > 1.8 && !w.vehicle.engineOn && !(w as any)._starter) { (w as any)._starter = true; this.audio.starter(); }
      if (t > 2.4 && !w.vehicle.engineOn) { w.vehicle.engineOn = true; w.vehicle.engineRpm = 2200; }
      if (t > 4.2) this.finishReveal();
    };
  }

  private skipReveal() {
    const w = this.world;
    if (!w) return;
    w.vehicle.engineOn = true;
    w.view.ignition = 1;
    this.finishReveal();
  }

  private finishReveal() {
    const w = this.world;
    if (!w || this.state !== 'reveal') return;
    w.cam.override = null;
    w.cam.mode = 'chase';
    w.cam.startBlend(1.1);
    w.view.ignition = 1;
    w.vehicle.engineOn = true;
    this.revealUI.hide();
    this.go('drive');
    this.input.clearPressed();
    this.hud.camera(CAMERA_LABELS.chase);
    if (this.currentCity) this.hud.street(this.currentCity.districts[0]?.name ?? this.currentCity.name, this.currentCity.name);
    this.hud.boot(w.def.name, this.currentCity ? `${this.currentCity.name} · ${this.currentCity.districts[0]?.name ?? ''}` : 'Proving Ground');
  }

  private openPause() {
    if (!this.world) return;
    if (this.state === 'photo') this.exitPhoto();
    this.state = 'paused';
    this.input.enabled = false;
    this.hud.setVisible(false);
    this.pause.openAt('resume');
    this.audio.horn(false);
  }

  private resumeGame() {
    if (!this.world) return;
    this.go('drive');
    this.input.clearPressed();
    this.world.clock.reset();
  }

  private enterPhoto() {
    const w = this.world;
    if (!w) return;
    this.state = 'photo';
    this.prevCam = w.cam.mode;
    w.cam.setMode('orbit');
    w.cam.orbit.yaw = -w.vehicle.yaw + Math.PI * 0.75;
    this.hud.setVisible(false);
    this.photo.show(true);
    this.input.enabled = false;
    this.audio.horn(false);
  }

  private prevCam: CameraMode = 'chase';
  private photoF = 0;
  private photoLetterbox = 0;
  private sunVis = 0;
  private sunRayTimer = 0;
  private sunClear = 0;
  private exitPhoto() {
    const w = this.world;
    if (!w) return;
    this.post.setDof(false);
    this.post.setLetterbox(0);
    w.cam.setMode(this.prevCam);
    w.cam.baseFov = this.settings.fov;
    this.applyGrade('natural');
    this.photo.show(false);
    this.go('drive');
    this.input.clearPressed();
    w.clock.reset();
  }

  /** Photo DOF/letterbox, high-speed chromatic aberration, exhaust heat haze and sun lens dirt. */
  private updateLens(dt: number, w: DriveWorld, interior: boolean) {
    const cam = w.cam.camera;
    if (this.state === 'photo') {
      const focus = cam.position.distanceTo(w.renderPos);
      this.post.setDof(this.photoF > 0, focus, apertureFor(this.photoF, this.photo.lens));
      this.post.setLetterbox(letterboxFrac(this.photoLetterbox, innerWidth / innerHeight));
    }
    const fx = !this.settings.reducedMotion;
    const kmh = w.vehicle.telemetry.speed * 3.6;
    const chroma = fx ? Math.max(0, Math.min(1, (kmh - 150) / 120)) : 0;
    // heat haze from the tailpipes (exterior cameras, engine working)
    let haze = 0, hx = 0.5, hy = 0.7;
    const ex = w.car.exhaust;
    if (fx && ex.length && !interior) {
      _v.set(0, 0, 0);
      for (const e of ex) _v.add(e.getWorldPosition(_v2));
      _v.multiplyScalar(1 / ex.length).project(cam);
      if (_v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1) {
        hx = _v.x * 0.5 + 0.5; hy = _v.y * 0.5 + 0.5;
        const t = w.vehicle.telemetry;
        haze = Math.min(1, 0.15 + t.throttle * 0.45 + (t.rpm / w.cfg.engine.limiterRpm) * 0.2) * Math.max(0, 1 - t.speed / 25) * (1 - w.weather.state.rain * 0.7);
      }
    }
    // sun in view, not hidden behind buildings/terrain (physics ray, throttled)
    const sd = w.sky.sunDir;
    let sx = 0.5, sy = 0.5, want = 0;
    if (sd.y > 0.02 && w.sky.night < 0.3) {
      _v.copy(cam.position).addScaledVector(sd, 2000).project(cam);
      if (_v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15) {
        sx = _v.x * 0.5 + 0.5; sy = _v.y * 0.5 + 0.5;
        this.sunRayTimer -= dt;
        if (this.sunRayTimer <= 0) {
          this.sunRayTimer = 0.12;
          const p = cam.position;
          this.sunClear = w.physics.castRay(p.x, p.y, p.z, sd.x, sd.y, sd.z, 1500, G.STATIC | G.TERRAIN) ? 0 : 1;
        }
        const edge = 1 - Math.max(0, Math.max(Math.abs(_v.x), Math.abs(_v.y)) - 0.85) / 0.3;
        want = this.sunClear * Math.max(0, edge) * (1 - w.weather.state.cloud * 0.9) * (1 - w.weather.state.fog * 0.8) * (interior ? 0.6 : 1);
      }
    }
    this.sunVis += (want - this.sunVis) * Math.min(1, dt * 4);
    this.post.setLens(chroma * 0.8, hx, hy, haze, sx, sy, this.sunVis);
  }

  private savePostcard() {
    const w = this.world;
    if (!w) return;
    this.captureRequest = (canvas) => {
      const ll = w.proj ? w.proj.toLatLon(w.renderPos.x, w.renderPos.z) : { lat: 36.78, lon: -119.42 };
      const hh = Math.floor(w.hour) % 24, mm = Math.floor((w.hour % 1) * 60);
      composePostcard(canvas, {
        city: this.currentCity?.name ?? 'California',
        district: this.lastArea || this.currentCity?.district || 'Proving Ground',
        lat: ll.lat, lon: ll.lon,
        time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        filter: this.photo.filter,
        template: this.photo.template,
      }).then((b) => {
        if (b) downloadBlob(b, `california-drive-${(this.currentCity?.id ?? 'proving')}-${Date.now()}.png`);
        this.hud.toast('Postcard saved', 'Downloaded to your device — never uploaded', 'good');
      });
      const cam = w.cam.camera;
      const dir = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const spot = w.activities?.checkPhoto({ x: cam.position.x, y: cam.position.y, z: cam.position.z, dx: dir.x, dy: dir.y, dz: dir.z });
      if (spot) this.hud.toast(`Photo spot captured`, spot, 'discovery');
    };
  }

  // ------------------------------------------------------------ frame
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    this.frames++;
    const dt = Math.min(0.1, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    const t0 = performance.now();
    this.input.pollPad();
    if (this.state === 'title' || this.state === 'garage' || this.state === 'select' || this.state === 'loading') {
      if (this.state === 'select' && this.relief.ready) {
        this.relief.update(dt, innerWidth, innerHeight);
        this.selectUI.placePins((id) => this.relief.project(id, innerWidth, innerHeight));
      } else if (this.state !== 'loading') this.title.update(dt);
      const r0 = performance.now();
      if (this.state !== 'loading') this.post.render(dt);
      this.renderMs = performance.now() - r0;
    } else if (this.world) {
      this.updateWorld(dt);
      const r0 = performance.now();
      this.gpu.begin();
      this.post.render(dt);
      this.gpu.end();
      this.renderMs = performance.now() - r0;
      if (this.captureRequest) {
        const cb = this.captureRequest;
        this.captureRequest = null;
        cb(this.renderer.domElement);
      }
    }
    this.frameMs = performance.now() - t0;
    const sc = this.governor.sample(this.frameMs, dt);
    if (sc !== null) { this.resScale = sc; this.resize(); }
    this.updateDebug(dt);
  };

  private updateWorld(dt: number) {
    const w = this.world!;
    const inp = this.input;
    const driving = this.state === 'drive';
    // actions
    if (driving) {
      if (inp.consume('pause')) { this.openPause(); return; }
      if (inp.consume('photo')) { this.enterPhoto(); }
      while (inp.consume('camera')) { w.cam.next(1); this.hud.camera(CAMERA_LABELS[w.cam.mode]); }
      while (inp.consume('cameraPrev')) { w.cam.next(-1); this.hud.camera(CAMERA_LABELS[w.cam.mode]); }
      if (inp.consume('reset')) { w.resetVehicle(); }
      if (inp.consume('headlights')) { this.lights.headlights = !this.lights.headlights; if (!this.lights.headlights) this.lights.highBeam = false; }
      if (inp.consume('highBeam')) { this.lights.highBeam = !this.lights.highBeam; if (this.lights.highBeam) this.lights.headlights = true; }
      if (inp.consume('indicatorLeft')) { this.lights.indicator = this.lights.indicator === -1 ? 0 : -1; this.lights.hazards = false; }
      if (inp.consume('indicatorRight')) { this.lights.indicator = this.lights.indicator === 1 ? 0 : 1; this.lights.hazards = false; }
      if (inp.consume('hazards')) { this.lights.hazards = !this.lights.hazards; this.lights.indicator = 0; }
      if (inp.consume('wipers')) { this.lights.wipers = !this.lights.wipers; this.hud.toast(this.lights.wipers ? 'Wipers on' : 'Wipers off'); }
      if (inp.consume('parkingBrake')) { this.lights.parkingBrake = !this.lights.parkingBrake; }
      if (inp.consume('engine')) {
        w.vehicle.engineOn = !w.vehicle.engineOn;
        if (w.vehicle.engineOn) { this.audio.starter(); w.vehicle.engineRpm = 1600; }
        this.hud.toast(w.vehicle.engineOn ? 'Engine started' : 'Engine off');
      }
      if (inp.consume('music')) { this.settings.music = !this.settings.music; this.applySettings(); this.hud.toast(this.settings.music ? 'Radio on · KCAL Night Drive' : 'Radio off'); }
    }
    if (this.state === 'photo' && (this.input.consume('photo') || this.input.consume('pause'))) this.exitPhoto();
    if (inp.consume('debug')) { this.debugOn = !this.debugOn; this.settings.showFps = this.debugOn; }
    if (inp.consume('tuning')) this.tuning.toggle(w.cfg, w.cam.tuning, this.post, () => undefined);
    const hornNow = driving && inp.held('horn');
    if (hornNow !== this.hornHeld) { this.hornHeld = hornNow; this.audio.horn(hornNow); }
    // gear shifts are edge-triggered
    const drive = inp.drive(w.vehicle.telemetry.speed, dt);
    if (driving && !this.settings.assists.autoGearbox) {
      drive.gearUp = inp.consume('gearUp');
      drive.gearDown = inp.consume('gearDown');
    } else { inp.consume('gearUp'); inp.consume('gearDown'); }
    const fi: FrameInput = {
      drive: this.state === 'reveal' ? { throttle: 0, brake: 0, steer: 0, handbrake: 1 } : drive,
      lookBack: driving && inp.held('lookBack'),
      lookX: inp.lookX, lookY: inp.lookY,
      parkingBrake: this.lights.parkingBrake,
      activityPressed: driving && inp.consume('activity'),
      paused: this.state === 'paused', photo: this.state === 'photo',
    };
    const s0 = performance.now();
    const sim = this.state === 'drive' || this.state === 'reveal';
    w.view.lights = { ...this.lights, indicator: this.lights.indicator };
    const impacts = w.update(dt, fi, sim);
    this.simMs = performance.now() - s0;
    for (const im of impacts) this.audio.impact(im.strength);
    for (const c of w.crackles) this.audio.crackle(c);
    // indicator ticks
    const blinking = this.lights.hazards || this.lights.indicator !== 0;
    if (blinking && w.view.blink !== this.tickPhase) { this.tickPhase = w.view.blink; this.audio.tick(this.tickPhase); }
    // post: tunnels brighten exposure, speed blur, windshield rain
    const interior = isInterior(w.cam.mode) || w.cam.mode === 'hood';
    this.post.exposureTarget = 0.85 + w.tunnelFactor * 0.35;
    if (w.inTunnel && !this.lights.headlights && driving) this.lights.headlights = true;
    const speedBlur = Math.max(0, Math.min(1, (w.vehicle.telemetry.speed - 35) / 45)) * (w.cam.mode === 'chase' || w.cam.mode === 'close' || w.cam.mode === 'bumper' ? 1 : 0.5);
    this.post.update(dt, w.time, this.settings.reducedMotion ? 0 : speedBlur * 0.8, interior ? w.weather.state.rain : 0, w.view.wiperPhase);
    this.updateLens(dt, w, interior);
    // audio
    const city = this.currentCity;
    const urban = city && city.biome !== 'alpine' ? 1 : 0;
    const coastal = city?.biome === 'coastal' ? 1 : 0;
    const forest = city?.biome === 'alpine' ? 1 : 0;
    const af = w.audioFrame(dt, urban, coastal, forest);
    this.audio.update(af);
    // activity + world events
    for (const ev of w.events) if (ev.kind === 'toast') this.hud.toast(ev.title, ev.sub, ev.tone === 'good' ? 'good' : ev.tone === 'bad' ? 'bad' : 'info');
    if (w.activities) {
      this.hud.activity(w.activities.hud);
      this.hud.prompt(w.activities.prompt);
    }
    // street names, districts, discoveries
    this.streetTimer -= dt;
    if (this.streetTimer <= 0 && w.net && this.currentCity && driving) {
      this.streetTimer = 0.3;
      this.updateCallouts(w, this.currentCity);
    }
    // HUD + minimap
    if (driving) {
      const t = w.vehicle.telemetry;
      this.hud.update(dt, t, w.cfg.engine.limiterRpm, this.settings.units, { on: this.lights.headlights, high: this.lights.highBeam, parking: this.lights.parkingBrake }, -w.vehicle.yaw, this.audio.boostLevel);
      this.hud.setRedline(w.cfg.engine.redlineRpm / w.cfg.engine.limiterRpm);
      const cp = w.activities?.currentCheckpoint() ?? null;
      this.hud.setInputHints(this.input.keys, this.input.lastSource);
      this.hud.lock.update(dt, w.cam.camera, w.activities?.markers ?? [], cp, w.renderPos.x, w.renderPos.z, this.settings.units);
      this.hud.minimap.draw(w.renderPos.x, w.renderPos.z, -w.vehicle.yaw, t.speed, w.activities?.markers ?? [], w.activities?.route ?? [], cp, w.trafficPoints(), w.time);
    }
  }

  private updateCallouts(w: DriveWorld, city: CityDef) {
    const p = w.renderPos;
    // district
    let area = '';
    let best = 1200;
    for (const d of city.districts) {
      const q = w.proj!.toLocal(d.at.lat, d.at.lon);
      const dd = Math.hypot(q.x - p.x, q.z - p.z);
      if (dd < best) { best = dd; area = d.name; }
    }
    if (area && area !== this.lastArea) {
      if (this.lastArea) this.hud.toast(`Entering ${area}`, city.name, 'info');
      this.lastArea = area;
    }
    // street
    if (this.settings.streetNames) {
      const hit = w.net!.nearest(p.x, p.z, 14);
      const name = hit?.edge.name ?? '';
      if (name !== this.pendingStreet) { this.pendingStreet = name; this.pendingT = 0; }
      else this.pendingT += 0.3;
      if (name && name !== this.lastStreet && this.pendingT >= 0.6) {
        this.lastStreet = name;
        this.hud.street(name, `${area || city.name}${hit?.edge.tunnel ? ' · Tunnel' : hit?.edge.bridge ? ' · Bridge' : ''}`);
      }
    }
    // landmark discovery
    const found = new Set(this.session.get<string[]>(`found.${city.id}`, []));
    for (const l of w.landmarks) {
      if (found.has(l.def.id)) continue;
      if (Math.hypot(l.x - p.x, l.z - p.z) < 160) {
        found.add(l.def.id);
        this.session.set(`found.${city.id}`, [...found]);
        this.hud.toast(`Discovered · ${l.def.name}`, `${found.size}/${city.landmarks.length} landmarks in ${city.name}`, 'discovery');
      }
    }
  }

  private updateDebug(dt: number) {
    const on = this.debugOn || this.settings.showFps;
    this.debugTimer -= dt;
    if (!on) { this.hud.debug(null); return; }
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.25;
    const info = this.renderer.info;
    const w = this.world;
    const lines = [
      `FPS ${(1 / Math.max(dt, 1e-3)).toFixed(0)}  frame ${this.frameMs.toFixed(1)} ms`,
      `CPU sim ${this.simMs.toFixed(2)} ms  render ${this.renderMs.toFixed(2)} ms  GPU ${this.gpu.supported ? this.gpu.ms.toFixed(2) + ' ms' : 'n/a'}`,
      `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1e6).toFixed(2)} M  geos ${info.memory.geometries}  tex ${info.memory.textures}`,
      `res scale ${this.resScale.toFixed(2)}  quality ${this.settings.quality}`,
    ];
    if (w) {
      const p = w.renderPos;
      const t = w.vehicle.telemetry;
      lines.push(
        `chunks ${w.streamer?.loaded.size ?? 0} (+${w.streamer?.pendingCount ?? 0})  traffic ${w.traffic?.agents.length ?? 0}  particles ${w.smoke.active}`,
        `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}  tunnel ${w.inTunnel}`,
        `speed ${(t.speed * 3.6).toFixed(1)} km/h  rpm ${t.rpm.toFixed(0)}  gear ${t.gear}  slip ${(t.bodySlip * 57.3).toFixed(1)}°`,
        `activity ${w.activities?.active?.marker.name ?? '—'} ${w.activities?.active ? fmtTime(w.activities.activeTime()) : ''}`,
      );
    }
    this.hud.debug(lines.join('\n'));
  }

  // ------------------------------------------------------------ pause host
  private pauseHost(): PauseHost {
    const g = this;
    return {
      get settings() { return g.settings; },
      inGame: () => !!g.world && (g.state === 'paused' || g.state === 'drive'),
      cityName: () => g.currentCity?.name ?? 'Proving Ground',
      resume: () => g.resumeGame(),
      applySettings: () => g.applySettings(),
      setCamera: (m) => { if (g.world) { g.world.cam.setMode(m); g.prevCam = m; } },
      camera: () => g.world?.cam.mode ?? 'chase',
      hour: () => g.world?.hourTarget ?? 18,
      setHour: (h) => { if (g.world) { g.world.hourTarget = h; if (Math.abs(h - g.world.hour) > 12) g.world.hour = h; } },
      weather: () => g.world?.weather.kind ?? 'clear',
      setWeather: (wk) => { if (g.world) { g.world.weather.set(wk); if (wk === 'rain') g.lights.wipers = true; } },
      allowSnow: () => g.currentCity?.biome === 'alpine',
      marine: () => (g.currentCity?.marineLayer ? g.world?.marineOn ?? false : null),
      setMarine: (on) => { if (g.world) g.world.marineOn = on; },
      districts: () => (g.currentCity && g.world ? g.currentCity.districts.map((d) => ({ name: d.name, go: () => { const q = g.world!.proj!.toLocal(d.at.lat, d.at.lon); g.world!.teleport(q.x, q.z); } })) : []),
      activities: () => (g.world?.activities ? g.world.activities.markers.filter((m) => m.kind !== 'photo').map((m) => {
        const b = g.world!.activities!.best(m.id);
        const best = b === undefined ? 'No session best yet' : m.kind === 'drift' ? `Best ${Math.round(b).toLocaleString()} pts` : m.kind === 'speedTrap' ? `Best ${Math.round(b * (g.settings.units === 'mph' ? 2.23694 : 3.6))} ${g.settings.units === 'mph' ? 'mph' : 'km/h'}` : `Best ${fmtTime(b)}`;
        return { name: m.name, best, go: () => g.world!.teleport(m.x, m.z, m.heading) };
      }) : []),
      restartCar: () => g.world?.resetVehicle(),
      setPaint: (p) => { g.session.set(`paint.${g.def().id}`, p); g.world?.car.setPaint(p.color, p.matte); g.title.car.setPaint(p.color, p.matte); },
      paint: () => g.paintFor(g.def()).color,
      paints: () => g.def().paints,
      vehicles: () => AVAILABLE_VEHICLES.map((v) => ({ id: v.id, name: v.name, tagline: v.tagline })),
      vehicle: () => g.settings.vehicle,
      branded: () => g.def().branded,
      setVehicle: (id) => {
        g.settings.vehicle = id as VehicleId;
        const d = g.def();
        g.world?.swapVehicle(d, g.paintFor(d));
        g.title.setCar(d, g.paintFor(d));
        g.applySettings();
      },
      captureKey: () => g.input.captureNextKey(),
      resetSession: () => {
        g.session.reset();
        g.settings = defaultSettings();
        if (g.world && g.world.def.id !== g.def().id) g.world.swapVehicle(g.def(), g.paintFor(g.def()));
        g.world?.car.setPaint(g.paintFor(g.def()).color, g.paintFor(g.def()).matte);
        g.world?.activities?.ghosts.clear();
        g.lastStreet = '';
        g.applySettings();
        g.hud.toast('Session reset', 'All temporary data wiped', 'info');
      },
      citySelect: () => { g.disposeWorld(); g.go('select'); },
      quitToTitle: () => { g.disposeWorld(); g.go('title'); },
    };
  }

  private exposeDebug() {
    const g = this;
    // ?texdebug=1: remember where every GPU-uploaded texture came from, to hunt leaks
    const live = new Map<object, string>();
    if (new URLSearchParams(location.search).get('texdebug') === '1') {
      const add = Texture.prototype.addEventListener;
      Texture.prototype.addEventListener = function (this: Texture, type: string, fn: any) {
        if (type === 'dispose' && !live.has(this)) {
          live.set(this, `${this.constructor.name} ${(this.image as { width?: number } | undefined)?.width ?? ""}x${(this.image as { height?: number } | undefined)?.height ?? ""} ${(new Error().stack ?? '').split('\n').slice(2, 9).join(' <- ')}`);
          add.call(this, 'dispose', () => live.delete(this));
        }
        return add.call(this, type as any, fn);
      } as any;
    }
    (window as any).__cd = {
      get state() { return g.state; },
      get speed() { return g.world?.vehicle.telemetry.speed ?? 0; },
      get position() { const p = g.world?.renderPos; return p ? { x: p.x, y: p.y, z: p.z } : null; },
      get camera() { return g.world?.cam.mode ?? null; },
      /** Debug: colliders currently touching the chassis (surface, membership groups, body type). */
      contacts: () => {
        const w = g.world as any;
        if (!w) return [];
        const out: unknown[] = [];
        const col = w.vehicle.collider;
        w.physics.world.contactPairsWith(col, (o: any) => {
          let n = 0, depth = 0;
          const pts: number[][] = [];
          w.physics.world.contactPair(col, o, (m: any) => {
            n += m.numContacts();
            for (let i = 0; i < m.numContacts(); i++) {
              depth = Math.min(depth, m.contactDist(i));
              const p = m.localContactPoint1(i);
              if (pts.length < 3) pts.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
            }
          });
          if (n) out.push({ s: w.physics.surfaceOf(o), n, depth: +depth.toFixed(3), local: pts });
        });
        return out;
      },
      liveTextures: () => [...live.values()],
      get timing() { return { frames: g.frames, frameMs: Math.round(g.frameMs), simMs: +g.simMs.toFixed(1), renderMs: +g.renderMs.toFixed(1) }; },
      get camPos() { const c = g.world?.cam.camera; return c ? { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2), near: c.near, far: c.far } : null; },
      get chunks() { return g.world?.streamer?.loaded.size ?? 0; },
      get traffic() { return g.world?.traffic?.agents.length ?? 0; },
      /** QA: traffic agents by variant name (shows whether the Kenney fleet is in play). */
      get fleet() { return g.world?.variantCounts() ?? {}; },
      get lock() { return g.hud.lock.state; },
      /** QA: frame landmark i from a slow orbit (null restores the normal camera). */
      viewLandmark: (i: number | null, dist = 70, height = 18) => {
        const w = g.world;
        if (!w) return;
        if (i === null) { w.cam.override = null; return; }
        const lm = w.landmarks[i % w.landmarks.length];
        if (!lm) return;
        let t = 0;
        w.cam.override = (cam, dt) => {
          t += dt;
          const a = 2.2 + t * 0.05;
          cam.position.set(lm.x + Math.cos(a) * dist, lm.y + height, lm.z + Math.sin(a) * dist);
          cam.lookAt(lm.x, lm.y + lm.def.height * 0.5, lm.z);
          cam.fov = 45;
          cam.updateProjectionMatrix();
        };
      },
      /** QA: throw crash debris at the car as if it hit something head-on. */
      crash: (strength = 0.9) => { const w = g.world; if (!w) return; const p = w.renderPos; const f = new Vector3(0, 0, -1).applyQuaternion(w.renderQuat); w.crashDebris.spawn(strength, new Vector3(p.x + f.x * 2.4, p.y + 0.4, p.z + f.z * 2.4), f.setY(0).normalize(), new Vector3()); },
      get available() { return [...g.available]; },
      skipReveal: () => g.skipReveal(),
      get wheels() { return g.world?.vehicle.wheels.map((w) => ({ c: w.contact, s: w.surface, slip: +w.slip.toFixed(2), slide: +w.slideSpeed.toFixed(2), kappa: +w.slipRatio.toFixed(2), load: Math.round(w.load), om: +w.omega.toFixed(1), comp: +w.compression.toFixed(3) })) ?? []; },
      get input() { return g.world ? { ...(g.world as any).lastInput } : null; },
      get particles() { return g.world ? { smoke: g.world.smoke.active, sparks: g.world.sparks.active } : null; },
      get telemetry() { return g.world ? { ...g.world.vehicle.telemetry } : null; },
      get memory() { const m = g.renderer.info.memory; return { geometries: m.geometries, textures: m.textures }; },
      get pending() { return g.world?.streamer?.pendingCount ?? 0; },
      get inTunnel() { return g.world?.inTunnel ?? false; },
      get tunnelZones() { let n = 0; g.world?.streamer?.loaded.forEach((c: any) => (n += c.tunnelZones.length / 7)); return n; },
      get sceneGeometries() { const set = new Set<unknown>(); g.world?.scene.traverse((o: any) => { if (o.geometry) set.add(o.geometry); }); return set.size; },
      teleportDistrict: (i: number) => { const h = g.pauseHost(); const d = h.districts(); d[i % d.length]?.go(); },
      setWeather: (w: WeatherKind) => g.world?.weather.set(w),
      quitToTitle: () => { g.disposeWorld(); g.go('title'); },
      load: (city: string, time: TimePreset, weather: WeatherKind) => g.load(city, time, weather),
      timePresets: TIME_PRESETS,
    };
  }
}
