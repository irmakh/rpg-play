export default function register(app, ctx) {
  const {
    ldb, genId,
    masterAuth,
    processImageSizes, deleteUploadFile, readUploadAsBase64, extToMime,
    broadcast,
  } = ctx;

  app.get('/api/monsters', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      res.json(ldb.listMonsters().map(r => {
        let data = {};
        try { data = JSON.parse(r.dataJson || '{}'); } catch {}
        return { id: r.id, name: r.name, cr: r.cr, data };
      }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/monsters/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) {
        const callerCharId = req.headers['x-character-id'];
        if (!callerCharId) return res.status(401).json({ error: 'Unauthorized' });
        const assigned = ldb.listTableTokens()
          .some(t => t.linkedId === req.params.id && t.assignedCharId === callerCharId);
        if (!assigned) return res.status(401).json({ error: 'Unauthorized' });
      }
      const r = ldb.getMonster(req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(r.dataJson || '{}'); } catch {}
      res.json({ id: r.id, name: r.name, cr: r.cr, data });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/monsters/:id/export', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const r = ldb.getMonster(req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found' });
      let d = {}; try { d = JSON.parse(r.dataJson || '{}'); } catch {}
      const { portraitThumb, portraitMedium, ...dWithoutThumbs } = d;
      const monster = { ...r, dataJson: JSON.stringify(dWithoutThumbs), portraitB64: readUploadAsBase64(d.portrait) };
      res.json({ version: '1.0', type: 'monster', timestamp: new Date().toISOString(), dbProvider: 'localdb', monsters: [monster] });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/monsters/import', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { monsters: list } = req.body || {};
      if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: 'monsters array required' });
      const toInsert = [];
      for (const m of list) {
        if (!m || !m.name) continue;

        // Two shapes arrive here:
        //  · a RAW stat block (a 5etools entry pasted or dropped in) — the whole
        //    object IS the stat block; and
        //  · a ROW exported by GET /api/monsters/:id/export, which WRAPS the stat
        //    block as {id, name, cr, dataJson, portraitB64, createdAt}.
        // Storing a wrapper as if it were a stat block used to produce a monster
        // with a name and CR but no actions, its real stat block stranded inside a
        // nested dataJson string. A `dataJson` string is what tells them apart —
        // no 5etools stat block has that key.
        const isExportedRow = typeof m.dataJson === 'string';
        let data = m;
        if (isExportedRow) {
          try { data = JSON.parse(m.dataJson || '{}'); } catch { data = {}; }
          if (!data.name) data.name = m.name;
        }

        const crSource = isExportedRow ? (m.cr ?? data.cr) : m.cr;
        const crVal = (crSource && typeof crSource === 'object') ? crSource.cr : (crSource || '?');

        const newId = genId();

        // Restore the portrait an export carried. It is written under the NEW id
        // rather than reusing the exported path, so the imported copy owns its own
        // file — deleting either monster then cannot take the other's portrait
        // with it. A portrait that fails to process must not fail the import.
        if (isExportedRow && m.portraitB64 && data.portrait) {
          try {
            const buf = Buffer.from(m.portraitB64, 'base64');
            const urls = await processImageSizes(extToMime(data.portrait), buf, 'monsters', newId);
            data.portrait = urls.original;
            data.portraitThumb = urls.thumb;
            data.portraitMedium = urls.medium;
          } catch {
            delete data.portrait; delete data.portraitThumb; delete data.portraitMedium;
          }
        }

        toInsert.push({
          id: newId,
          name: String(m.name).trim(),
          cr: String(crVal),
          dataJson: JSON.stringify(data),
          createdAt: new Date().toISOString(),
        });
      }
      if (toInsert.length === 0) return res.status(400).json({ error: 'No valid monsters found' });
      for (const m of toInsert) ldb.createMonster(m.id, m);
      res.json({ ok: true, count: toInsert.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/monsters/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = ldb.getMonster(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { name, cr, dataJson } = req.body || {};
      const update = {};
      if (name !== undefined)    update.name = String(name).trim();
      if (cr !== undefined)      update.cr = String(cr);
      if (dataJson !== undefined) update.dataJson = dataJson;
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      ldb.updateMonster(req.params.id, update);
      const broadcastName = update.name || existing.name;
      const broadcastCr = update.cr || existing.cr;
      const broadcastDataJson = update.dataJson || existing.dataJson;
      let broadcastData = {};
      try { broadcastData = JSON.parse(broadcastDataJson || '{}'); } catch {}
      broadcast('monsters', { action: 'updated', id: req.params.id, name: broadcastName, cr: broadcastCr, data: broadcastData });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/monsters/:id/portrait', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl } = req.body || {};
      if (typeof dataUrl !== 'string' || (dataUrl !== '' && !dataUrl.match(/^data:image\//)))
        return res.status(400).json({ error: 'Image data URL required' });
      const r = ldb.getMonster(req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(r.dataJson || '{}'); } catch {}
      if (dataUrl === '') {
        deleteUploadFile(data.portrait);
        deleteUploadFile(data.portraitThumb);
        deleteUploadFile(data.portraitMedium);
        delete data.portrait;
        delete data.portraitThumb;
        delete data.portraitMedium;
      } else {
        const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
        if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
        deleteUploadFile(data.portrait);
        deleteUploadFile(data.portraitThumb);
        deleteUploadFile(data.portraitMedium);
        const buffer = Buffer.from(mimeMatch[2], 'base64');
        const urls = await processImageSizes(mimeMatch[1], buffer, 'monsters', req.params.id);
        data.portrait = urls.original;
        data.portraitThumb = urls.thumb;
        data.portraitMedium = urls.medium;
      }
      const dataJson = JSON.stringify(data);
      ldb.updateMonster(req.params.id, { dataJson });
      const newPortrait = data.portrait || null;
      const newPortraitThumb = data.portraitThumb || null;
      const linked = ldb.getLinkedTokens(req.params.id).filter(t => t.type === 'monster' && !t.customPortrait);
      for (const tok of linked) {
        ldb.updateTableToken(tok.id, { portrait: newPortrait, portraitThumb: newPortraitThumb });
        broadcast('table', { action: 'token-updated', token: { ...tok, portrait: newPortrait, portraitThumb: newPortraitThumb } });
      }
      broadcast('monsters', { action: 'portrait-updated', id: req.params.id, portrait: newPortrait, portraitThumb: newPortraitThumb });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/monsters/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = ldb.getMonster(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      ldb.deleteMonster(req.params.id);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
