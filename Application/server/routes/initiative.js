export default function register(app, ctx) {
  const { ldb, genId, masterAuth, charAuth, broadcast } = ctx;

  // GET /api/initiative — fetch all entries + current state
  app.get('/api/initiative', async (req, res) => {
    try {
      const entries = ldb.listInitEntries();
      const state   = ldb.getInitState();
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
        const existing = ldb.getInitEntryByCharId(String(charId));
        if (existing) entryId = existing.id;
      }

      if (entryId) {
        ldb.updateInitEntry(entryId, { roll: parseInt(roll), name: String(name).trim() });
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
        ldb.createInitEntry(entryId, fields);
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
      ldb.updateInitEntry(req.params.id, update);
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // PATCH /api/initiative/entries/:id/roll — update roll value for an entry
  app.patch('/api/initiative/entries/:id/roll', async (req, res) => {
    try {
      const { roll } = req.body || {};
      if (roll === undefined) return res.status(400).json({ error: 'roll required' });

      const entry = ldb.getInitEntry(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Not found' });

      // Monsters: DM only. Player entries (no monsterId): anyone can update their own roll.
      const isMaster = masterAuth(req);
      if (!isMaster && entry.monsterId) return res.status(401).json({ error: 'Unauthorized' });

      ldb.updateInitEntry(req.params.id, { roll: parseInt(roll) });
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // DELETE /api/initiative/entries/:id — remove an entry; auto-advance if it was the active turn
  app.delete('/api/initiative/entries/:id', async (req, res) => {
    try {
      const isMaster = masterAuth(req);
      const entry = ldb.getInitEntry(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Not found' });

      if (!isMaster) {
        if (!entry.charId) return res.status(401).json({ error: 'Unauthorized' });
        const status = await charAuth(entry.charId, req);
        if (status !== 200) return res.status(status).json({ error: 'Unauthorized' });
      }

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
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/start — DM starts combat; sets currentId to highest-roll entry
  app.post('/api/initiative/start', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const entries = ldb.listInitEntries();
      const state   = ldb.getInitState();
      if (entries.length === 0) return res.status(400).json({ error: 'No initiative entries' });
      const firstId = entries[0].id;
      ldb.setInitState(firstId);
      broadcast('initiative', { action: 'start' });
      ctx.notify?.({
        to: 'players', kind: 'combat-started', priority: 'alert',
        title: 'Combat has started', body: 'Initiative is rolling.',
        data: { href: '/table.html' },
      });
      notifyTurn(entries.find(e => e.id === firstId));
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/next — advance to next turn; resets movedFt for incoming token
  app.post('/api/initiative/next', async (req, res) => {
    try {
      const entries = ldb.listInitEntries();
      const state   = ldb.getInitState();
      if (entries.length === 0) return res.json({ ok: true });
      const idx    = state?.currentId ? entries.findIndex(e => e.id === state.currentId) : -1;
      const nextId = entries[(idx + 1) % entries.length].id;
      ldb.setInitState(nextId);
      _resetMovedFt(nextId);
      broadcast('initiative', { action: 'next' });
      notifyTurn(entries.find(e => e.id === nextId));
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/prev — go to previous turn; resets movedFt for incoming token
  app.post('/api/initiative/prev', async (req, res) => {
    try {
      // Symmetric with /next: turn control is usable during combat without master
      // auth (item 8 — Prev previously 401'd for non-DM while Next worked).
      const entries = ldb.listInitEntries();
      const state   = ldb.getInitState();
      if (entries.length === 0) return res.json({ ok: true });
      const idx    = state?.currentId ? entries.findIndex(e => e.id === state.currentId) : 0;
      const prevId = entries[(idx - 1 + entries.length) % entries.length].id;
      ldb.setInitState(prevId);
      _resetMovedFt(prevId);
      broadcast('initiative', { action: 'prev' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/end — DM ends combat; clears currentId
  app.post('/api/initiative/end', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      ldb.setInitState('');
      broadcast('initiative', { action: 'end' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/clear — DM clears all entries and resets state
  app.post('/api/initiative/clear', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      ldb.clearInitEntries();
      ldb.setInitState('');
      broadcast('initiative', { action: 'clear' });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/initiative/cleanup — DM utility: remove orphaned monster entries
  app.post('/api/initiative/cleanup', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let removed = 0;
      for (const e of ldb.listOrphanMonsterInitEntries()) { ldb.deleteInitEntry(e.id); removed++; }
      broadcast('initiative', { action: 'updated' });
      res.json({ ok: true, removed });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Private helpers ───────────────────────────────────────────────────────────

  // Link map tokens for a character to the given initiative entry
  function _linkTokenToInitEntry(entryId, charId) {
    if (!charId || !entryId) return;
    try {
      const toks = ldb.listTableTokens().filter(t => t.linkedId === charId && t.type !== 'monster');
      for (const tok of toks) {
        ldb.updateTableToken(tok.id, { initiativeId: entryId });
        broadcast('table', { action: 'token-updated', token: { ...tok, initiativeId: entryId } });
      }
    } catch {}
  }

  /**
   * Tell whoever is up that it is their turn. Only entries tied to a character
   * reach anyone — a goblin's turn belongs to the DM, who is watching the
   * tracker anyway.
   */
  function notifyTurn(entry) {
    if (!entry || !entry.charId) return;
    ctx.notify?.({
      to: entry.charId, kind: 'your-turn', priority: 'alert',
      title: "It's your turn", body: entry.name ? entry.name + ' is up.' : 'You are up in initiative.',
      data: { href: '/table.html' },
    });
  }

  // Reset movedFt to 0 for all tokens linked to the given initiative entry
  async function _resetMovedFt(entryId) {
    try {
      for (const t of ldb.getTableTokensByInitId(entryId)) {
        ldb.updateTableToken(t.id, { movedFt: 0 });
        broadcast('table', { action: 'token-updated', token: { ...t, movedFt: 0 } });
      }
    } catch {}
  }
}
