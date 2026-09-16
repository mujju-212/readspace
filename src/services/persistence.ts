/**
 * Persistence layer (TRD §3.3, §5.2):
 *  - handles : FileSystemDirectoryHandles for "restore last workspace"
 *  - kv      : small app state (last workspace id, recents pointer)
 *  - drafts  : unsaved edit buffers, recoverable after a crash
 *  - recents : recent folders for the welcome screen
 * Falls back to an in-memory map when IndexedDB is unavailable.
 */

const DB_NAME = 'readspace';
const VERSION = 3;
const STORES = ['kv', 'handles', 'drafts', 'recents', 'snapshots'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, Map<string, unknown>>();

function mem(store: StoreName): Map<string, unknown> {
  let m = memory.get(store);
  if (!m) { m = new Map(); memory.set(store, m); }
  return m;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-indexeddb'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onblocked = () => {
      console.warn('[idb] open blocked by another tab');
    };
    req.onerror = () => reject(req.error);
    setTimeout(() => reject(new Error('idb-timeout')), 4000);
  });
  // allow a clean retry if IndexedDB is broken (private mode etc.)
  void dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`idb-tx-timeout:${store}`));
          }
        }, 2000);

        try {
          if (!db.objectStoreNames.contains(store)) {
            clearTimeout(timer);
            return reject(new Error(`missing-store:${store}`));
          }
          const t = db.transaction(store, mode);
          t.onerror = () => {
            if (!settled) { settled = true; clearTimeout(timer); reject(t.error || new Error('tx-error')); }
          };
          t.onabort = () => {
            if (!settled) { settled = true; clearTimeout(timer); reject(t.error || new Error('tx-aborted')); }
          };
          const req = fn(t.objectStore(store));
          req.onsuccess = () => {
            if (!settled) { settled = true; clearTimeout(timer); resolve(req.result); }
          };
          req.onerror = () => {
            if (!settled) { settled = true; clearTimeout(timer); reject(req.error); }
          };
        } catch (err) {
          if (!settled) { settled = true; clearTimeout(timer); reject(err); }
        }
      }),
  );
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    console.warn('[idb] operation failed:', err);
    return fallback;
  }
}

/* ---------- generic kv (with localStorage fallback for 100% reload reliability) ---------- */
export const kvGet = async <T = unknown>(key: string): Promise<T> => {
  const fromIdb = await safe(() => tx<T>('kv', 'readonly', (s) => s.get(key)), undefined as T);
  if (fromIdb !== undefined) return fromIdb;
  try {
    const raw = localStorage.getItem(`rs.kv.${key}`);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return undefined as T;
};

export const kvSet = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`rs.kv.${key}`, JSON.stringify(value));
  } catch { /* ignore */ }
  return safe(() => tx('kv', 'readwrite', (s) => s.put(value, key)).then(() => undefined), undefined);
};

/* ---------- directory handles ---------- */
export const putHandle = (name: string, handle: unknown) =>
  safe(() => tx('handles', 'readwrite', (s) => s.put(handle, name)).then(() => undefined), undefined);

export const getHandle = async <T = unknown>(name: string): Promise<T> => {
  let res = await safe(() => tx<T>('handles', 'readonly', (s) => s.get(name)), undefined as T);
  if (!res && name.startsWith('fsa:')) {
    res = await safe(() => tx<T>('handles', 'readonly', (s) => s.get(name.slice(4))), undefined as T);
  }
  if (!res && !name.startsWith('fsa:')) {
    res = await safe(() => tx<T>('handles', 'readonly', (s) => s.get(`fsa:${name}`)), undefined as T);
  }
  if (!res && name !== 'last') {
    res = await safe(() => tx<T>('handles', 'readonly', (s) => s.get('last')), undefined as T);
  }
  return res;
};

/* ---------- folder snapshots (fallback persistence across reloads) ---------- */
export interface SnapshotFile {
  path: string;
  name: string;
  type: string;
  size: number;
  buffer: ArrayBuffer;
  isDir?: boolean;
}
export const putSnapshot = (label: string, files: SnapshotFile[]) =>
  safe(() => tx('snapshots', 'readwrite', (s) => s.put(files, label)).then(() => undefined), undefined);

export const getSnapshot = async (label: string) => {
  let res = await safe(() => tx<SnapshotFile[] | undefined>('snapshots', 'readonly', (s) => s.get(label)), undefined);
  if (!res && label !== 'last') {
    res = await safe(() => tx<SnapshotFile[] | undefined>('snapshots', 'readonly', (s) => s.get('last')), undefined);
  }
  return res;
};

/* ---------- recents ---------- */
export interface RecentFolder { kind: 'fsa' | 'sample' | 'fallback' | 'gdrive'; label: string; ts: number; id?: string; hint?: string }
export async function addRecent(r: RecentFolder): Promise<void> {
  const all = await getRecents();
  const next = [r, ...all.filter((x) => !(x.kind === r.kind && x.label === r.label))].slice(0, 8);
  try {
    localStorage.setItem('rs.recents', JSON.stringify(next));
  } catch { /* ignore */ }
  await safe(() => tx('recents', 'readwrite', (s) => s.put(next, 'list')).then(() => undefined), undefined);
}
export async function getRecents(): Promise<RecentFolder[]> {
  const fromIdb = await safe(async () => (await tx<RecentFolder[]>('recents', 'readonly', (s) => s.get('list'))) ?? [], []);
  if (fromIdb.length > 0) return fromIdb;
  try {
    const raw = localStorage.getItem('rs.recents');
    if (raw) return JSON.parse(raw) as RecentFolder[];
  } catch { /* ignore */ }
  return [];
}

/* ---------- unsaved-edit drafts (reliability NFR) ---------- */
export const loadDraft = (pid: string, path: string) =>
  safe(() => tx<{ text: string } | undefined>('drafts', 'readonly', (s) => s.get(`${pid}::${path}`)), undefined)
    .then((d) => (d && typeof d.text === 'string' ? d.text : null));
export const clearDraft = (pid: string, path: string) =>
  safe(() => tx('drafts', 'readwrite', (s) => s.delete(`${pid}::${path}`)).then(() => undefined), undefined);

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleDraft(pid: string, path: string, text: string): void {
  const key = `${pid}::${path}`;
  const prev = draftTimers.get(key);
  if (prev) clearTimeout(prev);
  draftTimers.set(
    key,
    setTimeout(() => {
      draftTimers.delete(key);
      void safe(() => tx('drafts', 'readwrite', (s) => s.put({ text, ts: Date.now() }, key)).then(() => undefined), undefined);
    }, 800),
  );
}
