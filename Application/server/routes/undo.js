// Written by Irmak Hakman — 2026-11-16 14:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

import { provenCharId } from '../../lib/caller.js';

/**
 * POST /api/undo/:id — reverse an action within its undo window (lib/undo.js).
 *
 * The routes that do undoable actions register the reverse themselves and hand
 * the id back with their response. This route only checks who is asking: the
 * person who did it, or the DM of the same campaign.
 */
export default function register(app, ctx) {
  const { masterAuth, sessionAuth, undo, currentCampaignId } = ctx;

  app.post('/api/undo/:id', async (req, res) => {
    try {
      if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const isDm = masterAuth(req);
      const caller = {
        campaignId: currentCampaignId() || '',
        isDm,
        charId: isDm ? '' : await provenCharId(req, ctx),
      };
      const r = await undo.undo(req.params.id, caller);
      if (r.status !== 200) return res.status(r.status).json({ error: r.error });
      res.json({ ok: true, undone: r.label });
    } catch (err) { console.error('POST /api/undo/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
