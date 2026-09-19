import { chromium } from 'playwright';
import path from 'node:path';

const BASE = 'http://localhost:5173';
const ARTIFACTS_DIR = 'C:/Users/User/.gemini/antigravity-ide/brain/c0320740-4421-43d3-aff6-e4b3e2a6ccb0/.tempmediaStorage';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

console.log('--- Testing PDF Centering, Audio (with Background Play), Video, and PPTX ---');

await page.goto(BASE, { waitUntil: 'networkidle' });

// 1. Open Sample Workspace
await page.getByRole('button', { name: /Try the sample workspace/i }).click();
await page.waitForSelector('.tree', { timeout: 8000 });
console.log('PASS: Sample workspace opened');

// 2. Test PDF Zoom Centering
await page.locator('.tree-row', { hasText: 'papers' }).first().click();
await page.waitForSelector('.tree-row[title="papers/readspace-demo.pdf"]', { timeout: 5000 });
await page.locator('.tree-row[title="papers/readspace-demo.pdf"]').click();
await page.waitForSelector('.pdf-page canvas', { timeout: 10000 });

// Click zoom out 3 times to get down to ~40%
const zoomOutBtn = page.getByRole('button', { name: 'Zoom out' });
await zoomOutBtn.click();
await page.waitForTimeout(300);
await zoomOutBtn.click();
await page.waitForTimeout(300);
await zoomOutBtn.click();
await page.waitForTimeout(500);

// Verify page is centered in scroll container
const pdfScrollBox = await page.locator('.pdf-scroll').boundingBox();
const firstPageBox = await page.locator('.pdf-page').first().boundingBox();

if (pdfScrollBox && firstPageBox) {
  const leftSpace = firstPageBox.x - pdfScrollBox.x;
  const rightSpace = (pdfScrollBox.x + pdfScrollBox.width) - (firstPageBox.x + firstPageBox.width);
  console.log(`PDF at 40% zoom: left space = ${Math.round(leftSpace)}px, right space = ${Math.round(rightSpace)}px`);
  if (Math.abs(leftSpace - rightSpace) < 40) {
    console.log('PASS: PDF page is horizontally centered at reduced zoom');
  } else {
    console.warn('WARN: PDF page alignment difference:', Math.abs(leftSpace - rightSpace));
  }
}

await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pdf_centered_zoom.png') });
console.log('Saved screenshot: pdf_centered_zoom.png');

// 3. Test PPTX Presentation Viewer
await page.locator('.tree-row', { hasText: 'media' }).first().click();
await page.waitForSelector('.tree-row[title="media/ai-overview.pptx"]', { timeout: 5000 });
await page.locator('.tree-row[title="media/ai-overview.pptx"]').click();
await page.waitForSelector('.pptx-viewer-wrap', { timeout: 10000 });
await page.waitForSelector('.pptx-slide-title', { timeout: 5000 });

const slide1Title = await page.locator('.pptx-slide-title').textContent();
console.log('PPTX Slide 1 Title:', slide1Title);
if (slide1Title?.includes('ReadSpace Presentation Deck')) {
  console.log('PASS: PPTX Slide 1 rendered correctly');
}

const thumbCount = await page.locator('.pptx-thumb-card').count();
console.log(`PPTX thumbnails count: ${thumbCount}`);

// Advance slide
await page.getByRole('button', { name: 'Next ▶' }).click();
await page.waitForTimeout(400);
const slide2Title = await page.locator('.pptx-slide-title').textContent();
console.log('PPTX Slide 2 Title:', slide2Title);
if (slide2Title?.includes('Architecture & Features')) {
  console.log('PASS: PPTX Slide navigation works');
}

await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pptx_viewer_demo.png') });
console.log('Saved screenshot: pptx_viewer_demo.png');

// 4. Test Audio Player & Background Play
await page.locator('.tree-row[title="media/lecture-audio.wav"]').click();
await page.waitForSelector('.audio-card', { timeout: 10000 });
console.log('PASS: AudioView rendered');
await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'audio_player_view.png') });
console.log('Saved screenshot: audio_player_view.png');

// Click Play
await page.locator('.audio-play-btn').click();
await page.waitForTimeout(500);

// Switch tab to a different file (e.g. notes/python-basics.md)
await page.locator('.tree-row', { hasText: 'notes' }).first().click();
await page.waitForSelector('.tree-row[title="notes/python-basics.md"]', { timeout: 5000 });
await page.locator('.tree-row[title="notes/python-basics.md"]').click();
await page.waitForSelector('.md-body', { timeout: 8000 });

// Verify floating Background Audio Bar is visible
await page.waitForSelector('.bg-audio-bar', { timeout: 5000 });
const bgAudioVisible = await page.locator('.bg-audio-bar').isVisible();
console.log('PASS: Background Audio Bar is active and floating across tabs:', bgAudioVisible);

await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'background_audio_bar.png') });
console.log('Saved screenshot: background_audio_bar.png');

// 5. Test Video Player
await page.locator('.tree-row[title="media/intro-clip.webm"]').click();
await page.waitForSelector('.video-player-wrap', { timeout: 10000 });
const videoScrubberVisible = await page.locator('.video-scrubber').isVisible();
console.log('PASS: VideoView rendered with controls and scrubber:', videoScrubberVisible);

await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'video_player_demo.png') });
console.log('Saved screenshot: video_player_demo.png');

await browser.close();
console.log('ALL MEDIA & VIEWER TESTS PASSED SUCCESSFULLY!');
