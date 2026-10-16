// Procedural approximation of a BMW M3 Competition (G80) sedan, built entirely in code (no ripped assets).
// BMW, M3, the roundel and the kidney grille are trademarks of BMW AG. This fan-made model is not affiliated
// with or endorsed by BMW; badges can be hidden with the "Manufacturer badges" setting. Personal, non-commercial use.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, LatheGeometry, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, Shape, SphereGeometry, SpotLight,
  SRGBColorSpace, TorusGeometry, Vector2,
} from 'three';
import { withFog } from '../render/fog.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M3_COMP } from '../physics/vehicle/config.ts';
import { addWheelDetail, drilledDisc, flakePaint } from './carDetail.ts';
import { applyPaint, curve, flipped, gauss, loftGeometry, splitQuadsN, type CameraMounts, type CarRig, type Key, type Paint, type WheelRig } from './carModel.ts';

export const M3_PAINTS: Paint[] = [
  { name: 'Isle of Man Green', color: '#0e5a43' },
  { name: 'São Paulo Yellow', color: '#f0c20a' },
  { name: 'Toronto Red', color: '#a3121c' },
  { name: 'Portimão Blue', color: '#1c5aa6' },
  { name: 'Brooklyn Grey', color: '#71767a' },
  { name: 'Black Sapphire', color: '#0c0e13' },
  { name: 'Alpine White', color: '#e8e8e4' },
  { name: 'Frozen Portimão Blue', color: '#2a5d93', matte: true },
  { name: 'Frozen Black', color: '#1a1b1e', matte: true },
];

export const M3_MOUNTS: CameraMounts = {
  bumper: [0, -0.34, -2.5], hood: [0, 0.46, -1.0], cockpit: [-0.38, 0.5, 0.14], dashboard: [-0.38, 0.47, 0.04], wheel: [-1.2, -0.3, 0.05],
};

const L = 4.8;
const Z0 = -2.4;
const HALF_W: Key = [[0, 0.8], [0.015, 0.865], [0.05, 0.92], [0.12, 0.94], [0.195, 0.958], [0.27, 0.935], [0.33, 0.918], [0.55, 0.922], [0.71, 0.932], [0.79, 0.958], [0.88, 0.942], [0.97, 0.915], [1, 0.865]];
const TOP: Key = [[0, -0.02], [0.02, 0.045], [0.07, 0.095], [0.18, 0.145], [0.3, 0.215], [0.34, 0.245], [0.45, 0.262], [0.68, 0.278], [0.8, 0.292], [0.86, 0.302], [0.94, 0.307], [0.962, 0.328], [0.975, 0.3], [1, 0.27]];
const BOTTOM: Key = [[0, -0.6], [0.02, -0.62], [0.96, -0.62], [0.985, -0.5], [1, -0.46]];
const CZ0 = -0.8, CZ1 = 1.58;
const CABIN_TOP: Key = [[0, 0.255], [0.08, 0.36], [0.29, 0.66], [0.35, 0.685], [0.6, 0.68], [0.7, 0.645], [0.8, 0.565], [0.9, 0.445], [1, 0.315]];

const CFG = M3_COMP;
const WHEEL_Y = CFG.wheels[0].y - (CFG.suspension.restLength - 0.07);
const FZ = CFG.wheels[0].z, RZ = CFG.wheels[2].z;
const tOf = (z: number) => (z - Z0) / L;

function bodySection(t: number, ringN: number, out: number[]) {
  const z = Z0 + t * L;
  const w = curve(HALF_W, t);
  let top = curve(TOP, t);
  let bottom = curve(BOTTOM, t);
  for (const [wz, r] of [[FZ, 0.334], [RZ, 0.346]] as const) {
    const dz = z - wz;
    const ar = r + 0.045;
    if (Math.abs(dz) < ar) bottom = Math.max(bottom, WHEEL_Y + Math.sqrt(ar * ar - dz * dz) + 0.012);
  }
  top = Math.max(top, bottom + 0.06);
  const fenderF = 0.04 * gauss(t, tOf(FZ), 0.06);
  const fenderR = 0.05 * gauss(t, tOf(RZ), 0.07);
  const dome = t > 0.03 && t < 0.33 ? 0.022 * Math.sin(((t - 0.03) / 0.3) * Math.PI) : 0;
  const mid = (top + bottom) / 2, hh = (top - bottom) / 2;
  const n = 5.2;
  for (let k = 0; k < ringN; k++) {
    const a = (k / ringN) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    let y = mid + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (s > 0) {
      const side = Math.pow(Math.min(1, Math.abs(x) / w), 2);
      y += (fenderF + fenderR) * side * Math.min(1, s * 3);
      // hood power dome with twin creases
      const ax = Math.abs(x) / w;
      y += dome * (ax < 0.42 ? 1 : Math.max(0, 1 - (ax - 0.42) * 6)) * s;
      y += 0.01 * (1 - side) * s;
    }
    if (s < -0.2) x *= 0.975;
    out.push(x, y, z);
  }
}

