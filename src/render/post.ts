import { envUniforms } from './materials.ts';
import { HalfFloatType, Vector2, Vector3, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

/** Linear-HDR color grade + lens effects, before tone mapping. */
const GradeShader = {
  name: 'CDGrade',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uContrast: { value: 1.12 },
    uSaturation: { value: 1.05 },
    uLift: { value: new Vector3(0, 0, 0) },
    uGain: { value: new Vector3(1, 1, 1) },
    uVignette: { value: 0.28 },
    uSpeedBlur: { value: 0 },
    uTime: { value: 0 },
    uGrain: { value: 0.025 },
    uRainScreen: { value: 0 },
    uWiper: { value: 0 },
    uAspect: { value: 1.7 },
    uChroma: { value: 0 },
    uLetterbox: { value: 0 },
    uHazePos: { value: new Vector2(0.5, 0.7) },
    uHaze: { value: 0 },
    uSunPos: { value: new Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uExposure; uniform float uContrast; uniform float uSaturation;
    uniform vec3 uLift; uniform vec3 uGain; uniform float uVignette; uniform float uSpeedBlur; uniform float uTime; uniform float uGrain;
    uniform float uRainScreen; uniform float uWiper; uniform float uAspect;
    uniform float uChroma; uniform float uLetterbox; uniform vec2 uHazePos; uniform float uHaze; uniform vec2 uSunPos; uniform float uSunVis;
    varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      vec2 uv = vUv;
      // windshield droplets (interior/hood cameras): cellular drops cleared by the wiper sweep
      if (uRainScreen > 0.001) {
        vec2 g = vec2(uv.x * uAspect, uv.y) * 14.0;
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float r = h21(id);
        vec2 off = vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5;
        float life = fract(uTime * 0.25 + r);
        float d = length(f - off * 0.6);
        float size = 0.12 + 0.18 * h21(id + 1.3);
        float wipeAngle = atan(uv.x - 0.5, uv.y + 0.15);
        float wiped = smoothstep(0.25, 0.0, abs(wipeAngle - (uWiper * 2.6 - 1.3)));
        float drop = smoothstep(size, size * 0.4, d) * step(0.45, r) * (1.0 - life * 0.6) * (1.0 - wiped);
        uv += (f - off * 0.6) * drop * 0.035 * uRainScreen;
      }
      // exhaust heat haze: wobble inside a small screen region rising from the tailpipes
      if (uHaze > 0.001) {
        vec2 d = (uv - uHazePos) * vec2(uAspect, 1.0);
        float m = smoothstep(0.09, 0.0, length(d * vec2(1.0, 0.7) - vec2(0.0, 0.035))) * uHaze;
        uv += (vec2(vn(uv * 60.0 + vec2(0.0, uTime * 9.0)), vn(uv * 60.0 - vec2(uTime * 7.0, 0.0))) - 0.5) * 0.0035 * m;
      }
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uChroma > 0.001) {
        vec2 dir = (uv - 0.5) * uChroma * 0.012;
        col.r = texture2D(tDiffuse, uv + dir).r;
        col.b = texture2D(tDiffuse, uv - dir).b;
      }
      if (uSpeedBlur > 0.001) {
        vec2 dir = uv - 0.5;
        float m = smoothstep(0.12, 0.7, length(dir)) * uSpeedBlur;
        vec3 acc = col;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, uv - dir * float(i) * 0.012 * m).rgb;
        col = acc / 8.0;
      }
      col *= uExposure;
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      // contrast in log space around mid grey
      col = max(col, 0.0);
      col = pow(col / 0.18, vec3(uContrast)) * 0.18;
      float v = length((vUv - 0.5) * vec2(1.0, 0.85));
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, v);
      // sun in frame: lens dirt lit around the sun plus a few flare ghosts through the centre
      if (uSunVis > 0.001) {
        vec2 sp = (vUv - uSunPos) * vec2(uAspect, 1.0);
        float r = length(sp);
        float halo = exp(-r * 5.0);
        float core = exp(-r * 22.0);
        float dirt = smoothstep(0.6, 0.92, vn(vUv * vec2(uAspect, 1.0) * 7.0)) * 0.7 + smoothstep(0.72, 0.96, vn(vUv * 23.0 + 4.0)) * 0.5;
        vec3 warm = vec3(1.0, 0.82, 0.6);
        col += warm * (dirt * halo * 0.22 + core * 0.35) * uSunVis;
        for (int i = 1; i < 4; i++) {
          vec2 gp = mix(uSunPos, vec2(0.5), 0.55 * float(i) + 0.2);
          float g = smoothstep(0.06 + 0.03 * float(i), 0.0, length((vUv - gp) * vec2(uAspect, 1.0)));
          col += mix(vec3(0.5, 0.8, 1.0), vec3(1.0, 0.6, 0.4), float(i) / 3.0) * g * 0.025 * uSunVis;
        }
      }
      col += (h21(vUv * 1000.0 + fract(uTime) * 37.0) - 0.5) * uGrain * (0.25 + l);
      if (vUv.y < uLetterbox || vUv.y > 1.0 - uLetterbox) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const envAO = envUniforms.uAO;

