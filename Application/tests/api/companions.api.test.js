// Written by Irmak Hakman — 2026-10-28 14:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * API tests for players' companions (familiars, summons): summoning one from
 * the sheet's _companions, the owner running its token (HP, name, hidden,
 * dismiss), its own initiative row — and other players being kept out.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';

const OWL = {
  id: 'cmp-owl', name: 'Owl', hpMax: 1, ac: 11, speed: 5, size: 1,
  initBonus: 3, initMode: 'own',
  attacks: [{ name: 'Talons', toHit: '3', damage: '1 slashing' }], notes: 'Flyby',
};
const WOLF = { id: 'cmp-wolf', name: 'Wolf', hpMax: 11, ac: 13, speed: 40, size: 1, initMode: 'shared', attacks: [] };

function setup() {
  const { app, ldb, hashPassword } = makeApp();
  ldb.createCharacter('char-a', { name: 'Alice', passwordHash: hashPassword(PW_A),
    dataJson: JSON.stringify({ _companions: JSON.stringify([OWL, WOLF]) }) });
  ldb.createCharacter('char-b', { name: 'Bob', passwordHash: hashPassword(PW_B) });
  return { app, ldb };
}

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asA  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asB  = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);

async function summon(app, companionId = 'cmp-owl') {
  const res = await asA(request(app).post('/api/table/companions/summon')).send({ charId: 'char-a', companionId });
  expect(res.status).toBe(200);
  return res.body.id;
}

describe('POST /api/table/companions/summon', () => {
  it('puts the companion on the map at full HP, owned by its player', async () => {
    const { app, ldb } = setup();
    const id = await summon(app);
    const tok = ldb.getTableToken(id);
    expect(tok).toMatchObject({ name: 'Owl', type: 'companion', assignedCharId: 'char-a', linkedId: '',
                                hpCurrent: 1, hpMax: 1, ac: 11, speed: 5, visible: true });
    const c = JSON.parse(tok.companion);
    expect(c).toMatchObject({ id: 'cmp-owl', initMode: 'own', initBonus: 3, notes: 'Flyby' });
    expect(c.attacks).toEqual([{ name: 'Talons', toHit: '3', damage: '1 slashing' }]);
  });

  it('lands beside its owner\'s token, not on it', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens')).send({ name: 'Alice', type: 'character', linkedId: 'char-a', x: 4, y: 4 });
    const tok = ldb.getTableToken(await summon(app));
    expect(tok.x).toBe(5);
    expect(tok.y).toBe(4);
    const second = ldb.getTableToken(await summon(app, 'cmp-wolf'));
    expect([second.x, second.y]).not.toEqual([5, 4]);
    expect(Math.max(Math.abs(second.x - 4), Math.abs(second.y - 4))).toBe(1);
  });

  it('numbers a second copy of the same companion', async () => {
    const { app, ldb } = setup();
    await summon(app);
    const id = await summon(app);
    expect(ldb.getTableToken(id).name).toBe('Owl 2');
  });

  it('refuses another player', async () => {
    const { app } = setup();
    const res = await asB(request(app).post('/api/table/companions/summon')).send({ charId: 'char-a', companionId: 'cmp-owl' });
    expect(res.status).toBe(401);
  });

  it('lets the DM summon for a player', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/table/companions/summon')).send({ charId: 'char-a', companionId: 'cmp-wolf' });
    expect(res.status).toBe(200);
  });

  it('404s a companion the sheet does not have', async () => {
    const { app } = setup();
    const res = await asA(request(app).post('/api/table/companions/summon')).send({ charId: 'char-a', companionId: 'nope' });
    expect(res.status).toBe(404);
  });
});

