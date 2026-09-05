/**
 * Per-campaign stories store.
 *
 * Like db/localdb.js, this used to open one stories.db at module load. Each
 * campaign now gets its own file so one campaign's comics never appear in
 * another's. Prepared statements are per-instance because they are bound to a
 * specific connection.
 *
 * db/campaign-store.js caches one instance per campaign id.
 */
import Database from 'better-sqlite3';

export function openStoriesDb(dbFile) {
  const db = new Database(dbFile);
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

  // ── Stories ─────────────────────────────────────────────────────────────────
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

  function listStories() { return _sList.all(); }
  function getStory(id)  { return _sGet.get(id) || null; }
  function createStory(id, character, storyName, description, characterIds) {
    _sIns.run(id, character || '', JSON.stringify(characterIds || []), storyName || '', description || '');
    return getStory(id);
  }
  function updateStory(id, character, storyName, description, characterIds) {
    _sUpd.run(character || '', JSON.stringify(characterIds || []), storyName || '', description || '', id);
    return getStory(id);
  }
  function deleteStory(id) { _sDel.run(id); }

  // ── Sequences ───────────────────────────────────────────────────────────────
  const _seqList   = db.prepare(`SELECT * FROM story_sequences WHERE story_id=? ORDER BY seq_number ASC`);
  const _seqGet    = db.prepare(`SELECT * FROM story_sequences WHERE id=?`);
  const _seqIns    = db.prepare(`INSERT INTO story_sequences (id, story_id, seq_number, prompt, image_path) VALUES (?, ?, ?, ?, '')`);
  const _seqUpdCap = db.prepare(`UPDATE story_sequences SET prompt=? WHERE id=?`);
  const _seqUpdImg = db.prepare(`UPDATE story_sequences SET image_path=? WHERE id=?`);
  const _seqUpdNum = db.prepare(`UPDATE story_sequences SET seq_number=? WHERE id=?`);
  const _seqDel    = db.prepare(`DELETE FROM story_sequences WHERE id=?`);

  function listSequences(storyId)       { return _seqList.all(storyId); }
  function getSequence(id)              { return _seqGet.get(id) || null; }
  function addSequence(id, storyId, seqNumber, caption) {
    _seqIns.run(id, storyId, seqNumber, caption || '');
    return getSequence(id);
  }
  function updateSequenceCaption(id, caption)  { _seqUpdCap.run(caption, id); }
  function updateSequenceImage(id, imagePath)  { _seqUpdImg.run(imagePath, id); }
  function updateSequenceNumber(id, seqNumber) { _seqUpdNum.run(seqNumber, id); }
  function deleteSequence(id)                  { _seqDel.run(id); }
  function reorderSequences(pairs) {
    db.transaction(() => { for (const { id, seqNumber } of pairs) _seqUpdNum.run(seqNumber, id); })();
  }

  return {
    _db: db, _file: dbFile,
    close() { try { db.close(); } catch {} },
    listStories, getStory, createStory, updateStory, deleteStory,
    listSequences, getSequence, addSequence, updateSequenceCaption,
    updateSequenceImage, updateSequenceNumber, deleteSequence, reorderSequences,
  };
}
