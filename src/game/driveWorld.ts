// One loaded drivable world (a California district or the proving ground) with every subsystem wired together.
import {
  BoxGeometry, BufferAttribute, RingGeometry, Color, ConeGeometry, Frustum, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Scene, Vector3, type WebGLRenderer,
} from 'three';
import { initPhysics, PhysicsWorld, G, type Surface } from '../physics/world.ts';
import { VehicleSim, type DriveInput } from '../physics/vehicle/vehicle.ts';
import type { VehicleConfig } from '../physics/vehicle/config.ts';
import { buildProvingGroundPhysics, PROVING_GROUND } from '../physics/provingGround.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { CarRig, Paint } from '../vehicle/carModel.ts';
import type { VehicleDef } from '../vehicle/vehicles.ts';
import { VehicleView } from '../vehicle/vehicleView.ts';
import { CameraRig, isInterior, type CameraMode } from '../camera/cameraRig.ts';
import { SkySystem } from '../render/sky.ts';
import { WeatherSystem } from '../render/weather.ts';
import { Materials } from '../render/materials.ts';
import { fogUniforms } from '../render/fog.ts';
import type { CityDef, TimePreset, WeatherKind } from '../world/cities.ts';
import type { DistrictData } from '../world/types.ts';
import { Heightfield } from '../world/heightfield.ts';
import { LocalProjection } from '../world/projection.ts';
import { RoadNetwork } from '../world/roadGraph.ts';
import { ChunkStreamer } from '../world/streaming.ts';
import { chunkOptionsFor } from '../world/district.ts';
import { buildLandmarks, type LandmarkInstance } from '../world/landmarks.ts';
import { setSignalColor } from '../world/props.ts';
import { TrafficSystem } from '../traffic/traffic.ts';
import { TrafficView } from '../traffic/trafficView.ts';
import { PedestrianSystem } from '../traffic/pedestrians.ts';
import { PedestrianView } from '../traffic/pedestrianView.ts';
import { SkidMarks } from '../vfx/skidmarks.ts';
import { Birds, CarShadow, LampLights, RainSplashes, WetStreaks, headlightBeamGeometry } from '../vfx/atmosphere.ts';
import { PointLight } from 'three';
import { ParticlePool } from '../vfx/particles.ts';
import { CrashDebris } from '../vfx/crashDebris.ts';
import { ActivityManager, type ActivityEvent, type PlayerSample } from '../activities/activities.ts';
import { ActivityVisuals } from '../activities/markers.ts';
import type { SessionStore } from '../core/session.ts';
import type { QualityProfile } from '../core/quality.ts';
import { TIME_PRESETS } from '../render/sky.ts';
import type { AudioFrame } from '../audio/audio.ts';
import { isResponding, trafficVariants } from '../vehicle/trafficModels.ts';
import { loadFleet, releaseFleetGPU, type FleetVariant } from '../vehicle/kenneyFleet.ts';
import { ROAD_LIFT } from '../world/chunkGen.ts';

export interface WorldSpec {
  city: CityDef | null;
  district: DistrictData | null;
  time: TimePreset;
  weather: WeatherKind;
}

export interface FrameInput {
  drive: DriveInput;
  lookBack: boolean;
  lookX: number;
  lookY: number;
  parkingBrake: boolean;
  activityPressed: boolean;
  paused: boolean;
  photo: boolean;
}

const _v = new Vector3();

export class DriveWorld {
  readonly scene = new Scene();
  readonly spec: WorldSpec;
  readonly physics: PhysicsWorld;
  vehicle: VehicleSim;
  cfg: VehicleConfig;
  car: CarRig;
  view: VehicleView;
  def: VehicleDef;
  readonly cam: CameraRig;
  readonly sky: SkySystem;
  readonly weather: WeatherSystem;
  readonly mats: Materials;
  readonly clock = new FixedStep(120);
  readonly hf: Heightfield | null;
  readonly proj: LocalProjection | null;
  readonly net: RoadNetwork | null;
  streamer: ChunkStreamer | null = null;
  traffic: TrafficSystem | null = null;
  trafficView: TrafficView | null = null;
  pedestrians: PedestrianSystem | null = null;
  pedestrianView: PedestrianView | null = null;
  activities: ActivityManager | null = null;
  activityVisuals: ActivityVisuals | null = null;
  landmarks: LandmarkInstance[] = [];
  private landmarkDispose: (() => void) | null = null;
  private landmarkUpdate: ((t: number, night: number) => void) | null = null;
  readonly skid: SkidMarks;
  readonly smoke: ParticlePool;
  readonly sparks: ParticlePool;
  readonly debris: ParticlePool;
  readonly crashDebris: CrashDebris;
  readonly carShadow: CarShadow;
  readonly lampLights: LampLights;
  readonly streaks: WetStreaks;
  readonly splashes: RainSplashes;
  readonly birds: Birds;
  private headBeams: Mesh[] = [];
  private flameLight: PointLight | null = null;
  private flameT = 0;
  /** Overrun crackles this frame (audio + flame VFX). */
  crackles: number[] = [];
  private birdAnchor: Vector3 | null = null;
  private birdTimer = 0;
  hour: number;
  hourTarget: number;
  marineOn: boolean;
  time = 0;
  inTunnel = false;
  private tunnelGrace = 0;
  /** 0 outside, 1 deep inside a tunnel (smoothed): occludes sun, sky and ambient light. */
  tunnelFactor = 0;
  envBase = 0.7;
  private prevPos = new Vector3();
  private curPos = new Vector3();
  private prevQuat = new Quaternion();
  private curQuat = new Quaternion();
  readonly renderPos = new Vector3();
  readonly renderQuat = new Quaternion();
  private lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  private resetTimer = 0;
  private signalTimer = 0;
  private impacts: { strength: number; x: number; y: number; z: number }[] = [];
  collidedThisFrame = false;
  private quality: QualityProfile;
  private session: SessionStore;
  events: ActivityEvent[] = [];
  private frustum = new Frustum();
  private projScreen = new Matrix4();
  private exhaustTimer = 0;
  accel = 0;
  private lastSpeed = 0;

