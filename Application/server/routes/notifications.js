import { DM_RECIPIENT } from '../notify.js';

/**
 * Notifications — the reader.
 *
 * Everything here answers for exactly one viewer: the DM of this campaign, or a
 * character who proves who they are. A caller may only ever read or modify the
 * deliveries addressed to themselves, which is why every handler resolves the
 * viewer first and then uses that key — never one taken from the request body.
 */
export default function register(app, ctx) {
  const { ldb, DB_PROVIDER, masterAuth, charAuth } = ctx;

  /**
   * Who is asking? The DM password wins; otherwise a character id backed by
   * that character's password. Returns null for anyone who proved neither,
   * which is how the console screens and signed-out viewers land.
   */
  async function viewer(req) {
    if (masterAuth(req)) return DM_RECIPIENT;
    const charId = req.headers['x-character-id'];
    if (charId && (await charAuth(charId, req)) === 200) return String(charId);
    return null;
  }

  app.get('/api/notifications', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return res.json({ items: [], unread: 0 });
      const me = await viewer(req);
      if (!me) return res.status(401).json({ error: 'Unauthorized' });

      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
      const items = ldb.listNotificationsFor(me, limit).map(r => ({
        rowId: r.rowId, id: r.id, kind: r.kind, priority: r.priority,
        title: r.title, body: r.body, actorName: r.actorName,
        createdAt: r.createdAt, seen: !!r.seenAt,
        data: (() => { try { return JSON.parse(r.dataJson || '{}'); } catch { return {}; } })(),
      }));
      res.json({ items, unread: ldb.unreadNotificationCount(me) });
    } catch (err) { console.error('GET /api/notifications:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/notifications/:rowId/seen', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return res.json({ ok: true, unread: 0 });
      const me = await viewer(req);
      if (!me) return res.status(401).json({ error: 'Unauthorized' });
      // Scoped to the viewer, so passing somebody else's row id does nothing.
      ldb.markNotificationSeen(req.params.rowId, me);
      res.json({ ok: true, unread: ldb.unreadNotificationCount(me) });
    } catch (err) { console.error('POST /api/notifications/:rowId/seen:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/notifications/seen-all', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return res.json({ ok: true, unread: 0 });
      const me = await viewer(req);
      if (!me) return res.status(401).json({ error: 'Unauthorized' });
      const changed = ldb.markAllNotificationsSeen(me);
      res.json({ ok: true, changed, unread: 0 });
    } catch (err) { console.error('POST /api/notifications/seen-all:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/notifications', async (req, res) => {
    try {
      if (DB_PROVIDER !== 'localdb') return res.json({ ok: true });
      const me = await viewer(req);
      if (!me) return res.status(401).json({ error: 'Unauthorized' });
      // Only this viewer's copies go; the event itself survives for everyone
      // else it was addressed to.
      const removed = ldb.clearNotificationsFor(me);
      res.json({ ok: true, removed });
    } catch (err) { console.error('DELETE /api/notifications:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
