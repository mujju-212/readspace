/**
 * Browser smoke test for ReadSpace (run: node scripts/smoke.mjs)
 * Exercises: sample workspace load, tree, markdown/pdf/docx/html/txt viewers,
 * edit mode, dirty state, quick open, theme switch.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const errors = [];
let failed = 0;

function check(name, ok, extra = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failed++;
  console.log(`${mark}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. welcome screen
check('welcome screen shows', await page.getByRole('button', { name: /Try the sample workspace/i }).isVisible());

// 2. load sample workspace
await page.getByRole('button', { name: /Try the sample workspace/i }).click();
await page.waitForSelector('.tree', { timeout: 5000 });
const treeRows = await page.locator('.tree-row').count();
check('sample tree renders', treeRows >= 5, `${treeRows} root rows`);

// 3. expand notes/ and open the markdown file
await page.locator('.tree-row', { hasText: 'notes' }).first().click();
await page.waitForSelector('.tree-row[title="notes/python-basics.md"]', { timeout: 5000 });
await page.locator('.tree-row[title="notes/python-basics.md"]').click();
await page.waitForSelector('.md-body h1', { timeout: 8000 });
check('markdown renders h1', (await page.locator('.md-body h1').textContent())?.includes('Python Basics') ?? false);
check('markdown table renders', (await page.locator('.md-body table tr').count()) > 3);
check('markdown code highlighted', (await page.locator('.md-body pre code .hljs-keyword').count()) > 0);
check('tab bar shows tab', (await page.locator('.tab').count()) === 1);

// 3b. opening another file must ADD a tab, never replace (v0.2 behaviour)
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'web-dev');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.tab:nth-child(2)');
check('second file adds a tab (no preview replacement)', (await page.locator('.tab').count()) === 2);
// re-activating the first file reuses its tab
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'python-basics');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
check('re-opening a file reuses its tab', (await page.locator('.tab').count()) === 2);
await page.locator('.tab.active .tab-close').click(); // close it again for the counts below
await page.waitForTimeout(200);

// 4. open PDF via quick open (Ctrl+P)
await page.keyboard.press('Control+p');
await page.waitForSelector('.qo-input');
await page.fill('.qo-input', 'demo.pdf');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.pdf-page canvas', { timeout: 15000 });
await page.waitForTimeout(800);
check('pdf canvas rendered', (await page.locator('.pdf-page canvas').count()) >= 1);
check('pdf toolbar page info', (await page.locator('.pdf-pageinfo').textContent())?.includes('Page 1 / 3') ?? false);

// 5. open DOCX
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'sample-report.docx');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.docx-body h1', { timeout: 15000 });
check('docx renders h1', (await page.locator('.docx-body').textContent())?.includes('Sample Report') ?? false);
check('docx renders table', (await page.locator('.docx-body table').count()) === 1);
check('pdf/docx hides preview-edit toggle', (await page.locator('.mode-toggle').count()) === 0);

// 6. open the sandboxed HTML file
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'project-report.html');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.html-frame', { timeout: 10000 });
check('html sandboxed iframe (no allow-scripts)', (await page.locator('.html-frame').getAttribute('sandbox')) === '');
// per-file scripts toggle
const scriptsBtn = page.locator('.html-view button', { hasText: 'Scripts off' });
check('html scripts toggle present', await scriptsBtn.isVisible());
await scriptsBtn.click();
check('allow-scripts sandbox on toggle', (await page.locator('.html-frame').getAttribute('sandbox')) === 'allow-scripts');
check('toolbar reports scripts enabled', (await page.locator('.html-view .muted').first().textContent())?.includes('enabled') ?? false);
// the sample page updates a status line when its script is allowed to run
let scriptRan = true;
try {
  await page.frameLocator('.html-frame').getByText('JavaScript: executed').waitFor({ timeout: 6000 });
} catch { scriptRan = false; }
check('allowed script actually executes in sandbox', scriptRan);
await page.locator('.html-view button', { hasText: 'Scripts on' }).click();

// 7. txt + image + csv tabs
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'reading-list.txt');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.text-body pre');
check('txt viewer renders', (await page.locator('.text-body pre').textContent())?.includes('READING LIST') ?? false);
check('tabs accumulate', (await page.locator('.tab').count()) >= 5);

// 8. markdown edit mode: switch mode, type, check dirty state
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'web-dev');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.md-body');
await page.locator('.mode-btn', { hasText: 'Edit' }).click();
let editorOk = true;
try {
  await page.waitForFunction(() => !!document.querySelector('.cm-editor, .plain-editor'), null, { timeout: 8000 });
} catch { editorOk = false; }
check('edit mode opens editor', editorOk);
// type into the editor (click into content area first)
await page.locator('.cm-content, .plain-editor').first().click();
await page.keyboard.type('\nEdited by smoke test.');
await page.waitForTimeout(400);
check('dirty indicator appears', (await page.locator('.dirty-dot').count()) === 1);
check('status bar shows unsaved', (await page.locator('.sb-dirty').count()) === 1);

// split mode shows editor + preview
await page.locator('.mode-btn', { hasText: 'Split' }).click();
await page.waitForSelector('.split .md-body');
check('split mode renders editor + preview', (await page.locator('.split .md-body').count()) === 1);

// 9. sidebar resize + collapse
const before = await page.locator('.sidebar').boundingBox();
const divider = page.locator('.divider');
const box = await divider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 5 });
await page.mouse.up();
const after = await page.locator('.sidebar').boundingBox();
check('divider drag widens sidebar', after.width > before.width + 80, `${before.width} → ${after.width}`);
await page.keyboard.press('Control+b');
check('Ctrl+B collapses sidebar', (await page.locator('.sidebar').count()) === 0);
await page.keyboard.press('Control+b');

// 10. theme switch
await page.locator('button[title^="Theme:"]').click();
await page.waitForTimeout(200);
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme cycles', theme === 'sepia' || theme === 'light', theme);

// 11. zen mode
await page.keyboard.press('Control+Alt+z');
await page.waitForTimeout(200);
check('zen mode hides chrome', (await page.locator('.tabbar').count()) === 0 && (await page.locator('.statusbar').count()) === 0);
await page.keyboard.press('Control+Alt+z');

// 12. session restore: reload → sample workspace + tabs return, tree expansion kept
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.tree-row', { timeout: 8000 });
check('session restores workspace after reload', await page.locator('.ws-label').isVisible());
await page.waitForTimeout(600);
check('session restores tabs', (await page.locator('.tab').count()) >= 5, `${await page.locator('.tab').count()} tabs`);
check('tree expansion restored', (await page.locator('.tree-row[title="notes/python-basics.md"]').count()) === 1);

// 13. Google Drive: paste a link (mocked Drive API) → opens like a folder
let driveCalls = 0;
await page.route('**/drive/v3/**', async (route) => {
  driveCalls++;
  const url = new URL(route.request().url());
  const parts = url.pathname.split('/').filter(Boolean); // ['drive','v3','files', id?]
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.searchParams.get('key') !== 'TESTKEY') return json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400);
  if (url.searchParams.get('alt') === 'media') {
    const id = parts[3];
    const body = id === 'MD1' ? '# Notes from Drive\n\n## Section A\n\nIt works.' : 'child text file from drive';
    return route.fulfill({ status: 200, contentType: 'text/plain', body });
  }
  if (url.pathname.endsWith('/export')) {
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Exported Google Doc text' });
  }
  const id = parts[3];
  if (!id) {
    const parent = /'([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1];
    const files = parent === 'SUBID'
      ? [{ id: 'CHILD1', name: 'child.txt', mimeType: 'text/plain' }]
      : [
          { id: 'MD1', name: 'notes.md', mimeType: 'text/markdown' },
          { id: 'SUBID', name: 'sub', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'GD1', name: 'Lesson', mimeType: 'application/vnd.google-apps.document' },
        ];
    return json({ files });
  }
  const metas = {
    ROOTFOLDER: { id: 'ROOTFOLDER', name: 'Drive folder', mimeType: 'application/vnd.google-apps.folder' },
    MD1: { id: 'MD1', name: 'notes.md', mimeType: 'text/markdown' },
    SUBID: { id: 'SUBID', name: 'sub', mimeType: 'application/vnd.google-apps.folder' },
    GD1: { id: 'GD1', name: 'Lesson', mimeType: 'application/vnd.google-apps.document' },
    CHILD1: { id: 'CHILD1', name: 'child.txt', mimeType: 'text/plain' },
  };
  return metas[id] ? json(metas[id]) : json({ error: { message: 'File not found' } }, 404);
});

await page.locator('button[title="Open from Google Drive (public link)"]').click();
await page.waitForSelector('.drive-dialog');
await page.fill('.drive-key', 'WRONGKEY');
await page.fill('.drive-link', 'https://drive.google.com/drive/folders/ROOTFOLDER');
check('drive link detected as folder', (await page.locator('.drive-detect').textContent())?.includes('Folder') ?? false);
await page.locator('.drive-actions button', { hasText: 'Open folder' }).click();
await page.waitForSelector('.drive-error', { timeout: 8000 });
check('drive wrong key shows friendly error', (await page.locator('.drive-error').textContent())?.includes('API key') ?? false);
await page.fill('.drive-key', 'TESTKEY');
await page.locator('.drive-actions button', { hasText: 'Open folder' }).click();
await page.waitForSelector('.drive-dialog', { state: 'detached', timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.ws-label')?.textContent === 'Drive folder', null, { timeout: 10000 });
await page.waitForSelector('.tree-row[title="notes.md"]', { timeout: 10000 });
check('drive workspace opens', (await page.locator('.ws-label').textContent()) === 'Drive folder');
check('drive root lists 3 items', (await page.locator('.tree-row').count()) === 3);
await page.locator('.tree-row[title="notes.md"]').click();
await page.waitForSelector('.md-body h1', { timeout: 10000 });
check('drive markdown renders', (await page.locator('.md-body h1').textContent())?.includes('Notes from Drive') ?? false);
await page.keyboard.press('Control+p');
await page.fill('.qo-input', 'Lesson');
await page.waitForSelector('.qo-item', { timeout: 8000 });
await page.keyboard.press('Enter');
await page.waitForSelector('.text-body pre', { timeout: 10000 });
check('google doc opens as text', (await page.locator('.text-body pre').textContent())?.includes('Exported Google Doc text') ?? false);
await page.locator('.tree-row[title="sub"]').click();
await page.waitForSelector('.tree-row[title="sub/child.txt"]', { timeout: 8000 });
check('drive subfolder lazy-loads', true);
check('drive api called lazily', driveCalls >= 5, `${driveCalls} api calls`);


// 14. Keyless Google-native docs (export endpoints) + key-required uploads
await page.route(/docs\.google\.com\//, async (route) => {
    const url = route.request().url();
  if (url.includes('/document/d/DOCID1234567890/')) {
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Keyless Google Doc text' });
  }
  return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
});
await page.route(/drive\.google\.com\//, async (route) => {
  const url = route.request().url();
  if (url.includes('uc?export=download')) {
    return route.fulfill({ status: 403, contentType: 'text/html', body: '<html>sign in</html>' });
  }
  return route.fulfill({ status: 404, contentType: 'text/html', body: '<html></html>' });
});

// a Google Doc link opens without any key
await page.locator('button[title="Open from Google Drive (public link)"]').click();
await page.waitForSelector('.drive-dialog');
await page.fill('.drive-link', 'https://docs.google.com/document/d/DOCID1234567890/edit');
await page.waitForTimeout(400);
check('doc link detected as Google Doc', (await page.locator('.drive-detect').textContent())?.includes('Google Doc') ?? false);
check('no-key note shown for docs', (await page.locator('.drive-note-ok').count()) === 1);
await page.locator('.drive-actions button', { hasText: 'Open file' }).click();
await page.waitForSelector('.drive-dialog', { state: 'detached', timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.ws-label')?.textContent === 'Google Doc.txt', null, { timeout: 10000 });
check('keyless doc opens as a tab', (await page.locator('.tab').count()) === 1);
await page.waitForFunction(() => document.querySelector('.content')?.textContent?.includes('Keyless Google Doc text'), null, { timeout: 10000 });
check('keyless doc text renders', true);
check('keyless ws label', (await page.locator('.ws-label').textContent()) === 'Google Doc.txt');

// an uploaded file (PDF on drive.google.com) cannot be fetched keylessly -> key UI appears
await page.locator('button[title="Open from Google Drive (public link)"]').click();
await page.fill('.drive-link', 'https://drive.google.com/file/d/BINFILE123456789/view');
await page.locator('.drive-actions button', { hasText: 'Open file' }).click();
await page.waitForSelector('.drive-error', { timeout: 10000 });
check('uploaded file failure shows an explanation', ((await page.locator('.drive-error').textContent()) ?? '').length > 10);
await page.waitForSelector('.drive-key', { timeout: 8000 });
check('failed open reveals the API-key steps', true);
await page.locator('.drive-actions button', { hasText: 'Cancel' }).click();

// session restore for a keyless workspace
await page.waitForTimeout(400);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.ws-label', { timeout: 8000 });
await page.waitForTimeout(600);
check('keyless drive workspace restores after reload', (await page.locator('.ws-label').textContent()) === 'Google Doc.txt');

console.log('\n--- console errors ---');
// the deliberate wrong-API-key test produces an expected 400 network log
const realErrors = errors.filter((e) => !/status of (400|404)/i.test(e));
console.log(realErrors.length ? realErrors.slice(0, 10).join('\n') : '(none — clean run)');

await page.screenshot({ path: 'scripts/smoke-final.png', fullPage: false });
await browser.close();
console.log(failed === 0 && realErrors.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed || realErrors.length} CHECK(S) FAILED`);
process.exit(failed === 0 && realErrors.length === 0 ? 0 : 1);