function cabinSection(u: number, ringN: number, out: number[]) {
  const z = CZ0 + u * (CZ1 - CZ0);
  const t = tOf(z);
  const base = curve(TOP, t) - 0.02;
  const top = Math.max(base + 0.02, curve(CABIN_TOP, u));
  const wBase = curve(HALF_W, t) * (0.9 - 0.04 * u * u);
  const wTop = wBase * 0.8;
  const n = 4.5;
  for (let k = 0; k < ringN; k++) {
    const a = (k / (ringN - 1)) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const yy = base + (top - base) * Math.pow(s, 2 / n);
    const f = (yy - base) / Math.max(0.001, top - base);
    const w = wBase + (wTop - wBase) * f;
    out.push(w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), yy, z);
  }
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Roundel-style badge texture (procedural). */
function roundelTexture() {
  return canvasTex(256, 256, (c) => {
    const r = 128;
    c.fillStyle = '#c9ccd0'; c.beginPath(); c.arc(r, r, 127, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111316'; c.beginPath(); c.arc(r, r, 118, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.font = 'bold 44px Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const letters = ['B', 'M', 'W'];
    letters.forEach((ch, i) => {
      const ang = -Math.PI / 2 + (i - 1) * 0.62;
      c.save(); c.translate(r + Math.cos(ang) * 92, r + Math.sin(ang) * 92); c.rotate(ang + Math.PI / 2); c.fillText(ch, 0, 2); c.restore();
    });
    const q = [['#ffffff', 0], ['#2a7fd4', 1], ['#ffffff', 2], ['#2a7fd4', 3]] as const;
    for (const [col, k] of q) {
      c.fillStyle = col; c.beginPath(); c.moveTo(r, r); c.arc(r, r, 72, -Math.PI / 2 + k * Math.PI / 2, -Math.PI / 2 + (k + 1) * Math.PI / 2); c.closePath(); c.fill();
    }
    c.strokeStyle = '#c9ccd0'; c.lineWidth = 4; c.beginPath(); c.arc(r, r, 73, 0, Math.PI * 2); c.stroke();
  });
}

/** M-division style stripes + model text badge. */
function mBadgeTexture(text: string, w = 256, h = 128) {
  return canvasTex(w, h, (c) => {
    c.clearRect(0, 0, w, h);
    const stripe = ['#3fa9f5', '#2b2f86', '#e1242a'];
    const sw = h * 0.16;
    stripe.forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      const x = 8 + i * sw * 1.05;
      c.moveTo(x + sw * 0.55, 8); c.lineTo(x + sw * 1.55, 8); c.lineTo(x + sw, h - 8); c.lineTo(x, h - 8); c.closePath(); c.fill();
    });
    c.fillStyle = '#d7dade';
    c.font = `italic bold ${Math.floor(h * 0.78)}px Helvetica, Arial, sans-serif`;
    c.textBaseline = 'middle';
    c.fillText(text, 8 + sw * 3.6, h / 2 + 4);
  });
}

