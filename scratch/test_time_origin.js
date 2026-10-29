import { chromium } from 'playwright';

async function testTimeOrigin() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    ],
  });

  const pages = [];
  for (let i = 0; i < 20; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    pages.push({ i, page });
  }

  console.log('Testing performance.timeOrigin + performance.now() across 20 contexts:');
  for (const { i, page } of pages) {
    const nodeBefore = performance.timeOrigin + performance.now();
    const { timeOrigin, perfNow, total } = await page.evaluate(() => {
      return {
        timeOrigin: performance.timeOrigin,
        perfNow: performance.now(),
        total: performance.timeOrigin + performance.now(),
      };
    });
    const nodeAfter = performance.timeOrigin + performance.now();
    const nodeMid = (nodeBefore + nodeAfter) / 2;
    const diff = total - nodeMid;
    console.log(`Context ${i}: timeOrigin=${timeOrigin.toFixed(1)} perfNow=${perfNow.toFixed(1)} total=${total.toFixed(1)} diffVsNode=${diff.toFixed(2)}ms`);
  }

  await browser.close();
}

testTimeOrigin();
