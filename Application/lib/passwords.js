/**
 * Password hashing shared by the server, the campaign registry and the
 * campaign bootstrap. scrypt with a per-password salt, stored as "salt:hash".
 * Same format character passwords have always used, so existing hashes and
 * any new campaign DM hashes are interchangeable.
 *
 * Two flavours of the same thing:
 *
 *   hashPasswordAsync / verifyPasswordAsync
 *       What request handlers use. scrypt is deliberately slow (~50ms), and the
 *       sync version holds the whole event loop for that long — every wrong
 *       guess used to freeze the server for every other player. The async one
 *       runs on libuv's thread pool instead.
 *
 *   hashPassword / verifyPassword
 *       Kept for start-up code (the campaign bootstrap, createCampaign) where
 *       nothing else is waiting. Not handed to route modules: a route that
 *       forgot its `await` on the async one would test a Promise, which is
 *       truthy, and let everyone in. Removing the sync name from ctx makes a
 *       missed call site fail loudly instead.
 */
import crypto from 'crypto';

const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const attempt = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch { return false; }
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

/** Resolves true/false; never rejects. Same salt:hash format as hashPassword. */
export async function verifyPasswordAsync(password, stored) {
  try {
    if (password == null || password === '') return false;
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const attempt = await scryptAsync(password, salt);
    if (expected.length !== attempt.length) return false;
    return crypto.timingSafeEqual(expected, attempt);
  } catch { return false; }
}
