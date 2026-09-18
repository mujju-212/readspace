/**
 * Data layer for ReadSpace metadata (PRD v1.1 §12).
 *
 * Collections mirror the MongoDB data model one-for-one (users,
 * googleConnections, workspaces, workspaceSessions, transferJobs, oauthStates).
 * The default adapter persists to a JSON file so the whole product runs with
 * zero infrastructure. When MONGODB_URI is configured in production, the same
 * repository interface is served by the official mongodb driver — the
 * document shapes in this file match PRD §12 exactly, so moving to Atlas is a
 * configuration change, not a redesign.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'readspace-db.json');

const COLLECTIONS = ['users', 'connections', 'workspaces', 'sessions', 'workspaceSessions', 'jobs', 'oauthStates', 'savedLinks'];

class JsonCollection {
  constructor(store, persist) {
    this.store = store;
    this.persist = persist;
  }

  async get(id) {
    return this.store.get(id) ?? null;
  }
  async put(id, doc) {
    this.store.set(id, doc);
    this.persist();
    return doc;
  }
  async delete(id) {
    const had = this.store.delete(id);
    this.persist();
    return had;
  }
  async find(pred) {
    return [...this.store.values()].filter(pred);
  }
  async findOne(pred) {
    return [...this.store.values()].find(pred) ?? null;
  }
}

class JsonDb {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.data = {};
    if (fs.existsSync(DB_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        for (const c of COLLECTIONS) this.data[c] = new Map(Object.entries(parsed[c] ?? {}));
      } catch {
        console.warn('[db] could not parse db file, starting fresh');
      }
    }
    for (const c of COLLECTIONS) if (!this.data[c]) this.data[c] = new Map();
  }

  saveTimer = null;

  persistNow() {
    const out = {};
    for (const c of COLLECTIONS) out[c] = Object.fromEntries(this.data[c]);
    fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 1));
  }

  persist = () => {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try { this.persistNow(); } catch (e) { console.error('[db] persist failed', e); }
    }, 120);
  };

  coll(name) {
    return new JsonCollection(this.data[name], this.persist);
  }
}

class MongoCollection {
  constructor(collection, name) {
    this.collection = collection;
    this.name = name;
  }

  async get(id) {
    const doc = await this.collection.findOne({ _id: id });
    return doc ?? null;
  }

  async put(id, doc) {
    const toSave = { ...doc, _id: id };
    await this.collection.replaceOne({ _id: id }, toSave, { upsert: true });
    return toSave;
  }

  async delete(id) {
    const res = await this.collection.deleteOne({ _id: id });
    return res.deletedCount > 0;
  }

  async find(pred) {
    const all = await this.collection.find({}).toArray();
    if (typeof pred === 'function') return all.filter(pred);
    if (pred && typeof pred === 'object') return await this.collection.find(pred).toArray();
    return all;
  }

  async findOne(pred) {
    if (typeof pred === 'function') {
      const all = await this.collection.find({}).toArray();
      return all.find(pred) ?? null;
    }
    if (pred && typeof pred === 'object') {
      return (await this.collection.findOne(pred)) ?? null;
    }
    return null;
  }
}

class MongoDb {
  constructor(client, dbName) {
    this.client = client;
    this.db = client.db(dbName);
    this.ensureIndexes();
  }

  ensureIndexes() {
    this.db.collection('users').createIndex({ googleSubject: 1 }, { unique: true, sparse: true }).catch(() => {});
    this.db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true }).catch(() => {});
    this.db.collection('connections').createIndex({ userId: 1 }).catch(() => {});
    this.db.collection('workspaces').createIndex({ userId: 1, lastOpenedAt: -1 }).catch(() => {});
    this.db.collection('sessions').createIndex({ sid: 1 }, { unique: true, sparse: true }).catch(() => {});
    this.db.collection('jobs').createIndex({ userId: 1, createdAt: -1 }).catch(() => {});
    this.db.collection('savedLinks').createIndex({ userId: 1 }).catch(() => {});
  }

  coll(name) {
    return new MongoCollection(this.db.collection(name), name);
  }
}

let dbInstance;

if (process.env.MONGODB_URI) {
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    await client.connect();

    let host = 'mongodb';
    let dbName = 'readspace';
    try {
      const parsedUrl = new URL(process.env.MONGODB_URI.replace('mongodb+srv://', 'https://').replace('mongodb://', 'https://'));
      host = parsedUrl.host || host;
      const pathDb = parsedUrl.pathname.replace(/^\//, '').split('?')[0];
      if (pathDb) dbName = pathDb;
    } catch {}

    console.log(`[db] MongoDB connected → ${host} · database "${dbName}"`);
    dbInstance = new MongoDb(client, dbName);
  } catch (err) {
    console.warn(`[db] falling back to the JSON store due to connection error: ${err.message}`);
    dbInstance = new JsonDb();
  }
} else {
  dbInstance = new JsonDb();
}

export const db = dbInstance;
