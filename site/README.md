# California Drive: marketing site

Static landing page for [California Drive](https://roszhan2684.github.io/california-drive/). Plain HTML/CSS/JS, no build step. Deployed to Vercel from this folder (`vercel deploy --prod`).

- `data.js` is generated from the game's `src/ui/caMap.ts` and `src/world/cities.ts` (map outline + city list).
- Screenshots in `media/` are in-game frames from the public build (Vireo S6), captured with `CD_MARKETING=1 npx playwright test marketing` after `VITE_PUBLIC_BUILD=1 npm run build`, then converted to JPEG.
- Fonts (OFL) and key glyphs (Kenney, CC0) are copies of the game's assets; licenses sit next to them.
