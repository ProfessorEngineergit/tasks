// Passwords (scrypt), session tokens and a small in-memory rate limiter.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Used for unknown usernames so a failed login takes the same time either way.
const DUMMY = hashPassword(randomBytes(12).toString('hex'));

export function verifyPassword(password, stored = DUMMY) {
  try {
    const [algo, N, r, p, salt, hash] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = token => createHash('sha256').update(token).digest('hex');

export const USERNAME_RE = /^[a-zA-Z0-9._-]{2,32}$/;
export const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

// Fixed-window limiter: at most `limit` hits per key per `windowMs`.
export function rateLimiter({ limit, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return key => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n += 1;
    return e.n <= limit;
  };
}
