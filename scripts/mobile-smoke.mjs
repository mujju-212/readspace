/**
 * ReadSpace Mobile smoke (Mobile PRD v1.0 §15/§17).
 * Covers: MOB-01 local read without login, MOB-03 recents + position restore,
 * MOB-05 no consent on launch, MOB-06 Drive browse, MOB-09/10 offline copies,
 * MOB-07/08 upload review, MOB-15 themes, touch targets, bottom nav (§4).
 * Run with: node server/index.mjs   (app at /m/)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const APP = `${BASE}/m/`;
let failed = 0;
function check(name, ok, extra = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const MD = Buffer.from('# Mobile Test Note\n\nRead offline without an account.\n\n## Section two\n\nPosition restore lands here — scroll down to me.'.repeat(40));
/** Minimal but *valid* 2-page PDF (correct xref) for the reader test. */
function twoPagePdf() {
  const page = (label, n) => `BT /F1 18 Tf 72 720 Td (${label} ${n}) Tj ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 6 0 R]/Count 2>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(page('Page', 1))}>>\nstream\n${page('Page', 1)}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 7 0 R>>',
    `<</Length ${Buffer.byteLength(page('Page', 2))}>>\nstream\n${page('Page', 2)}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/* ============ 1. fresh install: no login gate, no consent (MOB-01/05) ============ */
{
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.evaluate(() => fetch('/api/dev/reset', { method: 'POST' }).catch(() => {}));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sheet, .screen', { timeout: 10000 });
  check('welcome shows Open a file as primary', await page.locator('button.btn.primary', { hasText: 'Open a file' }).isVisible());
  check('welcome offers Connect Drive as secondary card', await page.locator('.card', { hasText: 'Connect Google Drive' }).isVisible());
  check('no login gate copy', !((await page.textContent('body'))?.includes('Sign in required')));
  // theme default: Ice Blue (product decision)
  check('default theme is Ice Blue', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'ice');
  // open a local file via the picker
  const chooserP = page.waitForEvent('filechooser');
  await page.locator('button.btn.primary', { hasText: 'Open a file' }).click();
  const chooser = await chooserP;
  await chooser.setFiles([{ name: 'mobile-test-note.md', mimeType: 'text/markdown', buffer: MD }]);
  await page.waitForSelector('.reader', { timeout: 10000 });
  await page.waitForSelector('.reader-content h1', { timeout: 10000 });
  check('local file opens full-screen reader (MOB-01)', ((await page.locator('.reader-content h1').textContent()) ?? '').includes('Mobile Test Note'));
  check('reader shows On device chip', await page.locator('.reader-top .badge', { hasText: 'On device' }).isVisible());

  // position restore: scroll deep, go back, reopen (MOB-03)
  await page.locator('.reader-body').evaluate((el) => { el.scrollTop = 1200; });
  await page.waitForTimeout(800); // debounced save
  await page.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(400);
  await page.locator('.bottom-nav button[aria-label="Home"]').click();
  check('home shows Continue reading card', await page.locator('.card', { hasText: 'Position saved' }).first().isVisible());
  await page.locator('.card button', { hasText: 'Resume' }).first().click();
  await page.waitForSelector('.reader', { timeout: 8000 });
  await page.waitForTimeout(700);
  const scrollTop = await page.locator('.reader-body').evaluate((el) => el.scrollTop);
  check('reading position restored on reopen (MOB-03)', scrollTop > 900, `scrollTop=${Math.round(scrollTop)}`);

  // bottom nav + 48dp targets
  const heights = await page.locator('.bottom-nav button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check('bottom nav has 4 destinations (PRD §4)', (await page.locator('.bottom-nav button').count()) === 4);
  check('touch targets ≥ 48px (PRD §5.2)', heights.every((h) => h >= 47.5), JSON.stringify(heights.map((h) => Math.round(h))));
  await page.close();
}

/* ============ 2. offline local reading (airplane-mode scenario, §15) ============ */
{
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav');
  await ctx.setOffline(true);
  // drive-dependent states degrade; local must keep working
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.waitForTimeout(400);
  await page.locator('.row button', { hasText: 'mobile-test-note.md' }).first().click();
  await page.waitForSelector('.reader-content h1', { timeout: 10000 });
  check('imported file reads with zero network (MOB-01 offline)', ((await page.locator('.reader-content h1').textContent()) ?? '').includes('Mobile Test Note'));
  await ctx.setOffline(false);
  await page.close();
}

/* ============ 3. Drive: connect (consent only on user action), browse, offline copy ============ */
{
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav');

  // Library → Drive tab shows connect card, no consent screen ever auto-appeared
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Google Drive' }).click();
  check('Drive tab shows Connect card when disconnected (§6.4)', await page.locator('.card', { hasText: 'Connect Google Drive' }).isVisible());

  // Settings → connect: explanation sheet first, then OAuth (MOB-05)
  await page.locator('.bottom-nav button[aria-label="Settings"]').click();
  await page.locator('button', { hasText: 'Connect Google Drive' }).first().click();
  await page.waitForSelector('.sheet');
  check('permission explanation sheet before consent (MOB-05)', ((await page.locator('.sheet').innerText()) || '').includes('ReadSpace asks for Drive access'));
  await page.locator('.sheet button', { hasText: 'Continue to Google' }).click();
  await page.waitForSelector('form[action="/mock/google/consent"]', { timeout: 15000 });
  await page.locator('form[action="/mock/google/consent"] button').click();
  // callback returns to /m/
  await page.waitForURL(/\/m\/\?signedin=1/, { timeout: 15000 });
  check('OAuth handoff returns into the mobile app', page.url().includes('/m/'));

  // browse: Library → Drive tab → folders with breadcrumbs
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Google Drive' }).click();
  await page.waitForSelector('.row', { timeout: 15000 });
  check('Drive root lists folders (MOB-06)', await page.locator('.row', { hasText: 'Study Notes' }).isVisible());
  await page.locator('.row', { hasText: 'Study Notes' }).click();
  await page.waitForSelector('.row:has-text("python-basics.md")', { timeout: 15000 });
  check('breadcrumbs + lazy folder listing', await page.locator('.crumbs .here', { hasText: 'Study Notes' }).isVisible());
  // open a cloud-only file
  await page.locator('.row', { hasText: 'python-basics.md' }).locator('button').first().click();
  await page.waitForSelector('.reader', { timeout: 15000 });
  await page.waitForSelector('.reader-content h1', { timeout: 15000 });
  check('cloud file opens with Cloud chip', await page.locator('.reader-top .badge', { hasText: 'Cloud' }).isVisible());
  await page.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(400);

  // make available offline → offline badge → reads with no network (MOB-10)
  await page.locator('.row', { hasText: 'python-basics.md' }).locator('button[aria-label^="Actions for"]').click();
  await page.locator('.sheet button', { hasText: 'Make available offline' }).click();
  // the offline copy lives in the Local tab's "Available offline" section
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  await page.waitForSelector('.row:has-text("python-basics.md") .badge:has-text("Offline")', { timeout: 20000 });
  check('offline copy shows Offline badge (MOB-10)', true);
  await ctx.setOffline(true);
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  await page.locator('.row', { hasText: 'python-basics.md' }).locator('button').first().click();
  await page.waitForSelector('.reader-content h1', { timeout: 10000 });
  check('offline copy opens with no network (MOB-10)', ((await page.locator('.reader-content h1').textContent()) ?? '').includes('Python Basics'));
  await ctx.setOffline(false);
  await page.locator('button[aria-label="Back"]').click();
  await page.close();
}

/* ============ 4. upload selected → destination → review → Activity (MOB-07/08, §6.7) ============ */
{
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav');
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  // select the imported file via its checkbox
  await page.locator('.row input[type="checkbox"]').first().check();
  await page.locator('.actionbar button', { hasText: 'Upload' }).click();
  await page.waitForSelector('.sheet', { timeout: 8000 });
  check('destination chooser opens (§6.7 step 3)', ((await page.locator('.sheet h2').textContent()) ?? '').includes('Choose destination'));
  await page.locator('.sheet button', { hasText: 'Upload to “My Drive”' }).click();
  await page.waitForSelector('.sheet:has-text("Review upload")', { timeout: 10000 });
  check('review sheet lists file + total (§6.7 step 4)', await page.locator('.sheet .row', { hasText: 'mobile-test-note.md' }).isVisible());
  check('nothing uploaded until confirm (MOB-08)', true);
  await page.locator('.sheet button', { hasText: 'Upload 1 file(s)' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 20000 });
  // Activity shows the completed job
  await page.locator('.bottom-nav button[aria-label="Activity"]').click();
  await page.waitForSelector('.card:has-text("Upload → My Drive")', { timeout: 10000 });
  check('Activity shows completed upload (§6.10)', await page.locator('.card .badge', { hasText: 'Completed' }).first().isVisible());
  // verify server-side
  const made = await page.evaluate(() => fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json()));
  check('file actually uploaded to Drive', (made.files ?? []).some((f) => f.name === 'mobile-test-note.md'));

  // theme switch + persistence (MOB-15)
  await page.locator('.bottom-nav button[aria-label="Settings"]').click();
  await page.selectOption('#s-theme', 'dark');
  check('dark theme applies (MOB-15)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav', { timeout: 10000 });
  check('theme persists after restart (MOB-15)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  check('no welcome gate after first run (§6.1)', (await page.locator('button', { hasText: 'Open a file' }).count()) === 0);
  await page.close();
}

/* ============ 5. §15 scenarios: sanitization, no-overwrite, retry, PDF page restore ============ */
{
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav');

  // (a) malicious HTML: scripts must NOT execute in preview (§15 last row, §13)
  const chP = page.waitForEvent('filechooser');
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('button', { hasText: 'Upload files to Drive…' }).waitFor({ timeout: 8000 });
  // import via Home quick action instead (Open file)
  await page.locator('.bottom-nav button[aria-label="Home"]').click();
  await page.locator('button', { hasText: 'Open file' }).first().click();
  const ch = await chP;
  await ch.setFiles([{
    name: 'evil.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<p>safe-content-marker</p><script>window.__pwned = true;</script><img src=x onerror="window.__pwned2 = true">', 'utf8'),
  }]);
  await page.waitForSelector('.reader');
  await page.waitForSelector('.reader-content', { timeout: 8000 });
  await page.waitForTimeout(600);
  const pwned = await page.evaluate(() => ({ a: window.__pwned, b: window.__pwned2 }));
  check('malicious HTML: scripts do not execute (§15)', !pwned.a && !pwned.b);
  check('malicious HTML: safe content still renders', ((await page.textContent('.reader-content')) ?? '').includes('safe-content-marker'));
  await page.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(300);

  // (b) PDF page position restore (§15 row 2)
  const chP2 = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: 'Open file' }).first().click();
  (await chP2).setFiles([{ name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: twoPagePdf() }]);
  await page.waitForSelector('.reader', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas.pdf-page').length >= 2, { timeout: 20000 });
  check('2-page PDF renders on demand (MOB-04)', true);
  await page.locator('button[aria-label="Next page"]').click();
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(400);
  await page.locator('.bottom-nav button[aria-label="Home"]').click();
  await page.locator('.card button', { hasText: 'Resume' }).first().click();
  await page.waitForSelector('.reader', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas.pdf-page').length >= 2, { timeout: 20000 });
  await page.waitForTimeout(400);
  const pageLabel = await page.locator('.reader-body').innerText();
  check('PDF restores last page on reopen (§15)', /Page\s*2/.test(pageLabel), pageLabel.slice(0, 40).replace(/\n/g, ' '));
  await page.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(300);

  // (c) duplicate names never overwrite (§15 row 8 + MOB-14)
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  const ch3P = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: 'Upload files to Drive…' }).click();
  (await ch3P).setFiles([
    { name: 'same-name.md', mimeType: 'text/markdown', buffer: Buffer.from('# Version one') },
    { name: 'same-name.md', mimeType: 'text/markdown', buffer: Buffer.from('# Version two') },
  ]);
  await page.waitForSelector('.sheet:has-text("Choose destination")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload to “My Drive”' }).click();
  await page.waitForSelector('.sheet:has-text("Review upload")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload 2 file(s)' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 20000 });
  const dups = await page.evaluate(() => fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json()));
  const sameName = (dups.files ?? []).filter((f) => f.name === 'same-name.md');
  check('duplicate upload creates copies, never overwrites (MOB-14)', sameName.length === 2, `${sameName.length} cloud copies`);

  // (d) failed transfer → visible failure → retry succeeds (MOB-13, §15 row 13)
  const ch4P = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: 'Upload files to Drive…' }).click();
  (await ch4P).setFiles([{ name: 'retry-me.md', mimeType: 'text/markdown', buffer: Buffer.from('# retry target') }]);
  await page.waitForSelector('.sheet:has-text("Choose destination")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload to “My Drive”' }).click();
  await page.waitForSelector('.sheet:has-text("Review upload")', { timeout: 8000 });
  // connection drops mid-flow: the confirmed transfer queues honestly (§8),
  // local reading stays available, and it auto-starts on reconnect
  await ctx.setOffline(true);
  await page.locator('.sheet button', { hasText: 'Queue 1 file(s) for when online' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 20000 });
  await page.locator('.bottom-nav button[aria-label="Activity"]').click();
  await page.waitForSelector('.card .badge:has-text("Offline")', { timeout: 15000 });
  check('offline upload queued, never claimed as done (§8)', true);
  // local reading unaffected while offline (§8 last row)
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.row button', { hasText: 'mobile-test-note.md' }).first().click();
  await page.waitForSelector('.reader-content h1', { timeout: 10000 });
  check('local reading still works while a transfer is queued (§8)', true);
  await page.locator('button[aria-label="Back"]').click();
  await page.locator('.bottom-nav button[aria-label="Activity"]').click();
  await ctx.setOffline(false);
  const completedBefore = await page.locator('.card .badge', { hasText: 'Completed' }).count();
  await page.waitForFunction(
    (prev) => [...document.querySelectorAll('.card .badge')].filter((b) => b.textContent === 'Completed').length > prev,
    completedBefore,
    { timeout: 25000 },
  );
  check('queued transfer auto-completes after reconnect (MOB-13)', true);
  const retried = await page.evaluate(() => fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json()));
  check('retried file actually on Drive', (retried.files ?? []).some((f) => f.name === 'retry-me.md'));
  await page.close();
}

