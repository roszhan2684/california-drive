// Downloads the small set of CC0 / OFL assets used by the game into public/media.
// Usage: node --experimental-strip-types tools/fetch-assets.ts
// Every asset here is recorded in ASSET_LICENSES.md. Poly Haven and Kenney assets are CC0
// (https://polyhaven.com/license, https://kenney.nl/support); the fonts are SIL Open Font License 1.1.
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const PH = 'https://dl.polyhaven.org/file/ph-assets';
const ASSETS: { url: string; out: string }[] = [
  { url: `${PH}/HDRIs/hdr/1k/kloofendal_38d_partly_cloudy_puresky_1k.hdr`, out: 'hdri/sky_partly_cloudy_1k.hdr' },
  ...['brick_wall_001', 'white_stucco', 'concrete_wall_008', 'weathered_plank_siding', 'asphalt_02'].flatMap((id) => [
    { url: `${PH}/Textures/jpg/1k/${id}/${id}_diff_1k.jpg`, out: `tex/${id}_diff.jpg` },
    { url: `${PH}/Textures/jpg/1k/${id}/${id}_nor_gl_1k.jpg`, out: `tex/${id}_nor.jpg` },
  ]),
  { url: 'https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-SemiBold.ttf', out: 'fonts/BarlowCondensed-SemiBold.ttf' },
  { url: 'https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf', out: 'fonts/BarlowCondensed-ExtraBold.ttf' },
  { url: 'https://github.com/google/fonts/raw/main/ofl/barlowcondensed/OFL.txt', out: 'fonts/OFL.txt' },
  // Google Fonts latin subsets (woff2) — URLs from https://fonts.googleapis.com/css2 (checked 2026-10-15)
  { url: 'https://fonts.gstatic.com/s/bebasneue/v16/JTUSjIg69CK48gW7PXoo9WlhyyTh89Y.woff2', out: 'fonts/BebasNeue-Regular.woff2' },
  { url: 'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2', out: 'fonts/Inter-Variable.woff2' },
  { url: 'https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pb0EPOreefkkbIx.woff2', out: 'fonts/Rajdhani-Medium.woff2' },
  { url: 'https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pbYF_OreefkkbIx.woff2', out: 'fonts/Rajdhani-SemiBold.woff2' },
  { url: 'https://fonts.gstatic.com/s/rajdhani/v17/LDI2apCSOBg7S-QT7pa8FvOreefkkbIx.woff2', out: 'fonts/Rajdhani-Bold.woff2' },
  { url: 'https://fonts.gstatic.com/s/sharetechmono/v16/J7aHnp1uDWRBEqV98dVQztYldFcLowEFA87Heg.woff2', out: 'fonts/ShareTechMono-Regular.woff2' },
  ...['bebasneue:BebasNeue', 'inter:Inter', 'rajdhani:Rajdhani', 'sharetechmono:ShareTechMono'].map((p) => {
    const [dir, name] = p.split(':');
    return { url: `https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`, out: `fonts/OFL-${name}.txt` };
  }),
];

// Kenney packs (CC0): only the files the game uses are copied out of each zip.
const KENNEY: { page: string; pick: { from: string; to: string }[] }[] = [
  {
    page: 'car-kit',
    pick: [
      ...['police', 'taxi', 'ambulance', 'firetruck', 'delivery', 'garbage-truck', 'truck', 'van', 'sedan-sports', 'suv-luxury', 'hatchback-sports',
        'debris-bumper', 'debris-tire', 'debris-plate-a', 'debris-plate-small-a', 'debris-door', 'debris-spoiler-a', 'debris-bolt', 'debris-nut']
        .map((f) => ({ from: `Models/GLB format/${f}.glb`, to: `kenney/car-kit/${f}.glb` })),
      { from: 'Models/GLB format/Textures/colormap.png', to: 'kenney/car-kit/Textures/colormap.png' },
      { from: 'License.txt', to: 'kenney/car-kit/License.txt' },
    ],
  },
  {
    page: 'input-prompts',
    pick: [
      ...[...'abcdefghijklmnopqrstuvwxyz0123456789'].map((k) => `keyboard_${k}`),
      ...['arrow_up', 'arrow_down', 'arrow_left', 'arrow_right', 'space', 'escape', 'shift', 'ctrl', 'alt', 'tab', 'enter', 'backspace'].map((k) => `keyboard_${k}`),
      ...Array.from({ length: 12 }, (_, i) => `keyboard_f${i + 1}`),
    ].map((f) => ({ from: `Keyboard & Mouse/Vector/${f}.svg`, to: `kenney/input-prompts/${f}.svg` }))
      .concat(['button_a', 'button_b', 'button_x', 'button_y', 'lb', 'rb', 'lt', 'rt', 'stick_l', 'stick_l_press', 'stick_r_press', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'button_menu', 'button_view']
        .map((f) => ({ from: `Xbox Series/Vector/xbox_${f}.svg`, to: `kenney/input-prompts/xbox_${f}.svg` })))
      .concat([{ from: 'License.txt', to: 'kenney/input-prompts/License.txt' }]),
  },
  {
    page: 'crosshair-pack',
    pick: ['006', '080', '105'].map((n) => ({ from: `Vector/Light/crosshair-${n}.svg`, to: `kenney/crosshairs/crosshair-${n}.svg` }))
      .concat([{ from: 'License.txt', to: 'kenney/crosshairs/License.txt' }]),
  },
];

for (const a of ASSETS) {
  const out = `public/media/${a.out}`;
  if (existsSync(out)) continue;
  const res = await fetch(a.url, { redirect: 'follow', headers: { 'User-Agent': 'CaliforniaDrive-assets/0.1' } });
  if (!res.ok) {
    // Poly Haven names some diffuse maps "_diffuse_" instead of "_diff_"
    const alt = a.url.replace('_diff_1k', '_diffuse_1k');
    const r2 = alt !== a.url ? await fetch(alt) : res;
    if (!r2.ok) throw new Error(`${a.url}: HTTP ${res.status}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await r2.arrayBuffer()));
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
  console.log('fetched', out);
}

for (const pack of KENNEY) {
  if (pack.pick.every((p) => existsSync(`public/media/${p.to}`))) continue;
  const html = await (await fetch(`https://kenney.nl/assets/${pack.page}`)).text();
  const zipUrl = html.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"]+\.zip/)?.[0];
  if (!zipUrl) throw new Error(`kenney ${pack.page}: download link not found`);
  const dir = mkdtempSync(join(tmpdir(), `kenney-${pack.page}-`));
  writeFileSync(join(dir, 'pack.zip'), Buffer.from(await (await fetch(zipUrl)).arrayBuffer()));
  // unzip only the entries we need (some packs contain non-UTF-8 folder names)
  execFileSync('unzip', ['-q', '-o', join(dir, 'pack.zip'), ...pack.pick.map((p) => p.from), '-d', join(dir, 'x')]);
  for (const p of pack.pick) {
    const out = `public/media/${p.to}`;
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(join(dir, 'x', p.from), out);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log('fetched kenney', pack.page, readdirSync(dirname(`public/media/${pack.pick[0].to}`)).length, 'files');
}
