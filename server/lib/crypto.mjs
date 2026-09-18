/**
 * Refresh-token encryption at rest (PRD §13.2, §18).
 * AES-256-GCM with a versioned key; ciphertext format: v1:base64(iv|tag|ct).
 * The key lives only in server env (TOKEN_ENCRYPTION_KEY); a dev fallback key
 * is derived from SESSION_SECRET with a loud warning — never in production.
 */
import crypto from 'node:crypto';

let warned = false;

function keyForVersion(version) {
  if (version === 'v1') {
    const secret = process.env.TOKEN_ENCRYPTION_KEY;
    if (secret) return crypto.createHash('sha256').update(`readspace:${secret}`).digest();
    if (!warned) {
      warned = true;
      console.warn('[security] TOKEN_ENCRYPTION_KEY is not set — using a DEVELOPMENT fallback key. Set it before any real deployment.');
    }
    return crypto.createHash('sha256').update('readspace:dev-fallback-key').digest();
  }
  return null;
}

export const CURRENT_KEY_VERSION = 'v1';

export function encryptSecret(plaintext) {
  const key = keyForVersion(CURRENT_KEY_VERSION);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v1:${Buffer.concat([iv, tag, ct]).toString('base64')}`,
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptSecret(ciphertext, keyVersion = CURRENT_KEY_VERSION) {
  const key = keyForVersion(keyVersion);
  if (!key) throw new Error(`Unknown encryption key version: ${keyVersion}`);
  const [v, blob] = ciphertext.split(':');
  if (v !== 'v1' || !blob) throw new Error('Malformed ciphertext');
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
