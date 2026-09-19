/**
 * v1.3 UI smoke (PRD §24): Ice Blue default, Home dashboard, responsive
 * behavior at one desktop and one narrow mobile viewport, theme switching.
 * Run with the combined server: node server/index.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
let failed = 0;
function check(name, ok, extra = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const browser = await chromium.launch();

/* ================= desktop 1280×800 ================= */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => fetch('/api/dev/reset', { method: 'POST' }).catch(() => {}));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.home', { timeout: 10000 });

  // 1. Ice Blue is the default theme (PRD §24)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('default theme is Ice Blue', theme === 'ice', theme);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('ice canvas color applied', bg === 'rgb(242, 248, 255)', bg);

  // 2. Home dashboard sections (PRD §17/§22)
  check('quick-action cards render', (await page.locator('.qa-card').count()) === 4);
  check('Continue Reading section renders', await page.locator('section[aria-label="Continue reading"]').isVisible());
  check('Recent Items section renders', await page.locator('section[aria-label="Recent items"]').isVisible());
  check('Saved Links section renders (distinct from Recent Items)', await page.locator('section[aria-label="Saved links"]').isVisible());
  check('Activity section renders', await page.locator('section[aria-label="Activity"]').isVisible());
  check('sample entry point kept', await page.getByRole('button', { name: /Try the sample workspace/i }).isVisible());

  // 3. four quick-action cards in a row on desktop
  const boxes = await page.locator('.qa-card').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
  check('quick actions in one row on desktop', boxes.length === 4 && new Set(boxes.map((b) => b.y)).size === 1, JSON.stringify(boxes));

  // 4. Recent Items | Saved Links in two columns
  const colA = await page.locator('section[aria-label="Recent items"]').boundingBox();
  const colB = await page.locator('section[aria-label="Saved links"]').boundingBox();
  check('Recent/Saved in two columns on desktop', colA && colB && Math.abs(colA.y - colB.y) < 30 && colB.x > colA.x + colA.width - 10, colA && colB ? `dx=${Math.round(colB.x - colA.x)}` : '');

  // 5. no horizontal page overflow (PRD §24)
  const overflowD = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check('desktop Home: no horizontal overflow', overflowD <= 0, `${overflowD}px`);

  // 6. reader-as-card with Preview/Edit toggle top-right (concept sketch)
  await page.getByRole('button', { name: /Try the sample workspace/i }).click();
  await page.waitForSelector('.tree-row', { timeout: 10000 });
  await page.locator('.tree-row[title="notes"]').first().click();
  await page.waitForSelector('.tree-row[title="notes/python-basics.md"]', { timeout: 8000 });
  await page.locator('.tree-row[title="notes/python-basics.md"]').click();
  await page.waitForSelector('.md-body h1', { timeout: 10000 });
  const card = await page.locator('.content .viewer').boundingBox();
  const mode = await page.locator('.mode-toggle, .mode-btn').first().boundingBox();
  check('reader renders as a card', !!card && card.width > 500);
  check('Preview/Edit toggle top-right of the reader', !!mode && !!card && mode.y < card.y + 90 && mode.x + mode.width > card.x + card.width - 320);

  // 7. theme switching: Settings → Dark, persists across reload (PRD §24)
  await page.locator('button[aria-label="Reader settings"]').click();
  await page.selectOption('#set-theme', 'dark');
  check('theme switch applies Dark', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tree-row, .home', { timeout: 10000 });
  check('theme choice persists after reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark surfaces applied', darkBg === 'rgb(14, 21, 38)', darkBg);
  await page.close();
}

