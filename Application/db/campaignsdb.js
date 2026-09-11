/**
 * Campaign registry — the only cross-tenant database.
 *
 * Holds nothing but the list of campaigns and each campaign's DM password.
 * Every piece of actual campaign content (characters, tokens, treasury,
 * monsters, calendar, stories, media, AI DM sessions) lives in that campaign's
 * own SQLite files under data/campaigns/<id>/ — see db/campaign-store.js.
 *
 * Keeping the registry separate is what makes cross-campaign leakage
 * impossible: a route handler never has a handle that spans two campaigns.
 */
import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { hashPassword, verifyPasswordAsync } from '../lib/passwords.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// CAMPAIGNS_DB lets tests (and an alternative deployment layout) point the
// registry somewhere other than Application/campaigns.db.
const REGISTRY_FILE = process.env.CAMPAIGNS_DB || path.join(__dirname, '..', 'campaigns.db');
const db = new Database(REGISTRY_FILE);
db.pragma('journal_mode = DELETE'); // Docker-compatible, matches the other DBs

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT '',
    slug           TEXT DEFAULT '',
    description    TEXT DEFAULT '',
    dmPasswordHash TEXT DEFAULT '',
    coverUrl       TEXT DEFAULT '',
    coverThumb     TEXT DEFAULT '',
    coverMedium    TEXT DEFAULT '',
    isActive       INTEGER DEFAULT 1,
    sortOrder      INTEGER DEFAULT 0,
    createdAt      TEXT DEFAULT (datetime('now')),
    lastPlayedAt   TEXT DEFAULT ''
  );
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug ON campaigns(slug) WHERE slug <> ''`);

// The campaign that inherits all pre-multi-tenant data. Fixed so a re-run of the
// bootstrap never creates a second copy of it.
export const LEGACY_CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Slugs are unique; append -2, -3, ... when the base is taken.
function uniqueSlug(base, ignoreId) {
  const root = slugify(base) || 'campaign';
  let slug = root;
  for (let n = 2; n < 500; n++) {
    const row = db.prepare('SELECT id FROM campaigns WHERE slug = ?').get(slug);
    if (!row || row.id === ignoreId) return slug;
    slug = `${root}-${n}`;
  }
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}

function rowToCampaign(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || '',
    slug: r.slug || '',
    description: r.description || '',
    coverUrl: r.coverUrl || '',
    coverThumb: r.coverThumb || '',
    coverMedium: r.coverMedium || '',
    isActive: !!r.isActive,
    sortOrder: r.sortOrder ?? 0,
    createdAt: r.createdAt || '',
    lastPlayedAt: r.lastPlayedAt || '',
    hasDmPassword: !!r.dmPasswordHash,
  };
}

export function listCampaigns({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM campaigns ORDER BY sortOrder, name').all()
    : db.prepare('SELECT * FROM campaigns WHERE isActive = 1 ORDER BY sortOrder, name').all();
  return rows.map(rowToCampaign);
}

export function getCampaign(id) {
  return rowToCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
}

export function getCampaignBySlug(slug) {
  return rowToCampaign(db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(slug));
}

/** Accepts an id or a slug — the campaign cookie may carry either. */
export function resolveCampaign(idOrSlug) {
  if (!idOrSlug) return null;
  return getCampaign(idOrSlug) || getCampaignBySlug(idOrSlug);
}

export function countCampaigns() {
  return db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n;
}

/**
 * @param fields.dmPassword  plaintext; hashed here so no caller handles hashes
 */
export function createCampaign(fields = {}) {
  const id = fields.id || crypto.randomUUID();
  const name = String(fields.name || '').trim() || 'Untitled Campaign';
  const slug = uniqueSlug(fields.slug || name, id);
  db.prepare(`
    INSERT INTO campaigns (id, name, slug, description, dmPasswordHash, coverUrl, coverThumb, coverMedium, isActive, sortOrder, createdAt, lastPlayedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, slug,
    String(fields.description || ''),
    fields.dmPassword ? hashPassword(fields.dmPassword) : (fields.dmPasswordHash || ''),
    String(fields.coverUrl || ''), String(fields.coverThumb || ''), String(fields.coverMedium || ''),
    fields.isActive === false ? 0 : 1,
    fields.sortOrder ?? 0,
    fields.createdAt || new Date().toISOString(),
    '',
  );
  return getCampaign(id);
}

const UPDATABLE = new Set(['name', 'description', 'coverUrl', 'coverThumb', 'coverMedium', 'isActive', 'sortOrder']);

