// Written by Irmak Hakman — 2026-11-16 16:15
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * API tests for server/routes/combat.js: condition durations asked about at
 * the start of a turn, and concentration saves after damage.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW = 'mira-pw';
const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asMira = (a) => a.set('X-Character-Id', 'mira').set('X-Character-Password', PW);
const asBob = (a) => a.set('X-Character-Id', 'bob').set('X-Character-Password', 'bob-pw');

function setup() {
  const made = makeApp();
  const { ldb, hashPassword } = made;
  ldb.createCharacter('mira', { name: 'Mira', passwordHash: hashPassword(PW), dataJson: JSON.stringify({ name: 'Mira' }) });
  ldb.createCharacter('bob', { name: 'Bob', passwordHash: hashPassword('bob-pw'), dataJson: JSON.stringify({ name: 'Bob' }) });
  ldb.createInitEntry('e-gob', { name: 'Goblin', roll: 20, monsterId: 'm1' });
  ldb.createInitEntry('e-mira', { name: 'Mira', roll: 10, charId: 'mira' });
  ldb.createTableToken('t-gob', { name: 'Goblin', type: 'monster', initiativeId: 'e-gob', hpCurrent: 7, hpMax: 7, conditions: '["Poisoned"]' });
  ldb.createTableToken('t-mira', { name: 'Mira', type: 'character', linkedId: 'mira', initiativeId: 'e-mira',
    hpCurrent: 20, hpMax: 24, hpTemp: 0, conditions: '["Frightened"]' });
  return made;
}
const timers = (ldb, id) => JSON.parse(ldb.getTableToken(id).condTimers || '{}');
const conds = (ldb, id) => JSON.parse(ldb.getTableToken(id).conditions || '[]');

describe('condition durations', () => {
  it('lets the token\'s player set a duration on their own condition', async () => {
    const { app, ldb } = setup();
    const res = await asMira(request(app).post('/api/table/tokens/t-mira/condition-timer')).send({ condition: 'Frightened', rounds: 2 });
    expect(res.status).toBe(200);
    expect(timers(ldb, 't-mira').Frightened.rounds).toBe(2);
  });

  it('keeps other players out', async () => {
    const { app } = setup();
    const res = await asBob(request(app).post('/api/table/tokens/t-mira/condition-timer')).send({ condition: 'Frightened', rounds: 2 });
    expect(res.status).toBe(401);
  });

  it('refuses a condition the token does not have', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Blinded', rounds: 2 });
    expect(res.status).toBe(400);
  });

  it('asks when the turn starts, and "now" takes a round off', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Poisoned', rounds: 2 });
    await asDM(request(app).post('/api/initiative/start'));
    expect(timers(ldb, 't-gob').Poisoned.ask).toBe(true);
    const res = await asDM(request(app).post('/api/table/tokens/t-gob/condition-ask')).send({ condition: 'Poisoned', choice: 'now' });
    expect(res.status).toBe(200);
    expect(timers(ldb, 't-gob').Poisoned).toEqual({ rounds: 1, ask: false, atEnd: false });
  });

  it('ends the condition when the count runs out, and says so', async () => {
    const { app, ldb, broadcasts } = setup();
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Poisoned', rounds: 1 });
    await asDM(request(app).post('/api/initiative/start'));
    const res = await asDM(request(app).post('/api/table/tokens/t-gob/condition-ask')).send({ condition: 'Poisoned', choice: 'now' });
    expect(res.body.ended).toEqual(['Poisoned']);
    expect(conds(ldb, 't-gob')).toEqual([]);
    expect(broadcasts.some(b => b.payload && b.payload.condEnded && b.payload.condEnded.includes('Poisoned'))).toBe(true);
  });

  it('"at end of turn" ticks when the turn moves on', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Poisoned', rounds: 1 });
    await asDM(request(app).post('/api/initiative/start'));
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-ask')).send({ condition: 'Poisoned', choice: 'end' });
    expect(conds(ldb, 't-gob')).toEqual(['Poisoned']);
    await asDM(request(app).post('/api/initiative/next'));
    expect(conds(ldb, 't-gob')).toEqual([]);
  });

  it('lets the player answer for their own token on their turn', async () => {
    const { app, ldb } = setup();
    await asMira(request(app).post('/api/table/tokens/t-mira/condition-timer')).send({ condition: 'Frightened', rounds: 3 });
    ldb.setInitState('e-gob');
    await asDM(request(app).post('/api/initiative/next'));
    expect(timers(ldb, 't-mira').Frightened.ask).toBe(true);
    const res = await asMira(request(app).post('/api/table/tokens/t-mira/condition-ask')).send({ condition: 'Frightened', choice: 'skip' });
    expect(res.status).toBe(200);
    expect(timers(ldb, 't-mira').Frightened).toEqual({ rounds: 3, ask: false, atEnd: false });
  });

  it('a second answer from another screen does nothing', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Poisoned', rounds: 3 });
    await asDM(request(app).post('/api/initiative/start'));
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-ask')).send({ condition: 'Poisoned', choice: 'now' });
    const again = await asDM(request(app).post('/api/table/tokens/t-gob/condition-ask')).send({ condition: 'Poisoned', choice: 'now' });
    expect(again.body.already).toBe(true);
    expect(timers(ldb, 't-gob').Poisoned.rounds).toBe(2);
  });

  it('drops the timer when the condition is removed', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens/t-gob/condition-timer')).send({ condition: 'Poisoned', rounds: 3 });
    await asDM(request(app).put('/api/table/tokens/t-gob')).send({ conditions: [] });
    expect(timers(ldb, 't-gob')).toEqual({});
  });
});

