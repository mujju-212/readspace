/**
 * All backend routes for the extended ReadSpace (PRD v1.1 §14).
 * Every route derives the acting user from the verified app session —
 * the browser never supplies a userId (SEC-01). Refresh tokens are
 * decrypted only inside this module and never returned to any client (SEC-02).
 */
import crypto from 'node:crypto';
import { db } from './db.mjs';
import { json, httpError, readBody, readJson, parseCookies, randomId, nowIso } from './util.mjs';
import { createSession, destroySession, userFromRequest, sessionCookie, clearedSessionCookie, sameOriginOk, SESSION_COOKIE } from './session.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { googleMode, clientConfig, buildAuthorizeUrl, exchangeCode, refreshAccessToken, identifyUser, driveListFiles, driveFileMeta, driveFileContent, driveCreateFile, driveUpdateFile, driveRevoke, DRIVE_SCOPE, driveChanges, listCache, metaCache, invalidateDriveCache } from './google.mjs';
import { seedMockDrive, mockAuthorizePage, resetMockDrives, revokeSharedFixtures, DEMO_SUBJECT } from './mockdrive.mjs';
import {
  hashPassword,
  verifyPassword,
  createPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  createPasskeyLoginOptions,
  verifyPasskeyLogin,
} from './auth-passkey.mjs';

const APP_BASE = process.env.APP_BASE_URL ?? '';

function baseUrl(req) {
  if (APP_BASE) return APP_BASE;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:5173';
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${host}`;
}

function getGoogleRedirect(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${baseUrl(req)}/api/auth/google/callback`;
}

function sanitizeReturnTo(rt) {
  if (!rt || typeof rt !== 'string') return '/';
  if (rt === '/' || (/^\/[^\/]/.test(rt) && !rt.startsWith('//'))) return rt;
  try {
    const u = new URL(rt);
    if (u.protocol === 'readspace:' || u.protocol === 'exp:' || u.protocol === 'exps:') return rt;
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const hostname = u.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return rt;
      }
      if (process.env.APP_BASE_URL) {
        try {
          const appBase = new URL(process.env.APP_BASE_URL);
          if (u.origin === appBase.origin) return rt;
        } catch {}
      }
    }
  } catch {}
  return '/';
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] ?? '') === 'https';
}

function requireUser(req) {
  return userFromRequest(req); // resolved by caller with await
}

function publicUser(user) {
  return user
    ? {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        hasPassword: Boolean(user.passwordHash),
        passkeyCount: (user.passkeys || []).length,
      }
    : null;
}

async function getConnection(userId) {
  const conn = await db.coll('connections').findOne((c) => c.userId === userId && !c.revokedAt);
  return conn ?? null;
}

/** Get a usable access token for the user's Drive connection, refreshing server-side. */
async function getAccessToken(conn) {
  if (!conn || conn.status === 'disconnected') throw httpError(400, 'Google Drive is not connected', 'drive_not_connected');
  const refreshToken = decryptSecret(conn.refreshTokenCiphertext, conn.encryptionKeyVersion);
  try {
    const tokens = await refreshAccessToken(refreshToken);
    await db.coll('connections').put(conn._id, { ...conn, status: 'connected', lastUsedAt: nowIso() });
    return tokens.access_token;
  } catch (e) {
    // invalid_grant → requires reauthorization; do NOT loop (AUTH-04)
    const code = (e).codeName ?? 'refresh_failed';
    await db.coll('connections').put(conn._id, { ...conn, status: code === 'invalid_grant' ? 'reauthorization_required' : 'error', lastUsedAt: nowIso() });
    throw httpError(401, code === 'invalid_grant'
      ? 'Drive authorization has expired — reconnect your Google account.'
      : `Could not refresh Google access (${code}).`, code);
  }
}

async function withDrive(req) {
  const user = await requireUser(req);
  if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
  const conn = await getConnection(user._id);
  if (!conn) throw httpError(400, 'Google Drive is not connected', 'drive_not_connected');
  const accessToken = await getAccessToken(conn);
  return { user, conn, accessToken };
}

const MIME_TO_EXT = {
  'text/markdown': 'md', 'text/x-markdown': 'md', 'application/pdf': 'pdf', 'text/html': 'html',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.google-apps.document': 'txt', 'application/vnd.google-apps.spreadsheet': 'csv',
  'application/vnd.google-apps.presentation': 'pptx',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
};

