// Written by Irmak Hakman — 2026-11-12 12:49
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Official monsters (server/routes/official-monsters.js, and what monsters.js
 * and monster-cast.js do with them) on the REAL openCampaignDb(':memory:').
 * The 5etools download is a stub. X-Test-Role 'dm' is the DM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerOfficial from '../../server/routes/official-monsters.js';
import registerMonsters from '../../server/routes/monsters.js';
import registerMonsterCast from '../../server/routes/monster-cast.js';

const MAGE = { name: 'Mage', source: 'MM', cr: '6', type: 'humanoid',
  spellcasting: [{ headerEntries: ['(spell save {@dc 14})'], will: ['{@spell light}'] }] };
const GOBLIN = { name: 'Goblin', source: 'MM', cr: '1/4', type: 'humanoid' };

let ldb, app, broadcasts, fetchCalls;

beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = [];
  fetchCalls = [];
  app = express();
  app.use(express.json());
  const ctx = {
    ldb, genId: () => crypto.randomUUID(),
    masterAuth: req => req.headers['x-test-role'] === 'dm',
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    processImageSizes: async () => ({}), deleteUploadFile: () => {}, readUploadAsBase64: () => null, extToMime: () => 'image/png',
    monsterSource: {
      listBestiaryBooks: async () => [{ code: 'MM', name: 'Monster Manual (2014)', file: 'bestiary-mm.json' }],
      fetchBestiaryBooks: async (codes) => {
        fetchCalls.push(codes);
        if (codes.includes('NOPE')) throw new Error('Unknown book: NOPE');
        return { books: [{ code: 'MM', name: 'Monster Manual (2014)', count: 2 }], unresolved: [],
          monsters: [MAGE, GOBLIN].map(m => ({ name: m.name, source: 'MM', cr: m.cr, type: m.type, data: m })) };
      },
    },
  };
  registerOfficial(app, ctx);
  registerMonsters(app, ctx);
  registerMonsterCast(app, ctx);
});

const dm = (r) => r.set('X-Test-Role', 'dm');
const importMM = () => dm(request(app).post('/api/monsters/official/import-books')).send({ books: ['MM'] });

describe('importing books', () => {
  it('is the DM\'s alone', async () => {
    expect((await request(app).post('/api/monsters/official/import-books').send({ books: ['MM'] })).status).toBe(401);
    expect((await request(app).get('/api/monsters/official')).status).toBe(401);
    expect((await request(app).get('/api/monsters/official/books')).status).toBe(401);
  });

  it('imports, then updates in place with the same ids', async () => {
    const r = await importMM();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ imported: 2, updated: 0 });
    expect(broadcasts.at(-1)).toEqual({ event: 'monsters', payload: { action: 'official-updated' } });
    const again = await importMM();
    expect(again.body).toMatchObject({ imported: 0, updated: 2 });
    const list = (await dm(request(app).get('/api/monsters/official'))).body;
    expect(list.total).toBe(2);
    expect(list.rows.map(m => m.id)).toEqual(['off-mm-goblin', 'off-mm-mage']);
    expect(list.rows[0]).toEqual({ id: 'off-mm-goblin', name: 'Goblin', cr: '1/4', type: 'humanoid', source: 'MM' });
  });

  it('refuses an unknown book and an empty choice', async () => {
    expect((await dm(request(app).post('/api/monsters/official/import-books')).send({ books: ['NOPE'] })).status).toBe(400);
    expect((await dm(request(app).post('/api/monsters/official/import-books')).send({ books: [] })).status).toBe(400);
  });

  it('searches by name or type, filters by book, and pages', async () => {
    await importMM();
    const q = async s => (await dm(request(app).get('/api/monsters/official' + s))).body;
    expect((await q('?q=mag')).rows.map(m => m.name)).toEqual(['Mage']);
    expect((await q('?q=humanoid')).total).toBe(2);
    expect((await q('?source=XMM')).total).toBe(0);
    expect((await q('?limit=1&offset=1')).rows.map(m => m.name)).toEqual(['Mage']);
    expect((await dm(request(app).get('/api/monsters/official/sources'))).body).toEqual([{ source: 'MM', count: 2 }]);
  });

  it('removes a book', async () => {
    await importMM();
    const r = await dm(request(app).delete('/api/monsters/official/books/MM'));
    expect(r.body).toEqual({ ok: true, removed: 2, kept: 0 });
    expect((await dm(request(app).get('/api/monsters/official'))).body.total).toBe(0);
  });

  it('removing a book keeps the monsters a token or a prepared map uses', async () => {
    await importMM();
    const ids = (await dm(request(app).get('/api/monsters/official'))).body.rows.map(m => m.id);
    expect(ids).toHaveLength(2);
    ldb.createTableToken('t1', { name: 'Mage A1', type: 'monster', linkedId: 'off-mm-mage', visible: true });
    const r = await dm(request(app).delete('/api/monsters/official/books/MM'));
    expect(r.body).toEqual({ ok: true, removed: 1, kept: 1 });
    expect(ldb.getMonster('off-mm-mage').name).toBe('Mage');

    // A prepared map's token counts too.
    await importMM();
    const other = ids.find(id => id !== 'off-mm-mage');
    ldb.createPreparedMap('pm1', { name: 'Cave' });
    ldb.updatePreparedMap('pm1', { preparedTokens: JSON.stringify([{ id: 'x', type: 'monster', linkedId: other }]) });
    const r2 = await dm(request(app).delete('/api/monsters/official/books/MM'));
    expect(r2.body).toEqual({ ok: true, removed: 0, kept: 2 });
  });
});

