/**
 * Per-campaign shared-media store (chat images, the table map blob).
 *
 * Lifted out of server.js, where it was a single module-level media.db. Each
 * campaign now gets its own file, so one campaign's table map and chat images
 * are never reachable from another. The SHARED_MEDIA_MAX cap is therefore
 * per-campaign too, which is the behaviour you want — a busy campaign no
 * longer evicts a quiet one's map.
 *
 * db/campaign-store.js caches one instance per campaign id.
 */
import Database from 'better-sqlite3';

export const SHARED_MEDIA_MAX = 50;

export function openMediaDb(dbFile) {
  const db = new Database(dbFile);
  db.pragma('journal_mode = DELETE');
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_media (
      id        TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data      BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  try { db.exec(`ALTER TABLE shared_media ADD COLUMN thumb_data  TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE shared_media ADD COLUMN medium_data TEXT DEFAULT ''`); } catch {}

  const mediaInsert = db.prepare('INSERT INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
  const mediaUpsert = db.prepare('INSERT OR REPLACE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
  const mediaGet    = db.prepare('SELECT mime_type, data, created_at FROM shared_media WHERE id = ?');
  const mediaCount  = db.prepare('SELECT COUNT(*) as c FROM shared_media');
  const mediaOldest = db.prepare('DELETE FROM shared_media WHERE id = (SELECT id FROM shared_media ORDER BY created_at ASC LIMIT 1)');

  function insertSharedMedia(id, mimeType, buf) {
    mediaInsert.run(id, mimeType, buf, Date.now());
    if (mediaCount.get().c > SHARED_MEDIA_MAX) mediaOldest.run();
  }

  return {
    _db: db, _file: dbFile,
    close() { try { db.close(); } catch {} },
    db,                      // routes prepare ad-hoc statements against this
    insertSharedMedia,
    mediaGet,
    mapUpsert: mediaUpsert,  // the table map is upserted under a fixed id
  };
}
