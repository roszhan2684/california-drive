import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.CD_SHOTS ? `${process.env.CD_SHOTS}/` : 'qa-shots/smoke/';

async function state(page: Page) {
  return page.evaluate(() => (window as any).__cd?.state);
}

async function waitState(page: Page, s: string[], timeout = 180_000) {
  await expect.poll(() => state(page), { timeout, intervals: [500] }).toMatch(new RegExp(`^(${s.join('|')})$`));
}

test('boot → city select → drive SF → controls → pause → reset session, same-origin only', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  const posts: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
    if (r.method() !== 'GET' && r.method() !== 'HEAD') posts.push(`${r.method()} ${u}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.locator('.title .logo')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}01-title.png` });

  // keyboard-only navigation of the title menu
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitState(page, ['select']);
  await expect(page.locator('.select .card h2')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}02-select.png` });

  // pick San Francisco on the map and drive
  await page.locator('.select [data-id="sf"]:visible').first().click({ force: true });
  await page.locator('.card [data-a="drive"]').click();
  await waitState(page, ['loading', 'reveal', 'drive']);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}03-loading.png` });
  await waitState(page, ['reveal', 'drive']);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}04-reveal.png` });
  await page.keyboard.press('KeyX');
  await waitState(page, ['drive']);
  expect(await page.evaluate(() => (window as any).__cd.chunks)).toBeGreaterThan(3);

  // throttle moves the car
  const p0 = await page.evaluate(() => (window as any).__cd.position);
  await page.keyboard.down('KeyW');
  // Software rendering (SwiftShader) can drop to ~1 FPS with two workers, and the fixed-step clock caps sim
  // time per frame, so hold the throttle until the car has clearly moved instead of for a fixed wall time.
  const movedBy = async () => { const p = await page.evaluate(() => (window as any).__cd.position); return Math.hypot(p.x - p0.x, p.z - p0.z); };
  await expect.poll(movedBy, { timeout: 90_000, intervals: [1000] }).toBeGreaterThan(3);
  await page.screenshot({ path: `${SHOTS}05-driving.png` });
  await page.keyboard.up('KeyW');
  console.log('moved', (await movedBy()).toFixed(1), 'm; speed', await page.evaluate(() => (window as any).__cd.speed));

  // camera cycling
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as any).__cd.camera)).toBe('close');
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).__cd.camera)).toBe('cockpit');
  await page.screenshot({ path: `${SHOTS}06-cockpit.png` });
  await page.keyboard.press('KeyX');
  await page.keyboard.press('KeyX');
  await page.keyboard.press('KeyX');

  // pause menu
  await page.keyboard.press('Escape');
  await waitState(page, ['paused']);
  await expect(page.locator('.sheet')).toBeVisible();
  // swap cars mid-session and back
  await page.locator('.sheet nav [data-t="car"]').click();
  await page.locator('[data-veh="vireo"]').click();
  await page.locator('[data-veh="m3c"]').click();
  await expect(page.locator('[data-veh="m3c"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.sheet nav [data-t="world"]').click();
  await page.locator('[data-seg="tpreset"] button', { hasText: 'Night' }).click();
  await page.locator('.sheet nav [data-t="session"]').click();
  await page.screenshot({ path: `${SHOTS}07-pause.png` });
  // reset session wipes storage
  const before = await page.evaluate(() => sessionStorage.length);
  expect(before).toBeGreaterThan(0);
  await page.locator('[data-a="reset"]').click();
  const after = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cd.')).length);
  expect(after).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.locator('.sheet nav [data-t="resume"]').click();
  await waitState(page, ['drive']);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}08-night.png` });

  // photo mode
  await page.keyboard.press('KeyF');
  await waitState(page, ['photo']);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}09-photo.png` });
  await page.keyboard.press('KeyF');
  await waitState(page, ['drive']);

  console.log('foreign requests:', foreign.length, 'non-GET:', posts.length, 'errors:', errors.slice(0, 5));
  expect(foreign).toEqual([]);
  expect(posts).toEqual([]);
  expect(errors.filter((e) => !/WebGL|GPU stall|Automatic fallback|swiftshader/i.test(e))).toEqual([]);
});
