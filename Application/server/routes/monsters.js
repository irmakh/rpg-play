export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth,
    processImageSizes, deleteUploadFile, readUploadAsBase64, extToMime,
    broadcast,
  } = ctx;

  app.get('/api/monsters', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let list;
      if (DB_PROVIDER === 'localdb') {
        list = ldb.listMonsters();
      } else {
        const result = await idb.query({ monsters: {} });
        list = (result.monsters || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
      res.json(list.map(r => {
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
        const assigned = DB_PROVIDER === 'localdb'
          ? ldb.listTableTokens().some(t => t.linkedId === req.params.id && t.assignedCharId === callerCharId)
          : (await idb.query({ tableTokens: { $: { where: { linkedId: req.params.id } } } }))
              .tableTokens?.some(t => t.assignedCharId === callerCharId);
        if (!assigned) return res.status(401).json({ error: 'Unauthorized' });
      }
      const r = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
      if (!r) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(r.dataJson || '{}'); } catch {}
      res.json({ id: r.id, name: r.name, cr: r.cr, data });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/monsters/:id/export', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const r = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
      if (!r) return res.status(404).json({ error: 'Not found' });
      let d = {}; try { d = JSON.parse(r.dataJson || '{}'); } catch {}
      const { portraitThumb, portraitMedium, ...dWithoutThumbs } = d;
      const monster = { ...r, dataJson: JSON.stringify(dWithoutThumbs), portraitB64: readUploadAsBase64(d.portrait) };
      res.json({ version: '1.0', type: 'monster', timestamp: new Date().toISOString(), dbProvider: DB_PROVIDER, monsters: [monster] });
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
        const crVal = (m.cr && typeof m.cr === 'object') ? m.cr.cr : (m.cr || '?');
        toInsert.push({ id: genId(), name: String(m.name).trim(), cr: String(crVal), dataJson: JSON.stringify(m), createdAt: new Date().toISOString() });
      }
      if (toInsert.length === 0) return res.status(400).json({ error: 'No valid monsters found' });
      if (DB_PROVIDER === 'localdb') {
        for (const m of toInsert) ldb.createMonster(m.id, m);
      } else {
        await idb.transact(toInsert.map(m => idb.tx.monsters[m.id].update(m)));
      }
      res.json({ ok: true, count: toInsert.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/monsters/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { name, cr, dataJson } = req.body || {};
      const update = {};
      if (name !== undefined)    update.name = String(name).trim();
      if (cr !== undefined)      update.cr = String(cr);
      if (dataJson !== undefined) update.dataJson = dataJson;
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      if (DB_PROVIDER === 'localdb') {
        ldb.updateMonster(req.params.id, update);
      } else {
        await idb.transact([idb.tx.monsters[req.params.id].update(update)]);
      }
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
      const r = DB_PROVIDER === 'localdb'
        ? ldb.getMonster(req.params.id)
        : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
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
      if (DB_PROVIDER === 'localdb') {
        ldb.updateMonster(req.params.id, { dataJson });
      } else {
        await idb.transact([idb.tx.monsters[req.params.id].update({ dataJson })]);
      }
      const newPortrait = data.portrait || null;
      const newPortraitThumb = data.portraitThumb || null;
      if (DB_PROVIDER === 'localdb') {
        const linked = ldb.getLinkedTokens(req.params.id).filter(t => t.type === 'monster' && !t.customPortrait);
        for (const tok of linked) {
          ldb.updateTableToken(tok.id, { portrait: newPortrait, portraitThumb: newPortraitThumb });
          broadcast('table', { action: 'token-updated', token: { ...tok, portrait: newPortrait, portraitThumb: newPortraitThumb } });
        }
      } else {
        const tokRes = await idb.query({ tableTokens: { $: { where: { linkedId: req.params.id } } } });
        const linked = (tokRes.tableTokens || []).filter(t => t.type === 'monster' && !t.customPortrait);
        if (linked.length) {
          await idb.transact(linked.map(t => idb.tx.tableTokens[t.id].update({ portrait: newPortrait, portraitThumb: newPortraitThumb })));
          for (const tok of linked) {
            broadcast('table', { action: 'token-updated', token: { ...tok, portrait: newPortrait, portraitThumb: newPortraitThumb } });
          }
        }
      }
      broadcast('monsters', { action: 'portrait-updated', id: req.params.id, portrait: newPortrait, portraitThumb: newPortraitThumb });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/monsters/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getMonster(req.params.id) : (await idb.query({ monsters: { $: { where: { id: req.params.id } } } })).monsters?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (DB_PROVIDER === 'localdb') {
        ldb.deleteMonster(req.params.id);
      } else {
        await idb.transact([idb.tx.monsters[req.params.id].delete()]);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
