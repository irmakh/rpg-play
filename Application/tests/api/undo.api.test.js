// Written by Irmak Hakman — 2026-11-16 12:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * API tests for POST /api/undo/:id and the routes that register an undo:
 * a give (item and coins), a token removed from the table, a treasury item
 * deleted. Covers who may undo (the person who did it, or the DM), the window
 * running out, and a reverse that is no longer possible.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';
const SHIELD = { id: 1, name: 'Shield +1', itemType: 'shield', acBonus: 2, equipped: true };

function setup() {
  let t = 1000;
  const clock = { advance: (ms) => { t += ms; } };
  const { app, ldb, hashPassword, undo, deletedFiles } = makeApp({ now: () => t });
  ldb.createCharacter('char-a', { name: 'Alice', passwordHash: hashPassword(PW_A),
    dataJson: JSON.stringify({ name: 'Alice', ac: '15', gp: '30', _items: JSON.stringify([SHIELD]) }) });
  ldb.createCharacter('char-b', { name: 'Bob', passwordHash: hashPassword(PW_B),
    dataJson: JSON.stringify({ name: 'Bob', gp: '2' }) });
  return { app, ldb, undo, clock, deletedFiles };
}

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asA  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asB  = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);
const data = (ldb, id) => JSON.parse(ldb.getCharacter(id).dataJson || '{}');
const items = (ldb, id) => JSON.parse(data(ldb, id)._items || '[]');

describe('undo a give', () => {
  it('gives the item back, worn again as it was', async () => {
    const { app, ldb } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', itemId: 1 });
    expect(give.status).toBe(200);
    expect(give.body.undoId).toBeTruthy();
    expect(give.body.undoUntil).toBeGreaterThan(1000);
    expect(items(ldb, 'char-a')).toHaveLength(0);

    const res = await asA(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(res.status).toBe(200);
    expect(items(ldb, 'char-b')).toHaveLength(0);
    const back = items(ldb, 'char-a');
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('Shield +1');
    expect(back[0].equipped).toBe(true);
  });

  it('gives coins back', async () => {
    const { app, ldb } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 10 } });
    expect(data(ldb, 'char-b').gp).toBe('12');
    await asA(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(data(ldb, 'char-a').gp).toBe('30');
    expect(data(ldb, 'char-b').gp).toBe('2');
  });

  it('lets the DM undo a player\'s give', async () => {
    const { app, ldb } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 5 } });
    const res = await asDM(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(res.status).toBe(200);
    expect(data(ldb, 'char-a').gp).toBe('30');
  });

  it('does not let another player undo it', async () => {
    const { app, ldb } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 5 } });
    const res = await asB(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(res.status).toBe(403);
    expect(data(ldb, 'char-b').gp).toBe('7');
  });

  it('refuses a stranger with no login', async () => {
    const { app } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 5 } });
    expect((await request(app).post(`/api/undo/${give.body.undoId}`)).status).toBe(401);
  });

  it('refuses once the window has run out', async () => {
    const { app, ldb, clock } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 5 } });
    clock.advance(60000);
    const res = await asA(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(res.status).toBe(410);
    expect(data(ldb, 'char-b').gp).toBe('7');
  });

  it('works only once', async () => {
    const { app } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 5 } });
    expect((await asA(request(app).post(`/api/undo/${give.body.undoId}`))).status).toBe(200);
    expect((await asA(request(app).post(`/api/undo/${give.body.undoId}`))).status).toBe(410);
  });

  it('says so when the receiver no longer has it', async () => {
    const { app, ldb } = setup();
    const give = await asA(request(app).post('/api/characters/char-a/give')).send({ to: 'char-b', coins: { gp: 10 } });
    const b = data(ldb, 'char-b');
    ldb.updateCharacter('char-b', { dataJson: JSON.stringify({ ...b, gp: '0' }), name: 'Bob' });
    const res = await asA(request(app).post(`/api/undo/${give.body.undoId}`));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer has/);
    expect(data(ldb, 'char-a').gp).toBe('20');
  });

  it('refuses an unknown id', async () => {
    const { app } = setup();
    expect((await asDM(request(app).post('/api/undo/nope'))).status).toBe(410);
  });
});

describe('undo removing a token', () => {
  it('puts the token back with its initiative entry and turn', async () => {
    const { app, ldb } = setup();
    ldb.createInitEntry('e1', { name: 'Goblin', roll: 15 });
    ldb.createInitEntry('e2', { name: 'Alice', roll: 10, charId: 'char-a' });
    ldb.setInitState('e1');
    ldb.createTableToken('tok1', { name: 'Goblin', type: 'monster', x: 3, y: 4, hpCurrent: 5, hpMax: 7,
      initiativeId: 'e1', conditions: '["Poisoned"]' });

    const del = await asDM(request(app).delete('/api/table/tokens/tok1'));
    expect(del.status).toBe(200);
    expect(ldb.getTableToken('tok1')).toBeNull();
    expect(ldb.getInitEntry('e1')).toBeNull();
    expect(ldb.getInitState().currentId).toBe('e2');

    const res = await asDM(request(app).post(`/api/undo/${del.body.undoId}`));
    expect(res.status).toBe(200);
    const tok = ldb.getTableToken('tok1');
    expect(tok).toMatchObject({ name: 'Goblin', x: 3, y: 4, hpCurrent: 5, initiativeId: 'e1', conditions: '["Poisoned"]' });
    expect(ldb.getInitEntry('e1')).toMatchObject({ name: 'Goblin', roll: 15 });
    expect(ldb.getInitState().currentId).toBe('e1');
  });

  it('leaves the turn alone if it has moved on since', async () => {
    const { app, ldb } = setup();
    ldb.createInitEntry('e1', { name: 'Goblin', roll: 15 });
    ldb.createInitEntry('e2', { name: 'Alice', roll: 10 });
    ldb.createInitEntry('e3', { name: 'Bob', roll: 5 });
    ldb.setInitState('e1');
    ldb.createTableToken('tok1', { name: 'Goblin', initiativeId: 'e1' });
    const del = await asDM(request(app).delete('/api/table/tokens/tok1'));
    ldb.setInitState('e3');
    await asDM(request(app).post(`/api/undo/${del.body.undoId}`));
    expect(ldb.getInitState().currentId).toBe('e3');
    expect(ldb.getTableToken('tok1')).not.toBeNull();
  });
});

describe('undo deleting a treasury item', () => {
  it('brings the item back with its image, and never deletes the files', async () => {
    const { app, ldb, undo, clock, deletedFiles } = setup();
    ldb.createTreasuryItem('t1', { name: 'Painting', mode: 'loot', valueCp: 500, imageUrl: '/uploads/treasury/p.jpg' });
    const del = await asDM(request(app).delete('/api/treasury/t1'));
    expect(ldb.getTreasuryItem('t1')).toBeNull();
    const res = await asDM(request(app).post(`/api/undo/${del.body.undoId}`));
    expect(res.status).toBe(200);
    expect(ldb.getTreasuryItem('t1')).toMatchObject({ name: 'Painting', mode: 'loot', valueCp: 500, imageUrl: '/uploads/treasury/p.jpg' });
    clock.advance(60000);
    undo.sweep();
    expect(deletedFiles).toEqual([]);
  });
});
