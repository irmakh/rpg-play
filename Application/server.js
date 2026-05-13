import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as sdb from './db/storiesdb.js';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';

import registerAuth       from './server/routes/auth.js';
import registerCharacters from './server/routes/characters.js';
import registerShop       from './server/routes/shop.js';
import registerLoot       from './server/routes/loot.js';
import registerInitiative from './server/routes/initiative.js';
import registerChat       from './server/routes/chat.js';
import registerMonsters   from './server/routes/monsters.js';
import registerEvents     from './server/routes/events.js';
import registerBackup     from './server/routes/backup.js';
import registerTable      from './server/routes/table.js';
import registerSound      from './server/routes/sound.js';
import registerStories    from './server/routes/stories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── DB provider selection ─────────────────────────────────────────────────────
const DB_PROVIDER = (process.env.DB_PROVIDER || 'instantdb').trim().toLowerCase();

let idb = null;
let ldb = null;
let _idbGenId;

if (DB_PROVIDER === 'localdb') {
  ldb = await import('./db/localdb.js');
} else {
  const { init, id: _gid } = await import('@instantdb/admin');
  _idbGenId = _gid;
  const APP_ID      = process.env.INSTANT_APP_ID || '78945351-e9c4-4172-adac-b6c4b481a73f';
  const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
  if (!ADMIN_TOKEN) { console.error('INSTANT_ADMIN_TOKEN env var is required when DB_PROVIDER=instantdb'); process.exit(1); }
  idb = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
}

function genId() {
  return DB_PROVIDER === 'localdb' ? crypto.randomUUID() : _idbGenId();
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

// ── SQLite: shared media ──────────────────────────────────────────────────────
const mediaDb = new Database(path.join(__dirname, 'media.db'));
mediaDb.pragma('journal_mode = DELETE');
mediaDb.exec(`
  CREATE TABLE IF NOT EXISTS shared_media (
    id        TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    data      BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
try { mediaDb.exec(`ALTER TABLE shared_media ADD COLUMN thumb_data  TEXT DEFAULT ''`); } catch {}
try { mediaDb.exec(`ALTER TABLE shared_media ADD COLUMN medium_data TEXT DEFAULT ''`); } catch {}
const SHARED_MEDIA_MAX = 50;
const _mediaInsert = mediaDb.prepare('INSERT INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
const _mediaUpsert = mediaDb.prepare('INSERT OR REPLACE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
const _mapUpsert   = _mediaUpsert;
const _mediaGet    = mediaDb.prepare('SELECT mime_type, data FROM shared_media WHERE id = ?');
const _mediaCount  = mediaDb.prepare('SELECT COUNT(*) as c FROM shared_media');
const _mediaOldest = mediaDb.prepare('DELETE FROM shared_media WHERE id = (SELECT id FROM shared_media ORDER BY created_at ASC LIMIT 1)');
function insertSharedMedia(id, mimeType, buf) {
  _mediaInsert.run(id, mimeType, buf, Date.now());
  if (_mediaCount.get().c > SHARED_MEDIA_MAX) _mediaOldest.run();
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || '15243';

function isMasterPassword(pw) {
  if (!MASTER_PASSWORD || !pw || pw.length !== MASTER_PASSWORD.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(MASTER_PASSWORD));
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch { return false; }
}
function masterAuth(req) {
  const pw = req.headers['x-master-password'];
  return pw && isMasterPassword(pw);
}

async function getCharacter(charId) {
  if (DB_PROVIDER === 'localdb') return ldb.getCharacter(charId);
  const result = await idb.query({ characters: { $: { where: { id: charId } } } });
  return result.characters?.[0] || null;
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

function broadcast(eventName, payload = {}) {
  const sseMsg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(sseMsg); } catch { sseClients.delete(res); }
  }
  if (DB_PROVIDER === 'localdb') {
    const wsMsg = JSON.stringify({ event: eventName, data: payload });
    for (const ws of [...wsClients]) {
      if (ws.readyState === 1) ws.send(wsMsg);
      else wsClients.delete(ws);
    }
  }
}

// ── Shop helpers ──────────────────────────────────────────────────────────────
const SHOP_CONFIG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

async function getShopConfig() {
  try {
    if (DB_PROVIDER === 'localdb') {
      const cfg = ldb.getShopConfig();
      return { isOpen: !!cfg.isOpen, activeTag: cfg.activeTag || '' };
    }
    const result = await idb.query({ shopConfig: { $: { where: { id: SHOP_CONFIG_ID } } } });
    const cfg = result.shopConfig?.[0];
    return cfg ? { isOpen: !!cfg.isOpen, activeTag: cfg.activeTag || '' } : { isOpen: true, activeTag: '' };
  } catch { return { isOpen: true, activeTag: '' }; }
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

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '200mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), {
  maxAge: '5m', etag: true, lastModified: true,
}));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/gaston.xml', (req, res) => res.sendFile(path.join(__dirname, 'gaston.xml')));

// ── Config endpoint ───────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json({ dbProvider: DB_PROVIDER, wsUrl: process.env.WS_URL || null }));

// ── SSE endpoint ──────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); sseClients.delete(res); }
  }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
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

// ── In-memory chat log (instantdb mode) ──────────────────────────────────────
const chatLog = [];
const CHAT_MAX = 100;

// ── Shared context for all route modules ─────────────────────────────────────
const ctx = {
  // DB
  ldb, idb, DB_PROVIDER, genId,
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
  getShopConfig, shopObjFromRecord, deductCurrency, cpToGpString, SHOP_CONFIG_ID,
  // Constants
  UPLOADS_DIR, STORIES_DIR, STORY_IMAGES_DIR,
  ALLOWED_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES, IMAGE_MIME,
  // Stories DB
  sdb,
  // In-memory state
  chatLog, CHAT_MAX,
  // Node modules
  sharp, crypto, path, fs, express, __dirname,
};

// ── Register all route modules ────────────────────────────────────────────────
registerAuth(app, ctx);
registerCharacters(app, ctx);
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

if (DB_PROVIDER === 'localdb') {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', ws => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
}

httpServer.listen(PORT, () => {
  const proto = useSSL ? 'HTTPS' : 'HTTP';
  console.log(`${proto} server listening on port ${PORT} [${DB_PROVIDER}]`);
});

if (useSSL) {
  const redirectServer = createHttpServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  });
  redirectServer.listen(HTTP_PORT, () => console.log(`HTTP redirect listening on port ${HTTP_PORT}`));
}
