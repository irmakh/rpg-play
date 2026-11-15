// Written by Irmak Hakman — 2026-11-15 12:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * API tests for POST /api/characters/:id/give — a player handing an item or
 * coins to another character, the DM doing it for them, and everyone else
 * (another player, a stranger) kept out.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';

const SHIELD = { id: 1, name: 'Shield +1', itemType: 'shield', acBonus: 3, equipped: true };
const SWORD = { id: 2, name: 'Longsword', itemType: 'weapon', weaponAtk: '', weaponDmg: '1d8 slashing', weaponProperties: [], equipped: false, notes: '' };

function setup() {
  const { app, ldb, hashPassword } = makeApp();
  ldb.createCharacter('char-a', { name: 'Alice', passwordHash: hashPassword(PW_A),
    dataJson: JSON.stringify({ name: 'Alice', dex: '14', ac: '15', gp: '30', sp: '4', pp2: '',
      _items: JSON.stringify([SHIELD, SWORD]),
      _weapons: JSON.stringify([['Longsword', '+5', '1d8+3 slashing', '', 2]]) }) });
  ldb.createCharacter('char-b', { name: 'Bob', passwordHash: hashPassword(PW_B),
    dataJson: JSON.stringify({ name: 'Bob', str: '16', level: '1', gp: '2' }) });
  ldb.createCharacter('char-c', { name: 'Cora', passwordHash: hashPassword('cora-pw') });
  return { app, ldb };
}

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asA  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asB  = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);
const data = (ldb, id) => JSON.parse(ldb.getCharacter(id).dataJson || '{}');
const list = (json) => JSON.parse(json || '[]');

describe('POST /api/characters/:id/give — an item', () => {
  it('moves it, with its attack row rebuilt for the receiver', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', itemId: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, given: 'Longsword', to: 'Bob' });
    const a = data(ldb, 'char-a'), b = data(ldb, 'char-b');
    expect(list(a._items).map(i => i.name)).toEqual(['Shield +1']);
    expect(list(a._weapons)).toEqual([]);
    expect(list(b._items)).toMatchObject([{ id: 1, name: 'Longsword', equipped: false }]);
    // Bob: STR 16 (+3), level 1 (+2 proficiency) — his numbers, not Alice's.
    expect(list(b._weapons)).toEqual([['Longsword', '+5', '1d8+3 slashing', '', 1]]);
  });

  it('takes a worn item off and works the giver\'s AC out again', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', itemId: 1 });
    expect(res.status).toBe(200);
    const a = data(ldb, 'char-a');
    expect(a.ac).not.toBe('15');
    expect(list(data(ldb, 'char-b')._items)[0]).toMatchObject({ name: 'Shield +1', equipped: false });
  });

  it('lets the DM give from any character', async () => {
    const { app, ldb } = setup();
    const res = await asDM(request(app).post('/api/characters/char-a/give')).send({ to: 'char-c', itemId: 2 });
    expect(res.status).toBe(200);
    expect(list(data(ldb, 'char-c')._items).map(i => i.name)).toEqual(['Longsword']);
  });

  it('keeps another player and a stranger from giving someone else\'s things away', async () => {
    const { app, ldb } = setup();
    expect((await asB(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', itemId: 2 })).status).toBe(401);
    expect((await request(app).post('/api/characters/char-a/give').send({ to: 'char-b', itemId: 2 })).status).toBe(401);
    expect(list(data(ldb, 'char-a')._items)).toHaveLength(2);
  });

  it('keeps other players out of a character that has no password, too', async () => {
    // charAuth lets anyone open such a sheet; giving its things away is more than that.
    const { app, ldb } = setup();
    ldb.createCharacter('char-open', { name: 'Open', dataJson: JSON.stringify({ gp: '5', _items: JSON.stringify([SWORD]) }) });
    expect((await asB(request(app).post('/api/characters/char-open/give')).send({ to: 'char-b', itemId: 2 })).status).toBe(401);
    expect((await asB(request(app).post('/api/characters/char-open/give')).send({ to: 'char-b', coins: { gp: 5 } })).status).toBe(401);
    expect((await asDM(request(app).post('/api/characters/char-open/give')).send({ to: 'char-b', coins: { gp: 5 } })).status).toBe(200);
  });

  it('refuses an item that is not there, oneself, nobody, and an unknown receiver', async () => {
    const { app } = setup();
    const post = (body) => asA(request(app).post('/api/characters/char-a/give')).send(body);
    expect((await post({ to: 'char-b', itemId: 99 })).status).toBe(404);
    expect((await post({ to: 'char-a', itemId: 2 })).status).toBe(400);
    expect((await post({ itemId: 2 })).status).toBe(400);
    expect((await post({ to: 'char-zz', itemId: 2 })).status).toBe(404);
    expect((await post({ to: 'char-b', itemId: 2, coins: { gp: 1 } })).status).toBe(400);
  });
});

describe('POST /api/characters/:id/give — coins', () => {
  it('moves the coins from one purse to the other', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 10, sp: 4 } });
    expect(res.status).toBe(200);
    expect(res.body.given).toBe('10 GP, 4 SP');
    expect(data(ldb, 'char-a')).toMatchObject({ gp: '20', sp: '0' });
    expect(data(ldb, 'char-b')).toMatchObject({ gp: '12', sp: '4' });
  });

  it('refuses more than the giver has, or no coins at all', async () => {
    const { app, ldb } = setup();
    const post = (coins) => asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins });
    expect((await post({ gp: 31 })).status).toBe(400);
    expect((await post({ pp: 1 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ gp: -5 })).status).toBe(400);
    expect(data(ldb, 'char-a').gp).toBe('30');
  });
});

describe('GET /api/characters/:id/qroll', () => {
  it('carries the coins, for the table\'s Items tab', async () => {
    const { app } = setup();
    const res = await asB(request(app).get('/api/characters/char-a/qroll'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ gp: '30', sp: '4' });
  });
});
