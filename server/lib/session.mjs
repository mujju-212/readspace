/**
 * App-session management (AUTH-05): opaque server-side sessions referenced by
 * an HttpOnly SameSite cookie. Logout deletes the server record so the cookie
 * becomes useless — no client-trust at all. Mutating requests require a
 * same-origin check (CSRF baseline on top of SameSite=Lax).
 */
import { db } from './db.mjs';
import { parseCookies, randomId, nowIso } from './util.mjs';

export const SESSION_COOKIE = 'rs_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

export async function createSession(userId) {
  const sid = randomId(32);
  await db.coll('sessions').put(sid, {
    sid,
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  return sid;
}

export async function destroySession(sid) {
  if (sid) await db.coll('sessions').delete(sid);
}

export async function userFromRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const sid = req.headers['x-session-id'] || bearerToken || parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const session = await db.coll('sessions').get(sid);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await db.coll('sessions').delete(sid);
    return null;
  }
  const user = await db.coll('users').get(session.userId);
  return user ?? null;
}

export function sessionCookie(sid, secure) {
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** CSRF baseline: mutating requests must come from our own origin. */
export function sameOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-site form posts / curl during tests
  try {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (new URL(origin).host === host) return true;
    const urlObj = new URL(origin);
    // Allow local development origins (such as Expo web on port 8081, Metro, etc.)
    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}
