// Written by Irmak Hakman — 2026-09-27 13:08

import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';

import * as cdb from './db/campaignsdb.js';
import { bootstrapCampaigns, getCampaignData } from './db/campaign-store.js';
import { hashPasswordAsync, verifyPasswordAsync } from './lib/passwords.js';
import { createCaptchaStore } from './lib/captcha.js';
import { createLoginGuard, clientIp } from './lib/login-guard.js';
import { createSessionStore, createSetupTickets } from './lib/sessions.js';
import { createAuth } from './lib/auth.js';
import { securityHeaders, jsonBody, bodyErrors, sessionGate } from './lib/security-middleware.js';
import {
  requestContext, currentCampaignId, currentCampaign,
  ldb as ldbProxy, sdb as sdbProxy,
  mediaDb as mediaDbProxy, mediaGet as mediaGetProxy,
  mapUpsert as mapUpsertProxy, insertSharedMedia,
} from './lib/request-context.js';

import registerCampaigns  from './server/routes/campaigns.js';
import registerAuth       from './server/routes/auth.js';
import registerCharacters from './server/routes/characters.js';
import registerShop       from './server/routes/shop.js';
import registerLoot       from './server/routes/loot.js';
import registerTreasury   from './server/routes/treasury.js';
import registerInitiative from './server/routes/initiative.js';
import registerChat       from './server/routes/chat.js';
import registerMonsters   from './server/routes/monsters.js';
import registerEvents     from './server/routes/events.js';
import registerBackup     from './server/routes/backup.js';
import registerTable      from './server/routes/table.js';
import registerSound      from './server/routes/sound.js';
import registerStories    from './server/routes/stories.js';
import registerHandouts   from './server/routes/handouts.js';
import registerNotifs     from './server/routes/notifications.js';
import registerMaintenance from './server/routes/maintenance.js';
import makeNotify         from './server/notify.js';
// The AI DM was retired in v236 and its code moved, unchanged, to
// retired/aiDM/ at the repo root — outside Application/, so it no longer
// deploys. It is not registered: none of its /ai-dm or /api/ai-dm routes exist.
import { resolveUploadPath, mimeToExt, safeFileId } from './lib/upload-paths.js';
import { identityFromSession, payloadFor, tokenFromQuery } from './lib/realtime-audience.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Database ──────────────────────────────────────────────────────────────────
// One backend: per-campaign SQLite. The hosted InstantDB alternative that used
// to sit behind a DB_PROVIDER switch is gone — it had drifted years behind
// (handouts, notifications, weather, calendar events, drawings and prepared
// maps were never implemented there) and nothing ran it.
const _legacyProvider = (process.env.DB_PROVIDER || '').trim().toLowerCase();
if (_legacyProvider && _legacyProvider !== 'localdb') {
  console.warn(`DB_PROVIDER=${_legacyProvider} is ignored — this build has only the local SQLite backend.`);
}

// Campaign data is reached through request-scoped proxies, never a module-level
// handle — see lib/request-context.js. `ldb` therefore resolves to whichever
// campaign the in-flight request belongs to.
const ldb = ldbProxy;

// Nothing to open here: db/campaign-store.js opens each campaign's files on
// first use. Bootstrap creates the first campaign and migrates the
// pre-multi-tenant databases into it (no-op once a campaign exists).
// No default password: a fresh install without MASTER_PASSWORD gets a first
// campaign with no DM password, which nobody can log into until one is set —
// better than a password everyone who can read this file already knows.
bootstrapCampaigns({ defaultDmPassword: process.env.MASTER_PASSWORD || '' });

/**
 * Re-derive which campaigns are parked on a waiting screen.
 *
 * A restart must not un-park a table: the DM could be mid-break with the map
 * half rearranged, and the players' next page load would otherwise show it.
 * table_state holds the truth, so read it back for every campaign at boot
 * rather than waiting for the first client fetch to reconcile.
 */
function reconcileParkedCampaigns() {
  try {
    for (const c of cdb.listCampaigns()) {
      try {
        const st = getCampaignData(c.id).ldb.getTableState();
        if (st && st.waitingScreenId) parkedCampaigns.add(c.id);
      } catch {}
    }
  } catch {}
}

/**
 * Move each campaign's table map onto its own filename.
 *
 * Every campaign used to write public/uploads/maps/table-map.<ext>, one shared
 * file: whoever loaded a map last overwrote the others, and deleting one
 * campaign's map deleted everyone's. Existing rows still point at that shared
 * name, so give each campaign its own copy and repoint its row.
 *
 * The old file is COPIED, not moved — two campaigns pointing at it must each end
 * up with their own, and leaving it behind costs one stale file and keeps any
 * reference that has not been migrated working.
 */
