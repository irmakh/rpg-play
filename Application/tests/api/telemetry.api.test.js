// Written by Irmak Hakman — 2026-09-27 18:14
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Install reporting end to end: the reporter (lib/telemetry.js), the collector
 * route (server/routes/telemetry.js), the registry tables it writes
 * (db/campaignsdb.js) and the maintenance list that reads them — on a real
 * registry database in a temp file.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createSessionStore } from '../../lib/sessions.js';
import { createAuth } from '../../lib/auth.js';
import registerMaintenance from '../../server/routes/maintenance.js';
import registerTelemetry, { cleanReport, collectorKeyValid } from '../../server/routes/telemetry.js';
import { hashPassword } from '../../lib/passwords.js';
import {
  telemetryEnabled, buildPayload, sendReport, startTelemetry, createHostTracker,
} from '../../lib/telemetry.js';

let cdb, tmpDir;
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-telemetry-'));
  process.env.CAMPAIGNS_DB = path.join(tmpDir, 'campaigns.db');
  cdb = await import('../../db/campaignsdb.js');   // opens the registry at load
});

afterAll(() => {
  try { cdb._db.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function collectorApp({ collector = true } = {}) {
  const sessions = createSessionStore(new Database(':memory:'));
  const auth = createAuth({ sessions, campaignIdFromReq: () => null, getCharacter: async () => null });
  const ctx = { auth, sessions, cdb, TRUST_PROXY: false, telemetryCollector: collector,
                loginGuard: {}, audit: {}, characterName: () => '' };
  const app = express();
  app.use(express.json());
  registerMaintenance(app, ctx);
  if (collector) registerTelemetry(app, ctx);
  return {
    app,
    admin: sessions.create({ role: 'admin' }).token,
    dm: sessions.create({ role: 'dm', campaignId: 'c1' }).token,
  };
}

const deps = over => ({
  getInstallId: () => ID, countCampaigns: () => 2, countCharacters: () => 9,
  countActiveUsers: () => 4, hosts: () => ['rpg.example.com'], version: 243, ...over,
});

describe('reporter', () => {
  it('is on by default and off for TELEMETRY=off/0/false/no', () => {
    expect(telemetryEnabled({})).toBe(true);
    for (const v of ['off', 'OFF', '0', 'false', 'no']) expect(telemetryEnabled({ TELEMETRY: v })).toBe(false);
  });

  it('sends exactly the documented fields and nothing else', () => {
    const p = buildPayload(deps());
    expect(Object.keys(p).sort()).toEqual(
      ['activeUsers7d', 'campaigns', 'characters', 'hosts', 'installId', 'kind', 'node', 'platform', 'version']);
    expect(p).toMatchObject({ installId: ID, kind: 'server', version: '243', campaigns: 2, characters: 9, activeUsers7d: 4 });
  });

  it('a failing count becomes null instead of throwing', () => {
    const p = buildPayload(deps({ countCharacters: () => { throw new Error('db gone'); } }));
    expect(p.characters).toBeNull();
  });

  it('a network failure resolves false, never throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(sendReport('https://x.invalid', {}, { fetchImpl })).resolves.toBe(false);
  });

  it('switched off: logs nothing, schedules nothing, sends nothing', () => {
    const fetchImpl = vi.fn(); const log = vi.fn();
    expect(startTelemetry(deps(), { env: { TELEMETRY: 'off' }, fetchImpl, log })).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('switched on: announces itself and posts to TELEMETRY_URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }); const log = vi.fn();
    const stop = startTelemetry(deps(), { env: { TELEMETRY_URL: 'http://collector.test/' }, fetchImpl, log, firstDelayMs: 1 });
    await new Promise(r => setTimeout(r, 30));
    stop();
    expect(log.mock.calls[0][0]).toMatch(/TELEMETRY=off/);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://collector.test/api/telemetry/ping');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).installId).toBe(ID);
  });

  it('host tracker keeps at most five distinct hosts, lower-cased', () => {
    const t = createHostTracker();
    for (const h of ['A.example', 'a.example', 'b', 'c', 'd', 'e', 'f']) t.middleware({ headers: { host: h } }, {}, () => {});
    expect(t.list()).toEqual(['a.example', 'b', 'c', 'd', 'e']);
  });
});

describe('registry', () => {
  it('install id is made once and then kept', () => {
    const a = cdb.getInstallId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(cdb.getInstallId()).toBe(a);
  });

  it('active accounts counts each successful login account once, within the window', () => {
    const now = Date.now();
    cdb.recordAuthEvent({ kind: 'login', role: 'character', campaignId: 'c1', charId: 'x', ts: now - 1000 });
    cdb.recordAuthEvent({ kind: 'login', role: 'character', campaignId: 'c1', charId: 'x', ts: now - 2000 });
    cdb.recordAuthEvent({ kind: 'login-as-dm', role: 'dm', campaignId: 'c1', ts: now - 3000 });
    cdb.recordAuthEvent({ kind: 'login-fail', role: 'character', campaignId: 'c1', charId: 'y', ts: now - 1000 });
    cdb.recordAuthEvent({ kind: 'login', role: 'character', campaignId: 'c1', charId: 'z', ts: now - 8 * 86400000 });
    expect(cdb.countActiveAccounts(7, now)).toBe(2);
  });
});

describe('collector', () => {
  it('switches on only for the key matching the hash — "on" or a wrong key does not', () => {
    const hash = hashPassword('the-right-key');
    expect(collectorKeyValid('the-right-key', hash)).toBe(true);
    expect(collectorKeyValid(' the-right-key ', hash)).toBe(true);
    for (const k of [undefined, '', 'on', 'the-right-kex']) expect(collectorKeyValid(k, hash)).toBe(false);
    expect(collectorKeyValid('on')).toBe(false);   // the built-in hash
  });

  it('when off, the route does not exist and the installs list is empty and flagged off', async () => {
    const { app, admin } = collectorApp({ collector: false });
    const list = await request(app).get('/api/maintenance/installs').set('X-Master-Password', admin);
    expect(list.body).toMatchObject({ collector: false, installs: [] });
    expect((await request(app).post('/api/telemetry/ping').send({ installId: ID, kind: 'server' })).status).toBe(404);
  });

  it('refuses anything that is not a report', () => {
    expect(cleanReport(null)).toBeNull();
    expect(cleanReport({ installId: 'nope', kind: 'server' })).toBeNull();
    expect(cleanReport({ installId: ID, kind: 'toaster' })).toBeNull();
  });

  it('cuts every field to size and drops bad counts', () => {
    const r = cleanReport({ installId: ID.toUpperCase(), kind: 'server', version: 'v'.repeat(500),
      campaigns: -1, characters: 1.5, activeUsers7d: '3', hosts: ['A', 'b', 'c', 'd', 'e', 'f', 'g'], extra: 'x' });
    expect(r.installId).toBe(ID);
    expect(r.version.length).toBe(32);
    expect([r.campaigns, r.characters, r.activeUsers7d]).toEqual([null, null, null]);
    expect(r.hosts).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r).not.toHaveProperty('extra');
  });

  it('stores one row per install, counting reports; the list is super-admin only', async () => {
    const { app, admin, dm } = collectorApp();
    const body = { installId: ID, kind: 'server', version: '243', campaigns: 1, hosts: ['rpg.example.com'] };
    expect((await request(app).post('/api/telemetry/ping').send(body)).status).toBe(200);
    expect((await request(app).post('/api/telemetry/ping').send({ ...body, campaigns: 3 })).status).toBe(200);
    expect((await request(app).post('/api/telemetry/ping').send({ kind: 'server' })).status).toBe(400);

    expect((await request(app).get('/api/maintenance/installs')).status).toBe(401);
    expect((await request(app).get('/api/maintenance/installs').set('X-Master-Password', dm)).status).toBe(401);
    const res = await request(app).get('/api/maintenance/installs').set('X-Master-Password', admin);
    expect(res.status).toBe(200);
    expect(res.body.collector).toBe(true);
    const row = res.body.installs.find(i => i.installId === ID);
    expect(row).toMatchObject({ pingCount: 2, campaigns: 3, hosts: ['rpg.example.com'], kind: 'server' });
  });

  it('rate-limits one address to 30 reports an hour', async () => {
    const { app } = collectorApp();
    const other = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    let last;
    for (let i = 0; i < 31; i++) last = await request(app).post('/api/telemetry/ping').send({ installId: other, kind: 'desktop' });
    expect(last.status).toBe(429);
  });
});
