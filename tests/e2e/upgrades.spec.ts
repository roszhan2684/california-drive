import { expect, test, type Page } from '@playwright/test';
// Opt-in QA captures for the free-asset upgrade pass (Kenney fleet, debris, HUD boot, radar, lock, Ferris wheel).
// CD_UPGRADES=1 npx playwright test upgrades
test.skip(!process.env.CD_UPGRADES, 'opt-in');
const SHOTS = 'qa-shots/upgrades/';

async function drive(page: Page, q: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/?${q}&skip=1`);
  await expect.poll(() => page.evaluate(() => (window as any).__cd?.state), { timeout: 200_000 }).toBe('drive');
  return errors;
}

test('HUD boot sequence, glyph hints and radar', async ({ page }) => {
  const errors = await drive(page, 'city=la&time=day&weather=clear');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}hud-boot.png` });
  await expect(page.locator('.hint .glyph').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}hud-settled.png` });
  const fleet = await page.evaluate(() => (window as any).__cd.fleet);
  console.log('fleet', JSON.stringify(fleet));
  expect(errors).toEqual([]);
});

test('Kenney traffic fleet on a busy LA street', async ({ page }) => {
  await drive(page, 'city=la&time=day&weather=clear&at=34.0505,-118.2500');
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
  // let traffic spawn up to its cap, then look for fleet variants
  await expect.poll(async () => Object.keys(await page.evaluate(() => (window as any).__cd.fleet)).length, { timeout: 90_000 }).toBeGreaterThan(4);
  const fleet = await page.evaluate(() => (window as any).__cd.fleet);
  console.log('fleet', JSON.stringify(fleet));
  await page.screenshot({ path: `${SHOTS}la-traffic.png` });
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}la-traffic-2.png` });
});

test('crash debris', async ({ page }) => {
  await drive(page, 'city=sf&time=golden&weather=clear');
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as any).__cd.crash(1));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}debris-air.png` });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}debris-rest.png` });
});

test('emergency vehicles (night)', async ({ page }) => {
  await drive(page, 'city=la&time=night&weather=clear&at=34.0505,-118.2500');
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
  await page.waitForTimeout(8000);
  console.log('fleet', JSON.stringify(await page.evaluate(() => (window as any).__cd.fleet)));
  await page.screenshot({ path: `${SHOTS}la-night-traffic.png` });
});

test('target lock on a nearby activity', async ({ page }) => {
  // SF Pier Lot Drift is ~150 m from here
  await drive(page, 'city=sf&time=day&weather=clear&at=37.7990,-122.4005');
  await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__cd.lock), { timeout: 30_000 }).toMatch(/acquiring|locked/);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}lock.png` });
});

for (const time of ['golden', 'night']) {
  test(`Santa Monica Ferris wheel (${time})`, async ({ page }) => {
    await drive(page, `city=smc&time=${time}&weather=clear&at=34.00890,-118.49700`);
    await expect.poll(() => page.evaluate(() => (window as any).__cd.pending), { timeout: 120_000 }).toBe(0);
    await page.evaluate(() => (window as any).__cd.viewLandmark(0));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}smc-wheel-${time}.png` });
  });
}
