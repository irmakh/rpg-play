// Pure row-shape helper, exported at module level by localdb.js (it closes over
// no database), used so an imported loot row lands in treasury_items with exactly
// the shape the original loot->treasury migration produced.
import { lootRowToTreasury } from '../../db/localdb.js';

function lootObjFromRecord(r) {
  return { id: r.id, name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt || '' };
}

export default function register(app, ctx) {
  const {
    ldb, genId,
    masterAuth, charAuth, getCharacter,
    broadcast,
  } = ctx;

  app.get('/api/loot', async (req, res) => {
    try {
      res.json(ldb.listLootItems().filter(r => r.visible).map(r => {
        const obj = lootObjFromRecord(r);
        if (!obj.descVisible) obj.description = '';
        return obj;
      }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/all', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      res.json(ldb.listLootItems()
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .map(lootObjFromRecord));
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
        newItems.push({
          id: genId(),
          fields: {
            name, description, visible: false, tag: tagStr,
            createdAt: new Date(Date.now() + count++).toISOString(),
          },
        });
      }
      if (newItems.length === 0) return res.status(400).json({ error: 'No valid items found' });

      // Imported rows go into treasury_items, NOT the retired loot_items table.
      // loot_items is only read by migrateTreasury(), which runs once and only
      // while treasury_items is still empty — so in any campaign that has ever
      // held treasury data, anything written to loot_items is stranded: absent
      // from the Treasury screen and from every backup (BACKUP_PARTS has no
      // 'loot'). lootRowToTreasury gives these rows exactly the shape the
      // original migration produced, so an import lands where the live UI reads.
      ldb.bulkCreateTreasuryItems(newItems.map(({ id, fields }) => ({
        id, fields: lootRowToTreasury(fields),
      })));
      broadcast('treasury', { action: 'imported' });
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
      ldb.createLootItem(newId, fields);
      broadcast('loot', { action: 'created', id: newId });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/loot/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = ldb.getLootItem(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const update = {};
      const { name, description, visible, tag, descVisible } = req.body || {};
      if (name !== undefined)        update.name = String(name).trim();
      if (description !== undefined) update.description = String(description);
      if (visible !== undefined)     update.visible = !!visible;
      if (descVisible !== undefined) update.descVisible = !!descVisible;
      if (tag !== undefined)         update.tag = String(tag).trim().slice(0,40);
      ldb.updateLootItem(req.params.id, update);
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
      ldb.bulkUpdateLootTag(ids, tagStr);
      broadcast('loot', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/loot/bulk-delete', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      ldb.bulkDeleteLootItems(ids);
      broadcast('loot', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/loot/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = ldb.getLootItem(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      ldb.deleteLootItem(req.params.id);
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
      for (const r of ldb.getLootItemsByIds(items.map(i => i.id))) lootDbMap[r.id] = r;

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

      ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
      for (const item of newItems) {
        ldb.updateLootItem(item.id, { visible: false });
        ldb.createLootLog(genId(), { charId, charName, itemName: item.name, claimedAt: now });
      }
      broadcast('characters', { action: 'updated', id: charId });
      broadcast('loot', { action: 'claimed' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/visibility', async (req, res) => {
    try {
      const items = ldb.listLootItems();
      const map = {};
      for (const r of items) map[r.id] = { descVisible: !!r.descVisible, description: r.description || '' };
      res.json(map);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/loot/logs', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      res.json(ldb.listLootLogs().map(r => ({ id: r.id, charName: r.charName, itemName: r.itemName, claimedAt: r.claimedAt })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
