/**
 * Failed-login throttling.
 *
 * The captcha makes each guess cost a solved sum; this makes the NUMBER of
 * guesses small. Two counters, both over a sliding 15-minute window:
 *
 *   (IP, account)  5 failures lock that pair. The lock starts at a minute and
 *                  doubles on each repeat, up to 30 minutes. Keyed by the pair
 *                  on purpose: players at one table share a home IP, and one of
 *                  them mistyping must not lock out the others.
 *   IP             25 failures across ALL accounts lock the address — the
 *                  counter that stops one machine walking through every
 *                  character.
 *
 * A success clears that pair's record but not the IP's: logging into your own
 * account must not reset a count built up against someone else's.
 *
 * `account` is a free-form key chosen by the caller: 'dm:<campaignId>',
 * 'char:<campaignId>:<charId>', 'admin', 'stories:<campaignId>'.
 *
 * In memory. A restart forgets every lock, which is acceptable: a restart is a
 * manual act by the owner, not something an attacker can trigger.
 */

const WINDOW_MS    = 15 * 60 * 1000;
const PAIR_MAX     = 5;
const IP_MAX       = 25;
const BASE_LOCK_MS = 60 * 1000;
const MAX_LOCK_MS  = 30 * 60 * 1000;
const ALERT_AT     = 5;
const MAX_KEYS     = 50000;

/**
 * The caller's address. X-Forwarded-For is client-controlled, so it is only
 * believed when a real reverse proxy is declared with TRUST_PROXY — this server
 * terminates TLS itself. (Moved here from server.js clientMetaFromReq.)
 */
export function clientIp(req, trustProxy = false) {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return String((trustProxy && xff) ? xff : (req?.socket?.remoteAddress || '')).slice(0, 64);
}

export function createLoginGuard({
  now = Date.now,
  windowMs = WINDOW_MS,
  pairMax = PAIR_MAX,
  ipMax = IP_MAX,
  baseLockMs = BASE_LOCK_MS,
  maxLockMs = MAX_LOCK_MS,
  alertAt = ALERT_AT,
  maxKeys = MAX_KEYS,
} = {}) {
  // key -> { fails: number[], lockUntil, lockCount, lastLockAt, alertedAt }
  const entries = new Map();

  function entry(key) {
    let e = entries.get(key);
    if (!e) {
      if (entries.size >= maxKeys) sweep();
      while (entries.size >= maxKeys) entries.delete(entries.keys().next().value);
      // -Infinity, not 0, for "never alerted": 0 is a real timestamp to a clock
      // that starts there, and a falsy sentinel re-fired the alert on every
      // failure after the first.
      e = { fails: [], lockUntil: 0, lockCount: 0, lastLockAt: 0, alertedAt: -Infinity };
      entries.set(key, e);
    }
    return e;
  }

  function prune(e, t) {
    e.fails = e.fails.filter(ts => t - ts < windowMs);
    // A lock that ended long ago stops counting toward the next one's length.
    if (e.lockCount && e.lockUntil <= t && t - e.lastLockAt > windowMs + maxLockMs) e.lockCount = 0;
  }

  const pairKey = (ip, account) => `pair:${ip}|${account}`;
  const ipKey   = ip => `ip:${ip}`;
  const acctKey = account => `acct:${account}`;

  function lockedFor(key, t) {
    const e = entries.get(key);
    return e && e.lockUntil > t ? e.lockUntil - t : 0;
  }

  /** Is this (IP, account) currently refused? */
  function check(ip, account) {
    const t = now();
    const ms = Math.max(lockedFor(pairKey(ip, account), t), lockedFor(ipKey(ip), t));
    return ms > 0 ? { locked: true, retryAfterSec: Math.ceil(ms / 1000) } : { locked: false, retryAfterSec: 0 };
  }

  function bump(key, max, t) {
    const e = entry(key);
    prune(e, t);
    e.fails.push(t);
    if (e.fails.length >= max) {
      e.lockCount++;
      e.lockUntil = t + Math.min(baseLockMs * 2 ** (e.lockCount - 1), maxLockMs);
      e.lastLockAt = t;
      e.fails = [];     // the lock is the consequence; after it, a fresh set of tries
      return true;
    }
    return false;
  }

  /**
   * Record a failure (wrong password OR wrong captcha answer).
   *
   * Both kinds count toward the lock. Only password failures count toward the
   * DM alert (`alertable`): a player fumbling the sum five times is not
   * "someone got your password wrong", and letting it spend the once-per-window
   * alert would silence the real one that follows.
   *
   * @returns {{locked:boolean, retryAfterSec:number, justLocked:boolean, alert:boolean}}
   *   `alert` is true exactly once per window when this ACCOUNT (from any IP)
   *   reaches the alert threshold — the moment to tell the DM.
   */
  function fail(ip, account, { alertable = true } = {}) {
    const t = now();
    const pairLocked = bump(pairKey(ip, account), pairMax, t);
    const ipLocked   = bump(ipKey(ip), ipMax, t);

    let alert = false;
    if (alertable) {
      const a = entry(acctKey(account));
      prune(a, t);
      a.fails.push(t);
      if (a.fails.length >= alertAt && t - a.alertedAt >= windowMs) {
        a.alertedAt = t;
        alert = true;
      }
    }
    const state = check(ip, account);
    return { ...state, justLocked: pairLocked || ipLocked, alert };
  }

  /** A correct login clears this pair, not the IP (see the header). */
  function succeed(ip, account) {
    entries.delete(pairKey(ip, account));
  }

  function sweep() {
    const t = now();
    for (const [k, e] of entries) {
      prune(e, t);
      const idle = !e.fails.length && e.lockUntil <= t && !e.lockCount && t - e.alertedAt >= windowMs;
      if (idle) entries.delete(k);
    }
  }

  return { check, fail, succeed, sweep, size: () => entries.size };
}
