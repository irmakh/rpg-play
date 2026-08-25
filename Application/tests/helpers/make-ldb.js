/**
 * In-memory SQLite ldb factory for tests.
 * Mirrors the shape of db/localdb.js but uses :memory: — no disk state.
 * Only implements the functions actually used by initiative + table routes.
 */
import Database from 'better-sqlite3';

const INIT_STATE_ID  = 'c8a04a12-4372-4c78-9abc-def012345601';
const TABLE_STATE_ID = 'c8a04a12-4372-4c78-9abc-def012345601';
const SHOP_CONFIG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

export function makeLdb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY, name TEXT DEFAULT '', dataJson TEXT DEFAULT '{}',
      charType TEXT DEFAULT 'pc', passwordHash TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now'))
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
      linkedId TEXT DEFAULT '', assignedCharId TEXT DEFAULT '',
      x INTEGER DEFAULT 0, y INTEGER DEFAULT 0,
      color TEXT DEFAULT '#888888', hpCurrent INTEGER DEFAULT 0, hpMax INTEGER DEFAULT 0,
      hpTemp INTEGER DEFAULT 0, speed INTEGER DEFAULT 30, movedFt INTEGER DEFAULT 0,
      initiativeId TEXT DEFAULT '', visible INTEGER DEFAULT 1,
      tokenSize INTEGER DEFAULT 1, portrait TEXT, portraitThumb TEXT,
      label TEXT DEFAULT '', conditions TEXT DEFAULT '[]', ac INTEGER,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS table_state (
      id TEXT PRIMARY KEY, cellSize INTEGER DEFAULT 50, offsetX INTEGER DEFAULT 0,
      offsetY INTEGER DEFAULT 0, mapWidth INTEGER DEFAULT 0, mapHeight INTEGER DEFAULT 0,
      hasMap INTEGER DEFAULT 0, fogRegions TEXT DEFAULT '[]', hiddenItems TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '',
      fr_year INTEGER NOT NULL DEFAULT 1492, fr_month INTEGER, fr_day INTEGER,
      fr_festival TEXT DEFAULT '', is_public INTEGER NOT NULL DEFAULT 0,
      event_type TEXT DEFAULT 'event',
      author_char_id TEXT DEFAULT '', author_name TEXT DEFAULT '', media_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS weather_config (
      id TEXT PRIMARY KEY, session_normal INTEGER DEFAULT 60,
      level1_min INTEGER DEFAULT 15, level2_min INTEGER DEFAULT 18
    );
    CREATE TABLE IF NOT EXISTS shop_config (
      id TEXT PRIMARY KEY, isOpen INTEGER DEFAULT 1,
      activeTag TEXT DEFAULT '', activeTags TEXT DEFAULT '[]'
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
    CREATE TABLE IF NOT EXISTS loot_logs (
      id TEXT PRIMARY KEY, charId TEXT NOT NULL DEFAULT '', charName TEXT DEFAULT '',
      itemName TEXT DEFAULT '', itemId TEXT DEFAULT '', claimedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_logs (
      id TEXT PRIMARY KEY, charId TEXT NOT NULL DEFAULT '', charName TEXT DEFAULT '',
      itemName TEXT DEFAULT '', itemId TEXT DEFAULT '', qty INTEGER DEFAULT 1,
      totalCp INTEGER DEFAULT 0, purchasedAt TEXT DEFAULT (datetime('now'))
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

  // Singleton rows
  db.prepare("INSERT OR IGNORE INTO initiative_state (id, currentId) VALUES (?, '')").run(INIT_STATE_ID);
  db.prepare('INSERT OR IGNORE INTO table_state (id) VALUES (?)').run(TABLE_STATE_ID);
  db.prepare('INSERT OR IGNORE INTO shop_config (id, isOpen, activeTag) VALUES (?, 1, ?)').run(SHOP_CONFIG_ID, '');

  // ── helpers ────────────────────────────────────────────────────────────────
  function normTok(r) {
    return r ? { ...r, visible: !!r.visible } : null;
  }

  function dynUpdate(table, id, fields, idCol = 'id') {
    if (!fields || Object.keys(fields).length === 0) return;
    const sets = Object.keys(fields).map(k => `"${k}" = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol} = ?`).run(...Object.values(fields), id);
  }

  // ── characters ─────────────────────────────────────────────────────────────
  function listCharacters() {
    return db.prepare('SELECT * FROM characters ORDER BY name').all();
  }
  function getCharacter(id) {
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) || null;
  }
  function createCharacter(id, fields) {
    db.prepare('INSERT INTO characters (id, name, dataJson, charType, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, fields.name || '', fields.dataJson || '{}', fields.charType || 'pc', fields.passwordHash || '', fields.createdAt || new Date().toISOString());
  }
  function updateCharacter(id, fields) {
    dynUpdate('characters', id, fields);
  }
  function deleteCharacter(id) {
    db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }
  function getLinkedTokens(charId) {
    return db.prepare('SELECT * FROM table_tokens WHERE linkedId = ?').all(charId).map(normTok);
  }
  // ── media (stubs — media endpoints not covered in this test suite) ─────────
  function listMedia() { return []; }
  function createMedia() {}
  function setPortrait() {}
  function getMediaById() { return null; }
  function deleteMedia() {}

  // ── initiative ─────────────────────────────────────────────────────────────
  function listInitEntries() {
    return db.prepare('SELECT * FROM initiative_entries ORDER BY roll DESC, createdAt ASC').all();
  }
  function getInitEntry(id) {
    return db.prepare('SELECT * FROM initiative_entries WHERE id = ?').get(id) || null;
  }
  function createInitEntry(id, fields) {
    db.prepare('INSERT INTO initiative_entries (id, name, roll, charId, monsterId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, fields.name || '', fields.roll || 0, fields.charId || '', fields.monsterId || '', fields.createdAt || new Date().toISOString());
  }
  function updateInitEntry(id, fields) {
    dynUpdate('initiative_entries', id, fields);
  }
  function deleteInitEntry(id) {
    db.prepare('DELETE FROM initiative_entries WHERE id = ?').run(id);
  }
  function listOrphanMonsterInitEntries() {
    return db.prepare(`
      SELECT ie.* FROM initiative_entries ie
      WHERE ie.monsterId != ''
        AND ie.id NOT IN (SELECT initiativeId FROM table_tokens WHERE initiativeId != '')
    `).all();
  }
  function clearInitEntries() {
    db.prepare('DELETE FROM initiative_entries').run();
  }
  function getInitState() {
    return db.prepare('SELECT * FROM initiative_state WHERE id = ?').get(INIT_STATE_ID)
      || { id: INIT_STATE_ID, currentId: '' };
  }
  function setInitState(currentId) {
    db.prepare('UPDATE initiative_state SET currentId = ? WHERE id = ?').run(currentId || '', INIT_STATE_ID);
  }
  function getInitEntry_byCharId(charId) {
    return db.prepare('SELECT * FROM initiative_entries WHERE charId = ?').get(charId) || null;
  }
  function getInitEntryByCharId(charId) {
    if (!charId) return null;
    return db.prepare("SELECT * FROM initiative_entries WHERE charId = ? AND charId != '' LIMIT 1").get(String(charId)) || null;
  }

  // ── table state ────────────────────────────────────────────────────────────
  function getTableState() {
    return db.prepare('SELECT * FROM table_state WHERE id = ?').get(TABLE_STATE_ID)
      || { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: 0 };
  }
  function updateTableState(fields) {
    const mapped = { ...fields };
    if ('hasMap' in mapped) mapped.hasMap = mapped.hasMap ? 1 : 0;
    dynUpdate('table_state', TABLE_STATE_ID, mapped);
  }

  // ── table tokens ───────────────────────────────────────────────────────────
  function listTableTokens() {
    return db.prepare('SELECT * FROM table_tokens ORDER BY createdAt').all().map(normTok);
  }
  function getTableToken(id) {
    return normTok(db.prepare('SELECT * FROM table_tokens WHERE id = ?').get(id));
  }
  function getTableTokensByInitId(initId) {
    return db.prepare('SELECT * FROM table_tokens WHERE initiativeId = ?').all(initId).map(normTok);
  }
  function createTableToken(id, fields) {
    db.prepare(`INSERT INTO table_tokens
      (id, name, type, linkedId, assignedCharId, x, y, color, hpCurrent, hpMax, hpTemp,
       speed, movedFt, initiativeId, visible, tokenSize, portrait, portraitThumb,
       label, conditions, ac, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        fields.name || '', fields.type || 'custom', fields.linkedId || '', fields.assignedCharId || '',
        fields.x || 0, fields.y || 0, fields.color || '#888888',
        fields.hpCurrent || 0, fields.hpMax || 0, fields.hpTemp || 0,
        fields.speed || 30, fields.movedFt || 0, fields.initiativeId || '',
        fields.visible !== false ? 1 : 0,
        fields.tokenSize || 1, fields.portrait || null, fields.portraitThumb || null,
        fields.label || '', fields.conditions || '[]', fields.ac ?? null,
        fields.createdAt || new Date().toISOString()
      );
  }
  function updateTableToken(id, fields) {
    const mapped = { ...fields };
    if ('visible' in mapped) mapped.visible = mapped.visible ? 1 : 0;
    dynUpdate('table_tokens', id, mapped);
  }
  function deleteTableToken(id) {
    db.prepare('DELETE FROM table_tokens WHERE id = ?').run(id);
  }
  function clearTableTokens() {
    db.prepare('DELETE FROM table_tokens').run();
  }

  // ── calendar events (mirror db/localdb.js) ──────────────────────────────────
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
  const _CAL_ORDER = 'ORDER BY fr_year, fr_month NULLS LAST, fr_day NULLS LAST';
  function listCalendarEvents({ isDM = false, charId = '' } = {}) {
    if (isDM) return db.prepare(`SELECT * FROM calendar_events ${_CAL_ORDER}`).all().map(_calRow);
    if (!charId) return db.prepare(`SELECT * FROM calendar_events WHERE is_public = 1 ${_CAL_ORDER}`).all().map(_calRow);
    return db.prepare(`SELECT * FROM calendar_events WHERE is_public = 1 OR author_char_id = ? ${_CAL_ORDER}`).all(charId).map(_calRow);
  }
  function getCalendarEvent(id) {
    const r = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    return r ? _calRow(r) : null;
  }
  function createCalendarEvent(ev) {
    db.prepare('INSERT INTO calendar_events (id,title,description,fr_year,fr_month,fr_day,fr_festival,is_public,event_type,author_char_id,author_name,media_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(ev.id, ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event', ev.authorCharId || '', ev.authorName || '', JSON.stringify(ev.media || []));
  }
  function updateCalendarEvent(id, ev) {
    db.prepare('UPDATE calendar_events SET title=?,description=?,fr_year=?,fr_month=?,fr_day=?,fr_festival=?,is_public=?,event_type=?,author_char_id=?,author_name=?,media_json=? WHERE id=?')
      .run(ev.title, ev.description || '', ev.frYear, ev.frMonth ?? null, ev.frDay ?? null, ev.frFestival || '', ev.isPublic ? 1 : 0, ev.eventType || 'event', ev.authorCharId || '', ev.authorName || '', JSON.stringify(ev.media || []), id);
  }
  function deleteCalendarEvent(id) {
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  }

  // ── treasury (mirror db/localdb.js) ─────────────────────────────────────────
  function _treasuryRow(r) {
    if (!r) return null;
    return { ...r, descVisible: !!r.descVisible, requiresAttunement: !!r.requiresAttunement };
  }
  function getShopConfig() {
    const r = db.prepare('SELECT * FROM shop_config WHERE id = ?').get(SHOP_CONFIG_ID)
      || { id: SHOP_CONFIG_ID, isOpen: 1, activeTag: '', activeTags: '[]' };
    let list = [];
    try { const a = JSON.parse(r.activeTags || '[]'); if (Array.isArray(a)) list = a.filter(Boolean).map(String); } catch {}
    if (list.length === 0 && r.activeTag) list = [r.activeTag];
    return { ...r, activeTags: list, activeTag: list[0] || '' };
  }
  function setShopConfig(isOpen, activeTags = []) {
    const list = Array.isArray(activeTags) ? activeTags : (activeTags ? [activeTags] : []);
    const uniq = [...new Set(list.map(t => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 50);
    db.prepare('UPDATE shop_config SET isOpen = ?, activeTag = ?, activeTags = ? WHERE id = ?')
      .run(isOpen ? 1 : 0, uniq[0] || '', JSON.stringify(uniq), SHOP_CONFIG_ID);
  }
  function listTreasuryItems() {
    return db.prepare('SELECT * FROM treasury_items ORDER BY createdAt').all().map(_treasuryRow);
  }
  function getTreasuryItem(id) {
    return _treasuryRow(db.prepare('SELECT * FROM treasury_items WHERE id = ?').get(id));
  }
  function getTreasuryItemsByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const ph = ids.map(() => '?').join(', ');
    return db.prepare(`SELECT * FROM treasury_items WHERE id IN (${ph})`).all(...ids).map(_treasuryRow);
  }
  function createTreasuryItem(id, f) {
    db.prepare(`INSERT INTO treasury_items
      (id, name, tag, mode, description, descVisible, itemType, armorType, acBase, valueCp, quantity,
       acBonus, initBonus, speedBonus, spellAtkBonus, spellDcBonus, requiresAttunement,
       weaponAtk, weaponDmg, weaponPropertiesJson, imageUrl, imageThumb, imageMedium, createdAt)
      VALUES (@id, @name, @tag, @mode, @description, @descVisible, @itemType, @armorType, @acBase, @valueCp, @quantity,
       @acBonus, @initBonus, @speedBonus, @spellAtkBonus, @spellDcBonus, @requiresAttunement,
       @weaponAtk, @weaponDmg, @weaponPropertiesJson, @imageUrl, @imageThumb, @imageMedium, @createdAt)`)
      .run({
        id,
        name: f.name || '', tag: f.tag || '', mode: f.mode || 'hidden',
        description: f.description || '', descVisible: f.descVisible ? 1 : 0,
        itemType: f.itemType || 'other', armorType: f.armorType || 'light',
        acBase: f.acBase ?? 10, valueCp: f.valueCp ?? 0, quantity: f.quantity ?? 1,
        acBonus: f.acBonus ?? 0, initBonus: f.initBonus ?? 0, speedBonus: f.speedBonus ?? 0,
        spellAtkBonus: f.spellAtkBonus ?? 0, spellDcBonus: f.spellDcBonus ?? 0,
        requiresAttunement: f.requiresAttunement ? 1 : 0,
        weaponAtk: f.weaponAtk || '', weaponDmg: f.weaponDmg || '',
        weaponPropertiesJson: f.weaponPropertiesJson || '[]',
        imageUrl: f.imageUrl || '', imageThumb: f.imageThumb || '', imageMedium: f.imageMedium || '',
        createdAt: f.createdAt || new Date().toISOString(),
      });
  }
  function updateTreasuryItem(id, fields) {
    const mapped = { ...fields };
    for (const k of ['descVisible', 'requiresAttunement']) if (k in mapped) mapped[k] = mapped[k] ? 1 : 0;
    dynUpdate('treasury_items', id, mapped);
  }
  function deleteTreasuryItem(id) {
    db.prepare('DELETE FROM treasury_items WHERE id = ?').run(id);
  }
  function bulkUpdateTreasuryTag(ids, tag) {
    const stmt = db.prepare('UPDATE treasury_items SET tag = ? WHERE id = ?');
    for (const id of ids) stmt.run(tag, id);
  }
  function bulkUpdateTreasuryMode(ids, mode) {
    const stmt = db.prepare('UPDATE treasury_items SET mode = ? WHERE id = ?');
    for (const id of ids) stmt.run(mode, id);
  }
  function bulkDeleteTreasuryItems(ids) {
    const stmt = db.prepare('DELETE FROM treasury_items WHERE id = ?');
    for (const id of ids) stmt.run(id);
  }
  function bulkCreateTreasuryItems(rows) {
    for (const { id, fields } of rows) createTreasuryItem(id, fields);
  }
  function listLootLogs() {
    return db.prepare('SELECT * FROM loot_logs ORDER BY claimedAt DESC LIMIT 500').all();
  }
  function createLootLog(id, f) {
    db.prepare('INSERT INTO loot_logs (id, charId, charName, itemName, itemId, claimedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, f.charId || '', f.charName || '', f.itemName || '', f.itemId || '', f.claimedAt || new Date().toISOString());
  }
  function listClaimedItemIds(charId) {
    return db.prepare("SELECT DISTINCT itemId FROM loot_logs WHERE charId = ? AND itemId != ''").all(charId)
      .map(r => r.itemId);
  }
  function listPurchaseLogs() {
    return db.prepare('SELECT * FROM purchase_logs ORDER BY purchasedAt DESC LIMIT 500').all();
  }
  function createPurchaseLog(id, f) {
    db.prepare('INSERT INTO purchase_logs (id, charId, charName, itemName, itemId, qty, totalCp, purchasedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, f.charId || '', f.charName || '', f.itemName || '', f.itemId || '', f.qty || 1, f.totalCp || 0, f.purchasedAt || new Date().toISOString());
  }

  // ── weather (mirror db/localdb.js) ──────────────────────────────────────────
  function getWeatherConfig() {
    const r = db.prepare("SELECT * FROM weather_config WHERE id = 'singleton'").get();
    return {
      sessionNormal: r ? r.session_normal : 60,
      level1Min: r && r.level1_min != null ? r.level1_min : 15,
      level2Min: r && r.level2_min != null ? r.level2_min : 18,
    };
  }
  function saveWeatherConfig(cfg) {
    const cur = getWeatherConfig();
    const sessionNormal = cfg.sessionNormal != null ? (parseInt(cfg.sessionNormal) || 60) : cur.sessionNormal;
    const level1Min = cfg.level1Min != null ? parseInt(cfg.level1Min) : cur.level1Min;
    const level2Min = cfg.level2Min != null ? parseInt(cfg.level2Min) : cur.level2Min;
    db.prepare('INSERT OR REPLACE INTO weather_config (id, session_normal, level1_min, level2_min) VALUES (?,?,?,?)')
      .run('singleton', sessionNormal, level1Min, level2Min);
  }
  function _weatherRow(r) {
    if (!r) return null;
    let tempDice = [];
    try { tempDice = JSON.parse(r.temp_dice || '[]'); } catch {}
    return {
      id: r.id,
      frYear: r.fr_year, frMonth: r.fr_month, frDay: r.fr_day, frFestival: r.fr_festival || '',
      dateLabel: r.date_label || '', sessionNormal: r.session_normal,
      temperature: { roll: r.temp_roll, level: r.temp_level, dice: tempDice, value: r.temperature },
      wind: { roll: r.wind_roll, level: r.wind_level, value: r.wind },
      precipitation: { roll: r.precip_roll, level: r.precip_level, value: r.precipitation },
      createdAt: r.created_at,
    };
  }
  function listWeatherLog() {
    return db.prepare('SELECT * FROM weather_log ORDER BY created_at DESC').all().map(_weatherRow);
  }
  function getWeatherForDate(id) {
    return _weatherRow(db.prepare('SELECT * FROM weather_log WHERE id = ?').get(id));
  }
  function saveWeatherEntry(e) {
    db.prepare(`INSERT OR REPLACE INTO weather_log
      (id, fr_year, fr_month, fr_day, fr_festival, date_label, session_normal,
       temp_roll, temp_level, temp_dice, temperature,
       wind_roll, wind_level, wind, precip_roll, precip_level, precipitation, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`)
      .run(
        e.id, e.frYear, e.frMonth ?? null, e.frDay ?? null, e.frFestival || '', e.dateLabel || '', e.sessionNormal,
        e.temperature.roll, e.temperature.level, JSON.stringify(e.temperature.dice || []), e.temperature.value,
        e.wind.roll, e.wind.level, e.wind.value,
        e.precipitation.roll, e.precipitation.level, e.precipitation.value
      );
    return getWeatherForDate(e.id);
  }
  function deleteWeatherEntry(id) {
    db.prepare('DELETE FROM weather_log WHERE id = ?').run(id);
  }

  return {
    // characters
    listCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, getLinkedTokens,
    // media stubs
    listMedia, createMedia, setPortrait, getMediaById, deleteMedia,
    // initiative
    listInitEntries, getInitEntry, createInitEntry, updateInitEntry, deleteInitEntry,
    listOrphanMonsterInitEntries, clearInitEntries, getInitState, setInitState, getInitEntry_byCharId, getInitEntryByCharId,
    // table state
    getTableState, updateTableState,
    // table tokens
    listTableTokens, getTableToken, getTableTokensByInitId,
    createTableToken, updateTableToken, deleteTableToken, clearTableTokens,
    // calendar
    listCalendarEvents, getCalendarEvent, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
    // treasury
    getShopConfig, setShopConfig,
    listTreasuryItems, getTreasuryItem, getTreasuryItemsByIds,
    createTreasuryItem, updateTreasuryItem, deleteTreasuryItem,
    bulkUpdateTreasuryTag, bulkUpdateTreasuryMode, bulkDeleteTreasuryItems, bulkCreateTreasuryItems,
    listLootLogs, createLootLog, listClaimedItemIds, listPurchaseLogs, createPurchaseLog,
    // weather
    getWeatherConfig, saveWeatherConfig, listWeatherLog, getWeatherForDate, saveWeatherEntry, deleteWeatherEntry,
  };
}
