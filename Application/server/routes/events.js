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

  // ── Weather (DM-only) ─────────────────────────────────────────────────────────
  // Each of the three categories rolls its own d20 to pick a severity level. The
  // d20→level thresholds are DM-configurable (defaults 15 / 18, i.e. 1–14 normal,
  // 15–17 level1, 18–20 level2):
  //   r >= level2Min → level2 ; r >= level1Min → level1 ; else normal.
  // Temperature: normal = Session Normal; level1 = colder (−2d6); level2 = hotter (+2d6).
  // Wind:        normal = Normal; level1 = Light; level2 = Strong.
  // Precip:      normal = None; level1 = Light; level2 = Heavy — snow when the day's
  //              temperature is at/below freezing (32°F), otherwise rain.
  const WEATHER_FREEZING = 32;
  const _d = (n) => Math.floor(Math.random() * n) + 1;
  const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Normalise the two thresholds into a coherent pair: 1 ≤ l1 ≤ l2 ≤ 20.
  function _clampThresholds(l1, l2) {
    l1 = _clamp(parseInt(l1) || 15, 1, 20);
    l2 = _clamp(parseInt(l2) || 18, l1, 20);
    return { level1Min: l1, level2Min: l2 };
  }
  const _levelFromD20 = (r, l1, l2) => (r >= l2 ? 'level2' : r >= l1 ? 'level1' : 'normal');

  function rollWeather(sessionNormal, level1Min, level2Min) {
    const lvl = (r) => _levelFromD20(r, level1Min, level2Min);
    // Temperature
    const tRoll = _d(20), tLevel = lvl(tRoll);
    let temperature = sessionNormal, tDice = [];
    if (tLevel !== 'normal') {
      tDice = [_d(6), _d(6)];
      const delta = tDice[0] + tDice[1];
      temperature = tLevel === 'level1' ? sessionNormal - delta : sessionNormal + delta;
    }
    // Wind
    const wRoll = _d(20), wLevel = lvl(wRoll);
    const wind = wLevel === 'level2' ? 'Strong' : wLevel === 'level1' ? 'Light' : 'Normal';
    // Precipitation — snow vs rain decided by the day's temperature
    const pRoll = _d(20), pLevel = lvl(pRoll);
    const wet = temperature <= WEATHER_FREEZING ? 'snow' : 'rain';
    const precipitation = pLevel === 'level2' ? `Heavy ${wet}` : pLevel === 'level1' ? `Light ${wet}` : 'None';
    return {
      temperature: { roll: tRoll, level: tLevel, dice: tDice, value: temperature },
      wind:        { roll: wRoll, level: wLevel, value: wind },
      precipitation: { roll: pRoll, level: pLevel, value: precipitation },
    };
  }

  // Build a stable per-day key from a campaign date.
  function weatherDateKey(d) {
    if (d.frFestival) return `${d.frYear}-F-${d.frFestival}`;
    return `${d.frYear}-${d.frMonth}-${d.frDay}`;
  }

  app.get('/api/weather/config', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const cfg = DB_PROVIDER === 'localdb' ? ldb.getWeatherConfig() : { sessionNormal: 60, level1Min: 15, level2Min: 18 };
      res.set('Cache-Control', 'no-store');
      res.json(cfg);
    } catch (err) { console.error('GET /api/weather/config:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/weather/config', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body || {};
      const patch = {};
      if (body.sessionNormal != null) {
        const n = parseInt(body.sessionNormal);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'Invalid sessionNormal' });
        patch.sessionNormal = n;
      }
      if (body.level1Min != null || body.level2Min != null) {
        const cur = DB_PROVIDER === 'localdb' ? ldb.getWeatherConfig() : { level1Min: 15, level2Min: 18 };
        const { level1Min, level2Min } = _clampThresholds(
          body.level1Min != null ? body.level1Min : cur.level1Min,
          body.level2Min != null ? body.level2Min : cur.level2Min);
        patch.level1Min = level1Min;
        patch.level2Min = level2Min;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
      if (DB_PROVIDER === 'localdb') ldb.saveWeatherConfig(patch);
      res.json({ ok: true, ...patch });
    } catch (err) { console.error('PUT /api/weather/config:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Public read — players see weather on the index calendar tab and the table
  // screen reads "today's" weather. Weather is environmental, not secret.
  app.get('/api/weather/log', (req, res) => {
    try {
      const log = DB_PROVIDER === 'localdb' ? ldb.listWeatherLog() : [];
      res.set('Cache-Control', 'no-store');
      res.json(log);
    } catch (err) { console.error('GET /api/weather/log:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Manually set/override a date's weather (DM-only). Accepts explicit level +
  // value for each category — used by the events-screen editor. roll is null
  // for manual entries (no d20 was thrown).
  const WX_LEVELS = ['normal', 'level1', 'level2'];
  function _normCategory(o, allowDice) {
    if (!o || typeof o !== 'object') return null;
    const level = WX_LEVELS.includes(o.level) ? o.level : 'normal';
    const roll = Number.isFinite(parseInt(o.roll)) ? parseInt(o.roll) : null;
    const out = { roll, level };
    if (allowDice) out.dice = Array.isArray(o.dice) ? o.dice.map(n => parseInt(n) || 0).slice(0, 4) : [];
    return out;
  }

  app.post('/api/weather/set', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER !== 'localdb') return res.status(501).json({ error: 'Weather requires localdb' });
      const { date, sessionNormal, dateLabel, temperature, wind, precipitation } = req.body || {};
      if (!date || typeof date.frYear !== 'number') return res.status(400).json({ error: 'Invalid date' });
      const t = _normCategory(temperature, true);
      const w = _normCategory(wind, false);
      const p = _normCategory(precipitation, false);
      if (!t || !w || !p) return res.status(400).json({ error: 'Missing weather fields' });
      const tempVal = parseInt(temperature.value);
      if (!Number.isFinite(tempVal)) return res.status(400).json({ error: 'Invalid temperature value' });
      const sn = Number.isFinite(parseInt(sessionNormal)) ? parseInt(sessionNormal) : ldb.getWeatherConfig().sessionNormal;
      const entry = {
        id: weatherDateKey(date),
        frYear: date.frYear, frMonth: date.frMonth ?? null, frDay: date.frDay ?? null, frFestival: date.frFestival || '',
        dateLabel: String(dateLabel || ''),
        sessionNormal: sn,
        temperature: { ...t, value: tempVal },
        wind: { ...w, value: String(wind.value || 'Normal') },
        precipitation: { ...p, value: String(precipitation.value || 'None') },
      };
      const saved = ldb.saveWeatherEntry(entry);
      broadcast('calendar-updated', { type: 'weather' });
      res.json(saved);
    } catch (err) { console.error('POST /api/weather/set:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/weather/log/:id', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') ldb.deleteWeatherEntry(req.params.id);
      broadcast('calendar-updated', { type: 'weather' });
      res.json({ ok: true });
    } catch (err) { console.error('DELETE /api/weather/log:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/weather/roll', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER !== 'localdb') return res.status(501).json({ error: 'Weather requires localdb' });
      const { date, sessionNormal, dateLabel } = req.body || {};
      if (!date || typeof date.frYear !== 'number') return res.status(400).json({ error: 'Invalid date' });
      const sn = parseInt(sessionNormal);
      if (!Number.isFinite(sn)) return res.status(400).json({ error: 'Invalid sessionNormal' });
      // Resolve the d20 thresholds from the request (modal) or the stored config.
      const cur = ldb.getWeatherConfig();
      const { level1Min, level2Min } = _clampThresholds(
        req.body.level1Min != null ? req.body.level1Min : cur.level1Min,
        req.body.level2Min != null ? req.body.level2Min : cur.level2Min);
      // Persist the latest Session Normal + thresholds so they survive sessions.
      ldb.saveWeatherConfig({ sessionNormal: sn, level1Min, level2Min });
      const rolled = rollWeather(sn, level1Min, level2Min);
      const entry = {
        id: weatherDateKey(date),
        frYear: date.frYear, frMonth: date.frMonth ?? null, frDay: date.frDay ?? null, frFestival: date.frFestival || '',
        dateLabel: String(dateLabel || ''),
        sessionNormal: sn,
        ...rolled,
      };
      const saved = ldb.saveWeatherEntry(entry);
      broadcast('calendar-updated', { type: 'weather' });
      res.json(saved);
    } catch (err) { console.error('POST /api/weather/roll:', err); res.status(500).json({ error: 'Server error' }); }
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
