/* Builds docs/images/mobile-m5m6-montage.png with screenshots inlined as data URIs. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const cells = [
  ['screenshots/mob2-home-resume.png', 'Home — Continue from your account (M5)'],
  ['screenshots/mob2-library-changes.png', 'Library ⇅ Changes check (M6)'],
  ['screenshots/mob2-review-queue.png', 'Review upload — queue while offline (M6)'],
  ['screenshots/mob2-activity-offline.png', 'Activity — honest Offline badge (M6)'],
];
const data = cells.map(([f]) => 'data:image/png;base64,' + readFileSync(f).toString('base64'));
const browser = await chromium.launch();
const m = await browser.newPage({ viewport: { width: 1660, height: 1000 }, deviceScaleFactor: 2 });
await m.setContent(`<body style="margin:0;background:#E7F0FC;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:26px">
<div style="width:1560px;text-align:center;font-size:26px;font-weight:800;color:#132A54;margin:0 auto 20px">ReadSpace Mobile — M5 + M6 highlights (Ice Blue)</div>
<div style="display:flex;gap:22px;width:1560px;margin:0 auto;align-items:flex-start">
${cells.map(([f, cap], i) => `<div style="flex:1;background:#fff;border:1px solid #CFE0FA;border-radius:16px;padding:10px;box-shadow:0 2px 8px rgba(19,42,84,.08)">
<img src="${data[i]}" style="width:100%;border-radius:10px;display:block">
<div style="font-size:13px;font-weight:600;color:#44557A;padding:9px 4px 3px">${cap}</div></div>`).join('')}
</div></body>`);
await m.waitForTimeout(400);
await m.screenshot({ path: 'docs/images/mobile-m5m6-montage.png', fullPage: true });
await browser.close();
console.log('montage rebuilt');
