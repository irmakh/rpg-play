// Written by Irmak Hakman — 2026-09-26 18:10

import { AsyncLocalStorage } from 'async_hooks';

export default function register(app, ctx) {
  const { sdb, ldb, path, fs, __dirname, crypto, sessionAuth } = ctx;

  // Where panel media lives on disk. The server passes its STORY_IMAGES_DIR;
  // the fallback is the same folder, for a caller that does not.
  const STORY_MEDIA_DIR = ctx.STORY_IMAGES_DIR || path.join(__dirname, 'public', 'story-images');

  // A panel video is sent as the raw file, not as base64 inside JSON like an
  // image: 500 MB of base64 would be a 667 MB string held in memory on both
  // ends. The body streams straight to disk instead, counted as it arrives.
  const MAX_STORY_VIDEO_BYTES = ctx.MAX_STORY_VIDEO_BYTES || 500 * 1024 * 1024;   // tests pass a smaller one

  // Everything under /api/stories needs someone logged into this campaign — its
  // DM or any of its characters, which is exactly what the three story pages
  // already ask for on the client (AuthUI.verifyAny).
  //
  // This is a prefix gate rather than a check per route on purpose. Until v233
  // not one of these endpoints checked anything, and because the session gate in
  // lib/security-middleware.js only validates a credential when one is SENT, a
  // request with no header at all could create, rewrite or delete any story and
  // upload or delete its images. Gating the prefix means a new endpoint added
  // below is covered the moment it is written.
  app.use('/api/stories', (req, res, next) => {
    if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  function storyImgDir(storyId) {
    return path.join(STORY_MEDIA_DIR, storyId);
  }

  // The file behind a panel's stored web path (/story-images/<story>/<file>).
  // Only the last two segments are used, so a stored path can never point
  // outside the story media folder.
  function mediaFileFor(webPath) {
    const parts = String(webPath || '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [storyId, file] = parts.slice(-2);
    if (storyId.includes('..') || file.includes('..')) return null;
    return path.join(STORY_MEDIA_DIR, storyId, file);
  }

  function removeMediaFile(webPath) {
    const abs = mediaFileFor(webPath);
    if (abs) { try { fs.unlinkSync(abs); } catch {} }
  }

  function parseCharIds(raw) {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  }

  function enrichStory(story) {
    return { ...story, character_ids: parseCharIds(story.character_ids) };
  }

  // ── Character portraits for multiselect ─────────────────────────────────────
  app.get('/api/stories/character-portraits', (req, res) => {
    const chars = ldb.listCharacters();
    const result = chars.map(c => {
      const media  = ldb.listMedia(c.id);
      const port   = media.find(m => m.isPortrait);
      const thumb  = port ? (port.thumbUrl || port.dataUrl || '') : '';
      let dataJson = {};
      try { dataJson = JSON.parse(c.dataJson || '{}'); } catch {}
      return {
        id:       c.id,
        name:     c.name,
        charType: c.charType,
        thumb,
        species:  dataJson.species || dataJson.race || '',
        cls:      dataJson.class   || '',
        subclass: dataJson.subclass || '',
      };
    });
    res.json(result);
  });

  // ── Stories ─────────────────────────────────────────────────────────────────
  app.get('/api/stories', (req, res) => res.json(sdb.listStories().map(enrichStory)));

  app.post('/api/stories', (req, res) => {
    const { title, character, description, characterIds } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const story = sdb.createStory(
      crypto.randomUUID(),
      (character || '').trim(),
      title.trim(),
      (description || '').trim(),
      Array.isArray(characterIds) ? characterIds : []
    );
    res.json(enrichStory(story));
  });

  app.get('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    const seqs = sdb.listSequences(story.id).map(s => ({ ...s, caption: s.prompt }));
    res.json({ ...enrichStory(story), sequences: seqs });
  });

  app.put('/api/stories/:id', (req, res) => {
    if (!sdb.getStory(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { title, character, description, characterIds } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const updated = sdb.updateStory(
      req.params.id,
      (character || '').trim(),
      title.trim(),
      (description || '').trim(),
      Array.isArray(characterIds) ? characterIds : []
    );
    res.json(enrichStory(updated));
  });

  app.delete('/api/stories/:id', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Not found' });
    try { fs.rmSync(storyImgDir(story.id), { recursive: true, force: true }); } catch {}
    sdb.deleteStory(story.id);
    res.json({ ok: true });
  });

  // ── Sequences ────────────────────────────────────────────────────────────────
  app.post('/api/stories/:id/sequences', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seqs = sdb.listSequences(story.id);
    const seqNumber = req.body?.seqNumber || (seqs.length ? Math.max(...seqs.map(s => s.seq_number)) + 1 : 1);
    const seq = sdb.addSequence(crypto.randomUUID(), story.id, seqNumber, req.body?.caption || '');
    res.json({ ...seq, caption: seq.prompt });
  });

  // Register /reorder before /:seqId to prevent route conflict
  app.post('/api/stories/:id/sequences/reorder', (req, res) => {
    if (!sdb.getStory(req.params.id)) return res.status(404).json({ error: 'Story not found' });
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    sdb.reorderSequences(order);
    res.json({ ok: true });
  });

  app.put('/api/stories/:id/sequences/:seqId', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (typeof req.body?.caption === 'string') sdb.updateSequenceCaption(seq.id, req.body.caption);
    const updated = sdb.getSequence(seq.id);
    res.json({ ...updated, caption: updated.prompt });
  });

  app.delete('/api/stories/:id/sequences/:seqId', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.image_path) removeMediaFile(seq.image_path);
    sdb.deleteSequence(seq.id);
    res.json({ ok: true });
  });

  // ── Image upload ─────────────────────────────────────────────────────────────
  app.post('/api/stories/:id/sequences/:seqId/image', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });

    const { dataUrl } = req.body || {};
    if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
    const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
    if (!m) return res.status(400).json({ error: 'Invalid data URL' });

    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[m[1]] || 'png';
    const dir  = storyImgDir(story.id);
    fs.mkdirSync(dir, { recursive: true });

    if (seq.image_path) removeMediaFile(seq.image_path);

    // Use seq ID as filename so reordering never conflicts
    const filename = `${seq.id}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
    const webPath = `/story-images/${story.id}/${filename}`;
    sdb.updateSequenceImage(seq.id, webPath);
    res.json({ ok: true, imagePath: webPath });
  });

  // ── Video upload ─────────────────────────────────────────────────────────────
  // The body is the raw MP4 (Content-Type: video/mp4). It lands in a .part file
  // first and is renamed into place only once complete and checked, so a broken
  // or refused upload never replaces the panel's current media.
  //
  // A video shares the panel's image_path column with images — a panel holds one
  // or the other, and the .mp4 extension is how the pages tell them apart.
  app.post('/api/stories/:id/sequences/:seqId/video', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });

    // A refusal sent before the body is read closes the connection too, so the
    // client stops streaming a file nobody will keep.
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'video/mp4') {
      return res.set('Connection', 'close').status(415).json({ error: 'Only MP4 videos can be uploaded.' });
    }

    // Refuse on the declared size before reading a byte of it.
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_STORY_VIDEO_BYTES) {
      return res.set('Connection', 'close').status(413).json({ error: 'Videos can be at most 500 MB.', code: 'TOO_LARGE' });
    }

    const dir = storyImgDir(story.id);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${seq.id}.mp4`;
    const partPath = path.join(dir, `${filename}.part`);
    const out = fs.createWriteStream(partPath);

    let received = 0;
    let head = Buffer.alloc(0);   // first bytes, for the MP4 signature check
    let failed = false;

    const fail = (status, error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      try { fs.unlinkSync(partPath); } catch {}
      if (!res.headersSent) {
        // The client may still be sending; closing the connection after the
        // reply stops it streaming the rest of a refused file.
        res.set('Connection', 'close');
        res.status(status).json(status === 413
          ? { error: 'Videos can be at most 500 MB.', code: 'TOO_LARGE' }
          : { error });
      }
    };

    req.on('data', chunk => {
      if (failed) return;
      received += chunk.length;
      // Content-Length can be absent (chunked) or wrong, so the count is the real limit.
      if (received > MAX_STORY_VIDEO_BYTES) return fail(413);
      if (head.length < 12) head = Buffer.concat([head, chunk.subarray(0, 12 - head.length)]);
    });
    req.on('close', () => { if (!req.complete) fail(400, 'Upload interrupted.'); });
    out.on('error', () => fail(500, 'Could not save the video.'));

    // AsyncLocalStorage.bind ties this callback to the request's campaign context
    // now, while we still have it. Without it, 'finish' fires from the socket's
    // reads once the body arrives in pieces (any real upload), outside the
    // request's store — and sdb, a campaign-scoped proxy, throws there. That
    // throw was uncaught and took the whole server down (v238).
    out.on('finish', AsyncLocalStorage.bind(() => {
      if (failed) return;
      // Every MP4 starts with a box whose type, at bytes 4–8, is 'ftyp'.
      if (received === 0 || head.length < 12 || head.subarray(4, 8).toString('latin1') !== 'ftyp') {
        return fail(415, 'That file is not an MP4 video.');
      }
      // Stream callbacks are outside express's error handling, so anything that
      // throws here must be caught and answered, never left to crash the process.
      try {
        if (seq.image_path) removeMediaFile(seq.image_path);
        fs.renameSync(partPath, path.join(dir, filename));
        const webPath = `/story-images/${story.id}/${filename}`;
        sdb.updateSequenceImage(seq.id, webPath);
        res.json({ ok: true, imagePath: webPath, bytes: received });
      } catch (err) {
        console.error('[stories] video save failed:', err);
        fail(500, 'Could not save the video.');
      }
    }));

    req.pipe(out);
  });

  app.delete('/api/stories/:id/sequences/:seqId/image', (req, res) => {
    const story = sdb.getStory(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    const seq = sdb.getSequence(req.params.seqId);
    if (!seq || seq.story_id !== story.id) return res.status(404).json({ error: 'Sequence not found' });
    if (seq.image_path) removeMediaFile(seq.image_path);
    sdb.updateSequenceImage(seq.id, '');
    res.json({ ok: true });
  });
}
