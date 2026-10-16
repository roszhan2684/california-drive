import { expect, test } from '@playwright/test';
// Opt-in: render a preview frame per city into public/previews (shown on city select / loading).
// CD_PREVIEWS=1 npx playwright test previews
test.skip(!process.env.CD_PREVIEWS, 'opt-in');
const CITIES = (process.env.CD_PREVIEW_CITIES ?? 'sf,la,sd,sj,oak,sac,smc,tahoe,yosemite').split(',');

for (const id of CITIES) {
  test(`preview ${id}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?city=${id}&skip=1`);
    await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000 }).toBe('drive');
    await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
    await page.keyboard.press('KeyC'); // close chase
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `public/previews/${id}.jpg`, type: 'jpeg', quality: 78 });
  });
}
