export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, masterAuth, broadcast, crypto,
    charAuth, getCharacter, genId,
    processImageSizes, saveUploadFile, IMAGE_MIME, SHARED_MEDIA_MIME, MAX_MEDIA_BYTES,
  } = ctx;

  // Sanitise a media array coming from a client: keep only well-formed
  // descriptors that point at our own /uploads/ tree.
  function sanitizeMedia(media) {
    if (!Array.isArray(media)) return [];
    return media.filter(m =>
      m && typeof m.url === 'string' && m.url.startsWith('/uploads/') &&
      ['image', 'audio', 'video'].includes(m.type)
    ).map(m => ({
      type: m.type,
      url: m.url,
      ...(typeof m.thumb === 'string' && m.thumb.startsWith('/uploads/') ? { thumb: m.thumb } : {}),
    })).slice(0, 12);
  }

  // Resolve the requesting viewer/author for calendar writes.
  // Returns { isDM, charId, char } or null when not authorised.
  async function resolveCalActor(req) {
    if (masterAuth(req)) return { isDM: true, charId: '', char: null };
    const cid = req.headers['x-character-id'];
    if (cid && (await charAuth(cid, req)) === 200) {
      const char = await getCharacter(cid);
      return { isDM: false, charId: cid, char };
    }
    return null;
  }

  // ── Events data (campaign log) ────────────────────────────────────────────────
  app.get('/api/events-data', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const data = DB_PROVIDER === 'localdb' ? ldb.getEventsData() : {};
      res.set('Cache-Control', 'no-store');
      res.json(data);
    } catch (err) { console.error('GET /api/events-data:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/events-data', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const data = req.body;
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid body' });
      if (DB_PROVIDER === 'localdb') ldb.saveEventsData(data);
      res.json({ ok: true });
    } catch (err) { console.error('PUT /api/events-data:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Calendar ──────────────────────────────────────────────────────────────────
  app.get('/api/calendar/state', async (req, res) => {
    try {
      const state = DB_PROVIDER === 'localdb' ? ldb.getCalendarState() : { frYear: 1492, frMonth: 1, frDay: 1, frFestival: '' };
      res.set('Cache-Control', 'no-store');
      res.json(state);
    } catch (err) { console.error('GET /api/calendar/state:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/calendar/state', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const s = req.body;
      if (!s || typeof s.frYear !== 'number') return res.status(400).json({ error: 'Invalid body' });
      if (DB_PROVIDER === 'localdb') ldb.saveCalendarState(s);
      broadcast('calendar-updated', { type: 'state' });
      res.json({ ok: true });
    } catch (err) { console.error('PUT /api/calendar/state:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/calendar/events', async (req, res) => {
    try {
      const isDM = masterAuth(req);
      let charId = '';
      if (!isDM) {
        const cid = req.headers['x-character-id'];
        if (cid && (await charAuth(cid, req)) === 200) charId = cid;
      }
      const events = DB_PROVIDER === 'localdb' ? ldb.listCalendarEvents({ isDM, charId }) : [];
      res.set('Cache-Control', 'no-store');
      res.json(events);
    } catch (err) { console.error('GET /api/calendar/events:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/calendar/events', async (req, res) => {
    try {
      const actor = await resolveCalActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthorized' });
      const ev = req.body;
      if (!ev || typeof ev.frYear !== 'number' || !ev.title) return res.status(400).json({ error: 'Invalid body' });
      const id = ev.id || crypto.randomUUID();
      const media = sanitizeMedia(ev.media);
      let record;
      if (actor.isDM) {
        // DM event: honour the public flag and event type as given.
        record = { ...ev, id, media, authorCharId: '', authorName: '' };
      } else {
        // Player journal: author is forced; shared => public, private => DM+author.
        record = {
          ...ev, id, media,
          authorCharId: actor.charId,
          authorName: actor.char?.name || '',
          isPublic: !!ev.shared,
          eventType: 'journal',
        };
      }
      if (DB_PROVIDER === 'localdb') ldb.createCalendarEvent(record);
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true, id });
    } catch (err) { console.error('POST /api/calendar/events:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/calendar/events/:id', async (req, res) => {
    try {
      const actor = await resolveCalActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthorized' });
      const ev = req.body;
      if (!ev || typeof ev.frYear !== 'number') return res.status(400).json({ error: 'Invalid body' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getCalendarEvent(req.params.id) : null;
      if (!existing) return res.status(404).json({ error: 'Not found' });
      // Ownership: DM may edit anything; a player may only edit their own journal.
      if (!actor.isDM && existing.authorCharId !== actor.charId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const media = sanitizeMedia(ev.media);
      let record;
      if (actor.isDM) {
        // DM keeps the stored author; cannot accidentally clear a journal's owner.
        record = { ...ev, media, authorCharId: existing.authorCharId, authorName: existing.authorName };
      } else {
        // Player re-stamps author from the stored row and maps shared => public.
        record = {
          ...ev, media,
          authorCharId: existing.authorCharId,
          authorName: existing.authorName,
          isPublic: !!ev.shared,
          eventType: existing.eventType || 'journal',
        };
      }
      if (DB_PROVIDER === 'localdb') ldb.updateCalendarEvent(req.params.id, record);
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true });
    } catch (err) { console.error('PUT /api/calendar/events/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/calendar/events/:id', async (req, res) => {
    try {
      const actor = await resolveCalActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getCalendarEvent(req.params.id) : null;
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (!actor.isDM && existing.authorCharId !== actor.charId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (DB_PROVIDER === 'localdb') ldb.deleteCalendarEvent(req.params.id);
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true });
    } catch (err) { console.error('DELETE /api/calendar/events/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Calendar media upload (one attachment per call) ─────────────────────────────
  app.post('/api/calendar/media', async (req, res) => {
    try {
      const actor = await resolveCalActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl } = req.body || {};
      const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) return res.status(400).json({ error: 'Invalid data URL' });
      const mime = m[1];
      if (!SHARED_MEDIA_MIME.has(mime)) return res.status(400).json({ error: 'Unsupported media type' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'File too large' });

      const id = genId();
      if (IMAGE_MIME.has(mime)) {
        const urls = await processImageSizes(mime, buf, 'calendar', id);
        return res.json({ type: 'image', url: urls.original, thumb: urls.thumb });
      }
      const url = saveUploadFile('calendar', id, mime, m[2]);
      return res.json({ type: mime.startsWith('audio') ? 'audio' : 'video', url });
    } catch (err) { console.error('POST /api/calendar/media:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
