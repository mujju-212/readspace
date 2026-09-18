/**
 * .env loader — MUST be the first import of server/index.mjs.
 * Reads repo-root `.env` (see .env.example) into process.env before any other
 * module evaluates (google.mjs reads GOOGLE_CLIENT_ID at import time).
 * Simple KEY=VALUE lines with # comments; real environment variables win.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env) && val !== '') process.env[m[1]] = val;
  }
}
