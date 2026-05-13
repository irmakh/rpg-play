function lootObjFromRecord(r) {
  return { id: r.id, name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt || '' };
}

export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth, charAuth, getCharacter,
    broadcast,
  } = ctx;

  app.get('/api/loot', async (req, res) => {
    try {
      let items;
      if (DB_PROVIDER === 'localdb') {
        items = ldb.listLootItems().filter(r => r.visible);
      } else {
        const result = await idb.query({ lootItems: {} });
        items = (result.lootItems || []).filter(r => r.visible).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      }
      res.json(items.map(r => {
        const obj = lootObjFromRecord(r);
        if (!obj.descVisible) obj.description = '';
        return obj;
      }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/all', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let items;
      if (DB_PROVIDER === 'localdb') {
        items = ldb.listLootItems().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      } else {
        const result = await idb.query({ lootItems: {} });
        items = (result.lootItems || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      }
      res.json(items.map(lootObjFromRecord));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot/import', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { text, tag = '' } = req.body || {};
      if (!text) return res.status(400).json({ error: 'Text required' });
      const tagStr = String(tag).trim().slice(0, 40);
      const blocks = String(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
      let count = 0;
      const newItems = [];
      for (const block of blocks) {
        const lines = block.split('\n');
        const name = lines[0].trim();
        if (!name) continue;
        const description = lines.slice(1).join('\n').trim();
        const newId = genId();
        const fields = { name, description, visible: false, tag: tagStr, createdAt: new Date(Date.now() + count++).toISOString() };
        newItems.push({ id: newId, fields });
      }
      if (newItems.length === 0) return res.status(400).json({ error: 'No valid items found' });
      if (DB_PROVIDER === 'localdb') {
        for (const { id, fields } of newItems) ldb.createLootItem(id, fields);
      } else {
        await idb.transact(newItems.map(({ id, fields }) => idb.tx.lootItems[id].update(fields)));
      }
      broadcast('loot', { action: 'imported' });
      res.json({ ok: true, count: newItems.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, description = '', visible = false, tag = '' } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
      const newId = genId();
      const fields = { name: String(name).trim(), description: String(description), visible: !!visible, tag: String(tag).trim().slice(0,40), createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createLootItem(newId, fields);
      } else {
        await idb.transact([idb.tx.lootItems[newId].update(fields)]);
      }
      broadcast('loot', { action: 'created', id: newId });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/loot/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getLootItem(req.params.id) : (await idb.query({ lootItems: { $: { where: { id: req.params.id } } } })).lootItems?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const update = {};
      const { name, description, visible, tag, descVisible } = req.body || {};
      if (name !== undefined)        update.name = String(name).trim();
      if (description !== undefined) update.description = String(description);
      if (visible !== undefined)     update.visible = !!visible;
      if (descVisible !== undefined) update.descVisible = !!descVisible;
      if (tag !== undefined)         update.tag = String(tag).trim().slice(0,40);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateLootItem(req.params.id, update);
      } else {
        await idb.transact([idb.tx.lootItems[req.params.id].update(update)]);
      }
      broadcast('loot', { action: 'updated', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot/bulk-update-tag', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids, tag } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      const tagStr = tag !== undefined ? String(tag).trim().slice(0, 40) : '';
      if (DB_PROVIDER === 'localdb') {
        ldb.bulkUpdateLootTag(ids, tagStr);
      } else {
        await idb.transact(ids.map(id => idb.tx.lootItems[id].update({ tag: tagStr })));
      }
      broadcast('loot', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot/bulk-delete', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      if (DB_PROVIDER === 'localdb') {
        ldb.bulkDeleteLootItems(ids);
      } else {
        await idb.transact(ids.map(id => idb.tx.lootItems[id].delete()));
      }
      broadcast('loot', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/loot/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getLootItem(req.params.id) : (await idb.query({ lootItems: { $: { where: { id: req.params.id } } } })).lootItems?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (DB_PROVIDER === 'localdb') {
        ldb.deleteLootItem(req.params.id);
      } else {
        await idb.transact([idb.tx.lootItems[req.params.id].delete()]);
      }
      broadcast('loot', { action: 'deleted', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot/claim', async (req, res) => {
    try {
      const { charId, items } = req.body || {};
      if (!charId || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: 'charId and items required' });
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      const charRecord = await getCharacter(charId);
      let charData = {};
      try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}
      let existingLoots = [];
      try { existingLoots = JSON.parse(charData._loots || '[]'); } catch {}
      const existingIds = new Set(existingLoots.map(l => l.id));

      const lootDbMap = {};
      if (DB_PROVIDER === 'localdb') {
        const lootRows = ldb.getLootItemsByIds(items.map(i => i.id));
        for (const r of lootRows) lootDbMap[r.id] = r;
      } else {
        const lootResult = await idb.query({ lootItems: { $: { where: { id: { in: items.map(i => i.id) } } } } });
        for (const r of lootResult.lootItems || []) lootDbMap[r.id] = r;
      }

      const newItems = [];
      for (const item of items) {
        if (!item.id || !item.name) continue;
        if (!existingIds.has(item.id)) {
          const dbItem = lootDbMap[item.id];
          const descVisible = dbItem ? !!dbItem.descVisible : false;
          const description = descVisible ? String(item.description || '') : '';
          existingLoots.push({ id: item.id, name: String(item.name), description, descVisible });
          existingIds.add(item.id);
          newItems.push(item);
        }
      }
      charData._loots = JSON.stringify(existingLoots);
      const charName = charData.name || charRecord.name || 'Unknown';
      const now = new Date().toISOString();

      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
        for (const item of newItems) {
          ldb.updateLootItem(item.id, { visible: false });
          ldb.createLootLog(genId(), { charId, charName, itemName: item.name, claimedAt: now });
        }
      } else {
        const txns = [idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name })];
        for (const item of newItems) {
          txns.push(idb.tx.lootItems[item.id].update({ visible: false }));
          txns.push(idb.tx.lootLogs[genId()].update({ charId, charName, itemName: item.name, claimedAt: now }));
        }
        await idb.transact(txns);
      }
      broadcast('characters', { action: 'updated', id: charId });
      broadcast('loot', { action: 'claimed' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/visibility', async (req, res) => {
    try {
      let items;
      if (DB_PROVIDER === 'localdb') {
        items = ldb.listLootItems();
      } else {
        const result = await idb.query({ lootItems: {} });
        items = result.lootItems || [];
      }
      const map = {};
      for (const r of items) map[r.id] = { descVisible: !!r.descVisible, description: r.description || '' };
      res.json(map);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/logs', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let logs;
      if (DB_PROVIDER === 'localdb') {
        logs = ldb.listLootLogs();
      } else {
        const result = await idb.query({ lootLogs: {} });
        logs = (result.lootLogs || []).sort((a, b) => (b.claimedAt || '').localeCompare(a.claimedAt || '')).slice(0, 500);
      }
      res.json(logs.map(r => ({ id: r.id, charName: r.charName, itemName: r.itemName, claimedAt: r.claimedAt })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
