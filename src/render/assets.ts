// Loads the small set of CC0 assets (Poly Haven) and packs facade textures into atlases.
// Rendering falls back to procedural noise until (or if) these load.
import { CanvasTexture, ClampToEdgeWrapping, EquirectangularReflectionMapping, ImageLoader, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type DataTexture, type Texture } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface GameAssets {
  hdri: DataTexture | null;
  facadeAlb: Texture;
  facadeNor: Texture;
  asphaltAlb: Texture;
  asphaltNor: Texture;
}

/** Facade atlas tiles: 0 brick, 1 stucco, 2 concrete, 3 wood siding (2×2 layout). */
const FACADES = ['brick_wall_001', 'white_stucco', 'concrete_wall_008', 'weathered_plank_siding'];

let pending: Promise<GameAssets | null> | null = null;

function base() {
  return `${import.meta.env.BASE_URL}media/`;
}

async function atlas(kind: 'diff' | 'nor', tile: number): Promise<Texture> {
  const loader = new ImageLoader();
  const imgs = await Promise.all(FACADES.map((id) => loader.loadAsync(`${base()}tex/${id}_${kind}.jpg`)));
  const c = document.createElement('canvas');
  c.width = c.height = tile * 2;
  const ctx = c.getContext('2d')!;
  imgs.forEach((img, i) => ctx.drawImage(img, (i % 2) * tile, Math.floor(i / 2) * tile, tile, tile));
  const t = new CanvasTexture(c);
  t.colorSpace = kind === 'diff' ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

async function tex(url: string, srgb: boolean): Promise<Texture> {
  const img = await new ImageLoader().loadAsync(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Load once; resolves to null if any asset is missing (game keeps procedural fallbacks). */
export function loadAssets(): Promise<GameAssets | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const [facadeAlb, facadeNor, asphaltAlb, asphaltNor, hdri] = await Promise.all([
        atlas('diff', 1024),
        atlas('nor', 512),
        tex(`${base()}tex/asphalt_02_diff.jpg`, true),
        tex(`${base()}tex/asphalt_02_nor.jpg`, false),
        new HDRLoader().loadAsync(`${base()}hdri/sky_partly_cloudy_1k.hdr`).catch(() => null),
      ]);
      if (hdri) hdri.mapping = EquirectangularReflectionMapping;
      return { hdri: hdri as DataTexture | null, facadeAlb, facadeNor, asphaltAlb, asphaltNor };
    } catch (e) {
      console.warn('assets unavailable, using procedural fallbacks', e);
      return null;
    }
  })();
  return pending;
}