describe('using them', () => {
  it('My Monsters stays separate; the table gets the official ones its tokens use', async () => {
    await importMM();
    ldb.createMonster('own-1', { name: 'Homebrew', cr: '1' });
    expect((await dm(request(app).get('/api/monsters'))).body.map(m => m.name)).toEqual(['Homebrew']);
    ldb.createTableToken('t1', { name: 'Mage A1', type: 'monster', linkedId: 'off-mm-mage', visible: true });
    const linked = (await dm(request(app).get('/api/monsters?linked=1'))).body;
    expect(linked.map(m => [m.name, !!m.official])).toEqual([['Homebrew', false], ['Mage', true]]);
    const one = (await dm(request(app).get('/api/monsters/off-mm-mage'))).body;
    expect(one).toMatchObject({ id: 'off-mm-mage', name: 'Mage', official: true, source: 'MM', data: { cr: '6' } });
  });

  it('cannot be edited, given a portrait or deleted', async () => {
    await importMM();
    expect((await dm(request(app).put('/api/monsters/off-mm-mage')).send({ name: 'X' })).status).toBe(403);
    expect((await dm(request(app).post('/api/monsters/off-mm-mage/portrait')).send({ dataUrl: '' })).status).toBe(403);
    expect((await dm(request(app).delete('/api/monsters/off-mm-mage'))).status).toBe(403);
    expect(ldb.getMonster('off-mm-mage').name).toBe('Mage');
  });

  it('copies into My Monsters, where it can be edited; the official one stays', async () => {
    await importMM();
    const r = await dm(request(app).post('/api/monsters/official/off-mm-mage/copy'));
    expect(r.status).toBe(200);
    const own = ldb.getMonster(r.body.id);
    expect(own.official).toBeUndefined();
    expect(JSON.parse(own.dataJson).spellcasting).toHaveLength(1);
    expect((await dm(request(app).put(`/api/monsters/${r.body.id}`)).send({ name: 'Mage of the Tower' })).status).toBe(200);
    expect(ldb.getMonster('off-mm-mage').name).toBe('Mage');
    expect((await dm(request(app).post('/api/monsters/official/own-x/copy'))).status).toBe(404);
  });

  it('a token of an official monster casts its spells', async () => {
    await importMM();
    ldb.createTableToken('t1', { name: 'Mage A1', label: 'A1', type: 'monster', linkedId: 'off-mm-mage', visible: true });
    const r = await dm(request(app).post('/api/table/tokens/t1/cast')).send({ spellId: '0:will|light', mode: 'will' });
    expect(r.status).toBe(200);
    expect(r.body.entry.spell.name).toBe('light');
  });
});
