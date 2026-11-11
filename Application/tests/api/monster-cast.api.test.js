// Written by Irmak Hakman — 2026-11-11 17:46
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Monster spellcasting routes (server/routes/monster-cast.js) on the REAL
 * openCampaignDb(':memory:'). X-Test-Role 'dm' is the DM; anything else is not.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerMonsterCast from '../../server/routes/monster-cast.js';

const MAGE = { name: 'Mage', cr: '6', spellcasting: [{
  headerEntries: ['The mage is a 9th-level spellcaster (spell save {@dc 14}, {@hit 6} to hit with spell attacks).'],
  spells: { 0: { spells: ['{@spell fire bolt}'] }, 3: { slots: 2, spells: ['{@spell fireball}'] }, 5: { slots: 1, spells: ['{@spell cone of cold}'] } },
  daily: { '1e': ['{@spell dimension door}'] } }] };

let ldb, app, broadcasts;

function token(id, fields = {}) {
  ldb.createTableToken(id, { name: 'Mage M1', label: 'M1', type: 'monster', linkedId: 'mon-mage', visible: true, ...fields });
}

beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = [];
  ldb.createMonster('mon-mage', { name: 'Mage', cr: '6', dataJson: JSON.stringify(MAGE) });
  // Two books' Fireball: the 2024 one wins.
  ldb.createSpell('fb-phb', { name: 'Fireball', source: 'PHB', level: 3, school: 'V', data: { name: 'Fireball', source: 'PHB', level: 3, entries: ['old'] } });
  ldb.createSpell('fb-xphb', { name: 'Fireball', source: 'XPHB', level: 3, school: 'V',
    data: { name: 'Fireball', source: 'XPHB', level: 3, school: 'V', entries: ['Dexterity saving throw, {@damage 8d6} Fire damage.'],
            entriesHigherLevel: [{ type: 'entries', entries: ['{@scaledamage 8d6|3-9|1d6}'] }], damageInflict: ['fire'], savingThrow: ['dexterity'] } });
  app = express();
  app.use(express.json());
  registerMonsterCast(app, {
    ldb, genId: () => crypto.randomUUID(),
    masterAuth: req => req.headers['x-test-role'] === 'dm',
    broadcast: (event, payload, _c, opts) => broadcasts.push({ event, payload, opts: opts || {} }),
  });
});

const cast = (id, body, who = 'dm') => request(app).post(`/api/table/tokens/${id}/cast`).set('X-Test-Role', who).send(body);
const uses = id => JSON.parse(ldb.getTableToken(id).spellUses || '{}');

describe('casting', () => {
  it('is the DM\'s alone', async () => {
    token('t1');
    expect((await cast('t1', { spellId: '0:s0|fire bolt', mode: 'cantrip' }, 'player')).status).toBe(401);
    expect((await request(app).post('/api/table/tokens/t1/spell-rest')).status).toBe(401);
    expect((await request(app).post('/api/table/spell-rest')).status).toBe(401);
  });

  it('spends the chosen slot on this token only, and upcasts', async () => {
    token('t1'); token('t2');
    const r = await cast('t1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 5 });
    expect(r.status).toBe(200);
    expect(uses('t1')).toEqual({ '0:s5': 1 });
    expect(ldb.getTableToken('t2').spellUses || '').toBe('');
    expect(r.body.entry).toMatchObject({ type: 'spell', sender: 'M1', save: 'Dexterity', saveDc: '14', damage: '10d6', damageType: 'fire',
                                         spell: { name: 'Fireball', level: 3, castLevel: 5 } });
    expect((await cast('t1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 5 })).status).toBe(409);
  });

  it('counts an "each" daily spell, and refuses an option the stat block does not give', async () => {
    token('t1');
    expect((await cast('t1', { spellId: '0:daily:1e|dimension door', mode: 'daily' })).status).toBe(200);
    expect(uses('t1')).toEqual({ '0:daily:1e|dimension door': 1 });
    expect((await cast('t1', { spellId: '0:daily:1e|dimension door', mode: 'daily' })).status).toBe(409);
    expect((await cast('t1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 1 })).status).toBe(400);
    expect((await cast('t1', { spellId: '0:s9|wish', mode: 'slot', slotLevel: 9 })).status).toBe(404);
  });

  it('a cantrip spends nothing and scales with the caster level', async () => {
    token('t1');
    const r = await cast('t1', { spellId: '0:s0|fire bolt', mode: 'cantrip' });
    expect(r.status).toBe(200);
    expect(ldb.getTableToken('t1').spellUses || '').toBe('');
    expect(broadcasts.filter(b => b.event === 'table')).toHaveLength(0);
  });

  it('players get the token without its spell uses; a hidden one, and its card, only the DM', async () => {
    token('t1');
    await cast('t1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 3 });
    const tb = broadcasts.find(b => b.event === 'table');
    expect(tb.payload.token.spellUses).toBeTruthy();
    expect(tb.opts.dmOnly).toBe(true);
    expect(tb.opts.forOthers.token.spellUses).toBeUndefined();
    expect(broadcasts.find(b => b.event === 'chat').opts.dmOnly).toBeUndefined();

    broadcasts.length = 0;
    token('h1', { visible: false });
    await cast('h1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 3 });
    expect(broadcasts.find(b => b.event === 'table').opts.forOthers).toEqual({ action: 'token-removed', id: 'h1' });
    expect(broadcasts.find(b => b.event === 'chat').opts.dmOnly).toBe(true);
    expect(ldb.listChatLog().at(-1).dmOnly).toBe(true);
  });

  it('casts from a stat block whose spells are only text', async () => {
    ldb.createMonster('mon-ece', { name: 'Ece', cr: '8', dataJson: JSON.stringify({ name: 'Ece', action: [{ name: 'Spellcasting',
      entries: ['Ece casts one of the following spells (spell save {@dc 15}):\n\nAt will: {@spell Fireball|XPHB}\n\n1/day each: {@spell Fireball|XPHB}'] }] }) });
    token('e1', { linkedId: 'mon-ece' });
    const r = await cast('e1', { spellId: '0:daily:1e|Fireball', mode: 'daily' });
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ saveDc: '15', spell: { name: 'Fireball' } });
    expect((await cast('e1', { spellId: '0:daily:1e|Fireball', mode: 'daily' })).status).toBe(409);
  });

  it('refuses a token without spells', async () => {
    ldb.createMonster('mon-goblin', { name: 'Goblin', cr: '1/4', dataJson: JSON.stringify({ name: 'Goblin' }) });
    token('g1', { linkedId: 'mon-goblin' });
    expect((await cast('g1', { spellId: 'x', mode: 'will' })).status).toBe(400);
  });
});

describe('resting', () => {
  it('gives one token, or every monster, its uses back', async () => {
    token('t1'); token('t2');
    await cast('t1', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 3 });
    await cast('t2', { spellId: '0:s3|fireball', mode: 'slot', slotLevel: 3 });
    expect((await request(app).post('/api/table/tokens/t1/spell-rest').set('X-Test-Role', 'dm')).status).toBe(200);
    expect(ldb.getTableToken('t1').spellUses).toBe('');
    expect(uses('t2')).toEqual({ '0:s3': 1 });
    const all = await request(app).post('/api/table/spell-rest').set('X-Test-Role', 'dm');
    expect(all.body).toMatchObject({ ok: true, rested: 1 });
    expect(ldb.getTableToken('t2').spellUses).toBe('');
  });
});
