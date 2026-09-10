import express from 'express';
import zlib from 'zlib';
import { Readable } from 'stream';
import { campaignDir } from '../../db/campaign-store.js';

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
    currentCampaignId, currentCampaign,
    path, fs, __dirname,
  } = ctx;

  // 'shop' and 'loot' are no longer exported — they merged into 'treasury' —
  // but restore still accepts backup files carrying those older types.
  //
  // 'chatmedia' used to ride along inside 'maps', which meant every image ever
  // posted to chat was pulled into a map backup — on a real campaign that was 45
  // of 57 media rows and most of an 80 MB download. It is its own part now.
  // Restore still reads chatMedia out of an older 'maps' file.
  const BACKUP_PARTS = ['characters', 'monsters', 'treasury', 'maps', 'waiting', 'handouts', 'events', 'music', 'chat', 'chatmedia'];

  // A handout carries two images (the success and failure reveals); everything
  // else that references a picture has one.
  const _handoutUrls = (r) => [r.successImageUrl, r.failImageUrl].filter(Boolean);

  /**
   * shared_media rows split by what they are. Prepared-map images are keyed
   * 'prep-map-<mapId>'; everything else is chat//shared media.
   * which: 'maps' | 'chat' | 'all'
   */
  function _mediaRows(which) {
    const ids = ldb.listPreparedMaps().map(m => 'prep-map-' + m.id);
    const cols = 'id, mime_type, data, created_at';
    if (which === 'all' || ids.length === 0) {
      const all = mediaDb.prepare(`SELECT ${cols} FROM shared_media`).all();
      if (which === 'all') return all;
      // With no prepared maps, every row is chat media.
      return which === 'chat' ? all : [];
    }
    const ph = ids.map(() => '?').join(',');
    const op = which === 'maps' ? 'IN' : 'NOT IN';
    return mediaDb.prepare(`SELECT ${cols} FROM shared_media WHERE id ${op} (${ph})`).all(...ids);
  }

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
          // Pending player claims/purchases belong with the items they are for.
          treasuryRequests: ldb.exportTreasuryRequests(),
        };
      }
      case 'maps': {
        return {
          ...base,
          preparedMaps: ldb.listPreparedMaps(),
          mapImages: _sharedMediaWithData(_mediaRows('maps')),
        };
      }
      case 'waiting': {
        // The park pages a parked table shows the players. Their images live
        // under uploads/ like every other picture; thumb/medium regenerate.
        const waitingScreens = ldb.listWaitingScreens().map(r => {
          const { imageThumb, imageMedium, ...rest } = r;
          return { ...rest, imageB64: readUploadAsBase64(r.imageUrl) };
        });
        return { ...base, waitingScreens };
      }
      case 'handouts': {
        const { handouts, handoutRecipients } = ldb.exportHandouts();
        return {
          ...base,
          handouts: handouts.map(r => {
            const { successImageThumb, successImageMedium, failImageThumb, failImageMedium, ...rest } = r;
            return {
              ...rest,
              successImageB64: readUploadAsBase64(r.successImageUrl),
              failImageB64: readUploadAsBase64(r.failImageUrl),
            };
          }),
          handoutRecipients,
        };
      }
      case 'events': {
        // The Events screen is a single blob plus the calendar and weather tables.
        // Calendar events can carry media; those are uploads/ files like any other.
        return { ...base, ...ldb.exportEvents() };
      }
      case 'music': {
        // Playlists plus the sound files they name. The audio bytes are files
        // under uploads/sounds/ and travel in the media archive.
        return { ...base, ...ldb.exportMusic() };
      }
      case 'chat': {
        return { ...base, chatLog: ldb.exportChatLog() };
      }
      case 'chatmedia': {
        return { ...base, chatMedia: _sharedMediaWithData(_mediaRows('chat')) };
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
  //
  // The four files live in the REQUESTING CAMPAIGN's directory
  // (data/campaigns/<id>/), resolved per request. They used to be read from
  // __dirname — the pre-multi-tenant location — which meant every campaign
  // downloaded the same stale copy of the original single-tenant database, with
  // none of the tables added since the migration. Never reintroduce a fixed path
  // here: there is no such thing as "the" database any more.
  //
  // NOTE: image/audio bytes live on disk under public/uploads/ (the DBs only hold
  // FILE: references) — those are NOT included here. See memory note for the
  // future "include uploads/" extension.
  const DB_FILE_NAMES = ['localdb.db', 'media.db', 'stories.db', 'aiDM.db'];

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
      // 0. Resolve THIS campaign's data directory.
      const campaignId = currentCampaignId();
      if (!campaignId) { cleanup(); return res.status(409).json({ error: 'No campaign selected' }); }
      const srcDir = campaignDir(campaignId);

      // 1. Snapshot each existing DB file synchronously (consistent, blocks the loop).
      for (const name of DB_FILE_NAMES) {
        const src = path.join(srcDir, name);
        if (!fs.existsSync(src)) continue;
        const tmp = path.join(srcDir, `.dbbk-${stamp}-${name}`);
        fs.copyFileSync(src, tmp);
        const st = fs.statSync(tmp);
        temps.push({ name, path: tmp, size: st.size, mtime: st.mtimeMs });
      }
      if (temps.length === 0) { cleanup(); return res.status(404).json({ error: 'No database files found' }); }

      // 2. Stream the temp snapshots into a gzipped tar. The campaign is named in
      //    the filename so two campaigns' backups cannot be mistaken for each other.
      const date = new Date().toISOString().split('T')[0];
      const slug = String((currentCampaign() || {}).slug || campaignId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'campaign';
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="dnd-db-backup-${slug}-${date}.tar.gz"`);

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

  // ── Archive backup: JSON records and image bytes, as two separate .tar.gz ────
  //
  // The per-part JSON download above embeds every image as base64 inside one
  // object, which it builds whole in memory before sending. On a real campaign
  // that meant ~47 MB of images becoming ~64 MB of base64 inside an 80 MB JSON
  // string, held several times over — measured peak 37 MB -> 222 MB of RSS, which
  // is what killed the server on a smaller box.
  //
  // The archive path never holds a whole part, or a whole image, in memory:
  //   · each part's JSON is written to a temp file incrementally (no
  //     JSON.stringify of the whole object) and carries NO base64 — an image is
  //     referenced by the `file` path it already has under uploads/;
  //   · the images travel in their OWN archive, copied through as raw bytes.
  // Two downloads, so the small records archive is quick and the big image one is
  // taken only when wanted. Both restore through POST /api/admin/restore-archive.

  // Backpressure-aware writer. Returns a promise chain so callers can await.
  function _makeWriter(stream) {
    let chain = Promise.resolve();
    return (s) => {
      chain = chain.then(() => new Promise((resolve, reject) => {
        const ok = stream.write(s, (err) => { if (err) reject(err); });
        if (ok) resolve(); else stream.once('drain', resolve);
      }));
      return chain;
    };
  }

  // Writes `rows` as a JSON array, one element at a time — never one big string.
  async function _writeJsonArray(w, rows, mapFn) {
    await w('[');
    for (let i = 0; i < rows.length; i++) {
      if (i) await w(',');
      await w(JSON.stringify(mapFn(rows[i], i)));
    }
    await w(']');
  }

  const _stripSlash = (u) => String(u || '').replace(/^\/+/, '');

  const _MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'application/pdf': 'pdf',
  };
  const _extFor = (mime) => _MIME_EXT[String(mime || '').toLowerCase()] || 'bin';

  // Some char_media rows predate file storage and keep the whole image as a
  // `data:` URL inside the database column — on a real campaign that was 11 rows
  // and 32 MB of base64. In the archive those bytes travel as files like every
  // other image, and the record points at the file instead, so restoring one of
  // these also migrates it off the inline form.
  function _charMediaFile(r) {
    const u = String(r.dataUrl || '');
    if (u.startsWith('/uploads/')) return _stripSlash(u);
    if (u.startsWith('data:')) return `uploads/characters/${r.id}.${_extFor(r.mimeType)}`;
    return '';
  }

  // The bytes of a `data:` URL, or null if it is not one.
  function _dataUrlBytes(u) {
    const m = String(u || '').match(/^data:[^;,]*;base64,(.*)$/s);
    if (!m) return null;
    try { return Buffer.from(m[1], 'base64'); } catch { return null; }
  }

  // Where a shared_media row's bytes live in the images archive. FILE: rows keep
  // the uploads path they already have; an inline blob is materialised under
  // uploads/media/ so both kinds restore the same way.
  function _mediaFilePath(row) {
    const s = row.data.toString();
    if (s.startsWith('FILE:')) return _stripSlash(s.slice(5));
    const ext = row.mime_type === 'image/png' ? 'png'
              : row.mime_type === 'image/webp' ? 'webp'
              : row.mime_type === 'image/gif' ? 'gif' : 'jpg';
    return `uploads/media/${row.id}.${ext}`;
  }

  function _mediaRecord(row) {
    return { id: row.id, mime_type: row.mime_type, created_at: row.created_at, file: _mediaFilePath(row) };
  }

  // Streams one part's JSON into `stream`. Mirrors buildBackupPart's shape minus
  // every *B64 field, which the images archive carries instead.
  async function writePartJson(partName, stream) {
    const w = _makeWriter(stream);
    await w(`{"version":"1.1","type":${JSON.stringify(partName)},"timestamp":${JSON.stringify(new Date().toISOString())},"dbProvider":"localdb"`);
    switch (partName) {
      case 'characters': {
        const { characters, media } = ldb.exportAll();
        await w(',"characters":'); await _writeJsonArray(w, characters, c => c);
        await w(',"media":'); await _writeJsonArray(w, media, r => {
          const rel = _charMediaFile(r);
          return {
            id: r.id, charId: r.charId, originalName: r.originalName, mimeType: r.mimeType,
            // Rewritten to the file path for an inline data: row, so the record
            // and the images archive agree on where the bytes are.
            dataUrl: rel ? '/' + rel : r.dataUrl,
            isPortrait: r.isPortrait, createdAt: r.createdAt, file: rel,
          };
        });
        break;
      }
      case 'monsters': {
        await w(',"monsters":');
        await _writeJsonArray(w, ldb.listMonsters(), m => {
          let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
          const { portraitThumb, portraitMedium, ...rest } = d;
          return { ...m, dataJson: JSON.stringify(rest), file: rest.portrait ? _stripSlash(rest.portrait) : null };
        });
        break;
      }
      case 'treasury': {
        await w(',"treasuryItems":');
        await _writeJsonArray(w, ldb.listTreasuryItems(), r => {
          const { imageThumb, imageMedium, ...rest } = r;
          return { ...rest, file: r.imageUrl ? _stripSlash(r.imageUrl) : null };
        });
        await w(',"shopConfig":'); await w(JSON.stringify([ldb.getShopConfig()]));
        await w(',"purchaseLogs":'); await _writeJsonArray(w, ldb.listPurchaseLogs(), r => r);
        await w(',"lootLogs":'); await _writeJsonArray(w, ldb.listLootLogs(), r => r);
        await w(',"treasuryRequests":'); await _writeJsonArray(w, ldb.exportTreasuryRequests(), r => r);
        break;
      }
      case 'maps': {
        await w(',"preparedMaps":'); await _writeJsonArray(w, ldb.listPreparedMaps(), m => m);
        await w(',"mapImages":'); await _writeJsonArray(w, _mediaRows('maps'), _mediaRecord);
        break;
      }
      case 'waiting': {
        await w(',"waitingScreens":');
        await _writeJsonArray(w, ldb.listWaitingScreens(), r => {
          const { imageThumb, imageMedium, ...rest } = r;
          return { ...rest, file: r.imageUrl ? _stripSlash(r.imageUrl) : null };
        });
        break;
      }
      case 'handouts': {
        const { handouts, handoutRecipients } = ldb.exportHandouts();
        await w(',"handouts":');
        await _writeJsonArray(w, handouts, r => {
          const { successImageThumb, successImageMedium, failImageThumb, failImageMedium, ...rest } = r;
          return {
            ...rest,
            successFile: r.successImageUrl ? _stripSlash(r.successImageUrl) : null,
            failFile: r.failImageUrl ? _stripSlash(r.failImageUrl) : null,
          };
        });
        await w(',"handoutRecipients":'); await _writeJsonArray(w, handoutRecipients, r => r);
        break;
      }
      case 'events': {
        const ev = ldb.exportEvents();
        await w(',"eventsState":');    await _writeJsonArray(w, ev.eventsState, r => r);
        await w(',"calendarState":');  await _writeJsonArray(w, ev.calendarState, r => r);
        await w(',"calendarEvents":'); await _writeJsonArray(w, ev.calendarEvents, r => r);
        await w(',"weatherConfig":');  await _writeJsonArray(w, ev.weatherConfig, r => r);
        await w(',"weatherLog":');     await _writeJsonArray(w, ev.weatherLog, r => r);
        break;
      }
      case 'music': {
        const mu = ldb.exportMusic();
        await w(',"playlists":');  await _writeJsonArray(w, mu.playlists, r => r);
        await w(',"soundFiles":'); await _writeJsonArray(w, mu.soundFiles, r => r);
        break;
      }
      case 'chat': {
        await w(',"chatLog":'); await _writeJsonArray(w, ldb.exportChatLog(), r => r);
        break;
      }
      case 'chatmedia': {
        await w(',"chatMedia":'); await _writeJsonArray(w, _mediaRows('chat'), _mediaRecord);
        break;
      }
      default: throw new Error('Unknown backup part: ' + partName);
    }
    await w('}');
  }

  // Every image this campaign references, as { archivePath, absPath | buffer }.
  // Derived thumb/medium sizes are left out — restore regenerates them.
  /**
   * The media files this campaign references, limited to the sections asked for.
   *
   * `parts` is the same section list the records archive takes, so ticking
   * Characters and Maps gives you an images archive holding exactly the files
   * those two sections' records point at — the two archives stay a matching
   * pair. Omitting it collects everything.
   *
   * Sections with no files of their own ('chat' is text; its pictures belong to
   * 'chatmedia') simply contribute nothing.
   */
  function collectImageEntries(parts) {
    const want = (Array.isArray(parts) && parts.length)
      ? new Set(parts)
      : new Set(BACKUP_PARTS);
    const out = new Map();   // archivePath -> entry (dedupes a shared file)
    const addUrl = (url) => {
      const rel = _stripSlash(url);
      if (!rel || !rel.startsWith('uploads/') || out.has(rel)) return;
      const abs = path.join(__dirname, 'public', rel);
      if (fs.existsSync(abs)) out.set(rel, { archivePath: rel, absPath: abs });
    };

    // Every char_media row, including rows left behind by a deleted character —
    // characters.json lists those too, so the two archives must agree.
    //
    // Only the metadata is kept: an inline data: row's payload is replaced by a
    // marker here and re-read LAZILY at write time (getBuffer), so the ~33 MB of
    // base64 this listing pulls becomes garbage immediately and only the one row
    // being written is ever held.
    if (want.has('characters')) try {
      const meta = ldb.exportAll().media.map(r => ({
        id: r.id,
        mimeType: r.mimeType,
        inline: String(r.dataUrl || '').startsWith('data:'),
        dataUrl: String(r.dataUrl || '').startsWith('data:') ? '' : r.dataUrl,
      }));
      for (const r of meta) {
        if (!r.inline) { addUrl(r.dataUrl); continue; }
        const rel = _charMediaFile({ id: r.id, mimeType: r.mimeType, dataUrl: 'data:' });
        if (!rel || out.has(rel)) continue;
        const mediaId = r.id;
        out.set(rel, {
          archivePath: rel,
          getBuffer: () => {
            const row = ldb.getMediaById(mediaId);
            return (row && _dataUrlBytes(row.dataUrl)) || Buffer.alloc(0);
          },
        });
      }
    } catch {}
    if (want.has('monsters')) try {
      for (const m of ldb.listMonsters()) {
        let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
        addUrl(d.portrait);
      }
    } catch {}
    if (want.has('treasury')) try { for (const r of ldb.listTreasuryItems()) addUrl(r.imageUrl); } catch {}
    if (want.has('waiting')) try { for (const r of ldb.listWaitingScreens()) addUrl(r.imageUrl); } catch {}
    if (want.has('handouts')) try { for (const r of ldb.exportHandouts().handouts) _handoutUrls(r).forEach(addUrl); } catch {}
    // Sound files are the one non-image this collects; the archive is really a
    // media archive, and a music backup without its audio would be useless.
    if (want.has('music')) try { for (const r of ldb.exportMusic().soundFiles) addUrl(r.url); } catch {}
    if (want.has('events')) try {
      // Calendar events carry a media_json array of { url } entries.
      for (const r of ldb.exportEvents().calendarEvents) {
        let media = []; try { media = JSON.parse(r.media_json || '[]'); } catch {}
        for (const m of media) addUrl(typeof m === 'string' ? m : (m && m.url));
      }
    } catch {}
    // shared_media splits the same way the two sections do: prepared-map images
    // belong to 'maps', everything else to 'chatmedia'.
    for (const [section, which] of [['maps', 'maps'], ['chatmedia', 'chat']]) {
      if (!want.has(section)) continue;
      try {
        for (const row of _mediaRows(which)) {
          const s = row.data.toString();
          if (s.startsWith('FILE:')) { addUrl(s.slice(5)); continue; }
          const rel = _mediaFilePath(row);
          if (!out.has(rel)) out.set(rel, { archivePath: rel, buffer: Buffer.from(row.data) });
        }
      } catch {}
    }
    return [...out.values()];
  }

  // Streams entries as a gzipped tar. `entries` are { archivePath, absPath|buffer }.
  function streamTar(res, filename, entries) {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    async function* tarball() {
      for (const e of entries) {
        // `buffer` is resolved inside the loop and dropped when the iteration
        // ends, so a lazily-fetched entry never outlives its own write.
        let buffer = e.buffer || (e.getBuffer ? e.getBuffer() : null);
        let size, mtime;
        if (buffer) { size = buffer.length; mtime = Date.now(); }
        else { const st = fs.statSync(e.absPath); size = st.size; mtime = st.mtimeMs; }
        yield tarHeader(e.archivePath, size, mtime);
        if (buffer) { yield buffer; buffer = null; }
        else for await (const chunk of fs.createReadStream(e.absPath)) yield chunk;
        const rem = size % 512;
        if (rem) yield Buffer.alloc(512 - rem);
      }
      yield Buffer.alloc(1024);                    // two zero blocks = end of archive
    }
    const gzip = zlib.createGzip();
    Readable.from(tarball()).on('error', () => res.destroy()).pipe(gzip).pipe(res);
    return gzip;
  }

  function _campaignSlug() {
    const c = currentCampaign() || {};
    return String(c.slug || currentCampaignId() || 'campaign').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'campaign';
  }

  let _archiveRunning = false;

  // GET /api/admin/backup-archive?parts=characters,monsters,treasury,maps,chatmedia
  app.get('/api/admin/backup-archive', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const requested = String(req.query.parts || BACKUP_PARTS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
    const parts = requested.filter(p => BACKUP_PARTS.includes(p));
    if (parts.length === 0) return res.status(400).json({ error: `No valid parts. Choose from: ${BACKUP_PARTS.join(', ')}` });
    if (_archiveRunning) return res.status(409).json({ error: 'A backup is already in progress — please wait.' });
    _archiveRunning = true;

    const stamp = Date.now();
    const temps = [];
    const cleanup = () => {
      for (const t of temps) { try { fs.unlinkSync(t.absPath); } catch {} }
      _archiveRunning = false;
    };
    try {
      const dir = campaignDir(currentCampaignId());
      for (const part of parts) {
        const abs = path.join(dir, `.bk-${stamp}-${part}.json`);
        const out = fs.createWriteStream(abs);
        await writePartJson(part, out);
        await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
        temps.push({ archivePath: `${part}.json`, absPath: abs });
      }
      const date = new Date().toISOString().split('T')[0];
      streamTar(res, `dnd-backup-${_campaignSlug()}-${date}.tar.gz`, temps)
        .on('error', () => { cleanup(); res.destroy(); });
      res.on('close', cleanup);
    } catch (err) {
      console.error('Archive backup error:', err);
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: 'Backup failed: ' + err.message });
    }
  });

  // GET /api/admin/backup-images?parts=… — the media the selected sections
  // reference, raw bytes, no base64. Same `parts` list the records archive takes,
  // so the two downloads make a matching pair; omitting it takes everything.
  app.get('/api/admin/backup-images', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const requested = String(req.query.parts || '').split(',').map(s => s.trim()).filter(Boolean);
      const parts = requested.filter(p => BACKUP_PARTS.includes(p));
      if (requested.length && parts.length === 0) {
        return res.status(400).json({ error: `No valid parts. Choose from: ${BACKUP_PARTS.join(', ')}` });
      }
      const entries = collectImageEntries(parts);
      if (entries.length === 0) {
        return res.status(404).json({ error: parts.length
          ? 'The selected sections have no images'
          : 'This campaign has no images' });
      }
      const date = new Date().toISOString().split('T')[0];
      streamTar(res, `dnd-images-${_campaignSlug()}-${date}.tar.gz`, entries)
        .on('error', () => res.destroy());
    } catch (err) {
      console.error('Image backup error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Image backup failed: ' + err.message });
    }
  });

  // ── Restoring one part ──────────────────────────────────────────────────────
  // Shared by POST /api/admin/restore (a single .json) and by the archive restore
  // below, which calls it once per entry in the uploaded tar.
  //
  // Two file layouts are accepted, and a single part may mix them:
  //   · dataB64 / portraitB64 / imageB64 — the older self-contained JSON, where
  //     the bytes are embedded; and
  //   · file — an archive record whose bytes arrived separately in the images
  //     archive and are already on disk under public/uploads/.
  // Derived thumb/medium sizes are regenerated either way, so a restore of one
  // without the other still produces working records (images just render blank
  // until the matching images archive is restored too).

  function _writeUploadFile(fileUrl, dataB64) {
    if (!fileUrl || !dataB64 || !String(fileUrl).startsWith('/uploads/')) return;
    const absPath = path.join(__dirname, 'public', fileUrl);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(dataB64, 'base64'));
  }

  // Bytes for one record: from its embedded base64, else from the file already on
  // disk. Returns null when neither is available.
  function _recordBytes(dataB64, fileUrl) {
    if (dataB64) { try { return Buffer.from(dataB64, 'base64'); } catch { return null; } }
    const rel = _stripSlash(fileUrl);
    if (!rel.startsWith('uploads/')) return null;
    try { return fs.readFileSync(path.join(__dirname, 'public', rel)); } catch { return null; }
  }

  async function restoreTypedPart(backup) {
    switch (backup.type) {
      case 'characters': {
        const restoredMedia = [];
        for (const r of (backup.media || [])) {
          _writeUploadFile(r.dataUrl, r.dataB64);
          let thumbUrl = '', mediumUrl = '';
          const buf = _recordBytes(r.dataB64, r.dataUrl || r.file);
          if (IMAGE_MIME.has(r.mimeType) && buf) {
            try {
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
          if (d.portrait) {
            _writeUploadFile(d.portrait, m.portraitB64);
            const buf = _recordBytes(m.portraitB64, d.portrait);
            if (buf) {
              try {
                const baseId = path.basename(d.portrait, path.extname(d.portrait));
                const urls = await processImageSizes(extToMime(d.portrait), buf, 'monsters', baseId);
                d.portraitThumb = urls.thumb;
                d.portraitMedium = urls.medium;
              } catch {}
            }
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
          if (r.imageUrl) {
            _writeUploadFile(r.imageUrl, r.imageB64);
            const buf = _recordBytes(r.imageB64, r.imageUrl);
            if (buf) {
              try {
                const baseId = path.basename(r.imageUrl, path.extname(r.imageUrl));
                const urls = await processImageSizes(extToMime(r.imageUrl), buf, 'treasury', baseId);
                it.imageThumb = urls.thumb;
                it.imageMedium = urls.medium;
              } catch {}
            }
          }
          delete it.imageB64; delete it.file;
          restored.push(it);
        }
        ldb.importTreasury(restored, backup.shopConfig, backup.purchaseLogs, backup.lootLogs);
        // Absent from files written before requests were backed up; harmless then.
        ldb.importTreasuryRequests(backup.treasuryRequests);
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
      case 'waiting': {
        const restored = [];
        for (const r of (backup.waitingScreens || [])) {
          const it = { ...r };
          if (r.imageUrl) {
            _writeUploadFile(r.imageUrl, r.imageB64);
            const buf = _recordBytes(r.imageB64, r.imageUrl);
            if (buf) {
              try {
                const baseId = path.basename(r.imageUrl, path.extname(r.imageUrl));
                const urls = await processImageSizes(extToMime(r.imageUrl), buf, 'waiting', baseId);
                it.imageThumb = urls.thumb;
                it.imageMedium = urls.medium;
              } catch {}
            }
          }
          delete it.imageB64; delete it.file;
          restored.push(it);
        }
        ldb.importWaitingScreens(restored);
        broadcast('table', { action: 'waiting-screens-updated' });
        break;
      }
      case 'handouts': {
        const restored = [];
        for (const r of (backup.handouts || [])) {
          const it = { ...r };
          // Both reveals restore the same way; each regenerates its own sizes.
          for (const [urlKey, b64Key, thumbKey, medKey] of [
            ['successImageUrl', 'successImageB64', 'successImageThumb', 'successImageMedium'],
            ['failImageUrl',    'failImageB64',    'failImageThumb',    'failImageMedium'],
          ]) {
            if (!r[urlKey]) continue;
            _writeUploadFile(r[urlKey], r[b64Key]);
            const buf = _recordBytes(r[b64Key], r[urlKey]);
            if (!buf) continue;
            try {
              const baseId = path.basename(r[urlKey], path.extname(r[urlKey]));
              const urls = await processImageSizes(extToMime(r[urlKey]), buf, 'handouts', baseId);
              it[thumbKey] = urls.thumb;
              it[medKey] = urls.medium;
            } catch {}
          }
          delete it.successImageB64; delete it.failImageB64;
          delete it.successFile; delete it.failFile;
          restored.push(it);
        }
        ldb.importHandouts({ handouts: restored, handoutRecipients: backup.handoutRecipients });
        broadcast('handouts', { action: 'reload' });
        break;
      }
      case 'events': {
        ldb.importEvents(backup);
        broadcast('events', { action: 'reload' });
        broadcast('calendar-updated', {});
        break;
      }
      case 'music': {
        ldb.importMusic(backup);
        broadcast('sound', { action: 'reload' });
        break;
      }
      case 'chat': {
        ldb.importChatLog(backup.chatLog);
        broadcast('chat-reload', {});
        break;
      }
      case 'maps':
      case 'chatmedia': {
        if (backup.preparedMaps) ldb.importMaps(backup.preparedMaps);
        // An older 'maps' file carries chatMedia inside it; a new one keeps them
        // in the separate 'chatmedia' part. Both land in shared_media here.
        _restoreSharedMedia([...(backup.mapImages || []), ...(backup.chatMedia || [])]);
        broadcast('table', { action: 'map-updated' });
        break;
      }
      default:
        throw new Error('Unknown backup type: ' + backup.type);
    }
    return { ok: true, type: backup.type };
  }

  // shared_media rows, from either an embedded dataB64 or a file already on disk.
  function _restoreSharedMedia(rows) {
    const checkMedia = mediaDb.prepare('SELECT id FROM shared_media WHERE id = ?');
    const insMedia   = mediaDb.prepare('INSERT OR IGNORE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
    for (const r of rows) {
      if (!r || !r.id || !r.mime_type || checkMedia.get(r.id)) continue;
      if (r.dataB64) {
        const subdir = r.id.startsWith('prep-map-') ? 'maps' : 'media';
        const fileUrl = saveUploadFile(subdir, r.id, r.mime_type, r.dataB64);
        insMedia.run(r.id, r.mime_type, Buffer.from('FILE:' + fileUrl), r.created_at || Date.now());
      } else if (r.file) {
        // Bytes came from the images archive; point the row at that file.
        const rel = _stripSlash(r.file);
        if (!rel.startsWith('uploads/')) continue;
        insMedia.run(r.id, r.mime_type, Buffer.from('FILE:/' + rel), r.created_at || Date.now());
      }
    }
  }

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

      if (backup.type && (BACKUP_PARTS.includes(backup.type) || backup.type === monster)) {
        return res.json(await restoreTypedPart(backup));
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
  // ── Archive restore ─────────────────────────────────────────────────────────
  // Accepts either archive produced above — the records one (*.json entries) or
  // the images one (uploads/... entries) — and works out which from the entries
  // themselves, so the DM does not have to say. The upload is consumed as a
  // stream: nothing is buffered whole, and image bytes go straight to disk.
  //
  // Sending a non-JSON Content-Type keeps the global express.json() body parser
  // out of the way, leaving `req` an unread stream.

  /**
   * Minimal streaming ustar reader — the mirror of tarHeader() at the top.
   * Calls onEntry(name, size) for each file; it returns a sink
   * { write(chunk), end() } that receives the body.
   */
  async function extractTar(stream, onEntry) {
    let buf = Buffer.alloc(0);
    let mode = 'header';
    let sink = null, remaining = 0, pad = 0;

    for await (const chunk of stream) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let progressed = true;
      while (progressed) {
        progressed = false;
        if (mode === 'header') {
          if (buf.length < 512) break;
          const h = buf.subarray(0, 512);
          buf = buf.subarray(512);
          // Two zero blocks mark the end of the archive.
          if (h.every(b => b === 0)) { mode = 'done'; break; }
          const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
          const sizeOct = h.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
          const size = parseInt(sizeOct, 8) || 0;
          sink = await onEntry(name, size);
          remaining = size;
          pad = (512 - (size % 512)) % 512;
          mode = remaining > 0 ? 'body' : 'pad';
          progressed = true;
        } else if (mode === 'body') {
          if (buf.length === 0) break;
          const take = Math.min(remaining, buf.length);
          if (sink) await sink.write(buf.subarray(0, take));
          buf = buf.subarray(take);
          remaining -= take;
          if (remaining === 0) mode = 'pad';
          progressed = true;
        } else if (mode === 'pad') {
          if (buf.length < pad) break;
          buf = buf.subarray(pad);
          if (sink) await sink.end();
          sink = null;
          mode = 'header';
          progressed = true;
        } else {
          break;   // done
        }
      }
      if (mode === 'done') break;
    }
    if (sink) await sink.end();
  }

  app.post('/api/admin/restore-archive', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

    const jsonParts = [];      // { name, text } collected in tar order
    let imageCount = 0;
    let skipped = 0;

    try {
      const gunzip = zlib.createGunzip();
      req.pipe(gunzip);

      await extractTar(gunzip, async (name, size) => {
        const clean = _stripSlash(name);

        // Records archive: a small JSON per part.
        if (clean.endsWith('.json')) {
          const chunks = [];
          return {
            write: async (c) => { chunks.push(Buffer.from(c)); },
            end:   async () => { jsonParts.push({ name: clean, text: Buffer.concat(chunks).toString('utf8') }); },
          };
        }

        // Images archive: uploads/... written straight to disk, never buffered.
        // The prefix check is what keeps a crafted archive inside uploads/.
        const abs = path.join(__dirname, 'public', clean);
        const root = path.join(__dirname, 'public', 'uploads');
        if (!clean.startsWith('uploads/') || !path.resolve(abs).startsWith(path.resolve(root))) {
          skipped++;
          return { write: async () => {}, end: async () => {} };
        }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const out = fs.createWriteStream(abs);
        return {
          write: (c) => new Promise((resolve, reject) => out.write(c, (e) => e ? reject(e) : resolve())),
          end:   () => new Promise((resolve, reject) => { imageCount++; out.end((e) => e ? reject(e) : resolve()); }),
        };
      });

      // Restore records after the images, so regenerating thumbnails finds the
      // bytes on disk when both archives are restored in one go.
      const restored = [];
      for (const p of jsonParts) {
        let backup;
        try { backup = JSON.parse(p.text); }
        catch { return res.status(400).json({ error: `${p.name} is not valid JSON` }); }
        if (!backup || !backup.type) { skipped++; continue; }
        await restoreTypedPart(backup);
        restored.push(backup.type);
      }

      if (restored.length === 0 && imageCount === 0) {
        return res.status(400).json({ error: 'Archive contained nothing restorable' });
      }

      broadcast('characters', { action: 'reload' });
      broadcast('treasury', { action: 'reload' });
      broadcast('table', { action: 'map-updated' });
      res.json({ ok: true, parts: restored, images: imageCount, skipped });
    } catch (err) {
      console.error('Archive restore error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Restore failed: ' + err.message });
    }
  });

}
