/**
 * ReadSpace backend + static host.
 * Serves:  /dist build  ·  /api/* (PRD v1.1 §14)  ·  /mock/google/* (sandbox consent)
 * One process, one port — mirrors how the Vercel deployment splits static vs
 * serverless routes, but runs anywhere Node runs.
 *
 *   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET  → real Google OAuth + Drive
 *   (unset)                                  → built-in sandbox mode
 *   MONGODB_URI                              → Atlas (adapter seam in db.mjs)
 */
import './lib/env.mjs'; // must stay FIRST — loads .env before google.mjs reads creds
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './lib/routes.mjs';
import { json } from './lib/util.mjs';
import { mockAuthorizePage, mockConsumeCode, seedMockDrive } from './lib/mockdrive.mjs';
import { googleMode } from './lib/google.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const mobileRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mobile', 'dist');
const port = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
};

async function serveStatic(req, res, pathname, base = root) {
  const rel = base === mobileRoot ? pathname.replace(/^\/m\/?/, '') : pathname;
  let file = join(base, normalize(rel || '/').replace(/^([.][.][/\\])+/, ''));
  if (base === mobileRoot && !file.startsWith(mobileRoot.endsWith(sep) ? mobileRoot : mobileRoot + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!file.startsWith(base.endsWith(sep) ? base : base + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(base, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with, Cookie, Set-Cookie, x-session-id, X-Session-Id, *');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url ?? '/', 'http://local');
  const pathname = decodeURIComponent(url.pathname);

  try {
    /* mobile app shell (readspace/mobile build) */
    if (pathname === '/m' || pathname === '/m/' || pathname.startsWith('/m/')) {
      return serveStatic(req, res, pathname, mobileRoot);
    }

    /* sandbox OAuth endpoints (browser-facing consent flow) */
    if (pathname === '/mock/google/authorize') {
      const page = mockAuthorizePage(Object.fromEntries(url.searchParams.entries()));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page);
    }
    if (pathname === '/mock/google/consent') {
      const redirect = url.searchParams.get('redirect_uri') ?? '/api/auth/google/callback';
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code') ?? '';
      if (!mockConsumeCode(code)) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return res.end('invalid sandbox authorization code');
      }
      const target = new URL(redirect, `http://${req.headers.host ?? 'localhost'}`);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
      return res.end();
    }
    /* (token exchange happens in-process via google.mjs; no HTTP token endpoint needed in sandbox) */

    if (pathname.startsWith('/api/')) {
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      return await handleApi(req, res, pathname);
    }

    return await serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  }
});

void seedMockDrive('demo-user-0001').catch(() => undefined);

server.listen(port, '0.0.0.0', () => {
  console.log(`[readspace] server on http://0.0.0.0:${port} · auth mode: ${googleMode}`);
});
