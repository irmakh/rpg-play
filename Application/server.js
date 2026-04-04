import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── DB provider selection ─────────────────────────────────────────────────────
const DB_PROVIDER = (process.env.DB_PROVIDER || 'instantdb').trim().toLowerCase();

let idb = null;   // InstantDB instance (instantdb mode only)
let ldb = null;   // LocalDB module   (localdb mode only)
let _idbGenId;    // InstantDB genId  (instantdb mode only)

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

// ── File-based upload storage ────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
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

// ── SQLite: shared media (both modes) ────────────────────────────────────────
import Database from 'better-sqlite3';

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
const sseClients = new Set();
const wsClients  = new Set();

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

async function getShopIsOpen() {
  try {
    if (DB_PROVIDER === 'localdb') return !!ldb.getShopConfig().isOpen;
    const result = await idb.query({ shopConfig: { $: { where: { id: SHOP_CONFIG_ID } } } });
    const cfg = result.shopConfig?.[0];
    return cfg ? !!cfg.isOpen : true;
  } catch { return true; }
}

function shopObjFromRecord(r) {
  let weaponProperties = [];
  try { weaponProperties = JSON.parse(r.weaponPropertiesJson || '[]'); } catch {}
  return {
    id: r.id, name: r.name,
    itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light',
    acBase: r.acBase ?? 10, valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1,
    acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0,
    requiresAttunement: !!r.requiresAttunement, notes: r.notes || '',
    weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '', weaponProperties,
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

// ── Characters ────────────────────────────────────────────────────────────────
app.get('/api/characters', async (req, res) => {
  try {
    let chars;
    if (DB_PROVIDER === 'localdb') {
      chars = ldb.listCharacters();
    } else {
      const result = await idb.query({ characters: {} });
      chars = result.characters || [];
    }
    res.json(chars
      .map(c => ({ id: c.id, name: c.name || 'Unnamed', has_password: !!c.passwordHash, char_type: c.charType || 'pc' }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/characters/:id/qroll', async (req, res) => {
  try {
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    let data = {};
    try { data = JSON.parse(char.dataJson || '{}'); } catch {}
    const SKILL_KEYS = Array.from({ length: 18 }, (_, i) => `sk-${i}`);
    const SAVE_KEYS  = ['save-str','save-dex','save-con','save-int','save-wis','save-cha'];
    const EXTRA_KEYS = ['init', 'init-bonus', 'sp-atk'];
    const qroll = {};
    for (const k of [...SKILL_KEYS, ...SAVE_KEYS, ...EXTRA_KEYS]) if (data[k] !== undefined) qroll[k] = data[k];
    if (data['_weapons'] !== undefined) qroll['_weapons'] = data['_weapons'];
    res.json({ id: char.id, name: char.name, data: qroll });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/characters/:id/roll', async (req, res) => {
  try {
    const { label, type, detail, total, isCrit, isFail, isDamage, time } = req.body || {};
    if (total === undefined) return res.status(400).json({ error: 'total required' });
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    let data = {};
    try { data = JSON.parse(char.dataJson || '{}'); } catch {}
    let hist = [];
    try { hist = JSON.parse(data._rollHistory || '[]'); } catch {}
    hist.unshift({ label: label || '', type: type || 'norm', detail: detail || '', total, isCrit: !!isCrit, isFail: !!isFail, isDamage: !!isDamage, time: time || new Date().toISOString() });
    if (hist.length > 100) hist.pop();
    data._rollHistory = JSON.stringify(hist);
    const dataJson = JSON.stringify(data);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateCharacter(req.params.id, { dataJson });
    } else {
      await idb.transact([idb.tx.characters[req.params.id].update({ dataJson })]);
    }
    broadcast('characters', { action: 'updated', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/characters/:id', async (req, res) => {
  try {
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    if (char.passwordHash) {
      const pw = req.headers['x-character-password'];
      if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
        return res.status(401).json({ locked: true });
    }
    let data = {};
    try { data = JSON.parse(char.dataJson || '{}'); } catch {}
    res.json({ id: char.id, name: char.name, data });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/characters', async (req, res) => {
  try {
    const { name, char_type, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const type = char_type === 'npc' ? 'npc' : 'pc';
    const hash = password ? hashPassword(password) : '';
    const newId = genId();
    const fields = { name: name.trim(), dataJson: '{}', charType: type, passwordHash: hash, createdAt: new Date().toISOString() };
    if (DB_PROVIDER === 'localdb') {
      ldb.createCharacter(newId, fields);
    } else {
      await idb.transact([idb.tx.characters[newId].update(fields)]);
    }
    broadcast('characters', { action: 'created', id: newId });
    res.json({ id: newId, name: name.trim(), char_type: type, has_password: !!password });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/characters/:id', async (req, res) => {
  try {
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    if (char.passwordHash) {
      const pw = req.headers['x-character-password'];
      if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
        return res.status(401).json({ error: 'Wrong password' });
    }
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'Data required' });
    const name = (data.name || '').trim() || 'Unnamed';
    if (DB_PROVIDER === 'localdb') {
      ldb.updateCharacter(req.params.id, { name, dataJson: JSON.stringify(data) });
    } else {
      await idb.transact([idb.tx.characters[req.params.id].update({ name, dataJson: JSON.stringify(data) })]);
    }
    broadcast('characters', { action: 'updated', id: req.params.id });

    // Sync linked table tokens
    try {
      const linkedTokens = DB_PROVIDER === 'localdb'
        ? ldb.getLinkedTokens(req.params.id)
        : (await idb.query({ tableTokens: { $: { where: { linkedId: req.params.id } } } })).tableTokens || [];
      if (linkedTokens.length > 0) {
        const newHpMax = parseInt(data.hpmax) || 0;
        const newHpCur = Math.min(parseInt(data.hpcur) || 0, newHpMax);
        let newSpeed;
        if (data['speed-base'] !== undefined) {
          let charItems = [];
          try { charItems = JSON.parse(data['_items'] || '[]'); } catch {}
          const itemSpeedBonus = charItems.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
          newSpeed = (parseInt(String(data['speed-base']).replace(/[^0-9]/g, '')) || 30) + itemSpeedBonus;
        } else {
          newSpeed = parseInt(String(data.speed || '30').replace(/[^0-9]/g, '')) || 30;
        }
        const newHpTemp = Math.max(0, parseInt(data.hptemp) || 0);
        const updFields = { hpCurrent: newHpCur, hpMax: newHpMax, hpTemp: newHpTemp, speed: newSpeed };
        if (DB_PROVIDER === 'localdb') {
          for (const t of linkedTokens) {
            ldb.updateTableToken(t.id, updFields);
            broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } });
          }
        } else {
          await idb.transact(linkedTokens.map(t => idb.tx.tableTokens[t.id].update(updFields)));
          for (const t of linkedTokens) broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } });
        }
      }
    } catch (syncErr) { console.error('token sync:', syncErr); }

    res.json({ ok: true, name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/characters/:id/password', async (req, res) => {
  try {
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    const { current_password, new_password } = req.body;
    if (char.passwordHash) {
      if (!current_password || (!verifyPassword(current_password, char.passwordHash) && !isMasterPassword(current_password)))
        return res.status(401).json({ error: 'Wrong current password' });
    }
    const newHash = new_password ? hashPassword(new_password) : '';
    if (DB_PROVIDER === 'localdb') {
      ldb.updateCharacter(req.params.id, { passwordHash: newHash });
    } else {
      await idb.transact([idb.tx.characters[req.params.id].update({ passwordHash: newHash })]);
    }
    res.json({ ok: true, has_password: !!new_password });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/characters/:id', async (req, res) => {
  try {
    const char = await getCharacter(req.params.id);
    if (!char) return res.status(404).json({ error: 'Not found' });
    if (char.passwordHash) {
      const pw = req.headers['x-character-password'];
      if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
        return res.status(401).json({ error: 'Wrong password' });
    }
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteCharacter(req.params.id);
    } else {
      await idb.transact([idb.tx.characters[req.params.id].delete()]);
    }
    broadcast('characters', { action: 'deleted', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Media ─────────────────────────────────────────────────────────────────────
app.get('/api/characters/:id/media', async (req, res) => {
  try {
    const charId = req.params.id;
    const status = await charAuth(charId, req);
    if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
    let mediaRows;
    if (DB_PROVIDER === 'localdb') {
      mediaRows = ldb.listMedia(charId);
    } else {
      const result = await idb.query({ media: { $: { where: { charId } } } });
      mediaRows = (result.media || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    res.json(mediaRows.map(r => ({ id: r.id, name: r.originalName, mimeType: r.mimeType, dataUrl: r.dataUrl, isPortrait: !!r.isPortrait, createdAt: r.createdAt })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/characters/:id/media', async (req, res) => {
  try {
    const charId = req.params.id;
    const status = await charAuth(charId, req);
    if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });

    const { dataUrl, originalName, isPortrait } = req.body || {};
    if (typeof dataUrl !== 'string' || typeof originalName !== 'string')
      return res.status(400).json({ error: 'dataUrl and originalName required' });

    const mimeMatch = dataUrl.match(/^data:([a-zA-Z0-9][a-zA-Z0-9!\-#$&^_.+]+\/[a-zA-Z0-9][a-zA-Z0-9!\-#$&^_.+]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
    const mimeType = mimeMatch[1].toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'File type not allowed' });
    if (Math.ceil(mimeMatch[2].length * 0.75) > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'File too large (max 25 MB)' });
    if (isPortrait && !mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });

    const safeName = path.basename(originalName).replace(/[^\w.\-]/g, '_').slice(0, 200) || 'file';
    const newId = genId();

    // Save file to disk; store URL path instead of base64 blob in DB
    const fileUrl = saveUploadFile('characters', newId, mimeType, mimeMatch[2]);

    if (DB_PROVIDER === 'localdb') {
      if (isPortrait) {
        // Delete old portrait file from disk
        const oldRows = ldb.listMedia(charId);
        const oldPortrait = oldRows.find(r => r.isPortrait);
        if (oldPortrait) deleteUploadFile(oldPortrait.dataUrl);
        ldb.setPortrait(charId, '');
      }
      ldb.createMedia(newId, { charId, originalName: safeName, mimeType, dataUrl: fileUrl, isPortrait: !!isPortrait, createdAt: new Date().toISOString() });
      if (isPortrait) ldb.setPortrait(charId, newId);
    } else {
      const txns = [];
      if (isPortrait) {
        const existing = await idb.query({ media: { $: { where: { charId } } } });
        for (const m of existing.media || []) if (m.isPortrait) txns.push(idb.tx.media[m.id].update({ isPortrait: false }));
      }
      txns.push(idb.tx.media[newId].update({ charId, originalName: safeName, mimeType, dataUrl: fileUrl, isPortrait: !!isPortrait, createdAt: new Date().toISOString() }));
      await idb.transact(txns);
    }
    res.json({ id: newId, name: safeName, mimeType, isPortrait: !!isPortrait });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Convenience: DM fetches a character's portrait data URL (masterAuth only)
app.get('/api/characters/:id/portrait', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let portrait = null;
    if (DB_PROVIDER === 'localdb') {
      const rows = ldb.listMedia(req.params.id);
      const p = rows.find(r => r.isPortrait);
      if (p) portrait = p.dataUrl;
    } else {
      const result = await idb.query({ media: { $: { where: { charId: req.params.id, isPortrait: true } } } });
      if (result.media?.[0]) portrait = result.media[0].dataUrl;
    }
    res.json({ portrait });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/characters/:id/media/:mid/portrait', async (req, res) => {
  try {
    const charId = req.params.id;
    const mediaId = req.params.mid;
    const status = await charAuth(charId, req);
    if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });

    if (DB_PROVIDER === 'localdb') {
      const target = ldb.getMediaById(mediaId);
      if (!target || target.charId !== charId) return res.status(404).json({ error: 'Media not found' });
      if (!target.mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });
      ldb.setPortrait(charId, mediaId);
    } else {
      const result = await idb.query({ media: { $: { where: { charId } } } });
      const allMedia = result.media || [];
      const target = allMedia.find(m => m.id === mediaId);
      if (!target) return res.status(404).json({ error: 'Media not found' });
      if (!target.mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });
      const txns = allMedia.filter(m => m.isPortrait).map(m => idb.tx.media[m.id].update({ isPortrait: false }));
      txns.push(idb.tx.media[mediaId].update({ isPortrait: true }));
      await idb.transact(txns);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/characters/:id/media/:mid', async (req, res) => {
  try {
    const charId = req.params.id;
    const mediaId = req.params.mid;
    const status = await charAuth(charId, req);
    if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      const m = ldb.getMediaById(mediaId);
      if (!m || m.charId !== charId) return res.status(404).json({ error: 'Media not found' });
      deleteUploadFile(m.dataUrl);
      ldb.deleteMedia(mediaId);
    } else {
      const result = await idb.query({ media: { $: { where: { charId } } } });
      const m = result.media?.find(m => m.id === mediaId);
      if (!m) return res.status(404).json({ error: 'Media not found' });
      deleteUploadFile(m.dataUrl);
      await idb.transact([idb.tx.media[mediaId].delete()]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Shop ──────────────────────────────────────────────────────────────────────
app.get('/api/shop', async (req, res) => {
  try {
    const isOpen = await getShopIsOpen();
    if (!isOpen) return res.json({ isOpen: false, items: [] });
    let items;
    if (DB_PROVIDER === 'localdb') {
      items = ldb.listShopItems().filter(r => r.quantity !== 0);
    } else {
      const result = await idb.query({ shopItems: {} });
      items = (result.shopItems || []).filter(r => r.quantity !== 0);
    }
    items.sort((a, b) => (a.itemType || '').localeCompare(b.itemType || '') || (a.name || '').localeCompare(b.name || ''));
    res.json({ isOpen: true, items: items.map(shopObjFromRecord) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/shop/status', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const isOpen = await getShopIsOpen();
    res.json({ isOpen });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/shop/status', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const isOpen = !!(req.body?.isOpen);
    if (DB_PROVIDER === 'localdb') {
      ldb.setShopConfig(isOpen);
    } else {
      await idb.transact([idb.tx.shopConfig[SHOP_CONFIG_ID].update({ isOpen })]);
    }
    broadcast('shop', { action: 'statusChanged', isOpen });
    res.json({ ok: true, isOpen });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/shop/all', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let items;
    if (DB_PROVIDER === 'localdb') {
      items = ldb.listShopItems().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    } else {
      const result = await idb.query({ shopItems: {} });
      items = (result.shopItems || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    res.json(items.map(shopObjFromRecord));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/shop', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const {
      name, itemType = 'wondrous', armorType = 'light', acBase = 10,
      valueCp = 0, quantity = 1, acBonus = 0, initBonus = 0, speedBonus = 0,
      requiresAttunement = false, notes = '', weaponAtk = '', weaponDmg = '', weaponProperties = []
    } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    const newId = genId();
    const fields = {
      name: String(name).trim(), itemType, armorType,
      acBase: +acBase, valueCp: +valueCp, quantity: +quantity,
      acBonus: +acBonus, initBonus: +initBonus, speedBonus: +speedBonus,
      requiresAttunement: !!requiresAttunement, notes: String(notes),
      weaponAtk: String(weaponAtk), weaponDmg: String(weaponDmg),
      weaponPropertiesJson: JSON.stringify(Array.isArray(weaponProperties) ? weaponProperties.slice(0, 3) : []),
      createdAt: new Date().toISOString()
    };
    if (DB_PROVIDER === 'localdb') {
      ldb.createShopItem(newId, fields);
    } else {
      await idb.transact([idb.tx.shopItems[newId].update(fields)]);
    }
    broadcast('shop', { action: 'created', id: newId });
    res.json({ id: newId, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/shop/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getShopItem(req.params.id) : (await idb.query({ shopItems: { $: { where: { id: req.params.id } } } })).shopItems?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponProperties } = req.body || {};
    const update = {};
    if (name !== undefined)               update.name = String(name).trim();
    if (itemType !== undefined)           update.itemType = itemType;
    if (armorType !== undefined)          update.armorType = armorType;
    if (acBase !== undefined)             update.acBase = +acBase;
    if (valueCp !== undefined)            update.valueCp = +valueCp;
    if (quantity !== undefined)           update.quantity = +quantity;
    if (acBonus !== undefined)            update.acBonus = +acBonus;
    if (initBonus !== undefined)          update.initBonus = +initBonus;
    if (speedBonus !== undefined)         update.speedBonus = +speedBonus;
    if (requiresAttunement !== undefined) update.requiresAttunement = !!requiresAttunement;
    if (notes !== undefined)              update.notes = String(notes);
    if (weaponAtk !== undefined)          update.weaponAtk = String(weaponAtk);
    if (weaponDmg !== undefined)          update.weaponDmg = String(weaponDmg);
    if (weaponProperties !== undefined)   update.weaponPropertiesJson = JSON.stringify(Array.isArray(weaponProperties) ? weaponProperties.slice(0, 3) : []);
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
    if (DB_PROVIDER === 'localdb') {
      ldb.updateShopItem(req.params.id, update);
    } else {
      await idb.transact([idb.tx.shopItems[req.params.id].update(update)]);
    }
    broadcast('shop', { action: 'updated', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/shop/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getShopItem(req.params.id) : (await idb.query({ shopItems: { $: { where: { id: req.params.id } } } })).shopItems?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteShopItem(req.params.id);
    } else {
      await idb.transact([idb.tx.shopItems[req.params.id].delete()]);
    }
    broadcast('shop', { action: 'deleted', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Shop: purchase ────────────────────────────────────────────────────────────
app.post('/api/shop/purchase', async (req, res) => {
  try {
    const { charId, items: cart } = req.body || {};
    if (!charId || !Array.isArray(cart) || cart.length === 0)
      return res.status(400).json({ error: 'charId and items[] required' });

    const authStatus = await charAuth(charId, req);
    if (authStatus !== 200) return res.status(authStatus).json({ error: authStatus === 404 ? 'Character not found' : 'Unauthorized' });

    const charRecord = await getCharacter(charId);
    if (!charRecord) return res.status(404).json({ error: 'Character not found' });
    let charData = {};
    try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}

    let totalCp = 0;
    const resolvedItems = [];
    for (const { shopItemId, qty = 1 } of cart) {
      const shopItem = DB_PROVIDER === 'localdb' ? ldb.getShopItem(shopItemId) : (await idb.query({ shopItems: { $: { where: { id: shopItemId } } } })).shopItems?.[0];
      if (!shopItem) return res.status(400).json({ error: `Shop item ${shopItemId} not found` });
      if (shopItem.quantity !== -1 && shopItem.quantity < qty) return res.status(400).json({ error: `Not enough stock for "${shopItem.name}"` });
      totalCp += (shopItem.valueCp ?? 0) * qty;
      resolvedItems.push({ shopItem, qty });
    }

    const cp = parseInt(charData.cp)  || 0;
    const sp = parseInt(charData.sp)  || 0;
    const ep = parseInt(charData.ep)  || 0;
    const gp = parseInt(charData.gp)  || 0;
    const pp = parseInt(charData.pp2) || 0;
    if (cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000 < totalCp)
      return res.status(400).json({ error: 'Insufficient funds' });

    const newCurrency = deductCurrency({ cp, sp, ep, gp, pp }, totalCp);

    let items = []; try { items = JSON.parse(charData._items || '[]'); } catch {}
    let idCounter = parseInt(charData._itemIdCounter) || (items.length ? Math.max(...items.map(i => i.id)) : 0);
    let weapons = []; try { weapons = JSON.parse(charData._weapons || '[]'); } catch {}

    for (const { shopItem, qty } of resolvedItems) {
      let props = []; try { props = JSON.parse(shopItem.weaponPropertiesJson || '[]'); } catch {}
      for (let i = 0; i < qty; i++) {
        if (shopItem.itemType === 'weapon') {
          const strMod = Math.floor(((parseInt(charData.str) || 10) - 10) / 2);
          const dexMod = Math.floor(((parseInt(charData.dex) || 10) - 10) / 2);
          const level = parseInt(charData.level) || 1;
          const profBonus = Math.floor((level - 1) / 4) + 2;
          const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod) : props.includes('Ammunition') ? dexMod : strMod;
          const magicBonus = parseInt(shopItem.weaponAtk) || 0;
          const totalAtk = profBonus + abilityMod + magicBonus;
          const atkStr = (totalAtk >= 0 ? '+' : '') + totalAtk;
          const dmgRaw = (shopItem.weaponDmg || '1d4').trim();
          const spaceIdx = dmgRaw.indexOf(' ');
          const dicePart = spaceIdx === -1 ? dmgRaw : dmgRaw.slice(0, spaceIdx);
          const typePart = spaceIdx === -1 ? '' : dmgRaw.slice(spaceIdx + 1).trim();
          const dmgBonus = abilityMod + magicBonus;
          const dmgStr = dmgBonus > 0 ? `${dicePart}+${dmgBonus}${typePart ? ' '+typePart : ''}` : dmgBonus < 0 ? `${dicePart}${dmgBonus}${typePart ? ' '+typePart : ''}` : dmgRaw;
          const propsStr = props.length ? props.join(', ') : '';
          const notesStr = [shopItem.notes, propsStr].filter(Boolean).join(' — ');
          weapons.push([shopItem.name, atkStr, dmgStr, notesStr]);
          const rawAtk = magicBonus !== 0 ? (magicBonus > 0 ? '+' : '') + magicBonus : '';
          items.push({ id: ++idCounter, name: shopItem.name, itemType: 'weapon', weaponAtk: rawAtk, weaponDmg: shopItem.weaponDmg || '', armorType: 'light', acBase: 10, value: cpToGpString(shopItem.valueCp ?? 0), equipped: false, requiresAttunement: !!shopItem.requiresAttunement, attuned: false, acBonus: shopItem.acBonus ?? 0, initBonus: shopItem.initBonus ?? 0, speedBonus: shopItem.speedBonus ?? 0, notes: notesStr });
        } else {
          items.push({ id: ++idCounter, name: shopItem.name, itemType: shopItem.itemType, armorType: shopItem.armorType, acBase: shopItem.acBase ?? 10, value: cpToGpString(shopItem.valueCp ?? 0), equipped: false, requiresAttunement: !!shopItem.requiresAttunement, attuned: false, acBonus: shopItem.acBonus ?? 0, initBonus: shopItem.initBonus ?? 0, speedBonus: shopItem.speedBonus ?? 0, notes: shopItem.notes || '' });
        }
      }
    }

    charData._items = JSON.stringify(items);
    charData._weapons = JSON.stringify(weapons);
    charData._itemIdCounter = idCounter;
    charData.cp  = String(newCurrency.cp);
    charData.sp  = String(newCurrency.sp);
    charData.ep  = String(newCurrency.ep);
    charData.gp  = String(newCurrency.gp);
    charData.pp2 = String(newCurrency.pp);

    const charName = charData.name || 'Unknown';
    if (DB_PROVIDER === 'localdb') {
      for (const { shopItem, qty } of resolvedItems) {
        if (shopItem.quantity !== -1) ldb.updateShopItem(shopItem.id, { quantity: shopItem.quantity - qty });
        ldb.createPurchaseLog(genId(), { charId, charName, itemName: shopItem.name, qty, totalCp: (shopItem.valueCp ?? 0) * qty, purchasedAt: new Date().toISOString() });
      }
      ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
    } else {
      const txns = [];
      for (const { shopItem, qty } of resolvedItems) {
        if (shopItem.quantity !== -1) txns.push(idb.tx.shopItems[shopItem.id].update({ quantity: shopItem.quantity - qty }));
        txns.push(idb.tx.purchaseLogs[genId()].update({ charId, charName, itemName: shopItem.name, qty, totalCp: (shopItem.valueCp ?? 0) * qty, purchasedAt: new Date().toISOString() }));
      }
      txns.push(idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name }));
      await idb.transact(txns);
    }

    broadcast('shop', { action: 'purchase' });
    broadcast('characters', { action: 'updated', id: charId });
    res.json({ ok: true, newCurrency });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Transaction failed' }); }
});

app.get('/api/shop/logs', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let logs;
    if (DB_PROVIDER === 'localdb') {
      logs = ldb.listPurchaseLogs();
    } else {
      const result = await idb.query({ purchaseLogs: {} });
      logs = (result.purchaseLogs || []).sort((a, b) => (b.purchasedAt || '').localeCompare(a.purchasedAt || '')).slice(0, 500);
    }
    res.json(logs.map(r => ({ id: r.id, charId: r.charId, charName: r.charName, itemName: r.itemName, qty: r.qty, totalCp: r.totalCp, purchasedAt: r.purchasedAt })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Loot ──────────────────────────────────────────────────────────────────────
function lootObjFromRecord(r) {
  return { id: r.id, name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt || '' };
}

app.get('/api/loot', async (req, res) => {
  try {
    let items;
    if (DB_PROVIDER === 'localdb') {
      items = ldb.listLootItems().filter(r => r.visible);
    } else {
      const result = await idb.query({ lootItems: {} });
      items = (result.lootItems || []).filter(r => r.visible).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    res.json(items.map(r => {
      const obj = lootObjFromRecord(r);
      if (!obj.descVisible) obj.description = '';
      return obj;
    }));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/loot/all', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let items;
    if (DB_PROVIDER === 'localdb') {
      items = ldb.listLootItems().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    } else {
      const result = await idb.query({ lootItems: {} });
      items = (result.lootItems || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    res.json(items.map(lootObjFromRecord));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/loot/import', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { text, tag = '' } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Text required' });
    const tagStr = String(tag).trim().slice(0, 40);
    const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    let count = 0;
    const newItems = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const name = lines[0].trim();
      if (!name) continue;
      const description = lines.slice(1).join('\n').trim();
      const newId = genId();
      const fields = { name, description, visible: false, tag: tagStr, createdAt: new Date(Date.now() + count++).toISOString() };
      newItems.push({ id: newId, fields });
    }
    if (newItems.length === 0) return res.status(400).json({ error: 'No valid items found' });
    if (DB_PROVIDER === 'localdb') {
      for (const { id, fields } of newItems) ldb.createLootItem(id, fields);
    } else {
      await idb.transact(newItems.map(({ id, fields }) => idb.tx.lootItems[id].update(fields)));
    }
    broadcast('loot', { action: 'imported' });
    res.json({ ok: true, count: newItems.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/loot', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name, description = '', visible = false, tag = '' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    const newId = genId();
    const fields = { name: String(name).trim(), description: String(description), visible: !!visible, tag: String(tag).trim().slice(0,40), createdAt: new Date().toISOString() };
    if (DB_PROVIDER === 'localdb') {
      ldb.createLootItem(newId, fields);
    } else {
      await idb.transact([idb.tx.lootItems[newId].update(fields)]);
    }
    broadcast('loot', { action: 'created', id: newId });
    res.json({ id: newId, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/loot/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getLootItem(req.params.id) : (await idb.query({ lootItems: { $: { where: { id: req.params.id } } } })).lootItems?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const update = {};
    const { name, description, visible, tag, descVisible } = req.body || {};
    if (name !== undefined)        update.name = String(name).trim();
    if (description !== undefined) update.description = String(description);
    if (visible !== undefined)     update.visible = !!visible;
    if (descVisible !== undefined) update.descVisible = !!descVisible;
    if (tag !== undefined)         update.tag = String(tag).trim().slice(0,40);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateLootItem(req.params.id, update);
    } else {
      await idb.transact([idb.tx.lootItems[req.params.id].update(update)]);
    }
    broadcast('loot', { action: 'updated', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/loot/bulk-update-tag', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { ids, tag } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const tagStr = tag !== undefined ? String(tag).trim().slice(0, 40) : '';
    if (DB_PROVIDER === 'localdb') {
      ldb.bulkUpdateLootTag(ids, tagStr);
    } else {
      await idb.transact(ids.map(id => idb.tx.lootItems[id].update({ tag: tagStr })));
    }
    broadcast('loot', { action: 'bulk-updated' });
    res.json({ ok: true, count: ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/loot/bulk-delete', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    if (DB_PROVIDER === 'localdb') {
      ldb.bulkDeleteLootItems(ids);
    } else {
      await idb.transact(ids.map(id => idb.tx.lootItems[id].delete()));
    }
    broadcast('loot', { action: 'bulk-updated' });
    res.json({ ok: true, count: ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/loot/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getLootItem(req.params.id) : (await idb.query({ lootItems: { $: { where: { id: req.params.id } } } })).lootItems?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteLootItem(req.params.id);
    } else {
      await idb.transact([idb.tx.lootItems[req.params.id].delete()]);
    }
    broadcast('loot', { action: 'deleted', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/loot/claim', async (req, res) => {
  try {
    const { charId, items } = req.body || {};
    if (!charId || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'charId and items required' });
    const status = await charAuth(charId, req);
    if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
    const charRecord = await getCharacter(charId);
    let charData = {};
    try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}
    let existingLoots = [];
    try { existingLoots = JSON.parse(charData._loots || '[]'); } catch {}
    const existingIds = new Set(existingLoots.map(l => l.id));

    // Fetch loot items to check descVisible
    const lootDbMap = {};
    if (DB_PROVIDER === 'localdb') {
      const lootRows = ldb.getLootItemsByIds(items.map(i => i.id));
      for (const r of lootRows) lootDbMap[r.id] = r;
    } else {
      const lootResult = await idb.query({ lootItems: { $: { where: { id: { in: items.map(i => i.id) } } } } });
      for (const r of lootResult.lootItems || []) lootDbMap[r.id] = r;
    }

    const newItems = [];
    for (const item of items) {
      if (!item.id || !item.name) continue;
      if (!existingIds.has(item.id)) {
        const dbItem = lootDbMap[item.id];
        const descVisible = dbItem ? !!dbItem.descVisible : false;
        const description = descVisible ? String(item.description || '') : '';
        existingLoots.push({ id: item.id, name: String(item.name), description, descVisible });
        existingIds.add(item.id);
        newItems.push(item);
      }
    }
    charData._loots = JSON.stringify(existingLoots);
    const charName = charData.name || charRecord.name || 'Unknown';
    const now = new Date().toISOString();

    if (DB_PROVIDER === 'localdb') {
      ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
      for (const item of newItems) {
        ldb.updateLootItem(item.id, { visible: false });
        ldb.createLootLog(genId(), { charId, charName, itemName: item.name, claimedAt: now });
      }
    } else {
      const txns = [idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name })];
      for (const item of newItems) {
        txns.push(idb.tx.lootItems[item.id].update({ visible: false }));
        txns.push(idb.tx.lootLogs[genId()].update({ charId, charName, itemName: item.name, claimedAt: now }));
      }
      await idb.transact(txns);
    }
    broadcast('characters', { action: 'updated', id: charId });
    broadcast('loot', { action: 'claimed' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/loot/visibility', async (req, res) => {
  try {
    let items;
    if (DB_PROVIDER === 'localdb') {
      items = ldb.listLootItems();
    } else {
      const result = await idb.query({ lootItems: {} });
      items = result.lootItems || [];
    }
    const map = {};
    for (const r of items) map[r.id] = { descVisible: !!r.descVisible, description: r.description || '' };
    res.json(map);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/loot/logs', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let logs;
    if (DB_PROVIDER === 'localdb') {
      logs = ldb.listLootLogs();
    } else {
      const result = await idb.query({ lootLogs: {} });
      logs = (result.lootLogs || []).sort((a, b) => (b.claimedAt || '').localeCompare(a.claimedAt || '')).slice(0, 500);
    }
    res.json(logs.map(r => ({ id: r.id, charName: r.charName, itemName: r.itemName, claimedAt: r.claimedAt })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Initiative Tracker ────────────────────────────────────────────────────────
app.get('/api/initiative', async (req, res) => {
  try {
    let entries, currentId;
    if (DB_PROVIDER === 'localdb') {
      entries = ldb.listInitEntries();
      currentId = ldb.getInitState().currentId || null;
    } else {
      const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
      entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
      currentId = result.initiativeState?.[0]?.currentId || null;
    }
    res.json({ entries, currentId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/roll', async (req, res) => {
  try {
    const { charId, name, roll } = req.body || {};
    if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });
    if (DB_PROVIDER === 'localdb') {
      const entries = ldb.listInitEntries();
      const existing = charId ? entries.find(e => e.charId === charId) : null;
      if (existing) {
        ldb.updateInitEntry(existing.id, { name: String(name), roll: parseInt(roll) });
      } else {
        ldb.createInitEntry(genId(), { name: String(name), roll: parseInt(roll), charId: charId || '', createdAt: new Date().toISOString() });
      }
    } else {
      const result = await idb.query({ initiativeEntries: {} });
      const existing = charId ? (result.initiativeEntries || []).find(e => e.charId === charId) : null;
      const txns = existing
        ? [idb.tx.initiativeEntries[existing.id].update({ name: String(name), roll: parseInt(roll) })]
        : [idb.tx.initiativeEntries[genId()].update({ name: String(name), roll: parseInt(roll), charId: charId || '', createdAt: new Date().toISOString() })];
      await idb.transact(txns);
    }
    broadcast('initiative', { action: 'roll' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/add', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name, roll, monsterId } = req.body || {};
    if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });
    const newInitId = genId();
    const fields = { name: String(name), roll: parseInt(roll), charId: '', monsterId: monsterId || '', createdAt: new Date().toISOString() };
    if (DB_PROVIDER === 'localdb') {
      ldb.createInitEntry(newInitId, fields);
    } else {
      await idb.transact([idb.tx.initiativeEntries[newInitId].update(fields)]);
    }
    broadcast('initiative', { action: 'add' });
    res.json({ ok: true, id: newInitId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/initiative/:id', async (req, res) => {
  try {
    const { name, roll, charId } = req.body || {};
    const isMaster = masterAuth(req);
    if (!isMaster) {
      if (!charId) return res.status(401).json({ error: 'Unauthorized' });
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
      const entry = DB_PROVIDER === 'localdb' ? ldb.getInitEntry(req.params.id) : (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
      if (!entry || entry.charId !== charId) return res.status(403).json({ error: 'Forbidden' });
    }
    const update = {};
    if (name !== undefined) update.name = String(name);
    if (roll !== undefined) update.roll = parseInt(roll);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateInitEntry(req.params.id, update);
    } else {
      await idb.transact([idb.tx.initiativeEntries[req.params.id].update(update)]);
    }
    broadcast('initiative', { action: 'edit' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/initiative/:id', async (req, res) => {
  try {
    const { charId } = req.body || {};
    const isMaster = masterAuth(req);
    if (!isMaster) {
      if (!charId) return res.status(401).json({ error: 'Unauthorized' });
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
      const entry = DB_PROVIDER === 'localdb' ? ldb.getInitEntry(req.params.id) : (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
      if (!entry || entry.charId !== charId) return res.status(403).json({ error: 'Forbidden' });
    }
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteInitEntry(req.params.id);
    } else {
      await idb.transact([idb.tx.initiativeEntries[req.params.id].delete()]);
    }
    broadcast('initiative', { action: 'delete' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/next', async (req, res) => {
  try {
    let entries, state, stateId;
    if (DB_PROVIDER === 'localdb') {
      entries = ldb.listInitEntries(); // already sorted by roll DESC
      state   = ldb.getInitState();
      stateId = state.id;
    } else {
      const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
      entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
      state   = result.initiativeState?.[0];
      stateId = state?.id || genId();
    }
    if (entries.length === 0) return res.json({ ok: true });
    const idx    = state?.currentId ? entries.findIndex(e => e.id === state.currentId) : -1;
    const nextId = entries[(idx + 1) % entries.length].id;
    if (DB_PROVIDER === 'localdb') {
      ldb.setInitState(nextId);
    } else {
      await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: nextId })]);
    }
    // Reset movedFt for newly active token
    try {
      const tokList = DB_PROVIDER === 'localdb' ? ldb.getTableTokensByInitId(nextId) : (await idb.query({ tableTokens: { $: { where: { initiativeId: nextId } } } })).tableTokens || [];
      if (tokList.length > 0) {
        if (DB_PROVIDER === 'localdb') {
          for (const t of tokList) { ldb.updateTableToken(t.id, { movedFt: 0 }); broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } }); }
        } else {
          await idb.transact(tokList.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
          for (const t of tokList) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
        }
      }
    } catch {}
    broadcast('initiative', { action: 'next' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/start', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let entries, state, stateId;
    if (DB_PROVIDER === 'localdb') {
      entries = ldb.listInitEntries();
      state   = ldb.getInitState();
      stateId = state.id;
    } else {
      const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
      entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
      state   = result.initiativeState?.[0];
      stateId = state?.id || genId();
    }
    if (entries.length === 0) return res.status(400).json({ error: 'No initiative entries' });
    const firstId = entries[0].id;
    if (DB_PROVIDER === 'localdb') {
      ldb.setInitState(firstId);
    } else {
      await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: firstId })]);
    }
    try {
      const tokList = DB_PROVIDER === 'localdb' ? ldb.getTableTokensByInitId(firstId) : (await idb.query({ tableTokens: { $: { where: { initiativeId: firstId } } } })).tableTokens || [];
      if (tokList.length > 0) {
        if (DB_PROVIDER === 'localdb') {
          for (const t of tokList) { ldb.updateTableToken(t.id, { movedFt: 0 }); broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } }); }
        } else {
          await idb.transact(tokList.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
          for (const t of tokList) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
        }
      }
    } catch {}
    broadcast('initiative', { action: 'start' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/end', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.setInitState('');
      const moved = ldb.getMovedTableTokens();
      for (const t of moved) { ldb.updateTableToken(t.id, { movedFt: 0 }); broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } }); }
    } else {
      const result = await idb.query({ initiativeState: {}, tableTokens: {} });
      const state  = result.initiativeState?.[0];
      if (state?.id) await idb.transact([idb.tx.initiativeState[state.id].update({ currentId: '' })]);
      const moved  = (result.tableTokens || []).filter(t => (t.movedFt || 0) > 0);
      if (moved.length > 0) {
        await idb.transact(moved.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
        for (const t of moved) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
      }
    }
    broadcast('initiative', { action: 'end' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/initiative/clear', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.clearInitEntries();
      ldb.setInitState('');
    } else {
      const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
      const txns = [
        ...(result.initiativeEntries || []).map(e => idb.tx.initiativeEntries[e.id].delete()),
        ...(result.initiativeState || []).map(s => idb.tx.initiativeState[s.id].delete())
      ];
      if (txns.length > 0) await idb.transact(txns);
    }
    broadcast('initiative', { action: 'clear' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Shared Media (SQLite-backed, both modes) ──────────────────────────────────
app.post('/api/chat/media', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { dataUrl, originalName, caption } = req.body || {};
    if (!dataUrl || !originalName) return res.status(400).json({ error: 'dataUrl and originalName required' });
    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
    const mimeType = mimeMatch[1].toLowerCase();
    if (!SHARED_MEDIA_MIME.has(mimeType)) return res.status(400).json({ error: 'File type not allowed' });
    const b64 = mimeMatch[2];
    if (Math.ceil(b64.length * 0.75) > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'File too large (max 25 MB)' });
    const mediaId = genId();
    const chatFileUrl = saveUploadFile('media', mediaId, mimeType, b64);
    insertSharedMedia(mediaId, mimeType, Buffer.from('FILE:' + chatFileUrl));
    const entry = {
      id: genId(), sender: 'DM', type: 'media', mediaId, mimeType,
      caption: caption ? String(caption).slice(0, 120) : null,
      timestamp: new Date().toISOString()
    };
    if (DB_PROVIDER === 'localdb') {
      ldb.appendChatLog(entry);
    } else {
      chatLog.push(entry);
      if (chatLog.length > CHAT_MAX) chatLog.shift();
    }
    broadcast('chat', entry);
    res.json({ ok: true, mediaId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/shared-media/:id', (req, res) => {
  const item = _mediaGet.get(req.params.id);
  if (!item) return res.status(404).send('Not found');
  const dataStr = item.data.toString();
  if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
  res.set('Content-Type', item.mime_type);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(item.data);
});

// ── Chat / Dice Roll Log ──────────────────────────────────────────────────────
const chatLog = [];
const CHAT_MAX = 100;

app.get('/api/chat', (req, res) => {
  if (DB_PROVIDER === 'localdb') return res.json(ldb.listChatLog());
  res.json(chatLog);
});

app.post('/api/dice/broadcast', (req, res) => {
  const { rollId, sides, dieResults, modifier, total, label, duration, sender } = req.body || {};
  if (!sides || !Array.isArray(dieResults) || dieResults.length === 0)
    return res.status(400).json({ error: 'sides and dieResults[] required' });
  broadcast('dice-roll', { rollId, sides, dieResults, modifier: modifier || 0, total, label, duration, sender });
  res.json({ ok: true });
});

app.post('/api/chat', (req, res) => {
  const { sender, dice, results, modifier, total, label } = req.body;
  if (!sender || !dice || !Array.isArray(results) || results.length === 0)
    return res.status(400).json({ error: 'sender, dice, and results[] required' });
  const entry = {
    id: genId(),
    sender: String(sender).slice(0, 40),
    dice: String(dice).slice(0, 20),
    results: results.map(Number),
    modifier: parseInt(modifier) || 0,
    total: parseInt(total),
    label: label ? String(label).slice(0, 60) : null,
    timestamp: new Date().toISOString()
  };
  if (DB_PROVIDER === 'localdb') {
    ldb.appendChatLog(entry);
  } else {
    chatLog.push(entry);
    if (chatLog.length > CHAT_MAX) chatLog.shift();
  }
  broadcast('chat', entry);
  res.json(entry);
});

app.post('/api/chat/clear', (req, res) => {
  if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (DB_PROVIDER === 'localdb') {
    ldb.clearChatLog();
  } else {
    chatLog.length = 0;
  }
  broadcast('chat-clear', {});
  res.json({ ok: true });
});

// ── Monsters ──────────────────────────────────────────────────────────────────
app.get('/api/monsters', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let list;
    if (DB_PROVIDER === 'localdb') {
      list = ldb.listMonsters();
    } else {
      const result = await idb.query({ monsters: {} });
      list = (result.monsters || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    res.json(list.map(r => {
      let data = {};
      try { data = JSON.parse(r.dataJson || '{}'); } catch {}
      return { id: r.id, name: r.name, cr: r.cr, data };
    }));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/monsters/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const r = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
    if (!r) return res.status(404).json({ error: 'Not found' });
    let data = {};
    try { data = JSON.parse(r.dataJson || '{}'); } catch {}
    res.json({ id: r.id, name: r.name, cr: r.cr, data });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/monsters/import', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { monsters: list } = req.body || {};
    if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: 'monsters array required' });
    const toInsert = [];
    for (const m of list) {
      if (!m || !m.name) continue;
      const crVal = (m.cr && typeof m.cr === 'object') ? m.cr.cr : (m.cr || '?');
      toInsert.push({ id: genId(), name: String(m.name).trim(), cr: String(crVal), dataJson: JSON.stringify(m), createdAt: new Date().toISOString() });
    }
    if (toInsert.length === 0) return res.status(400).json({ error: 'No valid monsters found' });
    if (DB_PROVIDER === 'localdb') {
      for (const m of toInsert) ldb.createMonster(m.id, m);
    } else {
      await idb.transact(toInsert.map(m => idb.tx.monsters[m.id].update(m)));
    }
    res.json({ ok: true, count: toInsert.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/monsters/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, cr, dataJson } = req.body || {};
    const update = {};
    if (name !== undefined)    update.name = String(name).trim();
    if (cr !== undefined)      update.cr = String(cr);
    if (dataJson !== undefined) update.dataJson = dataJson;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
    if (DB_PROVIDER === 'localdb') {
      ldb.updateMonster(req.params.id, update);
    } else {
      await idb.transact([idb.tx.monsters[req.params.id].update(update)]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/monsters/:id/portrait', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || (dataUrl !== '' && !dataUrl.match(/^data:image\//)))
      return res.status(400).json({ error: 'Image data URL required' });
    const r = DB_PROVIDER === 'localdb'
      ? ldb.getMonster(req.params.id)
      : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
    if (!r) return res.status(404).json({ error: 'Not found' });
    let data = {};
    try { data = JSON.parse(r.dataJson || '{}'); } catch {}
    if (dataUrl === '') {
      deleteUploadFile(data.portrait);
      delete data.portrait;
    } else {
      // Save image to disk; store URL path instead of base64 in DB
      const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
      deleteUploadFile(data.portrait); // remove old file if any
      data.portrait = saveUploadFile('monsters', req.params.id, mimeMatch[1], mimeMatch[2]);
    }
    const dataJson = JSON.stringify(data);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateMonster(req.params.id, { dataJson });
    } else {
      await idb.transact([idb.tx.monsters[req.params.id].update({ dataJson })]);
    }
    // Sync portrait to all table tokens linked to this monster
    const newPortrait = data.portrait || null;
    if (DB_PROVIDER === 'localdb') {
      const linked = ldb.getLinkedTokens(req.params.id).filter(t => t.type === 'monster');
      for (const tok of linked) {
        ldb.updateTableToken(tok.id, { portrait: newPortrait });
        broadcast('table', { action: 'token-updated', token: { ...tok, portrait: newPortrait } });
      }
    } else {
      const tokRes = await idb.query({ tableTokens: { $: { where: { linkedId: req.params.id } } } });
      const linked = (tokRes.tableTokens || []).filter(t => t.type === 'monster');
      if (linked.length) {
        await idb.transact(linked.map(t => idb.tx.tableTokens[t.id].update({ portrait: newPortrait })));
        for (const tok of linked) {
          broadcast('table', { action: 'token-updated', token: { ...tok, portrait: newPortrait } });
        }
      }
    }
    // Notify table screen to update monster list cache
    broadcast('monsters', { action: 'portrait-updated', id: req.params.id, portrait: newPortrait });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/monsters/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const existing = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Delete portrait file if any
    try { const d = JSON.parse(existing.dataJson || '{}'); deleteUploadFile(d.portrait); } catch {}
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteMonster(req.params.id);
    } else {
      await idb.transact([idb.tx.monsters[req.params.id].delete()]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Database Backup ───────────────────────────────────────────────────────────
app.get('/api/admin/backup', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const sharedMediaRows = mediaDb.prepare('SELECT id, mime_type, data, created_at FROM shared_media').all()
      .map(r => ({ id: r.id, mime_type: r.mime_type, data: Buffer.from(r.data).toString('base64'), created_at: r.created_at }));

    let dbData;
    if (DB_PROVIDER === 'localdb') {
      dbData = ldb.exportAll();
    } else {
      const [charactersData, mediaData, shopConfigData, shopItemsData, purchaseLogsData, lootItemsData, lootLogsData, monstersData] = await Promise.all([
        idb.query({ characters: {} }), idb.query({ media: {} }), idb.query({ shopConfig: {} }), idb.query({ shopItems: {} }),
        idb.query({ purchaseLogs: {} }), idb.query({ lootItems: {} }), idb.query({ lootLogs: {} }), idb.query({ monsters: {} })
      ]);
      dbData = {
        characters: charactersData.characters || [], media: mediaData.media || [],
        shopConfig: shopConfigData.shopConfig || [], shopItems: shopItemsData.shopItems || [],
        purchaseLogs: purchaseLogsData.purchaseLogs || [], lootItems: lootItemsData.lootItems || [],
        lootLogs: lootLogsData.lootLogs || [], monsters: monstersData.monsters || []
      };
    }

    const backup = { timestamp: new Date().toISOString(), version: '1.0', dbProvider: DB_PROVIDER, [DB_PROVIDER]: dbData, sqlite: { shared_media: sharedMediaRows } };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dnd-backup-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(backup);
  } catch (err) { console.error('Backup error:', err); res.status(500).json({ error: 'Backup failed' }); }
});

app.post('/api/admin/restore', express.json({ limit: '200mb' }), async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const backup = req.body;
    if (!backup || !backup.version) return res.status(400).json({ error: 'Invalid backup file' });

    // Extract data — accept backup from either provider
    const rawData = backup[backup.dbProvider] || backup.localdb || backup.instantdb;
    if (!rawData) return res.status(400).json({ error: 'No data found in backup' });

    // Normalize media field names (instantdb uses name/dataJson; localdb uses originalName/dataUrl)
    const data = { ...rawData };
    if (data.media) {
      data.media = data.media.map(m => ({
        ...m,
        originalName: m.originalName || m.name || '',
        dataUrl: m.dataUrl || m.dataJson || '',
      }));
    }

    if (DB_PROVIDER === 'localdb') {
      ldb.importAll(data);
    } else {
      // InstantDB: delete all existing records, then insert from backup
      const [exChars, exMedia, exShopItems, exPurchLogs, exLootItems, exLootLogs, exMonsters] = await Promise.all([
        idb.query({ characters: {} }), idb.query({ media: {} }), idb.query({ shopItems: {} }),
        idb.query({ purchaseLogs: {} }), idb.query({ lootItems: {} }), idb.query({ lootLogs: {} }),
        idb.query({ monsters: {} }),
      ]);
      const delOps = [
        ...(exChars.characters    || []).map(r => idb.tx.characters[r.id].delete()),
        ...(exMedia.media         || []).map(r => idb.tx.media[r.id].delete()),
        ...(exShopItems.shopItems || []).map(r => idb.tx.shopItems[r.id].delete()),
        ...(exPurchLogs.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].delete()),
        ...(exLootItems.lootItems || []).map(r => idb.tx.lootItems[r.id].delete()),
        ...(exLootLogs.lootLogs   || []).map(r => idb.tx.lootLogs[r.id].delete()),
        ...(exMonsters.monsters   || []).map(r => idb.tx.monsters[r.id].delete()),
      ];
      const insOps = [
        ...(data.characters  || []).map(r => idb.tx.characters[r.id].update({ name: r.name || '', dataJson: r.dataJson || '{}', charType: r.charType || 'pc', passwordHash: r.passwordHash || '', createdAt: r.createdAt })),
        ...(data.media       || []).map(r => idb.tx.media[r.id].update({ charId: r.charId || '', name: r.originalName || '', mimeType: r.mimeType || '', dataJson: r.dataUrl || '', createdAt: r.createdAt })),
        ...(data.shopConfig  || []).map(r => idb.tx.shopConfig[r.id].update({ isOpen: !!r.isOpen })),
        ...(data.shopItems   || []).map(r => idb.tx.shopItems[r.id].update({ name: r.name || '', itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light', acBase: r.acBase ?? 10, valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1, acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0, requiresAttunement: !!r.requiresAttunement, notes: r.notes || '', weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '', weaponPropertiesJson: r.weaponPropertiesJson || '[]', createdAt: r.createdAt })),
        ...(data.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', qty: r.qty || 1, totalCp: r.totalCp || 0, purchasedAt: r.purchasedAt || r.createdAt })),
        ...(data.lootItems   || []).map(r => idb.tx.lootItems[r.id].update({ name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt })),
        ...(data.lootLogs    || []).map(r => idb.tx.lootLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', claimedAt: r.claimedAt || r.createdAt })),
        ...(data.monsters    || []).map(r => idb.tx.monsters[r.id].update({ name: r.name || '', cr: r.cr || '?', dataJson: r.dataJson || '{}', createdAt: r.createdAt })),
      ];
      const allOps = [...delOps, ...insOps];
      for (let i = 0; i < allOps.length; i += 100) {
        await idb.transact(allOps.slice(i, i + 100));
      }
    }

    // Restore shared media (map images, chat images)
    if (backup.sqlite && Array.isArray(backup.sqlite.shared_media)) {
      mediaDb.prepare('DELETE FROM shared_media').run();
      const insMedia = mediaDb.prepare('INSERT OR REPLACE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
      for (const r of backup.sqlite.shared_media) {
        if (r.id && r.mime_type && r.data) {
          insMedia.run(r.id, r.mime_type, Buffer.from(r.data, 'base64'), r.created_at || Date.now());
        }
      }
    }

    broadcast('characters', { action: 'reload' });
    broadcast('shop', { action: 'reload' });
    broadcast('loot', { action: 'reload' });
    broadcast('initiative', { action: 'reload' });
    broadcast('table', { action: 'state-updated' });
    broadcast('table', { action: 'map-updated' });
    res.json({ ok: true });
  } catch (err) { console.error('Restore error:', err); res.status(500).json({ error: 'Restore failed: ' + err.message }); }
});

// ── Table ─────────────────────────────────────────────────────────────────────
const TABLE_STATE_ID = 'c8a04a12-4372-4c78-9abc-def012345601';

async function getTableState() {
  try {
    let raw;
    if (DB_PROVIDER === 'localdb') {
      raw = ldb.getTableState();
    } else {
      const r = await idb.query({ tableState: { $: { where: { id: TABLE_STATE_ID } } } });
      raw = r.tableState?.[0] || { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: false };
    }
    raw.fogRegions = (() => { try { return JSON.parse(raw.fogRegions || '[]'); } catch { return []; } })();
    raw.hiddenItems = (() => { try { return JSON.parse(raw.hiddenItems || '[]'); } catch { return []; } })();
    return raw;
  } catch { return { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: false, fogRegions: [], hiddenItems: [] }; }
}

async function getTableTokens() {
  try {
    if (DB_PROVIDER === 'localdb') return ldb.listTableTokens();
    const r = await idb.query({ tableTokens: {} });
    return (r.tableTokens || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } catch { return []; }
}

app.get('/api/table', async (req, res) => {
  try {
    const [state, tokens] = await Promise.all([getTableState(), getTableTokens()]);
    res.json({ state, tokens });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

const TABLE_MAP_MEDIA_ID = 'table-map';

app.get('/api/table/map', (req, res) => {
  const item = _mediaGet.get(TABLE_MAP_MEDIA_ID);
  if (!item) return res.status(404).send('No map uploaded');
  const dataStr = item.data.toString();
  if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
  res.set('Content-Type', item.mime_type);
  res.set('Cache-Control', 'no-cache, no-store');
  res.send(item.data);
});

app.post('/api/table/map', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { dataUrl, mapWidth, mapHeight } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
    const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
    const mimeType = mimeMatch[1];
    const b64 = mimeMatch[2];
    if (Math.ceil(b64.length * 0.75) > 30_000_000) return res.status(413).json({ error: 'Image too large (max ~30 MB)' });
    // Delete old table-map file if any
    const oldMap = _mediaGet.get(TABLE_MAP_MEDIA_ID);
    if (oldMap) { const s = oldMap.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
    const mapFileUrl = saveUploadFile('maps', TABLE_MAP_MEDIA_ID, mimeType, b64);
    _mapUpsert.run(TABLE_MAP_MEDIA_ID, mimeType, Buffer.from('FILE:' + mapFileUrl), Date.now());
    const stateUpdate = { hasMap: true, mapWidth: parseInt(mapWidth) || 0, mapHeight: parseInt(mapHeight) || 0 };
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState(stateUpdate);
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
    }
    broadcast('table', { action: 'map-updated' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/table/map', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const oldMapDel = _mediaGet.get(TABLE_MAP_MEDIA_ID);
    if (oldMapDel) { const s = oldMapDel.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
    mediaDb.prepare('DELETE FROM shared_media WHERE id = ?').run(TABLE_MAP_MEDIA_ID);
    const stateUpdate = { hasMap: false, mapWidth: 0, mapHeight: 0 };
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState(stateUpdate);
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
    }
    broadcast('table', { action: 'map-updated' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Fog reveal ────────────────────────────────────────────────────────────────
app.post('/api/table/fog/:regionId/reveal', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { regionId } = req.params;
    const state = await getTableState();
    const regions = Array.isArray(state.fogRegions) ? state.fogRegions : [];
    const region = regions.find(r => r.id === regionId);
    if (!region) return res.status(404).json({ error: 'Region not found' });
    region.visible = true;
    const fogJson = JSON.stringify(regions);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState({ fogRegions: fogJson });
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ fogRegions: fogJson })]);
    }
    broadcast('table', { action: 'fog-updated', fogRegions: regions });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/table/fog/:regionId/hide', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { regionId } = req.params;
    const state = await getTableState();
    const regions = Array.isArray(state.fogRegions) ? state.fogRegions : [];
    const region = regions.find(r => r.id === regionId);
    if (!region) return res.status(404).json({ error: 'Region not found' });
    region.visible = false;
    const fogJson = JSON.stringify(regions);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState({ fogRegions: fogJson });
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ fogRegions: fogJson })]);
    }
    broadcast('table', { action: 'fog-updated', fogRegions: regions });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Hidden Items reveal/hide ──────────────────────────────────────────────────
app.post('/api/table/items/:itemId/reveal', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { itemId } = req.params;
    const state = await getTableState();
    const items = Array.isArray(state.hiddenItems) ? state.hiddenItems : [];
    const item = items.find(r => r.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    item.visible = true;
    const itemsJson = JSON.stringify(items);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState({ hiddenItems: itemsJson });
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ hiddenItems: itemsJson })]);
    }
    broadcast('table', { action: 'items-updated', hiddenItems: items });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/table/items/:itemId/hide', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { itemId } = req.params;
    const state = await getTableState();
    const items = Array.isArray(state.hiddenItems) ? state.hiddenItems : [];
    const item = items.find(r => r.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    item.visible = false;
    const itemsJson = JSON.stringify(items);
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState({ hiddenItems: itemsJson });
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ hiddenItems: itemsJson })]);
    }
    broadcast('table', { action: 'items-updated', hiddenItems: items });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Allow anyone to update roll for player entries; DM required for monster entries
app.patch('/api/initiative/:id/roll', async (req, res) => {
  try {
    const { roll } = req.body || {};
    if (roll === undefined) return res.status(400).json({ error: 'roll required' });
    let entry;
    if (DB_PROVIDER === 'localdb') {
      entry = ldb.getInitEntry(req.params.id);
    } else {
      entry = (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
    }
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (entry.monsterId && !masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.updateInitEntry(req.params.id, { roll: parseInt(roll) });
    } else {
      await idb.transact([idb.tx.initiativeEntries[req.params.id].update({ roll: parseInt(roll) })]);
    }
    broadcast('initiative', { action: 'edit' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Prepared Maps ─────────────────────────────────────────────────────────────
app.get('/api/prepared-maps', async (req, res) => {
  try {
    let maps;
    if (DB_PROVIDER === 'localdb') {
      maps = ldb.listPreparedMaps();
    } else {
      const r = await idb.query({ preparedMaps: {} });
      maps = r.preparedMaps || [];
    }
    maps = maps.map(m => ({
      ...m,
      fogRegions: (() => { try { return JSON.parse(m.fogRegions || '[]'); } catch { return []; } })(),
      hiddenItems: (() => { try { return JSON.parse(m.hiddenItems || '[]'); } catch { return []; } })(),
      hasImage: !!mediaDb.prepare('SELECT id FROM shared_media WHERE id = ?').get('prep-map-' + m.id),
    }));
    res.json(maps);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/prepared-maps', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const name = (req.body?.name || '').trim() || 'Untitled Map';
    const id = genId();
    const fields = { name, createdAt: new Date().toISOString() };
    if (DB_PROVIDER === 'localdb') {
      ldb.createPreparedMap(id, fields);
    } else {
      await idb.transact([idb.tx.preparedMaps[id].update({ id, ...fields, fogRegions: '[]' })]);
    }
    res.json({ ok: true, id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/prepared-maps/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const body = req.body || {};
    const fields = {};
    if (body.name !== undefined) fields.name = String(body.name).trim();
    if (body.cellSize !== undefined) fields.cellSize = Math.max(20, Math.min(200, parseInt(body.cellSize) || 50));
    if (body.offsetX !== undefined) fields.offsetX = parseInt(body.offsetX) || 0;
    if (body.offsetY !== undefined) fields.offsetY = parseInt(body.offsetY) || 0;
    if (body.mapWidth !== undefined) fields.mapWidth = parseInt(body.mapWidth) || 0;
    if (body.mapHeight !== undefined) fields.mapHeight = parseInt(body.mapHeight) || 0;
    if (body.fogRegions !== undefined) fields.fogRegions = JSON.stringify(Array.isArray(body.fogRegions) ? body.fogRegions : []);
    if (body.hiddenItems !== undefined) fields.hiddenItems = JSON.stringify(Array.isArray(body.hiddenItems) ? body.hiddenItems : []);
    if (Object.keys(fields).length === 0) return res.json({ ok: true });
    if (DB_PROVIDER === 'localdb') {
      ldb.updatePreparedMap(req.params.id, fields);
    } else {
      await idb.transact([idb.tx.preparedMaps[req.params.id].update(fields)]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/prepared-maps/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    if (DB_PROVIDER === 'localdb') {
      ldb.deletePreparedMap(id);
    } else {
      await idb.transact([idb.tx.preparedMaps[id].delete()]);
    }
    const prepDelId = 'prep-map-' + id;
    const prepDelItem = _mediaGet.get(prepDelId);
    if (prepDelItem) { const s = prepDelItem.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
    mediaDb.prepare('DELETE FROM shared_media WHERE id = ?').run(prepDelId);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/prepared-maps/:id/image', (req, res) => {
  const item = _mediaGet.get('prep-map-' + req.params.id);
  if (!item) return res.status(404).send('No image uploaded');
  const dataStr = item.data.toString();
  if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
  res.set('Content-Type', item.mime_type);
  res.set('Cache-Control', 'no-cache, no-store');
  res.send(item.data);
});

app.post('/api/prepared-maps/:id/image', express.json({ limit: '34mb' }), async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { dataUrl, mapWidth, mapHeight } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
    const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
    const mimeType = mimeMatch[1];
    const b64 = mimeMatch[2];
    if (Math.ceil(b64.length * 0.75) > 30_000_000) return res.status(413).json({ error: 'Image too large (max ~30 MB)' });
    // Delete old prepared-map file if any
    const prepMapId = 'prep-map-' + req.params.id;
    const oldPrepMap = _mediaGet.get(prepMapId);
    if (oldPrepMap) { const s = oldPrepMap.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
    const prepFileUrl = saveUploadFile('maps', prepMapId, mimeType, b64);
    _mapUpsert.run(prepMapId, mimeType, Buffer.from('FILE:' + prepFileUrl), Date.now());
    const sizeFields = { mapWidth: parseInt(mapWidth) || 0, mapHeight: parseInt(mapHeight) || 0 };
    if (DB_PROVIDER === 'localdb') {
      ldb.updatePreparedMap(req.params.id, sizeFields);
    } else {
      await idb.transact([idb.tx.preparedMaps[req.params.id].update(sizeFields)]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/prepared-maps/:id/load-to-table', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    let map;
    if (DB_PROVIDER === 'localdb') {
      map = ldb.getPreparedMap(req.params.id);
    } else {
      const r = await idb.query({ preparedMaps: { $: { where: { id: req.params.id } } } });
      map = r.preparedMaps?.[0];
    }
    if (!map) return res.status(404).json({ error: 'Prepared map not found' });
    // Copy image from prep-map-{id} to table-map
    const srcId = 'prep-map-' + req.params.id;
    const imgRow = _mediaGet.get(srcId);
    if (imgRow) {
      const srcDataStr = imgRow.data.toString();
      if (srcDataStr.startsWith('FILE:')) {
        // Copy file to a dedicated table-map file so deleting the prep map won't break the table
        const srcFilePath = path.join(__dirname, 'public', srcDataStr.slice(5));
        const ext = path.extname(srcFilePath);
        const destFileUrl = `/uploads/maps/${TABLE_MAP_MEDIA_ID}${ext}`;
        const destFilePath = path.join(__dirname, 'public', destFileUrl);
        // Delete old table-map file if different from source
        const oldTableMap = _mediaGet.get(TABLE_MAP_MEDIA_ID);
        if (oldTableMap) { const s = oldTableMap.data.toString(); if (s.startsWith('FILE:') && s.slice(5) !== destFileUrl) deleteUploadFile(s.slice(5)); }
        try { fs.mkdirSync(path.dirname(destFilePath), { recursive: true }); fs.copyFileSync(srcFilePath, destFilePath); } catch {}
        _mapUpsert.run(TABLE_MAP_MEDIA_ID, imgRow.mime_type, Buffer.from('FILE:' + destFileUrl), Date.now());
      } else {
        _mapUpsert.run(TABLE_MAP_MEDIA_ID, imgRow.mime_type, imgRow.data, Date.now());
      }
    }
    const fogRegions = (() => { try { return JSON.parse(map.fogRegions || '[]'); } catch { return []; } })();
    const hiddenItems = (() => { try { return JSON.parse(map.hiddenItems || '[]'); } catch { return []; } })();
    const stateUpdate = {
      cellSize: map.cellSize || 50,
      offsetX: map.offsetX || 0,
      offsetY: map.offsetY || 0,
      mapWidth: map.mapWidth || 0,
      mapHeight: map.mapHeight || 0,
      hasMap: imgRow ? true : false,
      fogRegions: JSON.stringify(fogRegions),
      hiddenItems: JSON.stringify(hiddenItems),
    };
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState(stateUpdate);
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
    }
    broadcast('table', { action: 'map-updated' });
    broadcast('table', { action: 'fog-updated', fogRegions });
    broadcast('table', { action: 'items-updated', hiddenItems });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/table/state', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { cellSize, offsetX, offsetY, mapWidth, mapHeight } = req.body || {};
    const update = {};
    if (cellSize !== undefined) update.cellSize = Math.max(30, Math.min(150, parseInt(cellSize) || 50));
    if (offsetX !== undefined) update.offsetX = parseInt(offsetX) || 0;
    if (offsetY !== undefined) update.offsetY = parseInt(offsetY) || 0;
    if (mapWidth !== undefined) update.mapWidth = parseInt(mapWidth) || 0;
    if (mapHeight !== undefined) update.mapHeight = parseInt(mapHeight) || 0;
    if (DB_PROVIDER === 'localdb') {
      ldb.updateTableState(update);
    } else {
      await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(update)]);
    }
    broadcast('table', { action: 'state-updated' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/table/tokens', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name, type = 'custom', linkedId = '', x = 0, y = 0, color = '#888888',
            hpCurrent = 0, hpMax = 0, hpTemp = 0, speed = 30, initiativeId = '',
            tokenSize = 1, portrait = null } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    if (!['character','monster','npc','custom'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

    let resolvedInitId = String(initiativeId);
    if (!resolvedInitId) {
      let initBonus = 0;
      try {
        if ((type === 'character' || type === 'npc') && linkedId) {
          const char = await getCharacter(String(linkedId));
          if (char) {
            let cdata = {};
            try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
            initBonus = parseInt(cdata['init']) || 0;
          }
        } else if (type === 'monster' && linkedId) {
          const mon = DB_PROVIDER === 'localdb' ? ldb.getMonster(String(linkedId)) : (await idb.query({ monsters: { $: { where: { id: String(linkedId) } } } })).monsters?.[0];
          if (mon) {
            let mdata = {};
            try { mdata = JSON.parse(mon.dataJson || '{}'); } catch {}
            initBonus = Math.floor(((parseInt(mdata.dex) || 10) - 10) / 2);
          }
        }
      } catch {}
      const d20 = Math.ceil(Math.random() * 20);
      const roll = d20 + initBonus;
      const initEntryId = genId();
      const initFields = {
        name: String(name).trim(), roll,
        charId: (type === 'character' || type === 'npc') ? String(linkedId) : '',
        monsterId: type === 'monster' ? String(linkedId) : '',
        createdAt: new Date().toISOString()
      };
      if (DB_PROVIDER === 'localdb') {
        ldb.createInitEntry(initEntryId, initFields);
      } else {
        await idb.transact([idb.tx.initiativeEntries[initEntryId].update(initFields)]);
      }
      resolvedInitId = initEntryId;
      broadcast('initiative', { action: 'roll' });
      if (type !== 'monster') {
        const chatEntry = {
          id: genId(), sender: String(name).trim(), dice: '1d20', results: [d20],
          modifier: initBonus, total: roll, label: 'Initiative', timestamp: new Date().toISOString()
        };
        if (DB_PROVIDER === 'localdb') {
          ldb.appendChatLog(chatEntry);
        } else {
          chatLog.push(chatEntry);
          if (chatLog.length > CHAT_MAX) chatLog.shift();
        }
        broadcast('chat', chatEntry);
      }
    }

    const newId = genId();
    const token = {
      name: String(name).trim(), type, linkedId: String(linkedId),
      x: parseInt(x) || 0, y: parseInt(y) || 0,
      color: String(color), hpCurrent: parseInt(hpCurrent) || 0,
      hpMax: parseInt(hpMax) || 0, hpTemp: Math.max(0, parseInt(hpTemp) || 0), speed: parseInt(speed) || 30,
      initiativeId: resolvedInitId, movedFt: 0, visible: true,
      tokenSize: Math.max(1, Math.min(4, parseInt(tokenSize) || 1)),
      portrait: typeof portrait === 'string' && (portrait.startsWith('data:image/') || portrait.startsWith('/uploads/')) ? portrait : null,
      createdAt: new Date().toISOString()
    };
    if (DB_PROVIDER === 'localdb') {
      ldb.createTableToken(newId, token);
    } else {
      await idb.transact([idb.tx.tableTokens[newId].update({ id: newId, ...token })]);
    }
    broadcast('table', { action: 'token-added', token: { id: newId, ...token } });
    res.json({ ok: true, id: newId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/table/tokens/:id', async (req, res) => {
  try {
    const tok = DB_PROVIDER === 'localdb' ? ldb.getTableToken(req.params.id) : (await idb.query({ tableTokens: { $: { where: { id: req.params.id } } } })).tableTokens?.[0];
    if (!tok) return res.status(404).json({ error: 'Not found' });

    if (masterAuth(req)) {
      const body = req.body || {};
      const bodyKeys = Object.keys(body);
      if (bodyKeys.length === 2 && body.x !== undefined && body.y !== undefined) {
        const newX = parseInt(body.x) || 0, newY = parseInt(body.y) || 0;
        let currentId = '';
        if (DB_PROVIDER === 'localdb') {
          currentId = ldb.getInitState().currentId || '';
        } else {
          const initResult = await idb.query({ initiativeState: {} });
          currentId = initResult.initiativeState?.[0]?.currentId || '';
        }
        if (currentId) {
          const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
          const dist = Math.max(dx, dy) * 5;
          const newMovedFt = (tok.movedFt || 0) + dist;
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt }); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY, movedFt: newMovedFt })]); }
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
        } else {
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY }); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY })]); }
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: tok.movedFt || 0 });
        }
        return res.json({ ok: true });
      }

      const { name, x, y, color, hpCurrent, hpMax, hpTemp, speed, initiativeId, visible, movedFt, tokenSize } = body;
      const update = {};
      if (name !== undefined)        update.name = String(name).trim();
      if (x !== undefined)           update.x = parseInt(x) || 0;
      if (y !== undefined)           update.y = parseInt(y) || 0;
      if (color !== undefined)       update.color = String(color);
      if (hpCurrent !== undefined)   update.hpCurrent = Math.max(0, parseInt(hpCurrent) || 0);
      if (hpMax !== undefined)       update.hpMax = Math.max(0, parseInt(hpMax) || 0);
      if (hpTemp !== undefined)      update.hpTemp = Math.max(0, parseInt(hpTemp) || 0);
      if (speed !== undefined)       update.speed = Math.max(0, parseInt(speed) || 30);
      if (initiativeId !== undefined) update.initiativeId = String(initiativeId);
      if (visible !== undefined)     update.visible = !!visible;
      if (movedFt !== undefined)     update.movedFt = Math.max(0, parseInt(movedFt) || 0);
      if (tokenSize !== undefined)   update.tokenSize = Math.max(1, Math.min(4, parseInt(tokenSize) || 1));
      if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, update); }
      else { await idb.transact([idb.tx.tableTokens[req.params.id].update(update)]); }
      const updated = { ...tok, ...update };
      broadcast('table', { action: 'token-updated', token: updated });

      const hpChanged = hpCurrent !== undefined || hpMax !== undefined || hpTemp !== undefined;
      if (hpChanged && tok.linkedId && (tok.type === 'character' || tok.type === 'npc')) {
        try {
          const char = await getCharacter(tok.linkedId);
          if (char) {
            let cdata = {};
            try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
            if (hpCurrent !== undefined) cdata.hpcur  = String(update.hpCurrent);
            if (hpMax !== undefined)     cdata.hpmax  = String(update.hpMax);
            if (hpTemp !== undefined)    cdata.hptemp = String(update.hpTemp);
            if (DB_PROVIDER === 'localdb') { ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) }); }
            else { await idb.transact([idb.tx.characters[tok.linkedId].update({ dataJson: JSON.stringify(cdata) })]); }
            broadcast('characters', { action: 'updated', id: tok.linkedId });
          }
        } catch (syncErr) { console.error('char HP sync:', syncErr); }
      }
      res.json({ ok: true });
    } else {
      const body = req.body || {};
      if ((body.hpCurrent !== undefined || body.hpTemp !== undefined) && (tok.type === 'character' || tok.type === 'npc')) {
        const update = {};
        if (body.hpCurrent !== undefined) update.hpCurrent = Math.max(0, parseInt(body.hpCurrent) || 0);
        if (body.hpTemp !== undefined)    update.hpTemp    = Math.max(0, parseInt(body.hpTemp) || 0);
        if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, update); }
        else { await idb.transact([idb.tx.tableTokens[req.params.id].update(update)]); }
        const updated = { ...tok, ...update };
        broadcast('table', { action: 'token-updated', token: updated });
        if (tok.linkedId) {
          try {
            const char = await getCharacter(tok.linkedId);
            if (char) {
              let cdata = {};
              try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
              if (update.hpCurrent !== undefined) cdata.hpcur  = String(update.hpCurrent);
              if (update.hpTemp !== undefined)    cdata.hptemp = String(update.hpTemp);
              if (DB_PROVIDER === 'localdb') { ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) }); }
              else { await idb.transact([idb.tx.characters[tok.linkedId].update({ dataJson: JSON.stringify(cdata) })]); }
              broadcast('characters', { action: 'updated', id: tok.linkedId });
            }
          } catch (syncErr) { console.error('char HP sync:', syncErr); }
        }
        return res.json({ ok: true });
      }

      const { x, y } = body;
      if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
      let currentId = '';
      if (DB_PROVIDER === 'localdb') {
        currentId = ldb.getInitState().currentId || '';
      } else {
        const initResult = await idb.query({ initiativeState: {} });
        currentId = initResult.initiativeState?.[0]?.currentId || '';
      }
      const newX = parseInt(x) || 0, newY = parseInt(y) || 0;
      if (currentId) {
        if (tok.initiativeId && tok.initiativeId !== currentId) return res.status(403).json({ error: 'Not your turn' });
        const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
        const dist = Math.max(dx, dy) * 5;
        const newMovedFt = (tok.movedFt || 0) + dist;
        if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt }); }
        else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY, movedFt: newMovedFt })]); }
        broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
      } else {
        if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY }); }
        else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY })]); }
        broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: tok.movedFt || 0 });
      }
      res.json({ ok: true });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/table/tokens/:id', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const tok = DB_PROVIDER === 'localdb' ? ldb.getTableToken(req.params.id) : (await idb.query({ tableTokens: { $: { where: { id: req.params.id } } } })).tableTokens?.[0];
    if (!tok) return res.status(404).json({ error: 'Not found' });
    if (DB_PROVIDER === 'localdb') { ldb.deleteTableToken(req.params.id); }
    else { await idb.transact([idb.tx.tableTokens[req.params.id].delete()]); }
    broadcast('table', { action: 'token-removed', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/table/ping', async (req, res) => {
  try {
    const { x, y, color = '#ffff00' } = req.body || {};
    if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
    broadcast('table', { action: 'ping', x: parseFloat(x), y: parseFloat(y), color: String(color).slice(0,20) });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/table/clear', async (req, res) => {
  try {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.clearTableTokens();
      ldb.clearInitEntries();
      ldb.setInitState('');
    } else {
      const result = await idb.query({ tableTokens: {}, initiativeEntries: {}, initiativeState: {} });
      const txns = [
        ...(result.tableTokens || []).map(t => idb.tx.tableTokens[t.id].delete()),
        ...(result.initiativeEntries || []).map(e => idb.tx.initiativeEntries[e.id].delete()),
        ...(result.initiativeState || []).map(s => idb.tx.initiativeState[s.id].delete()),
      ];
      if (txns.length > 0) await idb.transact(txns);
    }
    broadcast('table', { action: 'tokens-cleared' });
    broadcast('initiative', { action: 'clear' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const httpServer = createServer(app);

if (DB_PROVIDER === 'localdb') {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', ws => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
}

const PORT = process.env.PORT || 80;
httpServer.listen(PORT, () => console.log(`Server listening on port ${PORT} [${DB_PROVIDER}]`));
