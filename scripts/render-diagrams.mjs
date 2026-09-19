/* Renders docs/diagrams/*.html to docs/images/*.png and builds the mobile montage. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('docs/images', { recursive: true });
const shots = [
  ['docs/diagrams/architecture.html', 'docs/images/architecture.png', 1240],
  ['docs/diagrams/auth-flow.html', 'docs/images/auth-flow.png', 1240],
  ['docs/diagrams/mobile-flows.html', 'docs/images/mobile-m5m6-flows.png', 1240],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const [src, out, width] of shots) {
  await page.goto('file://' + process.cwd() + '/' + src);
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, fullPage: true });
  console.log('rendered', out);
}

/* Montage: 4 key mobile screenshots in a 4-across strip with captions. */
const cells = [
  ['screenshots/mob2-home-resume.png', 'Home — Continue from your account (M5)'],
  ['screenshots/mob2-library-changes.png', 'Library ⇅ Changes check (M6)'],
  ['screenshots/mob2-review-queue.png', 'Review upload — queue while offline (M6)'],
  ['screenshots/mob2-activity-offline.png', 'Activity — honest Offline badge (M6)'],
];
const m = await ctx.newPage();
await m.setContent(`<body style="margin:0;background:#E7F0FC;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:26px">
<div style="width:1560px;text-align:center;font-size:26px;font-weight:800;color:#132A54;margin:0 auto 20px">ReadSpace Mobile — M5 + M6 highlights (Ice Blue)</div>
<div style="display:flex;gap:22px;width:1560px;margin:0 auto">
${cells.map(([f, cap]) => `<div style="flex:1;background:#fff;border:1px solid #CFE0FA;border-radius:16px;padding:10px;box-shadow:0 2px 8px rgba(19,42,84,.08)">
<img src="file://${process.cwd()}/${f}" style="width:100%;border-radius:10px;display:block">
<div style="font-size:13px;font-weight:600;color:#44557A;padding:9px 4px 3px">${cap}</div></div>`).join('')}
</div></body>`);
await m.setViewportSize({ width: 1660, height: 1000 });
await m.waitForTimeout(600);
await m.screenshot({ path: 'docs/images/mobile-m5m6-montage.png', fullPage: true });
console.log('rendered docs/images/mobile-m5m6-montage.png');
await browser.close();
