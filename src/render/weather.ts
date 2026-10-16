import { AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, Points, ShaderMaterial, Vector3, NormalBlending, type Scene } from 'three';
import type { WeatherKind } from '../world/cities.ts';
import type { AtmosphereState } from './sky.ts';
import { rng } from '../world/geom.ts';

const PRESETS: Record<WeatherKind, Omit<AtmosphereState, 'wet' | 'marine'> & { marine: number }> = {
  clear: { cloud: 0.08, fog: 0.015, rain: 0, snow: 0, marine: 0.35 },
  overcast: { cloud: 0.85, fog: 0.18, rain: 0, snow: 0, marine: 0.5 },
  fog: { cloud: 0.6, fog: 0.75, rain: 0, snow: 0, marine: 1 },
  rain: { cloud: 1, fog: 0.35, rain: 1, snow: 0, marine: 0.3 },
  snow: { cloud: 0.9, fog: 0.4, rain: 0, snow: 1, marine: 0 },
};

const BOX = 70;

/** Weather state machine with smooth transitions, wetness accumulation and precipitation visuals. */
export class WeatherSystem {
  kind: WeatherKind = 'clear';
  readonly state: AtmosphereState = { cloud: 0.1, fog: 0.05, marine: 0, rain: 0, snow: 0, wet: 0 };
  private rainMesh: LineSegments;
  private snowMesh: Points;
  private rainMat: ShaderMaterial;
  private snowMat: ShaderMaterial;
  private time = 0;
  marineEnabled = false;
  /** Seconds for a full transition. */
  transition = 8;

  constructor(scene: Scene, maxDrops: number) {
    const r = rng(9);
    const n = maxDrops;
    const pos = new Float32Array(n * 2 * 3);
    const seed = new Float32Array(n * 2);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = r() * BOX, y = r() * BOX * 0.6, z = r() * BOX;
      pos.set([x, y, z, x, y, z], i * 6);
      const s = r();
      seed[i * 2] = s; seed[i * 2 + 1] = s;
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('seed', new BufferAttribute(seed, 1));
    g.setAttribute('tail', new BufferAttribute(end, 1));
    this.rainMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector3() }, uIntensity: { value: 0 }, uWind: { value: new Vector3(2, 0, 1) }, uVel: { value: new Vector3() }, uCount: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; attribute float tail;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uWind; uniform vec3 uVel; uniform float uCount;
        varying float vA;
        void main() {
          float fall = 11.0 + seed * 4.0;
          vec3 p = position;
          p.y = mod(p.y - uTime * fall, ${(BOX * 0.6).toFixed(1)});
          p.xz += uWind.xz * (uTime * (0.6 + seed * 0.2));
          vec3 rel = p - uCenter;
          rel.xz = mod(rel.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          rel.y = p.y - ${(BOX * 0.25).toFixed(1)};
          vec3 wp = uCenter + rel;
          vec3 streak = vec3(uWind.x, -fall, uWind.z) - uVel;
          wp += normalize(streak) * tail * (0.35 + seed * 0.35);
          vA = (step(seed, uCount)) * (1.0 - smoothstep(20.0, 34.0, length(rel.xz)));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.7, 0.75, 0.82), vA * uIntensity * 0.38); }`,
      transparent: true, depthWrite: false, blending: NormalBlending,
    });
    this.rainMesh = new LineSegments(g, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);

    const sn = Math.floor(n / 2);
    const sp = new Float32Array(sn * 3);
    const ss = new Float32Array(sn);
    for (let i = 0; i < sn; i++) { sp.set([r() * BOX, r() * BOX * 0.6, r() * BOX], i * 3); ss[i] = r(); }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(sp, 3));
    sg.setAttribute('seed', new BufferAttribute(ss, 1));
    this.snowMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector3() }, uIntensity: { value: 0 }, uWind: { value: new Vector3(1, 0, 0.5) } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime; uniform vec3 uCenter; uniform vec3 uWind; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * (1.2 + seed), ${(BOX * 0.6).toFixed(1)});
          p.x += sin(uTime * 0.7 + seed * 40.0) * 1.2 + uWind.x * uTime * 0.5;
          p.z += cos(uTime * 0.6 + seed * 30.0) * 1.2 + uWind.z * uTime * 0.5;
          vec3 rel = p - uCenter;
          rel.xz = mod(rel.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          rel.y = p.y - ${(BOX * 0.25).toFixed(1)};
          vec4 mv = modelViewMatrix * vec4(uCenter + rel, 1.0);
          gl_PointSize = (2.0 + seed * 3.0) * 60.0 / -mv.z;
          vA = 1.0 - smoothstep(20.0, 34.0, length(rel.xz));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - d * 2.0) * vA * uIntensity * 0.9); }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.snowMesh = new Points(sg, this.snowMat);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    scene.add(this.snowMesh);
  }

  set(kind: WeatherKind, instant = false) {
    this.kind = kind;
    if (instant) {
      const p = PRESETS[kind];
      Object.assign(this.state, { cloud: p.cloud, fog: p.fog, rain: p.rain, snow: p.snow, marine: this.marineEnabled ? p.marine : 0 });
      this.state.wet = kind === 'rain' ? 1 : 0;
    }
  }

  /** Fraction of drops drawn (quality). */
  setDensity(f: number) {
    this.rainMat.uniforms.uCount.value = f;
  }

  update(dt: number, camPos: Vector3, camVel: Vector3, marineCycle: number) {
    this.time += dt;
    const p = PRESETS[this.kind];
    const k = Math.min(1, dt / this.transition * 3);
    const s = this.state;
    s.cloud += (p.cloud - s.cloud) * k;
    s.fog += (p.fog - s.fog) * k;
    s.rain += (p.rain - s.rain) * k;
    s.snow += (p.snow - s.snow) * k;
    const marineTarget = this.marineEnabled ? p.marine * (this.kind === 'fog' ? 1 : marineCycle) : 0;
    s.marine += (marineTarget - s.marine) * k * 0.5;
    // wetness: builds while raining, dries slowly
    if (s.rain > 0.2) s.wet = Math.min(1, s.wet + dt * 0.08 * s.rain);
    else s.wet = Math.max(0, s.wet - dt * 0.01);
    this.rainMesh.visible = s.rain > 0.01;
    this.snowMesh.visible = s.snow > 0.01;
    for (const m of [this.rainMat, this.snowMat]) {
      m.uniforms.uTime.value = this.time;
      m.uniforms.uCenter.value.copy(camPos);
    }
    this.rainMat.uniforms.uIntensity.value = s.rain;
    this.rainMat.uniforms.uVel.value.copy(camVel).multiplyScalar(0.06);
    this.snowMat.uniforms.uIntensity.value = s.snow;
  }

  dispose() {
    this.rainMesh.geometry.dispose();
    this.snowMesh.geometry.dispose();
    this.rainMat.dispose();
    this.snowMat.dispose();
  }
}
