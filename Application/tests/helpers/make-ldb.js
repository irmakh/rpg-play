/**
 * In-memory SQLite ldb factory for tests.
 * Mirrors the shape of db/localdb.js but uses :memory: — no disk state.
 * Only implements the functions actually used by initiative + table routes.
 */
import Database from 'better-sqlite3';

const INIT_STATE_ID  = 'c8a04a12-4372-4c78-9abc-def012345601';
const TABLE_STATE_ID = 'c8a04a12-4372-4c78-9abc-def012345601';

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
  `);

  // Singleton rows
  db.prepare("INSERT OR IGNORE INTO initiative_state (id, currentId) VALUES (?, '')").run(INIT_STATE_ID);
  db.prepare('INSERT OR IGNORE INTO table_state (id) VALUES (?)').run(TABLE_STATE_ID);

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
  };
}
