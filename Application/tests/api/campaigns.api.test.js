/**
 * Campaign registry + multi-tenant isolation.
 *
 * Unlike the other API suites, this one wires the REAL campaign middleware,
 * registry, per-campaign stores, session store and session gate — an
 * in-memory fake would not prove the thing under test, which is that two
 * campaigns cannot see each other's data, and that a credential from one never
 * opens the other. Everything is redirected into a temp directory via
 * CAMPAIGNS_DB and CAMPAIGN_DATA_DIR so no real campaign is touched.
 *
 * Every privileged call logs in first (captcha and all) and sends the session
 * token it gets back, exactly as the pages do since v226.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSessionStore, createSetupTickets } from '../../lib/sessions.js';
import { createCaptchaStore } from '../../lib/captcha.js';
import { createLoginGuard } from '../../lib/login-guard.js';
import { createAuth } from '../../lib/auth.js';
import { sessionGate } from '../../lib/security-middleware.js';

const SUPER_PW = 'super-admin-pw-9876';
const A_PW = 'campaign-a-pw';
const B_PW = 'campaign-b-pw';

let tmpDir, cdb, store, ctxMod, app, campA, campB, captcha, sessions;

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
    if (typeof pw !== 'string' || pw.length !== SUPER_PW.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(SUPER_PW)); } catch { return false; }
  }
  async function checkDmPassword(pw, campaignId = ctxMod.currentCampaignId()) {
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

  sessions = createSessionStore(cdb._db);
  captcha  = createCaptchaStore({ issueMaxPerIp: 100000 });
  const auth = createAuth({
    sessions,
    campaignIdFromReq: req => resolveCampaignForReq(req)?.id || null,
    getCharacter: async id => ctxMod.ldb.getCharacter(id),
  });

  app = express();
  app.use(express.json({ limit: '10mb' }));

  const CAMPAIGN_EXEMPT = [/^\/api\/config$/, /^\/api\/campaigns(\/|$)/, /^\/api\/auth\/(captcha|admin-login|logout)$/];
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
  app.use(sessionGate({ auth, exempt: [/^\/api\/auth\//] }));

  const ctx = {
    ldb: ctxMod.ldb, sdb: ctxMod.sdb,
    genId: () => crypto.randomUUID(), crypto,
    broadcast: () => {},
    masterAuth: auth.masterAuth, charAuth: auth.charAuth, auth,
    checkDmPassword, isSuperAdminPassword, superAdminEnabled: true,
    verifyPasswordAsync: async () => false,
    getCharacter: async id => ctxMod.ldb.getCharacter(id),
    sessions, setupTickets: createSetupTickets(), captcha, loginGuard: createLoginGuard(),
    audit: { record() {}, list: () => [] },
    currentCampaignId: ctxMod.currentCampaignId, TRUST_PROXY: false,
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

async function solved() {
  const r = await request(app).get('/api/auth/captcha');
  return { captchaId: r.body.id, captchaAnswer: String(captcha._answerOf(r.body.id)) };
}
async function dmLogin(campaignId, password) {
  return request(app).post('/api/auth/login').set('X-Campaign-Id', campaignId)
    .send({ type: 'dm', password, ...(await solved()) });
}
async function dmToken(campaignId, password) {
  const r = await dmLogin(campaignId, password);
  expect(r.status).toBe(200);
  return r.body.token;
}
async function adminToken() {
  const r = await request(app).post('/api/auth/admin-login').send({ password: SUPER_PW, ...(await solved()) });
  expect(r.status).toBe(200);
  return r.body.token;
}

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

  it('does not mark the cookie Secure over plain HTTP (it would never be set)', async () => {
    const res = await request(app).post(`/api/campaigns/${campA.id}/enter`);
    expect(String(res.headers['set-cookie'])).not.toContain('Secure');
  });

  it('clears the cookie when leaving', async () => {
    const res = await request(app).post('/api/campaigns/leave');
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('campaign creation and deletion', () => {
  it('refuses to create with a campaign DM session', async () => {
    const tok = await dmToken(campA.id, A_PW);   // a campaign DM is not enough
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', tok).send({ name: 'Sneaky', dmPassword: 'nope123' });
    expect(res.status).toBe(401);
  });

  it('refuses the super-admin PASSWORD where a session is expected', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', SUPER_PW).send({ name: 'Sneaky', dmPassword: 'nope123' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  it('requires a name and a DM password of at least 3 characters', async () => {
    const tok = await adminToken();
    const noName = await request(app).post('/api/campaigns')
      .set('X-Master-Password', tok).send({ dmPassword: 'abc' });
    expect(noName.status).toBe(400);
    const shortPw = await request(app).post('/api/campaigns')
      .set('X-Master-Password', tok).send({ name: 'Short', dmPassword: 'ab' });
    expect(shortPw.status).toBe(400);
  });

  it('creates a campaign with a complete, empty schema', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', await adminToken())
      .send({ name: 'Campaign Gamma', description: 'third', dmPassword: 'gamma-pw' });
    expect(res.status).toBe(201);
    expect(res.body.stats).toMatchObject({ characters: 0, monsters: 0, treasury: 0, stories: 0 });

    // A brand-new campaign must answer real queries, not blow up on a missing table.
    const monsters = await request(app).get('/api/monsters')
      .set('X-Campaign-Id', res.body.id).set('X-Master-Password', await dmToken(res.body.id, 'gamma-pw'));
    expect(monsters.status).toBe(200);
    expect(monsters.body).toEqual([]);
  });

  it('gives duplicate names distinct slugs', async () => {
    const res = await request(app).post('/api/campaigns')
      .set('X-Master-Password', await adminToken())
      .send({ name: 'Campaign Alpha', dmPassword: 'dupe-pw' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('campaign-alpha-2');
  });

  it('refuses to delete without an exactly matching name', async () => {
    const tok = await adminToken();
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', tok).send({ name: 'Doomed', dmPassword: 'doom-pw' });
    const wrong = await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', tok).send({ confirmName: 'doomed' });   // wrong case
    expect(wrong.status).toBe(400);

    const ok = await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', tok).send({ confirmName: 'Doomed' });
    expect(ok.status).toBe(200);
    expect(cdb.getCampaign(created.body.id)).toBeNull();
  });

  it('deletes the campaign data directory', async () => {
    const tok = await adminToken();
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', tok).send({ name: 'Ephemeral', dmPassword: 'eph-pw' });
    const dir = store.campaignDir(created.body.id);
    expect(fs.existsSync(dir)).toBe(true);
    await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', tok).send({ confirmName: 'Ephemeral' });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("ends the deleted campaign's sessions", async () => {
    const admin = await adminToken();
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', admin).send({ name: 'Short Lived', dmPassword: 'short-pw' });
    const dm = await dmToken(created.body.id, 'short-pw');
    await request(app).delete(`/api/campaigns/${created.body.id}`)
      .set('X-Master-Password', admin).send({ confirmName: 'Short Lived' });
    expect(sessions.resolve(dm)).toBeNull();
  });
});

describe('per-campaign DM passwords', () => {
  it("accepts a campaign's own DM password", async () => {
    const res = await dmLogin(campA.id, A_PW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'dm' });
    expect(res.body.token).toMatch(/^rpgs_/);
  });

  it("rejects another campaign's DM password", async () => {
    const res = await dmLogin(campA.id, B_PW);
    expect(res.status).toBe(401);
  });

  it('accepts the super-admin password in any campaign', async () => {
    for (const c of [campA, campB]) {
      const res = await dmLogin(c.id, SUPER_PW);
      expect(res.status).toBe(200);
    }
  });

  it("rejects a DM session from another campaign", async () => {
    const tokA = await dmToken(campA.id, A_PW);
    const res = await inB(request(app).get('/api/monsters')).set('X-Master-Password', tokA);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  it('refuses a plain DM password in the header — only sessions are credentials', async () => {
    const res = await inA(request(app).get('/api/monsters')).set('X-Master-Password', A_PW);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  it('changes the DM password, invalidates the old one and ends DM sessions', async () => {
    const created = await request(app).post('/api/campaigns')
      .set('X-Master-Password', await adminToken()).send({ name: 'Rotating', dmPassword: 'old-pw-1' });
    const id = created.body.id;
    const tok = await dmToken(id, 'old-pw-1');

    const change = await request(app).put(`/api/campaigns/${id}/dm-password`)
      .set('X-Master-Password', tok).send({ newPassword: 'new-pw-2' });
    expect(change.status).toBe(200);

    // The old password stops working immediately (the verify cache must drop it)...
    expect(await cdb.verifyDmPassword(id, 'old-pw-1')).toBe(false);
    expect(await cdb.verifyDmPassword(id, 'new-pw-2')).toBe(true);
    // ...and so does every session opened with it.
    const after = await request(app).get('/api/monsters').set('X-Campaign-Id', id).set('X-Master-Password', tok);
    expect(after.status).toBe(401);
  });
});

describe('campaign isolation', () => {
  it('keeps monsters written in one campaign out of the other', async () => {
    const tokA = await dmToken(campA.id, A_PW);
    const tokB = await dmToken(campB.id, B_PW);
    const write = await inA(request(app).post('/api/monsters/import'))
      .set('X-Master-Password', tokA)
      .send({ monsters: [{ name: 'Alpha Only Goblin', cr: '1/4', data: {} }] });
    expect(write.status).toBe(200);

    const a = await inA(request(app).get('/api/monsters')).set('X-Master-Password', tokA);
    expect(a.body.map(m => m.name)).toContain('Alpha Only Goblin');

    const b = await inB(request(app).get('/api/monsters')).set('X-Master-Password', tokB);
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
