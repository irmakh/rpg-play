import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'aiDM.db'));
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

export function createSession(id, fields) {
  db.prepare(`INSERT INTO sessions
    (id, characterId, characterName, characterSnapshot, scenarioId, scenarioName, provider, model, lmStudioUrl, startedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      new Date().toISOString()
    );
}

export function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function listSessionsForChar(characterId) {
  return db.prepare(`
    SELECT id, characterName, scenarioName, provider, model, status, startedAt, endedAt
    FROM sessions WHERE characterId = ? ORDER BY startedAt DESC LIMIT 30
  `).all(characterId);
}

export function endSession(id) {
  db.prepare('UPDATE sessions SET status = ?, endedAt = ? WHERE id = ?')
    .run('ended', new Date().toISOString(), id);
}

export function addMessage(id, sessionId, role, content) {
  db.prepare('INSERT INTO messages (id, sessionId, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, role, content, new Date().toISOString());
}

export function getMessages(sessionId) {
  return db.prepare('SELECT id, role, content, timestamp FROM messages WHERE sessionId = ? ORDER BY timestamp').all(sessionId);
}

export function getConfig(key, defaultVal = '') {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

export function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

export function updateSessionModel(id, fields) {
  db.prepare('UPDATE sessions SET provider = ?, model = ?, lmStudioUrl = ? WHERE id = ?')
    .run(fields.provider || 'lmstudio', fields.model || '', fields.lmStudioUrl || 'http://localhost:1234', id);
}

export function deleteLastAssistantMessage(sessionId) {
  const row = db.prepare(
    `SELECT id FROM messages WHERE sessionId = ? AND role = 'assistant' ORDER BY timestamp DESC LIMIT 1`
  ).get(sessionId);
  if (row) db.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
}

export function updateSessionSummary(id, summary, summarizedUpTo) {
  db.prepare('UPDATE sessions SET summary = ?, summarizedUpTo = ? WHERE id = ?')
    .run(summary || '', summarizedUpTo || '', id);
}

export function deleteSession(id) {
  db.prepare('DELETE FROM messages WHERE sessionId = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function reopenSession(id) {
  db.prepare("UPDATE sessions SET status = 'active', endedAt = NULL WHERE id = ?").run(id);
}

export function createCustomScenario(fields) {
  const id = `custom_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO custom_scenarios (id, name, location, difficulty, tags, description, hook) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, fields.name || '', fields.location || '', fields.difficulty || 'Medium',
         JSON.stringify(fields.tags || []), fields.description || '', fields.hook || '');
  return id;
}

export function listCustomScenarios() {
  return db.prepare('SELECT * FROM custom_scenarios ORDER BY createdAt DESC').all();
}

export function deleteCustomScenario(id) {
  db.prepare('DELETE FROM custom_scenarios WHERE id = ?').run(id);
}
