/**
 * DM handouts.
 *
 * A handout carries two bodies — what a player reads when their skill check
 * succeeds, and what they read when it fails — plus an optional prompt shown
 * before the check resolves.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: neither body may leave the server until
 * the DM has confirmed that recipient's outcome. Hiding the wrong variant in the
 * browser is not enough — it would still sit in the JSON response for anyone who
 * opens devtools. playerObj() below builds a per-recipient payload that contains
 * only the one body that recipient has earned. This is the same leak that was
 * fixed in the treasury (GET /api/treasury/visibility, session 80); do not
 * reintroduce it by adding a convenience endpoint that returns raw rows.
 *
 * The check itself is rolled HERE, not in the browser: the player clicks a
 * neutral "Examine" button and never learns the number or even which skill was
 * tested. Rolling server-side also means a total cannot be forged.
 */

// Same order as SKILL_NAMES in public/js/lib/dnd-data.js — the stored character
// field is data['sk-<index>'].
const SKILL_NAMES = [
  'Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History',
  'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception',
  'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival',
];

const OUTCOMES = new Set(['pending', 'rolled', 'success', 'fail']);
const MAX_TEXT = 20000;

export default function register(app, ctx) {
  const {
    ldb, genId, broadcast, masterAuth, charAuth, getCharacter,
    processImageSizes, deleteUploadFile, IMAGE_MIME, MAX_MEDIA_BYTES,
    DB_PROVIDER,
  } = ctx;

  const unavailable = (res) =>
    res.status(501).json({ error: 'Handouts require DB_PROVIDER=localdb' });

  function skillName(i) {
    const n = parseInt(i);
    return (n >= 0 && n < SKILL_NAMES.length) ? SKILL_NAMES[n] : '';
  }

  function cap(v, n = MAX_TEXT) { return String(v ?? '').slice(0, n); }

  // ── Payload shaping ─────────────────────────────────────────────────────────

  /** Everything the DM sees: both bodies, the DC, and every recipient's roll. */
  function dmObj(row) {
    const recipients = ldb.listHandoutRecipients(row.id).map(r => ({
      charId: r.charId,
      rollTotal: r.rollTotal ?? null,
      rollDetail: r.rollDetail || '',
      rolledAt: r.rolledAt || '',
      outcome: r.outcome || 'pending',
      seenAt: r.seenAt || '',
      // What the DC implies, so the DM can accept it or overrule it.
      suggested: (row.checkDc > 0 && r.rollTotal != null)
        ? (r.rollTotal >= row.checkDc ? 'success' : 'fail')
        : null,
    }));
    return {
      id: row.id, title: row.title || '', tag: row.tag || '',
      promptText: row.promptText || '',
      successText: row.successText || '',
      successImageUrl: row.successImageUrl || '', successImageThumb: row.successImageThumb || '',
      successImageMedium: row.successImageMedium || '',
      failText: row.failText || '',
      failImageUrl: row.failImageUrl || '', failImageThumb: row.failImageThumb || '',
      failImageMedium: row.failImageMedium || '',
      checkSkill: row.checkSkill ?? -1,
      checkSkillName: skillName(row.checkSkill),
      checkDc: row.checkDc ?? 0,
      createdAt: row.createdAt || '',
      recipients,
      handedOut: recipients.length,
    };
  }

  /**
   * What ONE player may see. `row` is a joined handout+recipient row.
   *
   * pending / rolled  -> title and prompt only. Neither body, no DC, no skill
   *                      name (the check is blind), no roll total.
   * success           -> the success body only.
   * fail              -> the fail body only.
   */
  function playerObj(row) {
    const outcome = row.outcome || 'pending';
    const out = {
      id: row.id,
      title: row.title || '',
      tag: row.tag || '',
      promptText: row.promptText || '',
      outcome,
      requiresCheck: (row.checkSkill ?? -1) >= 0,
      // 'rolled' is deliberately reported as awaiting the DM rather than as a
      // result, so a player cannot infer pass/fail from the state alone.
      awaitingDm: outcome === 'rolled',
      canRoll: outcome === 'pending' && (row.checkSkill ?? -1) >= 0,
      seenAt: row.seenAt || '',
      createdAt: row.createdAt || '',
    };
    if (outcome === 'success') {
      out.text        = row.successText || '';
      out.imageUrl    = row.successImageUrl || '';
      out.imageThumb  = row.successImageThumb || '';
      out.imageMedium = row.successImageMedium || '';
    } else if (outcome === 'fail') {
      out.text        = row.failText || '';
      out.imageUrl    = row.failImageUrl || '';
      out.imageThumb  = row.failImageThumb || '';
      out.imageMedium = row.failImageMedium || '';
    }
    return out;
  }

  /** Body fields accepted from the DM, capped and coerced. */
  function readHandoutBody(b = {}) {
    const f = {};
    for (const k of ['title', 'tag', 'promptText', 'successText', 'failText',
                     'successImageUrl', 'successImageThumb', 'successImageMedium',
                     'failImageUrl', 'failImageThumb', 'failImageMedium']) {
      if (b[k] !== undefined) f[k] = cap(b[k], k.endsWith('Text') ? MAX_TEXT : 512);
    }
    if (b.title !== undefined) f.title = cap(b.title, 200);
    if (b.tag !== undefined)   f.tag   = cap(b.tag, 40);
    if (b.checkSkill !== undefined) {
      const n = parseInt(b.checkSkill);
      f.checkSkill = (Number.isInteger(n) && n >= 0 && n < SKILL_NAMES.length) ? n : -1;
    }
    if (b.checkDc !== undefined) {
      const n = parseInt(b.checkDc);
      f.checkDc = Number.isInteger(n) && n > 0 ? Math.min(n, 50) : 0;
    }
    return f;
  }

  // Character auth, mirroring the pattern the other player-facing routes use.
  async function requireChar(req, res) {
    const charId = req.headers['x-character-id'] || req.body?.charId || req.query.charId;
    if (!charId) { res.status(400).json({ error: 'charId required' }); return null; }
    const code = await charAuth(charId, req);
    if (code !== 200) { res.status(code).json({ error: code === 404 ? 'Character not found' : 'Unauthorized' }); return null; }
    return String(charId);
  }

  // ── DM: list / read ─────────────────────────────────────────────────────────

  app.get('/api/handouts', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (masterAuth(req)) return res.json(ldb.listHandouts().map(dmObj));

      // Player: only their own handouts, each redacted to their outcome.
      const charId = await requireChar(req, res);
      if (!charId) return;
      return res.json(ldb.listHandoutsForChar(charId).map(playerObj));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/handouts/:id', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });
      if (masterAuth(req)) return res.json(dmObj(row));

      const charId = await requireChar(req, res);
      if (!charId) return;
      const rec = ldb.getHandoutRecipient(row.id, charId);
      if (!rec) return res.status(404).json({ error: 'Handout not found' });
      res.json(playerObj({ ...row, ...rec }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM: create / update / delete ────────────────────────────────────────────

  app.post('/api/handouts', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const fields = readHandoutBody(req.body);
      if (!fields.title) return res.status(400).json({ error: 'title required' });
      const row = ldb.createHandout(genId(), fields);
      broadcast('handouts', { action: 'created', id: row.id });
      res.status(201).json(dmObj(row));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.put('/api/handouts/:id', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const existing = ldb.getHandout(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Handout not found' });
      const row = ldb.updateHandout(req.params.id, readHandoutBody(req.body));
      // Editing a body changes what an already-resolved recipient reads, so tell
      // every client to refetch rather than trusting what they hold.
      broadcast('handouts', { action: 'updated', id: row.id });
      res.json(dmObj(row));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/handouts/:id', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });
      for (const url of [row.successImageUrl, row.successImageThumb, row.successImageMedium,
                         row.failImageUrl, row.failImageThumb, row.failImageMedium]) {
        if (url) deleteUploadFile(url);
      }
      ldb.deleteHandout(row.id);
      broadcast('handouts', { action: 'deleted', id: row.id });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM: image upload ────────────────────────────────────────────────────────
  // One image per call; the client PUTs the returned urls onto the handout.
  app.post('/api/handouts/media', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const m = /^data:([^;]+);base64,(.+)$/.exec(req.body?.dataUrl || '');
      if (!m) return res.status(400).json({ error: 'dataUrl required' });
      const [, mimeType, b64] = m;
      if (!IMAGE_MIME.has(mimeType)) return res.status(400).json({ error: 'Images only' });
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'Image too large' });
      const urls = await processImageSizes(mimeType, buffer, 'handouts', genId());
      res.json({ url: urls.original, thumb: urls.thumb, medium: urls.medium });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM: hand out / recall ───────────────────────────────────────────────────

  app.post('/api/handouts/:id/hand-out', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });

      let charIds = Array.isArray(req.body?.charIds) ? req.body.charIds.map(String) : null;
      if (!charIds || !charIds.length) {
        // Default: every player character in the campaign.
        charIds = ldb.listCharacters().filter(c => (c.charType || 'pc') === 'pc').map(c => c.id);
      }
      if (!charIds.length) return res.status(400).json({ error: 'No characters to hand out to' });

      // With no check there is nothing to resolve, so the content is readable
      // immediately; otherwise the recipient waits at 'pending' for their roll.
      const startState = (row.checkSkill ?? -1) >= 0 ? 'pending' : 'success';
      for (const charId of charIds) ldb.addHandoutRecipient(genId(), row.id, charId, startState);

      broadcast('handouts', { action: 'handed-out', id: row.id, charIds });
      res.json(dmObj(ldb.getHandout(row.id)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/handouts/:id/recall', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });
      const charId = req.body?.charId ? String(req.body.charId) : null;
      if (charId) ldb.removeHandoutRecipient(row.id, charId);
      else ldb.clearHandoutRecipients(row.id);
      broadcast('handouts', { action: 'recalled', id: row.id, charId: charId || null });
      res.json(dmObj(ldb.getHandout(row.id)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Player: the blind check ─────────────────────────────────────────────────
  //
  // Rolled on the server so the total never reaches the roller's browser and
  // cannot be forged. The response carries no number — only that it happened.
  app.post('/api/handouts/:id/roll', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });

      const charId = await requireChar(req, res);
      if (!charId) return;
      const rec = ldb.getHandoutRecipient(row.id, charId);
      if (!rec) return res.status(404).json({ error: 'Handout not found' });
      if ((row.checkSkill ?? -1) < 0) return res.status(400).json({ error: 'This handout needs no check' });
      if (rec.outcome !== 'pending') return res.status(409).json({ error: 'Already rolled' });

      const character = await getCharacter(charId);
      let data = {};
      try { data = JSON.parse(character?.dataJson || '{}'); } catch {}
      // recalcDerived() keeps data['sk-<i>'] in sync with the sheet, so the
      // server already knows the modifier including equipped item bonuses.
      const mod = parseInt(String(data['sk-' + row.checkSkill] ?? '0').replace(/[^0-9+-]/g, '')) || 0;
      const die = 1 + Math.floor(Math.random() * 20);
      const total = die + mod;
      const detail = `d20(${die})${mod === 0 ? '' : (mod > 0 ? ' + ' : ' − ') + Math.abs(mod)}`;

      ldb.updateHandoutRecipient(row.id, charId, {
        rollTotal: total, rollDetail: detail, rolledAt: new Date().toISOString(), outcome: 'rolled',
      });

      // Land it in the DM's chat log. dmOnly keeps it out of every player's view
      // (chat-render.js drops dmOnly entries for non-DMs).
      try {
        const entry = {
          id: genId(), type: 'roll', sender: character?.name || 'Player',
          dice: '1d20', results: [die], modifier: mod, total,
          label: `${row.title} — ${skillName(row.checkSkill)} (hidden)`,
          dmOnly: true, timestamp: new Date().toISOString(),
        };
        ldb.appendChatLog(entry);
        broadcast('chat', entry);   // clients drop dmOnly entries for non-DMs
      } catch (err) { console.error('handout roll chat log failed', err); }

      broadcast('handouts', { action: 'rolled', id: row.id, charId });
      res.json({ ok: true });   // deliberately no total
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM: confirm the outcome ─────────────────────────────────────────────────
  // This is the only thing that makes a body readable. The DC merely suggested.
  app.patch('/api/handouts/:id/recipients/:charId', (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const row = ldb.getHandout(req.params.id);
      if (!row) return res.status(404).json({ error: 'Handout not found' });
      const rec = ldb.getHandoutRecipient(row.id, req.params.charId);
      if (!rec) return res.status(404).json({ error: 'Recipient not found' });

      const outcome = String(req.body?.outcome || '');
      if (!OUTCOMES.has(outcome)) return res.status(400).json({ error: `outcome must be one of ${[...OUTCOMES].join(', ')}` });

      // Sending a recipient back to 'pending' clears the roll so they may try
      // again — that is how a DM grants a re-roll.
      const patch = { outcome };
      if (outcome === 'pending') { patch.rollTotal = null; patch.rollDetail = ''; patch.rolledAt = ''; }
      ldb.updateHandoutRecipient(row.id, req.params.charId, patch);

      broadcast('handouts', { action: 'outcome', id: row.id, charId: req.params.charId, outcome });
      res.json(dmObj(ldb.getHandout(row.id)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Player: mark as read (clears the unread badge) ──────────────────────────
  app.post('/api/handouts/:id/seen', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return unavailable(res);
      const charId = await requireChar(req, res);
      if (!charId) return;
      const rec = ldb.getHandoutRecipient(req.params.id, charId);
      if (!rec) return res.status(404).json({ error: 'Handout not found' });
      ldb.updateHandoutRecipient(req.params.id, charId, { seenAt: new Date().toISOString() });
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
