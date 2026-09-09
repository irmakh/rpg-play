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
import { hashPassword, verifyPassword } from './lib/passwords.js';
import {
  requestContext, currentCampaignId, currentCampaign,
  ldb as ldbProxy, sdb as sdbProxy, adb as adbProxy,
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
import makeNotify         from './server/notify.js';
import registerAiDM      from './aiDM/routes.js';

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
bootstrapCampaigns({ defaultDmPassword: process.env.MASTER_PASSWORD || '15243' });

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

function genId() {
  return crypto.randomUUID();
}

// ── File-based upload storage ─────────────────────────────────────────────────
const UPLOADS_DIR      = path.join(__dirname, 'public', 'uploads');
const STORIES_DIR      = path.join(__dirname, 'stories');
const STORY_IMAGES_DIR = path.join(__dirname, 'public', 'story-images');
fs.mkdirSync(STORIES_DIR, { recursive: true });
fs.mkdirSync(STORY_IMAGES_DIR, { recursive: true });

function readUploadAsBase64(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return null;
  try { return fs.readFileSync(path.join(__dirname, 'public', fileUrl)).toString('base64'); } catch { return null; }
}
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a', 'video/mpeg': 'mpeg' };
function mimeToExt(mimeType) { return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'bin'; }
function saveUploadFile(subdir, id, mimeType, b64) {
  const filename = `${id}.${mimeToExt(mimeType)}`;
  const dir = path.join(UPLOADS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
  return `/uploads/${subdir}/${filename}`;
}
function deleteUploadFile(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
  try { fs.unlinkSync(path.join(__dirname, 'public', fileUrl)); } catch {}
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT_TO_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
function extToMime(fileUrl) {
  return EXT_TO_MIME[path.extname(fileUrl || '').slice(1).toLowerCase()] || 'image/jpeg';
}

async function processImageSizes(mimeType, buffer, subdir, baseId) {
  const dir = path.join(UPLOADS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const origExt  = mimeToExt(mimeType);
  const origFile = `${baseId}.${origExt}`;
  fs.writeFileSync(path.join(dir, origFile), buffer);
  const thumbFile  = `${baseId}_thumb.webp`;
  const mediumFile = `${baseId}_medium.webp`;
  await sharp(buffer).resize(80, 80, { fit: 'cover', position: 'center' }).webp({ quality: 80 }).toFile(path.join(dir, thumbFile));
  await sharp(buffer).resize(500, 500, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(dir, mediumFile));
  return {
    original: `/uploads/${subdir}/${origFile}`,
    thumb:    `/uploads/${subdir}/${thumbFile}`,
    medium:   `/uploads/${subdir}/${mediumFile}`,
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
// isMasterPassword() keeps its old name and signature so the ~100 masterAuth()
// call sites across the route modules did not have to change; it now answers
// "is this the DM of the campaign this request belongs to?".
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || '15243';

function isSuperAdminPassword(pw) {
  if (!MASTER_PASSWORD || !pw || pw.length !== MASTER_PASSWORD.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(MASTER_PASSWORD)); }
  catch { return false; }
}

function isMasterPassword(pw, campaignId = currentCampaignId()) {
  if (!pw) return false;
  if (isSuperAdminPassword(pw)) return true;
  if (!campaignId) return false;
  return cdb.verifyDmPassword(campaignId, pw);
}

function masterAuth(req) {
  const pw = req.headers['x-master-password'];
  return !!(pw && isMasterPassword(pw, campaignIdFromReq(req) || currentCampaignId()));
}

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

async function charAuth(charId, req) {
  const char = await getCharacter(charId);
  if (!char) return 404;
  if (char.passwordHash) {
    const pw = req.headers['x-character-password'];
    if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw))) return 401;
  }
  return 200;
}

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
 * @param {object}  [opts]
 * @param {boolean} [opts.dmOnly]  Deliver only to clients that connected as the
 *   DM. Used while a waiting screen is up, so the DM rearranging the map does
 *   not stream to the players being held on the image.
 *
 *   Note what this is and is not: `role` comes from a query parameter the
 *   client supplies (clientMetaFromReq), so it routes honest clients and
 *   nothing more. The real guarantee is on the authenticated paths — the map
 *   and the table payload are gated on the DM password, so a crafted socket
 *   claiming role=dm still cannot fetch either.
 */
function broadcast(eventName, payload = {}, campaignId = currentCampaignId(), opts = {}) {
  const dmOnly = !!opts.dmOnly;
  const sseMsg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    if (res._meta?.campaignId !== campaignId) continue;
    if (dmOnly && res._meta?.role !== 'dm') continue;
    try { res.write(sseMsg); } catch { sseClients.delete(res); }
  }
  const wsMsg = JSON.stringify({ event: eventName, data: payload });
  for (const ws of [...wsClients]) {
    if (ws.readyState !== 1) { wsClients.delete(ws); continue; }
    if (ws._meta?.campaignId !== campaignId) continue;
    if (dmOnly && ws._meta?.role !== 'dm') continue;
    ws.send(wsMsg);
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
const FRONTEND_VERSION = 148;

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '200mb' }));

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
  /^\/api\/maintenance\//,   // server-wide admin, gated by the super-admin password
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