export function updateCampaign(id, fields = {}) {
  const patch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!UPDATABLE.has(k)) continue;
    patch[k] = (k === 'isActive') ? (v ? 1 : 0) : v;
  }
  // Renaming re-derives the slug so campaign URLs stay readable.
  if (patch.name != null) {
    patch.name = String(patch.name).trim() || 'Untitled Campaign';
    patch.slug = uniqueSlug(patch.name, id);
  }
  if (Object.keys(patch).length === 0) return getCampaign(id);
  const sets = Object.keys(patch).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE campaigns SET ${sets} WHERE id = ?`).run(...Object.values(patch), id);
  return getCampaign(id);
}

// ── Verified-password cache ───────────────────────────────────────────────────
// The DM password is checked on EVERY authenticated request (~100 call sites),
// and scrypt is deliberately slow — verifying it per request would add ~50ms to
// every DM action. Successful verifications are therefore memoised for a few
// minutes, keyed by a SHA-256 of campaign+password so no plaintext sits in the
// map. Only positives are cached: a wrong password always pays full scrypt cost,
// and changing the password drops the campaign's entries immediately.
const PW_CACHE_TTL_MS = 5 * 60 * 1000;
const PW_CACHE_MAX = 200;
const _pwCache = new Map();   // key -> { campaignId, expires }

function pwCacheKey(id, plaintext) {
  return crypto.createHash('sha256').update(`${id}\0${plaintext}`).digest('hex');
}
function pwCacheSweep() {
  const now = Date.now();
  for (const [k, v] of _pwCache) if (v.expires <= now) _pwCache.delete(k);
  if (_pwCache.size > PW_CACHE_MAX) {
    for (const k of [..._pwCache.keys()].slice(0, _pwCache.size - PW_CACHE_MAX)) _pwCache.delete(k);
  }
}
function pwCacheDrop(campaignId) {
  for (const [k, v] of _pwCache) if (v.campaignId === campaignId) _pwCache.delete(k);
}

export function setDmPassword(id, plaintext) {
  db.prepare('UPDATE campaigns SET dmPasswordHash = ? WHERE id = ?')
    .run(plaintext ? hashPassword(plaintext) : '', id);
  pwCacheDrop(id);
}

/**
 * Resolves true when `plaintext` is this campaign's DM password.
 * A campaign with no password set never authenticates — the super-admin
 * MASTER_PASSWORD is the recovery path, handled by the caller.
 *
 * ASYNC: scrypt runs off the event loop, so a wrong guess no longer freezes the
 * server for everyone else. Always await it — a Promise is truthy.
 */
export async function verifyDmPassword(id, plaintext) {
  if (!id || !plaintext) return false;
  const key = pwCacheKey(id, plaintext);
  const hit = _pwCache.get(key);
  if (hit && hit.expires > Date.now()) return true;

  const row = db.prepare('SELECT dmPasswordHash FROM campaigns WHERE id = ?').get(id);
  if (!row || !row.dmPasswordHash) return false;
  if (!(await verifyPasswordAsync(plaintext, row.dmPasswordHash))) return false;

  _pwCache.set(key, { campaignId: id, expires: Date.now() + PW_CACHE_TTL_MS });
  pwCacheSweep();
  return true;
}

export function touchCampaign(id) {
  try { db.prepare('UPDATE campaigns SET lastPlayedAt = ? WHERE id = ?').run(new Date().toISOString(), id); } catch {}
}

/** Removes the registry row only — the caller deletes the campaign's data files. */
export function deleteCampaign(id) {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  pwCacheDrop(id);
}

// ── Login audit ───────────────────────────────────────────────────────────────
// Every login outcome — success, wrong password, wrong captcha answer, lockout,
// logout, first password set — across every campaign. Read by the super-admin
// on the maintenance page. Kept for 30 days and at most 5,000 rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    campaignId TEXT DEFAULT '',
    kind       TEXT NOT NULL,
    role       TEXT DEFAULT '',
    charId     TEXT DEFAULT '',
    charName   TEXT DEFAULT '',
    ip         TEXT DEFAULT '',
    userAgent  TEXT DEFAULT ''
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_auth_events_ts ON auth_events(ts)');

const AUDIT_KEEP_MS   = 30 * 24 * 60 * 60 * 1000;
const AUDIT_KEEP_ROWS = 5000;
let _auditWrites = 0;

/** Never throws: failing to log a login must not fail the login. */
export function recordAuthEvent(ev = {}) {
  try {
    db.prepare(`INSERT INTO auth_events (ts, campaignId, kind, role, charId, charName, ip, userAgent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      Number(ev.ts) || Date.now(),
      String(ev.campaignId || '').slice(0, 64),
      String(ev.kind || '').slice(0, 32),
      String(ev.role || '').slice(0, 16),
      String(ev.charId || '').slice(0, 64),
      String(ev.charName || '').slice(0, 128),
      String(ev.ip || '').slice(0, 64),
      String(ev.userAgent || '').slice(0, 256),
    );
    if (++_auditWrites % 50 === 0) pruneAuthEvents();
  } catch (err) {
    console.warn('[auth] could not record a login event:', err.message);
  }
}

export function pruneAuthEvents(now = Date.now()) {
  db.prepare('DELETE FROM auth_events WHERE ts < ?').run(now - AUDIT_KEEP_MS);
  db.prepare('DELETE FROM auth_events WHERE id <= (SELECT id FROM auth_events ORDER BY id DESC LIMIT 1 OFFSET ?)')
    .run(AUDIT_KEEP_ROWS);
}

/** Newest first; `offset` pages back through the log (the maintenance page). */
export function listAuthEvents({ limit = 200, offset = 0 } = {}) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  return db.prepare('SELECT * FROM auth_events ORDER BY id DESC LIMIT ? OFFSET ?').all(n, skip);
}

export function countAuthEvents() {
  return db.prepare('SELECT COUNT(*) AS n FROM auth_events').get().n;
}

/** The newest login event from one address — the "last browser" on the maintenance page. */
export function lastAuthEventForIp(ip) {
  if (!ip) return null;
  return db.prepare('SELECT ts, userAgent, kind FROM auth_events WHERE ip = ? ORDER BY id DESC LIMIT 1')
    .get(String(ip)) || null;
}

export const _db = db;