describe('concentration', () => {
  it('queues a save when the concentrating token takes damage', async () => {
    const { app, ldb } = setup();
    await asMira(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 6 });
    const tok = ldb.getTableToken('t-mira');
    expect(tok.concentration).toBe('Bless');
    expect(JSON.parse(tok.concChecks)).toEqual([{ dc: 10, damage: 14 }]);
  });

  it('uses half the damage once that is above 10', async () => {
    const { app, ldb } = setup();
    ldb.updateTableToken('t-mira', { hpCurrent: 60, hpMax: 60 });
    await asDM(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 30 });
    expect(JSON.parse(ldb.getTableToken('t-mira').concChecks)[0].dc).toBe(15);
  });

  it('counts damage that only temporary HP took', async () => {
    const { app, ldb } = setup();
    ldb.updateTableToken('t-mira', { hpTemp: 5 });
    await asDM(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpTemp: 2 });
    expect(JSON.parse(ldb.getTableToken('t-mira').concChecks)).toEqual([{ dc: 10, damage: 3 }]);
  });

  it('ends at 0 HP', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 0 });
    expect(ldb.getTableToken('t-mira').concentration).toBe('');
  });

  it('keeps the spell on a save at or above the DC', async () => {
    const { app, ldb } = setup();
    await asMira(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 6 });
    const res = await asMira(request(app).post('/api/table/tokens/t-mira/conc-check')).send({ total: 10 });
    expect(res.body).toMatchObject({ passed: true, dc: 10 });
    expect(ldb.getTableToken('t-mira').concentration).toBe('Bless');
    expect(JSON.parse(ldb.getTableToken('t-mira').concChecks)).toEqual([]);
  });

  it('ends it on a failed save', async () => {
    const { app, ldb } = setup();
    await asMira(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 6 });
    const res = await asMira(request(app).post('/api/table/tokens/t-mira/conc-check')).send({ total: 9 });
    expect(res.body.passed).toBe(false);
    expect(ldb.getTableToken('t-mira').concentration).toBe('');
  });

  it('keeps another player from rolling it', async () => {
    const { app } = setup();
    await asMira(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: 'Bless' });
    expect((await asBob(request(app).post('/api/table/tokens/t-mira/concentration')).send({ spell: '' })).status).toBe(401);
  });

  it('owes nothing when the token is not concentrating', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).put('/api/table/tokens/t-mira')).send({ hpCurrent: 6 });
    expect(JSON.parse(ldb.getTableToken('t-mira').concChecks || '[]')).toEqual([]);
  });
});
