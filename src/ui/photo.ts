import { el, qs, show } from './dom.ts';

export type PhotoFilter = 'natural' | 'golden' | 'noir' | 'vintage' | 'teal';

export const PHOTO_GRADES: Record<PhotoFilter, { contrast: number; saturation: number; lift: [number, number, number]; gain: [number, number, number]; vignette: number }> = {
  natural: { contrast: 1.12, saturation: 1.05, lift: [0, 0, 0], gain: [1, 1, 1], vignette: 0.28 },
  golden: { contrast: 1.1, saturation: 1.15, lift: [0.01, 0.0, -0.01], gain: [1.08, 1.0, 0.86], vignette: 0.38 },
  noir: { contrast: 1.3, saturation: 0.0, lift: [0, 0, 0], gain: [1, 1, 1], vignette: 0.55 },
  vintage: { contrast: 0.92, saturation: 0.7, lift: [0.04, 0.03, 0.01], gain: [1.05, 0.98, 0.85], vignette: 0.5 },
  teal: { contrast: 1.15, saturation: 1.1, lift: [-0.01, 0.01, 0.03], gain: [1.08, 0.98, 0.9], vignette: 0.35 },
};

/** Full-frame focal lengths (mm); vertical FOV = 2·atan(12 / f). */
export const LENSES = [16, 24, 35, 50, 85, 135];
export const APERTURES: [string, number][] = [['Off', 0], ['f/11', 11], ['f/5.6', 5.6], ['f/2.8', 2.8], ['f/1.4', 1.4]];
export const LETTERBOX: [string, number][] = [['Off', 0], ['1.85:1', 1.85], ['2.39:1', 2.39]];
export type PostcardTemplate = 'greetings' | 'polaroid' | 'poster' | 'clean';
export const TEMPLATES: [PostcardTemplate, string][] = [['greetings', 'Greetings from'], ['polaroid', 'Instant'], ['poster', 'Travel poster'], ['clean', 'Clean frame']];

export function focalToFov(mm: number): number {
  return (2 * Math.atan(12 / mm) * 180) / Math.PI;
}

/** BokehPass aperture for an f-number and focal length (longer lenses blur more at the same f-stop). */
export function apertureFor(fNumber: number, mm: number): number {
  return fNumber > 0 ? (0.0016 / fNumber) * (mm / 50) : 0;
}

/** Letterbox bar height (fraction of screen height) for a target aspect on a given screen aspect. */
export function letterboxFrac(target: number, screenAspect: number): number {
  return target > 0 && target > screenAspect ? (1 - screenAspect / target) / 2 : 0;
}

export interface PhotoHandlers {
  filter(f: PhotoFilter): void;
  fov(v: number): void;
  dof(fNumber: number): void;
  letterbox(aspect: number): void;
  postcard(): void;
  exit(): void;
}

export class PhotoUI {
  readonly root: HTMLElement;
  filter: PhotoFilter = 'natural';
  template: PostcardTemplate = 'greetings';
  lens = 35;
  fNumber = 0;

  constructor(ui: HTMLElement, h: PhotoHandlers) {
    const seg = (g: string, items: [string, string][], cur: string) => `<div class="seg" data-g="${g}">${items.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
    this.root = el('div', 'panel photo-ui hidden', `
      <div class="prow"><span class="lbl">Grade</span>${seg('f', (Object.keys(PHOTO_GRADES) as PhotoFilter[]).map((f) => [f, f[0].toUpperCase() + f.slice(1)]), 'natural')}</div>
      <div class="prow"><span class="lbl">Lens</span>${seg('lens', LENSES.map((m) => [String(m), `${m}`]), '35')}
        <span class="lbl">DOF</span>${seg('dof', APERTURES.map(([l, f]) => [String(f), l]), '0')}
        <span class="lbl">Frame</span>${seg('lb', LETTERBOX.map(([l, a]) => [String(a), l]), '0')}</div>
      <div class="prow"><span class="lbl">Card</span>${seg('tpl', TEMPLATES, 'greetings')}
        <button class="btn primary" data-a="postcard">Save postcard</button>
        <button class="btn" data-a="exit">Exit <kbd>F</kbd></button>
      </div>`);
    ui.appendChild(this.root);
    const bind = (g: string, fn: (v: string) => void) => this.root.querySelectorAll<HTMLButtonElement>(`[data-g=${g}] button`).forEach((b) => b.addEventListener('click', () => {
      this.root.querySelectorAll(`[data-g=${g}] button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      fn(b.dataset.v!);
    }));
    bind('f', (v) => { this.filter = v as PhotoFilter; h.filter(this.filter); });
    bind('lens', (v) => { this.lens = Number(v); h.fov(focalToFov(this.lens)); h.dof(this.fNumber); });
    bind('dof', (v) => { this.fNumber = Number(v); h.dof(this.fNumber); });
    bind('lb', (v) => h.letterbox(Number(v)));
    bind('tpl', (v) => { this.template = v as PostcardTemplate; });
    qs(this.root, '[data-a=postcard]').addEventListener('click', () => h.postcard());
    qs(this.root, '[data-a=exit]').addEventListener('click', () => h.exit());
  }

  show(on: boolean) {
    show(this.root, on);
  }
}

