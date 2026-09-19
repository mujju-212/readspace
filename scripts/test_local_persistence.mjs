import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
console.log('Testing Local Folder Persistence & Reconnection against', BASE);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let fileChooserOpened = false;
page.on('filechooser', () => {
  fileChooserOpened = true;
});

// Step 1: Navigate to app
await page.goto(BASE, { waitUntil: 'networkidle' });

// Step 2: Inject a simulated local workspace snapshot into IndexedDB & localStorage
await page.evaluate(async () => {
  const sampleText = '# Local Notes\n\nHello from persisted local workspace!';
  const encoder = new TextEncoder();
  const buffer = encoder.encode(sampleText).buffer;
  
  // Save snapshot to IndexedDB
  const dbReq = indexedDB.open('readspace', 2);
  await new Promise((resolve, reject) => {
    dbReq.onupgradeneeded = () => {
      const db = dbReq.result;
      for (const s of ['kv', 'handles', 'drafts', 'recents', 'snapshots']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    dbReq.onsuccess = () => {
      const db = dbReq.result;
      const t = db.transaction(['kv', 'snapshots', 'recents'], 'readwrite');
      t.objectStore('kv').put({ kind: 'fallback', label: 'MyLocalProject' }, 'last');
      t.objectStore('snapshots').put([
        { path: 'notes.md', name: 'notes.md', type: 'text/markdown', size: buffer.byteLength, buffer }
      ], 'MyLocalProject');
      t.objectStore('snapshots').put([
        { path: 'notes.md', name: 'notes.md', type: 'text/markdown', size: buffer.byteLength, buffer }
      ], 'last');
      t.objectStore('recents').put([
        { kind: 'fallback', label: 'MyLocalProject', ts: Date.now() }
      ], 'list');
      t.oncomplete = () => resolve(true);
      t.onerror = (e) => reject(e);
    };
    dbReq.onerror = (e) => reject(e);
  });

  // Mirror in localStorage
  localStorage.setItem('rs.kv.last', JSON.stringify({ kind: 'fallback', label: 'MyLocalProject' }));
  localStorage.setItem('rs.recents', JSON.stringify([{ kind: 'fallback', label: 'MyLocalProject', ts: Date.now() }]));
});

console.log('Reloading page to test persistence...');
await page.reload({ waitUntil: 'networkidle' });

// Wait for workspace to restore
await page.waitForSelector('.ws-label', { timeout: 8000 });
const label = await page.locator('.ws-label').innerText();
console.log('Restored workspace label:', label);
if (label !== 'MyLocalProject') {
  console.error('FAIL: Expected MyLocalProject, got', label);
  process.exit(1);
}

// Check that files are listed in tree
await page.waitForSelector('.tree-row[data-path="notes.md"]', { timeout: 5000 });
console.log('PASS: Tree file notes.md is visible without selecting folder in explorer');

// Click on notes.md to open it
await page.locator('.tree-row[data-path="notes.md"]').click();
await page.waitForSelector('.md-body h1', { timeout: 5000 });
const heading = await page.locator('.md-body h1').innerText();
console.log('Opened file heading:', heading);
if (!heading.includes('Local Notes')) {
  console.error('FAIL: Heading does not match');
  process.exit(1);
}

// Now test going to Home and clicking Recent Items / Workspaces
console.log('Navigating to Home...');
await page.locator('button[title="Home"]').click();
await page.waitForSelector('.home', { timeout: 5000 });

console.log('Clicking recent item in Welcome screen...');
const recentItem = page.locator('.panel-list button.pl-item', { hasText: 'MyLocalProject' }).first();
await recentItem.click();

// Wait for tree to appear again
await page.waitForSelector('.ws-label', { timeout: 5000 });
console.log('PASS: Successfully re-opened local project from recent items');

if (fileChooserOpened) {
  console.error('FAIL: Windows file chooser was opened during restore/recent click!');
  process.exit(1);
} else {
  console.log('PASS: File explorer dialog was NEVER opened!');
}

await browser.close();
console.log('ALL LOCAL PERSISTENCE TESTS PASSED!');