function migrateTableMapFiles() {
  const LEGACY = /^\/uploads\/maps\/table-map(\.[A-Za-z0-9]+)$/;
  let moved = 0;
  try {
    for (const c of cdb.listCampaigns()) {
      try {
        // openMediaDb() returns a small facade; `.db` is the better-sqlite3 handle.
        const mdb = getCampaignData(c.id).mdb.db;
        const row = mdb.prepare('SELECT data FROM shared_media WHERE id = ?').get('table-map');
        if (!row) continue;
        const ref = row.data.toString();
        if (!ref.startsWith('FILE:')) continue;             // inline blob: nothing on disk
        const m = LEGACY.exec(ref.slice(5));
        if (!m) continue;                                    // already per-campaign
        const destRel = `/uploads/maps/table-map-${c.id}${m[1]}`;
        const src  = path.join(__dirname, 'public', ref.slice(5));
        const dest = path.join(__dirname, 'public', destRel);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
        else if (!fs.existsSync(dest)) continue;             // source gone; leave the row alone
        mdb.prepare('UPDATE shared_media SET data = ? WHERE id = ?')
           .run(Buffer.from('FILE:' + destRel), 'table-map');
        moved++;
      } catch (err) {
        // Reported, not swallowed: a silent skip here looks exactly like
        // "nothing needed migrating", which hid this very function failing.
        console.warn(`[maps] could not migrate table map for campaign ${c.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[maps] table map migration skipped:', err.message);
  }
  if (moved) console.log(`[maps] gave ${moved} campaign table map(s) their own file`);
}

function genId() {
  return crypto.randomUUID();
}

// ── File-based upload storage ─────────────────────────────────────────────────
const UPLOADS_DIR      = path.join(__dirname, 'public', 'uploads');
const STORIES_DIR      = path.join(__dirname, 'stories');
const STORY_IMAGES_DIR = path.join(__dirname, 'public', 'story-images');
fs.mkdirSync(STORIES_DIR, { recursive: true });
fs.mkdirSync(STORY_IMAGES_DIR, { recursive: true });

/**
 * The file behind an upload URL, if this campaign may touch it — see
 * lib/upload-paths.js. Every read, write and delete below goes through this;
 * a URL is data from a database or a backup, never a path to be trusted.
 */
function uploadPath(fileUrl, forWrite = false) {
  let campaignId = '';
  try { campaignId = String(currentCampaignId() || ''); } catch {}
  return resolveUploadPath(UPLOADS_DIR, fileUrl, { campaignId, forWrite });
}

// Used by backup EXPORT. Unchecked, a record pointing at '/uploads/../../.env'
// copied the server's secrets into the next backup the DM downloaded.
function readUploadAsBase64(fileUrl) {
  const abs = uploadPath(fileUrl);
  if (!abs) return null;
  try { return fs.readFileSync(abs).toString('base64'); } catch { return null; }
}

/**
 * Where a NEW upload goes: uploads/<campaignId>/<subdir>/.
 *
 * public/uploads/ was one directory shared by every campaign, which is what let
 * two campaigns overwrite each other's table map, let deleting one campaign's
 * map delete another's file, and forced the parked-table gate to be global
 * because a bare static request could not be attributed to a campaign.
 *
 * Only new writes are placed here. Existing files keep working untouched: every
 * stored reference is a full path (/uploads/maps/x.png), so an old URL resolves
 * exactly as before and nothing has to be migrated for correctness.
 *
 * An upload always happens inside a request, so the campaign resolves; the
 * fallback to the flat layout covers anything that somehow runs outside one,
 * which is the old behaviour and therefore safe.
 */
function uploadSubPath(subdir) {
  let cid = '';
  try { cid = String(currentCampaignId() || ''); } catch {}
  cid = cid.replace(/[^A-Za-z0-9._-]/g, '');
  return cid ? `${cid}/${subdir}` : subdir;
}

// mimeToExt() lives in lib/upload-paths.js: a fixed table, 'bin' for anything
// else. It used to fall back to the MIME type's own second half, so a restored
// record claiming 'text/html' produced an .html file served from this origin.
//
// The id becomes the filename, so it is reduced to [A-Za-z0-9_-] first — a
// restored backup supplies it, and '../../server' used to be a valid one.
function saveUploadFile(subdir, id, mimeType, b64) {
  const safeId = safeFileId(id);
  if (!safeId) throw new Error('Invalid upload id');
  const filename = `${safeId}.${mimeToExt(mimeType)}`;
  const rel = uploadSubPath(subdir);
  const dir = path.join(UPLOADS_DIR, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
  return `/uploads/${rel}/${filename}`;
}
function deleteUploadFile(fileUrl) {
  const abs = uploadPath(fileUrl);
  if (!abs) return;              // outside uploads, or another campaign's file
  try { fs.unlinkSync(abs); } catch {}
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT_TO_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
function extToMime(fileUrl) {
  return EXT_TO_MIME[path.extname(fileUrl || '').slice(1).toLowerCase()] || 'image/jpeg';
}

async function processImageSizes(mimeType, buffer, subdir, rawBaseId) {
  // Restore derives the base id from a URL inside the backup; same rule as
  // saveUploadFile — it becomes a filename, so nothing but [A-Za-z0-9_-].
  const baseId = safeFileId(rawBaseId);
  if (!baseId) throw new Error('Invalid upload id');
  const rel = uploadSubPath(subdir);          // per-campaign; see uploadSubPath
  const dir = path.join(UPLOADS_DIR, rel);
  fs.mkdirSync(dir, { recursive: true });
  const origExt  = mimeToExt(mimeType);
  const origFile = `${baseId}.${origExt}`;
  fs.writeFileSync(path.join(dir, origFile), buffer);
  const thumbFile  = `${baseId}_thumb.webp`;
  const mediumFile = `${baseId}_medium.webp`;
  await sharp(buffer).resize(80, 80, { fit: 'cover', position: 'center' }).webp({ quality: 80 }).toFile(path.join(dir, thumbFile));
  await sharp(buffer).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(dir, mediumFile));
  return {
    original: `/uploads/${rel}/${origFile}`,
    thumb:    `/uploads/${rel}/${thumbFile}`,
    medium:   `/uploads/${rel}/${mediumFile}`,
  };
}

// ── Shared media ──────────────────────────────────────────────────────────────
// Each campaign has its own media.db (db/mediadb.js); these are request-scoped
// proxies onto the current campaign's handle and prepared statements.
const mediaDb   = mediaDbProxy;
const _mediaGet = mediaGetProxy;
const _mapUpsert = mapUpsertProxy;

// ── Auth helpers ──────────────────────────────────────────────────────────────
// Two levels of DM authority:
//
//   Super-admin  MASTER_PASSWORD env var. Unlocks every campaign and is the
//                only key that may create or delete campaigns. Also the
//                recovery path when a campaign's DM password is lost.
//   Campaign DM  Per-campaign password hashed in campaigns.db. This is what a
//                DM actually logs in with, and it grants nothing outside their
//                own campaign.
//
// Passwords are checked ONLY at login (server/routes/auth.js — captcha, lockout,
// async scrypt). Every other request carries a SESSION TOKEN in the same two
// headers that used to carry the password, and masterAuth()/charAuth() accept
// nothing else — see lib/auth.js. masterAuth keeps its name, signature and sync
// return, so the ~100 call sites in the route modules did not change.
//
// No fallback: with MASTER_PASSWORD unset the super-admin is simply disabled.
// A default baked into the source is a password everyone who reads it knows.
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || '';
const SUPER_ADMIN_ENABLED = !!MASTER_PASSWORD;
if (!SUPER_ADMIN_ENABLED) {
  console.warn('[auth] MASTER_PASSWORD is not set - the super-admin is DISABLED '
    + '(no creating or deleting campaigns, no maintenance page).');
}

function isSuperAdminPassword(pw) {
  if (!MASTER_PASSWORD || typeof pw !== 'string' || pw.length !== MASTER_PASSWORD.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(MASTER_PASSWORD)); }
  catch { return false; }
}

/**
 * Resolves true for this campaign's DM password or the super-admin's.
 * ASYNC — always await it. It replaced the sync isMasterPassword under a NEW
 * name on purpose: a forgotten `await` tests a Promise, which is truthy and lets
 * anyone in; with the old name gone, a missed call site fails loudly instead.
 */
async function checkDmPassword(pw, campaignId = currentCampaignId()) {
  if (!pw || typeof pw !== 'string') return false;
  if (isSuperAdminPassword(pw)) return true;
  if (!campaignId) return false;
  return cdb.verifyDmPassword(campaignId, pw);
}

// ── Sessions, captcha, lockout ────────────────────────────────────────────────
const sessions     = createSessionStore(cdb._db);   // table `sessions` in campaigns.db
const setupTickets = createSetupTickets();
const captcha      = createCaptchaStore();
const loginGuard   = createLoginGuard();
const audit = {
  record: cdb.recordAuthEvent, list: cdb.listAuthEvents, count: cdb.countAuthEvents,
  lastForIp: cdb.lastAuthEventForIp,
};

const auth = createAuth({
  sessions,
  campaignIdFromReq: req => campaignIdFromReq(req) || currentCampaignId(),
  getCharacter: id => getCharacter(id),
});
const masterAuth = auth.masterAuth;
const charAuth   = auth.charAuth;
const sessionAuth = auth.sessionAuth;

// Expired sessions, captchas, tickets and lock records go every few minutes.
setInterval(() => {
  try { sessions.sweep(); } catch (err) { console.warn('[auth] session sweep failed:', err.message); }
  captcha.sweep(); loginGuard.sweep(); setupTickets.sweep();
}, 5 * 60 * 1000).unref();

// ── Campaign resolution ───────────────────────────────────────────────────────
// Which campaign is this request for? Checked in order:
//
//   1. X-Campaign-Id header  — explicit, lets a tool or a future per-tab client
//                              override the cookie
//   2. ?campaign= query      — used by the SSE / WebSocket URLs, which cannot
//                              set headers
//   3. campaign cookie       — the normal path, set when you enter a campaign.
//                              A cookie is what keeps all ~276 existing frontend
//                              fetch() calls working untouched.
//   4. the only campaign     — a single-campaign install behaves exactly as it
//                              did before campaigns existed. Stops applying the
//                              moment a second campaign is created.
//
// The value may be an id or a slug; both resolve.
export const CAMPAIGN_COOKIE = 'campaign';

function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return part.slice(eq + 1).trim(); }
  }
  return '';
}

function campaignHintFromReq(req) {
  const header = req.headers?.['x-campaign-id'];
  if (header) return String(header);
  let q = req.query;
  if (!q || !Object.keys(q).length) {
    // WebSocket upgrades never reach express's query parser.
    try { q = Object.fromEntries(new URL(req.url || '', 'http://x').searchParams); } catch { q = {}; }
  }
  if (q.campaign) return String(q.campaign);
  return readCookie(req, CAMPAIGN_COOKIE);
}

function resolveCampaignForReq(req) {
  const hint = campaignHintFromReq(req);
  if (hint) {
    const found = cdb.resolveCampaign(hint);
    if (found) return found;
  }
  const all = cdb.listCampaigns();
  return all.length === 1 ? all[0] : null;
}

function campaignIdFromReq(req) {
  const c = resolveCampaignForReq(req);
  return c ? c.id : null;
}

async function getCharacter(charId) {
  return ldb.getCharacter(charId);
}

// charAuth() lives in lib/auth.js — created above, beside the session store.

// ── SSE + WebSocket real-time broadcast ───────────────────────────────────────
const sseClients     = new Set();
const wsClients      = new Set();
const consoleSseClients = new Set();

/**
 * Sends an event to the real-time clients of ONE campaign.
 *
 * The campaign defaults to the one the in-flight request belongs to, so the
 * ~130 existing `broadcast('token-updated', ...)` calls became campaign-scoped
 * without changing a single call site.
 *
 * Clients that never told us their campaign receive nothing. That is the safe
 * default: a client with an unknown campaign is more likely a stale tab than a
 * legitimate listener, and leaking another campaign's table state is worse than
 * a missed refresh.
 */
/**
 * @param {object}  [opts]  who receives it — see payloadFor() in
 *   lib/realtime-audience.js, which decides per connection:
 *   dmOnly     only this campaign's DM (or the super-admin)
 *   to         only these notification keys ('dm' or character ids)
 *   forOthers  what the connections left out by dmOnly get instead
 *   alsoFor    one character let through dmOnly (a hidden token's owner)
 *
 * Every connection's identity comes from the session it presented (v237), so
 * these filters are enforced here, on the server. Before, dmOnly trusted a role
 * the page wrote into its own URL, and everything else went to everyone.
 */
function broadcast(eventName, payload = {}, campaignId = currentCampaignId(), opts = {}) {
  // At most two distinct payloads (the event and forOthers), so serialise each once.
  const sse = new Map(), wsm = new Map();
  const sseOf = (p) => { if (!sse.has(p)) sse.set(p, `event: ${eventName}
data: ${JSON.stringify(p)}

`); return sse.get(p); };
  const wsOf  = (p) => { if (!wsm.has(p)) wsm.set(p, JSON.stringify({ event: eventName, data: p })); return wsm.get(p); };
  for (const res of [...sseClients]) {
    const p = payloadFor(res._meta?.identity, campaignId, payload, opts);
    if (p === null) continue;
    try { res.write(sseOf(p)); } catch { sseClients.delete(res); }
  }
  for (const ws of [...wsClients]) {
    if (ws.readyState !== 1) { wsClients.delete(ws); continue; }
    const p = payloadFor(ws._meta?.identity, campaignId, payload, opts);
    if (p === null) continue;
    ws.send(wsOf(p));
  }
}

/** Sends an event to every connected client regardless of campaign. */
function broadcastAll(eventName, payload = {}) {
  const sseMsg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(sseMsg); } catch { sseClients.delete(res); }
  }
  const wsMsg = JSON.stringify({ event: eventName, data: payload });
  for (const ws of [...wsClients]) {
    if (ws.readyState === 1) ws.send(wsMsg);
    else wsClients.delete(ws);
  }
}

// ── Shop helpers ──────────────────────────────────────────────────────────────
async function getShopConfig() {
  try {
    const cfg = ldb.getShopConfig();
    return { isOpen: !!cfg.isOpen, activeTag: cfg.activeTag || '', activeTags: cfg.activeTags || [] };
  } catch { return { isOpen: true, activeTag: '', activeTags: [] }; }
}

function shopObjFromRecord(r) {
  let weaponProperties = [];
  try { weaponProperties = JSON.parse(r.weaponPropertiesJson || '[]'); } catch {}
  return {
    id: r.id, name: r.name,
    itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light',
    acBase: r.acBase ?? 10, valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1,
    acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0,
    spellAtkBonus: r.spellAtkBonus ?? 0, spellDcBonus: r.spellDcBonus ?? 0,
    requiresAttunement: !!r.requiresAttunement, notes: r.notes || '',
    weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '', weaponProperties,
    tag: r.tag || '',
  };
}

function deductCurrency(wallet, amountCp) {
  let remaining = wallet.cp + wallet.sp * 10 + wallet.ep * 50 + wallet.gp * 100 + wallet.pp * 1000 - amountCp;
  const pp = Math.floor(remaining / 1000); remaining -= pp * 1000;
  const gp = Math.floor(remaining / 100);  remaining -= gp * 100;
  const ep = Math.floor(remaining / 50);   remaining -= ep * 50;
  const sp = Math.floor(remaining / 10);   remaining -= sp * 10;
  return { pp, gp, ep, sp, cp: remaining };
}

function cpToGpString(valueCp) {
  if (valueCp === 0) return '0 gp';
  if (valueCp % 100 === 0) return `${valueCp / 100} gp`;
  return `${(valueCp / 100).toFixed(2)} gp`;
}

const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm']);
const SHARED_MEDIA_MIME = new Set(['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/wave','audio/vnd.wave','audio/mp4','audio/webm']);
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

// ── Frontend version ─────────────────────────────────────────────────────────
// Bump this number whenever frontend JS or CSS files change.
// Also bump CACHE in public/sw.js to the same value.
// Both must always match. See deployment notes in CLAUDE.md.
const FRONTEND_VERSION = 242;

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

// Headers on every response — lib/security-middleware.js says what each is for.
// HSTS only when this process serves HTTPS itself, decided from the same env
// vars the listener reads at the bottom of this file.
app.use(securityHeaders({ hsts: !!(process.env.SSL_KEY && process.env.SSL_CERT) }));

// Body size by caller: a live session may send up to 200 MB, anyone else 1 MB.
//
// There used to be a bigPaths exemption for /api/stories/ and /api/chat/image,
// because neither had a login. As of v233 both do, so the exemption is gone —
// an anonymous caller can no longer push a 200 MB body through the parser only
// to be refused by the route afterwards.
app.use(jsonBody({ hasSession: req => auth.hasAnySession(req) }));
app.use(bodyErrors());

// ── Campaign context ──────────────────────────────────────────────────────────
// Every request runs inside an AsyncLocalStorage store carrying its campaign and
// that campaign's database handles. This is what makes `ldb`, `sdb`, `mediaDb`
// and `broadcast()` resolve per campaign inside handlers that were written when
// there was only one.
//
// Routes that must work without a campaign selected — the registry itself and
// the config probe — are exempt. Any other /api request with no resolvable
// campaign gets 409 NO_CAMPAIGN, which the frontend turns into a redirect to
// the campaign picker.
const CAMPAIGN_EXEMPT = [
  /^\/api\/config$/,
  /^\/api\/campaigns(\/|$)/,
  /^\/api\/maintenance\//,   // server-wide admin, gated by a super-admin session
  /^\/api\/auth\/(captcha|admin-login|logout)$/,   // login plumbing with no campaign of its own
];

app.use((req, res, next) => {
  const campaign = resolveCampaignForReq(req);
  if (!campaign) {
    const isApi = req.path.startsWith('/api/');
    if (isApi && !CAMPAIGN_EXEMPT.some(re => re.test(req.path))) {
      return res.status(409).json({ error: 'No campaign selected', code: 'NO_CAMPAIGN' });
    }
    return next();   // static assets and the registry work without one
  }
  req.campaign = campaign;
  requestContext.run(
    { campaignId: campaign.id, campaign, data: getCampaignData(campaign.id) },
    next
  );
});

// A credential header holding anything but a live session for this campaign —
// an expired token, another campaign's, or the plain password a tab opened
// before v226 still keeps — gets 401 SESSION_EXPIRED, which the client's fetch
// interceptor (js/lib/realtime.js) turns into a trip to the login page.
// The login routes read no credential header, so they are left alone.
app.use(sessionGate({ auth, exempt: [/^\/api\/auth\//] }));

// ── Waiting screens: gate the table map's static URL ──────────────────────────
// While a campaign is parked on a waiting screen its players must not reach the
// map. Withholding it from GET /api/table alone would be cosmetic: the file is
// also served straight off this static mount at the fixed, guessable path
// /uploads/maps/table-map.<ext>, so the mount needs the same gate.
//
// The DM does not lose the map — while a screen is up their client fetches it
// through GET /api/table/map with the DM password, which an <img src> could
// never send, and renders it from a blob.
//
// Held in memory rather than read per request because this mount sits ahead of
// the route modules and serves every image on every page; table_state stays the
// source of truth and seeds this at boot (see reconcileParkedCampaigns below).
const parkedCampaigns = new Set();
reconcileParkedCampaigns();   // declared above; called here, after the Set exists
migrateTableMapFiles();       // one-time: shared table-map.<ext> -> per campaign

// A parked table must not leak its map, and express.static would happily serve
// the file straight off disk, so the gate has to sit in front of the mount.
//
// The campaign id is IN THE FILENAME (table-map-<id>.<ext>, written by
// tableMapFileBase() in routes/table.js), which is what lets this be decided per
// campaign: only the parked campaign's own map is refused. It used to be one
// shared table-map.<ext> for every campaign, so the gate could not tell whose
// request it was and had to close the path for everyone — one campaign parked on
// a waiting screen blanked the map on every other campaign's table.
//
// A legacy name with no campaign in it keeps the old conservative rule: it may
// belong to any campaign, so any parked campaign still closes it.
// Three layouts have to be recognised, because files written by each still exist:
//   /maps/table-map.png                  oldest — shared by every campaign
//   /maps/table-map-<id>.png             per-campaign filename
//   /<id>/maps/table-map-<id>.png        per-campaign directory (current)
// The directory names the owner when present, else the filename suffix does.
// The filename suffix excludes '.' on purpose: the extension is what a dot
// separates, so allowing dots there let "table-map-abc.png.txt" match with an
// owner of "abc.png". A campaign id is a UUID, so hex and hyphens are enough.
const TABLE_MAP_FILE = /^(?:\/([A-Za-z0-9._-]+))?\/maps\/table-map(?:-([A-Za-z0-9_-]+))?\.[A-Za-z0-9]+$/;
app.use('/uploads', (req, res, next) => {
  const m = TABLE_MAP_FILE.exec(req.path);
  if (m) {
    const owner = m[1] || m[2];
    // A name with no campaign in it could belong to any of them, so it keeps the
    // conservative rule: any parked campaign closes it.
    const blocked = owner ? parkedCampaigns.has(owner) : parkedCampaigns.size > 0;
    if (blocked) return res.status(403).send('Map unavailable');
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), {
  maxAge: '5m', etag: true, lastModified: true,
}));

// The loot and merchant managers merged into the treasury page. Redirect the
// retired URLs so bookmarks and cached PWA shells still land somewhere useful.
// Must sit ahead of the HTML middleware and express.static, which would
// otherwise keep serving the old files.
for (const legacy of ['/loot.html', '/merchant.html']) {
  app.get(legacy, (req, res) => res.redirect(301, '/treasury.html'));
}

// Inject ?v=N into all local .js and .css references in HTML pages so
// browsers always load fresh assets after a version bump.
// HTML itself is served with no-store so it is never stale.
// Directory requests ("/", "/console/") are resolved to their index.html so
// they get the same injection — otherwise express.static would serve the raw
// page with bare asset URLs that then cache `immutable` forever (this is why
// the character sheet at "/" kept loading stale JS while /table.html did not).
app.use((req, res, next) => {
  let rel = req.path;
  // The site now opens on the campaign picker: you choose a campaign before
  // anything else. The character sheet keeps its own URL (/index.html) so every
  // existing link, bookmark and PWA shortcut still resolves.
  if (rel === '/') rel = '/campaigns.html';
  else if (rel.endsWith('/')) rel += 'index.html';
  if (!rel.endsWith('.html')) return next();
  const filePath = path.join(__dirname, 'public', rel);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    const versioned = html.replace(
      /((?:src|href)=")(\/?[^"?#]+\.(js|css))(")/gi,
      (_, attr, url, _ext, close) => {
        if (/^(https?:)?\/\//i.test(url)) return `${attr}${url}${close}`;
        return `${attr}${url}?v=${FRONTEND_VERSION}${close}`;
      }
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(versioned);
  });
});

// JS and CSS are safe to cache long-term — their URLs include ?v=N which changes on every release
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath);
    if (ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('/gaston.xml', (req, res) => res.sendFile(path.join(__dirname, 'gaston.xml')));

// ── Config endpoint ───────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json({ dbProvider: 'localdb', wsUrl: process.env.WS_URL || null }));

// ── Connected-client tracking (for the hidden maintenance page) ───────────────
// Capture per-connection details when a real-time client connects. The client
// passes its identity (role / character) + current page as query params on the
// WS / SSE URL — never any password.
//
// SECURITY: X-Forwarded-For is client-controlled and MUST NOT be trusted unless
// a real reverse proxy sits in front and overwrites it. This server terminates
// TLS itself (no proxy), so we default to the real socket address and only honor
// the forwarded header when TRUST_PROXY is explicitly set. Without this, any
// client could forge the IP shown on the maintenance page.
// NOTE: under default Docker bridge networking the socket address may be the
// Docker gateway (172.x), not the real client IP — that's a network-config
// concern (host networking / userland-proxy), independent of this code.
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''));

// Length caps on stored, client-supplied metadata — guards against a client
// sending oversized values that sit in memory per connection. Display-only.
function _cap(v, n) { return String(v ?? '').slice(0, n); }

function clientMetaFromReq(req, transport) {
  let q = {};
  try {
    if (req.query && Object.keys(req.query).length) q = req.query;        // express (SSE)
    else { const u = new URL(req.url || '', 'http://x'); q = Object.fromEntries(u.searchParams); } // ws upgrade
  } catch {}
  const ip = clientIp(req, TRUST_PROXY);   // lib/login-guard.js — the same TRUST_PROXY rule
  const loginAt = q.loginAt ? (parseInt(q.loginAt) || null) : null;
  // Which campaign this client is watching — broadcast() only reaches matching clients.
  const campaign = resolveCampaignForReq(req);
  // Who is listening comes from the SESSION the connection presents (v237), not
  // from the role/charId the page puts in its own URL — those were typed by the
  // client, and the dmOnly filter used to believe them. A connection without a
  // live session for this campaign has identity null and is refused by its
  // endpoint. (The token itself is kept on the connection, never in _meta,
  // which the maintenance page lists.)
  const identity = identityFromSession(sessions.resolve(tokenFromQuery(q)), campaign ? campaign.id : '');
  return {
    ip:        _cap(ip, 64),
    transport,
    campaignId:   campaign ? campaign.id : null,
    campaignName: campaign ? campaign.name : '',
    connectedAt: Date.now(),
    loginAt,
    page:      _cap(q.page, 256),
    identity,
    role:      identity ? identity.role : 'none',    // 'dm' | 'admin' | 'character' | 'none'
    charId:    identity ? identity.charId : '',
    charName:  identity ? _cap(identity.charName, 128) : '',
    ver:       _cap(q.ver, 16),             // frontend version the client loaded
    userAgent: _cap(req.headers['user-agent'], 512),
  };
}

// ── SSE endpoint ──────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  // Login required (v237): the stream carries the table's state, and anyone
  // could open it before. The code matches the fetch interceptor's, so a page
  // whose session has lapsed goes to the login page.
  const meta = clientMetaFromReq(req, 'sse');
  if (!meta.identity) return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'SESSION_EXPIRED' });
  res._token = tokenFromQuery(req.query);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  res._meta = meta;
  sseClients.add(res);
  const hb = setInterval(() => {
    // A session ended on the maintenance page, logged out elsewhere or expired
    // stops the stream too — it used to keep flowing to an open tab forever.
    // (An open connection counts as activity for the session's idle timer.)
    if (!sessions.resolve(res._token)) {
      clearInterval(hb); sseClients.delete(res);
      try { res.end(); } catch {}
      return;
    }
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); sseClients.delete(res); }
  }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ── Maintenance: list all connected real-time clients (DM-only) ───────────────
// Backs the hidden maintenance.html page. Requires a super-admin SESSION on
// every request (POST /api/auth/admin-login) — never trust the client gate alone.
// SUPER-ADMIN, not campaign DM: this page lists every connected client across
// every campaign, so a single campaign's DM password must not open it.
app.get('/api/maintenance/clients', (req, res) => {
  if (!auth.isAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const clients = [];
  for (const ws of wsClients)  if (ws._meta)  clients.push({ ...ws._meta });
  for (const r  of sseClients) if (r._meta)   clients.push({ ...r._meta });
  clients.sort((a, b) => a.connectedAt - b.connectedAt);
  res.json({ now: Date.now(), count: clients.length, serverVersion: FRONTEND_VERSION, clients });
});

// Force connected clients to reload (pick up the latest deployed version).
// mode 'all' reloads everyone; mode 'outdated' only reloads clients whose loaded
// version differs from the current FRONTEND_VERSION (the client decides). DM-only.
// Super-admin: a forced reload hits every campaign's clients at once.
app.post('/api/maintenance/reload', (req, res) => {
  if (!auth.isAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const mode = req.body && req.body.mode === 'outdated' ? 'outdated' : 'all';
  broadcastAll('force-reload', { mode, version: FRONTEND_VERSION });
  res.json({ ok: true, mode, version: FRONTEND_VERSION });
});

// Login activity (GET /api/maintenance/auth-events) lives in
// server/routes/maintenance.js, paged, beside the blocked-address routes.

// ── Console relay ─────────────────────────────────────────────────────────────
// ── Console relay ─────────────────────────────────────────────────────────────
// Carries messages between the two console screens (table-console and
// table-secondary): which token is selected, a snapshot of the table. Until
// v237 it needed no login and every message reached every console listener in
// EVERY campaign — so two campaigns' consoles overwrote each other's second
// screen, and the DM's snapshot, hidden tokens included, went to anyone who
// opened the stream. Now both ends present a session (?token=, since neither
// EventSource nor sendBeacon can send headers) and a message reaches only the
// listeners of the same campaign and the same person: the DM's screens, or one
// character's.
function consoleIdentity(req) {
  const campaign = resolveCampaignForReq(req);
  return identityFromSession(sessions.resolve(tokenFromQuery(req.query)), campaign ? campaign.id : '');
}
const sameConsoleOwner = (a, b) => !!a && !!b && a.campaignId === b.campaignId && a.key === b.key;

app.get('/api/console/events', (req, res) => {
  const identity = consoleIdentity(req);
  if (!identity) return res.status(401).json({ error: 'Log in to use the console.', code: 'SESSION_EXPIRED' });
  res._consoleId = identity;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  consoleSseClients.add(res);
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); consoleSseClients.delete(res); }
  }, 25000);
  req.on('close', () => { clearInterval(hb); consoleSseClients.delete(res); });
});
app.post('/api/console/event', (req, res) => {
  const from = consoleIdentity(req);
  if (!from) return res.status(401).json({ error: 'Log in to use the console.' });
  const d = req.body;
  if (!d || !d.type) return res.status(400).json({ error: 'missing type' });
  // Credentials never travel through this relay. It used to carry the whole
  // session (once the plain DM password); the two console screens now share a
  // login through the browser (BroadcastChannel) instead, same device only.
  // Session messages stay refused even though the relay is login-scoped now.
  if (/^SESSION_/.test(String(d.type))) return res.status(400).json({ error: 'session messages are not relayed' });
  const msg = `data: ${JSON.stringify(d)}\n\n`;
  for (const client of [...consoleSseClients]) {
    if (!sameConsoleOwner(client._consoleId, from)) continue;
    try { client.write(msg); } catch { consoleSseClients.delete(client); }
  }
  res.json({ ok: true });
});

// ── Shared context for all route modules ─────────────────────────────────────
const ctx = {
  // DB
  ldb, genId,
  // Broadcast
  broadcast, sseClients, consoleSseClients, wsClients,
  // Auth — sessions, captcha and lockout; passwords are only checked at login
  masterAuth, charAuth, sessionAuth, getCharacter, auth,
  checkDmPassword, hashPasswordAsync, verifyPasswordAsync,
  sessions, setupTickets, captcha, loginGuard, audit, TRUST_PROXY,
  // File helpers
  processImageSizes, saveUploadFile, deleteUploadFile, readUploadAsBase64, uploadPath,
  mimeToExt, extToMime,
  // Media DB
  mediaDb, insertSharedMedia, _mediaGet, _mapUpsert,
  // Shop helpers
  getShopConfig, shopObjFromRecord, deductCurrency, cpToGpString,
  // Constants
  UPLOADS_DIR, STORIES_DIR, STORY_IMAGES_DIR,
  ALLOWED_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES, IMAGE_MIME,
  // Stories DB
  sdb: sdbProxy,
  // Campaigns
  cdb, campaignIdFromReq, currentCampaignId, currentCampaign,
  isSuperAdminPassword, superAdminEnabled: SUPER_ADMIN_ENABLED,
  broadcastAll, CAMPAIGN_COOKIE, FRONTEND_VERSION,
  // Waiting screens — the static-mount gate above reads this Set.
  parkedCampaigns,
  // A character's name from outside a request (the maintenance page names
  // locked-out accounts). Callers check the campaign still exists first:
  // getCampaignData() would otherwise provision a deleted one again.
  characterName: (campaignId, charId) => {
    try { return getCampaignData(campaignId).ldb.getCharacter(charId)?.name || ''; } catch { return ''; }
  },
  // Node modules
  sharp, crypto, path, fs, express, __dirname,
};

ctx.notify = makeNotify(ctx);

// ── Register all route modules ────────────────────────────────────────────────
registerCampaigns(app, ctx);
registerAuth(app, ctx);
registerCharacters(app, ctx);
registerTreasury(app, ctx);
// Legacy loot/shop routes stay registered for one release so clients still
// running the cached pre-treasury frontend keep working until they reload.
// They operate on the retired loot_items/shop_items tables; both are deleted
// once every client reports the new FRONTEND_VERSION.
registerShop(app, ctx);
registerLoot(app, ctx);
registerInitiative(app, ctx);
registerChat(app, ctx);
registerMonsters(app, ctx);
registerEvents(app, ctx);
registerBackup(app, ctx);
registerTable(app, ctx);
registerSound(app, ctx);
registerStories(app, ctx);
registerHandouts(app, ctx);
registerNotifs(app, ctx);
registerMaintenance(app, ctx);

// ── Server startup: HTTPS in production, plain HTTP for local dev ─────────────
const SSL_KEY  = process.env.SSL_KEY;
const SSL_CERT = process.env.SSL_CERT;
const useSSL   = !!(SSL_KEY && SSL_CERT);

const PORT      = parseInt(process.env.PORT)      || (useSSL ? 443 : 3000);
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 80;

let httpServer;
if (useSSL) {
  const sslOptions = { key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) };
  httpServer = createHttpsServer(sslOptions, app);
} else {
  httpServer = createHttpServer(app);
}

// Node gives a whole request five minutes by default, headers and body together.
// A 500 MB story video over a home connection takes longer than that, so the
// body gets an hour. Headers keep their own short limit (headersTimeout, 60 s),
// which is what guards against connections that dribble a request in slowly.
httpServer.requestTimeout = 60 * 60 * 1000;

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws, req) => {
  ws._meta = clientMetaFromReq(req, 'ws');
  // Login required (v237). 4401 tells the page its session is gone, so it
  // sends the visitor to log in instead of reconnecting every 3 seconds.
  if (!ws._meta.identity) { try { ws.close(4401, 'login required'); } catch {} return; }
  try { ws._token = tokenFromQuery(Object.fromEntries(new URL(req.url || '', 'http://x').searchParams)); } catch { ws._token = ''; }
  ws._alive = true;
  ws.on('pong', () => { ws._alive = true; });      // browsers answer ping automatically
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// ── Reaping dead sockets ─────────────────────────────────────────────────────
// A client that goes away without closing cleanly — a laptop that sleeps, a
// phone that loses signal, a desktop window killed outright — leaves its socket
// in wsClients until the OS gives up on the TCP connection, which can be hours.
// Meanwhile the client reconnects after 3 seconds and is added again, so the
// maintenance page showed the same person on the same page twice: one live row
// and one that would never leave. Ping every 30s and drop anyone who has not
// answered by the next round, so a zombie is gone within about a minute.
const WS_PING_MS = 30000;
const wsHeartbeat = setInterval(() => {
  for (const ws of [...wsClients]) {
    if (ws._alive === false) {
      wsClients.delete(ws);
      try { ws.terminate(); } catch {}
      continue;
    }
    // Same rule as the SSE heartbeat: a session that has ended closes its socket.
    if (!sessions.resolve(ws._token)) {
      wsClients.delete(ws);
      try { ws.close(4401, 'session ended'); } catch {}
      continue;
    }
    ws._alive = false;
    try { ws.ping(); } catch {
      wsClients.delete(ws);
      try { ws.terminate(); } catch {}
    }
  }
}, WS_PING_MS);
wsHeartbeat.unref?.();                                   // never hold the process open
wss.on('close', () => clearInterval(wsHeartbeat));

httpServer.listen(PORT, () => {
  const proto = useSSL ? 'HTTPS' : 'HTTP';
  console.log(`${proto} server listening on port ${PORT}`);
});

if (useSSL) {
  const redirectServer = createHttpServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  });
  redirectServer.listen(HTTP_PORT, () => console.log(`HTTP redirect listening on port ${HTTP_PORT}`));
}
