/**
 * Google client — one interface, two backends.
 *  - mode 'google': real Google OAuth 2.0 (authorization code + PKCE, offline
 *    access) and Drive API v3, using credentials from server env only.
 *  - mode 'sandbox': the in-process mock (mockdrive.mjs) with identical shapes.
 *
 * Refresh tokens NEVER leave the server: routes call these helpers after the
 * user's connection record is loaded and decrypted.
 */
import { mockGoogle, mockAuthorizeUrl, mockDriveList, mockDriveMeta, mockDriveContent, mockDriveExport, mockDriveCreate, mockDriveUpdate, issueTokens, mockRefresh, mockDriveStartToken, mockDriveChanges } from './mockdrive.mjs';

const REAL = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/drive/v3';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const BASE_SCOPES = ['openid', 'email', 'profile'];

export const googleMode = REAL ? 'google' : 'sandbox';

export function clientConfig() {
  return {
    mode: googleMode,
    sandboxUser: googleMode === 'sandbox' ? { email: mockGoogle.email, name: mockGoogle.name } : undefined,
  };
}

/* ---------------- OAuth ---------------- */

export function buildAuthorizeUrl({ redirectUri, state, codeChallenge, withDrive }) {
  const scopes = [...BASE_SCOPES, ...(withDrive ? [DRIVE_SCOPE] : [])];
  if (googleMode === 'sandbox') {
    const code = 'MC_' + Math.random().toString(36).slice(2);
    return mockAuthorizeUrl({
      client_id: 'sandbox', redirect_uri: redirectUri, response_type: 'code',
      scope: scopes.join(' '), state, access_type: 'offline', prompt: 'consent', code,
    });
  }
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');           // refresh token (AUTH-03)
  u.searchParams.set('include_granted_scopes', 'true');
  if (withDrive) {
    u.searchParams.set('prompt', 'consent select_account');
  } else {
    u.searchParams.set('prompt', 'select_account');
  }
  if (codeChallenge) {
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
  }
  return u.toString();
}

/** Exchange an authorization code for tokens (server-side only). */
export async function exchangeCode({ code, redirectUri, codeVerifier }) {
  if (googleMode === 'sandbox') {
    return issueTokens('demo-user-0001', true);
  }
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error_description ?? 'token exchange failed'), { status: 401, codeName: 'oauth_exchange_failed' });
  return json;
}

export async function refreshAccessToken(refreshToken) {
  if (googleMode === 'sandbox') return mockRefresh(refreshToken);
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const json = await res.json();
  if (!res.ok) {
    // invalid_grant → connection needs reauthorization (AUTH-04); never loop.
    throw Object.assign(new Error(json.error_description ?? json.error ?? 'refresh failed'), { status: 401, codeName: json.error ?? 'refresh_failed' });
  }
  return json;
}

/** Verify identity (sandbox: fixed demo user; real: Google tokeninfo/id_token). */
export async function identifyUser(tokens) {
  if (googleMode === 'sandbox') {
    return { subject: mockGoogle.subject, email: mockGoogle.email, name: mockGoogle.name, picture: '' };
  }
  if (tokens.id_token) {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (!payload.sub || !payload.email_verified) throw Object.assign(new Error('Unverified identity'), { status: 401, codeName: 'bad_identity' });
    return { subject: payload.sub, email: payload.email, name: payload.name ?? payload.email, picture: payload.picture ?? '' };
  }
  throw Object.assign(new Error('No identity token'), { status: 401, codeName: 'bad_identity' });
}

/* ---------------- Drive (always called with a fresh access token) ---------------- */

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.set(k, String(v));
  return u.toString();
}

async function driveFetch(accessToken, path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
  return res;
}

export const listCache = new Map(); // key -> { expires: number, data: any }
export const metaCache = new Map(); // key -> { expires: number, data: any }

export function invalidateDriveCache(userId) {
  if (!userId) {
    listCache.clear();
    metaCache.clear();
    return;
  }
  const prefix = `${userId}:`;
  for (const k of listCache.keys()) {
    if (k.startsWith(prefix)) listCache.delete(k);
  }
  for (const k of metaCache.keys()) {
    if (k.startsWith(prefix)) metaCache.delete(k);
  }
}

export async function driveListFiles(accessToken, { parent = 'root', pageToken, pageSize = 1000, q, resourceKey }) {
  if (googleMode === 'sandbox') return mockDriveList('demo-user-0001', { parent, pageToken, pageSize: 3, q, resourceKey });
  // resourceKey: required by Google for link-shared resources (Saved Links)
  const res = await driveFetch(accessToken, `/files?${qs({ q: q ?? `'${parent}' in parents and trashed = false`, pageToken, pageSize, resourceKey, fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)', orderBy: 'folder,name' })}`);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'list failed'), { status: res.status, codeName: json.error?.errors?.[0]?.reason ?? 'drive_list_failed' });
  return json;
}

export async function driveFileMeta(accessToken, id, resourceKey, { forceRefresh = false, cacheKey } = {}) {
  if (googleMode === 'sandbox') {
    const m = mockDriveMeta('demo-user-0001', id, resourceKey);
    if (!m) {
      throw Object.assign(
        new Error('File not found — link-shared files also need their resource key, or the owner revoked access.'),
        { status: 404, codeName: 'notFound' },
      );
    }
    return m;
  }

  const key = cacheKey || id;
  if (!forceRefresh) {
    const cached = metaCache.get(key) || metaCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;
  }

  const res = await driveFetch(accessToken, `/files/${encodeURIComponent(id)}?${qs({ fields: 'id,name,mimeType,size,modifiedTime,parents', resourceKey })}`);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'get failed'), { status: res.status, codeName: 'drive_get_failed' });

  metaCache.set(key, { expires: Date.now() + 180000, data: json });
  metaCache.set(id, { expires: Date.now() + 180000, data: json });
  return json;
}

