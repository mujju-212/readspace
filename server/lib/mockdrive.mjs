/**
 * Mock Google + Drive backend ("google-sandbox" mode).
 *
 * Active when GOOGLE_CLIENT_ID is not configured. It implements the same
 * OAuth 2.0 endpoints and the same Drive API v3 shapes as the real service —
 * authorize page, token exchange, refresh, files.list with pagination,
 * files.get (meta + alt=media), multipart-less upload/create, PATCH update
 * with conflict detection, and Google-native export. Everything is kept in
 * memory, per user, seeded from the sample workspace on disk.
 *
 * This lets the complete PRD v1.1 flow (login → consent → connect → browse →
 * upload/download → conflicts → session restore) run and be tested without
 * any external credentials. Swapping to the real Google is env-only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SAMPLE_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'public', 'sample-workspace');
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDOC_MIME = 'application/vnd.google-apps.document';

export const DEMO_SUBJECT = 'demo-user-0001';
const DEMO_EMAIL = 'demo.user@gmail.com';

/** userId -> { files: Map<id, file>, authCodes: Map, tokens: Map } */
const stores = new Map();

function storeFor(userId) {
  let s = stores.get(userId);
  if (!s) {
    s = { files: new Map(), authCodes: new Map(), tokens: new Map(), changes: [] };
    stores.set(userId, s);
  }
  if (!s.changes) s.changes = [];
  return s;
}

/** Record a change for the Drive Changes API (M6 advanced sync). */
function noteChange(userId, fileId, name, mimeType, removed = false) {
  const s = storeFor(userId);
  s.changes.push({ fileId, name, mimeType, removed, time: new Date().toISOString() });
  if (s.changes.length > 500) s.changes.splice(0, s.changes.length - 500);
}

export const mockGoogle = {
  subject: DEMO_SUBJECT,
  email: DEMO_EMAIL,
  name: 'Demo User',
  picture: '',
};

async function addFile(userId, parent, name, mimeType, content, meta = {}) {
  const s = storeFor(userId);
  const id = meta.id ?? crypto.randomBytes(9).toString('hex');
  const body = content ?? ''; // folders and native docs carry text/plain payloads
  const file = {
    id,
    name,
    mimeType,
    parents: parent ? [parent] : [],
    size: String(Buffer.byteLength(body)),
    modifiedTime: new Date().toISOString(),
    content: body,
    starred: false,
    ...meta,
  };
  s.files.set(id, file);
  noteChange(userId, id, name, mimeType, false);
  return file;
}

