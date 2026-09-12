/**
 * Login sessions.
 *
 * Logging in used to answer only yes or no: the browser then kept the plain
 * password in sessionStorage and sent it with every API call, so every one of
 * ~100 authenticated endpoints was also a password oracle. Now a login returns
 * a token, the browser keeps the TOKEN where the password used to sit, and the
 * server accepts only tokens in the credential headers. The password is checked
 * at login and nowhere else.
 *
 * Token: 'rpgs_' + 32 random bytes (base64url). Only its SHA-256 is stored, so
 * a copy of campaigns.db does not hand out working sessions.
 *
 * Lifetime: 24 hours idle (sliding) and 7 days absolute. lastSeenAt is written
 * at most once a minute, so an active tab costs one small UPDATE per minute,
 * not one per request.
 *
 * Lives in campaigns.db, the registry: it already spans campaigns, a super-admin
 * session belongs to none, and sessions must survive the owner's restarts.
 */
import crypto from 'crypto';

export const TOKEN_PREFIX = 'rpgs_';

const IDLE_MS     = 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_MS    = 60 * 1000;

export function isSessionToken(v) {
  return typeof v === 'string' && v.startsWith(TOKEN_PREFIX) && v.length > TOKEN_PREFIX.length && v.length <= 96;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]  `now` is injectable for tests
 */
export function createSessionStore(db, {
  now = Date.now, idleMs = IDLE_MS, absoluteMs = ABSOLUTE_MS, touchEveryMs = TOUCH_MS,
} = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash  TEXT PRIMARY KEY,
      campaignId TEXT DEFAULT '',
      role       TEXT NOT NULL,
      charId     TEXT DEFAULT '',
      createdAt  INTEGER NOT NULL,
      lastSeenAt INTEGER NOT NULL,
      expiresAt  INTEGER NOT NULL,
      ip         TEXT DEFAULT '',
      userAgent  TEXT DEFAULT '',
      charName   TEXT DEFAULT ''
    );
  `);
  // charName arrived after the table did: the logout audit row has only the
  // session to go on, and without it showed a bare character id.
  try { db.exec("ALTER TABLE sessions ADD COLUMN charName TEXT DEFAULT ''"); } catch { /* already there */ }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(campaignId, role, charId)');

  const st = {
    insert: db.prepare(`INSERT INTO sessions (tokenHash, campaignId, role, charId, charName, createdAt, lastSeenAt, expiresAt, ip, userAgent)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    get:    db.prepare('SELECT * FROM sessions WHERE tokenHash = ?'),
    touch:  db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE tokenHash = ?'),
    del:    db.prepare('DELETE FROM sessions WHERE tokenHash = ?'),
    delChar: db.prepare(`DELETE FROM sessions WHERE campaignId = ? AND role = 'character' AND charId = ? AND tokenHash <> ?`),
    delRole: db.prepare('DELETE FROM sessions WHERE campaignId = ? AND role = ?'),
    delCampaign: db.prepare('DELETE FROM sessions WHERE campaignId = ?'),
    sweep:  db.prepare('DELETE FROM sessions WHERE expiresAt <= ? OR lastSeenAt <= ?'),
    count:  db.prepare('SELECT COUNT(*) AS n FROM sessions'),
    // Live sessions only: the sweep runs every few minutes, so the table can
    // hold rows that are already dead and must not be offered to an admin as
    // something to end.
    list:   db.prepare(`SELECT tokenHash, campaignId, role, charId, charName, createdAt, lastSeenAt, expiresAt, ip, userAgent
                        FROM sessions WHERE expiresAt > ? AND lastSeenAt > ?
                        ORDER BY lastSeenAt DESC LIMIT ?`),
    delAll: db.prepare('DELETE FROM sessions WHERE tokenHash <> ?'),
  };

  /**
   * @param {{campaignId?:string, role:'dm'|'character'|'admin', charId?:string, charName?:string, ip?:string, userAgent?:string}} s
   * @returns {{token:string, tokenHash:string, expiresAt:number}}
   */
  function create({ campaignId = '', role, charId = '', charName = '', ip = '', userAgent = '' }) {
    if (!['dm', 'character', 'admin'].includes(role)) throw new Error(`bad session role: ${role}`);
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const t = now();
    const expiresAt = t + absoluteMs;
    st.insert.run(tokenHash, String(campaignId || ''), role, String(charId || ''), String(charName || '').slice(0, 128),
      t, t, expiresAt, String(ip || '').slice(0, 64), String(userAgent || '').slice(0, 256));
    return { token, tokenHash, expiresAt };
  }

  /**
   * The live session for a token, or null. SYNC on purpose: masterAuth() is
   * sync at ~100 call sites, and a better-sqlite3 primary-key lookup costs
   * microseconds.
   */
  function resolve(token) {
    if (!isSessionToken(token)) return null;
    const tokenHash = hashToken(token);
    const row = st.get.get(tokenHash);
    if (!row) return null;
    const t = now();
    if (t >= row.expiresAt || t - row.lastSeenAt >= idleMs) {
      st.del.run(tokenHash);
      return null;
    }
    if (t - row.lastSeenAt >= touchEveryMs) st.touch.run(t, tokenHash);
    return {
      tokenHash, role: row.role, campaignId: row.campaignId || '', charId: row.charId || '',
      charName: row.charName || '', createdAt: row.createdAt, expiresAt: row.expiresAt,
    };
  }

  const revoke = token => (isSessionToken(token) ? st.del.run(hashToken(token)).changes > 0 : false);
  const revokeHash = hash => st.del.run(String(hash || '')).changes > 0;

  /**
   * Every session still alive, newest activity first — what the maintenance
   * page lists so a super-admin can end one. The tokenHash identifies a row and
   * is safe to hand out: authenticating needs the token it was derived from.
   */
  function list({ limit = 500 } = {}) {
    const t = now();
    return st.list.all(t, t - idleMs, Math.max(1, Math.min(5000, limit)));
  }

  /** Ends every session but one — the admin doing it keeps theirs. */
  const revokeAll = (exceptHash = '') => st.delAll.run(String(exceptHash || '')).changes;

  /** Every session of one character, except the one making the change. */
  const revokeCharacter = (campaignId, charId, exceptHash = '') =>
    st.delChar.run(String(campaignId || ''), String(charId || ''), String(exceptHash || '')).changes;

  const revokeCampaignRole = (campaignId, role) => st.delRole.run(String(campaignId || ''), role).changes;
  const revokeCampaign = campaignId => st.delCampaign.run(String(campaignId || '')).changes;

  function sweep() {
    const t = now();
    return st.sweep.run(t, t - idleMs).changes;
  }

  return {
    create, resolve, revoke, revokeHash, revokeCharacter, revokeCampaignRole, revokeCampaign, sweep,
    list, revokeAll,
    count: () => st.count.get().n,
  };
}

