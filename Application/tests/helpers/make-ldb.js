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

  return {
    // characters
    getCharacter, createCharacter, updateCharacter,
    // initiative
    listInitEntries, getInitEntry, createInitEntry, updateInitEntry, deleteInitEntry,
    listOrphanMonsterInitEntries, clearInitEntries, getInitState, setInitState, getInitEntry_byCharId,
    // table state
    getTableState, updateTableState,
    // table tokens
    listTableTokens, getTableToken, getTableTokensByInitId,
    createTableToken, updateTableToken, deleteTableToken, clearTableTokens,
  };
}