export interface PostcardInfo { city: string; district: string; lat: number; lon: number; time: string; filter: PhotoFilter; template?: PostcardTemplate }

/** Draw `src` into a rect with cover-cropping. */
function drawCover(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number, w: number, h: number, filter = 'none') {
  const sr = src.width / src.height, dr = w / h;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sr > dr) { sw = src.height * dr; sx = (src.width - sw) / 2; } else { sh = src.width / dr; sy = (src.height - sh) / 2; }
  ctx.save();
  ctx.filter = filter;
  ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function coords(i: PostcardInfo) {
  return `${i.lat.toFixed(4)}° N  ${Math.abs(i.lon).toFixed(4)}° W`;
}

function finish(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** Instant-film print: square-ish photo on a thick white frame with handwritten caption. */
function polaroid(src: HTMLCanvasElement, info: PostcardInfo) {
  const W = 1300, H = 1560;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f5ef';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const p = 80;
  drawCover(ctx, src, p, p, W - p * 2, W - p * 2, 'saturate(1.12) contrast(1.06) sepia(0.12)');
  ctx.fillStyle = 'rgba(255,240,210,0.08)';
  ctx.fillRect(p, p, W - p * 2, W - p * 2);
  ctx.fillStyle = '#26303a';
  ctx.font = 'italic 64px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  ctx.fillText(`${info.district}, ${info.city}`, p + 10, W + 130, W - p * 2 - 20);
  ctx.font = '30px "Courier New", monospace';
  ctx.fillStyle = '#6b7480';
  ctx.fillText(`${info.time} · ${coords(info)}`, p + 10, W + 200);
  return finish(c);
}

/** Mid-century travel poster: posterized photo, bold sky band and stacked type. */
function poster(src: HTMLCanvasElement, info: PostcardInfo) {
  const W = 1200, H = 1800;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f1e6cf';
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, src, 60, 300, W - 120, H - 700, 'contrast(1.35) saturate(1.4)');
  // posterize by quantizing the photo area
  const img = ctx.getImageData(60, 300, W - 120, H - 700);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / 51) * 51;
  ctx.putImageData(img, 60, 300);
  ctx.fillStyle = '#e8572a';
  ctx.fillRect(60, 60, W - 120, 220);
  ctx.fillStyle = '#f1e6cf';
  ctx.font = '800 150px "Barlow Condensed", Impact, "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(info.city.toUpperCase(), W / 2, 230, W - 180);
  ctx.fillStyle = '#1d3b53';
  ctx.font = '800 96px "Barlow Condensed", Impact, sans-serif';
  ctx.fillText('CALIFORNIA', W / 2, H - 250);
  ctx.font = '600 44px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = '#7a3b22';
  ctx.fillText(`${info.district.toUpperCase()}  ·  BY ROAD`, W / 2, H - 175);
  ctx.font = '26px "Courier New", monospace';
  ctx.fillStyle = '#5a4a3a';
  ctx.fillText(`${coords(info)}  ·  ${info.time}`, W / 2, H - 110);
  return finish(c);
}

