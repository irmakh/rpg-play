export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth,
    processImageSizes, saveUploadFile,
    IMAGE_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES,
    insertSharedMedia, _mediaGet,
    broadcast, chatLog, CHAT_MAX,
  } = ctx;

  // ── Shared Media ──────────────────────────────────────────────────────────────
  app.post('/api/chat/media', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl, originalName, caption } = req.body || {};
      if (!dataUrl || !originalName) return res.status(400).json({ error: 'dataUrl and originalName required' });
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
      const mimeType = mimeMatch[1].toLowerCase();
      if (!SHARED_MEDIA_MIME.has(mimeType)) return res.status(400).json({ error: 'File type not allowed' });
      const b64 = mimeMatch[2];
      if (Math.ceil(b64.length * 0.75) > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'File too large (max 25 MB)' });
      const mediaId = genId();
      let chatFileUrl, chatMediumUrl = null;
      if (IMAGE_MIME.has(mimeType)) {
        const buffer = Buffer.from(b64, 'base64');
        const urls = await processImageSizes(mimeType, buffer, 'media', mediaId);
        chatFileUrl = urls.original;
        chatMediumUrl = urls.medium;
      } else {
        chatFileUrl = saveUploadFile('media', mediaId, mimeType, b64);
      }
      insertSharedMedia(mediaId, mimeType, Buffer.from('FILE:' + chatFileUrl));
      const entry = {
        id: genId(), sender: 'DM', type: 'media', mediaId, mimeType,
        mediumUrl: chatMediumUrl,
        caption: caption ? String(caption).slice(0, 120) : null,
        timestamp: new Date().toISOString()
      };
      if (DB_PROVIDER === 'localdb') {
        ldb.appendChatLog(entry);
      } else {
        chatLog.push(entry);
        if (chatLog.length > CHAT_MAX) chatLog.shift();
      }
      broadcast('chat', entry);
      res.json({ ok: true, mediaId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/shared-media/:id', (req, res) => {
    const item = _mediaGet.get(req.params.id);
    if (!item) return res.status(404).send('Not found');
    const dataStr = item.data.toString();
    if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
    res.set('Content-Type', item.mime_type);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(item.data);
  });

  // ── Chat / Dice ───────────────────────────────────────────────────────────────
  app.get('/api/chat', (req, res) => {
    if (DB_PROVIDER === 'localdb') return res.json(ldb.listChatLog());
    res.json(chatLog);
  });

  app.post('/api/chat', (req, res) => {
    const { sender, dice, results, modifier, total, label, type, message, description } = req.body;
    let entry;
    if (type === 'text') {
      if (!sender || !message)
        return res.status(400).json({ error: 'sender and message required' });
      entry = {
        id: genId(),
        sender: String(sender).slice(0, 40),
        message: String(message).slice(0, 500),
        type: 'text',
        timestamp: new Date().toISOString()
      };
    } else {
      if (!sender || !dice || !Array.isArray(results) || results.length === 0)
        return res.status(400).json({ error: 'sender, dice, and results[] required' });
      entry = {
        id: genId(),
        sender: String(sender).slice(0, 40),
        dice: String(dice).slice(0, 20),
        results: results.map(Number),
        modifier: parseInt(modifier) || 0,
        total: parseInt(total),
        label: label ? String(label).slice(0, 60) : null,
        description: description ? String(description).slice(0, 200) : null,
        timestamp: new Date().toISOString()
      };
    }
    if (DB_PROVIDER === 'localdb') {
      ldb.appendChatLog(entry);
    } else {
      chatLog.push(entry);
      if (chatLog.length > CHAT_MAX) chatLog.shift();
    }
    broadcast('chat', entry);
    res.json(entry);
  });

  app.delete('/api/chat/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id);
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteChatMessage(id);
    } else {
      const idx = chatLog.findIndex(e => e.id === id);
      if (idx !== -1) chatLog.splice(idx, 1);
    }
    broadcast('chat-delete', { id });
    res.json({ ok: true });
  });

  app.post('/api/chat/clear', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.clearChatLog();
    } else {
      chatLog.length = 0;
    }
    broadcast('chat-clear', {});
    res.json({ ok: true });
  });

  // ── Dice broadcast ────────────────────────────────────────────────────────────
  app.post('/api/dice/broadcast', (req, res) => {
    const { rollId, sides, dieResults, modifier, total, label, duration, sender } = req.body || {};
    if (!sides || !Array.isArray(dieResults) || dieResults.length === 0)
      return res.status(400).json({ error: 'sides and dieResults[] required' });
    broadcast('dice-roll', { rollId, sides, dieResults, modifier: modifier || 0, total, label, duration, sender });
    res.json({ ok: true });
  });

  // ── Map Drawings ──────────────────────────────────────────────────────────────
  app.get('/api/drawings', (_req, res) => {
    try {
      const drawings = DB_PROVIDER === 'localdb' ? ldb.listDrawings() : [];
      res.json(drawings);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/drawings', (req, res) => {
    try {
      const { id, type, x1, y1, x2, y2, color, thickness } = req.body || {};
      if (!id || !type) return res.status(400).json({ error: 'id and type required' });
      const shape = { id: String(id), type: String(type), x1: +x1||0, y1: +y1||0, x2: +x2||0, y2: +y2||0, color: String(color||'#ff4444').slice(0,20), thickness: Math.max(1, Math.min(20, +thickness||2)) };
      if (DB_PROVIDER === 'localdb') ldb.addDrawing(shape.id, shape);
      broadcast('drawing', { action: 'add', shape });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/drawings/preview', (req, res) => {
    try {
      const { shape } = req.body || {};
      if (shape) broadcast('drawing', { action: 'preview', shape });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/drawings', (_req, res) => {
    try {
      if (DB_PROVIDER === 'localdb') ldb.clearDrawings();
      broadcast('drawing', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/drawings/:id', (req, res) => {
    try {
      if (DB_PROVIDER === 'localdb') ldb.deleteDrawing(req.params.id);
      broadcast('drawing', { action: 'remove', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
