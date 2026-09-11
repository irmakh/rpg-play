/**
 * Blocked addresses on the maintenance page: GET /api/maintenance/blocked and
 * POST /api/maintenance/unblock (server/routes/maintenance.js), on the real
 * login guard, session store and auth checks.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSessionStore } from '../../lib/sessions.js';
import { createLoginGuard } from '../../lib/login-guard.js';
import { createAuth } from '../../lib/auth.js';
import registerMaintenance from '../../server/routes/maintenance.js';

const IP = '10.0.0.7';

function setup() {
  const sessions = createSessionStore(new Database(':memory:'));
  const loginGuard = createLoginGuard();
  const auth = createAuth({ sessions, campaignIdFromReq: () => null, getCharacter: async () => null });
  const recorded = [];
  const nameLookups = [];
  const campaigns = { 'camp-1': { id: 'camp-1', name: 'Glory of Amn' } };
  // 57 logged events, newest first — as listAuthEvents returns them.
  const events = Array.from({ length: 57 }, (_, i) => ({ id: 57 - i, kind: 'login', campaignId: 'camp-1' }));
  const ctx = {
    auth, loginGuard,
    audit: {
      list: ({ limit, offset = 0 }) => events.slice(offset, offset + limit),
      count: () => events.length,
      record: (e) => { recorded.push(e); },
      lastForIp: (ip) => (ip === IP ? { ts: 1, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/153.0', kind: 'login-fail' } : null),
    },
    cdb: { getCampaign: (id) => campaigns[id] || null, listCampaigns: () => Object.values(campaigns) },
    characterName: (cid, charId) => { nameLookups.push(cid); return cid === 'camp-1' && charId === 'ch-1' ? 'Aliyr' : ''; },
  };
  const app = express();
  app.use(express.json());
  registerMaintenance(app, ctx);
  return {
    app, loginGuard, recorded, nameLookups,
    admin: sessions.create({ role: 'admin' }).token,
    dm: sessions.create({ role: 'dm', campaignId: 'camp-1' }).token,
  };
}

const lockOut = (g, ip, account) => { for (let i = 0; i < 5; i++) g.fail(ip, account); };

describe('who may use it', () => {
  it('needs a super-admin session — not nothing, not a campaign DM', async () => {
    const { app, dm } = setup();
    expect((await request(app).get('/api/maintenance/blocked')).status).toBe(401);
    expect((await request(app).get('/api/maintenance/blocked').set('X-Master-Password', dm)).status).toBe(401);
    expect((await request(app).post('/api/maintenance/unblock').set('X-Master-Password', dm).send({ ip: IP })).status).toBe(401);
  });
});

describe('GET /api/maintenance/blocked', () => {
  it('lists a lock in words, with its details', async () => {
    const { app, loginGuard, admin } = setup();
    lockOut(loginGuard, IP, 'char:camp-1:ch-1');
    const res = await request(app).get('/api/maintenance/blocked').set('X-Master-Password', admin);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.locks).toEqual([expect.objectContaining({
      kind: 'pair', ip: IP, account: 'char:camp-1:ch-1',
      scope: 'Aliyr in Glory of Amn', campaignName: 'Glory of Amn', charName: 'Aliyr',
      timesLocked: 1, failures: 5, lastAttemptKind: 'login-fail',
    })]);
    expect(res.body.locks[0].lastUserAgent).toContain('Chrome/153');
  });

  it('names every kind of account, and never opens a deleted campaign', async () => {
    const { app, loginGuard, admin, nameLookups } = setup();
    lockOut(loginGuard, IP, 'dm:camp-1');
    lockOut(loginGuard, IP, 'admin');
    lockOut(loginGuard, IP, 'stories:camp-1');
    lockOut(loginGuard, IP, 'char:gone:x');
    const res = await request(app).get('/api/maintenance/blocked').set('X-Master-Password', admin);
    expect(res.body.locks.map(l => l.scope).sort()).toEqual([
      'A character in a deleted campaign', 'Admin password', 'DM of Glory of Amn', 'Stories page in Glory of Amn',
    ]);
    expect(nameLookups).not.toContain('gone');
  });

  it('shows a whole-address lock', async () => {
    const { app, loginGuard, admin } = setup();
    for (let n = 0; n < 5; n++) lockOut(loginGuard, IP, `char:camp-1:c${n}`);   // 25 on one address
    const res = await request(app).get('/api/maintenance/blocked').set('X-Master-Password', admin);
    expect(res.body.locks).toContainEqual(expect.objectContaining({ kind: 'ip', ip: IP, scope: 'Whole address', account: '' }));
  });

  it('is empty when nobody is locked out', async () => {
    const { app, admin } = setup();
    const res = await request(app).get('/api/maintenance/blocked').set('X-Master-Password', admin);
    expect(res.body.locks).toEqual([]);
  });
});

describe('GET /api/maintenance/auth-events (paged)', () => {
  const page = (app, token, q = '') =>
    request(app).get(`/api/maintenance/auth-events${q}`).set('X-Master-Password', token);
  const ids = res => res.body.events.map(e => e.id);

  it('needs a super-admin session', async () => {
    const { app, dm } = setup();
    expect((await request(app).get('/api/maintenance/auth-events')).status).toBe(401);
    expect((await page(app, dm)).status).toBe(401);
  });

  it('gives the newest page first, 50 by default, with the totals', async () => {
    const { app, admin } = setup();
    const res = await page(app, admin);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ page: 1, pageSize: 50, total: 57, pages: 2 });
    expect(ids(res)[0]).toBe(57);
    expect(res.body.events).toHaveLength(50);
    expect(res.body.events[0].campaignName).toBe('Glory of Amn');
  });

  it('carries on where the last page stopped', async () => {
    const { app, admin } = setup();
    const res = await page(app, admin, '?page=2');
    expect(res.body.page).toBe(2);
    expect(ids(res)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('honours the page size', async () => {
    const { app, admin } = setup();
    const res = await page(app, admin, '?page=3&pageSize=10');
    expect(res.body).toMatchObject({ page: 3, pageSize: 10, pages: 6 });
    expect(ids(res)).toEqual([37, 36, 35, 34, 33, 32, 31, 30, 29, 28]);
  });

  it('answers a page past the end with the last page', async () => {
    const { app, admin } = setup();
    const res = await page(app, admin, '?page=99');
    expect(res.body.page).toBe(2);
    expect(ids(res)[0]).toBe(7);
  });

  it('keeps the page size between 10 and 200', async () => {
    const { app, admin } = setup();
    expect((await page(app, admin, '?pageSize=1')).body.pageSize).toBe(10);
    const big = await page(app, admin, '?pageSize=5000');
    expect(big.body).toMatchObject({ pageSize: 200, pages: 1 });
    expect(big.body.events).toHaveLength(57);
  });
});

describe('POST /api/maintenance/unblock', () => {
  it('lifts one account and records who was unblocked', async () => {
    const { app, loginGuard, admin, recorded } = setup();
    lockOut(loginGuard, IP, 'char:camp-1:ch-1');
    const res = await request(app).post('/api/maintenance/unblock')
      .set('X-Master-Password', admin).send({ ip: IP, account: 'char:camp-1:ch-1' });
    expect(res.body).toEqual({ ok: true, removed: 1 });
    expect(loginGuard.check(IP, 'char:camp-1:ch-1').locked).toBe(false);
    expect(recorded).toContainEqual(expect.objectContaining({
      kind: 'unblocked', role: 'admin', ip: IP, campaignId: 'camp-1', charName: 'Aliyr in Glory of Amn',
    }));
  });

  it('lifts a whole address and every account lock on it', async () => {
    const { app, loginGuard, admin } = setup();
    for (let n = 0; n < 5; n++) lockOut(loginGuard, IP, `char:camp-1:c${n}`);
    const res = await request(app).post('/api/maintenance/unblock').set('X-Master-Password', admin).send({ ip: IP });
    expect(res.body).toEqual({ ok: true, removed: 6 });
    const after = await request(app).get('/api/maintenance/blocked').set('X-Master-Password', admin);
    expect(after.body.locks).toEqual([]);
  });

  it('needs an address', async () => {
    const { app, admin } = setup();
    expect((await request(app).post('/api/maintenance/unblock').set('X-Master-Password', admin).send({})).status).toBe(400);
  });
});
