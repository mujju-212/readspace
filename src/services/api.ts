/**
 * Typed client for the ReadSpace backend (PRD v1.1 §14).
 * Session rides on HttpOnly cookies — never tokens in JS.
 */

export interface ApiUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  hasPassword?: boolean;
  passkeyCount?: number;
}
export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
}
export interface DriveStatus { status: 'connected' | 'reauthorization_required' | 'disconnected' | 'error'; email?: string; scopes?: string[] }
export interface AppConfig { mode: 'google' | 'sandbox'; sandboxUser?: { email: string; name: string }; appName: string }

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
}

export interface Candidate {
  relativePath: string;
  name: string;
  size?: number;
  lastModified?: number;
  classification: 'likely_new' | 'same_candidate' | 'name_collision' | 'unsupported' | 'unreadable';
  reason?: string;
  remoteId?: string;
}

/** A saved link: a *reference* to a shared Drive resource (never a copy). */
export interface SavedLink {
  _id: string;
  title: string;
  url: string;
  fileId?: string;
  folderId?: string;
  resourceType: 'file' | 'folder' | 'unknown';
  mimeType?: string;
  resourceKey?: string;
  sharedBy?: string;
  collection?: string;
  addedAt: string;
  lastOpenedAt?: string;
  openCount?: number;
  progress?: { scrollTop: number; updatedAt: string };
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public codeName: string, public remote?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'x-requested-with': 'readspace', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* non-json error */ }
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.codeName ?? 'error', body.remote);
  }
  if (raw) return res.arrayBuffer() as unknown as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),

  me: () => request<{ user: ApiUser | null; authMode: string; drive: DriveStatus }>('/api/auth/me'),
  signInDemo: () => request<{ ok: true }>('/api/auth/demo', { method: 'POST' }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  googleStart: (withDrive: boolean) => { window.location.href = `/api/auth/google/start${withDrive ? '?drive=1' : ''}`; },

  register: (payload: { email: string; password: string; displayName?: string }) =>
    request<{ ok: true; user: ApiUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }),

  login: (payload: { email: string; password: string }) =>
    request<{ ok: true; user: ApiUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }),

  setPassword: (payload: { password: string; currentPassword?: string }) =>
    request<{ ok: true; user: ApiUser }>('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }),

  passkeyRegisterOptions: () =>
    request<any>('/api/auth/passkey/register-options', { method: 'POST' }),

  passkeyRegisterVerify: (response: any, name?: string) =>
    request<{ ok: true; user: ApiUser; passkeys: PasskeyInfo[] }>('/api/auth/passkey/register-verify', {
      method: 'POST',
      body: JSON.stringify({ response, name }),
      headers: { 'content-type': 'application/json' },
    }),

  passkeyLoginOptions: () =>
    request<any>('/api/auth/passkey/login-options', { method: 'POST' }),

  passkeyLoginVerify: (response: any) =>
    request<{ ok: true; user: ApiUser }>('/api/auth/passkey/login-verify', {
      method: 'POST',
      body: JSON.stringify({ response }),
      headers: { 'content-type': 'application/json' },
    }),

  listPasskeys: () =>
    request<{ passkeys: PasskeyInfo[] }>('/api/auth/passkeys'),

  deletePasskey: (id: string) =>
    request<{ ok: true; user: ApiUser; passkeys: PasskeyInfo[] }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  driveStatus: () => request<{ drive: DriveStatus }>('/api/drive/status'),
  driveDisconnect: () => request<{ ok: true }>('/api/drive/disconnect', { method: 'POST' }),
  driveList: (parentId: string, resourceKey?: string) =>
    request<{ files: DriveFile[]; parentId: string }>(`/api/drive/files?parentId=${encodeURIComponent(parentId)}${resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : ''}`),
  driveMeta: (id: string, resourceKey?: string) =>
    request<DriveFile>(`/api/drive/files/${encodeURIComponent(id)}/meta${resourceKey ? `?resourceKey=${encodeURIComponent(resourceKey)}` : ''}`),
  driveContent: (id: string, exportMime?: string, resourceKey?: string) =>
    request<ArrayBuffer>(`/api/drive/files/${encodeURIComponent(id)}/content?${exportMime ? `export=${encodeURIComponent(exportMime)}&` : ''}${resourceKey ? `resourceKey=${encodeURIComponent(resourceKey)}` : ''}`, {}, true),
  driveUpload: (parentId: string, name: string, mimeType: string, content: ArrayBuffer | string) =>
    request<{ file: DriveFile }>(`/api/drive/files?parentId=${encodeURIComponent(parentId)}&name=${encodeURIComponent(name)}&mimeType=${encodeURIComponent(mimeType)}`, {
      method: 'POST',
      body: content as BodyInit,
    }),
  driveUpdate: (id: string, content: string, ifModifiedTime?: string) =>
    request<{ file: DriveFile }>(`/api/drive/files/${encodeURIComponent(id)}${ifModifiedTime ? `?ifModifiedTime=${encodeURIComponent(ifModifiedTime)}` : ''}`, {
      method: 'PATCH',
      body: content,
    }),

  workspaces: () => request<{ workspaces: any[] }>('/api/workspaces'),
  workspaceGet: (key: string) => request<{ workspace: any; session: any }>(`/api/workspaces/${encodeURIComponent(key)}`),
  workspaceSync: (payload: unknown) => request<{ ok: true }>('/api/workspaces/sync', { method: 'POST', body: JSON.stringify(payload) }),

  transfersScan: (driveFolderId: string, manifest: Candidate[]) =>
    request<{ candidates: Candidate[]; remoteCount: number }>(`/api/transfers/scan`, { method: 'POST', body: JSON.stringify({ driveFolderId, manifest }) }),
  transfersRecord: (payload: unknown) => request<{ job: any }>('/api/transfers', { method: 'POST', body: JSON.stringify(payload) }),

  savedLinks: () => request<{ links: SavedLink[] }>('/api/saved-links'),
  savedLinkCreate: (draft: { title: string; url: string; fileId?: string; folderId?: string; mimeType?: string; resourceKey?: string; sharedBy?: string; collection?: string }) =>
    request<{ link: SavedLink; updated?: boolean }>('/api/saved-links', { method: 'POST', body: JSON.stringify(draft) }),
  savedLinkUpdate: (id: string, patch: { title?: string; collection?: string; progress?: { scrollTop: number }; markOpened?: boolean }) =>
    request<{ link: SavedLink }>(`/api/saved-links/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  savedLinkDelete: (id: string) =>
    request<{ ok: true }>(`/api/saved-links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** Google-native export targets (PRD §16 — never treat Docs as binaries). */
export function exportMimeFor(docMime: string): { mime: string; ext: string } | null {
  switch (docMime) {
    case 'application/vnd.google-apps.document': return { mime: 'text/plain', ext: 'txt' };
    case 'application/vnd.google-apps.spreadsheet': return { mime: 'text/csv', ext: 'csv' };
    case 'application/vnd.google-apps.presentation': return { mime: 'text/plain', ext: 'txt' };
    default: return null;
  }
}

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html',
    css: 'text/css', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? 'application/octet-stream';
}
