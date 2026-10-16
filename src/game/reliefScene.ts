// 3D California relief for the city-select screen: a hypsometric-tinted heightfield of the state
// (AWS Terrain Tiles, built by tools/build-ca-relief.ts), an ocean plane and glowing city pins.
import {
  BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineLoop, CylinderGeometry, DirectionalLight, Fog, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3,
} from 'three';
import { CA_OUTLINE } from '../ui/caMap.ts';

interface ReliefHeader { cols: number; rows: number; s: number; n: number; w: number; e: number }

const LAT0 = 37.25, LON0 = -119.25;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180), KZ = 110.57;
/** Vertical exaggeration (km of height per km of elevation). */
const EXAG = 7;

export function inCalifornia(lat: number, lon: number): boolean {
  let inside = false;
  const P = CA_OUTLINE;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ai, oi] = P[i], [aj, oj] = P[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
}

/** Hypsometric tint for an elevation in metres (inside the state). */
export function hypsoColor(h: number, out: Color): Color {
  const stops: [number, number, number, number][] = [
    [0, 0.36, 0.42, 0.26], [150, 0.48, 0.5, 0.3], [600, 0.62, 0.55, 0.36], [1300, 0.55, 0.42, 0.3], [2200, 0.5, 0.46, 0.44], [3200, 0.82, 0.82, 0.84], [4200, 1, 1, 1],
  ];
  if (h <= stops[0][0]) return out.setRGB(stops[0][1], stops[0][2], stops[0][3]);
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const t = (h - a[0]) / (b[0] - a[0]);
      return out.setRGB(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
    }
  }
  return out.setRGB(1, 1, 1);
}