export async function driveFileContent(accessToken, id, { exportMime, resourceKey, metaHint } = {}) {
  if (googleMode === 'sandbox') {
    if (exportMime) {
      const buf = mockDriveExport('demo-user-0001', id, resourceKey);
      if (!buf) throw Object.assign(new Error('export not available'), { status: 404 });
      return { buffer: buf, mimeType: exportMime };
    }
    const buf = mockDriveContent('demo-user-0001', id, resourceKey);
    if (!buf) throw Object.assign(new Error('content not available'), { status: 404 });
    return { buffer: buf, mimeType: 'application/octet-stream' };
  }

  let effectiveExport = exportMime;
  let meta = metaHint || metaCache.get(id)?.data;

  // FAST PATH: If no export mime and no meta known, attempt direct alt=media download immediately
  if (!effectiveExport && !meta) {
    const directPath = `/files/${encodeURIComponent(id)}?alt=media&${qs({ resourceKey })}`;
    const directRes = await driveFetch(accessToken, directPath);
    if (directRes.ok) {
      const mimeType = directRes.headers.get('content-type') || 'application/octet-stream';
      return { buffer: Buffer.from(await directRes.arrayBuffer()), mimeType };
    }
    // If direct failed with 400/403, proceed to inspect metadata for folder or docs export
  }

  // Retrieve metadata if not cached yet
  if (!meta) {
    try {
      meta = await driveFileMeta(accessToken, id, resourceKey);
    } catch (err) {
      // Continue with best effort
    }
  }

  if (meta?.mimeType === 'application/vnd.google-apps.folder') {
    throw Object.assign(new Error('Item is a Google Drive folder and cannot be downloaded as binary content.'), {
      status: 400,
      codeName: 'is_folder',
      isFolder: true,
      folderId: id,
      folderName: meta.name,
    });
  }

  if (!effectiveExport && meta) {
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      effectiveExport = 'application/pdf';
    } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      effectiveExport = 'text/csv';
    } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
      effectiveExport = 'application/pdf';
    } else if (meta.mimeType === 'application/vnd.google-apps.drawing') {
      effectiveExport = 'image/png';
    }
  }

  const path = effectiveExport
    ? `/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(effectiveExport)}&${qs({ resourceKey })}`
    : `/files/${encodeURIComponent(id)}?alt=media&${qs({ resourceKey })}`;

  const res = await driveFetch(accessToken, path);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `download failed (${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) errMsg = parsed.error.message;
    } catch {}
    throw Object.assign(new Error(errMsg), { status: res.status, codeName: 'drive_download_failed', detail: text.slice(0, 200) });
  }

  const mimeType = effectiveExport || res.headers.get('content-type') || meta?.mimeType || 'application/octet-stream';
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType, name: meta?.name };
}

/** Seed token for incremental change polling (M6 — Drive Changes API). */
export async function driveStartPageToken(accessToken) {
  if (googleMode === 'sandbox') return mockDriveStartToken('demo-user-0001');
  const res = await driveFetch(accessToken, `/changes/startPageToken?${qs({})}`);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error('startPageToken failed'), { status: res.status, codeName: 'drive_changes_failed' });
  return json.startPageToken;
}

/** Changes since a page token: [{fileId, name, mimeType, removed}]. */
export async function driveChanges(accessToken, pageToken) {
  if (googleMode === 'sandbox') return mockDriveChanges('demo-user-0001', pageToken);
  const res = await driveFetch(accessToken, `/changes?${qs({ pageToken, pageSize: 200, fields: 'newStartPageToken, changes(fileId, removed, file(id,name,mimeType))' })}`);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error('changes failed'), { status: res.status, codeName: 'drive_changes_failed' });
  return {
    changes: (json.changes ?? []).map((c) => ({
      fileId: c.fileId,
      name: c.file?.name,
      mimeType: c.file?.mimeType,
      removed: !!c.removed,
    })),
    newPageToken: json.newStartPageToken,
  };
}

export async function driveCreateFile(accessToken, { parent = 'root', name, mimeType }, content) {
  if (googleMode === 'sandbox') return mockDriveCreate('demo-user-0001', { parent, name, mimeType }, content);
  // multipart upload (metadata + media) — fine for moderate sizes on functions
  const boundary = 'rs3' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [parent], mimeType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(accessToken, `/files?${qs({ uploadType: 'multipart', fields: 'id,name,mimeType,size,modifiedTime' })}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'upload failed'), { status: res.status, codeName: 'drive_upload_failed' });
  return json;
}

export async function driveUpdateFile(accessToken, id, content, expectedModifiedTime) {
  if (googleMode === 'sandbox') return mockDriveUpdate('demo-user-0001', id, content, expectedModifiedTime);
  if (expectedModifiedTime) {
    const meta = await driveFileMeta(accessToken, id);
    if (meta.modifiedTime && meta.modifiedTime !== expectedModifiedTime) {
      return { status: 409, remote: meta };
    }
  }
  const boundary = 'rs3' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({});
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(accessToken, `/files/${encodeURIComponent(id)}?${qs({ uploadType: 'multipart', fields: 'id,name,mimeType,size,modifiedTime' })}`, {
    method: 'PATCH',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'update failed'), { status: res.status, codeName: 'drive_update_failed' });
  return { status: 200, file: json };
}

export async function driveRevoke(accessToken) {
  if (googleMode === 'sandbox') return;
  await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: accessToken }) }).catch(() => undefined);
}
