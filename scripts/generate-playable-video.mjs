import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage();

// Use HTML5 Canvas + MediaRecorder to record a valid 2-second WebM clip
const videoBase64 = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];

  recorder.ondataavailable = (e) => chunks.push(e.data);

  return new Promise((resolve) => {
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    };

    recorder.start();

    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      // Draw background
      const grad = ctx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 360);

      // Draw title
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ReadSpace Video Player Demo', 320, 160);

      // Draw animated orb
      const x = 320 + Math.sin(frame * 0.1) * 120;
      const y = 230 + Math.cos(frame * 0.1) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#6366f1';
      ctx.fill();

      // Timestamp
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px monospace';
      ctx.fillText(`Time: ${(frame / 30).toFixed(1)}s`, 320, 290);

      if (frame >= 60) {
        clearInterval(interval);
        recorder.stop();
      }
    }, 1000 / 30);
  });
});

await browser.close();

const buffer = Buffer.from(videoBase64, 'base64');
const target = path.resolve('public/sample-workspace/media/intro-clip.webm');
fs.writeFileSync(target, buffer);
console.log('Generated real valid playable video:', target, buffer.length, 'bytes');
