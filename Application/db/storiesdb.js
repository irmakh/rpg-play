import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const db = new Database(path.join(__dirname, '..', 'stories.db'));
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id          TEXT PRIMARY KEY,
    character   TEXT DEFAULT '',
    story_name  TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS story_sequences (
    id         TEXT PRIMARY KEY,
    story_id   TEXT NOT NULL,
    seq_number INTEGER NOT NULL,
    prompt     TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  );
`);

// Migrations for older installs
for (const [tbl, col, def] of [
  ['stories', 'description',   "TEXT DEFAULT ''"],
  ['stories', 'character_ids', "TEXT DEFAULT '[]'"],
]) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch {}
}

// ── Stories ───────────────────────────────────────────────────────────────────
const _sList = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(*) FROM story_sequences WHERE story_id = s.id) AS seq_count,
    (SELECT image_path FROM story_sequences WHERE story_id = s.id AND image_path != ''
     ORDER BY seq_number LIMIT 1) AS cover_image
  FROM stories s ORDER BY s.updated_at DESC
`);
const _sGet  = db.prepare(`SELECT * FROM stories WHERE id = ?`);
const _sIns  = db.prepare(`INSERT INTO stories (id, character, character_ids, story_name, description) VALUES (?, ?, ?, ?, ?)`);
const _sUpd  = db.prepare(`UPDATE stories SET character=?, character_ids=?, story_name=?, description=?, updated_at=datetime('now') WHERE id=?`);
const _sDel  = db.prepare(`DELETE FROM stories WHERE id=?`);

export function listStories() { return _sList.all(); }
export function getStory(id)  { return _sGet.get(id) || null; }
export function createStory(id, character, storyName, description, characterIds) {
  _sIns.run(id, character || '', JSON.stringify(characterIds || []), storyName || '', description || '');
  return getStory(id);
}
export function updateStory(id, character, storyName, description, characterIds) {
  _sUpd.run(character || '', JSON.stringify(characterIds || []), storyName || '', description || '', id);
  return getStory(id);
}
export function deleteStory(id) { _sDel.run(id); }

// ── Sequences ─────────────────────────────────────────────────────────────────
const _seqList   = db.prepare(`SELECT * FROM story_sequences WHERE story_id=? ORDER BY seq_number ASC`);
const _seqGet    = db.prepare(`SELECT * FROM story_sequences WHERE id=?`);
const _seqIns    = db.prepare(`INSERT INTO story_sequences (id, story_id, seq_number, prompt, image_path) VALUES (?, ?, ?, ?, '')`);
const _seqUpdCap = db.prepare(`UPDATE story_sequences SET prompt=? WHERE id=?`);
const _seqUpdImg = db.prepare(`UPDATE story_sequences SET image_path=? WHERE id=?`);
const _seqUpdNum = db.prepare(`UPDATE story_sequences SET seq_number=? WHERE id=?`);
const _seqDel    = db.prepare(`DELETE FROM story_sequences WHERE id=?`);

export function listSequences(storyId)       { return _seqList.all(storyId); }
export function getSequence(id)              { return _seqGet.get(id) || null; }
export function addSequence(id, storyId, seqNumber, caption) {
  _seqIns.run(id, storyId, seqNumber, caption || '');
  return getSequence(id);
}
export function updateSequenceCaption(id, caption)  { _seqUpdCap.run(caption, id); }
export function updateSequenceImage(id, imagePath)  { _seqUpdImg.run(imagePath, id); }
export function updateSequenceNumber(id, seqNumber) { _seqUpdNum.run(seqNumber, id); }
export function deleteSequence(id)                  { _seqDel.run(id); }
export function reorderSequences(pairs) {
  db.transaction(() => { for (const { id, seqNumber } of pairs) _seqUpdNum.run(seqNumber, id); })();
}
