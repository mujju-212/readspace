/**
 * v1.1 cloud E2E (PRD extended MVP): sandbox auth → OAuth consent → Drive
 * connect → browse → open/save with conflict → session sync → restore.
 * Run with the combined server: node server/index.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const errors = [];
let failed = 0;
function check(name, ok, extra = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await fetch(`${BASE}/api/dev/reset`, { method: 'POST' }).catch(() => undefined);

// ---- 1. sign in (demo) ----
await page.locator('.tb-right button', { hasText: 'Sign in' }).first().click();
await page.waitForSelector('.acct-pop');
await page.locator('.acct-pop button', { hasText: 'Demo sign-in' }).click();
await page.waitForSelector('.acct-chip', { timeout: 8000 });
check('demo sign-in sets account chip', ((await page.locator('.acct-email').textContent()) ?? '').includes('Demo User'));
check('drive chip shows connect CTA (AUTH-02: identity ≠ drive)', await page.locator('.drive-chip', { hasText: 'Connect Drive' }).isVisible());

// ---- 2. full OAuth consent flow → connected ----
await page.locator('.drive-chip', { hasText: 'Connect Drive' }).click();
await page.waitForSelector('form[action="/mock/google/consent"]', { timeout: 10000 });
check('sandbox consent page renders with scopes', (await page.textContent('body'))?.includes('will allow ReadSpace to') ?? false);
await page.locator('form[action="/mock/google/consent"] button').click();
await page.waitForSelector('.drive-chip.connected', { timeout: 10000 });
check('drive chip shows connected after OAuth round-trip', true);

// ---- 3. the callback returns with ?drive=1 → workspace auto-opens; browse it ----
await page.waitForSelector('.ws-label', { timeout: 10000 });
await page.waitForSelector('.tree-row[title="Study Notes"]', { timeout: 10000 });
check('drive workspace auto-opens and tree renders', ((await page.locator('.ws-label').textContent()) ?? '').length > 0);
await page.locator('.tree-row[title="Study Notes"]').click();
await page.waitForSelector('.tree-row[title="Study Notes/python-basics.md"]', { timeout: 8000 });
check('drive subfolder lists files', true);
await page.locator('.tree-row[title="Study Notes/python-basics.md"]').click();
await page.waitForSelector('.md-body h1', { timeout: 10000 });
check('drive markdown opens in a tab and renders', ((await page.locator('.md-body h1').textContent()) ?? '').includes('Python Basics'));

// ---- 4. conflict flow: edit → mutate remote → save → dialog → overwrite ----
await page.locator('.mode-btn', { hasText: 'Edit' }).click();
await page.waitForSelector('.cm-content', { timeout: 8000 });
await page.locator('.cm-content').click();
await page.keyboard.type('\nConflict test edit.');
await page.waitForTimeout(300);
// mutate the file on the server behind the app's back (simulates another device)
const fileId = await page.evaluate(async () => {
  const list = await fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json());
  const notes = list.files.find((f) => f.name === 'Study Notes');
  const sub = await fetch(`/api/drive/files?parentId=${notes.id}`, { credentials: 'same-origin' }).then((r) => r.json());
  return sub.files.find((f) => f.name === 'python-basics.md').id;
});
await page.evaluate(async (id) => {
  await fetch(`/api/drive/files/${id}`, { method: 'PATCH', body: 'remote device changed this', credentials: 'same-origin' });
}, fileId);
await page.keyboard.press('Control+s');
await page.waitForSelector('.confirm-box', { timeout: 8000 });
check('conflict dialog appears (SYNC-01)', ((await page.locator('.confirm-msg').textContent()) ?? '').includes('changed on Google Drive'));
await page.screenshot({ path: 'screenshots/conflict-dialog.png' });
await page.locator('.confirm-actions button', { hasText: 'Overwrite remote' }).click();
await page.waitForTimeout(800);
check('overwrite resolves conflict', (await page.locator('.confirm-box').count()) === 0);
// verify remote content now has our edit
const remoteHasEdit = await page.evaluate(async (id) => {
  const res = await fetch(`/api/drive/files/${id}/content`, { credentials: 'same-origin' });
  return (await res.text()).includes('Conflict test edit.');
}, fileId);
check('remote file actually contains our edit', remoteHasEdit);

// ---- 5. account session sync → reload → restore ----
await page.waitForTimeout(1800); // allow the debounced session sync to fire
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.ws-label', { timeout: 10000 });
check('cloud workspace restores after reload', ((await page.locator('.ws-label').textContent()) ?? '') !== '');
await page.waitForSelector('.tab', { timeout: 8000 });
check('tabs restored from account session', (await page.locator('.tab').count()) >= 1, `${await page.locator('.tab').count()} tab(s)`);

// ---- 6. upload selected via Cloud menu (mock transfer) ----
await page.locator('.tb-right button', { hasText: 'Cloud' }).click();
const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
await page.locator('.cloud-menu button', { hasText: 'Upload files here…' }).click();
const chooser = await chooserPromise;
await chooser.setFiles([{
  name: 'uploaded-by-e2e.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# Uploaded by E2E\n\nThis file arrived via the transfer flow.'),
}]);
await page.waitForSelector('.transfer-panel', { timeout: 10000 });
await page.waitForTimeout(1200);
check('upload job completes', ((await page.locator('.tp-job .tp-status').first().textContent()) ?? '') === 'succeeded');
// the uploaded file should appear in the Drive tree root
await page.waitForTimeout(600);
check('uploaded file lands in Drive root listing', (await page.locator('.tree-row').count()) >= 3);

// ---- 7. scan + review queue (DRV-05) via API-level verification ----
const scan = await page.evaluate(async () => {
  const manifest = [
    { relativePath: 'definitely-new.md', name: 'definitely-new.md', size: 1234 },
    { relativePath: 'python-basics.md', name: 'python-basics.md', size: 50 },
  ];
  const root = await fetch('/api/drive/files?parentId=root', { credentials: 'same-origin' }).then((r) => r.json());
  const notes = root.files.find((f) => f.name === 'Study Notes');
  return fetch('/api/transfers/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'readspace' },
    body: JSON.stringify({ driveFolderId: notes.id, manifest }),
    credentials: 'same-origin',
  }).then((r) => r.json());
});
check('scan classifies new vs collision', scan.candidates?.[0]?.classification === 'likely_new' && scan.candidates?.[1]?.classification === 'name_collision');

// ---- 8. download current file → fallback browser download ----
await page.locator('.tab').first().click();
try {
  await page.waitForSelector('.md-body, .text-body pre, .cm-content', { timeout: 10000 });
} catch {
  console.log('DIAG tabs:', await page.locator('.tab .tab-title').allTextContents());
  console.log('DIAG content:', (await page.locator('.content').innerText().catch(() => 'ERR')).slice(0, 300));
  throw new Error('restored tab did not render');
}
const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await page.locator('.tb-right button', { hasText: 'Cloud' }).click();
await page.locator('.cloud-menu button', { hasText: 'Download current file…' }).click();
const download = await downloadPromise;
check('download flow produces a file (fallback path in headless)', !!download, download ? await download.suggestedFilename() : '');

// ---- 9. saved links: paste → save to collection → panel → open (PDF) ----
await page.locator('button[aria-label="Open from Google Drive"]').click();
await page.locator('.drive-link').fill('https://drive.google.com/file/d/sharedDbmsPdf001/view?resourcekey=rk-dbms-313');
await page.locator('.drive-actions button', { hasText: 'Save to collection…' }).click();
await page.waitForFunction(() => (document.querySelector('.sl-title')?.value || '').length > 0, { timeout: 8000 }).catch(() => null);
check('save dialog pre-fills title from Drive meta', ((await page.locator('.sl-title').inputValue())) === 'DBMS Unit 3 Notes.pdf');
await page.locator('.sl-collection').fill('College');
await page.locator('.save-link-dialog button', { hasText: 'Save link' }).click();
await page.waitForFunction(() => document.querySelectorAll('.toast').length > 0, { timeout: 8000 });
// second link: shared folder, plain "Save link" (no collection)
await page.locator('button[aria-label="Open from Google Drive"]').click();
await page.locator('.drive-link').fill('https://drive.google.com/drive/folders/sharedSem7Folder01?resourcekey=rk-sem7-246');
await page.locator('.drive-actions button', { hasText: 'Save link' }).click();
await page.waitForSelector('.save-link-dialog');
await page.locator('.save-link-dialog button', { hasText: 'Save link' }).click();
await page.waitForTimeout(500);
// open the panel from the account menu
await page.locator('.acct-chip').click();
await page.locator('.acct-pop button', { hasText: 'Saved links' }).click();
await page.waitForSelector('.saved-panel');
check('panel groups by collection', await page.waitForSelector('.saved-group-header', { hasText: 'College', timeout: 8000 }).then(() => true).catch(() => false));
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/v11-saved-links.png' });
check('folder row shows external-folder meta', ((await page.locator('.saved-row', { hasText: 'Semester 7 Materials' }).innerText())).includes('folder'));
// open the shared PDF from the panel
await page.locator('.saved-row', { hasText: 'DBMS Unit 3 Notes.pdf' }).locator('button', { hasText: 'Open' }).click();
await page.waitForSelector('canvas', { timeout: 20000 });
check('saved PDF opens in the pdf.js viewer', true);
await page.waitForTimeout(600);
const savedApi = await page.evaluate(() => fetch('/api/saved-links', { credentials: 'same-origin' }).then((r) => r.json()));
const pdfRec = savedApi.links.find((l) => l.title.includes('DBMS'));
check('lastOpenedAt + openCount recorded', !!pdfRec?.lastOpenedAt && (pdfRec?.openCount ?? 0) >= 1);

// ---- 10. shared folder link opens as a tree; child file renders ----
await page.locator('.acct-chip').click();
await page.locator('.acct-pop button', { hasText: 'Saved links' }).click();
await page.waitForSelector('.saved-panel');
await page.locator('.saved-row', { hasText: 'Semester 7 Materials' }).locator('button', { hasText: 'Open' }).click();
await page.waitForSelector('.tree-row[title="dsa-cheatsheet.md"]', { timeout: 15000 });
check('shared folder opens as a tree (resourceKey honored)', true);
await page.locator('.tree-row[title="dsa-cheatsheet.md"]').click();
await page.waitForSelector('.md-body h1', { timeout: 10000 });
check('file inside shared folder renders', ((await page.locator('.md-body h1').textContent()) ?? '').includes('DSA'));
// saved link was the last workspace → reload restores it via the account record
await page.waitForTimeout(1800);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.tree-row[title="dsa-cheatsheet.md"]', { timeout: 15000 });
check('saved-link workspace restores after reload', true);

// ---- 11. resourceKey enforcement + owner revocation respected ----
const rk = await page.evaluate(async () => {
  const noKey = await fetch('/api/drive/files/sharedDbmsPdf001/meta', { credentials: 'same-origin' });
  const withKey = await fetch('/api/drive/files/sharedDbmsPdf001/meta?resourceKey=rk-dbms-313', { credentials: 'same-origin' });
  return { noKey: noKey.status, withKey: withKey.status };
});
check('link-shared meta is 404 without its resourceKey', rk.noKey === 404);
check('link-shared meta is 200 with its resourceKey', rk.withKey === 200);
await page.evaluate(() => fetch('/api/dev/revoke-shared', { method: 'POST', credentials: 'same-origin' }));
await page.locator('.acct-chip').click();
await page.locator('.acct-pop button', { hasText: 'Saved links' }).click();
await page.waitForSelector('.saved-panel');
await page.locator('.saved-row', { hasText: 'DBMS Unit 3 Notes.pdf' }).locator('button', { hasText: 'Open' }).click();
await page.waitForFunction(() => {
  const els = [...document.querySelectorAll('.toast')];
  return els.some((e) => /revoked|resource key/i.test(e.innerText));
}, { timeout: 8000 });
check('revoked link warns instead of failing silently', true);
check('record kept after revocation (reference survives)', (await page.locator('.saved-row').count()) >= 2);
await page.locator('.saved-panel .drive-actions button', { hasText: 'Close' }).click();

// ---- 12. disconnect Drive → chip returns to connect state ----
await page.locator('.acct-chip').click();
await page.locator('.acct-pop button', { hasText: 'Disconnect Drive' }).click();
await page.waitForSelector('.drive-chip:has-text("Connect Drive")', { timeout: 8000 });
check('disconnect returns to connect state', true);

const realErrors = errors.filter((e) => !/status of (400|404|409)/i.test(e));
console.log('\n--- console errors (unexpected) ---');
console.log(realErrors.length ? realErrors.slice(0, 8).join('\n') : '(none — clean run)');
await browser.close();
console.log(failed === 0 && realErrors.length === 0 ? '\nCLOUD E2E PASSED' : `\n${failed || realErrors.length} CHECK(S) FAILED`);
process.exit(failed === 0 && realErrors.length === 0 ? 0 : 1);
