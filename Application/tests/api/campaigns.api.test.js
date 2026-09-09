/**
 * Campaign registry + multi-tenant isolation.
 *
 * Unlike the other API suites, this one wires the REAL campaign middleware,
 * registry and per-campaign stores — an in-memory fake would not prove the
 * thing under test, which is that two campaigns cannot see each other's data.
 * Everything is redirected into a temp directory via CAMPAIGNS_DB and
 * CAMPAIGN_DATA_DIR so no real campaign is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUPER_PW = 'super-admin-pw-9876';
const A_PW = 'campaign-a-pw';
const B_PW = 'campaign-b-pw';

let tmpDir, cdb, store, ctxMod, app, campA, campB;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-campaigns-'));
  process.env.CAMPAIGNS_DB = path.join(tmpDir, 'campaigns.db');
  process.env.CAMPAIGN_DATA_DIR = path.join(tmpDir, 'campaigns');

  // Imported AFTER the env vars are set — both modules read them at load.
  cdb    = await import('../../db/campaignsdb.js');
  store  = await import('../../db/campaign-store.js');
  ctxMod = await import('../../lib/request-context.js');

  const registerCampaigns = (await import('../../server/routes/campaigns.js')).default;
  const registerMonsters  = (await import('../../server/routes/monsters.js')).default;
  const registerAuth      = (await import('../../server/routes/auth.js')).default;

  campA = cdb.createCampaign({ name: 'Campaign Alpha', description: 'first',  dmPassword: A_PW });
  campB = cdb.createCampaign({ name: 'Campaign Beta',  description: 'second', dmPassword: B_PW });

  // ── The same auth + context wiring server.js uses ──────────────────────────
  function isSuperAdminPassword(pw) {
    if (!pw || pw.length !== SUPER_PW.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(SUPER_PW)); } catch { return false; }
  }
  function isMasterPassword(pw, campaignId = ctxMod.currentCampaignId()) {
    if (!pw) return false;
    if (isSuperAdminPassword(pw)) return true;
    if (!campaignId) return false;
    return cdb.verifyDmPassword(campaignId, pw);
  }
  function resolveCampaignForReq(req) {
    const hint = req.headers['x-campaign-id']
      || (req.query && req.query.campaign)
      || (/(?:^|;\s*)campaign=([^;]*)/.exec(req.headers.cookie || '') || [])[1];
    if (hint) {
      const found = cdb.resolveCampaign(decodeURIComponent(String(hint)));
      if (found) return found;
    }
    const all = cdb.listCampaigns();
    return all.length === 1 ? all[0] : null;
  }
  function masterAuth(req) {
    const pw = req.headers['x-master-password'];
    const c = resolveCampaignForReq(req);
    return !!(pw && isMasterPassword(pw, c ? c.id : null));
  }

  app = express();
  app.use(express.json({ limit: '10mb' }));

  const CAMPAIGN_EXEMPT = [/^\/api\/config$/, /^\/api\/campaigns(\/|$)/];
  app.use((req, res, next) => {
    const campaign = resolveCampaignForReq(req);
    if (!campaign) {
      if (req.path.startsWith('/api/') && !CAMPAIGN_EXEMPT.some(re => re.test(req.path))) {
        return res.status(409).json({ error: 'No campaign selected', code: 'NO_CAMPAIGN' });
      }
      return next();
    }
    req.campaign = campaign;
    ctxMod.requestContext.run(
      { campaignId: campaign.id, campaign, data: store.getCampaignData(campaign.id) },
      next
    );
  });

  const ctx = {
    ldb: ctxMod.ldb, sdb: ctxMod.sdb,
    genId: () => crypto.randomUUID(), crypto,
    broadcast: () => {},
    masterAuth, isMasterPassword, isSuperAdminPassword,
    verifyPassword: () => false,
    getCharacter: async id => ctxMod.ldb.getCharacter(id),
    cdb, CAMPAIGN_COOKIE: 'campaign',
    IMAGE_MIME: new Set(['image/png']), MAX_MEDIA_BYTES: 25 * 1024 * 1024,
    processImageSizes: async () => ({ original: '/o.png', thumb: '/t.webp', medium: '/m.webp' }),
    deleteUploadFile: () => {},
    saveUploadFile: () => '', readUploadAsBase64: () => null,
  };
  registerCampaigns(app, ctx);
  registerAuth(app, ctx);
  registerMonsters(app, ctx);
});

afterAll(() => {
  try {
    for (const c of cdb.listCampaigns()) store.releaseCampaign(c.id);
    cdb._db.close();
  } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

const inA = req => req.set('X-Campaign-Id', campA.id);
const inB = req => req.set('X-Campaign-Id', campB.id);

describe('campaign registry', () => {
  it('lists campaigns without leaking password hashes', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.map(c => c.name).sort()).toEqual(['Campaign Alpha', 'Campaign Beta']);
    for (const c of res.body) {
      expect(c).not.toHaveProperty('dmPasswordHash');
      expect(c.hasDmPassword).toBe(true);
    }
  });

  it('resolves a campaign by slug as well as by id', async () => {
    const bySlug = await request(app).get('/api/campaigns/campaign-alpha');
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.id).toBe(campA.id);
  });

  it('reports per-campaign stats on the detail view', async () => {
    const res = await request(app).get(`/api/campaigns/${campA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ characters: 0, monsters: 0, maps: 0 });
    expect(Array.isArray(res.body.characters)).toBe(true);
  });

  it('sets the campaign cookie when entering', async () => {
    const res = await request(app).post(`/api/campaigns/${campA.id}/enter`);
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain(`campaign=${campA.id}`);
  });

  it('clears the cookie when leaving', async () => {
    const res = await request(app).post('/api/campaigns/leave');
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('campaign creation and deletion', () => {
  it('refuses to create without the super-admin password', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', A_PW)          // a campaign DM password is not enough
      .send({ name: 'Sneaky', dmPassword: 'nope123' });
    expect(res.status).toBe(401);
  });

  it('requires a name and a DM password of at least 3 characters', async () => {
    const noName = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ dmPassword: 'abc' });
    expect(noName.status).toBe(400);
    const shortPw = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ name: 'Short', dmPassword: 'ab' });
    expect(shortPw.status).toBe(400);
  });

  it('creates a campaign with a complete, empty schema', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW)
      .send({ name: 'Campaign Gamma', description: 'third', dmPassword: 'gamma-pw' });
    expect(res.status).toBe(201);
    expect(res.body.stats).toMatchObject({ characters: 0, monsters: 0, treasury: 0, stories: 0 });

    // A brand-new campaign must answer real queries, not blow up on a missing table.
    const monsters = await request(app).get('/api/monsters')
      .set('X-Campaign-Id', res.body.id).set('X-Master-Password', 'gamma-pw');
    expect(monsters.status).toBe(200);
    expect(monsters.body).toEqual([]);
  });

  it('gives duplicate names distinct slugs', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW)
      .send({ name: 'Campaign Alpha', dmPassword: 'dupe-pw' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('campaign-alpha-2');
  });

  it('refuses to delete without an exactly matching name', async () => {
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ name: 'Doomed', dmPassword: 'doom-pw' });
    const wrong = await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', SUPER_PW).send({ confirmName: 'doomed' });   // wrong case
    expect(wrong.status).toBe(400);

    const ok = await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', SUPER_PW).send({ confirmName: 'Doomed' });
    expect(ok.status).toBe(200);
    expect(cdb.getCampaign(created.body.id)).toBeNull();
  });

  it('deletes the campaign data directory', async () => {
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ name: 'Ephemeral', dmPassword: 'eph-pw' });
    const dir = store.campaignDir(created.body.id);
    expect(fs.existsSync(dir)).toBe(true);
    await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', SUPER_PW).send({ confirmName: 'Ephemeral' });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('per-campaign DM passwords', () => {
  it("accepts a campaign's own DM password", async () => {
    const res = await inA(request(app).post('/api/auth/login')).send({ type: 'dm', password: A_PW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'dm' });
  });

  it("rejects another campaign's DM password", async () => {
    const res = await inA(request(app).post('/api/auth/login')).send({ type: 'dm', password: B_PW });
    expect(res.status).toBe(401);
  });

  it('accepts the super-admin password in any campaign', async () => {
    for (const wrap of [inA, inB]) {
      const res = await wrap(request(app).post('/api/auth/login')).send({ type: 'dm', password: SUPER_PW });
      expect(res.status).toBe(200);
    }
  });

  it("rejects a DM API call carrying another campaign's password", async () => {
    const res = await inB(request(app).get('/api/monsters')).set('X-Master-Password', A_PW);
    expect(res.status).toBe(401);
  });

  it('changes the DM password and invalidates the old one', async () => {
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ name: 'Rotating', dmPassword: 'old-pw-1' });
    const id = created.body.id;

    // The old password authorises the change...
    const change = await request(app).put(`/api/campaigns/${id}/dm-password`)
      .set('X-Master-Password', 'old-pw-1').send({ newPassword: 'new-pw-2' });
    expect(change.status).toBe(200);

    // ...and stops working immediately afterwards (the verify cache must drop it).
    expect(cdb.verifyDmPassword(id, 'old-pw-1')).toBe(false);
    expect(cdb.verifyDmPassword(id, 'new-pw-2')).toBe(true);
  });
});

describe('campaign isolation', () => {
  it('keeps monsters written in one campaign out of the other', async () => {
    const write = await inA(request(app).post('/api/monsters/import'))
      .set('X-Master-Password', A_PW)
      .send({ monsters: [{ name: 'Alpha Only Goblin', cr: '1/4', data: {} }] });
    expect(write.status).toBe(200);

    const a = await inA(request(app).get('/api/monsters')).set('X-Master-Password', A_PW);
    expect(a.body.map(m => m.name)).toContain('Alpha Only Goblin');

    const b = await inB(request(app).get('/api/monsters')).set('X-Master-Password', B_PW);
    expect(b.body.map(m => m.name)).not.toContain('Alpha Only Goblin');
  });

  it('gives each campaign its own database files', () => {
    const dataA = store.getCampaignData(campA.id);
    const dataB = store.getCampaignData(campB.id);
    expect(dataA.ldb._file).not.toBe(dataB.ldb._file);
    expect(dataA.mdb._file).not.toBe(dataB.mdb._file);
    expect(dataA.sdb._file).not.toBe(dataB.sdb._file);
    expect(dataA.adb._file).not.toBe(dataB.adb._file);
  });

  it('answers 409 NO_CAMPAIGN when no campaign can be resolved', async () => {
    const res = await request(app).get('/api/monsters').set('X-Campaign-Id', 'not-a-campaign');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CAMPAIGN');
  });

  it('still serves the registry with no campaign selected', async () => {
    const res = await request(app).get('/api/campaigns').set('X-Campaign-Id', 'not-a-campaign');
    expect(res.status).toBe(200);
  });
});

describe('request context', () => {
  it('throws rather than guessing a campaign when used outside a request', () => {
    expect(() => ctxMod.ldb.listCharacters()).toThrow(/No campaign in context/);
  });

  it('rejects a campaign id that could escape the data directory', () => {
    expect(() => store.campaignDir('../../etc')).toThrow(/invalid campaign id/);
  });
});
