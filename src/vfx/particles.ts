import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, NormalBlending, Points, ShaderMaterial, Vector3, type Blending, type Scene } from 'three';
import { fogUniforms } from '../render/fog.ts';

export interface EmitOpts {
  pos: Vector3;
  vel: Vector3;
  spread: number;
  life: number;
  size: number;
  grow: number;
  color: Color;
  alpha: number;
  gravity: number;
  drag: number;
}

/** CPU-simulated, GPU-drawn soft particle pool (smoke, dust, spray, sparks, exhaust). */
export class ParticlePool {
  readonly max: number;
  private count = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private data: Float32Array; // age, life, size, grow
  private props: Float32Array; // alpha0, gravity, drag
  private aSize: Float32Array;
  private aAlpha: Float32Array;
  private geo: BufferGeometry;
  readonly points: Points;
  limit: number;

  constructor(scene: Scene, max: number, additive: boolean) {
    this.max = max;
    this.limit = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.data = new Float32Array(max * 4);
    this.props = new Float32Array(max * 3);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);
    this.geo = new BufferGeometry();
    const mk = (a: Float32Array, n: number) => { const b = new BufferAttribute(a, n); b.setUsage(DynamicDrawUsage); return b; };
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('color', mk(this.col, 3));
    this.geo.setAttribute('size', mk(this.aSize, 1));
    this.geo.setAttribute('alpha', mk(this.aAlpha, 1));
    const blending: Blending = additive ? AdditiveBlending : NormalBlending;
    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 600 }, fogColor: { value: new Color() }, fogDensity: { value: 0 }, uLight: { value: new Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale; varying float vA; varying vec3 vC; varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          vA = alpha; vC = color; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 fogColor; uniform float fogDensity; uniform vec3 uLight;
        varying float vA; varying vec3 vC; varying float vDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float a = (1.0 - d * d) * vA;
          float f = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
          vec3 col = mix(vC * ${additive ? 'vec3(1.0)' : 'uLight'}, fogColor, f * ${additive ? '0.0' : '1.0'});
          gl_FragColor = vec4(col, a * ${additive ? '(1.0 - f)' : '1.0'});
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    void fogUniforms;
  }

  setFog(color: Color, density: number) {
    const u = (this.points.material as ShaderMaterial).uniforms;
    u.fogColor.value.copy(color);
    u.fogDensity.value = density;
  }

  /** Light colour applied to non-additive particles (lit smoke). */
  setLight(c: Color) {
    (this.points.material as ShaderMaterial).uniforms.uLight.value.copy(c);
  }

  setViewportHeight(h: number, fovDeg: number) {
    (this.points.material as ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOpts) {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.pos.set([o.pos.x, o.pos.y, o.pos.z], i * 3);
    const s = o.spread;
    this.vel.set([o.vel.x + (Math.random() - 0.5) * s, o.vel.y + (Math.random() - 0.5) * s, o.vel.z + (Math.random() - 0.5) * s], i * 3);
    this.col.set([o.color.r, o.color.g, o.color.b], i * 3);
    this.data.set([0, o.life * (0.75 + Math.random() * 0.5), o.size, o.grow], i * 4);
    this.props.set([o.alpha, o.gravity, o.drag], i * 3);
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      const age = (this.data[i * 4] += dt);
      const life = this.data[i * 4 + 1];
      if (age >= life) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.data.copyWithin(i * 4, last * 4, last * 4 + 4);
          this.props.copyWithin(i * 3, last * 3, last * 3 + 3);
        }
        continue;
      }
      const drag = Math.exp(-this.props[i * 3 + 2] * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.props[i * 3 + 1] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = age / life;
      this.aSize[i] = this.data[i * 4 + 2] + this.data[i * 4 + 3] * age;
      this.aAlpha[i] = this.props[i * 3] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const k of ['position', 'color', 'size', 'alpha']) {
      const a = this.geo.getAttribute(k) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  get active() {
    return this.count;
  }

  clear() {
    this.count = 0;
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as ShaderMaterial).dispose();
    this.points.removeFromParent();
  }
}