describe('the owner runs a companion token', () => {
  it('sets HP, temp HP, name and conditions', async () => {
    const { app, ldb } = setup();
    const id = await summon(app, 'cmp-wolf');
    const res = await asA(request(app).put(`/api/table/tokens/${id}`))
      .send({ hpCurrent: 4, hpTemp: 2, name: 'Fang', conditions: ['Prone'] });
    expect(res.status).toBe(200);
    expect(ldb.getTableToken(id)).toMatchObject({ hpCurrent: 4, hpTemp: 2, name: 'Fang', conditions: '["Prone"]' });
  });

  it('hides it from the others, and still gets it back itself', async () => {
    const { app } = setup();
    const id = await summon(app);
    await asA(request(app).put(`/api/table/tokens/${id}`)).send({ visible: false });
    const mine = await asA(request(app).get('/api/table'));
    const theirs = await asB(request(app).get('/api/table'));
    expect(mine.body.tokens.some(t => t.id === id)).toBe(true);
    expect(theirs.body.tokens.some(t => t.id === id)).toBe(false);
  });

  it('keeps another player from changing its HP', async () => {
    const { app, ldb } = setup();
    const id = await summon(app, 'cmp-wolf');
    await asB(request(app).put(`/api/table/tokens/${id}`)).send({ hpCurrent: 0 });
    expect(ldb.getTableToken(id).hpCurrent).toBe(11);
  });

  it('dismisses it; another player cannot', async () => {
    const { app, ldb } = setup();
    const id = await summon(app);
    expect((await asB(request(app).delete(`/api/table/tokens/${id}`))).status).toBe(401);
    expect((await asA(request(app).delete(`/api/table/tokens/${id}`))).status).toBe(200);
    expect(ldb.getTableToken(id)).toBeFalsy();
  });

  it('still cannot delete a token that is not a companion', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/table/tokens')).send({ name: 'Alice', type: 'character', linkedId: 'char-a' });
    expect((await asA(request(app).delete(`/api/table/tokens/${res.body.id}`))).status).toBe(401);
  });
});

describe('POST /api/table/companions/:id/initiative', () => {
  it('gives it its own row, and a reroll replaces it', async () => {
    const { app, ldb } = setup();
    const id = await summon(app);
    const r1 = await asA(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 14 });
    expect(r1.status).toBe(200);
    const entryId = ldb.getTableToken(id).initiativeId;
    expect(entryId).toBe(r1.body.id);
    await asA(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 7 });
    const entries = ldb.listInitEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: entryId, name: 'Owl', roll: 7 });
  });

  it('drops its row when it is dismissed', async () => {
    const { app, ldb } = setup();
    const id = await summon(app);
    await asA(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 14 });
    await asA(request(app).delete(`/api/table/tokens/${id}`));
    expect(ldb.listInitEntries()).toHaveLength(0);
  });

  it('refuses another player', async () => {
    const { app } = setup();
    const id = await summon(app);
    const res = await asB(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 20 });
    expect(res.status).toBe(401);
  });
});

describe('a hidden companion in the initiative tracker', () => {
  it('is left out for the other players, kept for its owner and the DM', async () => {
    const { app } = setup();
    const id = await summon(app);
    await asA(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 14 });
    await asA(request(app).put(`/api/table/tokens/${id}`)).send({ visible: false });
    const names = async (as) => (await as(request(app).get('/api/initiative'))).body.entries.map(e => e.name);
    expect(await names(asB)).toEqual([]);
    expect(await names(asA)).toEqual(['Owl']);
    expect(await names(asDM)).toEqual(['Owl']);
  });

  it('comes back for everyone once shown again', async () => {
    const { app } = setup();
    const id = await summon(app);
    await asA(request(app).post(`/api/table/companions/${id}/initiative`)).send({ roll: 14 });
    await asA(request(app).put(`/api/table/tokens/${id}`)).send({ visible: false });
    await asA(request(app).put(`/api/table/tokens/${id}`)).send({ visible: true });
    const res = await asB(request(app).get('/api/initiative'));
    expect(res.body.entries.map(e => e.name)).toEqual(['Owl']);
  });
});

describe('POST /api/characters/:id/companion-portrait', () => {
  it('refuses another player', async () => {
    const { app } = setup();
    const res = await asB(request(app).post('/api/characters/char-a/companion-portrait'))
      .send({ dataUrl: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/characters/:id on a sheet saved blank', () => {
  it('keeps the character\'s name when the data has none', async () => {
    const { app, ldb } = setup();
    await asB(request(app).patch('/api/characters/char-b')).send({ patch: { cp: '1' } });
    expect(ldb.getCharacter('char-b').name).toBe('Bob');
  });
});

describe('GET /api/characters/:id/qroll', () => {
  it('carries the companions, for the table\'s Summon buttons', async () => {
    const { app } = setup();
    const res = await asA(request(app).get('/api/characters/char-a/qroll'));
    expect(JSON.parse(res.body.data._companions).map(c => c.id)).toEqual(['cmp-owl', 'cmp-wolf']);
  });
});