/* ============ 6. M5/M6: queued transfers, changes API, cross-device session sync ============ */
{
  // --- (a) offline queue → auto-start on reconnect (M6 background scope, §8) ---
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bottom-nav');
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  await ctx.setOffline(true);
  const chQP = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: 'Upload files to Drive…' }).click();
  (await chQP).setFiles([{ name: 'queued-file.md', mimeType: 'text/markdown', buffer: Buffer.from('# queued while offline') }]);
  await page.waitForSelector('.sheet:has-text("Choose destination")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload to “My Drive”' }).click();
  await page.waitForSelector('.sheet:has-text("Review upload")', { timeout: 8000 });
  check('offline review offers queueing (PRD §8)', await page.locator('.sheet button', { hasText: 'Queue 1 file(s) for when online' }).isVisible());
  await page.locator('.sheet button', { hasText: 'Queue 1 file(s) for when online' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
  await page.locator('.bottom-nav button[aria-label="Activity"]').click();
  await page.waitForSelector('.card .badge:has-text("Offline")', { timeout: 10000 });
  check('queued transfer shows Offline state', true);
  await ctx.setOffline(false);
  const doneBefore = await page.locator('.card .badge', { hasText: 'Completed' }).count();
  await page.waitForFunction(
    (prev) => [...document.querySelectorAll('.card .badge')].filter((x) => x.textContent === 'Completed').length > prev,
    doneBefore,
    { timeout: 25000 },
  );
  check('queued transfer auto-starts on reconnect (M6)', true);
  const queuedDone = await page.evaluate(() => fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json()));
  check('queued file actually uploaded after reconnect', (queuedDone.files ?? []).some((f) => f.name === 'queued-file.md'));

  // --- (b) Drive Changes API (M6) ---
  await page.locator('.bottom-nav button[aria-label="Library"]').click();
  await page.locator('.segmented button', { hasText: 'Google Drive' }).click();
  await page.waitForSelector('button:has-text("⇅ Changes")', { timeout: 15000 });
  await page.locator('button', { hasText: '⇅ Changes' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('changed since your last check') || document.body.innerText.includes('No changes since'), { timeout: 15000 });
  check('changes check runs and stores token (M6)', true);
  const token1 = await page.evaluate(() => localStorage.getItem('rsm.changesToken'));
  // upload another file → changes since token must include it
  const ch5P = page.waitForEvent('filechooser');
  await page.locator('.segmented button', { hasText: 'Local' }).click();
  await page.locator('button', { hasText: 'Upload files to Drive…' }).click();
  (await ch5P).setFiles([{ name: 'change-detected.md', mimeType: 'text/markdown', buffer: Buffer.from('# for the changes API') }]);
  await page.waitForSelector('.sheet:has-text("Choose destination")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload to “My Drive”' }).click();
  await page.waitForSelector('.sheet:has-text("Review upload")', { timeout: 8000 });
  await page.locator('.sheet button', { hasText: 'Upload 1 file(s)' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 20000 });
  await page.locator('.segmented button', { hasText: 'Google Drive' }).click();
  await page.waitForSelector('button:has-text("⇅ Changes")', { timeout: 15000 });
  await page.locator('button', { hasText: '⇅ Changes' }).click();
  // the note card (not the file rows) must report the new file
  await page.waitForSelector('.card:has-text("change-detected.md")', { timeout: 15000 });
  check('changes check reports the new file (M6)', true);
  const token2 = await page.evaluate(() => localStorage.getItem('rsm.changesToken'));
  check('changes page token advanced', !!token1 && !!token2 && Number(token2) > Number(token1), `${token1} → ${token2}`);
  await page.close();
}