// The map file is NOT campaign-scoped — UPLOADS_DIR is one shared directory and
// every campaign writes the same table-map.<ext>. So one campaign being parked
// closes the path for all of them, which is the safe reading while that remains
// true. A request that resolved no campaign cannot be attributed at all, which
// is the other reason this gate is global rather than per campaign.
const TABLE_MAP_FILE = /^\/maps\/table-map\.[A-Za-z0-9]+$/;
app.use('/uploads', (req, res, next) => {
  if (parkedCampaigns.size > 0 && TABLE_MAP_FILE.test(req.path)) {
    return res.status(403).send('Map unavailable');
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
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip  = (TRUST_PROXY && xff) ? xff : (req.socket?.remoteAddress || '');
  const loginAt = q.loginAt ? (parseInt(q.loginAt) || null) : null;
  // Which campaign this client is watching — broadcast() only reaches matching clients.
  const campaign = resolveCampaignForReq(req);
  return {
    ip:        _cap(ip, 64),
    transport,
    campaignId:   campaign ? campaign.id : null,
    campaignName: campaign ? campaign.name : '',
    connectedAt: Date.now(),
    loginAt,
    page:      _cap(q.page, 256),
    role:      _cap(q.role || 'none', 16),  // 'dm' | 'character' | 'none'
    charId:    _cap(q.charId, 64),
    charName:  _cap(q.charName, 128),
    ver:       _cap(q.ver, 16),             // frontend version the client loaded
    userAgent: _cap(req.headers['user-agent'], 512),
  };
}

// ── SSE endpoint ──────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  res._meta = clientMetaFromReq(req, 'sse');
  sseClients.add(res);
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); sseClients.delete(res); }
  }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ── Maintenance: list all connected real-time clients (DM-only) ───────────────
// Backs the hidden maintenance.html page. Requires the DM master password on
// every request — never trust the client gate alone.
// SUPER-ADMIN, not campaign DM: this page lists every connected client across
// every campaign, so a single campaign's DM password must not open it.
app.get('/api/maintenance/clients', (req, res) => {
  if (!isSuperAdminPassword(req.headers['x-master-password'])) {
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
  if (!isSuperAdminPassword(req.headers['x-master-password'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const mode = req.body && req.body.mode === 'outdated' ? 'outdated' : 'all';
  broadcastAll('force-reload', { mode, version: FRONTEND_VERSION });
  res.json({ ok: true, mode, version: FRONTEND_VERSION });
});

// ── Console relay ─────────────────────────────────────────────────────────────
app.get('/api/console/events', (req, res) => {
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
  const d = req.body;
  if (!d || !d.type) return res.status(400).json({ error: 'missing type' });
  const msg = `data: ${JSON.stringify(d)}\n\n`;
  for (const client of [...consoleSseClients]) {
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
  // Auth
  masterAuth, charAuth, getCharacter,
  isMasterPassword, hashPassword, verifyPassword,
  // File helpers
  processImageSizes, saveUploadFile, deleteUploadFile, readUploadAsBase64,
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
  isSuperAdminPassword, broadcastAll, CAMPAIGN_COOKIE, FRONTEND_VERSION,
  // Waiting screens — the static-mount gate above reads this Set.
  parkedCampaigns,
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
registerAiDM(app, ctx);

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

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws, req) => {
  ws._meta = clientMetaFromReq(req, 'ws');
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

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