/**
 * One-time tickets for setting a character's FIRST password.
 *
 * A character with no password is claimed by whoever sets one. That flow is
 * unchanged for a person — log in, get told to choose a password, choose one —
 * but the "choose one" request used to be open to anyone, so a script could
 * claim every unclaimed character without touching the login form. Now the
 * login form, after its captcha passes, hands out a ticket tied to that
 * character, and setting the first password needs it. Single-use, 10 minutes.
 */
export function createSetupTickets({ now = Date.now, ttlMs = 10 * 60 * 1000, max = 5000 } = {}) {
  const tickets = new Map();   // ticket -> { campaignId, charId, expires }

  function sweep() {
    const t = now();
    for (const [k, v] of tickets) if (v.expires <= t) tickets.delete(k);
  }

  function issue(campaignId, charId) {
    if (tickets.size >= max) sweep();
    while (tickets.size >= max) tickets.delete(tickets.keys().next().value);
    const ticket = crypto.randomBytes(24).toString('base64url');
    tickets.set(ticket, { campaignId: String(campaignId || ''), charId: String(charId || ''), expires: now() + ttlMs });
    return ticket;
  }

  /** True once, for the character and campaign it was issued to. */
  function consume(ticket, campaignId, charId) {
    if (!ticket) return false;
    const key = String(ticket);
    const v = tickets.get(key);
    if (!v) return false;
    tickets.delete(key);
    return v.expires > now() && v.campaignId === String(campaignId || '') && v.charId === String(charId || '');
  }

  return { issue, consume, sweep, size: () => tickets.size };
}