/* ================= mobile browser 390×844 ================= */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.home', { timeout: 10000 });

  // 8. bottom navigation with Home/Files/Activity/Settings (PRD §21)
  check('bottom nav renders on mobile', await page.locator('.bottom-nav').isVisible());
  check('bottom nav has Home/Files/Activity/Settings', (await page.locator('.bottom-nav button').count()) === 4
    && await page.locator('.bottom-nav button[aria-label="Home"]').isVisible()
    && await page.locator('.bottom-nav button[aria-label="Files"]').isVisible()
    && await page.locator('.bottom-nav button[aria-label="Activity"]').isVisible()
    && await page.locator('.bottom-nav button[aria-label="Settings"]').isVisible());
  const navHeights = await page.locator('.bottom-nav button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check('touch targets ≥ 44 CSS px', navHeights.every((h) => h >= 44), JSON.stringify(navHeights.map((h) => Math.round(h))));
  check('status bar hidden on mobile', (await page.locator('.statusbar').count()) === 0);

  // 9. no horizontal overflow on mobile Home
  const overflowM = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check('mobile Home: no horizontal overflow', overflowM <= 0, `${overflowM}px`);

  // 10. quick actions become a 2×2 grid (PRD §22)
  const mboxes = await page.locator('.qa-card').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
  const ys = [...new Set(mboxes.map((b) => b.y))];
  check('quick actions in a 2×2 grid on mobile', mboxes.length === 4 && ys.length === 2, JSON.stringify(mboxes));

  // 11. load sample → Files opens the explorer as a drawer
  await page.getByRole('button', { name: /Try the sample workspace/i }).click();
  await page.waitForSelector('.bottom-nav button[aria-label="Files"]:not([disabled])', { timeout: 10000 });
  check('sidebar hidden by default on mobile', (await page.locator('aside.sidebar').count()) === 0);
  await page.locator('.bottom-nav button[aria-label="Files"]').click();
  await page.waitForSelector('aside.sidebar.drawer .tree-row', { timeout: 8000 });
  check('Files opens the explorer as a drawer', true);
  check('drawer scrim present', await page.locator('.drawer-scrim').isVisible());
  await page.locator('.tree-row[title="notes"]').first().click();
  await page.waitForSelector('.tree-row[title="notes/python-basics.md"]', { timeout: 8000 });
  await page.locator('.tree-row[title="notes/python-basics.md"]').click();
  await page.waitForSelector('.md-body h1', { timeout: 10000 });
  check('file opens in reader from drawer', true);
  // the drawer covers the screen center — tap the visible scrim to its right
  await page.mouse.click(370, 300);
  await page.waitForTimeout(300);
  check('scrim closes the drawer', (await page.locator('aside.sidebar').count()) === 0);
  const readerBox = await page.locator('.content .viewer').boundingBox();
  check('reader occupies the main viewport', !!readerBox && readerBox.width > 340, readerBox ? Math.round(readerBox.width) + 'px' : '');

  // toggle must not overlap the document heading (PRD §21.1 reader rules)
  const tg = await page.locator('.mode-toggle, .mode-btn').first().boundingBox();
  const h1 = await page.locator('.md-body h1').boundingBox();
  check('mode toggle does not overlap the heading', !!tg && !!h1 && h1.y >= tg.y + tg.height - 4, tg && h1 ? `h1@${Math.round(h1.y)} toggleBottom@${Math.round(tg.y + tg.height)}` : '');

  // 12. dialogs become bottom sheets (PRD §21.1) — via Home → Open Link
  await page.locator('.bottom-nav button[aria-label="Home"]').click();
  await page.waitForSelector('.qa-card');
  await page.locator('.qa-card', { hasText: 'Open Link' }).click();
  await page.waitForSelector('.drive-dialog', { timeout: 5000 });
  const vp = page.viewportSize();
  const dlg = await page.locator('.drive-dialog').boundingBox();
  check('Drive dialog is a bottom sheet on mobile', !!dlg && Math.abs(dlg.x) < 2 && Math.abs(dlg.width - vp.width) < 4 && dlg.y + dlg.height > vp.height - 60, dlg ? `${Math.round(dlg.width)}×${Math.round(dlg.height)} @y${Math.round(dlg.y)}` : '');
  const overflowDlg = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check('no page overflow while sheet open', overflowDlg <= 0, `${overflowDlg}px`);
  await page.keyboard.press('Escape');
  await page.locator('.overlay').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(250);

  // 13. theme switching on mobile (via bottom nav → Settings sheet)
  await page.locator('.bottom-nav button[aria-label="Settings"]').click();
  await page.waitForSelector('.settings-pop', { timeout: 5000 });
  check('settings opens from bottom nav', true);
  await page.selectOption('#set-theme', 'ice');
  check('mobile theme switch to Ice works', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'ice');
  await page.screenshot({ path: 'screenshots/v13-mobile-home.png' });
  await page.close();
}

await browser.close();
console.log(failed === 0 ? '\nUI SMOKE PASSED (desktop + mobile + themes)' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
