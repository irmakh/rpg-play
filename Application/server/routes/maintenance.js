/**
 * Maintenance: who is locked out of logging in, and lifting a lock early.
 *
 * Lockouts (lib/login-guard.js) end by themselves — a minute at first, doubling
 * to 30 — but at the table that can be too long: a player who mistyped five
 * times, or everyone behind one home connection after a bad run, would sit it
 * out. These routes let the super-admin see every live lock and lift it.
 *
 * Super-admin only, like the rest of /api/maintenance/*: locks span campaigns.
 * The clients and reload routes still live in server.js.
 */
export default function register(app, ctx) {
  const { auth, loginGuard, audit, cdb, characterName } = ctx;

  const campaignName = id => {
    try { return (id && cdb.getCampaign(id)?.name) || ''; } catch { return ''; }
  };

  /**
   * An account key in words.
   *   ''                       -> Whole address
   *   'admin'                  -> Admin password
   *   'dm:<campaign>'          -> DM of <campaign>
   *   'stories:<campaign>'     -> Stories page in <campaign>
   *   'char:<campaign>:<char>' -> <character> in <campaign>
   */
  function describe(account) {
    const a = String(account || '');
    const base = { campaignId: '', campaignName: '', charName: '' };
    if (!a) return { ...base, scope: 'Whole address' };
    if (a === 'admin') return { ...base, scope: 'Admin password' };
    const [kind, cid = '', charId = ''] = a.split(':');
    const cname = campaignName(cid);
    const where = cname || 'a deleted campaign';
    if (kind === 'dm') return { ...base, campaignId: cid, campaignName: cname, scope: `DM of ${where}` };
    if (kind === 'stories') return { ...base, campaignId: cid, campaignName: cname, scope: `Stories page in ${where}` };
    if (kind === 'char') {
      // Only look a character up in a campaign that still exists: opening a
      // deleted campaign's database would create it all over again.
      let name = '';
      if (cname) { try { name = characterName(cid, charId) || ''; } catch { name = ''; } }
      return { campaignId: cid, campaignName: cname, charName: name, scope: `${name || 'A character'} in ${where}` };
    }
    return { ...base, scope: a };
  }

  // ── Every live lock, in words ───────────────────────────────────────────────
  app.get('/api/maintenance/blocked', (req, res) => {
    if (!auth.isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const locks = loginGuard.listLocks().map(l => {
      let last = null;
      try { last = audit.lastForIp ? audit.lastForIp(l.ip) : null; } catch { last = null; }
      return {
        ...l,
        ...describe(l.account),
        lastUserAgent: last?.userAgent || '',
        lastAttemptKind: last?.kind || '',
      };
    });
    res.set('Cache-Control', 'no-store');
    res.json({ now: Date.now(), locks });
  });

  // ── Lift a lock ─────────────────────────────────────────────────────────────
  //   { ip, account }  that one account from that address
  //   { ip }           the whole address, and every account lock on it
  app.post('/api/maintenance/unblock', (req, res) => {
    if (!auth.isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const ip = String(req.body?.ip || '').slice(0, 64);
    const account = req.body?.account ? String(req.body.account).slice(0, 200) : '';
    if (!ip) return res.status(400).json({ error: 'ip required' });

    const removed = loginGuard.unlock(account ? { ip, account } : { ip });
    const d = describe(account);
    // Recorded against the address that was unblocked; `charName` carries what
    // was lifted, which is what the Login activity list shows as "who".
    try {
      audit.record({
        kind: 'unblocked', role: 'admin', ip, campaignId: d.campaignId,
        charName: d.scope, userAgent: String(req.headers['user-agent'] || ''),
      });
    } catch {}
    res.json({ ok: true, removed });
  });

  // ── Login activity, one page at a time ─────────────────────────────────────
  // The log keeps up to 5,000 events (30 days); the page asks for one page, so
  // it never travels whole. ?page=1&pageSize=50 — a page past the end answers
  // with the last page rather than an empty one.
  const PAGE_MIN = 10, PAGE_MAX = 200, PAGE_DEFAULT = 50;

  app.get('/api/maintenance/auth-events', (req, res) => {
    if (!auth.isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    const pageSize = Math.min(PAGE_MAX, Math.max(PAGE_MIN, parseInt(req.query.pageSize, 10) || PAGE_DEFAULT));
    const total = audit.count();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    const names = Object.fromEntries((cdb.listCampaigns({ includeInactive: true }) || []).map(c => [c.id, c.name]));
    const events = audit.list({ limit: pageSize, offset: (page - 1) * pageSize })
      .map(e => ({ ...e, campaignName: names[e.campaignId] || '' }));
    res.set('Cache-Control', 'no-store');
    res.json({ events, page, pageSize, total, pages });
  });
}