/** Clean gallery frame: full-bleed photo with a slim caption bar. */
function clean(src: HTMLCanvasElement, info: PostcardInfo) {
  const W = 2000, H = 1250;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, src, 0, 0, W, H - 110);
  ctx.fillStyle = '#eef2f6';
  ctx.font = '800 52px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText(`${info.district.toUpperCase()} — ${info.city.toUpperCase()}`, 48, H - 40);
  ctx.textAlign = 'right';
  ctx.font = '600 28px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = '#94a3b4';
  ctx.fillText(`${coords(info)}   ${info.time}   CALIFORNIA DRIVE`, W - 48, H - 46);
  return finish(c);
}

/** Compose a California postcard from the current frame (template chosen in photo mode). */
export function composePostcard(src: HTMLCanvasElement, info: PostcardInfo): Promise<Blob | null> {
  if (info.template === 'polaroid') return polaroid(src, info);
  if (info.template === 'poster') return poster(src, info);
  if (info.template === 'clean') return clean(src, info);
  const W = 1800, H = 1200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  // paper
  ctx.fillStyle = '#efe4cf';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(120,90,50,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // photo with deckled white border
  const px = 60, py = 60, pw = W - 120, ph = H - 260;
  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(px - 14, py - 14, pw + 28, ph + 28);
  const sr = src.width / src.height, dr = pw / ph;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sr > dr) { sw = src.height * dr; sx = (src.width - sw) / 2; } else { sh = src.width / dr; sy = (src.height - sh) / 2; }
  ctx.save();
  ctx.filter = info.filter === 'vintage' || info.filter === 'natural' ? 'sepia(0.35) saturate(1.15) contrast(1.05)' : 'none';
  ctx.drawImage(src, sx, sy, sw, sh, px, py, pw, ph);
  ctx.restore();
  const grad = ctx.createRadialGradient(W / 2, py + ph / 2, ph * 0.3, W / 2, py + ph / 2, pw * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(40,20,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, pw, ph);
  // "Greetings from" block letters over the photo
  ctx.save();
  ctx.translate(px + 70, py + ph - 70);
  ctx.rotate(-0.04);
  ctx.font = 'italic 700 64px Georgia, "Times New Roman", serif';
  ctx.fillStyle = '#fff6e3';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 10;
  ctx.fillText('Greetings from', 0, -150);
  ctx.font = '900 150px Impact, "Arial Black", system-ui, sans-serif';
  const word = info.city.toUpperCase();
  const g2 = ctx.createLinearGradient(0, -140, 0, 0);
  g2.addColorStop(0, '#ffd29a');
  g2.addColorStop(0.5, '#ff7a3d');
  g2.addColorStop(1, '#c2185b');
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#2b1a10';
  ctx.strokeText(word, 0, 0, pw - 160);
  ctx.fillStyle = g2;
  ctx.fillText(word, 0, 0, pw - 160);
  ctx.restore();
  // caption strip
  ctx.fillStyle = '#3b2a1c';
  ctx.font = '600 34px Georgia, serif';
  ctx.fillText(info.district, 70, H - 120);
  ctx.font = '26px "Courier New", monospace';
  ctx.fillStyle = '#6b5440';
  ctx.fillText(`${info.lat.toFixed(4)}° N  ${Math.abs(info.lon).toFixed(4)}° W   ·   ${info.time}   ·   California Drive`, 70, H - 72);
  // stamp + postmark
  ctx.save();
  ctx.translate(W - 230, H - 175);
  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(0, 0, 150, 120);
  ctx.strokeStyle = '#c2185b';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 138, 108);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff7a3d';
  ctx.beginPath();
  ctx.arc(75, 62, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b1a10';
  ctx.font = 'bold 22px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText('CA', 75, 70);
  ctx.restore();
  ctx.save();
  ctx.translate(W - 300, H - 110);
  ctx.rotate(-0.2);
  ctx.strokeStyle = 'rgba(60,40,30,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 16px "Courier New"';
  ctx.fillStyle = 'rgba(60,40,30,0.6)';
  ctx.textAlign = 'center';
  ctx.fillText(info.city.toUpperCase().slice(0, 14), 0, -8);
  ctx.fillText(new Date().getFullYear().toString(), 0, 16);
  ctx.restore();
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export function downloadBlob(b: Blob, name: string) {
  const url = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