function carbonTexture() {
  const t = canvasTex(128, 128, (c) => {
    c.fillStyle = '#111214'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
      const odd = ((x + y) / 8) % 2 === 0;
      const g = c.createLinearGradient(x, y, odd ? x + 8 : x, odd ? y : y + 8);
      g.addColorStop(0, '#1b1d20'); g.addColorStop(0.5, '#2c2f33'); g.addColorStop(1, '#16171a');
      c.fillStyle = g; c.fillRect(x, y, 8, 8);
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

export function buildM3(paintHex = M3_PAINTS[0].color, matte = false): CarRig {
  const root = new Group();
  root.name = 'M3 Competition';
  const body = new Group();
  root.add(body);
  const badges = new Group();
  badges.name = 'badges';
  body.add(badges);
  const looseBadges: Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0], key: string) => track(withFog(new MeshStandardMaterial(o), undefined, key));

  const paint = track(flakePaint(new MeshPhysicalMaterial({ color: new Color(paintHex), envMapIntensity: 0.42 }), 'm3paint'));
  applyPaint(paint, paintHex, matte);
  const gloss = track(withFog(new MeshPhysicalMaterial({ color: 0x050607, roughness: 0.2, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.45 }), undefined, 'm3gloss'));
  const carbonTex = track(carbonTexture());
  const carbon = track(withFog(new MeshPhysicalMaterial({ map: carbonTex, color: 0x9a9a9a, roughness: 0.38, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.35 }), undefined, 'm3carbon'));
  const trim = std({ color: 0x0f1012, roughness: 0.6, metalness: 0.1 }, 'm3trim');
  const glass = track(withFog(new MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.02, metalness: 0.4, transparent: true, opacity: 0.9, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.8 }), undefined, 'm3glass'));
  const liner = std({ color: 0x1a1a1b, roughness: 0.9, side: DoubleSide }, 'm3liner');
  const leather = std({ color: 0x1d1d1f, roughness: 0.65 }, 'm3leather');
  const merino = std({ color: 0x8a2a14, roughness: 0.7 }, 'm3merino');
  const blackChrome = std({ color: 0x1a1b1e, roughness: 0.22, metalness: 0.9, envMapIntensity: 0.5 }, 'm3blackchrome');
  const tireMat = std({ color: 0x141414, roughness: 0.93 }, 'm3tire');
  const rimMat = std({ color: 0x24262a, roughness: 0.32, metalness: 0.85 }, 'm3rim');
  const discMat = std({ color: 0x5b5e61, roughness: 0.38, metalness: 0.9, emissive: new Color(1, 0.25, 0.02), emissiveIntensity: 0 }, 'm3disc');
  const caliperMat = std({ color: 0xb3121a, roughness: 0.35, metalness: 0.25 }, 'm3caliper');
  drilledDisc(discMat);
  const lightMat = (color: number, emissive: number) => track(new MeshStandardMaterial({ color, emissive: new Color(emissive), emissiveIntensity: 0, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.25 }));
  const headlightMat = lightMat(0xe6ebf2, 0xf2f6ff);
  const drlMat = lightMat(0xf5e7b8, 0xffe7a3);
  const tailMat = lightMat(0x7a0710, 0xff1a10);
  const brakeMat = lightMat(0x7a0710, 0xff2010);
  const indicatorL = lightMat(0x3a2405, 0xff8a00);
  const indicatorR = lightMat(0x3a2405, 0xff8a00);
  const reverseMat = lightMat(0x252525, 0xffffff);
  const lensDark = track(withFog(new MeshPhysicalMaterial({ color: 0x0b0c10, roughness: 0.05, metalness: 0.5, clearcoat: 1, transparent: true, opacity: 0.88 }), undefined, 'm3lens'));

  const add = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: Object3D = body) => {
    track(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };

  // ---------------------------------------------------------------- body shell
  const RING = 36, SECT = 120;
  const sections: number[][] = [];
  for (let i = 0; i < SECT; i++) { const s: number[] = []; bodySection(i / (SECT - 1), RING, s); sections.push(s); }
  const shell = new Mesh(track(loftGeometry(sections, RING, true, true)), paint);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // ---------------------------------------------------------------- greenhouse: paint / shadowline trim / glass / carbon roof
  const CR = 30, CS = 56;
  const cs: number[][] = [];
  for (let i = 0; i < CS; i++) { const s: number[] = []; cabinSection(i / (CS - 1), CR, s); cs.push(s); }
  const cab = loftGeometry(cs, CR, false, false);
  const classify = (x: number, y: number, z: number) => {
    const u = (z - CZ0) / (CZ1 - CZ0);
    const t = tOf(z);
    const base = curve(TOP, t);
    const top = curve(CABIN_TOP, u);
    const rel = (y - base) / Math.max(0.01, top - base);
    const wb = curve(HALF_W, t) * 0.9;
    const side = Math.abs(x) / (wb * (1 - 0.2 * rel));
    if (rel < 0.1) return 1; // Shadowline window trim
    if (u > 0.3 && u < 0.68 && rel > 0.84) return side < 0.74 ? 3 : 0; // carbon roof with body-colour rails
    if (u < 0.3 && side > 0.93) return 0; // A pillars
    if (u > 0.386 && u < 0.44 && side > 0.78) return 1; // gloss-black B pillar
    if (u > 0.74 && side > 0.66) return 0; // C pillar sail
    if (rel > 0.8 && side > 0.8) return 1; // upper window frame
    return 2;
  };
  const [cPaint, cTrim, cGlass, cCarbon] = splitQuadsN(cab, 4, classify);
  cab.dispose();
  for (const [g, m] of [[cPaint, paint], [cTrim, gloss], [cGlass, glass], [cCarbon, carbon]] as const) {
    track(g);
    const mesh = new Mesh(g, m);
    mesh.castShadow = true;
    if (m === glass) mesh.renderOrder = 2;
    body.add(mesh);
  }
  // carbon roof needs UVs for the weave
  {
    const p = cCarbon.getAttribute('position');
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.6; uv[i * 2 + 1] = p.getZ(i) * 0.6; }
    cCarbon.setAttribute('uv', new BufferAttribute(uv, 2));
  }
  const interior = new Group();
  for (const g of [cPaint, cTrim, cCarbon]) interior.add(new Mesh(track(flipped(g)), liner));
  body.add(interior);

  // ---------------------------------------------------------------- front fascia
  const FZF = Z0; // front face plane
  // kidney grilles: tall, slightly trapezoidal, gloss-black frame with horizontal slats
  const kidney = (wTop: number, wBot: number, h: number, r: number) => {
    const s = new Shape();
    const ht = h / 2;
    s.moveTo(-wBot / 2 + r, -ht);
    s.lineTo(wBot / 2 - r, -ht);
    s.quadraticCurveTo(wBot / 2, -ht, wBot / 2, -ht + r);
    s.lineTo(wTop / 2, ht - r);
    s.quadraticCurveTo(wTop / 2, ht, wTop / 2 - r, ht);
    s.lineTo(-wTop / 2 + r, ht);
    s.quadraticCurveTo(-wTop / 2, ht, -wTop / 2, ht - r);
    s.lineTo(-wBot / 2, -ht + r);
    s.quadraticCurveTo(-wBot / 2, -ht, -wBot / 2 + r, -ht);
    return s;
  };
  for (const sx of [-1, 1]) {
    const cx = sx * 0.195;
    // surround (black chrome) -> gloss-black insert -> horizontal slats, each layer slightly further forward
    const frame = add(new ExtrudeGeometry(kidney(0.33, 0.36, 0.47, 0.07), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 8 }), gloss, cx, -0.3, FZF - 0.055);
    frame.castShadow = true;
    add(new ExtrudeGeometry(kidney(0.295, 0.325, 0.43, 0.06), { depth: 0.006, bevelEnabled: false, curveSegments: 8 }), trim, cx, -0.3, FZF - 0.075);
    for (let k = 0; k < 7; k++) {
      const yy = -0.3 - 0.18 + k * 0.06;
      const ww = 0.31 - (k / 6) * 0.03;
      add(new BoxGeometry(ww, 0.012, 0.008), blackChrome, cx, yy, FZF - 0.08);
    }
  }
  // headlights: angular wedge housings with twin L-shaped DRL "eyebrows" and projector modules
  for (const sx of [-1, 1]) {
    const hs = new Shape();
    const pts: [number, number][] = [[0.4, -0.115], [0.42, -0.065], [0.76, -0.01], [0.8, -0.045], [0.78, -0.105], [0.6, -0.125]];
    pts.forEach(([x, y], i) => (i ? hs.lineTo(sx * x, y) : hs.moveTo(sx * x, y)));
    hs.closePath();
    const housing = add(new ExtrudeGeometry(hs, { depth: 0.035, bevelEnabled: false }), lensDark, 0, 0, FZF - 0.03);
    housing.renderOrder = 3;
    for (const [x0, x1] of [[0.47, 0.6], [0.63, 0.77]] as const) {
      const xm = (x0 + x1) / 2;
      add(new BoxGeometry(x1 - x0, 0.012, 0.012), drlMat, sx * xm, -0.03 + (xm - 0.6) * 0.1, FZF - 0.036, 0, 0, sx * 0.06);
      add(new BoxGeometry(0.012, 0.05, 0.012), drlMat, sx * x0, -0.055 + (x0 - 0.6) * 0.1, FZF - 0.036);
    }
    add(new CylinderGeometry(0.03, 0.03, 0.02, 16), headlightMat, sx * 0.54, -0.075, FZF - 0.04, Math.PI / 2);
    add(new CylinderGeometry(0.03, 0.03, 0.02, 16), headlightMat, sx * 0.7, -0.06, FZF - 0.04, Math.PI / 2);
    add(new BoxGeometry(0.12, 0.012, 0.012), sx < 0 ? indicatorL : indicatorR, sx * 0.76, -0.085, FZF - 0.036);
    // side air intakes + curtains
    const si = new Shape();
    [[0.45, -0.33], [0.76, -0.27], [0.78, -0.5], [0.5, -0.55]].forEach(([x, y], i) => (i ? si.lineTo(sx * x, y) : si.moveTo(sx * x, y)));
    si.closePath();
    add(new ExtrudeGeometry(si, { depth: 0.03, bevelEnabled: false }), trim, 0, 0, FZF - 0.02);
    add(new BoxGeometry(0.03, 0.2, 0.03), gloss, sx * 0.84, -0.4, FZF + 0.02);
  }
  // lower centre intake + splitter
  add(new BoxGeometry(0.7, 0.07, 0.03), trim, 0, -0.565, FZF - 0.02);
  add(new BoxGeometry(1.62, 0.025, 0.12), carbon, 0, -0.615, FZF + 0.02);
  // roundel on the nose + M3 badge on the grille
  const roundel = track(roundelTexture());
  const roundelMat = track(new MeshStandardMaterial({ map: roundel, transparent: true, roughness: 0.3, metalness: 0.4 }));
  add(new CircleGeometry(0.04, 32), roundelMat, 0, -0.03, FZF - 0.022, -0.45, Math.PI, 0, badges);
  const m3Tex = track(mBadgeTexture('M3'));
  const m3Mat = track(new MeshStandardMaterial({ map: m3Tex, transparent: true, roughness: 0.35, metalness: 0.5 }));
  add(new PlaneGeometry(0.11, 0.055), m3Mat, -0.2, -0.13, FZF - 0.09, 0, Math.PI, 0, badges);

  // ---------------------------------------------------------------- sides
  const mTex = track(mBadgeTexture('', 128, 128));
  const mMat = track(new MeshStandardMaterial({ map: mTex, transparent: true, roughness: 0.35, metalness: 0.5 }));
  for (const sx of [-1, 1]) {
    // front-fender gill with M badge
    add(new BoxGeometry(0.012, 0.07, 0.26), gloss, sx * 0.962, 0.08, -0.98, 0, 0, sx * 0.05);
    add(new PlaneGeometry(0.06, 0.06), mMat, sx * 0.97, 0.085, -0.93, 0, sx * Math.PI / 2, 0, badges);
    // M mirrors with carbon caps
    add(new BoxGeometry(0.1, 0.03, 0.05), trim, sx * 0.95, 0.31, -0.62);
    add(new SphereGeometry(0.08, 16, 10).scale(1.25, 0.75, 0.85), carbon, sx * 1.04, 0.34, -0.62);
    add(new BoxGeometry(0.01, 0.006, 0.08), sx < 0 ? indicatorL : indicatorR, sx * 1.1, 0.32, -0.64);
    // flush door handles
    for (const z of [-0.3, 0.62]) add(new BoxGeometry(0.012, 0.025, 0.16), paint, sx * 0.935, 0.19, z);
    // side skirt
    add(new BoxGeometry(0.02, 0.04, 2.0), trim, sx * 0.9, -0.6, -0.04);
  }

  // door shut lines (front + rear doors) merged into one mesh, fuel flap
  const seam = std({ color: 0x050505, roughness: 0.9 }, 'm3seam');
  const sideX = (z: number, y: number) => {
    const t = tOf(z);
    const w = curve(HALF_W, t);
    const top = curve(TOP, t), bot = curve(BOTTOM, t);
    const mid = (top + bot) / 2, hh = (top - bot) / 2;
    const sN = Math.max(-1, Math.min(1, (y - mid) / hh));
    const c = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(sN), 5.2 / 2)), 2 / 5.2);
    return w * c + 0.003;
  };
  const seamParts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const z of [-0.86, 0.24, 1.16]) {
      for (let y = -0.5; y < 0.24; y += 0.04) seamParts.push(new BoxGeometry(0.004, 0.042, 0.006).translate(sx * sideX(z, y + 0.02), y + 0.02, z));
    }
    for (let z = -0.86; z < 1.16; z += 0.06) seamParts.push(new BoxGeometry(0.004, 0.006, 0.062).translate(sx * sideX(z + 0.03, -0.5), -0.5, z + 0.03));
  }
  const seamGeo = mergeGeometries(seamParts, false)!;
  for (const g of seamParts) g.dispose();
  add(seamGeo, seam, 0, 0, 0);
  add(new PlaneGeometry(0.15, 0.13), paint, sideX(1.62, 0.1) + 0.002, 0.1, 1.62, 0, Math.PI / 2, 0);

  // ---------------------------------------------------------------- rear
  const RZF = Z0 + L;
  for (const sx of [-1, 1]) {
    // L-shaped taillights wrapping into the trunk lid and around the corner
    const tl = new Shape();
    [[0.3, 0.125], [0.3, 0.19], [0.84, 0.205], [0.88, 0.16], [0.86, 0.07], [0.62, 0.07], [0.6, 0.125]].forEach(([x, y], i) => (i ? tl.lineTo(sx * x, y) : tl.moveTo(sx * x, y)));
    tl.closePath();
    const lamp = add(new ExtrudeGeometry(tl, { depth: 0.014, bevelEnabled: false }), tailMat, 0, 0, RZF - 0.002);
    lamp.renderOrder = 3;
    add(new BoxGeometry(0.46, 0.01, 0.006), brakeMat, sx * 0.57, 0.17, RZF + 0.014);
    add(new BoxGeometry(0.01, 0.08, 0.006), brakeMat, sx * 0.8, 0.12, RZF + 0.014);
    add(new BoxGeometry(0.03, 0.12, 0.14), tailMat, sx * 0.875, 0.13, RZF - 0.08);
    add(new BoxGeometry(0.09, 0.02, 0.01), sx < 0 ? indicatorL : indicatorR, sx * 0.72, 0.09, RZF + 0.03);
    add(new BoxGeometry(0.08, 0.025, 0.01), reverseMat, sx * 0.45, 0.14, RZF + 0.03);
    // reflectors
    add(new BoxGeometry(0.1, 0.02, 0.01), tailMat, sx * 0.72, -0.34, RZF + 0.005);
  }
  // carbon lip spoiler, diffuser, quad exhaust
  add(new BoxGeometry(1.3, 0.016, 0.06), carbon, 0, 0.318, RZF - 0.035, 0.18);
  add(new BoxGeometry(1.5, 0.11, 0.2), carbon, 0, -0.52, RZF - 0.06);
  for (const fx of [-0.18, 0, 0.18]) add(new BoxGeometry(0.01, 0.1, 0.18), carbon, fx, -0.52, RZF - 0.03);
  add(new BoxGeometry(0.52, 0.12, 0.02), trim, 0, -0.22, RZF + 0.002);
  const exhaust: Object3D[] = [];
  for (const x of [-0.5, -0.37, 0.37, 0.5]) {
    const e = add(new CylinderGeometry(0.05, 0.052, 0.12, 20, 1, true), blackChrome, x, -0.48, RZF + 0.01, Math.PI / 2);
    add(new CircleGeometry(0.046, 20), trim, x, -0.48, RZF - 0.02);
    exhaust.push(e);
  }
  add(new CircleGeometry(0.04, 32), roundelMat, 0, 0.23, RZF + 0.006, -0.1, 0, 0, badges);
  add(new PlaneGeometry(0.12, 0.06), m3Mat, 0.48, 0.235, RZF + 0.006, 0, 0, 0, badges);
  const compTex = track(canvasTex(256, 48, (c) => { c.fillStyle = '#d7dade'; c.font = 'bold italic 30px Helvetica, Arial, sans-serif'; c.textBaseline = 'middle'; c.fillText('COMPETITION', 4, 26); }));
  add(new PlaneGeometry(0.16, 0.03), track(new MeshStandardMaterial({ map: compTex, transparent: true, roughness: 0.35, metalness: 0.5 })), -0.48, 0.235, RZF + 0.006, 0, 0, 0, badges);

  // ---------------------------------------------------------------- interior
  add(new BoxGeometry(1.52, 0.14, 0.46), leather, 0, 0.24, -0.68, 0, 0, 0, interior);
  add(new BoxGeometry(1.4, 0.02, 0.02), carbon, 0, 0.19, -0.45, 0, 0, 0, interior);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gaugeTex = track(new CanvasTexture(canvas));
  const dashMat = track(new MeshBasicMaterial({ map: gaugeTex, toneMapped: false }));
  // curved display: cluster (live) + centre screen
  add(new PlaneGeometry(0.34, 0.13), dashMat, -0.38, 0.37, -0.52, -0.18, 0.08, 0, interior);
  const idrive = track(canvasTex(512, 200, (c) => {
    const g = c.createLinearGradient(0, 0, 512, 200); g.addColorStop(0, '#0a1a2f'); g.addColorStop(1, '#14324f');
    c.fillStyle = g; c.fillRect(0, 0, 512, 200);
    c.fillStyle = '#7fb6ff'; c.font = 'bold 30px Helvetica, Arial'; c.fillText('Navigation', 24, 50);
    c.strokeStyle = '#3d7bd1'; c.lineWidth = 6; c.beginPath(); c.moveTo(40, 170); c.bezierCurveTo(160, 90, 300, 160, 480, 70); c.stroke();
  }));
  add(new PlaneGeometry(0.34, 0.13), track(new MeshBasicMaterial({ map: idrive, toneMapped: false, color: 0x8899aa })), -0.03, 0.37, -0.52, -0.18, -0.1, 0, interior);
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(0.5, 0.13, 0.52), merino, sx * 0.38, -0.36, 0.22, 0, 0, 0, interior);
    add(new BoxGeometry(0.5, 0.7, 0.12), merino, sx * 0.38, -0.02, 0.52, -0.2, 0, 0, interior);
    add(new BoxGeometry(0.2, 0.12, 0.13), carbon, sx * 0.38, 0.2, 0.62, -0.2, 0, 0, interior);
    add(new BoxGeometry(0.05, 0.4, 1.9), leather, sx * 0.86, -0.17, 0.25, 0, 0, 0, interior);
  }
  add(new BoxGeometry(0.24, 0.22, 1.0), carbon, 0, -0.32, -0.02, 0, 0, 0, interior);
  add(new BoxGeometry(0.05, 0.06, 0.1), blackChrome, 0, -0.18, -0.05, 0, 0, 0, interior);
  // M steering wheel with tricolour stitching and red M1/M2 buttons
  const steeringWheel = new Group();
  steeringWheel.position.set(-0.38, 0.15, -0.26);
  steeringWheel.rotation.x = -0.3;
  interior.add(steeringWheel);
  add(new TorusGeometry(0.18, 0.026, 12, 40), leather, 0, 0, 0, 0, 0, 0, steeringWheel);
  for (const [col, x] of [[0x3fa9f5, -0.012], [0x2b2f86, 0], [0xe1242a, 0.012]] as const) add(new BoxGeometry(0.012, 0.03, 0.055), std({ color: col, roughness: 0.6 }, 'm3stitch' + col), x, 0.18, 0, 0, 0, 0, steeringWheel);
  add(new BoxGeometry(0.32, 0.04, 0.025), trim, 0, -0.01, 0, 0, 0, 0, steeringWheel);
  add(new BoxGeometry(0.04, 0.15, 0.025), trim, 0, -0.09, 0, 0, 0, 0, steeringWheel);
  add(new CylinderGeometry(0.055, 0.055, 0.04, 20), trim, 0, 0, 0.005, Math.PI / 2, 0, 0, steeringWheel);
  looseBadges.push(add(new CircleGeometry(0.025, 20), roundelMat, 0, 0, 0.028, 0, 0, 0, steeringWheel));
  for (const sx of [-1, 1]) add(new BoxGeometry(0.025, 0.02, 0.02), std({ color: 0xc8141a, roughness: 0.4, emissive: new Color(0.3, 0, 0), emissiveIntensity: 1 }, 'm3mbtn'), sx * 0.11, 0.045, 0.012, 0, 0, 0, steeringWheel);
  add(new CylinderGeometry(0.03, 0.03, 0.25, 10), trim, 0, 0, -0.13, Math.PI / 2, 0, 0, steeringWheel);
  // wipers
  const wipers: Object3D[] = [];
  for (const wx of [-0.46, 0.1]) {
    const pivot = new Group();
    pivot.position.set(wx, 0.265, -0.8);
    pivot.rotation.x = -0.6;
    body.add(pivot);
    add(new BoxGeometry(0.56, 0.012, 0.02), trim, 0.28, 0, 0, 0, 0, 0, pivot);
    wipers.push(pivot);
  }

  // ---------------------------------------------------------------- wheels: staggered 19"/20" Y-spoke forged look, red M calipers
  const wheels: WheelRig[] = [];
  for (const wd of CFG.wheels) {
    const pivot = new Group();
    pivot.position.set(wd.x, WHEEL_Y, wd.z);
    root.add(pivot);
    const spin = new Group();
    pivot.add(spin);
    const ro = wd.front ? 0.334 : 0.346;
    const width = wd.front ? 0.275 : 0.285;
    const ri = wd.front ? 0.243 : 0.255;
    const prof: Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      prof.push(new Vector2(ri + (ro - ri) * Math.pow(Math.sin(a), 0.3), -width / 2 + (width * i) / 14));
    }
    const tire = add(new LatheGeometry(prof, 36), tireMat, 0, 0, 0, 0, 0, Math.PI / 2, spin);
    tire.castShadow = true;
    const outer = wd.left ? -1 : 1;
    add(new CylinderGeometry(ri, ri, width * 0.92, 32, 1, true), rimMat, 0, 0, 0, 0, 0, Math.PI / 2, spin);
    add(new TorusGeometry(ri - 0.006, 0.008, 6, 40), blackChrome, outer * (width / 2 - 0.006), 0, 0, 0, Math.PI / 2, 0, spin);
    add(new CylinderGeometry(0.055, 0.06, 0.05, 16), rimMat, outer * (width / 2 - 0.03), 0, 0, 0, 0, Math.PI / 2, spin);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const face = outer * (width / 2 - 0.035);
      // main spoke then the Y split toward the rim
      add(new BoxGeometry(0.03, 0.11, 0.042), rimMat, face, Math.cos(a) * 0.105, Math.sin(a) * 0.105, a, 0, 0, spin);
      for (const da of [-0.2, 0.2]) {
        const b = a + da;
        add(new BoxGeometry(0.026, 0.1, 0.028), rimMat, face, Math.cos(b) * (ri - 0.06), Math.sin(b) * (ri - 0.06), b - da * 1.2, 0, 0, spin);
      }
    }
    looseBadges.push(add(new CircleGeometry(0.035, 24), roundelMat, outer * (width / 2 - 0.004), 0, 0, 0, outer * Math.PI / 2, 0, spin));
    const disc = add(new CylinderGeometry(0.19, 0.19, 0.032, 32), discMat, outer * 0.02, 0, 0, 0, 0, Math.PI / 2, spin) as Mesh;
    add(new BoxGeometry(0.07, 0.15, 0.2), caliperMat, outer * 0.04, 0.12, wd.front ? 0.06 : -0.06, 0, 0, 0, pivot);
    const blur = addWheelDetail(spin, pivot, { ri, ro, width, outer }, track);
    wheels.push({ pivot, spin, disc, blur });
  }

  // ---------------------------------------------------------------- lights
  const mkSpot = (sx: number) => {
    const s = new SpotLight(0xf3f6ff, 0, 90, 0.45, 0.55, 1.4);
    s.position.set(sx * 0.62, -0.06, FZF - 0.05);
    s.target.position.set(sx * 1.2, -0.75, -24);
    root.add(s);
    root.add(s.target);
    return s;
  };
  const spotL = mkSpot(-1);
  const spotR = mkSpot(1);

  return {
    root, body, paint, wheels, steeringWheel, headlightMat, tailMat, brakeMat, indicatorL, indicatorR, reverseMat, discMat, dashMat,
    gauge: { canvas, ctx, tex: gaugeTex }, spotL, spotR, wipers, interior, exhaust, mounts: M3_MOUNTS, badges,
    setPaint(hex: string, mt = false) { applyPaint(paint, hex, mt); },
    dispose() { for (const d of disposables) d.dispose(); spotL.dispose(); spotR.dispose(); },
    drl: drlMat,
    setBadges(on: boolean) { badges.visible = on; for (const b of looseBadges) b.visible = on; },
  };
}
