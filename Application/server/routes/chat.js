export default function register(app, ctx) {
  const {
    ldb, genId,
    masterAuth,
    processImageSizes, saveUploadFile,
    IMAGE_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES,
    insertSharedMedia, _mediaGet,
    broadcast,
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
      ldb.appendChatLog(entry);
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

  // ── Chat Image Upload (all users) ────────────────────────────────────────────
  app.post('/api/chat/image', async (req, res) => {
    try {
      const { dataUrl, sender, reveal } = req.body || {};
      if (!dataUrl || !sender) return res.status(400).json({ error: 'dataUrl and sender required' });
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
      const mimeType = mimeMatch[1].toLowerCase();
      if (!IMAGE_MIME.has(mimeType)) return res.status(400).json({ error: 'Images only' });
      const b64 = mimeMatch[2];
      if (Math.ceil(b64.length * 0.75) > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 10 MB)' });
      const mediaId = genId();
      const buffer = Buffer.from(b64, 'base64');
      const urls = await processImageSizes(mimeType, buffer, 'media', mediaId);
      insertSharedMedia(mediaId, mimeType, Buffer.from('FILE:' + urls.original));
      // Item 10: DM "reveal" pops a central modal on every client (each player closes
      // their own view) instead of pinning the image to the chat log. DM-only.
      if (reveal === true && masterAuth(req)) {
        broadcast('table', { action: 'image-reveal', url: urls.original, mediumUrl: urls.medium });
        return res.json({ ok: true, mediaId, revealed: true });
      }
      const entry = {
        id: genId(),
        sender: String(sender).slice(0, 40),
        type: 'media',
        mediaId,
        mimeType,
        mediumUrl: urls.medium,
        caption: null,
        timestamp: new Date().toISOString()
      };
      ldb.appendChatLog(entry);
      broadcast('chat', entry);
      res.json({ ok: true, mediaId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Chat / Dice ───────────────────────────────────────────────────────────────
  app.get('/api/chat', (req, res) => {
    const isMaster = masterAuth(req);
    const all = ldb.listChatLog();
    res.json(isMaster ? all : all.filter(e => !e.dmOnly));
  });

  /**
   * A chat line or a roll, folded into the bell.
   *
   * Only this endpoint notifies — a roll usually also hits /api/dice/broadcast
   * for the animation, and announcing both would tell everybody twice. This is
   * the durable record, so it is the one that speaks.
   *
   * Both are 'feed': silent, bell only, and coalesced per sender, so a combat
   * round becomes "Gerion rolled 6 times" rather than six separate rows.
   */
  function notifyChat(entry) {
    if (!ctx.notify || !entry || entry.type === 'media') return;
    const sender = entry.sender || '';
    // The sender is a display name; find whose it is so they are not told about
    // their own message. 'DM' is the DM's.
    let exclude = [];
    if (sender === 'DM') {
      exclude = ['dm'];
    } else {
      try {
        const me = ldb.listCharacters().find(c => (c.name || '') === sender);
        if (me) exclude = [me.id];
      } catch {}
    }

    const isRoll = entry.type !== 'text';
    if (isRoll) {
      const label = entry.label ? ' (' + entry.label + ')' : '';
      ctx.notify({
        // A DM-only roll stays with the DM, exactly as it does in the chat log.
        to: entry.dmOnly ? 'dm' : 'all', exclude,
        kind: 'dice', actorName: sender, priority: 'feed',
        title: `${sender} rolled ${entry.total}${label}`,
        coalesce: true,
        coalesceTitle: `${sender} rolled {count} times`,
        coalesceBody: `Latest: ${entry.total}${label}`,
        data: { href: '/table.html' },
      });
    } else {
      const text = String(entry.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return;
      ctx.notify({
        to: 'all', exclude,
        kind: 'chat', actorName: sender, priority: 'feed',
        title: sender, body: text.slice(0, 140),
        coalesce: true,
        coalesceTitle: `${sender} — {count} messages`,
        coalesceBody: text.slice(0, 140),
        data: { href: '/table.html' },
      });
    }
  }

  app.post('/api/chat', (req, res) => {
    const { sender, dice, results, modifier, total, label, type, message, description, dmOnly, html, parts } = req.body;
    let entry;
    if (type === 'text') {
      if (!sender || !message)
        return res.status(400).json({ error: 'sender and message required' });
      // html:true marks a message whose body is pre-formatted HTML (e.g. a spell
      // description with embedded tool links — item 9). Allow a larger limit for these.
      const isHtml = html === true;
      entry = {
        id: genId(),
        sender: String(sender).slice(0, 40),
        message: String(message).slice(0, isHtml ? 4000 : 500),
        type: 'text',
        ...(isHtml ? { html: true } : {}),
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
        // Full damage/roll descriptions post intact (was truncated at 200); 4000
        // matches the large HTML-message cap and stays a sane bound against abuse.
        description: description ? String(description).slice(0, 4000) : null,
        dmOnly: dmOnly === true,
        // Typed damage breakdown ("1d6 piercing, 2d8 fire"). Optional and
        // additive: dice/results/total above still describe the whole roll, so
        // an entry logged before this feature renders unchanged.
        ...(Array.isArray(parts) && parts.length ? { parts: parts.slice(0, 10).map(p => ({
          dice: p && p.dice ? String(p.dice).slice(0, 20) : '',
          type: p && p.type ? String(p.type).slice(0, 24) : 'generic',
          results: Array.isArray(p && p.results) ? p.results.slice(0, 100).map(Number) : [],
          modifier: parseInt(p && p.modifier) || 0,
          total: parseInt(p && p.total) || 0,
        })) } : {}),
        timestamp: new Date().toISOString()
      };
    }
    ldb.appendChatLog(entry);
    broadcast('chat', entry);
    notifyChat(entry);
    res.json(entry);
  });

  app.delete('/api/chat/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id);
    ldb.deleteChatMessage(id);
    broadcast('chat-delete', { id });
    res.json({ ok: true });
  });

  app.post('/api/chat/clear', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    ldb.clearChatLog();
    broadcast('chat-clear', {});
    res.json({ ok: true });
  });

  // ── Dice broadcast ────────────────────────────────────────────────────────────
  app.post('/api/dice/broadcast', (req, res) => {
    const { rollId, sides, dieResults, modifier, total, label, duration, sender, usedIdx, groups } = req.body || {};
    if (!sides || !Array.isArray(dieResults) || dieResults.length === 0)
      return res.status(400).json({ error: 'sides and dieResults[] required' });
    // A multi-type damage roll adds `groups` so every client replays the same
    // grouped overlay. sides/dieResults still describe the first group, so a
    // client that predates this keeps animating exactly as before.
    let safeGroups = null;
    if (Array.isArray(groups) && groups.length) {
      safeGroups = groups.slice(0, 10).map(g => ({
        sides: parseInt(g && g.sides) || 0,
        results: Array.isArray(g && g.results) ? g.results.slice(0, 100).map(Number) : [],
        modifier: parseInt(g && g.modifier) || 0,
        total: parseInt(g && g.total) || 0,
        type: g && g.type ? String(g.type).slice(0, 24) : 'generic',
        dice: g && g.dice ? String(g.dice).slice(0, 20) : '',
      }));
    }
    broadcast('dice-roll', {
      rollId, sides, dieResults, modifier: modifier || 0, total, label, duration, sender,
      ...(usedIdx !== undefined ? { usedIdx } : {}),
      ...(safeGroups ? { groups: safeGroups } : {}),
    });
    res.json({ ok: true });
  });

  // ── Map Drawings ──────────────────────────────────────────────────────────────
  app.get('/api/drawings', (_req, res) => {
    try {
      const drawings = ldb.listDrawings();
      res.json(drawings);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/drawings', (req, res) => {
    try {
      const { id, type, x1, y1, x2, y2, color, thickness } = req.body || {};
      if (!id || !type) return res.status(400).json({ error: 'id and type required' });
      const shape = { id: String(id), type: String(type), x1: +x1||0, y1: +y1||0, x2: +x2||0, y2: +y2||0, color: String(color||'#ff4444').slice(0,20), thickness: Math.max(1, Math.min(20, +thickness||2)) };
      ldb.addDrawing(shape.id, shape);
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
      ldb.clearDrawings();
      broadcast('drawing', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.patch('/api/drawings/:id', (req, res) => {
    try {
      const { type, x1, y1, x2, y2, color, thickness } = req.body || {};
      const shape = { id: req.params.id, type: String(type||'line'), x1: +x1||0, y1: +y1||0, x2: +x2||0, y2: +y2||0, color: String(color||'#ff4444').slice(0,20), thickness: Math.max(1, Math.min(20, +thickness||2)) };
      ldb.updateDrawing(req.params.id, shape);
      broadcast('drawing', { action: 'update', shape });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/drawings/:id', (req, res) => {
    try {
      ldb.deleteDrawing(req.params.id);
      broadcast('drawing', { action: 'remove', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
