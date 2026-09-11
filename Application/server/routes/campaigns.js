/**
 * Campaign registry API.
 *
 * These are the only routes that work without a campaign in context — they are
 * how a client picks one. Everything else in the app answers 409 NO_CAMPAIGN
 * until a campaign is selected.
 *
 * Authority levels:
 *   public       list campaigns, read one, enter one (entering only sets a
 *                cookie — it grants no access; you still have to log in)
 *   campaign DM  rename / describe / re-cover their own campaign, change its
 *                own DM password
 *   super-admin  create and delete campaigns (MASTER_PASSWORD env var)
 */
export default function register(app, ctx) {
  const {
    cdb, auth, sessions, CAMPAIGN_COOKIE,
    processImageSizes, deleteUploadFile, IMAGE_MIME, MAX_MEDIA_BYTES,
    genId, crypto,
  } = ctx;

  // campaign-store is imported directly rather than through ctx: these routes
  // are the only ones that provision or destroy a campaign's files.
  let store;
  const getStore = async () => (store ||= await import('../../db/campaign-store.js'));

  // Both take a SESSION token in X-Master-Password, never a password: the forms
  // on the picker log in first (POST /api/auth/admin-login or /api/auth/login,
  // captcha and all) and send the token they get back.
  function superAuth(req) {
    return auth.isAdmin(req);
  }

  // The DM of THIS campaign, or the super-admin.
  function campaignDmAuth(req, campaignId) {
    return auth.campaignDmAuth(req, campaignId);
  }

  // Secure on HTTPS so the browser never sends it over plain HTTP; left off in
  // local dev, where it would stop the cookie being set at all.
  const cookieFlags = req => `Path=/; SameSite=Lax${req.secure ? '; Secure' : ''}`;

  // Public shape — never leaks a password hash.
  async function publicCampaign(c, { withDetail = false } = {}) {
    const out = {
      id: c.id, name: c.name, slug: c.slug, description: c.description,
      coverUrl: c.coverUrl, coverThumb: c.coverThumb, coverMedium: c.coverMedium,
      createdAt: c.createdAt, lastPlayedAt: c.lastPlayedAt,
      hasDmPassword: c.hasDmPassword,
    };
    if (!withDetail) return out;
    const cs = await getStore();
    try {
      const data = cs.getCampaignData(c.id);
      const chars = data.ldb.listCharacters();
      out.characters = chars
        .filter(ch => (ch.charType || ch.char_type || 'pc') === 'pc')
        .map(ch => ({ id: ch.id, name: ch.name, hasPassword: !!ch.passwordHash }));
      out.stats = {
        characters: out.characters.length,
        monsters:   data.ldb.listMonsters().length,
        maps:       data.ldb.listPreparedMaps().length,
        treasury:   data.ldb.listTreasuryItems().length,
        stories:    data.sdb.listStories().length,
        sizeBytes:  cs.campaignDataSize(c.id),
      };
    } catch (err) {
      console.error('[campaigns] detail failed for', c.id, err);
      out.characters = [];
      out.stats = null;
    }
    return out;
  }

  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/api/campaigns', async (req, res) => {
    try {
      const list = cdb.listCampaigns();
      res.json(await Promise.all(list.map(c => publicCampaign(c))));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Detail ──────────────────────────────────────────────────────────────────
  app.get('/api/campaigns/:id', async (req, res) => {
    try {
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      res.json(await publicCampaign(c, { withDetail: true }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Enter (select) ──────────────────────────────────────────────────────────
  // Sets the campaign cookie every later request is scoped by. Deliberately
  // grants nothing: the campaign's own login still has to succeed.
  app.post('/api/campaigns/:id/enter', async (req, res) => {
    try {
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      // Not HttpOnly: the frontend reads it to show which campaign is active.
      // It carries no authority, so exposing it to script costs nothing.
      res.setHeader('Set-Cookie',
        `${CAMPAIGN_COOKIE}=${encodeURIComponent(c.id)}; Max-Age=31536000; ${cookieFlags(req)}`);
      cdb.touchCampaign(c.id);
      res.json(await publicCampaign(c, { withDetail: true }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Leave ───────────────────────────────────────────────────────────────────
  app.post('/api/campaigns/leave', (req, res) => {
    res.setHeader('Set-Cookie', `${CAMPAIGN_COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    res.json({ ok: true });
  });

  // ── Create (super-admin) ────────────────────────────────────────────────────
  app.post('/api/campaigns', async (req, res) => {
    try {
      if (!superAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, description, dmPassword } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
      if (!dmPassword || String(dmPassword).length < 3) {
        return res.status(400).json({ error: 'dmPassword required (min 3 characters)' });
      }
      const c = cdb.createCampaign({ name, description, dmPassword });
      // Opening the databases is what provisions them — every table is created
      // from the current schema, so a new campaign starts empty but complete.
      const cs = await getStore();
      cs.getCampaignData(c.id);
      res.status(201).json(await publicCampaign(c, { withDetail: true }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Update (campaign DM or super-admin) ─────────────────────────────────────
  app.put('/api/campaigns/:id', async (req, res) => {
    try {
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      if (!campaignDmAuth(req, c.id)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, description, isActive, sortOrder } = req.body || {};
      const patch = {};
      if (name != null)        patch.name = name;
      if (description != null) patch.description = description;
      if (isActive != null)    patch.isActive = isActive;
      if (sortOrder != null)   patch.sortOrder = sortOrder;
      const updated = cdb.updateCampaign(c.id, patch);
      res.json(await publicCampaign(updated, { withDetail: true }));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Change DM password ──────────────────────────────────────────────────────
  // A DM session for this campaign authorises the change; a super-admin session
  // is the recovery path when the password has been forgotten. Every DM session
  // of the campaign then ends — whoever knew the old password is out.
  app.put('/api/campaigns/:id/dm-password', (req, res) => {
    try {
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      if (!campaignDmAuth(req, c.id)) return res.status(401).json({ error: 'Unauthorized' });
      const { newPassword } = req.body || {};
      if (!newPassword || String(newPassword).length < 3) {
        return res.status(400).json({ error: 'newPassword required (min 3 characters)' });
      }
      cdb.setDmPassword(c.id, String(newPassword));
      const ended = sessions.revokeCampaignRole(c.id, 'dm');
      res.json({ ok: true, sessionsEnded: ended });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Cover image (campaign DM or super-admin) ────────────────────────────────
  app.post('/api/campaigns/:id/cover', async (req, res) => {
    try {
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      if (!campaignDmAuth(req, c.id)) return res.status(401).json({ error: 'Unauthorized' });
      const { dataUrl } = req.body || {};
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
      if (!m) return res.status(400).json({ error: 'dataUrl required' });
      const [, mimeType, b64] = m;
      if (!IMAGE_MIME.has(mimeType)) return res.status(400).json({ error: 'Images only' });
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'Image too large' });

      const urls = await processImageSizes(mimeType, buffer, 'campaigns', genId());
      // Replacing a cover must not orphan the old files.
      for (const old of [c.coverUrl, c.coverThumb, c.coverMedium]) if (old) deleteUploadFile(old);
      const updated = cdb.updateCampaign(c.id, {
        coverUrl: urls.original, coverThumb: urls.thumb, coverMedium: urls.medium,
      });
      res.json(await publicCampaign(updated));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Delete (super-admin, name confirmation) ─────────────────────────────────
  // Destroys every database file for the campaign. Uploaded images under
  // public/uploads/ are shared across campaigns and are intentionally left
  // alone — their filenames are UUIDs, so they are orphaned, never mixed up.
  app.delete('/api/campaigns/:id', async (req, res) => {
    try {
      if (!superAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const c = cdb.resolveCampaign(req.params.id);
      if (!c) return res.status(404).json({ error: 'Campaign not found' });
      const confirm = req.body?.confirmName ?? req.query.confirmName;
      if (String(confirm || '') !== c.name) {
        return res.status(400).json({ error: 'confirmName must match the campaign name exactly' });
      }
      if (cdb.listCampaigns().length <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last campaign' });
      }
      const cs = await getStore();
      cs.destroyCampaignData(c.id);
      cdb.deleteCampaign(c.id);
      sessions.revokeCampaign(c.id);
      res.json({ ok: true, deleted: c.id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Who am I scoped to? ─────────────────────────────────────────────────────
  // Lets any page check the active campaign (and detect a cleared cookie)
  // without guessing from its own state.
  app.get('/api/campaign/current', async (req, res) => {
    const c = req.campaign || null;
    if (!c) return res.status(409).json({ error: 'No campaign selected', code: 'NO_CAMPAIGN' });
    res.json(await publicCampaign(c));
  });
}