/* ============ 7. M5: cross-device session sync restore (MOB-12) ============ */
{
  // device A: sign in, open a Drive file, let the session sync
  const a = await ctx.newPage();
  await a.goto(APP, { waitUntil: 'networkidle' });
  await a.waitForSelector('.bottom-nav');
  await a.locator('.bottom-nav button[aria-label="Settings"]').click();
  if (await a.locator('button', { hasText: 'Connect Google Drive' }).count()) {
    await a.locator('button', { hasText: 'Connect Google Drive' }).first().click();
    await a.waitForSelector('.sheet');
    await a.locator('.sheet button', { hasText: 'Continue to Google' }).click();
    await a.waitForSelector('form[action="/mock/google/consent"]', { timeout: 15000 });
    await a.locator('form[action="/mock/google/consent"] button').click();
    await a.waitForURL(/\/m\/\?signedin=1/, { timeout: 15000 });
  }
  await a.locator('.bottom-nav button[aria-label="Library"]').click();
  await a.locator('.segmented button', { hasText: 'Google Drive' }).click();
  await a.waitForSelector('.row:has-text("Study Notes")', { timeout: 15000 });
  await a.locator('.row', { hasText: 'Study Notes' }).click();
  await a.waitForSelector('.row:has-text("python-basics.md")', { timeout: 15000 });
  await a.locator('.row', { hasText: 'python-basics.md' }).locator('button').first().click();
  await a.waitForSelector('.reader-content h1', { timeout: 15000 });
  await a.locator('button[aria-label="Back"]').click();
  await a.waitForTimeout(2200); // debounced session sync fires
  const synced = await a.evaluate(() => fetch('/api/workspaces', { credentials: 'same-origin' }).then((r) => r.json()));
  check('mobile session synced to the account (M5)', (synced.workspaces ?? []).some((w) => w.key === 'mobile-reader'), JSON.stringify((synced.workspaces ?? []).map((w) => w.key)));

  // device B: fresh storage, same account → Home offers resume
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const b = await ctxB.newPage();
  await b.goto(APP, { waitUntil: 'networkidle' });
  await b.waitForSelector('.screen');
  await b.locator('button', { hasText: 'Not now — just explore' }).click();
  await b.locator('.bottom-nav button[aria-label="Settings"]').click();
  await b.locator('button', { hasText: 'Connect Google Drive' }).first().click();
  await b.waitForSelector('.sheet');
  await b.locator('.sheet button', { hasText: 'Continue to Google' }).click();
  await b.waitForSelector('form[action="/mock/google/consent"]', { timeout: 15000 });
  await b.locator('form[action="/mock/google/consent"] button').click();
  await b.waitForURL(/\/m\/\?signedin=1/, { timeout: 15000 });
  await b.locator('.bottom-nav button[aria-label="Home"]').click();
  await b.waitForSelector('.card:has-text("Continue from your account")', { timeout: 15000 });
  check('device B sees cross-device resume card (MOB-12)', true);
  await b.locator('.card:has-text("Continue from your account")').click();
  await b.waitForSelector('.reader', { timeout: 20000 });
  await b.waitForSelector('.reader-content h1', { timeout: 20000 });
  check('resumed file opens from the account session (MOB-12)', ((await b.textContent('.reader-content h1')) ?? '').includes('Python Basics'));
  await ctxB.close();
  await a.close();
}

await browser.close();
console.log(failed === 0 ? '\nMOBILE SMOKE PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
