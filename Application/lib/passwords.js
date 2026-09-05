/**
 * Password hashing shared by the server, the campaign registry and the
 * campaign bootstrap. scrypt with a per-password salt, stored as "salt:hash".
 * Same format character passwords have always used, so existing hashes and
 * any new campaign DM hashes are interchangeable.
 */
import crypto from 'crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch { return false; }
}
