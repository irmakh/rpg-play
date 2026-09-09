import express from 'express';

export default function register(app, ctx) {
  const {
    ldb, genId,
    masterAuth, charAuth,
    getCharacter,
    processImageSizes, saveUploadFile, deleteUploadFile,
    mediaDb, _mediaGet, _mapUpsert,
    broadcast: _rawBroadcast,
    crypto, path, fs, __dirname,
  } = ctx;
  // Older harnesses register these routes without the campaign helpers.
  const currentCampaignId = ctx.currentCampaignId || (() => '');
  const parkedCampaigns   = ctx.parkedCampaigns || new Set();

  /**
   * While the table is parked on a waiting screen, everything on the 'table'
   * channel — token moves, fog, map swaps, pings — is the DM rearranging things
   * the players are not supposed to be watching, so it goes only to DM clients.
   *
   * Wrapping the one function rather than tagging 24 call sites is deliberate:
   * a broadcast added here later is covered without anyone remembering to.
   * Other channels ('characters', 'initiative', 'waiting-screen') are
   * unaffected and still reach everyone.
   */
  function broadcast(eventName, payload = {}, campaignId, opts = {}) {
    const gated = eventName === 'table' && !!activeWaitingId();
    return _rawBroadcast(eventName, payload, campaignId ?? currentCampaignId(),
                         gated ? { ...opts, dmOnly: true } : opts);
  }

  const TABLE_STATE_ID = 'c8a04a12-4372-4c78-9abc-def012345601';

  // ── Waiting screens ─────────────────────────────────────────────────────────
  // A waiting screen parks the table on a full-bleed image. Players get the
  // image instead of the map; the DM keeps the map and carries on arranging it.
  // The hiding is done here, on the server, not by covering things in the
  // browser — the same choice treasury.js makes for unidentified items.

  /** The id of the screen this campaign is parked on, or '' for none. */
  function activeWaitingId() {
    try { return ldb.getTableState().waitingScreenId || ''; } catch { return ''; }
  }

  /** Keep the static-mount gate in server.js in step with the database. */
  function syncParked(showing) {
    const id = currentCampaignId() || '';
    if (showing) parkedCampaigns.add(id);
    else parkedCampaigns.delete(id);
  }

  function waitingObj(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name || '', caption: r.caption || '',
      imageUrl: r.imageUrl || '', imageThumb: r.imageThumb || '',
      imageMedium: r.imageMedium || '', createdAt: r.createdAt || '',
    };
  }

  /** Remove a screen's image files from disk. Safe when there is no image. */
  function dropWaitingImages(rec) {
    for (const url of [rec?.imageUrl, rec?.imageThumb, rec?.imageMedium]) {
      if (url) deleteUploadFile(url);
    }
  }

  app.get('/api/waiting-screens', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      res.json({ screens: ldb.listWaitingScreens().map(waitingObj), activeId: activeWaitingId() });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // What the players are being shown. Unauthenticated on purpose: the image is
  // the one thing they ARE meant to see, and a signed-out tab still needs it.
  app.get('/api/table/waiting-screen', (req, res) => {
    try {
      const id = activeWaitingId();
      if (!id) return res.json({ active: null });
      const rec = ldb.getWaitingScreen(id);
      if (!rec) return res.json({ active: null });
      res.json({ active: waitingObj(rec) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/waiting-screens', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const name = String(req.body?.name || '').trim().slice(0, 80) || 'Untitled screen';
      const caption = String(req.body?.caption || '').trim().slice(0, 200);
      const id = genId();
      ldb.createWaitingScreen(id, { name, caption, createdAt: new Date().toISOString() });
      res.json({ ok: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/waiting-screens/:id', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const rec = ldb.getWaitingScreen(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const fields = {};
      if (req.body?.name !== undefined) fields.name = String(req.body.name).trim().slice(0, 80);
      if (req.body?.caption !== undefined) fields.caption = String(req.body.caption).trim().slice(0, 200);
      if (Object.keys(fields).length === 0) return res.json({ ok: true });
      ldb.updateWaitingScreen(req.params.id, fields);
      // A rename or a new caption is visible to whoever is being held on it.
      if (activeWaitingId() === req.params.id) {
        broadcast('waiting-screen', { active: waitingObj(ldb.getWaitingScreen(req.params.id)) });
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/waiting-screens/:id/image', express.json({ limit: '30mb' }), async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const rec = ldb.getWaitingScreen(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const { dataUrl } = req.body || {};
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Image required' });
      const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
      if (!m) return res.status(400).json({ error: 'Invalid image format' });
      if (Math.ceil(m[2].length * 0.75) > 30_000_000) return res.status(413).json({ error: 'Image too large (max ~30 MB)' });

      dropWaitingImages(rec);   // replacing: the old files are now unreachable
      const urls = await processImageSizes(m[1], Buffer.from(m[2], 'base64'), 'waiting', req.params.id);
      const fields = { imageUrl: urls.original, imageThumb: urls.thumb, imageMedium: urls.medium };
      ldb.updateWaitingScreen(req.params.id, fields);
      if (activeWaitingId() === req.params.id) {
        broadcast('waiting-screen', { active: waitingObj({ ...rec, ...fields }) });
      }
      res.json({ ok: true, ...fields });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/waiting-screens/:id', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const rec = ldb.getWaitingScreen(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      // Deleting the screen the table is parked on must also un-park it, or the
      // players would be held on an image that no longer exists.
      const wasActive = activeWaitingId() === req.params.id;
      dropWaitingImages(rec);
      ldb.deleteWaitingScreen(req.params.id);
      if (wasActive) {
        ldb.updateTableState({ waitingScreenId: '' });
        syncParked(false);
        broadcast('waiting-screen', { active: null });
      }
      res.json({ ok: true, closed: wasActive });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // Open ({id}) or close ({id:''}) — the only route that parks the table.
  app.post('/api/table/waiting-screen', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const id = String(req.body?.id || '').trim();
      if (id) {
        const rec = ldb.getWaitingScreen(id);
        if (!rec) return res.status(404).json({ error: 'Not found' });
        ldb.updateTableState({ waitingScreenId: id });
        syncParked(true);
        broadcast('waiting-screen', { active: waitingObj(rec) });
        return res.json({ ok: true, active: waitingObj(rec) });
      }
      ldb.updateTableState({ waitingScreenId: '' });
      syncParked(false);
      broadcast('waiting-screen', { active: null });
      res.json({ ok: true, active: null });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  async function getTableState() {
    try {
      const raw = ldb.getTableState();
      raw.fogRegions = (() => { try { return JSON.parse(raw.fogRegions || '[]'); } catch { return []; } })();
      raw.hiddenItems = (() => { try { return JSON.parse(raw.hiddenItems || '[]'); } catch { return []; } })();
      return raw;
    } catch { return { id: TABLE_STATE_ID, cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, hasMap: false, fogRegions: [], hiddenItems: [] }; }
  }

  async function getTableTokens() {
    try {
      return ldb.listTableTokens();
    } catch { return []; }
  }

  const TABLE_MAP_MEDIA_ID = 'table-map';

  // ── Table state ───────────────────────────────────────────────────────────────
  /**
   * The table as this caller is allowed to see it.
   *
   * Normally that is everything. While the campaign is parked on a waiting
   * screen it is everything for the DM and, for a player, only their own
   * token and no map at all — the tactical picture is withheld here rather
   * than covered in the browser, so a player cannot read it out of the
   * network payload.
   *
   * Their own token still travels, because the character panel on the right
   * of the waiting screen is built from it and is the whole point of being
   * able to keep rolling during a break.
   */
  app.get('/api/table', async (req, res) => {
    try {
      const [state, tokens] = await Promise.all([getTableState(), getTableTokens()]);
      const parkedOn = state.waitingScreenId || '';
      syncParked(!!parkedOn);   // self-heals the static gate if it drifted

      if (!parkedOn || masterAuth(req)) return res.json({ state, tokens });

      // A player: prove who they are before handing back even their own token.
      const charId = String(req.headers['x-character-id'] || '');
      let mine = [];
      if (charId && (await charAuth(charId, req)) === 200) {
        mine = tokens.filter(t => (t.assignedCharId && t.assignedCharId === charId)
                              || (!t.assignedCharId && t.linkedId && t.linkedId === charId));
      }
      res.json({
        state: { ...state, hasMap: false, mapWidth: 0, mapHeight: 0, fogRegions: [], hiddenItems: [] },
        tokens: mine,
      });
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
      ldb.updateTableState(update);
      broadcast('table', { action: 'state-updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Map ───────────────────────────────────────────────────────────────────────
  app.get('/api/table/map', (req, res) => {
    const item = _mediaGet.get(TABLE_MAP_MEDIA_ID);
    if (!item) return res.status(404).send('No map uploaded');
    const dataStr = item.data.toString();

    // Parked on a waiting screen: the map belongs to the DM alone. Normally
    // this redirects to the file's static URL, but that URL is gated while
    // parked (see the /uploads guard in server.js), so the bytes are streamed
    // straight back instead. The DM's client asks for this with fetch() and the
    // DM password and renders the result from a blob — an <img src> could never
    // send that header, which is exactly why players cannot reach it.
    if (activeWaitingId()) {
      if (!masterAuth(req)) return res.status(403).send('Map unavailable');
      if (dataStr.startsWith('FILE:')) {
        const abs = path.join(__dirname, 'public', dataStr.slice(5).split('?')[0]);
        res.set('Cache-Control', 'no-store');
        return res.sendFile(abs, err => { if (err && !res.headersSent) res.status(404).send('No map uploaded'); });
      }
      res.set('Content-Type', item.mime_type);
      res.set('Cache-Control', 'no-store');
      return res.send(item.data);
    }

    if (dataStr.startsWith('FILE:')) {
      // The on-disk path (table-map.<ext>) is reused when a new map shares the same
      // extension, so the static URL is byte-identical across map swaps and the
      // browser serves the stale cached image (max-age 300). Version it with the
      // row's created_at so the URL changes whenever the map content changes.
      let target = dataStr.slice(5);
      if (item.created_at) target += (target.includes('?') ? '&' : '?') + 'v=' + item.created_at;
      return res.redirect(target);
    }
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
      ldb.updateTableState(stateUpdate);
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
      ldb.updateTableState(stateUpdate);
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
      ldb.updateTableState({ fogRegions: fogJson });
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
      ldb.updateTableState({ fogRegions: fogJson });
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
      ldb.updateTableState({ hiddenItems: itemsJson });
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
      ldb.updateTableState({ hiddenItems: itemsJson });
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

      const resolvedInitId = String(initiativeId);

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
      ldb.createTableToken(newId, token);
      broadcast('table', { action: 'token-added', token: { id: newId, ...token } });
      res.json({ ok: true, id: newId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/table/tokens/:id', async (req, res) => {
    try {
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });

      if (masterAuth(req)) {
        const body = req.body || {};
        const bodyKeys = Object.keys(body);
        if (bodyKeys.length === 2 && body.x !== undefined && body.y !== undefined) {
          const newX = parseInt(body.x) || 0, newY = parseInt(body.y) || 0;
          const currentId = ldb.getInitState().currentId || '';
          if (currentId) {
            const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
            const dist = Math.max(dx, dy) * 5;
            const newMovedFt = (tok.movedFt || 0) + dist;
            ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt });
            broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
          } else {
            ldb.updateTableToken(req.params.id, { x: newX, y: newY });
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
        ldb.updateTableToken(req.params.id, update);
        const updated = { ...tok, ...update };
        broadcast('table', { action: 'token-updated', token: updated });

        // Conditions the DM put on a player's own token, named so they can see
        // what changed without hunting through the token panel.
        if (conditions !== undefined && tok.linkedId && (tok.type === 'character' || tok.type === 'npc')) {
          const listOf = (v) => {
            try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; }
          };
          const before = listOf(tok.conditions);
          const after = listOf(update.conditions);
          const added = after.filter(c => !before.includes(c));
          const removed = before.filter(c => !after.includes(c));
          if (added.length || removed.length) {
            ctx.notify?.({
              to: tok.linkedId, kind: 'condition',
              title: added.length ? 'You are now ' + added.join(', ') : 'No longer ' + removed.join(', '),
              data: { href: '/table.html' },
            });
          }
        }

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
              ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) });
              broadcast('characters', { action: 'updated', id: tok.linkedId });

              // This branch is the DM's, so an HP change here was done TO the
              // player rather than by them — their sheet would otherwise just
              // change underneath them with no explanation.
              if (hpCurrent !== undefined) {
                const before = tok.hpCurrent ?? 0;
                const after = update.hpCurrent;
                const delta = after - before;
                if (delta !== 0) {
                  ctx.notify?.({
                    to: tok.linkedId,
                    kind: delta < 0 ? 'damage' : 'healing',
                    title: delta < 0 ? `You took ${-delta} damage` : `You were healed ${delta}`,
                    body: `HP ${after}${update.hpMax ?? tok.hpMax ? ' / ' + (update.hpMax ?? tok.hpMax) : ''}`,
                    // Dropping to 0 is the one HP change worth interrupting for.
                    priority: after === 0 ? 'alert' : 'feed',
                    data: { href: '/table.html' },
                  });
                }
              }
            }
          } catch (syncErr) { console.error('char HP sync:', syncErr); }
        }
        res.json({ ok: true });
      } else {
        const body = req.body || {};
        if (body.conditions !== undefined && Object.keys(body).length === 1) {
          const condVal = Array.isArray(body.conditions) ? JSON.stringify(body.conditions) : String(body.conditions);
          ldb.updateTableToken(req.params.id, { conditions: condVal });
          broadcast('table', { action: 'token-updated', token: { ...tok, conditions: condVal } });
          return res.json({ ok: true });
        }
        if ((body.hpCurrent !== undefined || body.hpTemp !== undefined) && (tok.type === 'character' || tok.type === 'npc')) {
          const update = {};
          if (body.hpCurrent !== undefined) update.hpCurrent = Math.max(0, parseInt(body.hpCurrent) || 0);
          if (body.hpTemp !== undefined)    update.hpTemp    = Math.max(0, parseInt(body.hpTemp) || 0);
          ldb.updateTableToken(req.params.id, update);
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
                ldb.updateCharacter(tok.linkedId, { dataJson: JSON.stringify(cdata) });
                broadcast('characters', { action: 'updated', id: tok.linkedId });
              }
            } catch (syncErr) { console.error('char HP sync:', syncErr); }
          }
          return res.json({ ok: true });
        }

        const { x, y } = body;
        if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
        // Item 11: token movement is open to everyone. Players may move any token
        // (characters and monsters) regardless of ownership or whose turn it is.
        // Accidental moves are recoverable via the client-side Undo button.
        const currentId = ldb.getInitState().currentId || '';
        const newX = parseInt(x) || 0, newY = parseInt(y) || 0;
        if (currentId) {
          const dx = Math.abs(newX - (tok.x || 0)), dy = Math.abs(newY - (tok.y || 0));
          const dist = Math.max(dx, dy) * 5;
          const newMovedFt = (tok.movedFt || 0) + dist;
          ldb.updateTableToken(req.params.id, { x: newX, y: newY, movedFt: newMovedFt });
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: newMovedFt });
        } else {
          ldb.updateTableToken(req.params.id, { x: newX, y: newY });
          broadcast('table', { action: 'token-moved', id: req.params.id, x: newX, y: newY, movedFt: tok.movedFt || 0 });
        }
        res.json({ ok: true });
      }
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/table/tokens/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });

      let initiativeBroadcastNeeded = false;
      if (tok.initiativeId) {
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
        initiativeBroadcastNeeded = true;
      }

      ldb.deleteTableToken(req.params.id);

      broadcast('table', { action: 'token-removed', id: req.params.id });
      if (initiativeBroadcastNeeded) broadcast('initiative', { action: 'delete' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/table/tokens/:id/portrait', express.json({ limit: '12mb' }), async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl } = req.body || {};
      if (typeof dataUrl !== 'string' || (dataUrl !== '' && !dataUrl.match(/^data:image\//)))
        return res.status(400).json({ error: 'Image data URL required' });
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });

      let portrait = null, portraitThumb = null, customPortrait = 0;

      if (dataUrl === '') {
        // Clearing custom portrait — delete custom files and restore monster portrait
        deleteUploadFile(tok.portrait);
        deleteUploadFile(tok.portraitThumb);
        // Restore from linked monster if present
        if (tok.linkedId) {
          const mon = ldb.getMonster(tok.linkedId);
          if (mon) {
            let d = {};
            try { d = JSON.parse(mon.dataJson || '{}'); } catch {}
            portrait = d.portrait || null;
            portraitThumb = d.portraitThumb || null;
          }
        }
        customPortrait = 0;
      } else {
        // Upload new custom portrait
        const mimeMatch = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
        if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format' });
        deleteUploadFile(tok.portrait);
        deleteUploadFile(tok.portraitThumb);
        const buffer = Buffer.from(mimeMatch[2], 'base64');
        const urls = await processImageSizes(mimeMatch[1], buffer, 'tokens', req.params.id);
        portrait = urls.original;
        portraitThumb = urls.thumb;
        customPortrait = 1;
      }

      const update = { portrait, portraitThumb, customPortrait };
      ldb.updateTableToken(req.params.id, update);
      broadcast('table', { action: 'token-updated', token: { ...tok, ...update } });
      res.json({ ok: true, portrait, portraitThumb });
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
      ldb.clearTableTokens();
      ldb.clearInitEntries();
      ldb.setInitState('');
      broadcast('table', { action: 'tokens-cleared' });
      broadcast('initiative', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Prepared Maps ─────────────────────────────────────────────────────────────
  app.get('/api/prepared-maps', async (req, res) => {
    try {
      const maps = ldb.listPreparedMaps().map(m => ({
        ...m,
        fogRegions: (() => { try { return JSON.parse(m.fogRegions || '[]'); } catch { return []; } })(),
        hiddenItems: (() => { try { return JSON.parse(m.hiddenItems || '[]'); } catch { return []; } })(),
        preparedTokens: (() => { try { return JSON.parse(m.preparedTokens || '[]'); } catch { return []; } })(),
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
      ldb.createPreparedMap(id, fields);
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
      if (body.preparedTokens !== undefined) fields.preparedTokens = JSON.stringify(Array.isArray(body.preparedTokens) ? body.preparedTokens : []);
      if (Object.keys(fields).length === 0) return res.json({ ok: true });
      ldb.updatePreparedMap(req.params.id, fields);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/prepared-maps/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      ldb.deletePreparedMap(id);
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
    if (dataStr.startsWith('FILE:')) {
      // Re-uploading an image to an existing prepared map overwrites the same
      // on-disk path, so version the redirect target to avoid a stale browser cache.
      let target = dataStr.slice(5);
      if (item.created_at) target += (target.includes('?') ? '&' : '?') + 'v=' + item.created_at;
      return res.redirect(target);
    }
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
      ldb.updatePreparedMap(req.params.id, sizeFields);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/prepared-maps/:id/load-to-table', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const map = ldb.getPreparedMap(req.params.id);
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
      ldb.updateTableState(stateUpdate);
      broadcast('table', { action: 'map-updated' });
      broadcast('table', { action: 'fog-updated', fogRegions });
      broadcast('table', { action: 'items-updated', hiddenItems });

      // Clear all existing tokens and initiative before placing prepared tokens
      ldb.clearTableTokens();
      ldb.clearInitEntries();
      ldb.setInitState('');
      broadcast('table', { action: 'tokens-cleared' });
      broadcast('initiative', { action: 'clear' });

      // Place prepared tokens onto the table
      const preparedTokens = (() => { try { return JSON.parse(map.preparedTokens || '[]'); } catch { return []; } })();
      for (const pt of preparedTokens) {
        const tokenId = genId();
        const token = {
          name: String(pt.name || 'Token').trim(),
          type: ['monster','npc','character','custom'].includes(pt.type) ? pt.type : 'custom',
          linkedId: String(pt.linkedId || ''),
          assignedCharId: '',
          x: parseInt(pt.x) || 0,
          y: parseInt(pt.y) || 0,
          color: String(pt.color || '#888888'),
          hpCurrent: parseInt(pt.hpMax) || 0,
          hpMax: parseInt(pt.hpMax) || 0,
          hpTemp: 0,
          speed: parseInt(pt.speed) || 30,
          initiativeId: '',
          movedFt: 0,
          visible: pt.visibleToPlayers !== false,
          tokenSize: Math.max(1, Math.min(4, parseInt(pt.tokenSize) || 1)),
          portrait: typeof pt.portrait === 'string' ? pt.portrait : null,
          portraitThumb: typeof pt.portraitThumb === 'string' ? pt.portraitThumb : null,
          label: String(pt.label || '').slice(0, 20),
          conditions: '[]',
          ac: pt.ac != null ? (parseInt(pt.ac) || null) : null,
          createdAt: new Date().toISOString(),
        };
        ldb.createTableToken(tokenId, token);
        broadcast('table', { action: 'token-added', token: { id: tokenId, ...token } });
      }

      res.json({ ok: true, tokensPlaced: preparedTokens.length });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
