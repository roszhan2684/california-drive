import { expect, test, type Page } from '@playwright/test';

const cd = (page: Page, expr: string) => page.evaluate(`window.__cd.${expr}`) as Promise<any>;

async function settle(page: Page) {
  await expect.poll(() => cd(page, 'pending'), { timeout: 120_000, intervals: [500] }).toBe(0);
  await page.waitForTimeout(1500);
}

test('teleport loop, weather cycling and city switching release GPU resources', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect.poll(() => cd(page, 'state')).toBe('title');
  await page.waitForTimeout(2000);
  const titleBefore = await cd(page, 'memory');
  await cd(page, "load('sf', 'day', 'clear')");
  await expect.poll(() => cd(page, 'state'), { timeout: 200_000, intervals: [1000] }).toBe('reveal');
  await cd(page, 'skipReveal()');
  await expect.poll(() => cd(page, 'state')).toBe('drive');
  await settle(page);
  const base = await cd(page, 'memory');
  const baseChunks = await cd(page, 'chunks');
  console.log('scene geos at base', await cd(page, 'sceneGeometries'));
  const weathers = ['rain', 'fog', 'overcast', 'clear'];
  for (let i = 0; i < 8; i++) {
    await cd(page, `teleportDistrict(${i})`);
    await cd(page, `setWeather('${weathers[i % weathers.length]}')`);
    await settle(page);
  }
  await cd(page, 'teleportDistrict(0)');
  await settle(page);
  const after = await cd(page, 'memory');
  const chunks = await cd(page, 'chunks');
  console.log('scene geos after', await cd(page, 'sceneGeometries'));
  console.log('memory base', base, baseChunks, 'chunks; after loop', after, chunks, 'chunks');
  // renderer.info counts geometries uploaded to the GPU; every uploaded geometry must still be in the scene graph
  // (anything above that was not disposed when its chunk unloaded = a leak), plus a few post-processing quads
  const inScene = await cd(page, 'sceneGeometries');
  expect(after.geometries).toBeLessThanOrEqual(inScene + 12);
  expect(chunks).toBeLessThan(60);
  expect(after.textures).toBeLessThan(base.textures + 12);
  // city switch: leaving the world frees its resources
  await cd(page, 'quitToTitle()');
  await page.waitForTimeout(1500);
  const title = await cd(page, 'memory');
  console.log('memory at title before', titleBefore, 'after', title);
  // Shared caches survive the first visit by design (traffic/prop variant geometries, the CC0 facade/asphalt
  // textures). A leak shows up as growth on the *second* visit, so drive a second city and compare title visits.
  expect(title.geometries).toBeLessThanOrEqual(titleBefore.geometries + 40);
  expect(title.textures).toBeLessThanOrEqual(titleBefore.textures + 4);
  await cd(page, "load('sf', 'day', 'rain')");
  await expect.poll(() => cd(page, 'state'), { timeout: 200_000, intervals: [1000] }).toBe('reveal');
  await cd(page, 'skipReveal()');
  await settle(page);
  await cd(page, 'teleportDistrict(2)');
  await settle(page);
  await cd(page, 'quitToTitle()');
  await page.waitForTimeout(1500);
  const title2 = await cd(page, 'memory');
  console.log('memory at title, second visit', title2);
  expect(title2.geometries).toBeLessThanOrEqual(title.geometries + 2);
  expect(title2.textures).toBeLessThanOrEqual(title.textures);
  expect(errors).toEqual([]);
});
