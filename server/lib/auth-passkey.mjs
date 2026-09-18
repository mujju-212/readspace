import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';

/**
 * Memory stores for in-flight WebAuthn challenges (5 min TTL).
 */
const registrationChallenges = new Map(); // userId -> { challenge, expiresAt }
const authenticationChallenges = new Map(); // challenge -> expiresAt

function cleanExpired() {
  const now = Date.now();
  for (const [id, c] of registrationChallenges) {
    if (c.expiresAt < now) registrationChallenges.delete(id);
  }
  for (const [ch, exp] of authenticationChallenges) {
    if (exp < now) authenticationChallenges.delete(ch);
  }
}
setInterval(cleanExpired, 60_000).unref?.();

/**
 * Password hashing with Node built-in crypto.scryptSync (salt + 64 bytes).
 */
export function hashPassword(password) {
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derivedKey.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derivedKey, keyBuf);
}

export function getRpId(req) {
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(':')[0];
  return host;
}

export function getExpectedOrigin(req) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:5173';
  const proto = req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http');
  const origin = `${proto}://${host}`;
  return [origin, 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

/**
 * Generate WebAuthn registration options for a logged-in user.
 */
export async function createPasskeyRegistrationOptions(req, user) {
  const rpID = getRpId(req);
  const existingCreds = (user.passkeys || []).map((p) => ({
    id: p.id,
    transports: p.transports,
  }));

  const options = await generateRegistrationOptions({
    rpName: 'ReadSpace',
    rpID,
    userID: isoUint8Array.fromUTF8String(user._id),
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    attestationType: 'none',
    excludeCredentials: existingCreds,
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred',
    },
    timeout: 60000,
  });

  registrationChallenges.set(user._id, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return options;
}

/**
 * Verify WebAuthn registration response and return new passkey object.
 */
export async function verifyPasskeyRegistration(req, user, responseBody, passkeyName) {
  const pending = registrationChallenges.get(user._id);
  if (!pending || pending.expiresAt < Date.now()) {
    throw new Error('Registration challenge expired or missing. Please try again.');
  }
  registrationChallenges.delete(user._id);

  const verification = await verifyRegistrationResponse({
    response: responseBody,
    expectedChallenge: pending.challenge,
    expectedOrigin: getExpectedOrigin(req),
    expectedRPID: getRpId(req),
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  return {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: responseBody.response?.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: passkeyName || `Passkey (${new Date().toLocaleDateString()})`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate WebAuthn authentication options for passkey login (resident key / passwordless).
 */
export async function createPasskeyLoginOptions(req) {
  const rpID = getRpId(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    timeout: 60000,
  });

  authenticationChallenges.set(options.challenge, Date.now() + 5 * 60 * 1000);

  return options;
}

/**
 * Verify passkey login response across registered passkeys.
 */
export async function verifyPasskeyLogin(req, users, responseBody) {
  const clientDataJSONStr = Buffer.from(responseBody.response?.clientDataJSON || '', 'base64').toString('utf8');
  let clientChallenge = '';
  try {
    const clientData = JSON.parse(clientDataJSONStr);
    clientChallenge = clientData.challenge;
  } catch {}

  if (!clientChallenge || !authenticationChallenges.has(clientChallenge)) {
    throw new Error('Login challenge expired or invalid. Please try again.');
  }
  authenticationChallenges.delete(clientChallenge);

  // Match the passkey to its owner
  let matchedUser = null;
  let matchedPasskey = null;
  for (const u of users) {
    const p = (u.passkeys || []).find((pk) => pk.id === responseBody.id);
    if (p) {
      matchedUser = u;
      matchedPasskey = p;
      break;
    }
  }

  if (!matchedUser || !matchedPasskey) {
    throw new Error('Passkey not recognized. Please sign in with email or register your passkey.');
  }

  const verification = await verifyAuthenticationResponse({
    response: responseBody,
    expectedChallenge: clientChallenge,
    expectedOrigin: getExpectedOrigin(req),
    expectedRPID: getRpId(req),
    credential: {
      id: matchedPasskey.id,
      publicKey: isoBase64URL.toBuffer(matchedPasskey.publicKey),
      counter: matchedPasskey.counter,
      transports: matchedPasskey.transports,
    },
  });

  if (!verification.verified) {
    throw new Error('Passkey authentication could not be verified');
  }

  matchedPasskey.counter = verification.authenticationInfo.newCounter;
  return { user: matchedUser, passkey: matchedPasskey };
}
