import { expect, test } from '@playwright/test';
test.skip(!process.env.CD_DEBUG_E2E, 'debug only');
const cd = (page: any, e: string) => page.evaluate(`window.__cd.${e}`);
test('texture leak hunt', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto('/?texdebug=1');
  await page.waitForTimeout(3000);
  for (let visit = 0; visit < 2; visit++) {
    await cd(page, "load('sf', 'day', 'clear')");
    await expect.poll(() => cd(page, 'state'), { timeout: 200_000 }).toBe('reveal');
    await cd(page, 'skipReveal()');
    await expect.poll(() => cd(page, 'pending'), { timeout: 120_000 }).toBe(0);
    await page.waitForTimeout(2000);
    await cd(page, 'quitToTitle()');
    await page.waitForTimeout(1500);
    const lt: string[] = await cd(page, 'liveTextures()');
    console.log(`VISIT ${visit} live ${lt.length}`);
    for (const t of lt) console.log(`T${visit} ${t}`);
  }
});
