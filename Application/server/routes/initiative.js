export default function register(app, ctx) {
  const { ldb, idb, DB_PROVIDER, genId, masterAuth, charAuth, broadcast } = ctx;

  // GET /api/initiative — fetch all entries + current state
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

  // POST /api/initiative/entries — add or upsert an initiative entry
  // - monsters: require DM auth
  // - players (charId, no monsterId): DM or matching character auth
  // - does NOT touch currentId (mid-combat adds keep current turn)
  app.post('/api/initiative/entries', async (req, res) => {
    try {
      const { name, roll, charId, monsterId } = req.body || {};
      if (!name || roll === undefined) return res.status(400).json({ error: 'name and roll required' });

      const isMaster = masterAuth(req);

      if (monsterId) {
        if (!isMaster) return res.status(401).json({ error: 'Unauthorized' });
      } else if (charId) {
        if (!isMaster) {
          const status = await charAuth(charId, req);
          if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
        }
      }

      // Upsert by charId: one entry per character. Matches ONLY this character's
      // entry (non-empty charId), so it can never update another combatant's row.
      let entryId = null;
      if (charId) {
        let existing;
        if (DB_PROVIDER === 'localdb') {
          existing = ldb.getInitEntryByCharId(String(charId));
        } else {
          const all = (await idb.query({ initiativeEntries: {} })).initiativeEntries || [];
          existing = all.find(e => e.charId && e.charId === String(charId));
        }
        if (existing) entryId = existing.id;
      }

      if (entryId) {
        if (DB_PROVIDER === 'localdb') {
          ldb.updateInitEntry(entryId, { roll: parseInt(roll), name: String(name).trim() });
        } else {
          await idb.transact([idb.tx.initiativeEntries[entryId].update({ roll: parseInt(roll), name: String(name).trim() })]);
        }
        if (charId) _linkTokenToInitEntry(entryId, String(charId));
      } else {
        entryId = genId();
        const fields = {
          name: String(name).trim(),
          roll: parseInt(roll),
          charId: charId || '',
          monsterId: monsterId || '',
          createdAt: new Date().toISOString()
        };
        if (DB_PROVIDER === 'localdb') {
          ldb.createInitEntry(entryId, fields);
        } else {
          await idb.transact([idb.tx.initiativeEntries[entryId].update(fields)]);
        }
        if (charId) _linkTokenToInitEntry(entryId, String(charId));
      }

      broadcast('initiative', { action: 'updated' });
      res.json({ id: entryId, ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // PATCH /api/initiative/entries/:id — general update (name and/or roll), DM only
  app.patch('/api/initiative/entries/:id', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, roll } = req.body || {};
      const update = {};
      if (name !== undefined) update.name = String(name).trim();
      if (roll !== undefined) update.roll = parseInt(roll);
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No fields to update' });
      if (DB_PROVIDER === 'localdb') {
        ldb.updateInitEntry(req.params.id, update);
      } else {
        await idb.transact([idb.tx.initiativeEntries[req.params.id].update(update)]);
      }
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // PATCH /api/initiative/entries/:id/roll — update roll value for an entry
  app.patch('/api/initiative/entries/:id/roll', async (req, res) => {
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

      // Monsters: DM only. Player entries (no monsterId): anyone can update their own roll.
      const isMaster = masterAuth(req);
      if (!isMaster && entry.monsterId) return res.status(401).json({ error: 'Unauthorized' });

      if (DB_PROVIDER === 'localdb') {
        ldb.updateInitEntry(req.params.id, { roll: parseInt(roll) });
      } else {
        await idb.transact([idb.tx.initiativeEntries[req.params.id].update({ roll: parseInt(roll) })]);
      }
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // DELETE /api/initiative/entries/:id — remove an entry; auto-advance if it was the active turn
  app.delete('/api/initiative/entries/:id', async (req, res) => {
    try {
      const isMaster = masterAuth(req);
      let entry;
      if (DB_PROVIDER === 'localdb') {
        entry = ldb.getInitEntry(req.params.id);
      } else {
        entry = (await idb.query({ initiativeEntries: { $: { where: { id: req.params.id } } } })).initiativeEntries?.[0];
      }
      if (!entry) return res.status(404).json({ error: 'Not found' });

      if (!isMaster) {
        if (!entry.charId) return res.status(401).json({ error: 'Unauthorized' });
        const status = await charAuth(entry.charId, req);
        if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
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
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/start — DM starts combat; sets currentId to highest-roll entry
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

  // POST /api/initiative/next — advance to next turn; resets movedFt for incoming token
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
      _resetMovedFt(nextId);
      broadcast('initiative', { action: 'next' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/prev — go to previous turn; resets movedFt for incoming token
  app.post('/api/initiative/prev', async (req, res) => {
    try {
      // Symmetric with /next: turn control is usable during combat without master
      // auth (item 8 — Prev previously 401'd for non-DM while Next worked).
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
      _resetMovedFt(prevId);
      broadcast('initiative', { action: 'prev' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/end — DM ends combat; clears currentId
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

  // POST /api/initiative/clear — DM clears all entries and resets state
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

  // POST /api/initiative/cleanup — DM utility: remove orphaned monster entries
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
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true, removed });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Private helpers ───────────────────────────────────────────────────────────

  // Link map tokens for a character to the given initiative entry
  function _linkTokenToInitEntry(entryId, charId) {
    if (!charId || !entryId || DB_PROVIDER !== 'localdb') return;
    try {
      const toks = ldb.listTableTokens().filter(t => t.linkedId === charId && t.type !== 'monster');
      for (const tok of toks) {
        ldb.updateTableToken(tok.id, { initiativeId: entryId });
        broadcast('table', { action: 'token-updated', token: { ...tok, initiativeId: entryId } });
      }
    } catch {}
  }

  // Reset movedFt to 0 for all tokens linked to the given initiative entry
  async function _resetMovedFt(entryId) {
    try {
      const tokList = DB_PROVIDER === 'localdb'
        ? ldb.getTableTokensByInitId(entryId)
        : (await idb.query({ tableTokens: { $: { where: { initiativeId: entryId } } } })).tableTokens || [];
      if (tokList.length === 0) return;
      if (DB_PROVIDER === 'localdb') {
        for (const t of tokList) {
          ldb.updateTableToken(t.id, { movedFt: 0 });
          broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
        }
      } else {
        await idb.transact(tokList.map(t => idb.tx.tableTokens[t.id].update({ movedFt: 0 })));
        for (const t of tokList) broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
      }
    } catch {}
  }
}