export class ReliefScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  ready = false;
  private hdr: ReliefHeader | null = null;
  private heights: Int16Array | null = null;
  private pins = new Map<string, { head: Mesh; stem: Mesh; base: Vector3 }>();
  private focusPt = new Vector3();
  private look = new Vector3(0, 0, 0);
  private camPos = new Vector3(0, 900, 700);
  private t = 0;
  private selected = '';
  private pinMat = new MeshBasicMaterial({ color: new Color(1.0, 0.48, 0.24).multiplyScalar(2.2), toneMapped: false });
  private pinSel = new MeshBasicMaterial({ color: new Color(1.0, 0.9, 0.7).multiplyScalar(3), toneMapped: false });
  private stemMat = new MeshBasicMaterial({ color: 0xffb37a, transparent: true, opacity: 0.55 });

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(34, aspect, 5, 6000);
    this.scene.background = new Color(0x0a0e13);
    this.scene.fog = new Fog(0x0a0e13, 1300, 3200);
    const sun = new DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-600, 500, -300);
    this.scene.add(sun, new HemisphereLight(0x9fb8d6, 0x1a1410, 0.7));
  }

  async load(base: string): Promise<boolean> {
    try {
      const [hdr, bin] = await Promise.all([
        fetch(`${base}relief/ca-relief.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('relief header')))),
        fetch(`${base}relief/ca-relief.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('relief data')))),
      ]);
      this.hdr = hdr as ReliefHeader;
      this.heights = new Int16Array(bin);
      this.build();
      this.ready = true;
      return true;
    } catch (e) {
      console.warn('relief unavailable, keeping the flat map', e);
      return false;
    }
  }

  toLocal(lat: number, lon: number, out = new Vector3()) {
    return out.set((lon - LON0) * KX, 0, (LAT0 - lat) * KZ);
  }

  /** Elevation (m) at a lat/lon, bilinear. */
  elevation(lat: number, lon: number): number {
    const h = this.hdr, d = this.heights;
    if (!h || !d) return 0;
    const fx = ((lon - h.w) / (h.e - h.w)) * (h.cols - 1), fy = ((h.n - lat) / (h.n - h.s)) * (h.rows - 1);
    const x = Math.max(0, Math.min(h.cols - 2, Math.floor(fx))), y = Math.max(0, Math.min(h.rows - 2, Math.floor(fy)));
    const u = Math.min(1, Math.max(0, fx - x)), v = Math.min(1, Math.max(0, fy - y));
    const g = (cx: number, cy: number) => d[cy * h.cols + cx];
    return (g(x, y) * (1 - u) + g(x + 1, y) * u) * (1 - v) + (g(x, y + 1) * (1 - u) + g(x + 1, y + 1) * u) * v;
  }

  private build() {
    const h = this.hdr!, d = this.heights!;
    const g = new PlaneGeometry(1, 1, h.cols - 1, h.rows - 1);
    const pos = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new Color();
    const v = new Vector3();
    for (let r = 0; r < h.rows; r++) {
      const lat = h.n - ((h.n - h.s) * r) / (h.rows - 1);
      for (let k = 0; k < h.cols; k++) {
        const lon = h.w + ((h.e - h.w) * k) / (h.cols - 1);
        const i = r * h.cols + k;
        const m = d[i];
        const inside = inCalifornia(lat, lon);
        this.toLocal(lat, lon, v);
        const land = m > 0.5;
        pos.setXYZ(i, v.x, land ? (m / 1000) * EXAG : -0.6, v.z);
        if (!land) c.setRGB(0.05, 0.09, 0.13);
        else if (inside) hypsoColor(m, c);
        else hypsoColor(m, c).lerp(new Color(0.09, 0.1, 0.11), 0.72);
        col.set([c.r, c.g, c.b], i * 3);
      }
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    const land = new Mesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false }));
    this.scene.add(land);
    const sea = new Mesh(new PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x0c2233, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.9 }));
    sea.position.y = 0.05;
    this.scene.add(sea);
    // state border, lifted slightly above the terrain
    const ring: number[] = [];
    for (let i = 0; i < CA_OUTLINE.length; i++) {
      const [a, b] = [CA_OUTLINE[i], CA_OUTLINE[(i + 1) % CA_OUTLINE.length]];
      for (let s = 0; s < 8; s++) {
        const lat = a[0] + (b[0] - a[0]) * (s / 8), lon = a[1] + (b[1] - a[1]) * (s / 8);
        this.toLocal(lat, lon, v);
        ring.push(v.x, Math.max(0.3, (this.elevation(lat, lon) / 1000) * EXAG + 0.6), v.z);
      }
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(new Float32Array(ring), 3));
    this.scene.add(new LineLoop(bg, new LineBasicMaterial({ color: 0xffc89a, transparent: true, opacity: 0.55 })));
  }

  addPin(id: string, lat: number, lon: number) {
    const base = this.toLocal(lat, lon);
    base.y = Math.max(0, (this.elevation(lat, lon) / 1000) * EXAG);
    const stem = new Mesh(new CylinderGeometry(0.6, 0.6, 1, 6).translate(0, 0.5, 0), this.stemMat);
    stem.position.copy(base);
    stem.scale.y = 26;
    const head = new Mesh(new SphereGeometry(3.2, 14, 10), this.pinMat);
    head.position.copy(base).setY(base.y + 26);
    this.scene.add(stem, head);
    this.pins.set(id, { head, stem, base });
  }

  focus(id: string, lat: number, lon: number) {
    this.selected = id;
    this.toLocal(lat, lon, this.focusPt);
    this.focusPt.y = Math.max(0, (this.elevation(lat, lon) / 1000) * EXAG);
  }

  /** Screen position of a pin head (CSS px) and whether it is in front of the camera. */
  project(id: string, w: number, h: number): [number, number, boolean] | null {
    const p = this.pins.get(id);
    if (!p) return null;
    const v = p.head.position.clone().project(this.camera);
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2];
  }

  update(dt: number, viewW: number, viewH: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 2.2);
    // hover above and south of the selection with a slow drift, looking north-ish over the state
    const drift = Math.sin(this.t * 0.12) * 0.18;
    const want = new Vector3(this.focusPt.x + Math.sin(drift) * 520, this.focusPt.y + 560, this.focusPt.z + Math.cos(drift) * 520);
    this.camPos.lerp(want, k);
    this.look.lerp(this.focusPt, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
    // keep the map left of the info card
    this.camera.setViewOffset(viewW, viewH, viewW > 860 ? viewW * 0.2 : 0, viewW > 860 ? 0 : viewH * 0.18, viewW, viewH);
    for (const [id, p] of this.pins) {
      const sel = id === this.selected;
      const pulse = sel ? 1 + Math.sin(this.t * 4) * 0.18 : 1;
      p.head.material = sel ? this.pinSel : this.pinMat;
      p.head.scale.setScalar(sel ? 1.5 * pulse : 1);
      const ht = sel ? 40 : 26;
      p.stem.scale.y += (ht - p.stem.scale.y) * k;
      p.head.position.y = p.base.y + p.stem.scale.y;
    }
  }

  dispose() {
    this.scene.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}
