import express from 'express';

export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER, genId,
    masterAuth,
    getCharacter,
    saveUploadFile, deleteUploadFile,
    mediaDb, _mediaGet, _mapUpsert,
    broadcast,
    crypto, path, fs, __dirname,
    chatLog, CHAT_MAX,
  } = ctx;

  const TABLE_STATE_ID = 'c8a04a12-4372-4c78-9abc-def012345601';

  async function getTableState() {
    try {
      let raw;
      if (DB_PROVIDER === 'localdb') {
        raw = ldb.getTableState();
      } else {
        const r = await idb.query({ tableState: { $: { where: { id: TABLE_STATE_ID } } } });
        raw = r.tableState?.[0] || { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: false };
      }
      raw.fogRegions = (() => { try { return JSON.parse(raw.fogRegions || '[]'); } catch { return []; } })();
      raw.hiddenItems = (() => { try { return JSON.parse(raw.hiddenItems || '[]'); } catch { return []; } })();
      return raw;
    } catch { return { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: false, fogRegions: [], hiddenItems: [] }; }
  }

  async function getTableTokens() {
    try {
      if (DB_PROVIDER === 'localdb') return ldb.listTableTokens();
      const r = await idb.query({ tableTokens: {} });
      return (r.tableTokens || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    } catch { return []; }
  }

  const TABLE_MAP_MEDIA_ID = 'table-map';

  // ── Table state ───────────────────────────────────────────────────────────────
  app.get('/api/table', async (req, res) => {
    try {
      const [state, tokens] = await Promise.all([getTableState(), getTableTokens()]);
      res.json({ state, tokens });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/table/state', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { cellSize, offsetX, offsetY, mapWidth, mapHeight } = req.body || {};
      const update = {};
      if (cellSize !== undefined) update.cellSize = Math.max(30, Math.min(150, parseInt(cellSize) || 50));
      if (offsetX !== undefined) update.offsetX = parseInt(offsetX) || 0;
      if (offsetY !== undefined) update.offsetY = parseInt(offsetY) || 0;
      if (mapWidth !== undefined) update.mapWidth = parseInt(mapWidth) || 0;
      if (mapHeight !== undefined) update.mapHeight = parseInt(mapHeight) || 0;
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState(update);
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(update)]);
      }
      broadcast('table', { action: 'state-updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Map ───────────────────────────────────────────────────────────────────────
  app.get('/api/table/map', (req, res) => {
    const item = _mediaGet.get(TABLE_MAP_MEDIA_ID);
    if (!item) return res.status(404).send('No map uploaded');
    const dataStr = item.data.toString();
    if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
    const etag = `"${crypto.createHash('md5').update(item.data).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('Content-Type', item.mime_type);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('ETag', etag);
    res.send(item.data);
  });

  app.post('/api/table/map', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl, mapWidth, mapHeight } = req.body || {};
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
      const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
      const mimeType = mimeMatch[1];
      const b64 = mimeMatch[2];
      if (Math.ceil(b64.length * 0.75) > 30_000_000) return res.status(413).json({ error: 'Image too large (max ~30 MB)' });
      const oldMap = _mediaGet.get(TABLE_MAP_MEDIA_ID);
      if (oldMap) { const s = oldMap.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
      const mapFileUrl = saveUploadFile('maps', TABLE_MAP_MEDIA_ID, mimeType, b64);
      _mapUpsert.run(TABLE_MAP_MEDIA_ID, mimeType, Buffer.from('FILE:' + mapFileUrl), Date.now());
      const stateUpdate = { hasMap: true, mapWidth: parseInt(mapWidth) || 0, mapHeight: parseInt(mapHeight) || 0 };
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState(stateUpdate);
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
      }
      broadcast('table', { action: 'map-updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/table/map', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const oldMapDel = _mediaGet.get(TABLE_MAP_MEDIA_ID);
      if (oldMapDel) { const s = oldMapDel.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
      mediaDb.prepare('DELETE FROM shared_media WHERE id = ?').run(TABLE_MAP_MEDIA_ID);
      const stateUpdate = { hasMap: false, mapWidth: 0, mapHeight: 0 };
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState(stateUpdate);
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
      }
      broadcast('table', { action: 'map-updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Fog ───────────────────────────────────────────────────────────────────────
  app.post('/api/table/fog/:regionId/reveal', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { regionId } = req.params;
      const state = await getTableState();
      const regions = Array.isArray(state.fogRegions) ? state.fogRegions : [];
      const region = regions.find(r => r.id === regionId);
      if (!region) return res.status(404).json({ error: 'Region not found' });
      region.visible = true;
      const fogJson = JSON.stringify(regions);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState({ fogRegions: fogJson });
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ fogRegions: fogJson })]);
      }
      broadcast('table', { action: 'fog-updated', fogRegions: regions });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/table/fog/:regionId/hide', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { regionId } = req.params;
      const state = await getTableState();
      const regions = Array.isArray(state.fogRegions) ? state.fogRegions : [];
      const region = regions.find(r => r.id === regionId);
      if (!region) return res.status(404).json({ error: 'Region not found' });
      region.visible = false;
      const fogJson = JSON.stringify(regions);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState({ fogRegions: fogJson });
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ fogRegions: fogJson })]);
      }
      broadcast('table', { action: 'fog-updated', fogRegions: regions });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Hidden Items ──────────────────────────────────────────────────────────────
  app.post('/api/table/items/:itemId/reveal', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { itemId } = req.params;
      const state = await getTableState();
      const items = Array.isArray(state.hiddenItems) ? state.hiddenItems : [];
      const item = items.find(r => r.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      item.visible = true;
      const itemsJson = JSON.stringify(items);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState({ hiddenItems: itemsJson });
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ hiddenItems: itemsJson })]);
      }
      broadcast('table', { action: 'items-updated', hiddenItems: items });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/table/items/:itemId/hide', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { itemId } = req.params;
      const state = await getTableState();
      const items = Array.isArray(state.hiddenItems) ? state.hiddenItems : [];
      const item = items.find(r => r.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      item.visible = false;
      const itemsJson = JSON.stringify(items);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState({ hiddenItems: itemsJson });
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update({ hiddenItems: itemsJson })]);
      }
      broadcast('table', { action: 'items-updated', hiddenItems: items });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Tokens ────────────────────────────────────────────────────────────────────
  app.post('/api/table/tokens', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, type = 'custom', linkedId = '', assignedCharId = '', x = 0, y = 0, color = '#888888',
              hpCurrent = 0, hpMax = 0, hpTemp = 0, speed = 30, initiativeId = '',
              tokenSize = 1, portrait = null, portraitThumb = null, label = '', conditions = '[]',
              ac = null } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
      if (!['character','monster','npc','custom'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

      let resolvedInitId = String(initiativeId);
      if (!resolvedInitId) {
        let initBonus = 0;
        try {
          if ((type === 'character' || type === 'npc') && linkedId) {
            const char = await getCharacter(String(linkedId));
            if (char) {
              let cdata = {};
              try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
              initBonus = (parseInt(cdata['init']) || 0) + (parseInt(cdata['init-bonus']) || 0);
            }
          } else if (type === 'monster' && linkedId) {
            const mon = DB_PROVIDER === 'localdb' ? ldb.getMonster(String(linkedId)) : (await idb.query({ monsters: { $: { where: { id: String(linkedId) } } } })).monsters?.[0];
            if (mon) {
              let mdata = {};
              try { mdata = JSON.parse(mon.dataJson || '{}'); } catch {}
              initBonus = Math.floor(((parseInt(mdata.dex) || 10) - 10) / 2);
            }
          }
        } catch {}
        const d20 = Math.ceil(Math.random() * 20);
        const roll = d20 + initBonus;
        const initEntryId = genId();
        const initFields = {
          name: String(name).trim(), roll,
          charId: (type === 'character' || type === 'npc') ? String(linkedId) : '',
          monsterId: type === 'monster' ? String(linkedId) : '',
          createdAt: new Date().toISOString()
        };
        if (DB_PROVIDER === 'localdb') {
          ldb.createInitEntry(initEntryId, initFields);
        } else {
          await idb.transact([idb.tx.initiativeEntries[initEntryId].update(initFields)]);
        }
        resolvedInitId = initEntryId;
        broadcast('initiative', { action: 'roll' });
        {
          const chatSender = type === 'monster' ? String(label || name).trim() : String(name).trim();
          const chatEntry = {
            id: genId(), sender: chatSender, dice: '1d20', results: [d20],
            modifier: initBonus, total: roll, label: 'Initiative',
            dmOnly: type === 'monster',
            timestamp: new Date().toISOString()
          };
          if (DB_PROVIDER === 'localdb') {
            ldb.appendChatLog(chatEntry);
          } else {
            chatLog.push(chatEntry);
            if (chatLog.length > CHAT_MAX) chatLog.shift();
          }
          broadcast('chat', chatEntry);
        }
      }

      const newId = genId();
      const token = {
        name: String(name).trim(), type, linkedId: String(linkedId), assignedCharId: String(assignedCharId),
        x: parseInt(x) || 0, y: parseInt(y) || 0,
        color: String(color), hpCurrent: parseInt(hpCurrent) || 0,
        hpMax: parseInt(hpMax) || 0, hpTemp: Math.max(0, parseInt(hpTemp) || 0), speed: parseInt(speed) || 30,
        initiativeId: resolvedInitId, movedFt: 0, visible: true,
        tokenSize: Math.max(1, Math.min(4, parseInt(tokenSize) || 1)),
        portrait: typeof portrait === 'string' && (portrait.startsWith('data:image/') || portrait.startsWith('/uploads/')) ? portrait : null,
        portraitThumb: typeof portraitThumb === 'string' && portraitThumb.startsWith('/uploads/') ? portraitThumb : null,
        label: String(label || '').slice(0, 20),
        conditions: Array.isArray(conditions) ? JSON.stringify(conditions) : String(conditions || '[]'),
        ac: ac != null ? (parseInt(ac) || null) : null,
        createdAt: new Date().toISOString()
      };
      if (DB_PROVIDER === 'localdb') {
        ldb.createTableToken(newId, token);
      } else {
        await idb.transact([idb.tx.tableTokens[newId].update({ id: newId, ...token })]);
      }
      broadcast('table', { action: 'token-added', token: { id: newId, ...token } });
      res.json({ ok: true, id: newId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/table/tokens/:id', async (req, res) => {
    try {
      const tok = DB_PROVIDER === 'localdb' ? ldb.getTableToken(req.params.id) : (await idb.query({ tableTokens: { $: { where: { id: req.params.id } } } })).tableTokens?.[0];
      if (!tok) return res.status(404).json({ error: 'Not found' });

      if (masterAuth(req)) {
        const body = req.body || {};
        const bodyKeys = Object.keys(body);
        if (bodyKeys.length === 2 && body.x !== undefined && body.y !== undefined) {
          const newX = parseInt(body.x) || 0, newY = parseInt(body.y) || 0;
          let currentId = '';
          if (DB_PROVIDER === 'localdb') {
            currentId = ldb.getInitState().currentId || '';
          } else {
            const initResult = await idb.query({ initiativeState: {} });
            currentId = initResult.initiativeState?.[0]?.currentId || '';
          }
          if (currentId) {
            const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
            const dist = Math.max(dx, dy) * 5;
            const newMovedFt = (tok.movedFt || 0) + dist;
            if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt }); }
            else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY, movedFt: newMovedFt })]); }
            broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
          } else {
            if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY }); }
            else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY })]); }
            broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: tok.movedFt || 0 });
          }
          return res.json({ ok: true });
        }

        const { name, label, x, y, color, hpCurrent, hpMax, hpTemp, speed, initiativeId, visible, movedFt, tokenSize, conditions, linkedId, assignedCharId } = body;
        const update = {};
        if (name !== undefined)          update.name = String(name).trim();
        if (label !== undefined)         update.label = String(label).trim();
        if (x !== undefined)             update.x = parseInt(x) || 0;
        if (y !== undefined)             update.y = parseInt(y) || 0;
        if (color !== undefined)         update.color = String(color);
        if (hpCurrent !== undefined)     update.hpCurrent = Math.max(0, parseInt(hpCurrent) || 0);
        if (hpMax !== undefined)         update.hpMax = Math.max(0, parseInt(hpMax) || 0);
        if (hpTemp !== undefined)        update.hpTemp = Math.max(0, parseInt(hpTemp) || 0);
        if (speed !== undefined)         update.speed = Math.max(0, parseInt(speed) || 30);
        if (initiativeId !== undefined)  update.initiativeId = String(initiativeId);
        if (visible !== undefined)       update.visible = !!visible;
        if (movedFt !== undefined)       update.movedFt = Math.max(0, parseInt(movedFt) || 0);
        if (tokenSize !== undefined)     update.tokenSize = Math.max(1, Math.min(4, parseInt(tokenSize) || 1));
        if (conditions !== undefined)    update.conditions = Array.isArray(conditions) ? JSON.stringify(conditions) : String(conditions);
        if (linkedId !== undefined)      update.linkedId = String(linkedId);
        if (assignedCharId !== undefined) update.assignedCharId = String(assignedCharId);
        if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, update); }
        else { await idb.transact([idb.tx.tableTokens[req.params.id].update(update)]); }
        const updated = { ...tok, ...update };
        broadcast('table', { action: 'token-updated', token: updated });

        const hpChanged = hpCurrent !== undefined || hpMax !== undefined || hpTemp !== undefined;
        if (hpChanged && tok.linkedId && (tok.type === 'character' || tok.type === 'npc')) {
          try {
            const char = await getCharacter(tok.linkedId);
            if (char) {
              let cdata = {};
              try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
              if (hpCurrent !== undefined) cdata.hpcur  = String(update.hpCurrent);
              if (hpMax !== undefined)     cdata.hpmax  = String(update.hpMax);
              if (hpTemp !== undefined)    cdata.hptemp = String(update.hpTemp);
              if (DB_PROVIDER === 'localdb') { ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) }); }
              else { await idb.transact([idb.tx.characters[tok.linkedId].update({ dataJson: JSON.stringify(cdata) })]); }
              broadcast('characters', { action: 'updated', id: tok.linkedId });
            }
          } catch (syncErr) { console.error('char HP sync:', syncErr); }
        }
        res.json({ ok: true });
      } else {
        const body = req.body || {};
        if (body.conditions !== undefined && Object.keys(body).length === 1) {
          const condVal = Array.isArray(body.conditions) ? JSON.stringify(body.conditions) : String(body.conditions);
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { conditions: condVal }); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ conditions: condVal })]); }
          broadcast('table', { action: 'token-updated', token: { ...tok, conditions: condVal } });
          return res.json({ ok: true });
        }
        if ((body.hpCurrent !== undefined || body.hpTemp !== undefined) && (tok.type === 'character' || tok.type === 'npc')) {
          const update = {};
          if (body.hpCurrent !== undefined) update.hpCurrent = Math.max(0, parseInt(body.hpCurrent) || 0);
          if (body.hpTemp !== undefined)    update.hpTemp    = Math.max(0, parseInt(body.hpTemp) || 0);
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, update); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update(update)]); }
          const updated = { ...tok, ...update };
          broadcast('table', { action: 'token-updated', token: updated });
          if (tok.linkedId) {
            try {
              const char = await getCharacter(tok.linkedId);
              if (char) {
                let cdata = {};
                try { cdata = JSON.parse(char.dataJson || '{}'); } catch {}
                if (update.hpCurrent !== undefined) cdata.hpcur  = String(update.hpCurrent);
                if (update.hpTemp !== undefined)    cdata.hptemp = String(update.hpTemp);
                if (DB_PROVIDER === 'localdb') { ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) }); }
                else { await idb.transact([idb.tx.characters[tok.linkedId].update({ dataJson: JSON.stringify(cdata) })]); }
                broadcast('characters', { action: 'updated', id: tok.linkedId });
              }
            } catch (syncErr) { console.error('char HP sync:', syncErr); }
          }
          return res.json({ ok: true });
        }

        const { x, y } = body;
        if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
        if (tok.type === 'monster') return res.status(403).json({ error: 'Unauthorized' });
        const callerCharId = req.headers['x-character-id'];
        if (callerCharId) {
          const ownerField = tok.assignedCharId || tok.linkedId;
          if (!ownerField || ownerField !== callerCharId) return res.status(403).json({ error: 'Not your token' });
        }
        let currentId = '';
        if (DB_PROVIDER === 'localdb') {
          currentId = ldb.getInitState().currentId || '';
        } else {
          const initResult = await idb.query({ initiativeState: {} });
          currentId = initResult.initiativeState?.[0]?.currentId || '';
        }
        const newX = parseInt(x) || 0, newY = parseInt(y) || 0;
        if (currentId) {
          if (tok.initiativeId && tok.initiativeId !== currentId) return res.status(403).json({ error: 'Not your turn' });
          const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
          const dist = Math.max(dx, dy) * 5;
          const newMovedFt = (tok.movedFt || 0) + dist;
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt }); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY, movedFt: newMovedFt })]); }
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
        } else {
          if (DB_PROVIDER === 'localdb') { ldb.updateTableToken(req.params.id, { x: newX, y: newY }); }
          else { await idb.transact([idb.tx.tableTokens[req.params.id].update({ x: newX, y: newY })]); }
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: tok.movedFt || 0 });
        }
        res.json({ ok: true });
      }
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/table/tokens/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const tok = DB_PROVIDER === 'localdb' ? ldb.getTableToken(req.params.id) : (await idb.query({ tableTokens: { $: { where: { id: req.params.id } } } })).tableTokens?.[0];
      if (!tok) return res.status(404).json({ error: 'Not found' });

      let initiativeBroadcastNeeded = false;
      if (tok.initiativeId) {
        if (DB_PROVIDER === 'localdb') {
          const state = ldb.getInitState();
          const wasCurrentTurn = state.currentId === tok.initiativeId;
          if (wasCurrentTurn) {
            const entries = ldb.listInitEntries();
            const idx = entries.findIndex(e => e.id === tok.initiativeId);
            const remaining = entries.filter(e => e.id !== tok.initiativeId);
            const nextId = remaining.length > 0 ? (remaining[idx % remaining.length]?.id || remaining[0].id) : '';
            ldb.deleteInitEntry(tok.initiativeId);
            ldb.setInitState(nextId);
          } else {
            ldb.deleteInitEntry(tok.initiativeId);
          }
        } else {
          const result = await idb.query({ initiativeEntries: { $: { where: { id: tok.initiativeId } } }, initiativeState: {} });
          const state = result.initiativeState?.[0];
          if (state?.currentId === tok.initiativeId) {
            const allEntries = (await idb.query({ initiativeEntries: {} })).initiativeEntries || [];
            const sorted = allEntries.sort((a, b) => (b.roll || 0) - (a.roll || 0));
            const idx = sorted.findIndex(e => e.id === tok.initiativeId);
            const remaining = sorted.filter(e => e.id !== tok.initiativeId);
            const nextId = remaining.length > 0 ? (remaining[idx % remaining.length]?.id || remaining[0].id) : '';
            await idb.transact([idb.tx.initiativeEntries[tok.initiativeId].delete(), idb.tx.initiativeState[state.id].update({ currentId: nextId })]);
          } else {
            await idb.transact([idb.tx.initiativeEntries[tok.initiativeId].delete()]);
          }
        }
        initiativeBroadcastNeeded = true;
      }

      if (DB_PROVIDER === 'localdb') { ldb.deleteTableToken(req.params.id); }
      else { await idb.transact([idb.tx.tableTokens[req.params.id].delete()]); }

      broadcast('table', { action: 'token-removed', id: req.params.id });
      if (initiativeBroadcastNeeded) broadcast('initiative', { action: 'delete' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/table/ping', async (req, res) => {
    try {
      const { x, y, color = '#ffff00' } = req.body || {};
      if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
      broadcast('table', { action: 'ping', x: parseFloat(x), y: parseFloat(y), color: String(color).slice(0,20) });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/table/clear', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') {
        ldb.clearTableTokens();
        ldb.clearInitEntries();
        ldb.setInitState('');
      } else {
        const result = await idb.query({ tableTokens: {}, initiativeEntries: {}, initiativeState: {} });
        const txns = [
          ...(result.tableTokens || []).map(t => idb.tx.tableTokens[t.id].delete()),
          ...(result.initiativeEntries || []).map(e => idb.tx.initiativeEntries[e.id].delete()),
          ...(result.initiativeState || []).map(s => idb.tx.initiativeState[s.id].delete()),
        ];
        if (txns.length > 0) await idb.transact(txns);
      }
      broadcast('table', { action: 'tokens-cleared' });
      broadcast('initiative', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Prepared Maps ─────────────────────────────────────────────────────────────
  app.get('/api/prepared-maps', async (req, res) => {
    try {
      let maps;
      if (DB_PROVIDER === 'localdb') {
        maps = ldb.listPreparedMaps();
      } else {
        const r = await idb.query({ preparedMaps: {} });
        maps = r.preparedMaps || [];
      }
      maps = maps.map(m => ({
        ...m,
        fogRegions: (() => { try { return JSON.parse(m.fogRegions || '[]'); } catch { return []; } })(),
        hiddenItems: (() => { try { return JSON.parse(m.hiddenItems || '[]'); } catch { return []; } })(),
        hasImage: !!mediaDb.prepare('SELECT id FROM shared_media WHERE id = ?').get('prep-map-' + m.id),
      }));
      res.json(maps);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/prepared-maps', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const name = (req.body?.name || '').trim() || 'Untitled Map';
      const id = genId();
      const fields = { name, createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createPreparedMap(id, fields);
      } else {
        await idb.transact([idb.tx.preparedMaps[id].update({ id, ...fields, fogRegions: '[]' })]);
      }
      res.json({ ok: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/prepared-maps/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body || {};
      const fields = {};
      if (body.name !== undefined) fields.name = String(body.name).trim();
      if (body.cellSize !== undefined) fields.cellSize = Math.max(20, Math.min(200, parseInt(body.cellSize) || 50));
      if (body.offsetX !== undefined) fields.offsetX = parseInt(body.offsetX) || 0;
      if (body.offsetY !== undefined) fields.offsetY = parseInt(body.offsetY) || 0;
      if (body.mapWidth !== undefined) fields.mapWidth = parseInt(body.mapWidth) || 0;
      if (body.mapHeight !== undefined) fields.mapHeight = parseInt(body.mapHeight) || 0;
      if (body.fogRegions !== undefined) fields.fogRegions = JSON.stringify(Array.isArray(body.fogRegions) ? body.fogRegions : []);
      if (body.hiddenItems !== undefined) fields.hiddenItems = JSON.stringify(Array.isArray(body.hiddenItems) ? body.hiddenItems : []);
      if (Object.keys(fields).length === 0) return res.json({ ok: true });
      if (DB_PROVIDER === 'localdb') {
        ldb.updatePreparedMap(req.params.id, fields);
      } else {
        await idb.transact([idb.tx.preparedMaps[req.params.id].update(fields)]);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/prepared-maps/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      if (DB_PROVIDER === 'localdb') {
        ldb.deletePreparedMap(id);
      } else {
        await idb.transact([idb.tx.preparedMaps[id].delete()]);
      }
      const prepDelId = 'prep-map-' + id;
      const prepDelItem = _mediaGet.get(prepDelId);
      if (prepDelItem) { const s = prepDelItem.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
      mediaDb.prepare('DELETE FROM shared_media WHERE id = ?').run(prepDelId);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/prepared-maps/:id/image', (req, res) => {
    const item = _mediaGet.get('prep-map-' + req.params.id);
    if (!item) return res.status(404).send('No image uploaded');
    const dataStr = item.data.toString();
    if (dataStr.startsWith('FILE:')) return res.redirect(dataStr.slice(5));
    const etag = `"${crypto.createHash('md5').update(item.data).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.set('Content-Type', item.mime_type);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('ETag', etag);
    res.send(item.data);
  });

  app.post('/api/prepared-maps/:id/image', express.json({ limit: '34mb' }), async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl, mapWidth, mapHeight } = req.body || {};
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
      const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
      const mimeType = mimeMatch[1];
      const b64 = mimeMatch[2];
      if (Math.ceil(b64.length * 0.75) > 30_000_000) return res.status(413).json({ error: 'Image too large (max ~30 MB)' });
      const prepMapId = 'prep-map-' + req.params.id;
      const oldPrepMap = _mediaGet.get(prepMapId);
      if (oldPrepMap) { const s = oldPrepMap.data.toString(); if (s.startsWith('FILE:')) deleteUploadFile(s.slice(5)); }
      const prepFileUrl = saveUploadFile('maps', prepMapId, mimeType, b64);
      _mapUpsert.run(prepMapId, mimeType, Buffer.from('FILE:' + prepFileUrl), Date.now());
      const sizeFields = { mapWidth: parseInt(mapWidth) || 0, mapHeight: parseInt(mapHeight) || 0 };
      if (DB_PROVIDER === 'localdb') {
        ldb.updatePreparedMap(req.params.id, sizeFields);
      } else {
        await idb.transact([idb.tx.preparedMaps[req.params.id].update(sizeFields)]);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/prepared-maps/:id/load-to-table', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let map;
      if (DB_PROVIDER === 'localdb') {
        map = ldb.getPreparedMap(req.params.id);
      } else {
        const r = await idb.query({ preparedMaps: { $: { where: { id: req.params.id } } } });
        map = r.preparedMaps?.[0];
      }
      if (!map) return res.status(404).json({ error: 'Prepared map not found' });
      const srcId = 'prep-map-' + req.params.id;
      const imgRow = _mediaGet.get(srcId);
      if (imgRow) {
        const srcDataStr = imgRow.data.toString();
        if (srcDataStr.startsWith('FILE:')) {
          const srcFilePath = path.join(__dirname, 'public', srcDataStr.slice(5));
          const ext = path.extname(srcFilePath);
          const destFileUrl = `/uploads/maps/${TABLE_MAP_MEDIA_ID}${ext}`;
          const destFilePath = path.join(__dirname, 'public', destFileUrl);
          const oldTableMap = _mediaGet.get(TABLE_MAP_MEDIA_ID);
          if (oldTableMap) { const s = oldTableMap.data.toString(); if (s.startsWith('FILE:') && s.slice(5) !== destFileUrl) deleteUploadFile(s.slice(5)); }
          try { fs.mkdirSync(path.dirname(destFilePath), { recursive: true }); fs.copyFileSync(srcFilePath, destFilePath); } catch {}
          _mapUpsert.run(TABLE_MAP_MEDIA_ID, imgRow.mime_type, Buffer.from('FILE:' + destFileUrl), Date.now());
        } else {
          _mapUpsert.run(TABLE_MAP_MEDIA_ID, imgRow.mime_type, imgRow.data, Date.now());
        }
      }
      const fogRegions = (() => { try { return JSON.parse(map.fogRegions || '[]'); } catch { return []; } })();
      const hiddenItems = (() => { try { return JSON.parse(map.hiddenItems || '[]'); } catch { return []; } })();
      const stateUpdate = {
        cellSize: map.cellSize || 50,
        offsetX: map.offsetX || 0,
        offsetY: map.offsetY || 0,
        mapWidth: map.mapWidth || 0,
        mapHeight: map.mapHeight || 0,
        hasMap: imgRow ? true : false,
        fogRegions: JSON.stringify(fogRegions),
        hiddenItems: JSON.stringify(hiddenItems),
      };
      if (DB_PROVIDER === 'localdb') {
        ldb.updateTableState(stateUpdate);
      } else {
        await idb.transact([idb.tx.tableState[TABLE_STATE_ID].update(stateUpdate)]);
      }
      broadcast('table', { action: 'map-updated' });
      broadcast('table', { action: 'fog-updated', fogRegions });
      broadcast('table', { action: 'items-updated', hiddenItems });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
