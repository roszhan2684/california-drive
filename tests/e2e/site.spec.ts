import { expect, test } from '@playwright/test';
// Opt-in checks for the marketing site: CD_SITE=1 SITE_URL=<url> npx playwright test site
test.skip(!process.env.CD_SITE, 'opt-in');
const URL = process.env.SITE_URL ?? 'http://127.0.0.1:8137/';
for (const [name, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]] as const) {
  test(`site ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(URL);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `qa-shots/site-${name}-hero.png` });
    await page.locator('#cities').scrollIntoViewIfNeeded();
    await page.locator('.ca-map .pin').nth(7).dispatchEvent('click');
    await page.waitForTimeout(800);
    await page.locator('#cities').screenshot({ path: `qa-shots/site-${name}-cities.png` });
    console.log(name, 'drive link:', await page.locator('[data-city-go]').getAttribute('href'), '| play:', await page.locator('[data-play]').first().getAttribute('href'));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    if (name === 'desktop') await page.screenshot({ path: `qa-shots/site-${name}-full.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(name, 'horizontal overflow px:', overflow, 'errors:', JSON.stringify(errors));
  });
}

test('site → Start the game opens the playable game', async ({ page }) => {
  await page.goto(URL);
  await page.locator('.hero [data-play]').click();
  await expect(page).toHaveURL(/roszhan2684\.github\.io\/california-drive/);
  await expect(page.locator('.title .logo')).toBeVisible({ timeout: 60_000 });
});

test('site → city card deep link drops you into that district', async ({ page }) => {
  await page.goto(URL);
  await page.locator('.ca-map .pin').nth(1).dispatchEvent('click');
  const href = await page.locator('[data-city-go]').getAttribute('href');
  await page.locator('[data-city-go]').click();
  await expect(page).toHaveURL(href!);
  await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000 }).toMatch(/reveal|drive/);
  console.log('deep link ok:', href);
});