  private constructor(spec: WorldSpec, renderer: WebGLRenderer, quality: QualityProfile, session: SessionStore, aspect: number, def: VehicleDef, paint: Paint) {
    const cfg: VehicleConfig = structuredClone(def.config);
    this.def = def;
    this.spec = spec;
    this.quality = quality;
    this.session = session;
    this.cfg = cfg;
    this.physics = new PhysicsWorld(120);
    this.mats = new Materials();
    this.sky = new SkySystem(renderer, this.scene);
    this.weather = new WeatherSystem(this.scene, quality.rainDrops);
    const city = spec.city;
    this.weather.marineEnabled = !!city?.marineLayer;
    this.marineOn = !!city?.marineLayer;
    this.weather.set(spec.weather, true);
    this.hour = this.hourTarget = TIME_PRESETS[spec.time];
    this.cam = new CameraRig(aspect);
    this.car = def.build(paint.color, paint.matte);
    this.scene.add(this.car.root);
    this.attachCarFx();
    this.cam.mounts = this.car.mounts;
    this.cam.tuning.chaseDistance = def.chase.distance;
    this.cam.tuning.chaseHeight = def.chase.height;
    this.view = new VehicleView(this.car);
    this.skid = new SkidMarks(this.scene);
    this.carShadow = new CarShadow(this.scene, this.mats.radial);
    this.lampLights = new LampLights(this.scene, 10);
    this.streaks = new WetStreaks(this.scene, 256);
    this.splashes = new RainSplashes(this.scene);
    this.birds = new Birds(this.scene);
    this.smoke = new ParticlePool(this.scene, 2000, false);
    this.sparks = new ParticlePool(this.scene, 400, true);
    this.debris = new ParticlePool(this.scene, 300, false);
    this.smoke.limit = quality.smokeParticles;
    this.crashDebris = new CrashDebris(this.scene, this.mats.parkedBody);
    this.crashDebris.setPaint(paint.color);

    if (spec.district && city) {
      const d = spec.district;
      this.hf = Heightfield.fromGrid(d.elevation);
      this.proj = new LocalProjection(d.origin);
      this.net = new RoadNetwork(d);
    } else {
      this.hf = null;
      this.proj = null;
      this.net = null;
    }
    // spawn
    const sp = this.spawnPoint();
    this.vehicle = new VehicleSim(this.physics, cfg, sp.x, sp.y, sp.z, sp.yaw);
    this.cam.attach(this.physics, this.vehicle.body);
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  static async create(spec: WorldSpec, renderer: WebGLRenderer, quality: QualityProfile, session: SessionStore, aspect: number, def: VehicleDef, paint: Paint, onProgress: (f: number, step: string) => void): Promise<DriveWorld> {
    await initPhysics();
    const w = new DriveWorld(spec, renderer, quality, session, aspect, def, paint);
    await w.buildWorld(onProgress);
    // compile every visible material now, so the first seconds of driving don't stall on shader builds
    onProgress(0.99, 'Warming up shaders…');
    try { await renderer.compileAsync(w.scene, w.cam.camera); } catch (e) { console.warn('shader warm-up skipped', e); }
    return w;
  }

  /** Headlight fog beams and an exhaust flame light, parented to the current car. */
  private attachCarFx() {
    this.headBeams = [];
    for (const spot of [this.car.spotL, this.car.spotR]) {
      const b = new Mesh(headlightBeamGeometry(), this.mats.headBeam);
      b.position.copy(spot.position);
      b.rotation.x = -0.05;
      b.renderOrder = 6;
      b.userData.noAO = true;
      b.frustumCulled = false;
      this.car.root.add(b);
      this.headBeams.push(b);
    }
    const ex = this.car.exhaust[0];
    this.flameLight = new PointLight(0xff8a3a, 0, 6, 2);
    this.flameLight.position.set(0, ex ? ex.position.y : -0.45, (ex ? ex.position.z : 2.3) + 0.3);
    this.car.root.add(this.flameLight);
  }

  /** Replace the player's car in place (same pose and velocity). */
  swapVehicle(def: VehicleDef, paint: Paint) {
    const old = this.vehicle;
    const t = old.body.translation();
    const lv = old.body.linvel();
    const yaw = old.yaw;
    const assists = { ...old.assists };
    old.dispose();
    this.car.root.removeFromParent();
    this.car.dispose();
    this.def = def;
    this.cfg = structuredClone(def.config);
    this.car = def.build(paint.color, paint.matte);
    this.scene.add(this.car.root);
    this.attachCarFx();
    this.crashDebris.setPaint(paint.color);
    this.view = new VehicleView(this.car);
    this.vehicle = new VehicleSim(this.physics, this.cfg, t.x, t.y + 0.15, t.z, yaw);
    this.vehicle.assists = assists;
    this.vehicle.body.setLinvel(lv, true);
    this.cam.attach(this.physics, this.vehicle.body);
    this.cam.mounts = this.car.mounts;
    this.cam.tuning.chaseDistance = def.chase.distance;
    this.cam.tuning.chaseHeight = def.chase.height;
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
  }

  private async buildWorld(onProgress: (f: number, step: string) => void) {
    const spec = this.spec;
    if (!spec.district || !spec.city) {
      this.buildProvingGround();
      onProgress(1, 'Proving ground ready');
      return;
    }
    const d = spec.district;
    const city = spec.city;
    // Kenney CC0 fleet (traffic + parked civilians); must be ready before chunks place parked cars
    onProgress(0.03, 'Loading vehicle fleet…');
    await Promise.race([loadFleet(), new Promise((r) => setTimeout(r, 8000))]);
    onProgress(0.05, 'Building terrain, roads and buildings…');
    this.streamer = new ChunkStreamer(this.scene, d, chunkOptionsFor(city, this.quality.treeDensity), this.mats, this.physics);
    this.streamer.radius = this.quality.chunkRadius;
    this.streamer.shadows = this.quality.shadows;
    const p = this.vehicle.position;
    await this.streamer.preload(p.x, p.z, (f) => onProgress(0.05 + f * 0.75, 'Streaming district chunks…'));
    onProgress(0.82, 'Placing landmarks…');
    const lm = buildLandmarks(city, this.proj!, this.hf!, this.mats, this.physics, d.waterY);
    this.scene.add(lm.group);
    this.landmarks = lm.instances;
    this.landmarkDispose = lm.dispose;
    this.landmarkUpdate = lm.update;
    // water
    if (d.waterY !== null) {
      const water = new Mesh(new PlaneGeometry(24000, 24000).rotateX(-Math.PI / 2), this.mats.water);
      water.position.y = d.waterY;
      water.receiveShadow = true;
      water.name = 'water';
      this.scene.add(water);
    }
    // world bounds
    const b = d.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hx = (b.maxX - b.minX) / 2 + 20, hz = (b.maxZ - b.minZ) / 2 + 20;
    for (const [x, z, sx, sz] of [[cx, b.minZ - 20, hx, 2], [cx, b.maxZ + 20, hx, 2], [b.minX - 20, cz, 2, hz], [b.maxX + 20, cz, 2, hz]] as const) {
      this.physics.addStaticCuboid(x, 0, z, sx, 600, sz, 0, G.BOUNDS, 'wall');
    }
    onProgress(0.9, 'Spawning traffic…');
    const vars = trafficVariants();
    this.traffic = new TrafficSystem(this.net!, {
      cap: Math.round(this.quality.trafficCap * city.trafficProfile.density),
      spawnMin: 60, spawnMax: 330, despawn: 420, speedFactor: city.trafficProfile.speedFactor,
      variantDims: vars.map((v) => {
        const spec = (v as FleetVariant).spec;
        let weight = v.weight ?? 1;
        if (spec?.notIn?.includes(city.biome)) weight = 0;
        if (spec?.file === 'taxi' && city.biome === 'urban') weight *= 1.5;
        return { length: v.length, width: v.width, height: v.height, weight };
      }),
      isVisible: (x, y, z) => this.frustum.containsPoint(_v.set(x, y, z)),
    }, this.physics, Math.floor(Math.random() * 1e6));
    this.trafficView = new TrafficView(this.scene, this.mats, 48);
    if (city.biome !== 'alpine') {
      const traffic = this.traffic;
      this.pedestrians = new PedestrianSystem(this.net!, {
        cap: this.quality.pedestrians, spawnMin: 18, spawnMax: 110, despawn: 150,
        isVisible: (x, y, z) => this.frustum.containsPoint(_v.set(x, y, z)),
        canCross: (node, edge) => {
          const st = traffic.signals.state(node, edge);
          if (st !== null) return st === 0;
          const n = this.net!.nodes[node];
          for (const a of traffic.agents) if (Math.abs(a.x - n.x) < 16 && Math.abs(a.z - n.z) < 16) return false;
          return true;
        },
      }, Math.floor(Math.random() * 1e6));
      this.pedestrianView = new PedestrianView(this.scene, this.mats, 60);
    }
    this.activities = new ActivityManager(city, this.net!, this.proj!, this.session, (x, z) => this.groundY(x, z));
    this.activityVisuals = new ActivityVisuals(this.scene, this.activities, () => this.def.build('#4fd1ff'));
    onProgress(1, 'Ready');
  }

  private buildProvingGround() {
    buildProvingGroundPhysics(this.physics);
    const L = PROVING_GROUND;
    const pad = new Mesh(new PlaneGeometry(L.size, L.size, 1, 1).rotateX(-Math.PI / 2), this.mats.road);
    pad.receiveShadow = true;
    this.scene.add(pad);
    // grass apron and a ring of distant hills soften the horizon
    const grass = new Mesh(new PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x4c5e34, roughness: 1 }));
    grass.position.y = -0.04;
    grass.receiveShadow = true;
    this.scene.add(grass);
    const hills = new RingGeometry(2600, 5200, 96, 6).rotateX(-Math.PI / 2);
    const hp = hills.getAttribute('position');
    const hc = new Float32Array(hp.count * 3);
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), z = hp.getZ(i);
      const r = Math.hypot(x, z), a = Math.atan2(z, x);
      const env = Math.sin(((r - 2600) / 2600) * Math.PI);
      const h = env * (120 + 90 * Math.sin(a * 5) + 60 * Math.sin(a * 13 + 1.3) + 30 * Math.sin(a * 29));
      hp.setY(i, Math.max(0, h));
      const g = 0.25 + 0.1 * Math.sin(a * 7);
      hc.set([0.28 * g * 2.2, 0.32 * g * 2.2, 0.2 * g * 2.2], i * 3);
    }
    hills.setAttribute('color', new BufferAttribute(hc, 3));
    hills.computeVertexNormals();
    this.scene.add(new Mesh(hills, this.mats.terrain));
    // skid pad ring + light towers
    const ringMat = new MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    for (const r of [35, 36]) {
      const ring = new Mesh(new RingGeometry(r, r + 0.3, 96).rotateX(-Math.PI / 2), ringMat);
      ring.position.set(-250, 0.02, 150);
      this.scene.add(ring);
    }
    for (const [x, z] of [[-400, -400], [400, -400], [-400, 400], [400, 400]]) {
      const tower = new Mesh(new BoxGeometry(1, 30, 1), this.mats.pole);
      tower.position.set(x, 15, z);
      tower.castShadow = true;
      const head = new Mesh(new BoxGeometry(5, 1.5, 1.5), this.mats.lampHead);
      head.position.set(x, 30, z);
      this.scene.add(tower, head);
    }
    // painted skid pad circles + start grid lines
    const paint = new MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    for (let i = -10; i <= 10; i++) {
      const line = new Mesh(new BoxGeometry(0.25, 0.02, 400), paint);
      line.position.set(i * 12, 0.01, -200);
      line.receiveShadow = true;
      this.scene.add(line);
    }
    const r = L.ramp;
    const ramp = new Mesh(new BoxGeometry(r.width, 0.3, Math.hypot(r.length, r.height)), new MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.8 }));
    ramp.position.set(r.x, r.height / 2, r.z);
    ramp.rotation.x = Math.atan2(r.height, r.length);
    ramp.castShadow = ramp.receiveShadow = true;
    this.scene.add(ramp);
    const coneMat = new MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });
    for (const c of L.cones) {
      const cone = new Mesh(new ConeGeometry(0.3, 0.8, 12).translate(0, 0.4, 0), coneMat);
      cone.position.set(c.x, 0, c.z);
      cone.castShadow = true;
      this.scene.add(cone);
    }
  }

  groundY(x: number, z: number): number {
    if (!this.hf) return 0;
    const t = this.hf.sample(x, z);
    const w = this.spec.district?.waterY;
    return w !== null && w !== undefined ? Math.max(t, w) : t;
  }

  spawnPoint(): { x: number; y: number; z: number; yaw: number } {
    const city = this.spec.city;
    if (!city || !this.net || !this.proj) return { x: PROVING_GROUND.ramp.x, y: 0.8, z: 40, yaw: 0 };
    const s = this.proj.toLocal(city.spawn.lat, city.spawn.lon);
    const hit = this.net.nearest(s.x, s.z, 300, (e) => !e.tunnel && !e.bridge && e.cls !== 'service');
    if (!hit) return { x: s.x, y: this.groundY(s.x, s.z) + 1, z: s.z, yaw: 0 };
    let heading = hit.heading;
    if (city.spawnHeading) {
      const t = this.proj.toLocal(city.spawnHeading.lat, city.spawnHeading.lon);
      const want = Math.atan2(t.x - hit.x, -(t.z - hit.z));
      let d = want - heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > Math.PI / 2) heading += Math.PI;
    }
    // drive on the right: offset into the right-hand lane
    const off = hit.edge.lf > 0 && hit.edge.lb > 0 ? 2.2 : 0;
    const x = hit.x + Math.cos(heading) * off, z = hit.z + Math.sin(heading) * off;
    return { x, y: hit.y + ROAD_LIFT + 0.85, z, yaw: -heading };
  }

  /** Reset onto the nearest road, keeping roughly the current direction. */
  resetVehicle() {
    const p = this.vehicle.position;
    if (!this.net) {
      this.vehicle.reset(p.x, 0.9, p.z, this.vehicle.yaw);
    } else {
      const hit = this.net.nearest(p.x, p.z, 400, (e) => !e.tunnel) ?? this.net.nearest(p.x, p.z, 4000, (e) => !e.tunnel);
      if (!hit) return;
      let heading = hit.heading;
      let d = -this.vehicle.yaw - heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > Math.PI / 2) heading += Math.PI;
      const y = (hit.edge.bridge ? hit.y : Math.max(hit.y, this.groundY(hit.x, hit.z))) + ROAD_LIFT + 0.9;
      this.vehicle.reset(hit.x, y, hit.z, -heading);
    }
    this.vehicle.setIgnoreTerrain(false);
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.skid.add(0, _v, _v, 0); this.skid.add(1, _v, _v, 0); this.skid.add(2, _v, _v, 0); this.skid.add(3, _v, _v, 0);
    this.resetTimer = 0;
  }

  teleport(x: number, z: number, heading?: number, allowTunnel = false) {
    if (!this.net) return;
    const hit = this.net.nearest(x, z, 300, (e) => allowTunnel || !e.tunnel);
    if (!hit) return;
    const h = heading ?? hit.heading;
    this.vehicle.reset(hit.x, (hit.edge.tunnel || hit.edge.bridge ? hit.y : Math.max(hit.y, this.groundY(hit.x, hit.z))) + ROAD_LIFT + 0.9, hit.z, -h);
    if (hit.edge.tunnel) { this.vehicle.setIgnoreTerrain(true); this.tunnelGrace = 3; }
    this.snapshot();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.streamer?.update(hit.x, hit.z, 6);
    this.traffic?.clear();
    this.pedestrians?.clear();
  }

  private snapshot() {
    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
  }

  applyQuality(q: QualityProfile, trafficDensity: number) {
    this.quality = q;
    if (this.streamer) { this.streamer.radius = q.chunkRadius; this.streamer.shadows = q.shadows; }
    if (this.traffic && this.spec.city) this.traffic.opts.cap = Math.round(q.trafficCap * this.spec.city.trafficProfile.density * trafficDensity);
    this.smoke.limit = q.smokeParticles;
    this.weather.setDensity(q.rainDrops / 16000);
  }

  setCameraMode(m: CameraMode) {
    this.cam.setMode(m);
  }

  /** Simulation + presentation update for one rendered frame. */
  update(dt: number, inp: FrameInput, sim: boolean) {
    this.time += dt;
    this.events = [];
    this.collidedThisFrame = false;
    const veh = this.vehicle;
    if (sim) {
      const drive = { ...inp.drive };
      if (inp.parkingBrake && veh.telemetry.speed < 1.5) drive.handbrake = 1;
      this.lastInput = drive;
      this.traffic?.syncBodies();
      const n = this.clock.advance(dt);
      for (let i = 0; i < n; i++) {
        this.prevPos.copy(this.curPos);
        this.prevQuat.copy(this.curQuat);
        veh.step(drive, this.physics.dt);
        this.physics.step();
        this.snapshot();
        drive.gearUp = drive.gearDown = false;
        this.physics.events.drainContactForceEvents((e) => {
          const c1 = e.collider1(), c2 = e.collider2();
          if (c1 !== veh.collider.handle && c2 !== veh.collider.handle) return;
          const mag = e.totalForceMagnitude();
          const dir = e.maxForceDirection();
          const p = veh.body.translation();
          this.impacts.push({ strength: Math.min(1, mag / 90000), x: p.x - dir.x * 1.5, y: p.y, z: p.z - dir.z * 1.5 });
        });
      }
      const a = this.clock.alpha;
      this.renderPos.copy(this.prevPos).lerp(this.curPos, a);
      this.renderQuat.copy(this.prevQuat).slerp(this.curQuat, a);
      const spd = veh.telemetry.forwardSpeed;
      this.accel = this.accel * 0.9 + ((spd - this.lastSpeed) / Math.max(dt, 1e-3)) * 0.1;
      this.lastSpeed = spd;
    } else {
      this.renderPos.copy(this.curPos);
      this.renderQuat.copy(this.curQuat);
    }
    const pos = this.renderPos;

    // tunnels: wheel rays and chassis ignore terrain inside tunnel corridors
    if (this.streamer) {
      this.tunnelGrace = Math.max(0, this.tunnelGrace - dt);
      this.inTunnel = this.streamer.inTunnel(pos.x, pos.y, pos.z) || this.tunnelGrace > 0;
      veh.setIgnoreTerrain(this.inTunnel);
    }
    // fell off the world / into the water
    const waterY = this.spec.district?.waterY ?? null;
    const underground = !this.inTunnel && pos.y < (this.hf ? this.hf.sample(pos.x, pos.z) - 8 : -20);
    const lost = (waterY !== null && pos.y < waterY - 0.6 && !this.inTunnel) || underground || (veh.isFlipped() && veh.telemetry.speed < 1);
    this.resetTimer = lost ? this.resetTimer + dt : 0;
    if (lost && waterY !== null && pos.y < waterY - 0.6 && this.resetTimer < dt * 2) {
      for (let i = 0; i < 40; i++) this.smoke.emit({ pos: _v.set(pos.x, waterY + 0.3, pos.z), vel: new Vector3(0, 4, 0), spread: 6, life: 1.2, size: 1.2, grow: 2, color: new Color(0.85, 0.9, 0.95), alpha: 0.6, gravity: 6, drag: 1 });
    }
    if (this.resetTimer > (veh.isFlipped() ? 3 : 1.4)) {
      this.resetVehicle();
      this.events.push({ kind: 'toast', title: 'Vehicle reset', sub: 'Back on the road', tone: 'info' });
    }

    // streaming & traffic
    if (this.streamer) this.streamer.update(pos.x, pos.z, 1);
    const cam = this.cam.camera;
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    if (this.traffic && sim) {
      const lv = veh.body.linvel();
      this.traffic.update(dt, { x: pos.x, y: pos.y, z: pos.z, vx: lv.x, vz: lv.z, heading: -veh.yaw });
    }
    if (this.trafficView && this.traffic) this.trafficView.update(this.traffic, this.sky.night, dt);
    if (this.pedestrians && this.pedestrianView) {
      const atm = this.weather.state;
      this.pedestrians.opts.cap = Math.round(this.quality.pedestrians * (1 - atm.rain * 0.6 - atm.snow * 0.5) * (1 - this.sky.night * 0.45));
      if (sim) {
        const lv = veh.body.linvel();
        this.pedestrians.update(dt, { x: pos.x, y: pos.y, z: pos.z, vx: lv.x, vz: lv.z, heading: -veh.yaw });
      }
      this.pedestrianView.update(this.pedestrians);
    }
    this.signalTimer -= dt;
    if (this.signalTimer <= 0 && this.streamer && this.traffic) {
      this.signalTimer = 0.25;
      const c = new Color();
      for (const ref of this.streamer.allSignals()) {
        const st = this.traffic.signals.state(ref.node, ref.edge);
        if (st !== null) setSignalColor(ref, st, c);
      }
    }

    // impacts → sparks/shake/audio events
    for (const im of this.impacts) {
      if (im.strength < 0.08) continue;
      this.collidedThisFrame = true;
      this.cam.shake(im.strength * 0.8);
      for (let i = 0; i < 18 * im.strength + 4; i++) {
        this.sparks.emit({ pos: _v.set(im.x, im.y, im.z), vel: new Vector3((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8), spread: 2, life: 0.45, size: 0.09, grow: -0.1, color: new Color(1.6, 0.8, 0.3), alpha: 1, gravity: 9.8, drag: 0.5 });
      }
      if (im.strength > 0.3) {
        const cp = this.renderPos, lv0 = veh.body.linvel();
        const away = new Vector3(im.x - cp.x, 0, im.z - cp.z);
        if (away.lengthSq() < 1e-4) away.set(0, 0, -1);
        this.crashDebris.spawn(im.strength, new Vector3(im.x, im.y, im.z), away.normalize(), new Vector3(lv0.x, 0, lv0.z));
      }
      for (let i = 0; i < 14 * im.strength + 2; i++) {
        this.debris.emit({ pos: _v.set(im.x, im.y - 0.2, im.z), vel: new Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6), spread: 1.5, life: 1.3, size: 0.07, grow: 0, color: new Color(0.13, 0.13, 0.14), alpha: 0.95, gravity: 9.8, drag: 0.4 });
      }
    }
    const impactsOut = this.impacts.filter((i) => i.strength >= 0.08);
    this.impacts = [];

    // camera
    const lv = veh.body.linvel();
    const surface = veh.wheels.find((w) => w.contact)?.surface ?? 'asphalt';
    this.cam.update({
      dt, pos, quat: this.renderQuat, vel: _v.set(lv.x, lv.y, lv.z).clone(), speed: veh.telemetry.speed, yawRate: veh.telemetry.yawRate,
      steer: veh.steerAngle, accel: this.accel, lookBack: inp.lookBack, lookX: inp.lookX, lookY: inp.lookY,
      roughness: surface === 'cobble' ? 1 : surface === 'dirt' || surface === 'grass' || surface === 'terrain' ? 0.7 : 0.05,
    });
    this.view.interiorVisible = isInterior(this.cam.mode);
    this.view.update(dt, veh, pos, this.renderQuat, this.lastInput.brake * (veh.gearbox.gear === -1 ? 0 : 1) + (veh.gearbox.gear === -1 ? this.lastInput.throttle : 0), this.lastInput.steer);

    // vfx: skid marks, smoke, dust, spray, exhaust
    this.updateVfx(dt, surface);
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
    this.crashDebris.update(dt, (x, z) => this.groundY(x, z));
    this.landmarkUpdate?.(this.time, this.sky.night);
    this.debris.setFog(this.sky.fog.color, this.sky.fog.density);
    this.smoke.setFog(this.sky.fog.color, this.sky.fog.density);

    // sky, weather, materials
    this.hour += (this.hourTarget - this.hour) * Math.min(1, dt * 1.2);
    const marineCycle = 0.55 + 0.45 * Math.sin(this.time / 70);
    this.weather.marineEnabled = this.marineOn;
    this.weather.update(dt, cam.position, _v.set(lv.x, lv.y, lv.z), marineCycle);
    const atm = this.weather.state;
    this.sky.update(dt, this.hour, atm, pos, this.quality.shadowExtent);
    fogUniforms.uMarineFront.value = this.weather.kind === 'fog' ? 4000 : -1500 + marineCycle * 1300;
    this.scene.environment = this.sky.envMap;
    this.tunnelFactor += ((this.inTunnel ? 1 : 0) - this.tunnelFactor) * Math.min(1, dt * 2.5);
    const tf = this.tunnelFactor;
    this.sky.sun.intensity *= 1 - 0.97 * tf;
    this.sky.hemi.intensity *= 1 - 0.8 * tf;
    this.scene.environmentIntensity = this.envBase * (1 - 0.85 * tf);
    this.mats.update(this.time, atm.wet, this.sky.night, atm.snow, atm.rain);
    this.updateAtmosphere(dt, pos);
    this.vehicle.gripScale = 1 - atm.wet * 0.18 - atm.snow * 0.35;
    // activities
    if (this.activities && sim) {
      const ps: PlayerSample = {
        x: pos.x, y: pos.y, z: pos.z, speed: veh.telemetry.speed, heading: -veh.yaw, bodySlip: veh.telemetry.bodySlip,
        onGround: veh.telemetry.wheelsOnGround >= 2, collided: this.collidedThisFrame, quat: this.renderQuat,
      };
      this.events.push(...this.activities.update(dt, ps, inp.activityPressed));
    }
    this.activityVisuals?.update(dt, this.activities!, (x, z) => this.groundY(x, z) + ROAD_LIFT, pos);
    return impactsOut;
  }

  private updateAtmosphere(dt: number, pos: Vector3) {
    const atm = this.weather.state;
    const night = this.sky.night;
    const veh = this.vehicle;
    // contact shadow under the hero car
    let gy = 0, gn = 0;
    for (const w of veh.wheels) if (w.contact) { gy += w.contactPoint.y; gn++; }
    const ground = gn ? gy / gn : this.groundY(pos.x, pos.z);
    this.carShadow.update(pos.x, ground, pos.z, -this.vehicle.yaw, gn ? 0 : Math.max(0, pos.y - 0.75 - ground));
    // fog density drives how visible light shafts are
    const fogF = Math.min(1.3, Math.max(0.12, this.sky.fog.density * 320 + atm.marine * 0.5 + atm.rain * 0.45 + atm.fog * 0.6));
    this.mats.lampBeam.uniforms.uStrength.value = night * fogF * 0.32 * (1 - this.tunnelFactor);
    const headOn = this.car.spotL.intensity > 0 ? 1 : 0;
    this.mats.headBeam.uniforms.uStrength.value = headOn * (0.15 + night * 0.85) * fogF * 0.42;
    // invisible shafts still rasterize two large double-sided cones per light: skip them entirely
    this.mats.lampBeam.visible = this.mats.lampBeam.uniforms.uStrength.value > 0.015;
    this.mats.headBeam.visible = this.mats.headBeam.uniforms.uStrength.value > 0.015;
    // real point lights at the nearest lamps
    const heads = this.streamer ? this.streamer.lampHeadsNear(pos.x, pos.z, 140) : [];
    this.lampLights.update(dt, heads, pos.x, pos.z, night, this.quality.pointLights);
    // wet-road streaks: lamps, traffic lights, our own lights
    const src: number[] = [];
    if (atm.wet > 0.05) {
      if (night > 0.3) for (let i = 0; i < heads.length; i += 3) src.push(heads[i], heads[i + 1] - 8.1, heads[i + 2], 1.0, 0.68, 0.38, 1.1);
      if (this.traffic) for (const a of this.traffic.agents) {
        if (Math.hypot(a.x - pos.x, a.z - pos.z) > 110) continue;
        const fx = Math.sin(a.heading), fz = -Math.cos(a.heading);
        if (night > 0.3) src.push(a.x + fx * 2.4, a.y, a.z + fz * 2.4, 0.9, 0.92, 1.0, 0.7);
        if (night > 0.3 || a.braking) src.push(a.x - fx * 2.4, a.y, a.z - fz * 2.4, 1.0, 0.08, 0.05, a.braking ? 0.9 : 0.5);
      }
      if (headOn) {
        const f = new Vector3(0, 0, -1).applyQuaternion(this.renderQuat);
        src.push(pos.x + f.x * 2.6, ground, pos.z + f.z * 2.6, 0.9, 0.92, 1.0, 0.8);
        src.push(pos.x - f.x * 2.4, ground, pos.z - f.z * 2.4, 1.0, 0.08, 0.05, 0.6);
      }
    }
    this.streaks.update(src, atm.wet * (0.3 + night));
    this.splashes.update(this.time, new Vector3(pos.x, ground, pos.z), atm.rain);
    // birds: over the nearest water (coast) or high over the valley (alpine)
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && this.hf) {
      this.birdTimer = 6;
      const wy = this.spec.district?.waterY ?? null;
      this.birdAnchor = null;
      if (wy !== null) {
        for (let a = 0; a < 16 && !this.birdAnchor; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const x = pos.x + Math.cos(ang) * 180, z = pos.z + Math.sin(ang) * 180;
          if (this.hf.sample(x, z) < wy - 1) this.birdAnchor = new Vector3(x, wy, z);
        }
      } else if (this.spec.city?.biome === 'alpine') this.birdAnchor = new Vector3(pos.x + 80, pos.y + 20, pos.z - 60);
    }
    this.birds.update(this.time, pos, this.birdAnchor, 1 - night);
    // smoke takes the colour of the light (orange at golden hour, blue-grey at night)
    const sun = this.sky.sun, hemi = this.sky.hemi;
    const lc = new Color().copy(sun.color).multiplyScalar(Math.min(1.2, sun.intensity * 0.32)).add(new Color().copy(hemi.color).multiplyScalar(hemi.intensity * 0.9));
    this.smoke.setLight(lc);
    this.debris.setLight(lc);
    // exhaust flame light decay
    this.flameT = Math.max(0, this.flameT - dt * 9);
    if (this.flameLight) this.flameLight.intensity = this.flameT * 18 * (0.4 + night);
  }

  private updateVfx(dt: number, _surface: Surface) {
    const veh = this.vehicle;
    const atm = this.weather.state;
    const right = _v.set(1, 0, 0).applyQuaternion(this.renderQuat).clone();
    for (let i = 0; i < 4; i++) {
      const w = veh.wheels[i];
      const hard = w.surface === 'asphalt' || w.surface === 'concrete' || w.surface === 'cobble';
      const sliding = w.contact && w.slideSpeed > 2.2 && w.slip > 1.0;
      const intensity = sliding && hard ? Math.min(1, (w.slideSpeed - 2) / 8) : 0;
      this.skid.add(i, w.contactPoint, right, intensity * (1 - atm.wet * 0.6));
      if (!w.contact) continue;
      const p = w.contactPoint;
      if (sliding && hard && atm.wet < 0.5 && w.slideSpeed > 4.5 && Math.random() < 0.5 * Math.min(1, w.slideSpeed / 12)) {
        this.smoke.emit({ pos: new Vector3(p.x, p.y + 0.25, p.z), vel: new Vector3((Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5), spread: 1.2, life: 1.8, size: 0.35, grow: 0.9, color: new Color(0.82, 0.82, 0.84), alpha: 0.2, gravity: -0.4, drag: 1.2 });
      }
      if (!hard && veh.telemetry.speed > 4 && Math.random() < 0.35) {
        this.smoke.emit({ pos: new Vector3(p.x, p.y + 0.2, p.z), vel: new Vector3(0, 1, 0), spread: 1.5, life: 1.8, size: 0.7, grow: 2, color: new Color(0.55, 0.47, 0.36), alpha: 0.35, gravity: -0.2, drag: 1.5 });
      }
      if (atm.wet > 0.35 && hard && veh.telemetry.speed > 9 && !this.cfg.wheels[i].front && Math.random() < 0.7) {
        const lv = veh.body.linvel();
        this.smoke.emit({ pos: new Vector3(p.x, p.y + 0.15, p.z), vel: new Vector3(-lv.x * 0.15, 1.5, -lv.z * 0.15), spread: 1.6, life: 0.7, size: 0.5, grow: 2.5, color: new Color(0.75, 0.8, 0.85), alpha: 0.3 * atm.wet, gravity: 3, drag: 2 });
      }
    }
    // overrun crackle → exhaust flames
    this.crackles = [];
    const tm = veh.telemetry;
    const turbo = this.def.sound.turbo;
    if (veh.engineOn && tm.throttle < 0.05 && tm.rpm > 4200 && Math.random() < (turbo ? 0.08 : 0.18) * dt * 60) {
      const level = 0.12 + Math.random() * 0.15;
      this.crackles.push(level);
      this.flameT = 1;
      const back = new Vector3(0, 0, 1).applyQuaternion(this.renderQuat);
      const blue = Math.random() < 0.3;
      for (const e of this.car.exhaust) {
        const wp = e.getWorldPosition(new Vector3());
        for (let k = 0; k < 3; k++) this.sparks.emit({ pos: wp.clone(), vel: back.clone().multiplyScalar(3 + Math.random() * 2), spread: 0.6, life: 0.12, size: 0.16 + Math.random() * 0.08, grow: 0.6, color: blue ? new Color(0.5, 0.75, 2.2) : new Color(2.2, 0.9, 0.3), alpha: 1, gravity: 0, drag: 2 });
      }
    }
    // snow spray and traffic spray
    if (atm.snow > 0.3 && tm.speed > 5) {
      for (const w of veh.wheels) if (w.contact && Math.random() < 0.4) {
        const p = w.contactPoint;
        this.smoke.emit({ pos: new Vector3(p.x, p.y + 0.15, p.z), vel: new Vector3(0, 1.5, 0), spread: 1.8, life: 0.9, size: 0.3, grow: 1.6, color: new Color(0.95, 0.96, 1.0), alpha: 0.45 * atm.snow, gravity: 2.5, drag: 2 });
      }
    }
    if (atm.wet > 0.35 && this.traffic) {
      const pp = this.renderPos;
      for (const a of this.traffic.agents) {
        if (a.v < 8 || Math.random() > 0.35 || Math.hypot(a.x - pp.x, a.z - pp.z) > 45) continue;
        const fx = Math.sin(a.heading), fz = -Math.cos(a.heading);
        this.smoke.emit({ pos: new Vector3(a.x - fx * 2.2, a.y + 0.3, a.z - fz * 2.2), vel: new Vector3(-fx * 2, 1.2, -fz * 2), spread: 1.4, life: 0.6, size: 0.45, grow: 2.2, color: new Color(0.75, 0.8, 0.85), alpha: 0.25 * atm.wet, gravity: 3, drag: 2 });
      }
    }
    // exhaust vapour (cold nights / idle)
    this.exhaustTimer -= dt;
    if (veh.engineOn && this.exhaustTimer <= 0 && (this.sky.night > 0.5 || atm.rain > 0.3 || atm.snow > 0.3) && veh.telemetry.speed < 12) {
      this.exhaustTimer = 0.08;
      for (const e of this.car.exhaust) {
        const wp = e.getWorldPosition(new Vector3());
        const back = new Vector3(0, 0, 1).applyQuaternion(this.renderQuat);
        this.smoke.emit({ pos: wp, vel: back.multiplyScalar(1.2 + veh.telemetry.throttle * 2), spread: 0.3, life: 0.9, size: 0.1, grow: 0.5, color: new Color(0.8, 0.8, 0.82), alpha: 0.08 + veh.telemetry.throttle * 0.06, gravity: -0.3, drag: 1.5 });
      }
    }
  }

  audioFrame(dt: number, urban: number, coastal: number, forest: number): AudioFrame {
    const veh = this.vehicle;
    let slip = 0, slide = 0;
    let surface: Surface = 'asphalt';
    for (const w of veh.wheels) if (w.contact) { slip = Math.max(slip, w.slip); slide = Math.max(slide, w.slideSpeed); surface = w.surface; }
    const traffic: AudioFrame['traffic'] = [];
    let siren: AudioFrame['siren'] = null;
    if (this.traffic) {
      const cam = this.cam.camera;
      const p = this.renderPos;
      const lv = veh.body.linvel();
      const camRight = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const near = this.traffic.agents.map((a) => ({ a, d: Math.hypot(a.x - p.x, a.z - p.z) })).sort((x, y) => x.d - y.d).slice(0, 3);
      for (const { a, d } of near) {
        const dx = a.x - p.x, dz = a.z - p.z;
        const l = Math.max(0.1, Math.hypot(dx, dz));
        const avx = Math.sin(a.heading) * a.v, avz = -Math.cos(a.heading) * a.v;
        const closing = ((lv.x - avx) * dx + (lv.z - avz) * dz) / l;
        traffic.push({ d, closing, pan: (dx * camRight.x + dz * camRight.z) / l });
      }
      const vars = trafficVariants();
      let best = Infinity;
      for (const a of this.traffic.agents) {
        const kind = vars[a.variant % vars.length]?.emergency;
        if (!kind || !isResponding(a.id, kind)) continue;
        const dx = a.x - p.x, dz = a.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= best) continue;
        best = d;
        const l = Math.max(0.1, d);
        const avx = Math.sin(a.heading) * a.v, avz = -Math.cos(a.heading) * a.v;
        siren = { d, kind, closing: ((lv.x - avx) * dx + (lv.z - avz) * dz) / l, pan: (dx * camRight.x + dz * camRight.z) / l };
      }
    }
    return {
      dt, engineOn: veh.engineOn, rpm: veh.telemetry.rpm, throttle: veh.telemetry.throttle, load: veh.telemetry.load, limiter: veh.telemetry.limiter,
      speed: veh.telemetry.speed, slip, slideSpeed: slide, surface, interior: isInterior(this.cam.mode), inTunnel: this.inTunnel,
      rain: this.weather.state.rain, urban, coastal, forest, traffic, night: this.sky.night, siren,
    };
  }

  /** Traffic agents by variant name (QA). */
  variantCounts(): Record<string, number> {
    const v = trafficVariants();
    const out: Record<string, number> = {};
    for (const a of this.traffic?.agents ?? []) {
      const n = v[a.variant % v.length]?.name ?? '?';
      out[n] = (out[n] ?? 0) + 1;
    }
    return out;
  }

  /** Is anything traffic-like near the camera view? (for HUD minimap) */
  trafficPoints() {
    const vars = trafficVariants();
    return this.traffic?.agents.map((a) => {
      const kind = vars[a.variant % vars.length]?.emergency;
      return { x: a.x, z: a.z, emergency: kind && isResponding(a.id, kind) ? kind : undefined };
    }) ?? [];
  }

  dispose() {
    this.streamer?.dispose();
    this.traffic?.clear();
    this.trafficView?.dispose();
    releaseFleetGPU();
    this.pedestrians?.clear();
    this.pedestrianView?.dispose();
    this.activityVisuals?.dispose();
    this.landmarkDispose?.();
    this.skid.dispose();
    this.smoke.dispose();
    this.sparks.dispose();
    this.debris.dispose();
    this.crashDebris.dispose();
    this.carShadow.dispose();
    this.lampLights.dispose();
    this.streaks.dispose();
    this.splashes.dispose();
    this.birds.dispose();
    this.weather.dispose();
    this.sky.dispose();
    this.car.dispose();
    this.scene.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (g) g.dispose();
    });
    this.mats.dispose();
    this.physics.free();
  }
}
