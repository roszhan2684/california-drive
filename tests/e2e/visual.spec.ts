import { expect, test } from '@playwright/test';

// Screenshot gallery for manual visual QA. Opt-in: CD_VISUAL=1 npx playwright test visual
const SHOTS = 'qa-shots/visual/';
const VIEWS = (process.env.CD_VIEWS ?? 'sf:golden:clear,sf:day:fog,la:dusk:clear,tahoe:day:snow,proving:day:clear').split(',');

test.skip(!process.env.CD_VISUAL, 'visual gallery is opt-in');

for (const v of VIEWS) {
  const [city, time, weather, cam, extra] = v.split(':');
  test(`gallery ${v}`, async ({ page }) => {
    await page.goto(`/?city=${city}&time=${time}&weather=${weather}&skip=1${extra ? '&' + extra.replace(/\+/g, '&') : ''}`);
    await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000, intervals: [1000] }).toBe('drive');
    if (cam) for (let i = 0; i < Number(cam); i++) await page.keyboard.press('KeyC');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}${v.replace(/:/g, '-')}.png` });
  });
}