export async function handleApi(req, res, pathname) {
  try {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://local');

    /* ---------- public config ---------- */
    if (method === 'GET' && pathname === '/api/config') {
      return json(res, 200, { ...clientConfig(), appName: 'ReadSpace' });
    }

    /* ================= AUTH ================= */

    if (method === 'GET' && pathname === '/api/auth/google/start') {
      const withDrive = url.searchParams.get('drive') === '1';
      // mobile app hands off back to its own shell (open-redirect guarded)
      const rt = url.searchParams.get('returnTo') ?? '/';
      const returnTo = sanitizeReturnTo(rt);
      const state = randomId(16);
      const codeVerifier = randomId(32);
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      await db.coll('oauthStates').put(state, { state, codeVerifier, withDrive, returnTo, createdAt: nowIso() });
      const redirect = buildAuthorizeUrl({ redirectUri: getGoogleRedirect(req), state, codeChallenge, withDrive });
      if (googleMode === 'sandbox') {
        // sandbox: render the consent page directly (it continues the flow)
        const u = new URL(redirect, 'http://local');
        const page = mockAuthorizePage(Object.fromEntries(u.searchParams.entries()));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(page);
      }
      res.writeHead(302, { location: redirect, 'cache-control': 'no-store' });
      return res.end();
    }

    if (method === 'GET' && pathname === '/api/auth/google/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) throw httpError(400, 'Missing code/state', 'oauth_bad_callback');
      const pending = await db.coll('oauthStates').get(state);
      if (!pending) throw httpError(400, 'Unknown or expired OAuth state (login CSRF protection)', 'bad_state');
      await db.coll('oauthStates').delete(state);

      const tokens = await exchangeCode({ code, redirectUri: getGoogleRedirect(req), codeVerifier: pending.codeVerifier });
      const identity = await identifyUser(tokens);

      // upsert user by stable subject (AUTH-01) or existing email
      let user = await db.coll('users').findOne((u) => u.googleSubject === identity.subject);
      if (!user && identity.email) {
        user = await db.coll('users').findOne((u) => u.email && u.email.toLowerCase() === identity.email.toLowerCase());
      }
      const now = nowIso();
      if (!user) {
        user = {
          _id: randomId(12),
          googleSubject: identity.subject,
          email: identity.email.toLowerCase(),
          displayName: identity.name,
          avatarUrl: identity.picture,
          passkeys: [],
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        };
      } else {
        user = {
          ...user,
          googleSubject: identity.subject,
          email: identity.email.toLowerCase(),
          displayName: user.displayName || identity.name,
          avatarUrl: user.avatarUrl || identity.picture,
          updatedAt: now,
          lastLoginAt: now,
        };
      }
      await db.coll('users').put(user._id, user);

      // store Drive authorization separately from identity (AUTH-02/03)
      if (googleMode === 'sandbox' && pending.withDrive) {
        await seedMockDrive(identity.subject); // fresh tree for this account
      }
      if (pending.withDrive) {
        const existing = (await getConnection(user._id)) || (await db.coll('connections').findOne((c) => c.googleAccountId === identity.subject || (c.email && c.email.toLowerCase() === identity.email.toLowerCase())));
        if (tokens.refresh_token) {
          const { ciphertext, keyVersion } = encryptSecret(tokens.refresh_token);
          for (const other of await db.coll('connections').find((c) => c.userId === user._id)) {
            if (!existing || other._id !== existing._id) await db.coll('connections').delete(other._id);
          }
          await db.coll('connections').put(existing?._id ?? randomId(12), {
            _id: existing?._id ?? randomId(12),
            userId: user._id,
            googleAccountId: identity.subject,
            email: identity.email,
            grantedScopes: String(tokens.scope ?? '').split(' ').filter(Boolean),
            refreshTokenCiphertext: ciphertext,
            encryptionKeyVersion: keyVersion,
            connectedAt: existing?.connectedAt ?? now,
            lastUsedAt: now,
            status: 'connected',
          });
        } else if (existing && existing.refreshTokenCiphertext) {
          await db.coll('connections').put(existing._id, {
            ...existing,
            userId: user._id,
            googleAccountId: identity.subject,
            email: identity.email,
            grantedScopes: String(tokens.scope ?? '').split(' ').filter(Boolean).length
              ? String(tokens.scope ?? '').split(' ').filter(Boolean)
              : existing.grantedScopes,
            lastUsedAt: now,
            status: 'connected',
          });
        }
      }

      const activeConn = await getConnection(user._id);
      const isDriveConnected = Boolean(activeConn && activeConn.status === 'connected');

      const sid = await createSession(user._id);
      const back = sanitizeReturnTo(pending.returnTo);
      let targetUrl;
      if (back.startsWith('http://') || back.startsWith('https://') || back.includes('://')) {
        const u = new URL(back);
        u.searchParams.set('signedin', '1');
        if (pending.withDrive) u.searchParams.set('drive', '1');
        u.searchParams.set('token', sid);
        targetUrl = u.toString();
      } else {
        const sep = back.includes('?') ? '&' : '?';
        targetUrl = `${baseUrl(req)}${back}${sep}signedin=1${pending.withDrive ? '&drive=1' : ''}&token=${sid}`;
      }

      const htmlBridge = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing In...</title></head><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f8fafc"><div style="text-align:center;padding:24px"><p style="font-size:16px;font-weight:600;margin-bottom:8px">Signing in to ReadSpace...</p><p style="font-size:13px;color:#94a3b8">Redirecting you back to the application...</p></div><script>
try {
  if (window.opener && window.opener !== window) {
    window.opener.postMessage({ type: 'rs_auth_complete', token: ${JSON.stringify(sid)}, drive: ${isDriveConnected}, driveConnected: ${isDriveConnected}, user: ${JSON.stringify(publicUser(user))} }, '*');
    setTimeout(() => { window.close(); }, 350);
  } else {
    window.location.replace(${JSON.stringify(targetUrl)});
  }
} catch(e) {
  window.location.replace(${JSON.stringify(targetUrl)});
}
</script></body></html>`;

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': sessionCookie(sid, isSecure(req)),
        'cache-control': 'no-store',
      });
      return res.end(htmlBridge);
    }

    if (method === 'POST' && pathname === '/api/dev/reset') {
      // sandbox-only: clears all metadata (handy for demos/tests)
      if (googleMode !== 'sandbox') throw httpError(403, 'Forbidden', 'forbidden');
      for (const name of ['users', 'connections', 'workspaces', 'sessions', 'jobs', 'savedLinks']) {
        const coll = db.coll(name);
        for (const doc of await coll.find(() => true)) await coll.delete(doc._id);
      }
      resetMockDrives();
      await seedMockDrive(DEMO_SUBJECT);
      return json(res, 200, { ok: true, reseeded: true });
    }

    if (method === 'POST' && pathname === '/api/dev/revoke-shared') {
      // sandbox-only: the "classmate" revokes link sharing on the shared fixtures
      if (googleMode !== 'sandbox') throw httpError(403, 'Forbidden', 'forbidden');
      return json(res, 200, { revoked: revokeSharedFixtures() });
    }

    if (method === 'POST' && pathname === '/api/auth/demo') {
      // clearly-labelled development sign-in, only available in sandbox mode
      if (googleMode !== 'sandbox') throw httpError(403, 'Demo sign-in is disabled in this deployment', 'demo_disabled');
      const now = nowIso();
      let user = await db.coll('users').findOne((u) => u.googleSubject === 'demo-user-0001');
      if (!user) {
        user = { _id: randomId(12), googleSubject: 'demo-user-0001', email: 'demo.user@gmail.com', displayName: 'Demo User', avatarUrl: '', createdAt: now, updatedAt: now, lastLoginAt: now };
        await db.coll('users').put(user._id, user);
      }
      const sid = await createSession(user._id);
      return json(res, 200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(sid, isSecure(req)) });
    }

    /* ---------- Email/Password Sign Up ---------- */
    if (method === 'POST' && pathname === '/api/auth/register') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const displayName = String(body.displayName || '').trim();

      if (!email || !email.includes('@')) {
        throw httpError(400, 'Valid email is required', 'invalid_email');
      }
      if (!password || password.length < 6) {
        throw httpError(400, 'Password must be at least 6 characters long', 'password_too_short');
      }

      let user = await db.coll('users').findOne((u) => u.email && u.email.toLowerCase() === email);
      const now = nowIso();

      if (user) {
        if (user.passwordHash) {
          throw httpError(409, 'An account with this email already exists. Please sign in.', 'user_exists');
        }
        // Account exists from Google without a password -> link password and name
        user.passwordHash = hashPassword(password);
        if (displayName) user.displayName = displayName;
        user.updatedAt = now;
        user.lastLoginAt = now;
        await db.coll('users').put(user._id, user);
      } else {
        user = {
          _id: randomId(12),
          email,
          displayName: displayName || email.split('@')[0],
          avatarUrl: '',
          passwordHash: hashPassword(password),
          passkeys: [],
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        };
        await db.coll('users').put(user._id, user);
      }

      const sid = await createSession(user._id);
      return json(res, 200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(sid, isSecure(req)) });
    }

    /* ---------- Email/Password Sign In ---------- */
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!email || !password) {
        throw httpError(400, 'Email and password are required', 'missing_credentials');
      }

      const user = await db.coll('users').findOne((u) => u.email && u.email.toLowerCase() === email);
      if (!user) {
        throw httpError(401, 'No account found with this email. Please sign up.', 'user_not_found');
      }

      if (!user.passwordHash) {
        throw httpError(401, 'This account was created with Google. Please continue with Google, or sign in and set a password in settings.', 'no_password_set');
      }

      if (!verifyPassword(password, user.passwordHash)) {
        throw httpError(401, 'Incorrect password. Please try again.', 'invalid_password');
      }

      const now = nowIso();
      user.lastLoginAt = now;
      await db.coll('users').put(user._id, user);

      const sid = await createSession(user._id);
      return json(res, 200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(sid, isSecure(req)) });
    }

    /* ---------- Set / Change Password (for logged in user) ---------- */
    if (method === 'POST' && pathname === '/api/auth/set-password') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');

      const body = await readJson(req);
      const newPassword = String(body.password || '');
      const currentPassword = String(body.currentPassword || '');

      if (!newPassword || newPassword.length < 6) {
        throw httpError(400, 'Password must be at least 6 characters long', 'password_too_short');
      }

      if (user.passwordHash) {
        if (!currentPassword) {
          throw httpError(400, 'Current password is required to change password', 'current_password_required');
        }
        if (!verifyPassword(currentPassword, user.passwordHash)) {
          throw httpError(401, 'Current password does not match', 'current_password_invalid');
        }
      }

      user.passwordHash = hashPassword(newPassword);
      user.updatedAt = nowIso();
      await db.coll('users').put(user._id, user);

      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    /* ---------- Passkey WebAuthn: Register Options ---------- */
    if (method === 'POST' && pathname === '/api/auth/passkey/register-options') {
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required to register a passkey', 'unauthenticated');
      const options = await createPasskeyRegistrationOptions(req, user);
      return json(res, 200, options);
    }

    /* ---------- Passkey WebAuthn: Register Verify ---------- */
    if (method === 'POST' && pathname === '/api/auth/passkey/register-verify') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required to register a passkey', 'unauthenticated');
      const body = await readJson(req);
      const newPasskey = await verifyPasskeyRegistration(req, user, body.response, body.name);

      user.passkeys = (user.passkeys || []).filter((p) => p.id !== newPasskey.id);
      user.passkeys.push(newPasskey);
      user.updatedAt = nowIso();
      await db.coll('users').put(user._id, user);

      return json(res, 200, {
        ok: true,
        user: publicUser(user),
        passkeys: user.passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
      });
    }

    /* ---------- Passkey WebAuthn: Login Options (Passwordless) ---------- */
    if (method === 'POST' && pathname === '/api/auth/passkey/login-options') {
      const options = await createPasskeyLoginOptions(req);
      return json(res, 200, options);
    }

    /* ---------- Passkey WebAuthn: Login Verify (Passwordless) ---------- */
    if (method === 'POST' && pathname === '/api/auth/passkey/login-verify') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const body = await readJson(req);
      const allUsers = await db.coll('users').find(() => true);
      const { user } = await verifyPasskeyLogin(req, allUsers, body.response);

      const now = nowIso();
      user.lastLoginAt = now;
      await db.coll('users').put(user._id, user);

      const sid = await createSession(user._id);
      return json(res, 200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(sid, isSecure(req)) });
    }

    /* ---------- Passkey List & Delete ---------- */
    if (method === 'GET' && pathname === '/api/auth/passkeys') {
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const passkeys = (user.passkeys || []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt }));
      return json(res, 200, { passkeys });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/auth/passkeys/')) {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const passkeyId = decodeURIComponent(pathname.replace('/api/auth/passkeys/', ''));
      user.passkeys = (user.passkeys || []).filter((p) => p.id !== passkeyId);
      user.updatedAt = nowIso();
      await db.coll('users').put(user._id, user);
      return json(res, 200, {
        ok: true,
        user: publicUser(user),
        passkeys: (user.passkeys || []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
      });
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const user = await requireUser(req);
      const conn = user ? await getConnection(user._id) : null;
      return json(res, 200, {
        user: publicUser(user),
        authMode: googleMode,
        drive: conn
          ? { status: conn.status, email: conn.email, scopes: conn.grantedScopes }
          : { status: 'disconnected' },
      });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      await destroySession(parseCookies(req)[SESSION_COOKIE]);
      return json(res, 200, { ok: true }, { 'set-cookie': clearedSessionCookie() });
    }

    /* ================= DRIVE ================= */

    if (method === 'POST' && pathname === '/api/drive/disconnect') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      for (const conn of await db.coll('connections').find((c) => c.userId === user._id)) {
        try {
          const accessToken = await getAccessToken(conn);
          await driveRevoke(accessToken);
        } catch { /* token may already be dead — disconnect anyway */ }
        await db.coll('connections').delete(conn._id); // tokens removed; workspace metadata preserved
      }
      invalidateDriveCache(user._id);
      return json(res, 200, { ok: true, drive: { status: 'disconnected' } });
    }

    if (method === 'GET' && pathname === '/api/drive/status') {
      const user = await requireUser(req);
      if (!user) {
        return json(res, 200, {
          connected: false,
          status: 'disconnected',
          drive: { status: 'disconnected' },
        });
      }
      const conn = await getConnection(user._id);
      return json(res, 200, {
        connected: conn?.status === 'connected',
        status: conn ? conn.status : 'disconnected',
        email: conn?.email,
        drive: conn ? { status: conn.status, email: conn.email } : { status: 'disconnected' },
      });
    }

    if (method === 'GET' && pathname === '/api/drive/files') {
      const { user, accessToken } = await withDrive(req);
      const parent = url.searchParams.get('parentId') ?? url.searchParams.get('folderId') ?? 'root';
      const q = url.searchParams.get('q') ?? undefined;
      const resourceKey = url.searchParams.get('resourceKey') ?? undefined;
      const forceRefresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

      const cacheKey = `${user._id}:${parent}:${q || ''}:${resourceKey || ''}`;
      if (!forceRefresh) {
        const cached = listCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
          return json(res, 200, cached.data);
        }
      }

      let all = [];
      let pageToken = url.searchParams.get('pageToken') ?? undefined;
      // aggregate pagination server-side with max pageSize 1000 for ultra-fast single roundtrip
      for (let i = 0; i < 5; i++) {
        const page = await driveListFiles(accessToken, { parent, pageToken, pageSize: 1000, q, resourceKey });
        all = all.concat(page.files ?? []);
        if (!page.nextPageToken) break;
        pageToken = page.nextPageToken;
      }

      // Pre-warm metadata cache for returned files so subsequent meta/content calls are instant
      for (const f of all) {
        if (f.id) {
          metaCache.set(`${user._id}:${f.id}`, { expires: Date.now() + 180000, data: f });
          metaCache.set(f.id, { expires: Date.now() + 180000, data: f });
        }
      }

      const result = { files: all, parentId: parent };
      listCache.set(cacheKey, { expires: Date.now() + 60000, data: result });
      return json(res, 200, result);
    }

    if (method === 'GET' && (pathname.match(/^\/api\/drive\/files\/([^/]+)\/meta$/) || []).length) {
      const { user, accessToken } = await withDrive(req);
      const id = decodeURIComponent(pathname.split('/')[4]);
      const resourceKey = url.searchParams.get('resourceKey') ?? undefined;
      const forceRefresh = url.searchParams.get('refresh') === '1';
      return json(res, 200, await driveFileMeta(accessToken, id, resourceKey, { forceRefresh, cacheKey: `${user._id}:${id}` }));
    }

    if (method === 'GET' && (pathname.match(/^\/api\/drive\/files\/([^/]+)\/content$/) || []).length) {
      const { user, accessToken } = await withDrive(req);
      const id = decodeURIComponent(pathname.split('/')[4]);
      const exportMime = url.searchParams.get('export') ?? undefined;
      const cachedMeta = metaCache.get(`${user._id}:${id}`)?.data || metaCache.get(id)?.data;
      try {
        const { buffer, mimeType } = await driveFileContent(accessToken, id, {
          exportMime,
          resourceKey: url.searchParams.get('resourceKey') ?? undefined,
          metaHint: cachedMeta,
        });
        res.writeHead(200, {
          'content-type': mimeType,
          'content-length': String(buffer.length),
          'cache-control': 'private, max-age=300',
        });
        return res.end(buffer);
      } catch (err) {
        if (err.isFolder) {
          return json(res, 400, {
            error: err.message,
            isFolder: true,
            folderId: err.folderId || id,
            name: err.folderName,
          });
        }
        throw err;
      }
    }

    if (method === 'GET' && pathname === '/api/drive/changes') {
      const { accessToken } = await withDrive(req);
      const pageToken = url.searchParams.get('pageToken') ?? undefined;
      return json(res, 200, await driveChanges(accessToken, pageToken));
    }

    if (method === 'POST' && pathname === '/api/drive/files') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const { accessToken } = await withDrive(req);
      const parent = url.searchParams.get('parentId') ?? 'root';
      const name = url.searchParams.get('name') ?? 'untitled';
      const mimeType = url.searchParams.get('mimeType') ?? 'application/octet-stream';
      const content = await readBody(req, 48 * 1024 * 1024);
      const file = await driveCreateFile(accessToken, { parent, name, mimeType }, content);
      invalidateDriveCache(user._id);
      return json(res, 201, { file });
    }

    if (method === 'PATCH' && (pathname.match(/^\/api\/drive\/files\/([^/]+)$/) || []).length) {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const { user, accessToken } = await withDrive(req);
      const id = decodeURIComponent(pathname.split('/')[4]);
      const expected = url.searchParams.get('ifModifiedTime') ?? undefined; // SYNC-01
      const content = await readBody(req, 48 * 1024 * 1024);
      const result = await driveUpdateFile(accessToken, id, content, expected);
      invalidateDriveCache(user._id);
      if (result.status === 409) {
        return json(res, 409, {
          error: 'The file changed on Google Drive after you opened it.',
          codeName: 'remote_changed',
          remote: result.remote,
        });
      }
      return json(res, 200, { file: result.file });
    }

    /* ================= SAVED LINKS (personal collection of shared resources) ================= */

    if (pathname === '/api/saved-links' || pathname.startsWith('/api/saved-links/')) {
      if (method !== 'GET' && !sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const coll = db.coll('savedLinks');

      if (method === 'GET' && pathname === '/api/saved-links') {
        const links = (await coll.find((l) => l.userId === user._id))
          .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
        return json(res, 200, { links });
      }

      if (method === 'POST' && pathname === '/api/saved-links') {
        const body = await readJson(req);
        const title = String(body.title ?? '').trim().slice(0, 200);
        const linkUrl = String(body.url ?? '').trim().slice(0, 2000);
        if (!title || !linkUrl) throw httpError(400, 'title and url are required', 'invalid');
        // a reference to the shared resource — never a copy of its content
        const doc = {
          _id: randomId(12),
          userId: user._id,
          title,
          url: linkUrl,
          fileId: body.fileId ? String(body.fileId).slice(0, 128) : undefined,
          folderId: body.folderId ? String(body.folderId).slice(0, 128) : undefined,
          resourceType: body.folderId ? 'folder' : body.fileId ? 'file' : 'unknown',
          mimeType: body.mimeType ? String(body.mimeType).slice(0, 120) : undefined,
          resourceKey: body.resourceKey ? String(body.resourceKey).slice(0, 128) : undefined,
          sharedBy: body.sharedBy ? String(body.sharedBy).slice(0, 120) : undefined,
          collection: body.collection ? String(body.collection).trim().slice(0, 60) : undefined,
          addedAt: new Date().toISOString(),
          lastOpenedAt: undefined,
          openCount: 0,
        };
        // one record per Drive resource per user — re-saving updates it
        const dupes = await coll.find((l) => l.userId === user._id
          && ((doc.fileId && l.fileId === doc.fileId) || (doc.folderId && l.folderId === doc.folderId)));
        const existing = dupes[0];
        if (existing) {
          for (const k of ['title', 'url', 'mimeType', 'resourceKey', 'sharedBy', 'collection', 'fileId', 'folderId', 'resourceType']) {
            if (doc[k] !== undefined) existing[k] = doc[k];
          }
          await coll.put(existing._id, existing);
          return json(res, 200, { link: existing, updated: true });
        }
        const mine = await coll.find((l) => l.userId === user._id);
        if (mine.length >= 200) throw httpError(400, 'Saved-link limit reached (200)', 'limit_exceeded');
        await coll.put(doc._id, doc);
        return json(res, 201, { link: doc });
      }

      const sm = pathname.match(/^\/api\/saved-links\/([A-Za-z0-9_-]+)$/);
      if (sm && (method === 'PATCH' || method === 'DELETE')) {
        const link = (await coll.find((l) => l._id === sm[1] && l.userId === user._id))[0];
        if (!link) throw httpError(404, 'Saved link not found', 'notFound');
        if (method === 'DELETE') {
          await coll.delete(link._id);
          return json(res, 200, { ok: true });
        }
        const body = await readJson(req);
        if (typeof body.title === 'string' && body.title.trim()) link.title = body.title.trim().slice(0, 200);
        if (typeof body.collection === 'string') link.collection = body.collection.trim().slice(0, 60) || undefined;
        if (body.progress && typeof body.progress === 'object') {
          link.progress = { scrollTop: Number(body.progress.scrollTop) || 0, updatedAt: new Date().toISOString() };
        }
        if (body.markOpened) {
          link.lastOpenedAt = new Date().toISOString();
          link.openCount = (link.openCount ?? 0) + 1;
        }
        await coll.put(link._id, link);
        return json(res, 200, { link });
      }
    }

    /* ================= WORKSPACES + SESSIONS ================= */

    if (method === 'GET' && pathname === '/api/workspaces') {
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const all = await db.coll('workspaces').find((w) => w.userId === user._id);
      all.sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : -1));
      const withSessions = await Promise.all(all.map(async (w) => ({
        ...w,
        session: await db.coll('workspaceSessions').findOne((s) => s.userId === user._id && s.workspaceKey === w.key) ?? null,
      })));
      return json(res, 200, { workspaces: withSessions });
    }

    if (method === 'POST' && pathname === '/api/workspaces/sync') {
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const body = await readJson(req, 1024 * 1024);
      const key = String(body.key ?? '').slice(0, 200);
      if (!key) throw httpError(400, 'Missing workspace key', 'bad_request');
      const now = nowIso();
      let ws = await db.coll('workspaces').findOne((w) => w.userId === user._id && w.key === key);
      if (!ws) {
        ws = { _id: randomId(12), userId: user._id, key, createdAt: now };
      }
      ws = {
        ...ws,
        displayName: String(body.displayName ?? key).slice(0, 200),
        provider: body.provider === 'google_drive' ? 'google_drive' : 'local',
        rootDriveFolderId: body.rootDriveFolderId ? String(body.rootDriveFolderId) : undefined,
        lastOpenedAt: now,
        updatedAt: now,
      };
      await db.coll('workspaces').put(ws._id, ws);

      // debounced client-side; validated shape/size server-side (PRD §17.1)
      const sess = body.session ?? {};
      const openTabs = Array.isArray(sess.openTabs) ? sess.openTabs.slice(0, 50).map((t) => ({
        resourceKey: String(t.resourceKey ?? '').slice(0, 500),
        title: String(t.title ?? '').slice(0, 200),
        pinned: !!t.pinned,
        isPreviewTab: !!t.isPreviewTab,
        scrollTop: Number.isFinite(t.scrollTop) ? Math.max(0, Math.min(1e7, t.scrollTop)) : undefined,
        viewState: undefined,
      })) : [];
      await db.coll('workspaceSessions').put(`${user._id}::${key}`, {
        _id: `${user._id}::${key}`,
        userId: user._id,
        workspaceKey: key,
        openTabs,
        activeResourceKey: sess.activeResourceKey ? String(sess.activeResourceKey).slice(0, 500) : undefined,
        layout: sess.layout ?? undefined,
        updatedAt: now,
      });
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && (pathname.match(/^\/api\/workspaces\/(.+)$/) || []).length && pathname !== '/api/workspaces/sync') {
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const key = decodeURIComponent(pathname.split('/')[3]);
      const ws = await db.coll('workspaces').findOne((w) => w.userId === user._id && w.key === key);
      const sess = await db.coll('workspaceSessions').findOne((s) => s.userId === user._id && s.workspaceKey === key);
      return json(res, 200, { workspace: ws, session: sess });
    }

    /* ================= TRANSFERS ================= */

    if (method === 'POST' && pathname === '/api/transfers/scan') {
      const { accessToken, conn } = await withDrive(req);
      const body = await readJson(req, 8 * 1024 * 1024);
      const driveFolderId = String(body.driveFolderId ?? 'root');
      const manifest = Array.isArray(body.manifest) ? body.manifest.slice(0, 2000) : [];

      if (driveFolderId.startsWith('create:')) {
        const classified = manifest.map((m) => ({
          ...m,
          classification: 'likely_new',
          reason: 'Target folder will be created in Google Drive upon upload',
        }));
        return json(res, 200, { candidates: classified, remoteCount: 0, driveFolderId });
      }

      // enumerate Drive descendants recursively with pageSize 1000 and parallel folder processing
      const remote = []; // { relativePath, name, size, modifiedTime, id }
      const queue = [{ id: driveFolderId, rel: '' }];
      const visited = new Set([driveFolderId]);

      while (queue.length > 0) {
        const batch = queue.splice(0, 5);
        await Promise.all(
          batch.map(async ({ id, rel }) => {
            let pageToken;
            for (let i = 0; i < 20; i++) {
              const page = await driveListFiles(accessToken, { parent: id, pageToken, pageSize: 1000 });
              for (const f of page.files ?? []) {
                const relPath = rel ? `${rel}/${f.name}` : f.name;
                if (f.mimeType === 'application/vnd.google-apps.folder') {
                  if (!visited.has(f.id)) {
                    visited.add(f.id);
                    queue.push({ id: f.id, rel: relPath });
                  }
                } else {
                  remote.push({
                    relativePath: relPath,
                    name: f.name,
                    size: Number(f.size ?? 0),
                    modifiedTime: f.modifiedTime,
                    id: f.id,
                    mimeType: f.mimeType,
                  });
                }
              }
              if (!page.nextPageToken) break;
              pageToken = page.nextPageToken;
            }
          })
        );
      }
      await db.coll('connections').put(conn._id, { ...conn, lastUsedAt: nowIso() });

      const remoteByName = new Map(remote.map((r) => [r.relativePath.toLowerCase(), r]));
      const classified = manifest.map((m) => {
        const hit = remoteByName.get(String(m.relativePath ?? m.name).toLowerCase());
        if (!hit) return { ...m, classification: 'likely_new', reason: 'No file with this path exists in the Drive folder' };
        const sizeSame = hit.size === Number(m.size ?? -1);
        if (sizeSame) return { ...m, classification: 'same_candidate', reason: `Same name and size as “${hit.name}” in Drive`, remoteId: hit.id };
        return { ...m, classification: 'name_collision', reason: `A different-sized “${hit.name}” already exists in Drive (${(Number(hit.size) / 1024).toFixed(1)} KB vs ${((Number(m.size) || 0) / 1024).toFixed(1)} KB)`, remoteId: hit.id };
      });
      return json(res, 200, { candidates: classified, remoteCount: remote.length, driveFolderId });
    }

    if (method === 'POST' && pathname === '/api/transfers') {
      // record a completed transfer job (metadata only, never contents — §6)
      if (!sameOriginOk(req)) throw httpError(403, 'Cross-origin request blocked', 'csrf');
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const body = await readJson(req, 1024 * 1024);
      const job = {
        _id: randomId(10),
        userId: user._id,
        direction: body.direction === 'download' ? 'download' : 'upload',
        destinationDriveFolderId: body.destinationDriveFolderId ? String(body.destinationDriveFolderId) : undefined,
        status: ['succeeded', 'partial', 'failed', 'cancelled'].includes(body.status) ? body.status : 'succeeded',
        items: (Array.isArray(body.items) ? body.items : []).slice(0, 500).map((it) => ({
          sourceKey: String(it.sourceKey ?? '').slice(0, 500),
          relativePath: String(it.relativePath ?? '').slice(0, 500),
          fileName: String(it.fileName ?? '').slice(0, 255),
          size: Number.isFinite(it.size) ? it.size : undefined,
          status: String(it.status ?? 'succeeded').slice(0, 30),
          destinationDriveFileId: it.destinationDriveFileId ? String(it.destinationDriveFileId) : undefined,
          errorCode: it.errorCode ? String(it.errorCode).slice(0, 60) : undefined,
        })),
        createdAt: nowIso(),
        completedAt: nowIso(),
      };
      await db.coll('jobs').put(job._id, job);
      return json(res, 201, { job: { id: job._id, status: job.status, itemCount: job.items.length } });
    }

    if (method === 'GET' && pathname.startsWith('/api/transfers/')) {
      const user = await requireUser(req);
      if (!user) throw httpError(401, 'Sign in required', 'unauthenticated');
      const id = pathname.split('/').pop();
      const job = await db.coll('jobs').get(id);
      if (!job || job.userId !== user._id) throw httpError(404, 'Job not found', 'not_found'); // owner-only
      return json(res, 200, { job });
    }

    return json(res, 404, { error: 'Unknown API route', path: pathname });
  } catch (e) {
    const status = e.status ?? 500;
    if (status >= 500) console.error('[api]', e);
    return json(res, status, { error: e.message ?? 'Internal error', codeName: e.codeName ?? 'internal' });
  }
}