/** Seed a fresh Drive tree from the on-disk sample workspace. */
export async function seedMockDrive(userId) {
  const s = storeFor(userId);
  if (s.files.size > 0) return;

  const notes = await addFile(userId, null, 'Study Notes', FOLDER_MIME);
  const papers = await addFile(userId, null, 'Papers', FOLDER_MIME);
  const web = await addFile(userId, notes.id, 'Web Dev', FOLDER_MIME);

  try {
    await addFile(userId, notes.id, 'python-basics.md', 'text/markdown', await fs.readFile(path.join(SAMPLE_DIR, 'notes', 'python-basics.md'), 'utf8'));
    await addFile(userId, web.id, 'web-dev.md', 'text/markdown', await fs.readFile(path.join(SAMPLE_DIR, 'notes', 'web-dev.md'), 'utf8'));
    await addFile(userId, papers.id, 'readspace-demo.pdf', 'application/pdf', await fs.readFile(path.join(SAMPLE_DIR, 'papers', 'readspace-demo.pdf')));
    await addFile(userId, papers.id, 'sample-report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await fs.readFile(path.join(SAMPLE_DIR, 'papers', 'sample-report.docx')));
  } catch {
    // sample dir missing (dev server only) — fall through to inline seeds
    await addFile(userId, notes.id, 'python-basics.md', 'text/markdown', '# Seed\n\nSample note.');
  }
  await addFile(userId, notes.id, 'Semester Plan', GDOC_MIME, 'Plan exported from Google Docs:\n\n- finish DBMS unit 3\n- ReadSpace demo on Friday\n- revise normalization');

  // ---- link-shared items owned by someone else ("a classmate") ----
  // These exercise the Saved-Links story: they are NOT in the demo user's
  // My Drive tree and require their resourceKey, exactly like Google's
  // link-shared resources.
  const CLASSMATE = 'classmate-user-9999';
  await addFile(CLASSMATE, null, 'DBMS Unit 3 Notes.pdf', 'application/pdf', minimalPdf([
    'DBMS Unit 3 Notes', '', 'Shared by Priya (classmate).',
    'Topics: normalization, ER modelling, transactions.',
    'Page 1 of 1 — ReadSpace sandbox fixture.',
  ]), {
    id: 'sharedDbmsPdf001', shared: true, resourceKey: 'rk-dbms-313', sharedBy: 'Priya (classmate)',
  });
  const sem7 = await addFile(CLASSMATE, null, 'Semester 7 Materials', FOLDER_MIME, '', {
    id: 'sharedSem7Folder01', shared: true, resourceKey: 'rk-sem7-246', sharedBy: 'Priya (classmate)',
  });
  await addFile(CLASSMATE, sem7.id, 'dsa-cheatsheet.md', 'text/markdown',
    '# DSA cheat sheet\n\n- Big-O table\n- graph traversals\n- DP patterns\n');
  await addFile(CLASSMATE, sem7.id, 'os-unit4-summary.md', 'text/markdown',
    '# OS Unit 4\n\n## Scheduling\nRound-robin, MLFQ, priority inversion.\n');
}

/** Build a small but *valid* one-page PDF (correct xref offsets) for the sandbox. */
function minimalPdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT /F1 16 Tf 72 720 Td 22 TL']
    .concat(lines.map((l) => `(${esc(l)}) Tj T*`))
    .concat(['ET'])
    .join('\n');
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** Wipe every mock store (used by the sandbox dev-reset endpoint). */
export function resetMockDrives() {
  stores.clear();
}

/** Simulate the owner revoking link sharing (Saved-Links access test). */
export function revokeSharedFixtures() {
  let n = 0;
  for (const s of stores.values()) {
    for (const f of s.files.values()) {
      if (f.shared) { f.shared = false; n++; }
    }
  }
  return n;
}

/**
 * Cross-user lookup for link-shared resources. A file owned by someone else is
 * reachable only when flagged shared, and only with its resourceKey when one
 * is set — mirroring Google's link-sharing rules (missing/wrong key → 404,
 * never a leak).
 */
function findAccessible(requesterId, id, resourceKey) {
  const own = storeFor(requesterId).files.get(id);
  if (own) return { file: own };
  for (const [uid, s] of stores) {
    if (uid === requesterId) continue;
    const f = s.files.get(id);
    if (!f) continue;
    // reachable when the file itself is link-shared OR it lives inside a
    // shared folder (children inherit the folder's access, like Google)
    const ancestorWithKey = (startId) => {
      const stack = [...startId];
      while (stack.length) {
        const p = s.files.get(stack.shift());
        if (!p) continue;
        if (p.shared || p.resourceKey) return p;
        stack.push(...p.parents);
      }
      return null;
    };
    const via = f.shared ? f : ancestorWithKey(f.parents);
    if (!via) continue;
    if (via.resourceKey && via.resourceKey !== resourceKey) return { denied: true };
    return { file: f };
  }
  return null;
}

/* ---------------- OAuth endpoints ---------------- */

export function mockAuthorizeUrl(params) {
  const u = new URL('/mock/google/authorize', 'http://local');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString().replace('http://local', '');
}

export function mockAuthorizePage(params) {
  const scopes = String(params.scope ?? '').split(' ').filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in — Google Sandbox</title>
  <style>body{font-family:Segoe UI,system-ui,sans-serif;background:#f5f5f7;display:grid;place-items:center;height:100vh;margin:0}
  .card{background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.15);padding:34px 38px;width:380px;text-align:center}
  .g{font-size:22px;font-weight:600;margin:6px 0 2px}.g span{color:#4285f4}.s{color:#5f6368;font-size:13.5px;margin:14px 0}
  .scopes{background:#f1f3f4;border-radius:8px;padding:10px 12px;text-align:left;font-size:12px;color:#3c4043;margin:0 0 16px}
  button{width:100%;padding:10px;border:none;border-radius:24px;background:#1a73e8;color:#fff;font-size:14px;cursor:pointer}
  .note{font-size:11px;color:#80868b;margin-top:14px}</style></head>
  <body><div class="card"><div class="g">Sign in with <span>Google</span> (sandbox)</div>
  <div class="s">to continue to <b>ReadSpace</b></div>
  <div class="scopes"><b>${mockGoogle.email}</b><br>will allow ReadSpace to:<br><br>${scopes.map((x) => '• ' + decodeURIComponent(x)).join('<br>')}</div>
  <form method="get" action="/mock/google/consent">
    <input type="hidden" name="state" value="${params.state ?? ''}">
    <input type="hidden" name="redirect_uri" value="${params.redirect_uri ?? ''}">
    <input type="hidden" name="code" value="${params.code ?? ''}">
    <button type="submit">Continue as ${mockGoogle.name}</button>
  </form>
  <div class="note">Local sandbox consent screen — no data leaves this machine.</div>
  </div></body></html>`;
}

export function mockConsumeCode(code) {
  // one-time codes; also validates the code existed
  return code && code.startsWith('MC_');
}

export function issueTokens(userId, withRefresh = true) {
  const s = storeFor(userId);
  const access = 'MA_' + crypto.randomBytes(18).toString('hex');
  s.tokens.set(access, { userId, exp: Date.now() + 3600_000 });
  const out = { access_token: access, token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/drive' };
  if (withRefresh) out.refresh_token = 'MR_' + crypto.randomBytes(18).toString('hex');
  return out;
}

export function mockRefresh(refreshToken) {
  return { access_token: 'MA_' + crypto.randomBytes(18).toString('hex'), token_type: 'Bearer', expires_in: 3600 };
}

/* ---------------- Drive endpoints ---------------- */

function findOwnerOf(id) {
  for (const [uid, s] of stores) if (s.files.has(id)) return uid;
  return null;
}

function entry(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.mimeType === FOLDER_MIME || file.mimeType === GDOC_MIME ? undefined : file.size,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
  };
}

export function mockDriveList(userId, { parent = 'root', pageToken, pageSize = 3, q, resourceKey }) {
  const s = storeFor(userId);
  let files;
  if (parent !== 'root' && !s.files.has(parent)) {
    // listing inside a link-shared folder owned by someone else
    const hit = findAccessible(userId, parent, resourceKey);
    const folder = hit && !hit.denied ? hit.file : null;
    if (!folder || folder.mimeType !== FOLDER_MIME) return { files: [] };
    const owner = findOwnerOf(parent);
    files = owner ? [...storeFor(owner).files.values()].filter((f) => f.parents.includes(parent)) : [];
  } else {
    files = [...s.files.values()].filter((f) =>
      (parent === 'root' ? f.parents.length === 0 : f.parents.includes(parent)));
  }
  if (q) files = files.filter((f) => f.name.toLowerCase().includes(String(q).toLowerCase()));
  files.sort((a, b) => (a.mimeType === FOLDER_MIME ? 0 : 1) - (b.mimeType === FOLDER_MIME ? 0 : 1) || a.name.localeCompare(b.name));
  const start = pageToken ? Number(pageToken) : 0;
  const size = Math.max(1, Math.min(50, pageSize || 3));
  const page = files.slice(start, start + size);
  const out = { files: page.map(entry) };
  if (start + size < files.length) out.nextPageToken = String(start + size);
  return out;
}

export function mockDriveMeta(userId, id, resourceKey) {
  if (id === 'root') return { id: 'root', name: 'My Drive', mimeType: FOLDER_MIME };
  const hit = findAccessible(userId, id, resourceKey);
  if (!hit || hit.denied) return null; // unknown id AND missing/wrong key both 404
  return entry(hit.file);
}

export function mockDriveContent(userId, id, resourceKey) {
  const hit = findAccessible(userId, id, resourceKey);
  const f = hit && !hit.denied ? hit.file : null;
  if (!f) return null;
  if (f.mimeType === GDOC_MIME) return null; // must export
  return Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
}

export function mockDriveExport(userId, id, resourceKey) {
  const hit = findAccessible(userId, id, resourceKey);
  const f = hit && !hit.denied ? hit.file : null;
  if (!f || f.mimeType !== GDOC_MIME) return null;
  return Buffer.from(f.content, 'utf8');
}

export async function mockDriveCreate(userId, { parent = 'root', name, mimeType }, content) {
  return entry(await addFile(userId, parent === 'root' ? null : parent, name, mimeType || 'application/octet-stream', content));
}

export function mockDriveUpdate(userId, id, content, expectedModifiedTime) {
  const f = storeFor(userId).files.get(id);
  if (!f) return { status: 404 };
  if (expectedModifiedTime && f.modifiedTime !== expectedModifiedTime) {
    return { status: 409, remote: entry(f) };
  }
  f.content = content;
  f.size = String(Buffer.byteLength(content));
  f.modifiedTime = new Date(Date.now() + 5).toISOString(); // strictly newer
  noteChange(userId, id, f.name, f.mimeType, false);
  return { status: 200, file: entry(f) };
}

/* ---------------- Drive Changes API (M6) ---------------- */

export function mockDriveStartToken(userId) {
  return String(storeFor(userId).changes.length);
}

export function mockDriveChanges(userId, pageToken) {
  const s = storeFor(userId);
  const start = Math.max(0, Math.min(s.changes.length, Number(pageToken ?? 0) || 0));
  return {
    changes: s.changes.slice(start).map((c) => ({ ...c })),
    newPageToken: String(s.changes.length),
  };
}

export function mockDriveTokenOwner(access) {
  const t = stores.get(DEMO_SUBJECT);
  if (!t) return null;
  const rec = t.tokens.get(access);
  return rec ? rec.userId : null;
}
