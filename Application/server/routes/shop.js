export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth, charAuth, getCharacter,
    getShopConfig, shopObjFromRecord, deductCurrency, cpToGpString,
    SHOP_CONFIG_ID, broadcast,
  } = ctx;

  app.get('/api/shop', async (req, res) => {
    try {
      const cfg = await getShopConfig();
      if (!cfg.isOpen) return res.json({ isOpen: false, items: [] });
      let items;
      if (DB_PROVIDER === 'localdb') {
        items = ldb.listShopItems().filter(r => r.quantity !== 0);
      } else {
        const result = await idb.query({ shopItems: {} });
        items = (result.shopItems || []).filter(r => r.quantity !== 0);
      }
      if (cfg.activeTag) items = items.filter(r => (r.tag || '') === cfg.activeTag);
      items.sort((a, b) => (a.itemType || '').localeCompare(b.itemType || '') || (a.name || '').localeCompare(b.name || ''));
      res.json({ isOpen: true, activeTag: cfg.activeTag, items: items.map(shopObjFromRecord) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/shop/status', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const cfg = await getShopConfig();
      res.json({ isOpen: cfg.isOpen, activeTag: cfg.activeTag });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/shop/status', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const isOpen = !!(req.body?.isOpen);
      const activeTag = isOpen ? String(req.body?.activeTag || '').trim().slice(0, 40) : '';
      if (DB_PROVIDER === 'localdb') {
        ldb.setShopConfig(isOpen, activeTag);
      } else {
        await idb.transact([idb.tx.shopConfig[SHOP_CONFIG_ID].update({ isOpen, activeTag })]);
      }
      broadcast('shop', { action: 'statusChanged', isOpen, activeTag });
      res.json({ ok: true, isOpen, activeTag });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/shop/all', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let items;
      if (DB_PROVIDER === 'localdb') {
        items = ldb.listShopItems().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      } else {
        const result = await idb.query({ shopItems: {} });
        items = (result.shopItems || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      }
      res.json(items.map(shopObjFromRecord));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/shop', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const {
        name, itemType = 'wondrous', armorType = 'light', acBase = 10,
        valueCp = 0, quantity = 1, acBonus = 0, initBonus = 0, speedBonus = 0,
        spellAtkBonus = 0, spellDcBonus = 0,
        requiresAttunement = false, notes = '', weaponAtk = '', weaponDmg = '', weaponProperties = [], tag = ''
      } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
      const newId = genId();
      const fields = {
        name: String(name).trim(), itemType, armorType,
        acBase: +acBase, valueCp: +valueCp, quantity: +quantity,
        acBonus: +acBonus, initBonus: +initBonus, speedBonus: +speedBonus,
        spellAtkBonus: +spellAtkBonus, spellDcBonus: +spellDcBonus,
        requiresAttunement: !!requiresAttunement, notes: String(notes),
        weaponAtk: String(weaponAtk), weaponDmg: String(weaponDmg),
        weaponPropertiesJson: JSON.stringify(Array.isArray(weaponProperties) ? weaponProperties.slice(0, 3) : []),
        tag: String(tag).trim().slice(0, 40),
        createdAt: new Date().toISOString()
      };
      if (DB_PROVIDER === 'localdb') {
        ldb.createShopItem(newId, fields);
      } else {
        await idb.transact([idb.tx.shopItems[newId].update(fields)]);
      }
      broadcast('shop', { action: 'created', id: newId });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/shop/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getShopItem(req.params.id) : (await idb.query({ shopItems: { $: { where: { id: req.params.id } } } })).shopItems?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { name, itemType, armorType, acBase, valueCp, quantity, acBonus, initBonus, speedBonus, spellAtkBonus, spellDcBonus, requiresAttunement, notes, weaponAtk, weaponDmg, weaponProperties, tag } = req.body || {};
      const update = {};
      if (name !== undefined)               update.name = String(name).trim();
      if (itemType !== undefined)           update.itemType = itemType;
      if (armorType !== undefined)          update.armorType = armorType;
      if (acBase !== undefined)             update.acBase = +acBase;
      if (valueCp !== undefined)            update.valueCp = +valueCp;
      if (quantity !== undefined)           update.quantity = +quantity;
      if (acBonus !== undefined)            update.acBonus = +acBonus;
      if (initBonus !== undefined)          update.initBonus = +initBonus;
      if (speedBonus !== undefined)         update.speedBonus = +speedBonus;
      if (spellAtkBonus !== undefined)      update.spellAtkBonus = +spellAtkBonus;
      if (spellDcBonus !== undefined)       update.spellDcBonus = +spellDcBonus;
      if (requiresAttunement !== undefined) update.requiresAttunement = !!requiresAttunement;
      if (notes !== undefined)              update.notes = String(notes);
      if (weaponAtk !== undefined)          update.weaponAtk = String(weaponAtk);
      if (weaponDmg !== undefined)          update.weaponDmg = String(weaponDmg);
      if (weaponProperties !== undefined)   update.weaponPropertiesJson = JSON.stringify(Array.isArray(weaponProperties) ? weaponProperties.slice(0, 3) : []);
      if (tag !== undefined)                update.tag = String(tag).trim().slice(0, 40);
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      if (DB_PROVIDER === 'localdb') {
        ldb.updateShopItem(req.params.id, update);
      } else {
        await idb.transact([idb.tx.shopItems[req.params.id].update(update)]);
      }
      broadcast('shop', { action: 'updated', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/shop/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = DB_PROVIDER === 'localdb' ? ldb.getShopItem(req.params.id) : (await idb.query({ shopItems: { $: { where: { id: req.params.id } } } })).shopItems?.[0];
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (DB_PROVIDER === 'localdb') {
        ldb.deleteShopItem(req.params.id);
      } else {
        await idb.transact([idb.tx.shopItems[req.params.id].delete()]);
      }
      broadcast('shop', { action: 'deleted', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/shop/bulk-update-tag', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { ids, tag } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
      const tagStr = tag !== undefined ? String(tag).trim().slice(0, 40) : '';
      if (DB_PROVIDER === 'localdb') {
        ldb.bulkUpdateShopTag(ids, tagStr);
      } else {
        for (const id of ids) await idb.transact([idb.tx.shopItems[id].update({ tag: tagStr })]);
      }
      broadcast('shop', { action: 'bulk-updated' });
      res.json({ ok: true, count: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/shop/purchase', async (req, res) => {
    try {
      const { charId, items: cart } = req.body || {};
      if (!charId || !Array.isArray(cart) || cart.length === 0)
        return res.status(400).json({ error: 'charId and items[] required' });

      const authStatus = await charAuth(charId, req);
      if (authStatus !== 200) return res.status(authStatus).json({ error: authStatus === 404 ? 'Character not found' : 'Unauthorized' });

      const charRecord = await getCharacter(charId);
      if (!charRecord) return res.status(404).json({ error: 'Character not found' });
      let charData = {};
      try { charData = JSON.parse(charRecord.dataJson || '{}'); } catch {}

      let totalCp = 0;
      const resolvedItems = [];
      for (const { shopItemId, qty = 1 } of cart) {
        const shopItem = DB_PROVIDER === 'localdb' ? ldb.getShopItem(shopItemId) : (await idb.query({ shopItems: { $: { where: { id: shopItemId } } } })).shopItems?.[0];
        if (!shopItem) return res.status(400).json({ error: `Shop item ${shopItemId} not found` });
        if (shopItem.quantity !== -1 && shopItem.quantity < qty) return res.status(400).json({ error: `Not enough stock for "${shopItem.name}"` });
        totalCp += (shopItem.valueCp ?? 0) * qty;
        resolvedItems.push({ shopItem, qty });
      }

      const cp = parseInt(charData.cp)  || 0;
      const sp = parseInt(charData.sp)  || 0;
      const ep = parseInt(charData.ep)  || 0;
      const gp = parseInt(charData.gp)  || 0;
      const pp = parseInt(charData.pp2) || 0;
      if (cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000 < totalCp)
        return res.status(400).json({ error: 'Insufficient funds' });

      const newCurrency = deductCurrency({ cp, sp, ep, gp, pp }, totalCp);

      let items = []; try { items = JSON.parse(charData._items || '[]'); } catch {}
      let idCounter = parseInt(charData._itemIdCounter) || (items.length ? Math.max(...items.map(i => i.id)) : 0);
      let weapons = []; try { weapons = JSON.parse(charData._weapons || '[]'); } catch {}

      for (const { shopItem, qty } of resolvedItems) {
        let props = []; try { props = JSON.parse(shopItem.weaponPropertiesJson || '[]'); } catch {}
        for (let i = 0; i < qty; i++) {
          if (shopItem.itemType === 'weapon') {
            const strMod = Math.floor(((parseInt(charData.str) || 10) - 10) / 2);
            const dexMod = Math.floor(((parseInt(charData.dex) || 10) - 10) / 2);
            const level = parseInt(charData.level) || 1;
            const profBonus = Math.floor((level - 1) / 4) + 2;
            const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod) : props.includes('Ammunition') ? dexMod : strMod;
            const magicBonus = parseInt(shopItem.weaponAtk) || 0;
            const totalAtk = profBonus + abilityMod + magicBonus;
            const atkStr = (totalAtk >= 0 ? '+' : '') + totalAtk;
            const dmgRaw = (shopItem.weaponDmg || '1d4').trim();
            const spaceIdx = dmgRaw.indexOf(' ');
            const dicePart = spaceIdx === -1 ? dmgRaw : dmgRaw.slice(0, spaceIdx);
            const typePart = spaceIdx === -1 ? '' : dmgRaw.slice(spaceIdx + 1).trim();
            const dmgBonus = abilityMod + magicBonus;
            const dmgStr = dmgBonus > 0 ? `${dicePart}+${dmgBonus}${typePart ? ' '+typePart : ''}` : dmgBonus < 0 ? `${dicePart}${dmgBonus}${typePart ? ' '+typePart : ''}` : dmgRaw;
            const propsStr = props.length ? props.join(', ') : '';
            const notesStr = [shopItem.notes, propsStr].filter(Boolean).join(' — ');
            weapons.push([shopItem.name, atkStr, dmgStr, notesStr]);
            const rawAtk = magicBonus !== 0 ? (magicBonus > 0 ? '+' : '') + magicBonus : '';
            items.push({ id: ++idCounter, name: shopItem.name, itemType: 'weapon', weaponAtk: rawAtk, weaponDmg: shopItem.weaponDmg || '', armorType: 'light', acBase: 10, value: cpToGpString(shopItem.valueCp ?? 0), equipped: false, requiresAttunement: !!shopItem.requiresAttunement, attuned: false, acBonus: shopItem.acBonus ?? 0, initBonus: shopItem.initBonus ?? 0, speedBonus: shopItem.speedBonus ?? 0, notes: notesStr });
          } else {
            items.push({ id: ++idCounter, name: shopItem.name, itemType: shopItem.itemType, armorType: shopItem.armorType, acBase: shopItem.acBase ?? 10, value: cpToGpString(shopItem.valueCp ?? 0), equipped: false, requiresAttunement: !!shopItem.requiresAttunement, attuned: false, acBonus: shopItem.acBonus ?? 0, initBonus: shopItem.initBonus ?? 0, speedBonus: shopItem.speedBonus ?? 0, notes: shopItem.notes || '' });
          }
        }
      }

      charData._items = JSON.stringify(items);
      charData._weapons = JSON.stringify(weapons);
      charData._itemIdCounter = idCounter;
      charData.cp  = String(newCurrency.cp);
      charData.sp  = String(newCurrency.sp);
      charData.ep  = String(newCurrency.ep);
      charData.gp  = String(newCurrency.gp);
      charData.pp2 = String(newCurrency.pp);

      const charName = charData.name || 'Unknown';
      if (DB_PROVIDER === 'localdb') {
        for (const { shopItem, qty } of resolvedItems) {
          if (shopItem.quantity !== -1) ldb.updateShopItem(shopItem.id, { quantity: shopItem.quantity - qty });
          ldb.createPurchaseLog(genId(), { charId, charName, itemName: shopItem.name, qty, totalCp: (shopItem.valueCp ?? 0) * qty, purchasedAt: new Date().toISOString() });
        }
        ldb.updateCharacter(charId, { dataJson: JSON.stringify(charData), name: charRecord.name });
      } else {
        const txns = [];
        for (const { shopItem, qty } of resolvedItems) {
          if (shopItem.quantity !== -1) txns.push(idb.tx.shopItems[shopItem.id].update({ quantity: shopItem.quantity - qty }));
          txns.push(idb.tx.purchaseLogs[genId()].update({ charId, charName, itemName: shopItem.name, qty, totalCp: (shopItem.valueCp ?? 0) * qty, purchasedAt: new Date().toISOString() }));
        }
        txns.push(idb.tx.characters[charId].update({ dataJson: JSON.stringify(charData), name: charRecord.name }));
        await idb.transact(txns);
      }

      broadcast('shop', { action: 'purchase' });
      broadcast('characters', { action: 'updated', id: charId });
      res.json({ ok: true, newCurrency });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Transaction failed' }); }
  });

  app.get('/api/shop/logs', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let logs;
      if (DB_PROVIDER === 'localdb') {
        logs = ldb.listPurchaseLogs();
      } else {
        const result = await idb.query({ purchaseLogs: {} });
        logs = (result.purchaseLogs || []).sort((a, b) => (b.purchasedAt || '').localeCompare(a.purchasedAt || '')).slice(0, 500);
      }
      res.json(logs.map(r => ({ id: r.id, charId: r.charId, charName: r.charName, itemName: r.itemName, qty: r.qty, totalCp: r.totalCp, purchasedAt: r.purchasedAt })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
