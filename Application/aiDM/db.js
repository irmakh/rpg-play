import Database from 'better-sqlite3';
import crypto from 'crypto';

/**
 * Per-campaign AI DM store.
 *
 * AI DM sessions belong to a campaign's characters, so each campaign gets its
 * own aiDM.db. Previously a single module-level database served everyone.
 * db/campaign-store.js caches one instance per campaign id.
 */
export function openAiDmDb(dbFile) {
  const db = new Database(dbFile);
  db.pragma('journal_mode = DELETE');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    characterId     TEXT NOT NULL,
    characterName   TEXT DEFAULT '',
    characterSnapshot TEXT DEFAULT '{}',
    scenarioId      TEXT DEFAULT '',
    scenarioName    TEXT DEFAULT '',
    provider        TEXT DEFAULT 'lmstudio',
    model           TEXT DEFAULT '',
    lmStudioUrl     TEXT DEFAULT 'http://localhost:1234',
    startedAt       TEXT DEFAULT (datetime('now')),
    endedAt         TEXT,
    status          TEXT DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS messages (
    id        TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_scenarios (
    id          TEXT PRIMARY KEY,
    name        TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    difficulty  TEXT DEFAULT 'Medium',
    tags        TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    hook        TEXT DEFAULT '',
    createdAt   TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate: add summary columns if not present
try { db.exec('ALTER TABLE sessions ADD COLUMN summary TEXT DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN summarizedUpTo TEXT DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN language TEXT DEFAULT "English"'); } catch {}

function createSession(id, fields) {
  db.prepare(`INSERT INTO sessions
    (id, characterId, characterName, characterSnapshot, scenarioId, scenarioName, provider, model, lmStudioUrl, language, startedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      fields.characterId,
      fields.characterName  || '',
      JSON.stringify(fields.characterSnapshot || {}),
      fields.scenarioId     || '',
      fields.scenarioName   || '',
      fields.provider       || 'lmstudio',
      fields.model          || '',
      fields.lmStudioUrl    || 'http://localhost:1234',
      fields.language       || 'English',
      new Date().toISOString()
    );
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function listSessionsForChar(characterId) {
  return db.prepare(`
    SELECT id, characterName, scenarioName, provider, model, status, startedAt, endedAt
    FROM sessions WHERE characterId = ? ORDER BY startedAt DESC LIMIT 30
  `).all(characterId);
}

function endSession(id) {
  db.prepare('UPDATE sessions SET status = ?, endedAt = ? WHERE id = ?')
    .run('ended', new Date().toISOString(), id);
}

function addMessage(id, sessionId, role, content) {
  db.prepare('INSERT INTO messages (id, sessionId, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, role, content, new Date().toISOString());
}

function getMessages(sessionId) {
  return db.prepare('SELECT id, role, content, timestamp FROM messages WHERE sessionId = ? ORDER BY timestamp').all(sessionId);
}

function getConfig(key, defaultVal = '') {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function updateSessionModel(id, fields) {
  db.prepare('UPDATE sessions SET provider = ?, model = ?, lmStudioUrl = ? WHERE id = ?')
    .run(fields.provider || 'lmstudio', fields.model || '', fields.lmStudioUrl || 'http://localhost:1234', id);
}

function deleteLastAssistantMessage(sessionId) {
  const row = db.prepare(
    `SELECT id FROM messages WHERE sessionId = ? AND role = 'assistant' ORDER BY timestamp DESC LIMIT 1`
  ).get(sessionId);
  if (row) db.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
}

function updateSessionSummary(id, summary, summarizedUpTo) {
  db.prepare('UPDATE sessions SET summary = ?, summarizedUpTo = ? WHERE id = ?')
    .run(summary || '', summarizedUpTo || '', id);
}

function deleteSession(id) {
  db.prepare('DELETE FROM messages WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function reopenSession(id) {
  db.prepare("UPDATE sessions SET status = 'active', endedAt = NULL WHERE id = ?").run(id);
}

function createCustomScenario(fields) {
  const id = `custom_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO custom_scenarios (id, name, location, difficulty, tags, description, hook) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, fields.name || '', fields.location || '', fields.difficulty || 'Medium',
         JSON.stringify(fields.tags || []), fields.description || '', fields.hook || '');
  return id;
}

function listCustomScenarios() {
  return db.prepare('SELECT * FROM custom_scenarios ORDER BY createdAt DESC').all();
}

function deleteCustomScenario(id) {
  db.prepare('DELETE FROM custom_scenarios WHERE id = ?').run(id);
}


  return {
    _db: db, _file: dbFile,
    close() { try { db.close(); } catch {} },
    createSession, getSession, listSessionsForChar, endSession,
    addMessage, getMessages, getConfig, setConfig,
    updateSessionModel, deleteLastAssistantMessage, updateSessionSummary, deleteSession,
    reopenSession, createCustomScenario, listCustomScenarios, deleteCustomScenario,
  };
}
