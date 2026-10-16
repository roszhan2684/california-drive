# Third-party notices

Verified with `npm run check:licenses`, which fails CI if any installed package lacks an approved open-source license.

## Runtime dependencies (shipped to players)

| Package | Version | License | Source |
|---|---|---|---|
| three | 0.186.x | MIT | https://github.com/mrdoob/three.js |
| @dimforge/rapier3d-compat | 0.21.x | Apache-2.0 | https://github.com/dimforge/rapier.js |
| lil-gui | 0.21.x | MIT | https://github.com/georgealways/lil-gui (loaded lazily for the F4 tuning panel) |

three.js addons used: `Sky`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `BokehPass`, `ShaderPass`, `OutputPass`, `SMAAPass`, `HDRLoader`, `GLTFLoader`, `BufferGeometryUtils` (all MIT, part of the three package).

## Development dependencies (not shipped)

| Package | License |
|---|---|
| typescript | Apache-2.0 |
| vite (+ rolldown) | MIT |
| vitest | MIT |
| @playwright/test | Apache-2.0 |
| pngjs | MIT |
| @types/three, @types/node, @types/pngjs | MIT |

## Data
- Map data © OpenStreetMap contributors, ODbL 1.0.
- Elevation: AWS Terrain Tiles (USGS 3DEP and other open sources), also used for the city-select relief.

## Media
- Textures and sky HDRI: Poly Haven, CC0 1.0 (https://polyhaven.com/license). See ASSET_LICENSES.md for the exact list.
- Vehicles, crash debris, input-prompt glyphs and reticles: Kenney (kenney.nl) Car Kit 3.1, Input Prompts 1.5 and Crosshair Pack, CC0 1.0. Each pack's `License.txt` ships next to its files in `public/media/kenney/`.
- Fonts (SIL Open Font License 1.1, self-hosted from Google Fonts): Bebas Neue © 2010 Dharma Type; Rajdhani © 2014 Indian Type Foundry; Share Tech Mono © 2012 Carrois Type Design (Reserved Font Name "Share"); Inter © 2020 The Inter Project Authors; Barlow Condensed © 2017 The Barlow Project Authors. License texts: `public/media/fonts/OFL*.txt`.

---

### MIT License (three.js, lil-gui)
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

### Apache License 2.0 (Rapier)
Licensed under the Apache License, Version 2.0. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.

### SIL Open Font License 1.1 (Bebas Neue, Rajdhani, Share Tech Mono, Inter, Barlow Condensed)
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the conditions in the license: the fonts may not be sold by themselves, Reserved Font Names may not be used by modified versions, and the license and copyright notice must be included. Full texts: `public/media/fonts/OFL*.txt` and https://openfontlicense.org.
