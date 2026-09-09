export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth,
    processImageSizes, saveUploadFile,
    IMAGE_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES,
    insertSharedMedia, _mediaGet,
    broadcast,
  } = ctx;
  // Older harnesses register these routes without the campaign helper; then
  // every request shares one key, which is exactly the pre-campaign behaviour.
  const currentCampaignId = ctx.currentCampaignId || (() => '');
  const CHAT_MAX = ctx.CHAT_MAX || 100;

  // The in-memory chat log, per campaign. Only the non-localdb providers use it
  // (localdb keeps chat in the campaign's own database, via the ldb proxy). One
  // shared array made GET /api/chat hand a campaign another campaign's history
  // — including its dmOnly rolls — so the log is keyed the same way the sound
  // playback state is.
  const chatLogs = new Map();   // campaignId -> entry[]

  // '' keys an install with no campaign resolved at all. The campaign
  // middleware answers 409 for those before a handler runs, so it stays empty
  // in practice.
  function chatLog() {
    const key = currentCampaignId() || '';
    let log = chatLogs.get(key);
    if (!log) { log = []; chatLogs.set(key, log); }
    return log;
  }

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
        const log = chatLog();
        log.push(entry);
        if (log.length > CHAT_MAX) log.shift();
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
      if (DB_PROVIDER === 'localdb') {
        ldb.appendChatLog(entry);
      } else {
        const log = chatLog();
        log.push(entry);
        if (log.length > CHAT_MAX) log.shift();
      }
      broadcast('chat', entry);
      res.json({ ok: true, mediaId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Chat / Dice ───────────────────────────────────────────────────────────────
  app.get('/api/chat', (req, res) => {
    const isMaster = masterAuth(req);
    if (DB_PROVIDER === 'localdb') {
      const all = ldb.listChatLog();
      return res.json(isMaster ? all : all.filter(e => !e.dmOnly));
    }
    const log = chatLog();
    res.json(isMaster ? log : log.filter(e => !e.dmOnly));
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
    } else if (DB_PROVIDER === 'localdb') {
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
    const { sender, dice, results, modifier, total, label, type, message, description, dmOnly, html } = req.body;
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
        timestamp: new Date().toISOString()
      };
    }
    if (DB_PROVIDER === 'localdb') {
      ldb.appendChatLog(entry);
    } else {
      const log = chatLog();
      log.push(entry);
      if (log.length > CHAT_MAX) log.shift();
    }
    broadcast('chat', entry);
    notifyChat(entry);
    res.json(entry);
  });

  app.delete('/api/chat/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id);
    if (DB_PROVIDER === 'localdb') {
      ldb.deleteChatMessage(id);
    } else {
      const log = chatLog();
      const idx = log.findIndex(e => e.id === id);
      if (idx !== -1) log.splice(idx, 1);
    }
    broadcast('chat-delete', { id });
    res.json({ ok: true });
  });

  app.post('/api/chat/clear', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      ldb.clearChatLog();
    } else {
      chatLog().length = 0;
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

  app.patch('/api/drawings/:id', (req, res) => {
    try {
      const { type, x1, y1, x2, y2, color, thickness } = req.body || {};
      const shape = { id: req.params.id, type: String(type||'line'), x1: +x1||0, y1: +y1||0, x2: +x2||0, y2: +y2||0, color: String(color||'#ff4444').slice(0,20), thickness: Math.max(1, Math.min(20, +thickness||2)) };
      if (DB_PROVIDER === 'localdb') ldb.updateDrawing(req.params.id, shape);
      broadcast('drawing', { action: 'update', shape });
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
