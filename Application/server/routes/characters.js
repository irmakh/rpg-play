export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth, charAuth, getCharacter,
    hashPassword, verifyPassword, isMasterPassword,
    processImageSizes, saveUploadFile, deleteUploadFile,
    IMAGE_MIME, ALLOWED_MIME, MAX_MEDIA_BYTES,
    broadcast, path,
  } = ctx;

  app.get('/api/characters', async (req, res) => {
    try {
      let chars;
      if (DB_PROVIDER === 'localdb') {
        chars = ldb.listCharacters();
      } else {
        const result = await idb.query({ characters: {} });
        chars = result.characters || [];
      }
      res.json(chars
        .map(c => ({ id: c.id, name: c.name || 'Unnamed', has_password: !!c.passwordHash, char_type: c.charType || 'pc' }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/characters/:id/qroll', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      const SKILL_KEYS  = Array.from({ length: 18 }, (_, i) => `sk-${i}`);
      const SAVE_KEYS   = ['save-str','save-dex','save-con','save-int','save-wis','save-cha'];
      const ABILITY_KEYS = ['str','dex','con','int','wis','cha'];
      const STAT_KEYS   = ['init','init-bonus','sp-atk','ac','prof-bonus','pb','proficiency','passive-perception','pp','sp-dc'];
      const META_KEYS   = ['race','race-name','class','class-name','class-1','subclass','subclass-1','level','total-level','char-level'];
      const SLOT_KEYS   = Array.from({ length: 9 }, (_, i) => [`slot-${i+1}-total`,`slot-${i+1}-used`]).flat();
      const qroll = {};
      for (const k of [...SKILL_KEYS, ...SAVE_KEYS, ...ABILITY_KEYS, ...STAT_KEYS, ...META_KEYS, ...SLOT_KEYS]) {
        if (data[k] !== undefined) qroll[k] = data[k];
      }
      if (data['_weapons'] !== undefined) qroll['_weapons'] = data['_weapons'];
      if (data['_spells']  !== undefined) qroll['_spells']  = data['_spells'];
      if (data['_actions'] !== undefined) qroll['_actions'] = data['_actions'];
      if (data['_items']   !== undefined) qroll['_items']   = data['_items'];
      res.json({ id: char.id, name: char.name, data: qroll });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.patch('/api/characters/:id/spell-slot', async (req, res) => {
    try {
      const charId = req.params.id;
      if (!masterAuth(req)) {
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      }
      const { level, used } = req.body || {};
      if (!level || used === undefined) return res.status(400).json({ error: 'level and used required' });
      const char = await getCharacter(charId);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      data[`slot-${level}-used`] = Math.max(0, Math.min(parseInt(used) || 0, parseInt(data[`slot-${level}-total`]) || 0));
      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson });
      } else {
        await idb.transact([idb.tx.characters[charId].update({ dataJson })]);
      }
      broadcast('characters', { action: 'updated', id: charId });
      res.json({ ok: true, used: data[`slot-${level}-used`] });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Update the spent-uses count of a single custom action (Actions tab limited use).
  app.patch('/api/characters/:id/action-use', async (req, res) => {
    try {
      const charId = req.params.id;
      if (!masterAuth(req)) {
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      }
      const { actionId, used } = req.body || {};
      if (actionId === undefined || used === undefined) return res.status(400).json({ error: 'actionId and used required' });
      const char = await getCharacter(charId);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      let acts = [];
      try { acts = JSON.parse(data._actions || '[]'); } catch {}
      const a = acts.find(x => x && x.id === actionId);
      if (!a) return res.status(404).json({ error: 'Action not found' });
      const max = parseInt(a.uses) || 0;
      a.used = Math.max(0, Math.min(parseInt(used) || 0, max));
      data._actions = JSON.stringify(acts);
      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson });
      } else {
        await idb.transact([idb.tx.characters[charId].update({ dataJson })]);
      }
      broadcast('characters', { action: 'updated', id: charId });
      res.json({ ok: true, used: a.used });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Reset spent uses on a rest. type 'short' restores short-recharge actions;
  // 'long' restores both long- and short-recharge actions.
  app.post('/api/characters/:id/action-rest', async (req, res) => {
    try {
      const charId = req.params.id;
      if (!masterAuth(req)) {
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      }
      const type = (req.body && req.body.type) === 'long' ? 'long' : 'short';
      const char = await getCharacter(charId);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      let acts = [];
      try { acts = JSON.parse(data._actions || '[]'); } catch {}
      acts.forEach(a => {
        if (a && (a.recharge === 'short' || (type === 'long' && a.recharge === 'long'))) a.used = 0;
      });
      data._actions = JSON.stringify(acts);
      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson });
      } else {
        await idb.transact([idb.tx.characters[charId].update({ dataJson })]);
      }
      broadcast('characters', { action: 'updated', id: charId });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Recompute the stats that depend on equipped items — mirrors recalcAll() in
  // public/js/index/index-calc.js so wear/unwear from the table matches the sheet.
  const _SP_ABIL = { strength:'str', str:'str', dexterity:'dex', dex:'dex', constitution:'con', con:'con',
    intelligence:'int', int:'int', wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha' };
  function _abilMod(score) { return Math.floor(((parseInt(score) || 10) - 10) / 2); }
  function _signed(n) { return (n >= 0 ? '+' : '') + n; }
  function recalcDerived(data) {
    let items = [];
    try { items = JSON.parse(data._items || '[]'); } catch {}
    const equipped = items.filter(i => i && i.equipped);
    const dexMod = _abilMod(data.dex);
    const prof = parseInt(data.profbonus) || 0;

    // Initiative = DEX mod + equipped item init bonuses
    const initItem = equipped.reduce((s, i) => s + (parseInt(i.initBonus) || 0), 0);
    data.init = _signed(dexMod + initItem);

    // Speed = base + equipped item speed bonuses + manual bonus
    const spdItem = equipped.reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
    const spdManual = parseInt(data['speed-bonus']) || 0;
    const spdBase = (data['speed-base'] !== undefined && data['speed-base'] !== '')
      ? (parseInt(String(data['speed-base']).replace(/[^0-9]/g, '')) || 30)
      : (parseInt(String(data.speed || '30').replace(/[^0-9]/g, '')) || 30);
    data.speed = (spdBase + spdItem + spdManual) + ' ft';

    // AC = equipped armor (by type) + DEX mod + flat item bonuses + manual bonus
    const armor = equipped.find(i => i.itemType === 'armor');
    let baseAC;
    if (!armor) baseAC = 10 + dexMod;
    else if (armor.armorType === 'heavy') baseAC = (parseInt(armor.acBase) || 10);
    else if (armor.armorType === 'medium') baseAC = (parseInt(armor.acBase) || 10) + Math.min(2, dexMod);
    else baseAC = (parseInt(armor.acBase) || 10) + dexMod;
    const flatBonus = equipped.reduce((s, i) => s + (parseInt(i.acBonus) || 0), 0);
    const manualAcBonus = parseInt(data['ac-bonus']) || 0;
    data.ac = baseAC + flatBonus + manualAcBonus;

    // Spellcasting DC / attack / modifier (+ equipped item bonuses)
    const spKey = _SP_ABIL[String(data['sp-ability'] || '').toLowerCase().trim()];
    if (spKey) {
      const spMod = _abilMod(data[spKey]);
      const spAtkItem = equipped.reduce((s, i) => s + (parseInt(i.spellAtkBonus) || 0), 0);
      const spDcItem  = equipped.reduce((s, i) => s + (parseInt(i.spellDcBonus)  || 0), 0);
      data['sp-dc']  = 8 + prof + spMod + spDcItem;
      data['sp-atk'] = _signed(prof + spMod + spAtkItem);
      data['sp-mod'] = _signed(spMod);
    }
    return data;
  }

  // Wear / unwear an inventory item from the table side panel.
  app.patch('/api/characters/:id/equip', async (req, res) => {
    try {
      const charId = req.params.id;
      if (!masterAuth(req)) {
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      }
      const { itemId, equipped } = req.body || {};
      if (itemId === undefined) return res.status(400).json({ error: 'itemId required' });
      const char = await getCharacter(charId);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      let items = [];
      try { items = JSON.parse(data._items || '[]'); } catch {}
      const it = items.find(x => x && x.id === itemId);
      if (!it) return res.status(404).json({ error: 'Item not found' });
      it.equipped = (equipped === undefined) ? !it.equipped : !!equipped;
      data._items = JSON.stringify(items);
      recalcDerived(data);
      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(charId, { dataJson });
      } else {
        await idb.transact([idb.tx.characters[charId].update({ dataJson })]);
      }
      broadcast('characters', { action: 'updated', id: charId });

      // Sync the recomputed AC / speed to any linked table tokens.
      try {
        const linkedTokens = DB_PROVIDER === 'localdb'
          ? ldb.getLinkedTokens(charId)
          : (await idb.query({ tableTokens: { $: { where: { linkedId: charId } } } })).tableTokens || [];
        if (linkedTokens.length > 0) {
          const updFields = {};
          const acN = parseInt(data.ac); if (!isNaN(acN)) updFields.ac = acN;
          const spN = parseInt(String(data.speed).replace(/[^0-9]/g, '')); if (!isNaN(spN)) updFields.speed = spN;
          if (Object.keys(updFields).length) {
            if (DB_PROVIDER === 'localdb') {
              for (const t of linkedTokens) { ldb.updateTableToken(t.id, updFields); broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } }); }
            } else {
              await idb.transact(linkedTokens.map(t => idb.tx.tableTokens[t.id].update(updFields)));
              for (const t of linkedTokens) broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } });
            }
          }
        }
      } catch (syncErr) { console.error('equip token sync:', syncErr); }

      res.json({ ok: true, equipped: it.equipped, ac: data.ac, speed: data.speed, init: data.init });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/characters/:id/roll', async (req, res) => {
    try {
      const { label, type, detail, total, isCrit, isFail, isDamage, time } = req.body || {};
      if (total === undefined) return res.status(400).json({ error: 'total required' });
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      let hist = [];
      try { hist = JSON.parse(data._rollHistory || '[]'); } catch {}
      hist.unshift({ label: label || '', type: type || 'norm', detail: detail || '', total, isCrit: !!isCrit, isFail: !!isFail, isDamage: !!isDamage, time: time || new Date().toISOString() });
      if (hist.length > 100) hist.pop();
      data._rollHistory = JSON.stringify(hist);
      const dataJson = JSON.stringify(data);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(req.params.id, { dataJson });
      } else {
        await idb.transact([idb.tx.characters[req.params.id].update({ dataJson })]);
      }
      broadcast('characters', { action: 'updated', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/characters/:id', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ locked: true });
      }
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      res.json({ id: char.id, name: char.name, data });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/characters', async (req, res) => {
    try {
      const { name, char_type, password } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
      const type = char_type === 'npc' ? 'npc' : 'pc';
      const hash = password ? hashPassword(password) : '';
      const newId = genId();
      const fields = { name: name.trim(), dataJson: '{}', charType: type, passwordHash: hash, createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createCharacter(newId, fields);
      } else {
        await idb.transact([idb.tx.characters[newId].update(fields)]);
      }
      broadcast('characters', { action: 'created', id: newId });
      res.json({ id: newId, name: name.trim(), char_type: type, has_password: !!password });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/characters/:id', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ error: 'Wrong password' });
      }
      const { data } = req.body;
      if (!data) return res.status(400).json({ error: 'Data required' });
      const name = (data.name || '').trim() || 'Unnamed';
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(req.params.id, { name, dataJson: JSON.stringify(data) });
      } else {
        await idb.transact([idb.tx.characters[req.params.id].update({ name, dataJson: JSON.stringify(data) })]);
      }
      broadcast('characters', { action: 'updated', id: req.params.id });

      try {
        const linkedTokens = DB_PROVIDER === 'localdb'
          ? ldb.getLinkedTokens(req.params.id)
          : (await idb.query({ tableTokens: { $: { where: { linkedId: req.params.id } } } })).tableTokens || [];
        if (linkedTokens.length > 0) {
          const newHpMax = parseInt(data.hpmax) || 0;
          const newHpCur = Math.min(parseInt(data.hpcur) || 0, newHpMax);
          let newSpeed;
          if (data['speed-base'] !== undefined) {
            let charItems = [];
            try { charItems = JSON.parse(data['_items'] || '[]'); } catch {}
            const itemSpeedBonus = charItems.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
            newSpeed = (parseInt(String(data['speed-base']).replace(/[^0-9]/g, '')) || 30) + itemSpeedBonus;
          } else {
            newSpeed = parseInt(String(data.speed || '30').replace(/[^0-9]/g, '')) || 30;
          }
          const newHpTemp = Math.max(0, parseInt(data.hptemp) || 0);
          // data.ac holds the computed total (base + items + bonus). Sync it to the
          // token so the table HP panel / initiative tracker reflect AC live over SSE.
          const newAc = data.ac != null && data.ac !== '' ? (parseInt(data.ac) || null) : null;
          const updFields = { hpCurrent: newHpCur, hpMax: newHpMax, hpTemp: newHpTemp, speed: newSpeed };
          if (newAc != null) updFields.ac = newAc;
          if (DB_PROVIDER === 'localdb') {
            for (const t of linkedTokens) {
              ldb.updateTableToken(t.id, updFields);
              broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } });
            }
          } else {
            await idb.transact(linkedTokens.map(t => idb.tx.tableTokens[t.id].update(updFields)));
            for (const t of linkedTokens) broadcast('table', { action: 'token-updated', token: { ...t, ...updFields } });
          }
        }
      } catch (syncErr) { console.error('token sync:', syncErr); }

      res.json({ ok: true, name });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/characters/:id/password', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      const { current_password, new_password } = req.body;
      if (char.passwordHash) {
        if (!current_password || (!verifyPassword(current_password, char.passwordHash) && !isMasterPassword(current_password)))
          return res.status(401).json({ error: 'Wrong current password' });
      }
      const newHash = new_password ? hashPassword(new_password) : '';
      if (DB_PROVIDER === 'localdb') {
        ldb.updateCharacter(req.params.id, { passwordHash: newHash });
      } else {
        await idb.transact([idb.tx.characters[req.params.id].update({ passwordHash: newHash })]);
      }
      res.json({ ok: true, has_password: !!new_password });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/characters/:id', async (req, res) => {
    try {
      const char = await getCharacter(req.params.id);
      if (!char) return res.status(404).json({ error: 'Not found' });
      if (char.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw)))
          return res.status(401).json({ error: 'Wrong password' });
      }
      if (DB_PROVIDER === 'localdb') {
        ldb.deleteCharacter(req.params.id);
      } else {
        await idb.transact([idb.tx.characters[req.params.id].delete()]);
      }
      broadcast('characters', { action: 'deleted', id: req.params.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Media ──────────────────────────────────────────────────────────────────
  app.get('/api/characters/:id/media', async (req, res) => {
    try {
      const charId = req.params.id;
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      let mediaRows;
      if (DB_PROVIDER === 'localdb') {
        mediaRows = ldb.listMedia(charId);
      } else {
        const result = await idb.query({ media: { $: { where: { charId } } } });
        mediaRows = (result.media || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      }
      res.json(mediaRows.map(r => ({ id: r.id, name: r.originalName, mimeType: r.mimeType, dataUrl: r.dataUrl, thumbUrl: r.thumbUrl || '', mediumUrl: r.mediumUrl || '', isPortrait: !!r.isPortrait, createdAt: r.createdAt })));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/characters/:id/media', async (req, res) => {
    try {
      const charId = req.params.id;
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });

      const { dataUrl, originalName, isPortrait } = req.body || {};
      if (typeof dataUrl !== 'string' || typeof originalName !== 'string')
        return res.status(400).json({ error: 'dataUrl and originalName required' });

      const mimeMatch = dataUrl.match(/^data:([a-zA-Z0-9][a-zA-Z0-9!\-#$&^_.+]+\/[a-zA-Z0-9][a-zA-Z0-9!\-#$&^_.+]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
      const mimeType = mimeMatch[1].toLowerCase();
      if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'File type not allowed' });
      if (Math.ceil(mimeMatch[2].length * 0.75) > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'File too large (max 25 MB)' });
      if (isPortrait && !mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });

      const safeName = path.basename(originalName).replace(/[^\w.\-]/g, '_').slice(0, 200) || 'file';
      const newId = genId();

      let fileUrl, thumbUrl = '', mediumUrl = '';
      if (IMAGE_MIME.has(mimeType)) {
        const buffer = Buffer.from(mimeMatch[2], 'base64');
        const urls = await processImageSizes(mimeType, buffer, 'characters', newId);
        fileUrl = urls.original; thumbUrl = urls.thumb; mediumUrl = urls.medium;
      } else {
        fileUrl = saveUploadFile('characters', newId, mimeType, mimeMatch[2]);
      }

      if (DB_PROVIDER === 'localdb') {
        if (isPortrait) {
          const oldRows = ldb.listMedia(charId);
          const oldPortrait = oldRows.find(r => r.isPortrait);
          if (oldPortrait) {
            deleteUploadFile(oldPortrait.dataUrl);
            deleteUploadFile(oldPortrait.thumbUrl);
            deleteUploadFile(oldPortrait.mediumUrl);
          }
          ldb.setPortrait(charId, '');
        }
        ldb.createMedia(newId, { charId, originalName: safeName, mimeType, dataUrl: fileUrl, thumbUrl, mediumUrl, isPortrait: !!isPortrait, createdAt: new Date().toISOString() });
        if (isPortrait) ldb.setPortrait(charId, newId);
      } else {
        const txns = [];
        if (isPortrait) {
          const existing = await idb.query({ media: { $: { where: { charId } } } });
          for (const m of existing.media || []) if (m.isPortrait) txns.push(idb.tx.media[m.id].update({ isPortrait: false }));
        }
        txns.push(idb.tx.media[newId].update({ charId, originalName: safeName, mimeType, dataUrl: fileUrl, thumbUrl, mediumUrl, isPortrait: !!isPortrait, createdAt: new Date().toISOString() }));
        await idb.transact(txns);
      }
      res.json({ id: newId, name: safeName, mimeType, isPortrait: !!isPortrait, thumbUrl, mediumUrl });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/characters/:id/portrait', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let portrait = null, portraitThumb = null;
      if (DB_PROVIDER === 'localdb') {
        const rows = ldb.listMedia(req.params.id);
        const p = rows.find(r => r.isPortrait);
        if (p) { portrait = p.dataUrl; portraitThumb = p.thumbUrl || null; }
      } else {
        const result = await idb.query({ media: { $: { where: { charId: req.params.id, isPortrait: true } } } });
        if (result.media?.[0]) { portrait = result.media[0].dataUrl; portraitThumb = result.media[0].thumbUrl || null; }
      }
      res.json({ portrait, portraitThumb });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/characters/:id/media/:mid/portrait', async (req, res) => {
    try {
      const charId = req.params.id;
      const mediaId = req.params.mid;
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });

      if (DB_PROVIDER === 'localdb') {
        const target = ldb.getMediaById(mediaId);
        if (!target || target.charId !== charId) return res.status(404).json({ error: 'Media not found' });
        if (!target.mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });
        ldb.setPortrait(charId, mediaId);
      } else {
        const result = await idb.query({ media: { $: { where: { charId } } } });
        const allMedia = result.media || [];
        const target = allMedia.find(m => m.id === mediaId);
        if (!target) return res.status(404).json({ error: 'Media not found' });
        if (!target.mimeType.startsWith('image/')) return res.status(400).json({ error: 'Portrait must be an image' });
        const txns = allMedia.filter(m => m.isPortrait).map(m => idb.tx.media[m.id].update({ isPortrait: false }));
        txns.push(idb.tx.media[mediaId].update({ isPortrait: true }));
        await idb.transact(txns);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/characters/:id/media/:mid', async (req, res) => {
    try {
      const charId = req.params.id;
      const mediaId = req.params.mid;
      const status = await charAuth(charId, req);
      if (status !== 200) return res.status(status).json({ error: status === 404 ? 'Not found' : 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') {
        const m = ldb.getMediaById(mediaId);
        if (!m || m.charId !== charId) return res.status(404).json({ error: 'Media not found' });
        deleteUploadFile(m.dataUrl);
        deleteUploadFile(m.thumbUrl);
        deleteUploadFile(m.mediumUrl);
        ldb.deleteMedia(mediaId);
      } else {
        const result = await idb.query({ media: { $: { where: { charId } } } });
        const m = result.media?.find(m => m.id === mediaId);
        if (!m) return res.status(404).json({ error: 'Media not found' });
        deleteUploadFile(m.dataUrl);
        deleteUploadFile(m.thumbUrl);
        deleteUploadFile(m.mediumUrl);
        await idb.transact([idb.tx.media[mediaId].delete()]);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