export interface PostSettings {
  ao: boolean;
  bloom: boolean;
  smaa: boolean;
  speedBlur: boolean;
}

export class PostFX {
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  readonly smaa: SMAAPass;
  readonly output: OutputPass;
  readonly bokeh: BokehPass;
  private exposureCur = 0.85;
  exposureTarget = 0.85;
  speedBlurEnabled = true;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bokeh = new BokehPass(scene, camera, { focus: 8, aperture: 0.004, maxblur: 0.008 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
  }

  setCamera(c: Camera) {
    this.renderPass.camera = c;
    (this.bokeh as any).camera = c;
  }

  setScene(s: Scene) {
    this.renderPass.scene = s;
    (this.bokeh as any).scene = s;
  }

  /** Photo-mode depth of field: focus distance (m), aperture (0 disables). */
  setDof(on: boolean, focus = 8, aperture = 0.004, maxblur = 0.01) {
    this.bokeh.enabled = on && aperture > 0;
    const u = this.bokeh.uniforms as any;
    u.focus.value = focus;
    u.aperture.value = aperture;
    u.maxblur.value = maxblur;
  }

  setLetterbox(frac: number) {
    this.grade.uniforms.uLetterbox.value = frac;
  }

  /** Lens effects: chromatic aberration (0..1), exhaust haze (screen uv + amount), sun lens dirt (screen uv + visibility). */
  setLens(chroma: number, hazeX: number, hazeY: number, haze: number, sunX: number, sunY: number, sunVis: number) {
    const u = this.grade.uniforms;
    u.uChroma.value = chroma;
    u.uHazePos.value.set(hazeX, hazeY);
    u.uHaze.value = haze;
    u.uSunPos.value.set(sunX, sunY);
    u.uSunVis.value = sunVis;
  }

  apply(s: PostSettings) {
    this.bloom.enabled = s.bloom;
    envAO.value = s.ao ? 1 : 0;
    this.smaa.enabled = s.smaa;
    this.speedBlurEnabled = s.speedBlur;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
  }

  /** Eye adaptation toward exposureTarget (fast to brighten in tunnels, slower to recover). */
  update(dt: number, time: number, speedBlur: number, rainScreen: number, wiper: number) {
    const rate = this.exposureTarget > this.exposureCur ? 1.4 : 0.9;
    this.exposureCur += (this.exposureTarget - this.exposureCur) * Math.min(1, dt * rate);
    const u = this.grade.uniforms;
    u.uExposure.value = this.exposureCur;
    u.uTime.value = time;
    u.uSpeedBlur.value = this.speedBlurEnabled ? speedBlur : 0;
    u.uRainScreen.value = rainScreen;
    u.uWiper.value = wiper;
  }

  setGrade(contrast: number, saturation: number, lift: [number, number, number], gain: [number, number, number], vignette: number) {
    const u = this.grade.uniforms;
    u.uContrast.value = contrast;
    u.uSaturation.value = saturation;
    u.uLift.value.set(...lift);
    u.uGain.value.set(...gain);
    u.uVignette.value = vignette;
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
