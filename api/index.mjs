import '../server/lib/env.mjs';
import { handleApi } from '../server/lib/routes.mjs';
import { mockAuthorizePage, mockConsumeCode, seedMockDrive } from '../server/lib/mockdrive.mjs';

// Seed mock drive once per container instance in sandbox mode
void seedMockDrive('demo-user-0001').catch(() => undefined);

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    /* sandbox OAuth endpoints (consent flow) */
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
      const target = new URL(redirect, `https://${req.headers.host ?? 'localhost'}`);
      target.searchParams.set('code', code);
      target.searchParams.set('state', state);
      res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
      return res.end();
    }

    /* All API endpoints */
    if (pathname.startsWith('/api/')) {
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      return await handleApi(req, res, pathname);
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  } catch (err) {
    console.error('[vercel-api]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
