export default function register(app, ctx) {
  const { ldb, idb, DB_PROVIDER, genId, masterAuth, charAuth, broadcast } = ctx;

  app.get('/api/initiative', async (req, res) => {
    try {
      let entries, state;
      if (DB_PROVIDER === 'localdb') {
        entries = ldb.listInitEntries();
        state   = ldb.getInitState();
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
        state   = result.initiativeState?.[0] || null;
      }
      res.json({ entries, currentId: state?.currentId || '' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative', async (req, res) => {
    try {
      const { name, roll, charId, monsterId } = req.body || {};
      if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });
      const newId = genId();
      const fields = { name: String(name).trim(), roll: parseInt(roll), charId: charId || '', monsterId: monsterId || '', createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createInitEntry(newId, fields);
      } else {
        await idb.transact([idb.tx.initiativeEntries[newId].update(fields)]);
      }
      broadcast('initiative', { action: 'roll' });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/initiative/:id', async (req, res) => {
    try {
      const { name, roll, charId } = req.body || {};
      const isMaster = masterAuth(req);
      if (!isMaster) {
        if (!charId) return res.status(401).json({ error: 'Unauthorized' });
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
        const entry = DB_PROVIDER === 'localdb' ? ldb.getInitEntry(req.params.id) : (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
        if (!entry || entry.charId !== charId) return res.status(403).json({ error: 'Forbidden' });
      }
      const update = {};
      if (name !== undefined) update.name = String(name);
      if (roll !== undefined) update.roll = parseInt(roll);
      if (DB_PROVIDER === 'localdb') {
        ldb.updateInitEntry(req.params.id, update);
      } else {
        await idb.transact([idb.tx.initiativeEntries[req.params.id].update(update)]);
      }
      broadcast('initiative', { action: 'edit' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/initiative/:id', async (req, res) => {
    try {
      const { charId } = req.body || {};
      const isMaster = masterAuth(req);
      if (!isMaster) {
        if (!charId) return res.status(401).json({ error: 'Unauthorized' });
        const status = await charAuth(charId, req);
        if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
        const entry = DB_PROVIDER === 'localdb' ? ldb.getInitEntry(req.params.id) : (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
        if (!entry || entry.charId !== charId) return res.status(403).json({ error: 'Forbidden' });
      }
      if (DB_PROVIDER === 'localdb') {
        const state = ldb.getInitState();
        const wasCurrentTurn = state.currentId === req.params.id;
        let nextId = null;
        if (wasCurrentTurn) {
          const entries = ldb.listInitEntries();
          const idx = entries.findIndex(e => e.id === req.params.id);
          const remaining = entries.filter(e => e.id !== req.params.id);
          if (remaining.length > 0) nextId = remaining[idx % remaining.length]?.id || remaining[0].id;
        }
        ldb.deleteInitEntry(req.params.id);
        if (wasCurrentTurn) ldb.setInitState(nextId || '');
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        const entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
        const state = result.initiativeState?.[0];
        const stateId = state?.id || genId();
        const wasCurrentTurn = state?.currentId === req.params.id;
        await idb.transact([idb.tx.initiativeEntries[req.params.id].delete()]);
        if (wasCurrentTurn) {
          const idx = entries.findIndex(e => e.id === req.params.id);
          const remaining = entries.filter(e => e.id !== req.params.id);
          const nextId = remaining.length > 0 ? (remaining[idx % remaining.length]?.id || remaining[0].id) : '';
          await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: nextId })]);
        }
      }
      broadcast('initiative', { action: 'delete' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/next', async (req, res) => {
    try {
      let entries, state, stateId;
      if (DB_PROVIDER === 'localdb') {
        entries = ldb.listInitEntries();
        state   = ldb.getInitState();
        stateId = state.id;
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
        state   = result.initiativeState?.[0];
        stateId = state?.id || genId();
      }
      if (entries.length === 0) return res.json({ ok: true });
      const idx    = state?.currentId ? entries.findIndex(e => e.id === state.currentId) : -1;
      const nextId = entries[(idx + 1) % entries.length].id;
      if (DB_PROVIDER === 'localdb') {
        ldb.setInitState(nextId);
      } else {
        await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: nextId })]);
      }
      try {
        const tokList = DB_PROVIDER === 'localdb' ? ldb.getTableTokensByInitId(nextId) : (await idb.query({ tableTokens: { $: { where: { initiativeId: nextId } } } })).tableTokens || [];
        if (tokList.length > 0) {
          if (DB_PROVIDER === 'localdb') {
            for (const t of tokList) { ldb.updateTableToken(t.id, { movedFt: 0 }); broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } }); }
          } else {
            await idb.transact(tokList.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
            for (const t of tokList) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
          }
        }
      } catch {}
      broadcast('initiative', { action: 'next' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/prev', async (req, res) => {
    try {
      let entries, state, stateId;
      if (DB_PROVIDER === 'localdb') {
        entries = ldb.listInitEntries();
        state   = ldb.getInitState();
        stateId = state.id;
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
        state   = result.initiativeState?.[0];
        stateId = state?.id || genId();
      }
      if (entries.length === 0) return res.json({ ok: true });
      const idx    = state?.currentId ? entries.findIndex(e => e.id === state.currentId) : 0;
      const prevId = entries[(idx - 1 + entries.length) % entries.length].id;
      if (DB_PROVIDER === 'localdb') {
        ldb.setInitState(prevId);
      } else {
        await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: prevId })]);
      }
      try {
        const tokList = DB_PROVIDER === 'localdb' ? ldb.getTableTokensByInitId(prevId) : (await idb.query({ tableTokens: { $: { where: { initiativeId: prevId } } } })).tableTokens || [];
        if (tokList.length > 0) {
          if (DB_PROVIDER === 'localdb') {
            for (const t of tokList) { ldb.updateTableToken(t.id, { movedFt: 0 }); broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } }); }
          } else {
            await idb.transact(tokList.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
            for (const t of tokList) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
          }
        }
      } catch {}
      broadcast('initiative', { action: 'prev' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/start', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let entries, state, stateId;
      if (DB_PROVIDER === 'localdb') {
        entries = ldb.listInitEntries();
        state   = ldb.getInitState();
        stateId = state.id;
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        entries = (result.initiativeEntries || []).sort((a, b) => (b.roll || 0) - (a.roll || 0));
        state   = result.initiativeState?.[0];
        stateId = state?.id || genId();
      }
      if (entries.length === 0) return res.status(400).json({ error: 'No initiative entries' });
      const firstId = entries[0].id;
      if (DB_PROVIDER === 'localdb') {
        ldb.setInitState(firstId);
      } else {
        await idb.transact([idb.tx.initiativeState[stateId].update({ currentId: firstId })]);
      }
      broadcast('initiative', { action: 'start' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/end', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') {
        ldb.setInitState('');
      } else {
        const result = await idb.query({ initiativeState: {} });
        const state  = result.initiativeState?.[0];
        if (state?.id) await idb.transact([idb.tx.initiativeState[state.id].update({ currentId: '' })]);
      }
      broadcast('initiative', { action: 'end' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/clear', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') {
        ldb.clearInitEntries();
        ldb.setInitState('');
      } else {
        const result = await idb.query({ initiativeEntries: {}, initiativeState: {} });
        const txns = [
          ...(result.initiativeEntries || []).map(e => idb.tx.initiativeEntries[e.id].delete()),
          ...(result.initiativeState || []).map(s => idb.tx.initiativeState[s.id].delete())
        ];
        if (txns.length > 0) await idb.transact(txns);
      }
      broadcast('initiative', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/roll — player (or DM for a char) submits their roll; upserts by charId
  app.post('/api/initiative/roll', async (req, res) => {
    try {
      const { name, roll, charId } = req.body || {};
      if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });
      let existingId = null;
      if (charId) {
        const all = DB_PROVIDER === 'localdb' ? ldb.listInitEntries()
          : (await idb.query({ initiativeEntries: {} })).initiativeEntries || [];
        const existing = all.find(e => e.charId === String(charId));
        if (existing) existingId = existing.id;
      }
      if (existingId) {
        if (DB_PROVIDER === 'localdb') {
          ldb.updateInitEntry(existingId, { roll: parseInt(roll), name: String(name).trim() });
        } else {
          await idb.transact([idb.tx.initiativeEntries[existingId].update({ roll: parseInt(roll), name: String(name).trim() })]);
        }
        broadcast('initiative', { action: 'edit' });
        return res.json({ id: existingId, ok: true });
      }
      const newId = genId();
      const fields = { name: String(name).trim(), roll: parseInt(roll), charId: charId || '', monsterId: '', createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createInitEntry(newId, fields);
      } else {
        await idb.transact([idb.tx.initiativeEntries[newId].update(fields)]);
      }
      broadcast('initiative', { action: 'roll' });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/add — DM-only, creates a monster initiative entry
  app.post('/api/initiative/add', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, roll, monsterId } = req.body || {};
      if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });
      const newId = genId();
      const fields = { name: String(name).trim(), roll: parseInt(roll), charId: '', monsterId: monsterId || '', createdAt: new Date().toISOString() };
      if (DB_PROVIDER === 'localdb') {
        ldb.createInitEntry(newId, fields);
      } else {
        await idb.transact([idb.tx.initiativeEntries[newId].update(fields)]);
      }
      broadcast('initiative', { action: 'roll' });
      res.json({ id: newId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/initiative/cleanup', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let removed = 0;
      if (DB_PROVIDER === 'localdb') {
        const orphans = ldb.listOrphanMonsterInitEntries();
        for (const e of orphans) { ldb.deleteInitEntry(e.id); removed++; }
      } else {
        const result = await idb.query({ initiativeEntries: {}, tableTokens: {} });
        const tokenInitIds = new Set((result.tableTokens || []).map(t => t.initiativeId).filter(Boolean));
        const orphans = (result.initiativeEntries || []).filter(e => e.monsterId && !tokenInitIds.has(e.id));
        if (orphans.length > 0) await idb.transact(orphans.map(e => idb.tx.initiativeEntries[e.id].delete()));
        removed = orphans.length;
      }
      broadcast('initiative', { action: 'reload' });
      res.json({ ok: true, removed });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.patch('/api/initiative/:id/roll', async (req, res) => {
    try {
      const { roll } = req.body || {};
      if (roll === undefined) return res.status(400).json({ error: 'roll required' });
      let entry;
      if (DB_PROVIDER === 'localdb') {
        entry = ldb.getInitEntry(req.params.id);
      } else {
        entry = (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
      }
      if (!entry) return res.status(404).json({ error: 'Not found' });
      if (entry.monsterId && !masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (DB_PROVIDER === 'localdb') {
        ldb.updateInitEntry(req.params.id, { roll: parseInt(roll) });
      } else {
        await idb.transact([idb.tx.initiativeEntries[req.params.id].update({ roll: parseInt(roll) })]);
      }
      broadcast('initiative', { action: 'edit' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
