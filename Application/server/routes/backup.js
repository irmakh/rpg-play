import express from 'express';
import zlib from 'zlib';
import { Readable } from 'stream';

// ── Minimal streaming tar (ustar) writer ──────────────────────────────────────
// Builds a 512-byte POSIX header for one regular file. No deps.
function tarHeader(name, size, mtimeMs) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');                                  // name
  buf.write('0000644\0', 100, 8, 'ascii');                          // mode
  buf.write('0000000\0', 108, 8, 'ascii');                          // uid
  buf.write('0000000\0', 116, 8, 'ascii');                          // gid
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');             // size (octal)
  buf.write(Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii'); // mtime
  buf.write('        ', 148, 8, 'ascii');                           // chksum placeholder (spaces)
  buf.write('0', 156, 1, 'ascii');                                  // typeflag = normal file
  buf.write('ustar\0', 257, 6, 'ascii');                            // magic
  buf.write('00', 263, 2, 'ascii');                                 // version
  let sum = 0; for (let i = 0; i < 512; i++) sum += buf[i];         // checksum over header
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return buf;
}

export default function register(app, ctx) {
  const {
    ldb,
    masterAuth,
    processImageSizes, saveUploadFile, readUploadAsBase64,
    IMAGE_MIME, extToMime,
    mediaDb,
    broadcast,
    path, fs, __dirname,
  } = ctx;

  // 'shop' and 'loot' are no longer exported — they merged into 'treasury' —
  // but restore still accepts backup files carrying those older types.
  const BACKUP_PARTS = ['characters', 'monsters', 'treasury', 'maps'];

  function _sharedMediaWithData(rows) {
    return rows.map(r => {
      const s = r.data.toString();
      const dataB64 = s.startsWith('FILE:') ? readUploadAsBase64(s.slice(5)) : Buffer.from(r.data).toString('base64');
      return { id: r.id, mime_type: r.mime_type, dataB64, created_at: r.created_at };
    });
  }

  async function buildBackupPart(partName) {
    const timestamp = new Date().toISOString();
    // The provider is still written into the file: restore reads it back to find
    // the payload key, and files produced before this was the only backend say
    // 'instantdb' there.
    const base = { version: '1.0', type: partName, timestamp, dbProvider: 'localdb' };
    switch (partName) {
      case 'characters': {
        const { characters, media } = ldb.exportAll();
        return { ...base, characters, media: media.map(r => ({
          id: r.id, charId: r.charId, originalName: r.originalName,
          mimeType: r.mimeType, dataUrl: r.dataUrl,
          isPortrait: r.isPortrait, createdAt: r.createdAt,
          dataB64: readUploadAsBase64(r.dataUrl),
        })) };
      }
      case 'monsters': {
        const monsterRows = ldb.listMonsters();
        const monsters = await Promise.all(monsterRows.map(async m => {
          let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
          const { portraitThumb, portraitMedium, ...dWithoutThumbs } = d;
          return { ...m, dataJson: JSON.stringify(dWithoutThumbs), portraitB64: readUploadAsBase64(d.portrait) };
        }));
        return { ...base, monsters };
      }
      case 'treasury': {
        // Item images travel as base64 like monster portraits do; the derived
        // thumb/medium are stripped and regenerated on restore.
        const treasuryItems = ldb.listTreasuryItems().map(r => {
          const { imageThumb, imageMedium, ...rest } = r;
          return { ...rest, imageB64: readUploadAsBase64(r.imageUrl) };
        });
        return {
          ...base, treasuryItems,
          shopConfig: [ldb.getShopConfig()],
          purchaseLogs: ldb.listPurchaseLogs(),
          lootLogs: ldb.listLootLogs(),
        };
      }
      case 'maps': {
        const preparedMaps = ldb.listPreparedMaps();
        const mapMediaIds = new Set(preparedMaps.map(m => 'prep-map-' + m.id));
        const mapIds = [...mapMediaIds];
        let mapRows = [], chatRows = [];
        if (mapIds.length > 0) {
          const ph = mapIds.map(() => '?').join(',');
          mapRows  = mediaDb.prepare(`SELECT id, mime_type, data, created_at FROM shared_media WHERE id IN (${ph})`).all(...mapIds);
          chatRows = mediaDb.prepare(`SELECT id, mime_type, data, created_at FROM shared_media WHERE id NOT IN (${ph})`).all(...mapIds);
        } else {
          chatRows = mediaDb.prepare('SELECT id, mime_type, data, created_at FROM shared_media').all();
        }
        return {
          ...base,
          preparedMaps,
          mapImages: _sharedMediaWithData(mapRows),
          chatMedia: _sharedMediaWithData(chatRows),
        };
      }
      default: throw new Error('Unknown backup part: ' + partName);
    }
  }

  let _backupRunning = false;

  app.get('/api/admin/backup', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const part = (req.query.part || '').trim();
    if (!BACKUP_PARTS.includes(part)) return res.status(400).json({ error: `Invalid part. Choose one of: ${BACKUP_PARTS.join(', ')}` });
    if (_backupRunning) return res.status(409).json({ error: 'Backup already in progress — please wait.' });
    _backupRunning = true;
    try {
      const data = await buildBackupPart(part);
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="dnd-backup-${part}-${date}.json"`);
      res.json(data);
    } catch (err) {
      console.error('Backup error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Backup failed: ' + err.message });
    } finally {
      _backupRunning = false;
    }
  });

  // ── Raw database file backup ────────────────────────────────────────────────
  // Streams a .tar.gz of the live SQLite files exactly as-is. Uses synchronous
  // copyFileSync snapshots (journal_mode=DELETE + synchronous better-sqlite3 mean
  // a sync copy captures a consistent point-in-time file), then streams the temp
  // copies through gzip so memory stays flat regardless of DB size.
  // NOTE: image/audio bytes live on disk under public/uploads/ (the DBs only hold
  // FILE: references) — those are NOT included here. See memory note for the
  // future "include uploads/" extension.
  const DB_FILES = [
    { name: 'localdb.db', rel: 'localdb.db' },
    { name: 'media.db',   rel: 'media.db' },
    { name: 'stories.db', rel: 'stories.db' },
    { name: 'aiDM.db',    rel: 'aiDM/aiDM.db' },
  ];

  let _dbBackupRunning = false;

  app.get('/api/admin/db-backup', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (_dbBackupRunning) return res.status(409).json({ error: 'A database backup is already in progress — please wait.' });
    _dbBackupRunning = true;

    const stamp = Date.now();
    const temps = []; // { name, path, size, mtime }
    const cleanup = () => {
      for (const t of temps) { try { fs.unlinkSync(t.path); } catch {} }
      _dbBackupRunning = false;
    };

    try {
      // 1. Snapshot each existing DB file synchronously (consistent, blocks the loop).
      for (const f of DB_FILES) {
        const src = path.join(__dirname, f.rel);
        if (!fs.existsSync(src)) continue;
        const tmp = path.join(__dirname, `.dbbk-${stamp}-${f.name}`);
        fs.copyFileSync(src, tmp);
        const st = fs.statSync(tmp);
        temps.push({ name: f.name, path: tmp, size: st.size, mtime: st.mtimeMs });
      }
      if (temps.length === 0) { cleanup(); return res.status(404).json({ error: 'No database files found' }); }

      // 2. Stream the temp snapshots into a gzipped tar.
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="dnd-db-backup-${date}.tar.gz"`);

      async function* tarball() {
        for (const t of temps) {
          yield tarHeader(t.name, t.size, t.mtime);
          for await (const chunk of fs.createReadStream(t.path)) yield chunk;
          const rem = t.size % 512;
          if (rem) yield Buffer.alloc(512 - rem);   // pad file body to 512 boundary
        }
        yield Buffer.alloc(1024);                    // two zero blocks = end of archive
      }

      const gzip = zlib.createGzip();
      Readable.from(tarball()).on('error', () => res.destroy()).pipe(gzip).pipe(res);
      res.on('close', cleanup);
      gzip.on('error', () => { cleanup(); res.destroy(); });
    } catch (err) {
      console.error('DB backup error:', err);
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: 'DB backup failed: ' + err.message });
    }
  });

  app.post('/api/admin/restore', express.json({ limit: '200mb' }), async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const backup = req.body;
      if (!backup || !backup.version) return res.status(400).json({ error: 'Invalid backup file' });

      function writeUploadFile(fileUrl, dataB64) {
        if (!fileUrl || !dataB64 || !fileUrl.startsWith('/uploads/')) return;
        const absPath = path.join(__dirname, 'public', fileUrl);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, Buffer.from(dataB64, 'base64'));
      }

      if (backup.type && (BACKUP_PARTS.includes(backup.type) || backup.type === 'monster')) {
        switch (backup.type) {
          case 'characters': {
            const restoredMedia = [];
            for (const r of (backup.media || [])) {
              writeUploadFile(r.dataUrl, r.dataB64);
              let thumbUrl = '', mediumUrl = '';
              if (IMAGE_MIME.has(r.mimeType) && r.dataB64) {
                try {
                  const buf = Buffer.from(r.dataB64, 'base64');
                  const baseId = path.basename(r.dataUrl, path.extname(r.dataUrl));
                  const urls = await processImageSizes(r.mimeType, buf, 'characters', baseId);
                  thumbUrl = urls.thumb; mediumUrl = urls.medium;
                } catch {}
              }
              restoredMedia.push({ ...r, thumbUrl, mediumUrl });
            }
            ldb.importCharacters(backup.characters, restoredMedia);
            broadcast('characters', { action: 'reload' });
            break;
          }
          case 'monster':
          case 'monsters': {
            const restoredMonsters = [];
            for (const m of (backup.monsters || [])) {
              let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
              if (m.portraitB64 && d.portrait) {
                writeUploadFile(d.portrait, m.portraitB64);
                try {
                  const buf = Buffer.from(m.portraitB64, 'base64');
                  const baseId = path.basename(d.portrait, path.extname(d.portrait));
                  const urls = await processImageSizes(extToMime(d.portrait), buf, 'monsters', baseId);
                  d.portraitThumb = urls.thumb;
                  d.portraitMedium = urls.medium;
                } catch {}
              }
              restoredMonsters.push({ ...m, dataJson: JSON.stringify(d) });
            }
            ldb.importMonsters(restoredMonsters);
            broadcast('monsters', { action: 'reload' });
            break;
          }
          case 'treasury': {
            const restored = [];
            for (const r of (backup.treasuryItems || [])) {
              const it = { ...r };
              if (r.imageB64 && r.imageUrl) {
                writeUploadFile(r.imageUrl, r.imageB64);
                try {
                  const buf = Buffer.from(r.imageB64, 'base64');
                  const baseId = path.basename(r.imageUrl, path.extname(r.imageUrl));
                  const urls = await processImageSizes(extToMime(r.imageUrl), buf, 'treasury', baseId);
                  it.imageThumb = urls.thumb;
                  it.imageMedium = urls.medium;
                } catch {}
              }
              delete it.imageB64;
              restored.push(it);
            }
            ldb.importTreasury(restored, backup.shopConfig, backup.purchaseLogs, backup.lootLogs);
            broadcast('treasury', { action: 'reload' });
            break;
          }
          // Pre-merge backup files: their rows convert into treasury_items.
          case 'shop': {
            ldb.importShop(backup.shopConfig, backup.shopItems, backup.purchaseLogs);
            broadcast('treasury', { action: 'reload' });
            break;
          }
          case 'loot': {
            ldb.importLoot(backup.lootItems, backup.lootLogs);
            broadcast('treasury', { action: 'reload' });
            break;
          }
          case 'maps': {
            ldb.importMaps(backup.preparedMaps);
            const checkMedia = mediaDb.prepare('SELECT id FROM shared_media WHERE id = ?');
            const insMedia   = mediaDb.prepare('INSERT OR IGNORE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
            for (const r of [...(backup.mapImages || []), ...(backup.chatMedia || [])]) {
              if (r.id && r.mime_type && r.dataB64 && !checkMedia.get(r.id)) {
                const subdir = r.id.startsWith('prep-map-') ? 'maps' : 'media';
                const fileUrl = saveUploadFile(subdir, r.id, r.mime_type, r.dataB64);
                insMedia.run(r.id, r.mime_type, Buffer.from('FILE:' + fileUrl), r.created_at || Date.now());
              }
            }
            broadcast('table', { action: 'map-updated' });
            break;
          }
        }
        return res.json({ ok: true, type: backup.type });
      }

      // ── Legacy full backup ─────────────────────────────────────────────────────
      const rawData = backup[backup.dbProvider] || backup.localdb || backup.instantdb;
      if (!rawData) return res.status(400).json({ error: 'No data found in backup' });
      const data = { ...rawData };
      if (data.media) data.media = data.media.map(m => ({ ...m, originalName: m.originalName || m.name || '', dataUrl: m.dataUrl || m.dataJson || '' }));

      ldb.importAll(data);

      if (backup.sqlite && Array.isArray(backup.sqlite.shared_media)) {
        mediaDb.prepare('DELETE FROM shared_media').run();
        const insMedia = mediaDb.prepare('INSERT OR REPLACE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
        for (const r of backup.sqlite.shared_media) {
          if (r.id && r.mime_type && r.data) insMedia.run(r.id, r.mime_type, Buffer.from(r.data, 'base64'), r.created_at || Date.now());
        }
      }

      broadcast('characters', { action: 'reload' });
      broadcast('treasury', { action: 'reload' });
      broadcast('initiative', { action: 'reload' });
      broadcast('table', { action: 'state-updated' });
      broadcast('table', { action: 'map-updated' });
      res.json({ ok: true });
    } catch (err) { console.error('Restore error:', err); res.status(500).json({ error: 'Restore failed: ' + err.message }); }
  });
}
