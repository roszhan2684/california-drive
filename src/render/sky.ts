import {
  AdditiveBlending, BackSide, BufferAttribute, SphereGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight, FogExp2, HemisphereLight, Mesh,
  MeshBasicMaterial, PMREMGenerator, Points, PointsMaterial, Scene, Vector3, type Texture, type WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { TimePreset } from '../world/cities.ts';
import { fogUniforms } from './fog.ts';
import { rng } from '../world/geom.ts';

export const TIME_PRESETS: Record<TimePreset, number> = { dawn: 6.6, day: 13, golden: 19.2, dusk: 20.0, night: 22.5 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Scale the Preetham sky into a sane HDR range and clamp the sun disc (keeps bloom and the env map under control). */
function patchSky(sky: Sky, scale: number) {
  const m = sky.material as any;
  m.uniforms.skyScale = { value: scale };
  m.fragmentShader = m.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform float skyScale;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * skyScale, vec3( 18.0 ) ), 1.0 );');
  m.needsUpdate = true;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface AtmosphereState {
  cloud: number;
  fog: number;
  marine: number;
  rain: number;
  snow: number;
  wet: number;
}

/** Sun/moon, sky dome, fog colors and the PMREM environment map for a given hour. */
export class SkySystem {
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly sunDir = new Vector3();
  readonly fog: FogExp2;
  readonly stars: Points;
  hour = 18;
  /** 0 day .. 1 full night */
  night = 0;
  sunElevation = 0;
  private envScene = new Scene();
  private envSky: Sky;
  private envGlow: Mesh;
  private envCloud: Mesh | null = null;
  private pmrem: PMREMGenerator;
  private envRT: WebGLRenderTarget | null = null;
  private lastEnvKey = '';
  private envTimer = 0;
  envMap: Texture | null = null;
  readonly horizon = new Color();

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.sky = new Sky();
    patchSky(this.sky, 0.45);
    this.sky.scale.setScalar(9000);
    (this.sky.material as any).fog = false;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new HemisphereLight(0xbfd6ff, 0x5a5048, 0.6);
    scene.add(this.hemi);

    this.fog = new FogExp2(0xc8d0d8, 0.0012);
    scene.fog = this.fog;

    // stars
    const r = rng(42);
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const s = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * s * 4000, y * 4000, Math.sin(th) * s * 4000], i * 3);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(pos, 3));
    this.stars = new Points(sg, new PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // environment scene: sky + warm city glow ring for night reflections
    this.envSky = new Sky();
    patchSky(this.envSky, 0.45);
    this.envSky.scale.setScalar(900);
    (this.envSky.material as any).uniforms.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    this.envGlow = new Mesh(new CylinderGeometry(400, 400, 60, 32, 1, true), new MeshBasicMaterial({ color: 0x000000, side: BackSide, fog: false }));
    this.envGlow.position.y = 10;
    this.envScene.add(this.envGlow);
    this.pmrem = new PMREMGenerator(renderer);
  }

  /** Sun direction for an hour (summer-ish California arc: sunrise 06:12, sunset 19:48). */
  static sunDirection(hour: number, out = new Vector3()) {
    const RISE = 6.2, SET = 19.8;
    const h = ((hour % 24) + 24) % 24;
    let el: number, az: number;
    if (h >= RISE && h <= SET) {
      const t = (h - RISE) / (SET - RISE);
      el = Math.sin(t * Math.PI) * (70 * Math.PI / 180);
      az = (70 + t * 220) * Math.PI / 180;
    } else {
      const t = ((h - SET + 24) % 24) / (24 - (SET - RISE));
      el = -Math.sin(t * Math.PI) * 0.85;
      az = (290 + t * 140) * Math.PI / 180;
    }
    out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    return out.normalize();
  }

  update(dt: number, hour: number, atm: AtmosphereState, focus: Vector3, shadowExtent: number) {
    this.hour = ((hour % 24) + 24) % 24;
    SkySystem.sunDirection(this.hour, this.sunDir);
    // low sun glancing: keep sun just above horizon for golden hour lighting
    const elevDeg = Math.asin(this.sunDir.y) * 180 / Math.PI;
    this.sunElevation = elevDeg;
    this.night = 1 - smooth(-7, 3, elevDeg);
    const golden = 1 - smooth(4, 22, elevDeg);
    const cloud = atm.cloud;

    // sky shader
    const u = (this.sky.material as any).uniforms;
    const sunPos = this.sunDir.clone().multiplyScalar(450000);
    u.sunPosition.value.copy(sunPos);
    u.turbidity.value = lerp(2.2, 9, cloud) + golden * 1.5;
    u.rayleigh.value = lerp(1.2, 0.6, cloud) + golden * 0.9;
    u.mieCoefficient.value = lerp(0.004, 0.012, cloud);
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = lerp(0.12, 0.92, cloud);
    u.cloudDensity.value = lerp(0.25, 0.85, cloud);
    u.time.value += dt;
    u.showSunDisc.value = cloud < 0.7 ? 1 : 0;
    const eu = (this.envSky.material as any).uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity']) eu[k].value = u[k].value;
    eu.sunPosition.value.copy(sunPos);

    // sun light
    const sunUp = smooth(-2, 6, elevDeg);
    const warm = new Color().setRGB(1.0, lerp(0.95, 0.62, golden), lerp(0.9, 0.38, golden));
    const moon = new Color(0.55, 0.65, 0.95);
    const isMoon = this.night > 0.55;
    const lightDir = isMoon ? new Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize() : this.sunDir.clone().setY(Math.max(0.06, this.sunDir.y)).normalize();
    this.sun.color.copy(isMoon ? moon : warm);
    this.sun.intensity = isMoon ? 0.12 * (1 - cloud * 0.7) : lerp(0.0, 2.7, sunUp) * (1 - cloud * 0.72);
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    const cam = this.sun.shadow.camera;
    if (cam.right !== shadowExtent) {
      cam.left = -shadowExtent; cam.right = shadowExtent; cam.top = shadowExtent; cam.bottom = -shadowExtent;
      cam.near = 10; cam.far = 700;
      cam.updateProjectionMatrix();
    }
    // stabilise shadow map against shimmering: snap to texel grid
    const texel = (shadowExtent * 2) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + lightDir.x * 300;
    this.sun.position.z = this.sun.target.position.z + lightDir.z * 300;

    // hemisphere ambient
    const skyDay = new Color(0.7, 0.75, 0.82), skyGold = new Color(0.85, 0.62, 0.5), skyNight = new Color(0.08, 0.1, 0.18), skyGray = new Color(0.62, 0.66, 0.7);
    const hs = skyDay.clone().lerp(skyGold, golden * 0.8).lerp(skyGray, cloud * 0.7).lerp(skyNight, this.night);
    this.hemi.color.copy(hs);
    this.hemi.groundColor.setRGB(0.36, 0.31, 0.26).lerp(new Color(0.08, 0.07, 0.07), this.night);
    this.hemi.intensity = lerp(0.45, 0.3, this.night) * (1 + cloud * 0.6 + golden * 0.45 * (1 - this.night));

    // horizon / fog color
    const hDay = new Color(0.6, 0.7, 0.84), hGold = new Color(0.95, 0.68, 0.48), hNight = new Color(0.035, 0.045, 0.075), hGray = new Color(0.66, 0.69, 0.72);
    this.horizon.copy(hDay).lerp(hGold, golden * 0.85).lerp(hGray, Math.max(cloud * 0.8, atm.fog * 0.6)).lerp(hNight, this.night * (1 - cloud * 0.15));
    if (atm.rain > 0) this.horizon.lerp(new Color(0.42, 0.45, 0.5).lerp(hNight, this.night), atm.rain * 0.5);
    this.fog.color.copy(this.horizon);
    this.fog.density = 0.00042 + atm.fog * 0.0075 + atm.rain * 0.0022 + atm.snow * 0.003 + cloud * 0.0004;
    fogUniforms.uSunDir.value.copy(this.sunDir);
    fogUniforms.uSunFogColor.value.copy(warm).multiplyScalar(1.15);
    fogUniforms.uSunFogAmt.value = (1 - cloud) * (1 - this.night) * lerp(0.08, 0.38, golden);
    fogUniforms.uMarineColor.value.copy(new Color(0.82, 0.85, 0.88).lerp(hGold, golden * 0.35).lerp(hNight.clone().multiplyScalar(2.5), this.night * 0.9));
    fogUniforms.uMarine.value = atm.marine;
    fogUniforms.uFogTime.value += dt;

    const so = this.stars.material as PointsMaterial;
    so.opacity = Math.max(0, this.night - cloud) * 0.9;
    this.stars.position.copy(focus);

    // env map refresh (throttled)
    (this.envGlow.material as MeshBasicMaterial).color.setRGB(0.9, 0.55, 0.3).multiplyScalar(this.night * 0.25);
    if (this.envCloud) {
      const m = this.envCloud.material as MeshBasicMaterial;
      m.opacity = (1 - this.night) * 0.72 * (1 - cloud * 0.4);
      m.color.copy(warm).lerp(new Color(1, 1, 1), 1 - golden * 0.7).multiplyScalar(0.42 * (0.35 + sunUp * 0.65));
    }
    this.envTimer -= dt;
    const key = `${Math.round(this.hour * 20)}:${Math.round(cloud * 10)}:${Math.round(atm.fog * 10)}`;
    if (key !== this.lastEnvKey && this.envTimer <= 0) {
      this.refreshEnv();
      this.lastEnvKey = key;
      this.envTimer = 1.5;
    }
  }

  /** Blend a CC0 photo sky (Poly Haven) into the reflection environment for real cloud detail. */
  setHdri(tex: Texture | null) {
    if (!tex || this.envCloud) return;
    const m = new MeshBasicMaterial({ map: tex, side: BackSide, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    this.envCloud = new Mesh(new SphereGeometry(700, 48, 24), m);
    this.envCloud.renderOrder = 1;
    this.envScene.add(this.envCloud);
    this.lastEnvKey = '';
    this.envTimer = 0;
  }

  refreshEnv() {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.envMap = this.envRT.texture;
    old?.dispose();
  }

  dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sun.shadow.map?.depthTexture?.dispose(); // shadow maps use a depth texture that light.dispose() leaves behind
    this.sun.dispose(); // frees the shadow-map render target
    this.hemi.dispose();
    // the reflection scene is not part of the world scene graph: free it here (the HDRI map itself is shared)
    this.envScene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as { dispose?: () => void } | undefined;
      mat?.dispose?.();
    });
  }
}
