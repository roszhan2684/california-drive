// Night & weather atmosphere: volumetric-looking light beams in fog, a pool of real point lights at the
// nearest street lamps, wet-road light streaks, rain splashes, coastal birds and car contact shadows.
import {
  AdditiveBlending, Color, ConeGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, PointLight, Quaternion, RingGeometry, ShaderMaterial, Vector3, type Scene, type Texture,
} from 'three';

// ------------------------------------------------------------------ light beams (fog shafts)
export function beamMaterial(length: number, color: Color) {
  const m = new ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uLen: { value: length }, uColor: { value: color } },
    vertexShader: /* glsl */ `
      uniform float uLen;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 lp = vec4(position, 1.0);
        vAlong = 1.0 - clamp(length(position) / uLen, 0.0, 1.0);
        mat4 mm = modelMatrix;
        #ifdef USE_INSTANCING
          mm = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = mm * lp;
        vN = normalize(mat3(mm) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength; uniform vec3 uColor;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = pow(vAlong, 1.4) * edge * uStrength;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
  m.visible = false; // shown only while the shafts are actually visible (see DriveWorld.updateAtmosphere)
  return m;
}

/** Cone pointing along local -z from the origin (for headlights). */
export function headlightBeamGeometry(len = 26, radius = 4.2) {
  return new ConeGeometry(radius, len, 20, 1, true).translate(0, -len / 2, 0).rotateX(-Math.PI / 2);
}

/** Cone pointing straight down from the origin (for street lamps). */
export function lampBeamGeometry(len = 8.2, radius = 3.6) {
  return new ConeGeometry(radius, len, 16, 1, true).translate(0, -len / 2, 0);
}

// ------------------------------------------------------------------ point light pool
export class LampLights {
  private lights: PointLight[] = [];
  private timer = 0;
  active = 0;

  constructor(scene: Scene, max = 10) {
    for (let i = 0; i < max; i++) {
      const l = new PointLight(0xffc27a, 0, 30, 1.7);
      l.visible = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  /** heads: flattened x,y,z of lamp heads near the player. */
  update(dt: number, heads: number[], px: number, pz: number, night: number, budget: number) {
    this.timer -= dt;
    const n = Math.min(budget, this.lights.length);
    if (this.timer <= 0) {
      this.timer = 0.3;
      const idx: { i: number; d: number }[] = [];
      for (let i = 0; i < heads.length; i += 3) idx.push({ i, d: (heads[i] - px) ** 2 + (heads[i + 2] - pz) ** 2 });
      idx.sort((a, b) => a.d - b.d);
      // Keep the visible light count constant while it is night: changing it makes three.js
      // recompile every lit material. Unused lights stay visible with zero intensity.
      const on = night > 0.25;
      for (let k = 0; k < this.lights.length; k++) {
        const l = this.lights[k];
        const h = idx[k];
        l.visible = on && k < n;
        if (h) l.position.set(heads[h.i], heads[h.i + 1] - 0.4, heads[h.i + 2]);
        l.userData.used = !!h;
      }
    }
    this.active = 0;
    for (const l of this.lights) {
      const lit = l.visible && l.userData.used;
      l.intensity = lit ? 55 * Math.min(1, (night - 0.25) / 0.4) : 0;
      if (lit) this.active++;
    }
  }

  dispose() {
    for (const l of this.lights) { l.removeFromParent(); l.dispose(); }
  }
}

// ------------------------------------------------------------------ wet-road light streaks
export class WetStreaks {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: InstancedBufferGeometry;
  private mat: ShaderMaterial;
  readonly max: number;

  constructor(scene: Scene, max = 256) {
    this.max = max;
    const base = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    const mk = (a: Float32Array, n: number) => { const b = new InstancedBufferAttribute(a, n); b.setUsage(DynamicDrawUsage); return b; };
    this.geo.setAttribute('aPos', mk(this.pos, 3));
    this.geo.setAttribute('aCol', mk(this.col, 3));
    this.geo.setAttribute('aSize', mk(this.size, 1));
    this.geo.instanceCount = 0;
    this.mat = new ShaderMaterial({
      uniforms: { uStrength: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec3 aCol; attribute float aSize;
        varying vec2 vUv; varying vec3 vCol; varying float vFade;
        void main() {
          vec3 toCam = cameraPosition - aPos;
          float dist = length(toCam.xz);
          vec2 d = toCam.xz / max(dist, 0.001);
          vec2 perp = vec2(-d.y, d.x);
          float L = aSize * (2.0 + clamp(dist / 12.0, 0.0, 4.0));
          vec2 xz = aPos.xz + perp * position.x * (0.35 + aSize * 0.12) + d * position.y * min(L, dist * 0.9);
          vUv = vec2(position.x + 0.5, position.y);
          vCol = aCol;
          vFade = 1.0 - smoothstep(60.0, 120.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, aPos.y + 0.07, xz.y, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength; varying vec2 vUv; varying vec3 vCol; varying float vFade;
        void main() {
          float across = exp(-pow((vUv.x - 0.5) * 4.0, 2.0));
          float along = pow(1.0 - vUv.y, 1.3) * smoothstep(0.0, 0.08, vUv.y);
          float a = across * along * uStrength * vFade;
          gl_FragColor = vec4(vCol * a, a);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  /** sources: x,y(ground),z,r,g,b,size */
  update(sources: number[], strength: number) {
    const n = Math.min(this.max, sources.length / 7);
    for (let i = 0; i < n; i++) {
      this.pos.set([sources[i * 7], sources[i * 7 + 1], sources[i * 7 + 2]], i * 3);
      this.col.set([sources[i * 7 + 3], sources[i * 7 + 4], sources[i * 7 + 5]], i * 3);
      this.size[i] = sources[i * 7 + 6];
    }
    this.geo.instanceCount = strength > 0.01 ? n : 0;
    for (const k of ['aPos', 'aCol', 'aSize']) (this.geo.getAttribute(k) as InstancedBufferAttribute).needsUpdate = true;
    this.mat.uniforms.uStrength.value = strength;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ rain splashes
export class RainSplashes {
  readonly mesh: InstancedMesh;
  private mat: ShaderMaterial;

  constructor(scene: Scene, count = 420) {
    const g = new RingGeometry(0.72, 1.0, 16).rotateX(-Math.PI / 2);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = i * 1.618 + Math.random();
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector3() }, uIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; varying float vA;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float t = uTime * 2.6 + aSeed;
          float cyc = floor(t);
          float ph = fract(t);
          vec2 off = vec2(h(aSeed * 12.9 + cyc * 7.1), h(aSeed * 78.2 + cyc * 3.7)) * 44.0 - 22.0;
          float s = 0.03 + ph * 0.15;
          vec3 p = vec3(uCenter.x + off.x, uCenter.y + 0.08, uCenter.z + off.y) + position * s;
          vA = (1.0 - ph) * (1.0 - smoothstep(14.0, 22.0, length(off)));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.75, 0.8, 0.86), vA * uIntensity * 0.32); }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new InstancedMesh(g, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(time: number, center: Vector3, rain: number) {
    this.mesh.visible = rain > 0.05;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCenter.value.copy(center);
    this.mat.uniforms.uIntensity.value = rain;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ birds over the water / valley
export class Birds {
  readonly mesh: InstancedMesh;
  private mat: ShaderMaterial;
  private seeds: { r: number; h: number; s: number; p: number; ox: number; oz: number }[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private center = new Vector3();
  private placed = false;

  constructor(scene: Scene, count = 26) {
    const g = new PlaneGeometry(1.0, 0.25, 2, 1).rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    const flap = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) flap[i] = Math.abs(p.getX(i)) * 2;
    g.setAttribute('aFlap', new (p.constructor as any)(flap, 1));
    const ph = new Float32Array(count);
    for (let i = 0; i < count; i++) ph[i] = Math.random() * 10;
    g.setAttribute('aPhase', new InstancedBufferAttribute(ph, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(0.12, 0.12, 0.13) } },
      vertexShader: /* glsl */ `
        attribute float aFlap; attribute float aPhase; uniform float uTime;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 9.0 + aPhase) * 0.28 * aFlap;
          p.z -= aFlap * 0.12;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(g, this.mat, count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) this.seeds.push({ r: 25 + Math.random() * 40, h: 32 + Math.random() * 30, s: 0.25 + Math.random() * 0.2, p: Math.random() * 6.28, ox: (Math.random() - 0.5) * 30, oz: (Math.random() - 0.5) * 30 });
    scene.add(this.mesh);
  }

  update(time: number, player: Vector3, anchor: Vector3 | null, day: number) {
    this.mesh.visible = !!anchor && day > 0.3;
    if (!anchor) return;
    // drift the flock toward the anchor (over water or the valley) near the player
    const target = this.v.copy(anchor).sub(player).clampLength(0, 220).add(player);
    if (!this.placed) { this.center.copy(target); this.placed = true; }
    this.center.lerp(target, 0.002);
    this.mat.uniforms.uTime.value = time;
    this.seeds.forEach((s, i) => {
      const a = s.p + time * s.s;
      const x = this.center.x + s.ox + Math.cos(a) * s.r, z = this.center.z + s.oz + Math.sin(a) * s.r;
      const y = anchor.y + s.h + Math.sin(time * 0.3 + s.p) * 3;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), -a);
      this.m.compose(new Vector3(x, y, z), this.q, new Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ contact shadows
export function contactShadowMaterial(radial: Texture) {
  return new MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
}

export function contactShadowGeometry(w: number, l: number) {
  return new PlaneGeometry(w, l).rotateX(-Math.PI / 2);
}

export class CarShadow {
  readonly mesh: Mesh;
  constructor(scene: Scene, radial: Texture, w = 2.5, l = 5.6) {
    this.mesh = new Mesh(contactShadowGeometry(w, l), contactShadowMaterial(radial));
    this.mesh.renderOrder = 1;
    this.mesh.userData.noAO = true;
    scene.add(this.mesh);
  }
  update(x: number, groundY: number, z: number, yaw: number, height: number) {
    this.mesh.position.set(x, groundY + 0.05, z);
    this.mesh.rotation.y = yaw;
    const k = Math.max(0, 1 - height / 2.5);
    (this.mesh.material as MeshBasicMaterial).opacity = 0.62 * k;
    this.mesh.scale.setScalar(1 + (1 - k) * 0.3);
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}

export function markNoAO(o: Object3D) {
  o.userData.noAO = true;
  return o;
}
