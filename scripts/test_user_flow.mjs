import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://localhost:5173');
await page.getByRole('button', { name: /Try the sample workspace/i }).click();
await page.waitForSelector('.tree-row');

// Open markdown
await page.locator('.tree-row', { hasText: 'notes' }).first().click();
await page.waitForSelector('.tree-row[title="notes/python-basics.md"]');
await page.locator('.tree-row[title="notes/python-basics.md"]').click();
await page.waitForSelector('.md-body');

// Click Edit button
await page.locator('.mode-toggle button', { hasText: 'Edit' }).click();
await page.waitForSelector('.cm-scroller', { timeout: 8000 });

// Verify scroller properties
const scrollInfo = await page.evaluate(() => {
  const scroller = document.querySelector('.cm-scroller');
  if (!scroller) return null;
  scroller.scrollTop = 120;
  return {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop,
  };
});

console.log('Editor scroll info:', scrollInfo);
if (scrollInfo && scrollInfo.scrollTop > 0) {
  console.log('PASS: Markdown edit scrolling is working cleanly!');
} else {
  console.error('FAIL: Markdown edit scroller is not scrollable');
  process.exit(1);
}

await browser.close();
