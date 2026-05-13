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
    prompt_file TEXT DEFAULT '',
    seq_count   INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'pending',
    image_dir   TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS story_sequences (
    id           TEXT PRIMARY KEY,
    story_id     TEXT NOT NULL,
    seq_number   INTEGER NOT NULL,
    prompt       TEXT DEFAULT '',
    image_path   TEXT DEFAULT '',
    status       TEXT DEFAULT 'pending',
    generated_at TEXT DEFAULT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS image_presets (
    id          TEXT PRIMARY KEY,
    name        TEXT DEFAULT '',
    server_type TEXT DEFAULT 'comfyui',
    endpoint    TEXT DEFAULT '',
    api_key     TEXT DEFAULT '',
    model       TEXT DEFAULT '',
    workflow        TEXT DEFAULT '',
    width           INTEGER DEFAULT 512,
    height          INTEGER DEFAULT 512,
    is_default      INTEGER DEFAULT 0,
    checkpoint      TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT 'ugly, blurry, low quality, deformed',
    steps           INTEGER DEFAULT 20,
    cfg             REAL DEFAULT 7.0,
    sampler         TEXT DEFAULT 'euler',
    created_at      TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate older installs that don't yet have the new columns
for (const [col, def] of [
  ['checkpoint',      "TEXT DEFAULT ''"],
  ['negative_prompt', "TEXT DEFAULT 'ugly, blurry, low quality, deformed'"],
  ['steps',           'INTEGER DEFAULT 20'],
  ['cfg',             'REAL DEFAULT 7.0'],
  ['sampler',         "TEXT DEFAULT 'euler'"],
]) { try { db.exec(`ALTER TABLE image_presets ADD COLUMN ${col} ${def}`); } catch {} }

// ── Stories ───────────────────────────────────────────────────────────────────
const _sList   = db.prepare(`SELECT * FROM stories ORDER BY created_at DESC`);
const _sGet    = db.prepare(`SELECT * FROM stories WHERE id = ?`);
const _sByFile = db.prepare(`SELECT * FROM stories WHERE prompt_file = ? ORDER BY created_at DESC LIMIT 1`);
const _sIns    = db.prepare(`INSERT INTO stories (id, character, story_name, prompt_file, seq_count, image_dir) VALUES (?, ?, ?, ?, ?, ?)`);
const _sUpdSt  = db.prepare(`UPDATE stories SET status=?, updated_at=datetime('now') WHERE id=?`);
const _sDel    = db.prepare(`DELETE FROM stories WHERE id=?`);

export function listStories()                                            { return _sList.all(); }
export function getStory(id)                                             { return _sGet.get(id) || null; }
export function getStoryByFile(promptFile)                               { return _sByFile.get(promptFile) || null; }
export function createStory(id, character, storyName, promptFile, seqCount, imageDir) {
  _sIns.run(id, character, storyName, promptFile, seqCount, imageDir);
  return getStory(id);
}
export function updateStoryStatus(id, status)                            { _sUpdSt.run(status, id); }
export function deleteStory(id)                                          { _sDel.run(id); }

// ── Sequences ─────────────────────────────────────────────────────────────────
const _seqList  = db.prepare(`SELECT * FROM story_sequences WHERE story_id=? ORDER BY seq_number ASC`);
const _seqIns   = db.prepare(`INSERT INTO story_sequences (id, story_id, seq_number, prompt, image_path, status) VALUES (?, ?, ?, ?, ?, ?)`);
const _seqUpd   = db.prepare(`UPDATE story_sequences SET image_path=?, status=?, generated_at=datetime('now') WHERE id=?`);
const _seqUpdSt = db.prepare(`UPDATE story_sequences SET status=? WHERE id=?`);
const _seqDel   = db.prepare(`DELETE FROM story_sequences WHERE story_id=?`);

export function listSequences(storyId) { return _seqList.all(storyId); }
export function replaceSequences(storyId, seqs) {
  db.transaction(() => {
    _seqDel.run(storyId);
    for (const s of seqs)
      _seqIns.run(s.id, storyId, s.seqNumber, s.prompt, s.imagePath || '', s.imagePath ? 'done' : (s.status || 'pending'));
  })();
}
export function updateSequence(id, imagePath, status)  { _seqUpd.run(imagePath, status, id); }
export function updateSequenceStatus(id, status)        { _seqUpdSt.run(status, id); }

// ── Presets ───────────────────────────────────────────────────────────────────
const _pList   = db.prepare(`SELECT * FROM image_presets ORDER BY is_default DESC, created_at DESC`);
const _pGet    = db.prepare(`SELECT * FROM image_presets WHERE id=?`);
const _pIns    = db.prepare(`INSERT INTO image_presets (id,name,server_type,endpoint,api_key,model,workflow,width,height,is_default,checkpoint,negative_prompt,steps,cfg,sampler) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const _pUpd    = db.prepare(`UPDATE image_presets SET name=?,server_type=?,endpoint=?,api_key=?,model=?,workflow=?,width=?,height=?,is_default=?,checkpoint=?,negative_prompt=?,steps=?,cfg=?,sampler=? WHERE id=?`);
const _pDel    = db.prepare(`DELETE FROM image_presets WHERE id=?`);
const _pClrDef = db.prepare(`UPDATE image_presets SET is_default=0`);

export function listPresets()       { return _pList.all(); }
export function getPreset(id)       { return _pGet.get(id) || null; }
export function createPreset(id, d) {
  if (d.isDefault) _pClrDef.run();
  _pIns.run(id, d.name, d.serverType, d.endpoint||'', d.apiKey||'', d.model||'', d.workflow||'',
    d.width||512, d.height||512, d.isDefault?1:0,
    d.checkpoint||'', d.negativePrompt||'ugly, blurry, low quality, deformed',
    d.steps||20, d.cfg||7.0, d.sampler||'euler');
  return getPreset(id);
}
export function updatePreset(id, d) {
  if (d.isDefault) _pClrDef.run();
  _pUpd.run(d.name, d.serverType, d.endpoint||'', d.apiKey||'', d.model||'', d.workflow||'',
    d.width||512, d.height||512, d.isDefault?1:0,
    d.checkpoint||'', d.negativePrompt||'ugly, blurry, low quality, deformed',
    d.steps||20, d.cfg||7.0, d.sampler||'euler', id);
  return getPreset(id);
}
export function deletePreset(id)    { _pDel.run(id); }
