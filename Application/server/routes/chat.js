// Written by Irmak Hakman — 2026-09-27 11:13

export default function register(app, ctx) {
  const {
    ldb, genId,
    masterAuth, sessionAuth, auth,
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
  // Needs a session, and the sender is the server's to decide (v233). Until then
  // this endpoint accepted a 10 MB image from anyone who could reach the server —
  // no credential at all — wrote it to disk, appended it to the chat log and
  // broadcast it to every client, under whatever `sender` the caller claimed.
  app.post('/api/chat/image', async (req, res) => {
    try {
      if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl, sender, reveal } = req.body || {};
      if (!dataUrl || !sender) return res.status(400).json({ error: 'dataUrl and sender required' });
      // A character always posts as itself, whatever name the page sent — the
      // client falls back to a token name when it has no character name of its
      // own, so this corrects rather than rejects. The DM may post as anyone,
      // which is the point: they post as the token they have selected.
      const from = masterAuth(req)
        ? String(sender)
        : (auth.sessionFromReq(req)?.charName || String(sender));
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
        sender: String(from).slice(0, 40),
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

  // ── Private messages ─────────────────────────────────────────────────────────
  /**
   * Who the caller is, in the same key space server/notify.js addresses people
   * by: 'dm' for this campaign's DM or the super-admin, a character id for a
   * player, null for someone not logged in.
   */
  function whoIs(req) {
    if (masterAuth(req)) return 'dm';
    const s = auth.sessionFromReq(req);
    return s && s.role === 'character' && s.charId ? String(s.charId) : null;
  }

  /**
   * May this person read this entry?
   *
   * The DM reads everything at their table, players' notes to each other
   * included — the table's own choice. Otherwise a private message belongs to
   * the two people named on it, and a dmOnly roll to the DM alone.
   */
  function canRead(entry, me, isDm) {
    if (isDm) return true;
    if (entry.dmOnly) return false;
    if (!entry.to) return true;                                   // public
    return me != null && (entry.to === me || entry.fromId === me);
  }

  /**
   * The `to`/`fromId`/`toName` fields for a private message, or null for a public
   * one. Throws a {status, error} for a recipient that cannot be addressed.
   *
   * The sender is taken from the SESSION, never from the body: a private message
   * nobody can forge is the whole point, and it is why sending one needs a login
   * while an ordinary message does not.
   */
  function privateFields(to, req) {
    if (!to) return null;
    const me = whoIs(req);
    if (!me) throw { status: 401, error: 'Log in to send a private message' };
    const target = String(to);
    if (target === me) throw { status: 400, error: 'That message would only reach you' };
    if (target !== 'dm' && !ldb.getCharacter(target)) throw { status: 404, error: 'No such recipient' };
    return {
      to: target,
      fromId: me,
      toName: target === 'dm' ? 'DM' : (ldb.getCharacter(target).name || 'Unnamed'),
    };
  }

  // ── Chat / Dice ───────────────────────────────────────────────────────────────
  app.get('/api/chat', (req, res) => {
    const isDm = masterAuth(req);
    const me = isDm ? 'dm' : whoIs(req);
    res.json(ldb.listChatLog().filter(e => canRead(e, me, isDm)));
  });

  /**
   * One entry, if the caller may read it.
   *
   * A private message is never broadcast in the clear. Clients are told only that
   * one has arrived and come here for it, so the server decides who sees the text
   * — unlike the dmOnly rolls above, which are hidden by the receiving page and
   * so are visible to anyone reading the socket.
   */
  app.get('/api/chat/entry/:id', (req, res) => {
    const isDm = masterAuth(req);
    const me = isDm ? 'dm' : whoIs(req);
    const entry = ldb.listChatLog().find(e => e.id === req.params.id);
    // A message they may not read is one that does not exist, as far as they know.
    if (!entry || !canRead(entry, me, isDm)) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
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

    // A private message rings for the person it is addressed to and nobody else.
    // The DM can read players' notes in the log, but is not told about each one.
    //
    // The body says only that a message arrived, NEVER what it says: a
    // notification goes out to every socket in the campaign with its recipient
    // list, and each page keeps what is addressed to it — so the text here would
    // be on everyone's wire, undoing the id-only 'chat-pm' broadcast.
    if (entry.to) {
      ctx.notify({
        to: entry.to, exclude,
        kind: 'chat', actorName: sender, priority: 'feed',
        title: `${sender} (private)`,
        body: 'Sent you a private message',
        data: { href: '/table.html' },
      });
      return;
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

  // Posting to the chat needs a login (any DM or character of this campaign)
  // since v240. Every page that has a chat box is reached after logging in, and
  // sends its session with the post; a stranger with only the address cannot
  // write into the table's chat.
  app.post('/api/chat', (req, res) => {
    if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { sender, dice, results, modifier, total, label, type, message, description, dmOnly, html, parts, to } = req.body;
    // `to` makes this a private message (checked below against who is sending);
    // without it the line goes to the whole table.
    let pm;
    try { pm = privateFields(to, req); }
    catch (e) { return res.status(e.status || 400).json({ error: e.error || 'Bad recipient' }); }
    // Only a text line can be private; a roll carrying `to` would be stored in the
    // open while being announced as private.
    if (pm && type !== 'text') return res.status(400).json({ error: 'Only a text message can be private' });
    let entry;
    if (type === 'text') {
      if (!sender || !message)
        return res.status(400).json({ error: 'sender and message required' });
      // html:true marks a message whose body is pre-formatted HTML (e.g. a spell
      // description with embedded tool links — item 9). Allow a larger limit for these.
      // HTML only from someone logged in (v235). Without a session the body is
      // kept as plain text, which every page escapes. The pages sanitise HTML
      // bodies as well (sanitizeChatHtml) — this just stops a stranger's markup
      // reaching them at all.
      const isHtml = html === true && !!whoIs(req);
      // A private message's name comes from the session, as a chat image's does:
      // a character always writes as itself, the DM may speak as any token.
      const name = pm && pm.fromId !== 'dm'
        ? (auth.sessionFromReq(req)?.charName || sender)
        : sender;
      entry = {
        id: genId(),
        sender: String(name).slice(0, 40),
        message: String(message).slice(0, isHtml ? 4000 : 500),
        type: 'text',
        ...(isHtml ? { html: true } : {}),
        ...(pm || {}),
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
    // A private message goes out as a bare knock — an id and nothing else — and
    // each client asks /api/chat/entry/:id whether it is theirs. Putting the text
    // on the wire would hand it to every socket at the table.
    //
    // Since v237 the server also knows who each connection is, so the knock goes
    // only to the two people on the message and the DM, and a dmOnly roll only to
    // the DM. (dmOnly rolls used to be broadcast to everyone and hidden by the
    // page — readable by anyone watching the socket.)
    if (pm) broadcast('chat-pm', { id: entry.id }, undefined, { to: [entry.to, entry.fromId, 'dm'] });
    else broadcast('chat', entry, undefined, entry.dmOnly ? { dmOnly: true } : {});
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
  // The 3D dice every screen replays. Same rule as the chat post it goes with.
  app.post('/api/dice/broadcast', (req, res) => {
    if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
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
  // Anyone at the table may draw on the map, but only someone logged into this
  // campaign (v240) — reading them stays open, every write below checks.
  const drawingDenied = (req, res) => {
    if (sessionAuth(req)) return false;
    res.status(401).json({ error: 'Unauthorized' });
    return true;
  };

  app.get('/api/drawings', (_req, res) => {
    try {
      const drawings = ldb.listDrawings();
      res.json(drawings);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/drawings', (req, res) => {
    if (drawingDenied(req, res)) return;
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
    if (drawingDenied(req, res)) return;
    try {
      const { shape } = req.body || {};
      if (shape) broadcast('drawing', { action: 'preview', shape });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/drawings', (req, res) => {
    if (drawingDenied(req, res)) return;
    try {
      ldb.clearDrawings();
      broadcast('drawing', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.patch('/api/drawings/:id', (req, res) => {
    if (drawingDenied(req, res)) return;
    try {
      const { type, x1, y1, x2, y2, color, thickness } = req.body || {};
      const shape = { id: req.params.id, type: String(type||'line'), x1: +x1||0, y1: +y1||0, x2: +x2||0, y2: +y2||0, color: String(color||'#ff4444').slice(0,20), thickness: Math.max(1, Math.min(20, +thickness||2)) };
      ldb.updateDrawing(req.params.id, shape);
      broadcast('drawing', { action: 'update', shape });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/drawings/:id', (req, res) => {
    if (drawingDenied(req, res)) return;
    try {
      ldb.deleteDrawing(req.params.id);
      broadcast('drawing', { action: 'remove', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
