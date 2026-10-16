// Close-up car detail shared by the player cars: metallic-flake paint, drilled brake discs,
// tyre sidewall lettering (generic, no tyre brand) and speed-dependent wheel blur discs.
import { CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, RingGeometry, CircleGeometry, SRGBColorSpace, type MeshPhysicalMaterial, type Object3D, type Texture } from 'three';
import { withFog } from '../render/fog.ts';

/** Paint with a micro-flake normal perturbation under the clear coat (fades out with distance). */
export function flakePaint(m: MeshPhysicalMaterial, key: string): MeshPhysicalMaterial {
  const flake = { value: 1 };
  m.userData.flake = flake;
  return withFog(m, (s) => {
    s.uniforms.uFlake = flake;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlakeP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP;\nuniform float uFlake;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 fp = floor(vFlakeP * 260.0);
          vec3 rnd = fract(sin(vec3(dot(fp, vec3(12.9898, 78.233, 37.719)), dot(fp, vec3(39.346, 11.135, 83.155)), dot(fp, vec3(73.156, 52.235, 9.151)))) * 43758.5453) * 2.0 - 1.0;
          float fw = length(fwidth(vFlakeP)) * 260.0;
          float k = uFlake * (1.0 - smoothstep(0.4, 1.6, fw));
          normal = normalize(normal + rnd * 0.22 * k);
        }`);
  }, key);
}

export function setFlake(m: MeshPhysicalMaterial, on: boolean) {
  const f = m.userData.flake as { value: number } | undefined;
  if (f) f.value = on ? 1 : 0;
}

let cache: { disc: Texture; sidewall: Texture; blur: Texture } | null = null;

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
}

function textures() {
  if (cache) return cache;
  // drilled & machined disc face (cylinder caps map the disc onto the unit square)
  const [dc, d] = canvas(256);
  const g = d.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, '#3a3c3f'); g.addColorStop(0.5, '#3a3c3f'); g.addColorStop(0.52, '#a4a7aa'); g.addColorStop(1, '#8d9093');
  d.fillStyle = g;
  d.fillRect(0, 0, 256, 256);
  d.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let r = 68; r < 128; r += 2.5) { d.beginPath(); d.arc(128, 128, r, 0, Math.PI * 2); d.stroke(); }
  d.fillStyle = '#18191b';
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    for (const [rr, da] of [[80, 0], [96, 0.06], [112, 0.12]] as const) {
      d.beginPath();
      d.arc(128 + Math.cos(a + da) * rr, 128 + Math.sin(a + da) * rr, 3.4, 0, Math.PI * 2);
      d.fill();
    }
  }
  // hat bolts
  d.fillStyle = '#6c6f72';
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; d.beginPath(); d.arc(128 + Math.cos(a) * 36, 128 + Math.sin(a) * 36, 6, 0, Math.PI * 2); d.fill(); }
  const disc = new CanvasTexture(dc);
  disc.colorSpace = SRGBColorSpace;

  // sidewall lettering around the tyre (planar UVs of a RingGeometry)
  const [sc, s] = canvas(1024);
  s.fillStyle = 'rgba(0,0,0,0)';
  s.fillRect(0, 0, 1024, 1024);
  s.fillStyle = 'rgba(200,200,200,0.9)';
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  const ring = (text: string, start: number, radius: number, px: number) => {
    s.font = `700 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const step = (px * 0.62) / radius;
    let a = start - (text.length * step) / 2;
    for (const ch of text) {
      s.save();
      s.translate(512 + Math.cos(a) * radius, 512 + Math.sin(a) * radius);
      s.rotate(a + Math.PI / 2);
      s.fillText(ch, 0, 0);
      s.restore();
      a += step;
    }
  };
  ring('CALIFORNIA DRIVE PERFORMANCE', -Math.PI / 2, 448, 30);
  ring('275/35 ZR19  ·  TUBELESS  ·  RADIAL', Math.PI / 2 - 0.0, 448, 22);
  s.font = '600 16px sans-serif';
  ring('DOT · MAX LOAD 1 090 KG · MAX PRESS 350 KPA', 0, 456, 14);
  ring('DOT · MAX LOAD 1 090 KG · MAX PRESS 350 KPA', Math.PI, 456, 14);
  const sidewall = new CanvasTexture(sc);
  sidewall.colorSpace = SRGBColorSpace;
  sidewall.anisotropy = 8;

  // spinning-wheel blur: radial bands with a soft smear of the spokes
  const [bc, b] = canvas(256);
  const bg = b.createRadialGradient(128, 128, 0, 128, 128, 128);
  bg.addColorStop(0, 'rgba(120,122,126,1)');
  bg.addColorStop(0.18, 'rgba(70,72,76,1)');
  bg.addColorStop(0.3, 'rgba(48,50,54,0.92)');
  bg.addColorStop(0.75, 'rgba(36,38,42,0.82)');
  bg.addColorStop(0.9, 'rgba(70,72,76,0.95)');
  bg.addColorStop(1, 'rgba(26,27,29,1)');
  b.fillStyle = bg;
  b.beginPath(); b.arc(128, 128, 128, 0, Math.PI * 2); b.fill();
  b.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let r = 40; r < 120; r += 4) { b.beginPath(); b.arc(128, 128, r, 0, Math.PI * 2); b.stroke(); }
  const blur = new CanvasTexture(bc);
  blur.colorSpace = SRGBColorSpace;
  cache = { disc, sidewall, blur };
  return cache;
}

