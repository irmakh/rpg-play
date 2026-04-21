/**
 * LocalDB adapter — SQLite-backed alternative to InstantDB.
 * All functions mirror the shape expected by server.js route handlers.
 * better-sqlite3 is synchronous; functions are marked async for API compatibility.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const db = new Database(path.join(__dirname, '..', 'localdb.db'));
db.pragma('journal_mode = DELETE'); // Docker-compatible
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', dataJson TEXT DEFAULT '{}',
    charType TEXT DEFAULT 'pc', passwordHash TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS char_media (
    id TEXT PRIMARY KEY, charId TEXT NOT NULL, originalName TEXT DEFAULT '',
    mimeType TEXT DEFAULT '', dataUrl TEXT DEFAULT '', isPortrait INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shop_config (id TEXT PRIMARY KEY, isOpen INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS shop_items (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', itemType TEXT DEFAULT 'wondrous',
    armorType TEXT DEFAULT 'light', acBase INTEGER DEFAULT 10, valueCp INTEGER DEFAULT 0,
    quantity INTEGER DEFAULT 1, acBonus INTEGER DEFAULT 0, initBonus INTEGER DEFAULT 0,
    speedBonus INTEGER DEFAULT 0, requiresAttunement INTEGER DEFAULT 0, notes TEXT DEFAULT '',
    weaponAtk TEXT DEFAULT '', weaponDmg TEXT DEFAULT '', weaponPropertiesJson TEXT DEFAULT '[]',
    tag TEXT DEFAULT '', createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS purchase_logs (
    id TEXT PRIMARY KEY, charId TEXT NOT NULL DEFAULT '', charName TEXT DEFAULT '',
    itemName TEXT DEFAULT '', qty INTEGER DEFAULT 1, totalCp INTEGER DEFAULT 0,
    purchasedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loot_items (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', description TEXT DEFAULT '',
    visible INTEGER DEFAULT 0, descVisible INTEGER DEFAULT 0, tag TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loot_logs (
    id TEXT PRIMARY KEY, charId TEXT NOT NULL DEFAULT '', charName TEXT DEFAULT '',
    itemName TEXT DEFAULT '', claimedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS monsters (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', cr TEXT DEFAULT '?',
    dataJson TEXT DEFAULT '{}', createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS initiative_entries (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', roll INTEGER DEFAULT 0,
    charId TEXT DEFAULT '', monsterId TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS initiative_state (
    id TEXT PRIMARY KEY, currentId TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS table_tokens (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', type TEXT DEFAULT 'custom',
    linkedId TEXT DEFAULT '', x INTEGER DEFAULT 0, y INTEGER DEFAULT 0,
    color TEXT DEFAULT '#888888', hpCurrent INTEGER DEFAULT 0, hpMax INTEGER DEFAULT 0,
    hpTemp INTEGER DEFAULT 0, speed INTEGER DEFAULT 30, movedFt INTEGER DEFAULT 0,
    initiativeId TEXT DEFAULT '', visible INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS table_state (
    id TEXT PRIMARY KEY, cellSize INTEGER DEFAULT 50, offsetX INTEGER DEFAULT 0,
    offsetY INTEGER DEFAULT 0, mapWidth INTEGER DEFAULT 0, mapHeight INTEGER DEFAULT 0,
    hasMap INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS chat_log (
    id TEXT PRIMARY KEY, entryJson TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS prepared_maps (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '',
    cellSize INTEGER DEFAULT 50, offsetX INTEGER DEFAULT 0,
    offsetY INTEGER DEFAULT 0, mapWidth INTEGER DEFAULT 0,
    mapHeight INTEGER DEFAULT 0, fogRegions TEXT DEFAULT '[]',
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events_state (
    id TEXT PRIMARY KEY, dataJson TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    fr_year INTEGER NOT NULL DEFAULT 1492,
    fr_month INTEGER,
    fr_day INTEGER,
    fr_festival TEXT DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    event_type TEXT DEFAULT 'event',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS calendar_state (
    id TEXT PRIMARY KEY,
    fr_year INTEGER NOT NULL DEFAULT 1492,
    fr_month INTEGER NOT NULL DEFAULT 1,
    fr_day INTEGER NOT NULL DEFAULT 1,
    fr_festival TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS map_drawings (
    id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'line',
    x1 REAL DEFAULT 0, y1 REAL DEFAULT 0, x2 REAL DEFAULT 0, y2 REAL DEFAULT 0,
    color TEXT DEFAULT '#ff4444', thickness INTEGER DEFAULT 2,
    createdAt TEXT DEFAULT (datetime('now'))
  );
`);

// Indexes (idempotent — safe on every startup)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_char_media_charId          ON char_media(charId);
  CREATE INDEX IF NOT EXISTS idx_table_tokens_linkedId      ON table_tokens(linkedId);
  CREATE INDEX IF NOT EXISTS idx_table_tokens_initiativeId  ON table_tokens(initiativeId);
  CREATE INDEX IF NOT EXISTS idx_loot_items_visible         ON loot_items(visible);
`);

// One-time migrations
try { db.exec(`ALTER TABLE table_state ADD COLUMN fogRegions TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN tokenSize INTEGER DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN portrait TEXT`); } catch {}
try { db.exec(`ALTER TABLE prepared_maps ADD COLUMN hiddenItems TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE table_state ADD COLUMN hiddenItems TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN label TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN conditions TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE shop_items ADD COLUMN tag TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE char_media ADD COLUMN thumbUrl TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE char_media ADD COLUMN mediumUrl TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN portraitThumb TEXT`); } catch {}

// Singleton IDs (match server.js constants)
const SHOP_CONFIG_ID  = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const INIT_STATE_ID   = 'c8a04a12-4372-4c78-9abc-def012345601';
const TABLE_STATE_ID  = 'c8a04a12-4372-4c78-9abc-def012345601';
const EVENTS_ID       = 'events-global';
const CAL_STATE_ID    = 'calendar-global';

// Ensure singleton rows exist
db.prepare("INSERT OR IGNORE INTO shop_config (id, isOpen) VALUES (?, 1)").run(SHOP_CONFIG_ID);
db.prepare("INSERT OR IGNORE INTO initiative_state (id, currentId) VALUES (?, '')").run(INIT_STATE_ID);
db.prepare("INSERT OR IGNORE INTO table_state (id) VALUES (?)").run(TABLE_STATE_ID);
db.prepare("INSERT OR IGNORE INTO events_state (id, dataJson) VALUES (?, '{}')").run(EVENTS_ID);
db.prepare("INSERT OR IGNORE INTO calendar_state (id, fr_year, fr_month, fr_day, fr_festival) VALUES (?, 1492, 1, 1, '')").run(CAL_STATE_ID);

// ── Characters ────────────────────────────────────────────────────────────────
export function listCharacters() {
  return db.prepare('SELECT * FROM characters ORDER BY name').all();
}
export function getCharacter(id) {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) || null;
}
export function createCharacter(id, fields) {
  db.prepare('INSERT INTO characters (id, name, dataJson, charType, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.dataJson || '{}', fields.charType || 'pc', fields.passwordHash || '', fields.createdAt || new Date().toISOString());
}
export function updateCharacter(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE characters SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}
export function deleteCharacter(id) {
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}
export function getLinkedTokens(charId) {
  return db.prepare('SELECT * FROM table_tokens WHERE linkedId = ?').all(charId)
    .map(r => ({ ...r, visible: !!r.visible }));
}

// ── Media ─────────────────────────────────────────────────────────────────────
export function listMedia(charId) {
  return db.prepare('SELECT * FROM char_media WHERE charId = ? ORDER BY createdAt').all(charId)
    .map(r => ({ ...r, isPortrait: !!r.isPortrait }));
}
export function getMediaById(id) {
  const r = db.prepare('SELECT * FROM char_media WHERE id = ?').get(id);
  return r ? { ...r, isPortrait: !!r.isPortrait } : null;
}
export function createMedia(id, fields) {
  db.prepare('INSERT INTO char_media (id, charId, originalName, mimeType, dataUrl, thumbUrl, mediumUrl, isPortrait, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.charId || '', fields.originalName || '', fields.mimeType || '', fields.dataUrl || '', fields.thumbUrl || '', fields.mediumUrl || '', fields.isPortrait ? 1 : 0, fields.createdAt || new Date().toISOString());
}
export function setPortrait(charId, mediaId) {
  db.prepare('UPDATE char_media SET isPortrait = 0 WHERE charId = ?').run(charId);
  db.prepare('UPDATE char_media SET isPortrait = 1 WHERE id = ?').run(mediaId);
}
export function deleteMedia(id) {
  db.prepare('DELETE FROM char_media WHERE id = ?').run(id);
}

// ── Shop Config ───────────────────────────────────────────────────────────────
export function getShopConfig() {
  return db.prepare('SELECT * FROM shop_config WHERE id = ?').get(SHOP_CONFIG_ID) || { id: SHOP_CONFIG_ID, isOpen: 1 };
}
export function setShopConfig(isOpen) {
  db.prepare('UPDATE shop_config SET isOpen = ? WHERE id = ?').run(isOpen ? 1 : 0, SHOP_CONFIG_ID);
}

// ── Shop Items ────────────────────────────────────────────────────────────────
export function listShopItems() {
  return db.prepare('SELECT * FROM shop_items ORDER BY createdAt').all()
    .map(r => ({ ...r, requiresAttunement: !!r.requiresAttunement }));
}
export function getShopItem(id) {
  const r = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(id);
  return r ? { ...r, requiresAttunement: !!r.requiresAttunement } : null;
}
export function createShopItem(id, fields) {
  db.prepare('INSERT INTO shop_items (id, name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponPropertiesJson, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.itemType || 'wondrous', fields.armorType || 'light', fields.acBase ?? 10, fields.valueCp ?? 0, fields.quantity ?? 1, fields.acBonus ?? 0, fields.initBonus ?? 0, fields.speedBonus ?? 0, fields.requiresAttunement ? 1 : 0, fields.notes || '', fields.weaponAtk || '', fields.weaponDmg || '', fields.weaponPropertiesJson || '[]', fields.tag || '', fields.createdAt || new Date().toISOString());
}
export function bulkUpdateShopTag(ids, tag) {
  const stmt = db.prepare('UPDATE shop_items SET tag = ? WHERE id = ?');
  for (const id of ids) stmt.run(tag, id);
}
export function updateShopItem(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const mapped = { ...fields };
  if ('requiresAttunement' in mapped) mapped.requiresAttunement = mapped.requiresAttunement ? 1 : 0;
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE shop_items SET ${sets} WHERE id = ?`).run(...Object.values(mapped), id);
}
export function deleteShopItem(id) {
  db.prepare('DELETE FROM shop_items WHERE id = ?').run(id);
}

// ── Purchase Logs ─────────────────────────────────────────────────────────────
export function listPurchaseLogs() {
  return db.prepare('SELECT * FROM purchase_logs ORDER BY purchasedAt DESC LIMIT 500').all();
}
export function createPurchaseLog(id, fields) {
  db.prepare('INSERT INTO purchase_logs (id, charId, charName, itemName, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.charId || '', fields.charName || '', fields.itemName || '', fields.qty || 1, fields.totalCp || 0, fields.purchasedAt || new Date().toISOString());
}

// ── Loot Items ────────────────────────────────────────────────────────────────
export function listLootItems() {
  return db.prepare('SELECT * FROM loot_items ORDER BY createdAt').all()
    .map(r => ({ ...r, visible: !!r.visible, descVisible: !!r.descVisible }));
}
export function getLootItem(id) {
  const r = db.prepare('SELECT * FROM loot_items WHERE id = ?').get(id);
  return r ? { ...r, visible: !!r.visible, descVisible: !!r.descVisible } : null;
}
export function getLootItemsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM loot_items WHERE id IN (${placeholders})`).all(...ids)
    .map(r => ({ ...r, visible: !!r.visible, descVisible: !!r.descVisible }));
}
export function createLootItem(id, fields) {
  db.prepare('INSERT INTO loot_items (id, name, description, visible, descVisible, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.description || '', fields.visible ? 1 : 0, fields.descVisible ? 1 : 0, fields.tag || '', fields.createdAt || new Date().toISOString());
}
export function updateLootItem(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const mapped = { ...fields };
  if ('visible' in mapped) mapped.visible = mapped.visible ? 1 : 0;
  if ('descVisible' in mapped) mapped.descVisible = mapped.descVisible ? 1 : 0;
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE loot_items SET ${sets} WHERE id = ?`).run(...Object.values(mapped), id);
}
export function bulkUpdateLootTag(ids, tag) {
  const stmt = db.prepare('UPDATE loot_items SET tag = ? WHERE id = ?');
  const txn  = db.transaction(() => { for (const id of ids) stmt.run(tag, id); });
  txn();
}
export function deleteLootItem(id) {
  db.prepare('DELETE FROM loot_items WHERE id = ?').run(id);
}
export function bulkDeleteLootItems(ids) {
  const stmt = db.prepare('DELETE FROM loot_items WHERE id = ?');
  const txn  = db.transaction(() => { for (const id of ids) stmt.run(id); });
  txn();
}

// ── Loot Logs ─────────────────────────────────────────────────────────────────
export function listLootLogs() {
  return db.prepare('SELECT * FROM loot_logs ORDER BY claimedAt DESC LIMIT 500').all();
}
export function createLootLog(id, fields) {
  db.prepare('INSERT INTO loot_logs (id, charId, charName, itemName, claimedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, fields.charId || '', fields.charName || '', fields.itemName || '', fields.claimedAt || new Date().toISOString());
}

// ── Monsters ──────────────────────────────────────────────────────────────────
export function listMonsters() {
  return db.prepare('SELECT * FROM monsters ORDER BY name').all();
}
export function getMonster(id) {
  return db.prepare('SELECT * FROM monsters WHERE id = ?').get(id) || null;
}
export function createMonster(id, fields) {
  db.prepare('INSERT INTO monsters (id, name, cr, dataJson, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.cr || '?', fields.dataJson || '{}', fields.createdAt || new Date().toISOString());
}
export function updateMonster(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE monsters SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}
export function deleteMonster(id) {
  db.prepare('DELETE FROM monsters WHERE id = ?').run(id);
}

// ── Initiative ────────────────────────────────────────────────────────────────
export function listInitEntries() {
  return db.prepare('SELECT * FROM initiative_entries ORDER BY roll DESC, createdAt ASC').all();
}
export function getInitEntry(id) {
  return db.prepare('SELECT * FROM initiative_entries WHERE id = ?').get(id) || null;
}
export function createInitEntry(id, fields) {
  db.prepare('INSERT INTO initiative_entries (id, name, roll, charId, monsterId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.roll || 0, fields.charId || '', fields.monsterId || '', fields.createdAt || new Date().toISOString());
}
export function updateInitEntry(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE initiative_entries SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}
export function deleteInitEntry(id) {
  db.prepare('DELETE FROM initiative_entries WHERE id = ?').run(id);
}
export function listOrphanMonsterInitEntries() {
  return db.prepare(`
    SELECT ie.* FROM initiative_entries ie
    WHERE ie.monsterId != ''
      AND ie.id NOT IN (SELECT initiativeId FROM table_tokens WHERE initiativeId != '')
  `).all();
}
export function clearInitEntries() {
  db.prepare('DELETE FROM initiative_entries').run();
}
export function getInitState() {
  return db.prepare('SELECT * FROM initiative_state WHERE id = ?').get(INIT_STATE_ID) || { id: INIT_STATE_ID, currentId: '' };
}
export function setInitState(currentId) {
  db.prepare('UPDATE initiative_state SET currentId = ? WHERE id = ?').run(currentId || '', INIT_STATE_ID);
}

// ── Map Drawings ──────────────────────────────────────────────────────────────
export function listDrawings() {
  return db.prepare('SELECT * FROM map_drawings ORDER BY createdAt ASC').all();
}
export function addDrawing(id, fields) {
  db.prepare('INSERT INTO map_drawings (id, type, x1, y1, x2, y2, color, thickness) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.type || 'line', fields.x1 || 0, fields.y1 || 0, fields.x2 || 0, fields.y2 || 0, fields.color || '#ff4444', fields.thickness || 2);
}
export function deleteDrawing(id) {
  db.prepare('DELETE FROM map_drawings WHERE id = ?').run(id);
}
export function clearDrawings() {
  db.prepare('DELETE FROM map_drawings').run();
}

// ── Table State ───────────────────────────────────────────────────────────────
export function getTableState() {
  return db.prepare('SELECT * FROM table_state WHERE id = ?').get(TABLE_STATE_ID)
    || { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: 0 };
}
export function updateTableState(fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const mapped = { ...fields };
  if ('hasMap' in mapped) mapped.hasMap = mapped.hasMap ? 1 : 0;
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE table_state SET ${sets} WHERE id = ?`).run(...Object.values(mapped), TABLE_STATE_ID);
}

// ── Table Tokens ──────────────────────────────────────────────────────────────
function normalizeToken(r) {
  return r ? { ...r, visible: !!r.visible } : null;
}
export function listTableTokens() {
  return db.prepare('SELECT * FROM table_tokens ORDER BY createdAt').all().map(normalizeToken);
}
export function getTableToken(id) {
  return normalizeToken(db.prepare('SELECT * FROM table_tokens WHERE id = ?').get(id));
}
export function getTableTokensByInitId(initId) {
  return db.prepare('SELECT * FROM table_tokens WHERE initiativeId = ?').all(initId).map(normalizeToken);
}
export function getMovedTableTokens() {
  return db.prepare('SELECT * FROM table_tokens WHERE movedFt > 0').all().map(normalizeToken);
}
export function createTableToken(id, fields) {
  db.prepare('INSERT INTO table_tokens (id, name, type, linkedId, x, y, color, hpCurrent, hpMax, hpTemp, speed, movedFt, initiativeId, visible, tokenSize, portrait, portraitThumb, label, conditions, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.type || 'custom', fields.linkedId || '', fields.x || 0, fields.y || 0, fields.color || '#888888', fields.hpCurrent || 0, fields.hpMax || 0, fields.hpTemp || 0, fields.speed || 30, fields.movedFt || 0, fields.initiativeId || '', fields.visible !== false ? 1 : 0, fields.tokenSize || 1, fields.portrait || null, fields.portraitThumb || null, fields.label || '', fields.conditions || '[]', fields.createdAt || new Date().toISOString());
}
export function updateTableToken(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const mapped = { ...fields };
  if ('visible' in mapped) mapped.visible = mapped.visible ? 1 : 0;
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE table_tokens SET ${sets} WHERE id = ?`).run(...Object.values(mapped), id);
}
export function deleteTableToken(id) {
  db.prepare('DELETE FROM table_tokens WHERE id = ?').run(id);
}
export function clearTableTokens() {
  db.prepare('DELETE FROM table_tokens').run();
}

// ── Chat Log ──────────────────────────────────────────────────────────────────
const CHAT_MAX_LDB = 100;
export function listChatLog() {
  return db.prepare('SELECT entryJson FROM chat_log ORDER BY timestamp ASC LIMIT 100').all()
    .map(r => { try { return JSON.parse(r.entryJson); } catch { return null; } })
    .filter(Boolean);
}
export function appendChatLog(entry) {
  db.prepare('INSERT OR REPLACE INTO chat_log (id, entryJson, timestamp) VALUES (?, ?, ?)')
    .run(entry.id, JSON.stringify(entry), entry.timestamp || new Date().toISOString());
  db.prepare('DELETE FROM chat_log WHERE rowid NOT IN (SELECT rowid FROM chat_log ORDER BY timestamp DESC LIMIT ?)').run(CHAT_MAX_LDB);
}
export function clearChatLog() {
  db.prepare('DELETE FROM chat_log').run();
}

// ── Full import (for restore) ─────────────────────────────────────────────────
export function importAll(data) {
  db.transaction(() => {
    db.prepare('DELETE FROM characters').run();
    db.prepare('DELETE FROM char_media').run();
    db.prepare('DELETE FROM shop_items').run();
    db.prepare('DELETE FROM purchase_logs').run();
    db.prepare('DELETE FROM loot_items').run();
    db.prepare('DELETE FROM loot_logs').run();
    db.prepare('DELETE FROM monsters').run();
    db.prepare('DELETE FROM initiative_entries').run();
    db.prepare('DELETE FROM table_tokens').run();
    db.prepare('DELETE FROM chat_log').run();

    const insChar = db.prepare('INSERT OR REPLACE INTO characters (id, name, dataJson, charType, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of (data.characters || [])) {
      insChar.run(r.id, r.name || '', r.dataJson || '{}', r.charType || 'pc', r.passwordHash || '', r.createdAt || new Date().toISOString());
    }

    const insMedia = db.prepare('INSERT OR REPLACE INTO char_media (id, charId, originalName, mimeType, dataUrl, thumbUrl, mediumUrl, isPortrait, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.media || [])) {
      insMedia.run(r.id, r.charId || '', r.originalName || r.name || '', r.mimeType || '', r.dataUrl || r.dataJson || '', r.thumbUrl || '', r.mediumUrl || '', r.isPortrait ? 1 : 0, r.createdAt || new Date().toISOString());
    }

    if (data.shopConfig && data.shopConfig.length > 0) {
      db.prepare('UPDATE shop_config SET isOpen = ? WHERE id = ?').run(data.shopConfig[0].isOpen ? 1 : 0, SHOP_CONFIG_ID);
    }

    const insShop = db.prepare('INSERT OR REPLACE INTO shop_items (id, name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponPropertiesJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.shopItems || [])) {
      insShop.run(r.id, r.name || '', r.itemType || 'wondrous', r.armorType || 'light', r.acBase ?? 10, r.valueCp ?? 0, r.quantity ?? 1, r.acBonus ?? 0, r.initBonus ?? 0, r.speedBonus ?? 0, r.requiresAttunement ? 1 : 0, r.notes || '', r.weaponAtk || '', r.weaponDmg || '', r.weaponPropertiesJson || '[]', r.createdAt || new Date().toISOString());
    }

    const insPurch = db.prepare('INSERT OR REPLACE INTO purchase_logs (id, charId, charName, itemName, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.purchaseLogs || [])) {
      insPurch.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.qty || 1, r.totalCp || 0, r.purchasedAt || r.createdAt || new Date().toISOString());
    }

    const insLoot = db.prepare('INSERT OR REPLACE INTO loot_items (id, name, description, visible, descVisible, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.lootItems || [])) {
      insLoot.run(r.id, r.name || '', r.description || '', r.visible ? 1 : 0, r.descVisible ? 1 : 0, r.tag || '', r.createdAt || new Date().toISOString());
    }

    const insLootLog = db.prepare('INSERT OR REPLACE INTO loot_logs (id, charId, charName, itemName, claimedAt) VALUES (?, ?, ?, ?, ?)');
    for (const r of (data.lootLogs || [])) {
      insLootLog.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.claimedAt || r.createdAt || new Date().toISOString());
    }

    const insMon = db.prepare('INSERT OR REPLACE INTO monsters (id, name, cr, dataJson, createdAt) VALUES (?, ?, ?, ?, ?)');
    for (const r of (data.monsters || [])) {
      insMon.run(r.id, r.name || '', r.cr || '?', r.dataJson || '{}', r.createdAt || new Date().toISOString());
    }

    const insInit = db.prepare('INSERT OR REPLACE INTO initiative_entries (id, name, roll, charId, monsterId, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of (data.initiativeEntries || [])) {
      insInit.run(r.id, r.name || '', r.roll || 0, r.charId || '', r.monsterId || '', r.createdAt || new Date().toISOString());
    }

    if (data.initiativeState && data.initiativeState.length > 0) {
      db.prepare('UPDATE initiative_state SET currentId = ? WHERE id = ?').run(data.initiativeState[0].currentId || '', INIT_STATE_ID);
    }

    const insTok = db.prepare('INSERT OR REPLACE INTO table_tokens (id, name, type, linkedId, x, y, color, hpCurrent, hpMax, hpTemp, speed, movedFt, initiativeId, visible, tokenSize, portrait, portraitThumb, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.tableTokens || [])) {
      insTok.run(r.id, r.name || '', r.type || 'custom', r.linkedId || '', r.x || 0, r.y || 0, r.color || '#888888', r.hpCurrent || 0, r.hpMax || 0, r.hpTemp || 0, r.speed || 30, r.movedFt || 0, r.initiativeId || '', r.visible !== false ? 1 : 0, r.tokenSize || 1, r.portrait || null, r.portraitThumb || null, r.createdAt || new Date().toISOString());
    }

    if (data.tableState && data.tableState.length > 0) {
      const ts = data.tableState[0];
      const fr = Array.isArray(ts.fogRegions) ? JSON.stringify(ts.fogRegions) : (ts.fogRegions || '[]');
      const hi = Array.isArray(ts.hiddenItems) ? JSON.stringify(ts.hiddenItems) : (ts.hiddenItems || '[]');
      db.prepare('UPDATE table_state SET cellSize=?, offsetX=?, offsetY=?, mapWidth=?, mapHeight=?, hasMap=?, fogRegions=?, hiddenItems=? WHERE id=?')
        .run(ts.cellSize || 50, ts.offsetX || 0, ts.offsetY || 0, ts.mapWidth || 0, ts.mapHeight || 0, ts.hasMap ? 1 : 0, fr, hi, TABLE_STATE_ID);
    }

    const insChat = db.prepare('INSERT OR REPLACE INTO chat_log (id, entryJson, timestamp) VALUES (?, ?, ?)');
    for (const r of (data.chatLog || [])) {
      insChat.run(r.id || String(Date.now()), JSON.stringify(r), r.timestamp || new Date().toISOString());
    }

    db.prepare('DELETE FROM prepared_maps').run();
    const insPrep = db.prepare('INSERT OR REPLACE INTO prepared_maps (id, name, cellSize, offsetX, offsetY, mapWidth, mapHeight, fogRegions, hiddenItems, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.preparedMaps || [])) {
      const fr = Array.isArray(r.fogRegions) ? JSON.stringify(r.fogRegions) : (r.fogRegions || '[]');
      const hi = Array.isArray(r.hiddenItems) ? JSON.stringify(r.hiddenItems) : (r.hiddenItems || '[]');
      insPrep.run(r.id, r.name || '', r.cellSize || 50, r.offsetX || 0, r.offsetY || 0, r.mapWidth || 0, r.mapHeight || 0, fr, hi, r.createdAt || new Date().toISOString());
    }
  })();
}

// ── Selective imports (merge — no deletes, duplicate IDs get _old prefix) ─────
function _oldName(name) { return name.startsWith('_old ') ? name : '_old ' + name; }

export function importCharacters(characters, media) {
  const getChar  = db.prepare('SELECT name FROM characters WHERE id = ?');
  const rekeyChar = db.prepare('UPDATE characters SET id = ?, name = ? WHERE id = ?');
  const insChar  = db.prepare('INSERT OR IGNORE INTO characters (id, name, dataJson, charType, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
  const insMedia = db.prepare('INSERT OR IGNORE INTO char_media (id, charId, originalName, mimeType, dataUrl, thumbUrl, mediumUrl, isPortrait, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of (characters || [])) {
      const ex = getChar.get(r.id);
      if (ex) rekeyChar.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      insChar.run(r.id, r.name || '', r.dataJson || '{}', r.charType || 'pc', r.passwordHash || '', r.createdAt || new Date().toISOString());
    }
    for (const r of (media || [])) insMedia.run(r.id, r.charId || '', r.originalName || r.name || '', r.mimeType || '', r.dataUrl || '', r.thumbUrl || '', r.mediumUrl || '', r.isPortrait ? 1 : 0, r.createdAt || new Date().toISOString());
  })();
}

export function importMonsters(monsters) {
  const getMon  = db.prepare('SELECT name FROM monsters WHERE id = ?');
  const rekeyMon = db.prepare('UPDATE monsters SET id = ?, name = ? WHERE id = ?');
  const ins     = db.prepare('INSERT OR IGNORE INTO monsters (id, name, cr, dataJson, createdAt) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of (monsters || [])) {
      const ex = getMon.get(r.id);
      if (ex) rekeyMon.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      ins.run(r.id, r.name || '', r.cr || '?', r.dataJson || '{}', r.createdAt || new Date().toISOString());
    }
  })();
}

export function importShop(shopConfig, shopItems, purchaseLogs) {
  const getItem  = db.prepare('SELECT name FROM shop_items WHERE id = ?');
  const rekeyItem = db.prepare('UPDATE shop_items SET id = ?, name = ? WHERE id = ?');
  const insShop  = db.prepare('INSERT OR IGNORE INTO shop_items (id, name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponPropertiesJson, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insPurch = db.prepare('INSERT OR IGNORE INTO purchase_logs (id, charId, charName, itemName, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    if (shopConfig && shopConfig.length > 0) db.prepare('UPDATE shop_config SET isOpen = ? WHERE id = ?').run(shopConfig[0].isOpen ? 1 : 0, SHOP_CONFIG_ID);
    for (const r of (shopItems || [])) {
      const ex = getItem.get(r.id);
      if (ex) rekeyItem.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      insShop.run(r.id, r.name || '', r.itemType || 'wondrous', r.armorType || 'light', r.acBase ?? 10, r.valueCp ?? 0, r.quantity ?? 1, r.acBonus ?? 0, r.initBonus ?? 0, r.speedBonus ?? 0, r.requiresAttunement ? 1 : 0, r.notes || '', r.weaponAtk || '', r.weaponDmg || '', r.weaponPropertiesJson || '[]', r.tag || '', r.createdAt || new Date().toISOString());
    }
    for (const r of (purchaseLogs || [])) insPurch.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.qty || 1, r.totalCp || 0, r.purchasedAt || r.createdAt || new Date().toISOString());
  })();
}

export function importLoot(lootItems, lootLogs) {
  const getItem  = db.prepare('SELECT name FROM loot_items WHERE id = ?');
  const rekeyItem = db.prepare('UPDATE loot_items SET id = ?, name = ? WHERE id = ?');
  const insLoot  = db.prepare('INSERT OR IGNORE INTO loot_items (id, name, description, visible, descVisible, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insLog   = db.prepare('INSERT OR IGNORE INTO loot_logs (id, charId, charName, itemName, claimedAt) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of (lootItems || [])) {
      const ex = getItem.get(r.id);
      if (ex) rekeyItem.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      insLoot.run(r.id, r.name || '', r.description || '', r.visible ? 1 : 0, r.descVisible ? 1 : 0, r.tag || '', r.createdAt || new Date().toISOString());
    }
    for (const r of (lootLogs || [])) insLog.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.claimedAt || r.createdAt || new Date().toISOString());
  })();
}

export function importMaps(preparedMaps) {
  const getMap  = db.prepare('SELECT name FROM prepared_maps WHERE id = ?');
  const rekeyMap = db.prepare('UPDATE prepared_maps SET id = ?, name = ? WHERE id = ?');
  const ins     = db.prepare('INSERT OR IGNORE INTO prepared_maps (id, name, cellSize, offsetX, offsetY, mapWidth, mapHeight, fogRegions, hiddenItems, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of (preparedMaps || [])) {
      const ex = getMap.get(r.id);
      if (ex) rekeyMap.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      const fr = Array.isArray(r.fogRegions) ? JSON.stringify(r.fogRegions) : (r.fogRegions || '[]');
      const hi = Array.isArray(r.hiddenItems) ? JSON.stringify(r.hiddenItems) : (r.hiddenItems || '[]');
      ins.run(r.id, r.name || '', r.cellSize || 50, r.offsetX || 0, r.offsetY || 0, r.mapWidth || 0, r.mapHeight || 0, fr, hi, r.createdAt || new Date().toISOString());
    }
  })();
}

// ── Prepared Maps ─────────────────────────────────────────────────────────────
export function listPreparedMaps() {
  return db.prepare('SELECT * FROM prepared_maps ORDER BY createdAt DESC').all();
}
export function getPreparedMap(id) {
  return db.prepare('SELECT * FROM prepared_maps WHERE id = ?').get(id) || null;
}
export function createPreparedMap(id, fields) {
  db.prepare('INSERT INTO prepared_maps (id, name, cellSize, offsetX, offsetY, mapWidth, mapHeight, fogRegions, hiddenItems, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.cellSize || 50, fields.offsetX || 0, fields.offsetY || 0, fields.mapWidth || 0, fields.mapHeight || 0, fields.fogRegions || '[]', fields.hiddenItems || '[]', fields.createdAt || new Date().toISOString());
}
export function updatePreparedMap(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE prepared_maps SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}
export function deletePreparedMap(id) {
  db.prepare('DELETE FROM prepared_maps WHERE id = ?').run(id);
}

// ── Events (legacy) ───────────────────────────────────────────────────────────
export function getEventsData() {
  const r = db.prepare('SELECT dataJson FROM events_state WHERE id = ?').get(EVENTS_ID);
  try { return JSON.parse(r?.dataJson || '{}'); } catch { return {}; }
}
export function saveEventsData(data) {
  db.prepare('INSERT OR REPLACE INTO events_state (id, dataJson) VALUES (?, ?)').run(EVENTS_ID, JSON.stringify(data));
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function _calRow(r) {
  return {
    id: r.id, title: r.title, description: r.description || '',
    frYear: r.fr_year, frMonth: r.fr_month, frDay: r.fr_day,
    frFestival: r.fr_festival || '', isPublic: !!r.is_public,
    eventType: r.event_type, createdAt: r.created_at,
  };
}

export function getCalendarState() {
  const r = db.prepare('SELECT * FROM calendar_state WHERE id = ?').get(CAL_STATE_ID);
  if (!r) return { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
  return { frYear: r.fr_year, frMonth: r.fr_month, frDay: r.fr_day, frFestival: r.fr_festival || '' };
}

export function saveCalendarState(s) {
  db.prepare('INSERT OR REPLACE INTO calendar_state (id, fr_year, fr_month, fr_day, fr_festival) VALUES (?,?,?,?,?)')
    .run(CAL_STATE_ID, s.frYear, s.frMonth ?? null, s.frDay ?? null, s.frFestival || '');
}

export function listCalendarEvents(publicOnly = false) {
  const q = publicOnly
    ? 'SELECT * FROM calendar_events WHERE is_public = 1 ORDER BY fr_year, fr_month NULLS LAST, fr_day NULLS LAST'
    : 'SELECT * FROM calendar_events ORDER BY fr_year, fr_month NULLS LAST, fr_day NULLS LAST';
  return db.prepare(q).all().map(_calRow);
}

export function createCalendarEvent(ev) {
  db.prepare('INSERT INTO calendar_events (id,title,description,fr_year,fr_month,fr_day,fr_festival,is_public,event_type) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(ev.id, ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event');
}

export function updateCalendarEvent(id, ev) {
  db.prepare('UPDATE calendar_events SET title=?,description=?,fr_year=?,fr_month=?,fr_day=?,fr_festival=?,is_public=?,event_type=? WHERE id=?')
    .run(ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event', id);
}

export function deleteCalendarEvent(id) {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
}

// ── Full export (for backup) ──────────────────────────────────────────────────
export function exportAll() {
  return {
    characters: db.prepare('SELECT * FROM characters').all(),
    media: db.prepare('SELECT * FROM char_media').all().map(r => ({ ...r, isPortrait: !!r.isPortrait })),
    shopConfig: db.prepare('SELECT * FROM shop_config').all(),
    shopItems: db.prepare('SELECT * FROM shop_items').all().map(r => ({ ...r, requiresAttunement: !!r.requiresAttunement })),
    purchaseLogs: db.prepare('SELECT * FROM purchase_logs').all(),
    lootItems: listLootItems(),
    lootLogs: db.prepare('SELECT * FROM loot_logs').all(),
    monsters: db.prepare('SELECT * FROM monsters').all(),
    initiativeEntries: db.prepare('SELECT * FROM initiative_entries').all(),
    initiativeState: db.prepare('SELECT * FROM initiative_state').all(),
    tableTokens: listTableTokens(),
    tableState: db.prepare('SELECT * FROM table_state').all(),
    chatLog: listChatLog(),
    preparedMaps: listPreparedMaps(),
  };
}
