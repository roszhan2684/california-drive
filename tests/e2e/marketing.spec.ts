import { expect, test, type Page } from '@playwright/test';
// Opt-in: screenshots for the marketing site, taken from the PUBLIC build (VITE_PUBLIC_BUILD=1 → Vireo S6 only).
// VITE_PUBLIC_BUILD=1 npm run build && CD_MARKETING=1 npx playwright test marketing
test.skip(!process.env.CD_MARKETING, 'opt-in');
test.use({ viewport: { width: 1600, height: 900 } });
const OUT = 'site/media/raw/';

async function go(page: Page, q: string) {
  await page.goto(`/?${q}&skip=1`);
  await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000 }).toBe('drive');
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 150_000 }).toBe(0);
}
const hideHud = (page: Page) => page.addStyleTag({ content: '#ui { display: none !important; }' });

// [file, query, cameras to cycle, keep HUD, extra]
const SHOTS: [string, string, number, boolean, string?][] = [
  ['sf-golden', 'city=sf&time=golden&weather=fog', 0, false],
  ['la-day', 'city=la&time=day&weather=clear&at=34.0505,-118.2500', 0, false],
  ['la-night', 'city=la&time=night&weather=clear&at=34.0505,-118.2500', 0, false],
  ['sd-golden', 'city=sd&time=golden&weather=clear', 0, false],
  ['tahoe-snow', 'city=tahoe&time=day&weather=snow', 0, false],
  ['yosemite-golden', 'city=yosemite&time=golden&weather=clear', 0, false],
  ['sf-rain-night', 'city=sf&time=night&weather=rain', 0, false],
  ['smc-wheel-night', 'city=smc&time=night&weather=clear&at=34.00890,-118.49700', 0, false, 'wheel'],
  ['smc-wheel-golden', 'city=smc&time=golden&weather=clear&at=34.00890,-118.49700', 0, false, 'wheel'],
  ['hud-lock', 'city=sf&time=day&weather=clear&at=37.7990,-122.4005', 0, true],
  ['hud-cockpit-night', 'city=sf&time=night&weather=clear', 3, true],
  ['debris', 'city=sf&time=golden&weather=clear', 0, false, 'crash'],
  ['sj-night', 'city=sj&time=night&weather=clear', 0, false],
  ['oak-dusk', 'city=oak&time=dusk&weather=overcast', 0, false],
  ['sac-golden', 'city=sac&time=golden&weather=clear', 0, false],
];

for (const [name, q, cams, hud, extra] of SHOTS) {
  test(`shot ${name}`, async ({ page }) => {
    await go(page, q);
    if (!hud) await hideHud(page);
    for (let i = 0; i < cams; i++) await page.keyboard.press('KeyC');
    if (extra === 'wheel') await page.evaluate(() => (window as any).__cd.viewLandmark(0, 62, 14));
    await page.waitForTimeout(hud ? 9000 : 5000);
    if (extra === 'crash') { await page.evaluate(() => (window as any).__cd.crash(1)); await page.waitForTimeout(350); }
    await page.screenshot({ path: `${OUT}${name}.png` });
  });
}

test('shot title + select + garage', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}title.png` });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 60_000 }).toBe('select');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}select.png` });
});