/** Apply the drilled texture to a disc material (shared by the four corners). */
export function drilledDisc(m: MeshStandardMaterial) {
  m.map = textures().disc;
  m.color.set(0xffffff);
  m.needsUpdate = true;
}

export interface WheelDetailSpec {
  /** Rim (inner) and tyre (outer) radii, tyre width, and which side faces out (+1 right, -1 left). */
  ri: number; ro: number; width: number; outer: number;
  /** Blur-disc brightness to match the rim finish (1 = dark forged, ~2.6 = bright silver). */
  bright?: number;
}

/**
 * Adds sidewall lettering (spins with the wheel) and a blur disc (on the steering pivot,
 * does not spin). Returns the blur mesh, whose material opacity the view drives by wheel speed.
 */
export function addWheelDetail(spin: Object3D, pivot: Object3D, w: WheelDetailSpec, track: <T extends { dispose(): void }>(x: T) => T): Mesh {
  const t = textures();
  const swMat = track(withFog(new MeshStandardMaterial({ map: t.sidewall, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), undefined, 'sidewall'));
  const sw = new Mesh(track(new RingGeometry(w.ri + 0.012, w.ro - 0.012, 48, 1)), swMat);
  // RingGeometry UVs span its outer radius; scale the texture so the lettering ring sits mid-sidewall
  sw.rotation.y = w.outer * Math.PI / 2;
  sw.position.x = w.outer * (w.width / 2 - 0.004);
  spin.add(sw);
  const blurMat = track(withFog(new MeshStandardMaterial({ map: t.blur, transparent: true, opacity: 0, roughness: 0.4, metalness: 0.7, depthWrite: false, side: DoubleSide }), undefined, 'wheelblur'));
  blurMat.color.setScalar(w.bright ?? 1);
  const blur = new Mesh(track(new CircleGeometry(w.ri - 0.004, 40)), blurMat);
  blur.rotation.y = w.outer * Math.PI / 2;
  blur.position.x = w.outer * (w.width / 2 - 0.003);
  blur.visible = false;
  blur.renderOrder = 2;
  pivot.add(blur);
  return blur;
}

/** Blur-disc opacity for a wheel angular speed (rad/s). */
export function wheelBlurOpacity(omega: number): number {
  const x = Math.min(1, Math.max(0, (Math.abs(omega) - 16) / 34));
  return x * x * (3 - 2 * x) * 0.92;
}
