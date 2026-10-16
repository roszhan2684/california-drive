import { expect, test } from '@playwright/test';
// Opt-in QA captures of specific places / moments. CD_PLACES=1 npx playwright test places
test.skip(!process.env.CD_PLACES, 'opt-in');
const SHOTS = 'qa-shots/places/';
const PLACES = (process.env.CD_PLACE_LIST ?? 'russian-hill:sf:day:37.80150,-122.41850:0;north-beach:sf:golden:37.79930,-122.40760:0').split(';');

for (const spec of PLACES) {
  const [name, city, time, at, cams, weather] = spec.split(':');
  test(`place ${name}`, async ({ page }) => {
    await page.goto(`/?city=${city}&time=${time}&weather=${weather ?? 'clear'}&skip=1&at=${at}`);
    await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000 }).toBe('drive');
    await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
    for (let i = 0; i < Number(cams ?? 0); i++) await page.keyboard.press('KeyC');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SHOTS}${name}.png` });
  });
}

test('title', async ({ page }) => {
  test.skip(!!process.env.CD_PLACE_LIST, 'only with default list');
  await page.goto('/');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}title.png` });
});
