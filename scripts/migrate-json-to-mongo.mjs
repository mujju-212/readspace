#!/usr/bin/env node
/**
 * Migration script: readspace-db.json → MongoDB Atlas.
 * Safe to re-run: upserts all documents by _id.
 * Usage: node scripts/migrate-json-to-mongo.mjs
 */
import '../server/lib/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('[migrate] Error: MONGODB_URI is not set in .env');
  process.exit(1);
}

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const jsonFile = path.join(root, 'data', 'readspace-db.json');

if (!fs.existsSync(jsonFile)) {
  console.error(`[migrate] Error: ${jsonFile} not found`);
  process.exit(1);
}

let dbData = {};
try {
  dbData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
} catch (e) {
  console.error('[migrate] Error parsing readspace-db.json:', e.message);
  process.exit(1);
}

let host = 'mongodb';
let dbName = 'readspace';
try {
  const parsed = new URL(uri.replace('mongodb+srv://', 'https://').replace('mongodb://', 'https://'));
  host = parsed.host || host;
  const pathDb = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (pathDb) dbName = pathDb;
} catch {}

console.log(`[migrate] Connecting to MongoDB Atlas → ${host} · database "${dbName}"...`);
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });

try {
  await client.connect();
  console.log('[migrate] Connected successfully.');
  const db = client.db(dbName);

  const collections = ['users', 'connections', 'workspaces', 'sessions', 'workspaceSessions', 'jobs', 'oauthStates', 'savedLinks'];
  const summary = {};

  for (const colName of collections) {
    const rawMap = dbData[colName] ?? {};
    const entries = Object.entries(rawMap);
    if (entries.length === 0) {
      summary[colName] = 0;
      continue;
    }

    const col = db.collection(colName);
    let migrated = 0;

    for (const [key, doc] of entries) {
      const docId = doc._id || doc.sid || key;
      const toUpsert = { ...doc, _id: docId };
      await col.replaceOne({ _id: docId }, toUpsert, { upsert: true });
      migrated++;
    }

    summary[colName] = migrated;
    console.log(`[migrate] Collection "${colName}": ${migrated} document(s) upserted.`);
  }

  console.log('\n[migrate] Migration complete! Summary:');
  console.table(summary);
} catch (err) {
  console.error('[migrate] Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.close();
}
