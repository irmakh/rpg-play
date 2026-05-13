export default function register(app, ctx) {
  const { ldb, idb, DB_PROVIDER, masterAuth, broadcast, crypto } = ctx;

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
      const events = DB_PROVIDER === 'localdb' ? ldb.listCalendarEvents(!isDM) : [];
      res.set('Cache-Control', 'no-store');
      res.json(events);
    } catch (err) { console.error('GET /api/calendar/events:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/calendar/events', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const ev = req.body;
      if (!ev || typeof ev.frYear !== 'number' || !ev.title) return res.status(400).json({ error: 'Invalid body' });
      const id = ev.id || crypto.randomUUID();
      if (DB_PROVIDER === 'localdb') ldb.createCalendarEvent({ ...ev, id });
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true, id });
    } catch (err) { console.error('POST /api/calendar/events:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/calendar/events/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const ev = req.body;
      if (!ev || typeof ev.frYear !== 'number') return res.status(400).json({ error: 'Invalid body' });
      if (DB_PROVIDER === 'localdb') ldb.updateCalendarEvent(req.params.id, ev);
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true });
    } catch (err) { console.error('PUT /api/calendar/events/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/calendar/events/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') ldb.deleteCalendarEvent(req.params.id);
      broadcast('calendar-updated', { type: 'events' });
      res.json({ ok: true });
    } catch (err) { console.error('DELETE /api/calendar/events/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
