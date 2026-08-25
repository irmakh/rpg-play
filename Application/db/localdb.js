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
  CREATE TABLE IF NOT EXISTS shop_config (id TEXT PRIMARY KEY, isOpen INTEGER DEFAULT 1, activeTag TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS shop_items (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', itemType TEXT DEFAULT 'wondrous',
    armorType TEXT DEFAULT 'light', acBase INTEGER DEFAULT 10, valueCp INTEGER DEFAULT 0,
    quantity INTEGER DEFAULT 1, acBonus INTEGER DEFAULT 0, initBonus INTEGER DEFAULT 0,
    speedBonus INTEGER DEFAULT 0, spellAtkBonus INTEGER DEFAULT 0, spellDcBonus INTEGER DEFAULT 0,
    requiresAttunement INTEGER DEFAULT 0, notes TEXT DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS treasury_items (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', tag TEXT DEFAULT '',
    mode TEXT DEFAULT 'hidden', description TEXT DEFAULT '', descVisible INTEGER DEFAULT 0,
    itemType TEXT DEFAULT 'other', armorType TEXT DEFAULT 'light', acBase INTEGER DEFAULT 10,
    valueCp INTEGER DEFAULT 0, quantity INTEGER DEFAULT 1,
    acBonus INTEGER DEFAULT 0, initBonus INTEGER DEFAULT 0, speedBonus INTEGER DEFAULT 0,
    spellAtkBonus INTEGER DEFAULT 0, spellDcBonus INTEGER DEFAULT 0,
    requiresAttunement INTEGER DEFAULT 0,
    weaponAtk TEXT DEFAULT '', weaponDmg TEXT DEFAULT '', weaponPropertiesJson TEXT DEFAULT '[]',
    imageUrl TEXT DEFAULT '', imageThumb TEXT DEFAULT '', imageMedium TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
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
  CREATE TABLE IF NOT EXISTS sound_files (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', url TEXT DEFAULT '',
    mime_type TEXT DEFAULT '', tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY, name TEXT DEFAULT '', type TEXT DEFAULT 'generic',
    tags TEXT DEFAULT '[]', map_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS weather_config (
    id TEXT PRIMARY KEY, session_normal INTEGER DEFAULT 60,
    level1_min INTEGER DEFAULT 15, level2_min INTEGER DEFAULT 18
  );
  CREATE TABLE IF NOT EXISTS weather_log (
    id TEXT PRIMARY KEY,
    fr_year INTEGER, fr_month INTEGER, fr_day INTEGER, fr_festival TEXT DEFAULT '',
    date_label TEXT DEFAULT '',
    session_normal INTEGER DEFAULT 60,
    temp_roll INTEGER, temp_level TEXT, temp_dice TEXT DEFAULT '[]', temperature INTEGER,
    wind_roll INTEGER, wind_level TEXT, wind TEXT,
    precip_roll INTEGER, precip_level TEXT, precipitation TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Indexes (idempotent — safe on every startup)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_char_media_charId          ON char_media(charId);
  CREATE INDEX IF NOT EXISTS idx_table_tokens_linkedId      ON table_tokens(linkedId);
  CREATE INDEX IF NOT EXISTS idx_table_tokens_initiativeId  ON table_tokens(initiativeId);
  CREATE INDEX IF NOT EXISTS idx_loot_items_visible         ON loot_items(visible);
  CREATE INDEX IF NOT EXISTS idx_treasury_items_mode        ON treasury_items(mode);
  CREATE INDEX IF NOT EXISTS idx_treasury_items_tag         ON treasury_items(tag);
  CREATE INDEX IF NOT EXISTS idx_loot_logs_charId           ON loot_logs(charId);
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
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN ac INTEGER`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN assignedCharId TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE playlists ADD COLUMN sounds TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE table_tokens ADD COLUMN customPortrait INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE calendar_events ADD COLUMN author_char_id TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE calendar_events ADD COLUMN author_name    TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE calendar_events ADD COLUMN media_json     TEXT DEFAULT '[]'`); } catch {}
// Treasury: logs record which catalogue item was taken, so claim-once dedupe and
// the merged ledger can resolve back to it (legacy rows keep an empty itemId).
try { db.exec(`ALTER TABLE loot_logs     ADD COLUMN itemId TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE purchase_logs ADD COLUMN itemId TEXT DEFAULT ''`); } catch {}

// Singleton IDs (match server.js constants)
const SHOP_CONFIG_ID  = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const INIT_STATE_ID   = 'c8a04a12-4372-4c78-9abc-def012345601';
const TABLE_STATE_ID  = 'c8a04a12-4372-4c78-9abc-def012345601';
const EVENTS_ID       = 'events-global';
const CAL_STATE_ID    = 'calendar-global';

// Ensure singleton rows exist
db.prepare("INSERT OR IGNORE INTO shop_config (id, isOpen) VALUES (?, 1)").run(SHOP_CONFIG_ID);
try { db.prepare("ALTER TABLE shop_config ADD COLUMN activeTag TEXT DEFAULT ''").run(); } catch {}
// The shop can be opened for several tags at once; activeTags (a JSON array) is
// the source of truth and activeTag keeps the first of them for older readers.
try { db.prepare("ALTER TABLE shop_config ADD COLUMN activeTags TEXT DEFAULT '[]'").run(); } catch {}
try {
  const _sc = db.prepare('SELECT activeTag, activeTags FROM shop_config WHERE id = ?').get(SHOP_CONFIG_ID);
  if (_sc && _sc.activeTag && (!_sc.activeTags || _sc.activeTags === '[]')) {
    db.prepare('UPDATE shop_config SET activeTags = ? WHERE id = ?').run(JSON.stringify([_sc.activeTag]), SHOP_CONFIG_ID);
  }
} catch {}
try { db.prepare("ALTER TABLE shop_items ADD COLUMN spellAtkBonus INTEGER DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE shop_items ADD COLUMN spellDcBonus INTEGER DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE prepared_maps ADD COLUMN preparedTokens TEXT DEFAULT '[]'").run(); } catch {}
try { db.prepare("ALTER TABLE weather_config ADD COLUMN level1_min INTEGER DEFAULT 15").run(); } catch {}
try { db.prepare("ALTER TABLE weather_config ADD COLUMN level2_min INTEGER DEFAULT 18").run(); } catch {}
db.prepare("INSERT OR IGNORE INTO initiative_state (id, currentId) VALUES (?, '')").run(INIT_STATE_ID);
db.prepare("INSERT OR IGNORE INTO table_state (id) VALUES (?)").run(TABLE_STATE_ID);
db.prepare("INSERT OR IGNORE INTO events_state (id, dataJson) VALUES (?, '{}')").run(EVENTS_ID);
db.prepare("INSERT OR IGNORE INTO calendar_state (id, fr_year, fr_month, fr_day, fr_festival) VALUES (?, 1492, 1, 1, '')").run(CAL_STATE_ID);

// ── Legacy → treasury converters ──────────────────────────────────────────────
// Shared by the one-time boot migration and by backup restore, so an old
// loot/shop backup file lands in exactly the same shape as a migrated row.
const TREASURY_BLANK = {
  itemType: 'other', armorType: 'light', acBase: 10, valueCp: 0, quantity: 1,
  acBonus: 0, initBonus: 0, speedBonus: 0, spellAtkBonus: 0, spellDcBonus: 0,
  requiresAttunement: 0, weaponAtk: '', weaponDmg: '', weaponPropertiesJson: '[]',
  imageUrl: '', imageThumb: '', imageMedium: '',
};
export function lootRowToTreasury(r) {
  return {
    ...TREASURY_BLANK,
    name: r.name || '', tag: r.tag || '',
    mode: r.visible ? 'loot' : 'hidden',
    description: r.description || '', descVisible: !!r.descVisible,
    createdAt: r.createdAt || new Date().toISOString(),
  };
}
export function shopRowToTreasury(r) {
  return {
    name: r.name || '', tag: r.tag || '', mode: 'shop',
    // Shop notes were always player-visible, so they migrate as a visible description.
    description: r.notes || '', descVisible: true,
    itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light', acBase: r.acBase ?? 10,
    valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1,
    acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0,
    spellAtkBonus: r.spellAtkBonus ?? 0, spellDcBonus: r.spellDcBonus ?? 0,
    requiresAttunement: !!r.requiresAttunement,
    weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '',
    weaponPropertiesJson: r.weaponPropertiesJson || '[]',
    imageUrl: '', imageThumb: '', imageMedium: '',
    createdAt: r.createdAt || new Date().toISOString(),
  };
}

// ── Treasury migration ────────────────────────────────────────────────────────
// loot_items + shop_items fold into the unified treasury_items catalogue. Runs
// once, while treasury_items is still empty. Ids are preserved so existing
// _loots entries and log rows still resolve. The legacy tables are deliberately
// left intact as a rollback path; they are dropped in a later release.
(function migrateTreasury() {
  if (db.prepare('SELECT COUNT(*) AS n FROM treasury_items').get().n > 0) return;
  const lootRows = db.prepare('SELECT * FROM loot_items').all();
  const shopRows = db.prepare('SELECT * FROM shop_items').all();
  if (lootRows.length === 0 && shopRows.length === 0) return;
  db.transaction(() => {
    for (const r of lootRows) createTreasuryItem(r.id, lootRowToTreasury(r));
    for (const r of shopRows) createTreasuryItem(r.id, shopRowToTreasury(r));
  })();
  console.log(`[treasury] migrated ${lootRows.length} loot + ${shopRows.length} shop items`);
})();

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
export const SHOP_MAX_ACTIVE_TAGS = 50;
// Accepts an array, a single string, or nothing; returns a clean, deduped list.
export function normalizeShopTags(tags) {
  const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  return [...new Set(list.map(t => String(t).trim().slice(0, 40)).filter(Boolean))]
    .slice(0, SHOP_MAX_ACTIVE_TAGS);
}
export function getShopConfig() {
  const r = db.prepare('SELECT * FROM shop_config WHERE id = ?').get(SHOP_CONFIG_ID)
    || { id: SHOP_CONFIG_ID, isOpen: 1, activeTag: '', activeTags: '[]' };
  let list = [];
  try { const a = JSON.parse(r.activeTags || '[]'); if (Array.isArray(a)) list = a.filter(Boolean).map(String); } catch {}
  // Fall back to the legacy single tag when the list has not been written yet.
  if (list.length === 0 && r.activeTag) list = [r.activeTag];
  return { ...r, activeTags: list, activeTag: list[0] || '' };
}
export function setShopConfig(isOpen, activeTags = []) {
  const uniq = normalizeShopTags(activeTags);
  db.prepare('UPDATE shop_config SET isOpen = ?, activeTag = ?, activeTags = ? WHERE id = ?')
    .run(isOpen ? 1 : 0, uniq[0] || '', JSON.stringify(uniq), SHOP_CONFIG_ID);
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
  db.prepare('INSERT INTO purchase_logs (id, charId, charName, itemName, itemId, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.charId || '', fields.charName || '', fields.itemName || '', fields.itemId || '', fields.qty || 1, fields.totalCp || 0, fields.purchasedAt || new Date().toISOString());
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
  db.prepare('INSERT INTO loot_logs (id, charId, charName, itemName, itemId, claimedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, fields.charId || '', fields.charName || '', fields.itemName || '', fields.itemId || '', fields.claimedAt || new Date().toISOString());
}
export function listClaimedItemIds(charId) {
  return db.prepare("SELECT DISTINCT itemId FROM loot_logs WHERE charId = ? AND itemId != ''").all(charId)
    .map(r => r.itemId);
}

// ── Treasury Items ────────────────────────────────────────────────────────────
// Unified catalogue replacing loot_items + shop_items. `mode` is one of
// 'hidden' (DM only), 'loot' (free claim) or 'shop' (for sale).
const TREASURY_BOOLS = ['descVisible', 'requiresAttunement'];
function treasuryRow(r) {
  if (!r) return null;
  return { ...r, descVisible: !!r.descVisible, requiresAttunement: !!r.requiresAttunement };
}
export function listTreasuryItems() {
  return db.prepare('SELECT * FROM treasury_items ORDER BY createdAt').all().map(treasuryRow);
}
export function listTreasuryItemsByMode(mode) {
  return db.prepare('SELECT * FROM treasury_items WHERE mode = ? ORDER BY createdAt').all(mode).map(treasuryRow);
}
export function getTreasuryItem(id) {
  return treasuryRow(db.prepare('SELECT * FROM treasury_items WHERE id = ?').get(id));
}
export function getTreasuryItemsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM treasury_items WHERE id IN (${placeholders})`).all(...ids).map(treasuryRow);
}
export function createTreasuryItem(id, fields) {
  db.prepare(`INSERT INTO treasury_items
    (id, name, tag, mode, description, descVisible, itemType, armorType, acBase, valueCp, quantity,
     acBonus, initBonus, speedBonus, spellAtkBonus, spellDcBonus, requiresAttunement,
     weaponAtk, weaponDmg, weaponPropertiesJson, imageUrl, imageThumb, imageMedium, createdAt)
    VALUES (@id, @name, @tag, @mode, @description, @descVisible, @itemType, @armorType, @acBase, @valueCp, @quantity,
     @acBonus, @initBonus, @speedBonus, @spellAtkBonus, @spellDcBonus, @requiresAttunement,
     @weaponAtk, @weaponDmg, @weaponPropertiesJson, @imageUrl, @imageThumb, @imageMedium, @createdAt)`)
    .run({
      id,
      name: fields.name || '', tag: fields.tag || '', mode: fields.mode || 'hidden',
      description: fields.description || '', descVisible: fields.descVisible ? 1 : 0,
      itemType: fields.itemType || 'other', armorType: fields.armorType || 'light',
      acBase: fields.acBase ?? 10, valueCp: fields.valueCp ?? 0, quantity: fields.quantity ?? 1,
      acBonus: fields.acBonus ?? 0, initBonus: fields.initBonus ?? 0, speedBonus: fields.speedBonus ?? 0,
      spellAtkBonus: fields.spellAtkBonus ?? 0, spellDcBonus: fields.spellDcBonus ?? 0,
      requiresAttunement: fields.requiresAttunement ? 1 : 0,
      weaponAtk: fields.weaponAtk || '', weaponDmg: fields.weaponDmg || '',
      weaponPropertiesJson: fields.weaponPropertiesJson || '[]',
      imageUrl: fields.imageUrl || '', imageThumb: fields.imageThumb || '', imageMedium: fields.imageMedium || '',
      createdAt: fields.createdAt || new Date().toISOString(),
    });
}
export function updateTreasuryItem(id, fields) {
  if (!fields || Object.keys(fields).length === 0) return;
  const mapped = { ...fields };
  for (const k of TREASURY_BOOLS) if (k in mapped) mapped[k] = mapped[k] ? 1 : 0;
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE treasury_items SET ${sets} WHERE id = ?`).run(...Object.values(mapped), id);
}
export function deleteTreasuryItem(id) {
  db.prepare('DELETE FROM treasury_items WHERE id = ?').run(id);
}
export function bulkUpdateTreasuryTag(ids, tag) {
  const stmt = db.prepare('UPDATE treasury_items SET tag = ? WHERE id = ?');
  db.transaction(() => { for (const id of ids) stmt.run(tag, id); })();
}
export function bulkUpdateTreasuryMode(ids, mode) {
  const stmt = db.prepare('UPDATE treasury_items SET mode = ? WHERE id = ?');
  db.transaction(() => { for (const id of ids) stmt.run(mode, id); })();
}
export function bulkDeleteTreasuryItems(ids) {
  const stmt = db.prepare('DELETE FROM treasury_items WHERE id = ?');
  db.transaction(() => { for (const id of ids) stmt.run(id); })();
}
export function bulkCreateTreasuryItems(rows) {
  db.transaction(() => { for (const { id, fields } of rows) createTreasuryItem(id, fields); })();
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
// Find a player's entry by their character id. Only matches non-empty charIds,
// so monster/name-only entries (charId='') can never be matched by accident.
export function getInitEntryByCharId(charId) {
  if (!charId) return null;
  return db.prepare("SELECT * FROM initiative_entries WHERE charId = ? AND charId != '' LIMIT 1").get(String(charId)) || null;
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
export function updateDrawing(id, fields) {
  db.prepare('UPDATE map_drawings SET type=?, x1=?, y1=?, x2=?, y2=?, color=?, thickness=? WHERE id=?')
    .run(fields.type || 'line', fields.x1 || 0, fields.y1 || 0, fields.x2 || 0, fields.y2 || 0, fields.color || '#ff4444', fields.thickness || 2, id);
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
  db.prepare('INSERT INTO table_tokens (id, name, type, linkedId, assignedCharId, x, y, color, hpCurrent, hpMax, hpTemp, speed, movedFt, initiativeId, visible, tokenSize, portrait, portraitThumb, label, conditions, ac, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.type || 'custom', fields.linkedId || '', fields.assignedCharId || '', fields.x || 0, fields.y || 0, fields.color || '#888888', fields.hpCurrent || 0, fields.hpMax || 0, fields.hpTemp || 0, fields.speed || 30, fields.movedFt || 0, fields.initiativeId || '', fields.visible !== false ? 1 : 0, fields.tokenSize || 1, fields.portrait || null, fields.portraitThumb || null, fields.label || '', fields.conditions || '[]', fields.ac ?? null, fields.createdAt || new Date().toISOString());
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
export function deleteChatMessage(id) {
  db.prepare('DELETE FROM chat_log WHERE id = ?').run(id);
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
    db.prepare('DELETE FROM treasury_items').run();
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
      const sc = data.shopConfig[0];
      setShopConfig(sc.isOpen, sc.activeTags ?? sc.activeTag);
    }

    const insShop = db.prepare('INSERT OR REPLACE INTO shop_items (id, name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponPropertiesJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.shopItems || [])) {
      insShop.run(r.id, r.name || '', r.itemType || 'wondrous', r.armorType || 'light', r.acBase ?? 10, r.valueCp ?? 0, r.quantity ?? 1, r.acBonus ?? 0, r.initBonus ?? 0, r.speedBonus ?? 0, r.requiresAttunement ? 1 : 0, r.notes || '', r.weaponAtk || '', r.weaponDmg || '', r.weaponPropertiesJson || '[]', r.createdAt || new Date().toISOString());
    }

    const insPurch = db.prepare('INSERT OR REPLACE INTO purchase_logs (id, charId, charName, itemName, itemId, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.purchaseLogs || [])) {
      insPurch.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.itemId || '', r.qty || 1, r.totalCp || 0, r.purchasedAt || r.createdAt || new Date().toISOString());
    }

    const insLoot = db.prepare('INSERT OR REPLACE INTO loot_items (id, name, description, visible, descVisible, tag, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.lootItems || [])) {
      insLoot.run(r.id, r.name || '', r.description || '', r.visible ? 1 : 0, r.descVisible ? 1 : 0, r.tag || '', r.createdAt || new Date().toISOString());
    }

    const insLootLog = db.prepare('INSERT OR REPLACE INTO loot_logs (id, charId, charName, itemName, itemId, claimedAt) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of (data.lootLogs || [])) {
      insLootLog.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.itemId || '', r.claimedAt || r.createdAt || new Date().toISOString());
    }

    // Treasury: a current backup carries treasuryItems directly; an older one
    // only has shopItems/lootItems, which convert on the way in.
    if (Array.isArray(data.treasuryItems) && data.treasuryItems.length > 0) {
      for (const r of data.treasuryItems) createTreasuryItem(r.id, r);
    } else {
      for (const r of (data.lootItems || [])) createTreasuryItem(r.id, lootRowToTreasury(r));
      for (const r of (data.shopItems || [])) createTreasuryItem(r.id, shopRowToTreasury(r));
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

// ── Selective imports (merge — no deletes, duplicate IDs get _old suffix) ─────
function _oldName(name) { return name.endsWith(' _old') ? name : name + ' _old'; }

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

// Treasury restore. `items` are already in treasury shape; legacy shop/loot
// backups reach this through importShop/importLoot below, which convert first.
export function importTreasury(items, shopConfig, purchaseLogs, lootLogs) {
  const getItem   = db.prepare('SELECT name FROM treasury_items WHERE id = ?');
  const rekeyItem = db.prepare('UPDATE treasury_items SET id = ?, name = ? WHERE id = ?');
  const insPurch  = db.prepare('INSERT OR IGNORE INTO purchase_logs (id, charId, charName, itemName, itemId, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insLoot   = db.prepare('INSERT OR IGNORE INTO loot_logs (id, charId, charName, itemName, itemId, claimedAt) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    if (shopConfig && shopConfig.length > 0) {
      const sc = shopConfig[0];
      setShopConfig(sc.isOpen, sc.activeTags ?? sc.activeTag);
    }
    for (const r of (items || [])) {
      const ex = getItem.get(r.id);
      if (ex) rekeyItem.run(crypto.randomUUID(), _oldName(ex.name), r.id);
      createTreasuryItem(r.id, r);
    }
    for (const r of (purchaseLogs || [])) insPurch.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.itemId || '', r.qty || 1, r.totalCp || 0, r.purchasedAt || r.createdAt || new Date().toISOString());
    for (const r of (lootLogs || []))     insLoot.run(r.id, r.charId || '', r.charName || '', r.itemName || '', r.itemId || '', r.claimedAt || r.createdAt || new Date().toISOString());
  })();
}

// Legacy backup types — kept so old backup files still restore. Their rows are
// converted into the unified catalogue rather than into the retired tables.
export function importShop(shopConfig, shopItems, purchaseLogs) {
  importTreasury((shopItems || []).map(r => ({ ...shopRowToTreasury(r), id: r.id })), shopConfig, purchaseLogs, []);
}

export function importLoot(lootItems, lootLogs) {
  importTreasury((lootItems || []).map(r => ({ ...lootRowToTreasury(r), id: r.id })), null, [], lootLogs);
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
  let media = [];
  try { media = JSON.parse(r.media_json || '[]'); } catch {}
  return {
    id: r.id, title: r.title, description: r.description || '',
    frYear: r.fr_year, frMonth: r.fr_month, frDay: r.fr_day,
    frFestival: r.fr_festival || '', isPublic: !!r.is_public,
    eventType: r.event_type, createdAt: r.created_at,
    authorCharId: r.author_char_id || '', authorName: r.author_name || '',
    media: Array.isArray(media) ? media : [],
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

// ── Weather ───────────────────────────────────────────────────────────────────
const WEATHER_CFG_ID = 'singleton';

export function getWeatherConfig() {
  const r = db.prepare('SELECT * FROM weather_config WHERE id = ?').get(WEATHER_CFG_ID);
  return {
    sessionNormal: r ? r.session_normal : 60,
    level1Min: r && r.level1_min != null ? r.level1_min : 15,
    level2Min: r && r.level2_min != null ? r.level2_min : 18,
  };
}

// Partial update — only overwrites the fields provided (others keep their
// current value), so saving Session Normal alone does not reset the thresholds.
export function saveWeatherConfig(cfg) {
  const cur = getWeatherConfig();
  const sessionNormal = cfg.sessionNormal != null ? (parseInt(cfg.sessionNormal) || 60) : cur.sessionNormal;
  const level1Min = cfg.level1Min != null ? parseInt(cfg.level1Min) : cur.level1Min;
  const level2Min = cfg.level2Min != null ? parseInt(cfg.level2Min) : cur.level2Min;
  db.prepare('INSERT OR REPLACE INTO weather_config (id, session_normal, level1_min, level2_min) VALUES (?,?,?,?)')
    .run(WEATHER_CFG_ID, sessionNormal, level1Min, level2Min);
}

function _weatherRow(r) {
  if (!r) return null;
  let tempDice = [];
  try { tempDice = JSON.parse(r.temp_dice || '[]'); } catch {}
  return {
    id: r.id,
    frYear: r.fr_year, frMonth: r.fr_month, frDay: r.fr_day, frFestival: r.fr_festival || '',
    dateLabel: r.date_label || '',
    sessionNormal: r.session_normal,
    temperature: { roll: r.temp_roll, level: r.temp_level, dice: tempDice, value: r.temperature },
    wind: { roll: r.wind_roll, level: r.wind_level, value: r.wind },
    precipitation: { roll: r.precip_roll, level: r.precip_level, value: r.precipitation },
    createdAt: r.created_at,
  };
}

export function listWeatherLog() {
  return db.prepare('SELECT * FROM weather_log ORDER BY created_at DESC').all().map(_weatherRow);
}

export function getWeatherForDate(id) {
  return _weatherRow(db.prepare('SELECT * FROM weather_log WHERE id = ?').get(id));
}

// Insert or overwrite the weather for a given date key (e.entry.id).
export function saveWeatherEntry(e) {
  db.prepare(`INSERT OR REPLACE INTO weather_log
    (id, fr_year, fr_month, fr_day, fr_festival, date_label, session_normal,
     temp_roll, temp_level, temp_dice, temperature,
     wind_roll, wind_level, wind,
     precip_roll, precip_level, precipitation, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`)
    .run(
      e.id, e.frYear, e.frMonth ?? null, e.frDay ?? null, e.frFestival || '', e.dateLabel || '', e.sessionNormal,
      e.temperature.roll, e.temperature.level, JSON.stringify(e.temperature.dice || []), e.temperature.value,
      e.wind.roll, e.wind.level, e.wind.value,
      e.precipitation.roll, e.precipitation.level, e.precipitation.value
    );
  return getWeatherForDate(e.id);
}

export function deleteWeatherEntry(id) {
  db.prepare('DELETE FROM weather_log WHERE id = ?').run(id);
}

const _CAL_ORDER = 'ORDER BY fr_year, fr_month NULLS LAST, fr_day NULLS LAST';
export function listCalendarEvents({ isDM = false, charId = '' } = {}) {
  // DM sees everything. Otherwise a viewer sees public events plus their own
  // (private journals authored by their character). An empty charId must never
  // match author_char_id='' (those are DM-only events), so use a public-only
  // query in that case.
  if (isDM) {
    return db.prepare(`SELECT * FROM calendar_events ${_CAL_ORDER}`).all().map(_calRow);
  }
  if (!charId) {
    return db.prepare(`SELECT * FROM calendar_events WHERE is_public = 1 ${_CAL_ORDER}`).all().map(_calRow);
  }
  return db.prepare(`SELECT * FROM calendar_events WHERE is_public = 1 OR author_char_id = ? ${_CAL_ORDER}`)
    .all(charId).map(_calRow);
}

export function getCalendarEvent(id) {
  const r = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
  return r ? _calRow(r) : null;
}

export function createCalendarEvent(ev) {
  db.prepare('INSERT INTO calendar_events (id,title,description,fr_year,fr_month,fr_day,fr_festival,is_public,event_type,author_char_id,author_name,media_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(ev.id, ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event', ev.authorCharId || '', ev.authorName || '', JSON.stringify(ev.media || []));
}

export function updateCalendarEvent(id, ev) {
  db.prepare('UPDATE calendar_events SET title=?,description=?,fr_year=?,fr_month=?,fr_day=?,fr_festival=?,is_public=?,event_type=?,author_char_id=?,author_name=?,media_json=? WHERE id=?')
    .run(ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event', ev.authorCharId || '', ev.authorName || '', JSON.stringify(ev.media || []), id);
}

export function deleteCalendarEvent(id) {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
}

// ── Sound Files ───────────────────────────────────────────────────────────────
export function listSoundFiles() {
  return db.prepare('SELECT * FROM sound_files ORDER BY created_at DESC').all()
    .map(r => ({ ...r, tags: (() => { try { return JSON.parse(r.tags); } catch { return []; } })() }));
}
export function getSoundFile(id) {
  const r = db.prepare('SELECT * FROM sound_files WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, tags: (() => { try { return JSON.parse(r.tags); } catch { return []; } })() };
}
export function createSoundFile(id, fields) {
  db.prepare('INSERT INTO sound_files (id, name, url, mime_type, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.url || '', fields.mime_type || '', JSON.stringify(fields.tags || []), fields.created_at || new Date().toISOString());
}
export function deleteSoundFile(id) {
  db.prepare('DELETE FROM sound_files WHERE id = ?').run(id);
}
export function updateSoundFile(id, fields) {
  const allowed = { name: 'name' };
  const cols = Object.keys(fields).filter(k => allowed[k]);
  if (!cols.length) return;
  db.prepare(`UPDATE sound_files SET ${cols.map(k => k + ' = ?').join(', ')} WHERE id = ?`)
    .run(...cols.map(k => fields[k]), id);
}

// ── Playlists ─────────────────────────────────────────────────────────────────
function _playlistRow(r) {
  return {
    ...r,
    tags:   (() => { try { return JSON.parse(r.tags   || '[]'); } catch { return []; } })(),
    sounds: (() => { try { return JSON.parse(r.sounds || '[]'); } catch { return []; } })(),
  };
}
export function listPlaylists() {
  return db.prepare('SELECT * FROM playlists ORDER BY created_at').all().map(_playlistRow);
}
export function getPlaylist(id) {
  const r = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  return r ? _playlistRow(r) : null;
}
export function createPlaylist(id, fields) {
  db.prepare('INSERT INTO playlists (id, name, type, tags, map_name, sounds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.name || '', fields.type || 'generic', JSON.stringify(fields.tags || []), fields.map_name || '', JSON.stringify(fields.sounds || []), fields.created_at || new Date().toISOString());
}
export function updatePlaylist(id, fields) {
  const mapped = { ...fields };
  if ('tags'   in mapped) mapped.tags   = JSON.stringify(mapped.tags   || []);
  if ('sounds' in mapped) mapped.sounds = JSON.stringify(mapped.sounds || []);
  const sets = Object.keys(mapped).map(k => `"${k}" = ?`).join(', ');
  if (!sets) return;
  db.prepare(`UPDATE playlists SET ${sets} WHERE id = ?`).run(...Object.values(mapped), id);
}
export function deletePlaylist(id) {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}
export function getSoundsForPlaylist(playlistId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return [];
  const soundIds = pl.sounds || [];
  if (!soundIds.length) return [];
  const allSounds = listSoundFiles();
  return soundIds.map(id => allSounds.find(s => s.id === id)).filter(Boolean);
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
