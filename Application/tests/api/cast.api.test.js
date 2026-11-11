// Written by Irmak Hakman — 2026-11-11 22:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * POST /api/characters/:id/cast (server/routes/cast.js), on the REAL
 * openCampaignDb(':memory:'). Sessions are stubbed by header: X-Test-Role is
 * 'dm', 'player' (logged into this campaign) or absent, and X-Test-Char names
 * the player's own character.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerCast from '../../server/routes/cast.js';

let ldb, app, broadcasts, notes;

const FIREBALL = { id: 'sp-fb', name: 'Fireball', level: 3, prepared: true, cast: 'action', school: 'Evoc',
  range: '150 feet', duration: 'Instantaneous', v: true, s: true, m: true, material: 'bat guano',
  entries: ['A Dexterity saving throw, {@damage 8d6} Fire damage.'],
  higher: [{ type: 'entries', entries: ['{@scaledamage 8d6|3-9|1d6}'] }] };
const MISTY = { id: 'sp-ms', name: 'Misty Step', level: 2, cast: 'bonus', noSlot: true, uses: 1, used: 0, recharge: 'long' };
const DETECT = { id: 'sp-dm', name: 'Detect Magic', level: 1, ritual: true, prepared: true };
const BOLT = { id: 'sp-bolt', name: 'Fire Bolt', level: 0, libId: 'lib-bolt', entries: ['{@damage 1d10} Fire damage.'] };
const SHIELD = { id: 'sp-sh', name: 'Shield', level: 1, prepared: false };

function seed(data = {}) {
  ldb.createCharacter('wiz', {
    name: 'Aliyr', charType: 'pc', createdAt: new Date().toISOString(),
    dataJson: JSON.stringify({
      level: '9', 'sp-atk': '+7', 'sp-dc': '15',
      'slot-1-total': '4', 'slot-1-used': '4', 'slot-3-total': '3', 'slot-3-used': '0', 'slot-5-total': '1', 'slot-5-used': '0',
      _spells: JSON.stringify([FIREBALL, MISTY, DETECT, BOLT, SHIELD]),
      ...data,
    }),
  });
  ldb.createCharacter('other', { name: 'Gaston', charType: 'pc', dataJson: '{}', createdAt: new Date().toISOString() });
}
const stored = () => JSON.parse(ldb.getCharacter('wiz').dataJson);
const storedSpell = id => JSON.parse(stored()._spells).find(s => s.id === id);

beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = []; notes = [];
  ldb.createSpell('lib-bolt', { name: 'Fire Bolt', source: 'XPHB', level: 0, school: 'V',
    data: { name: 'Fire Bolt', spellAttack: ['R'], damageInflict: ['fire'],
            scalingLevelDice: { label: 'fire damage', scaling: { 1: '1d10', 5: '2d10', 11: '3d10', 17: '4d10' } } } });
  const role = req => String(req.headers['x-test-role'] || '');
  app = express();
  app.use(express.json());
  registerCast(app, {
    ldb,
    genId: () => crypto.randomUUID(),
    getCharacter: async id => ldb.getCharacter(id),
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    notify: n => notes.push(n),
    masterAuth: req => role(req) === 'dm',
    sessionAuth: req => role(req) === 'dm' || role(req) === 'player',
    charAuth: async (charId, req) => {
      if (!ldb.getCharacter(charId)) return 404;
      return req.headers['x-test-char'] === charId ? 200 : 401;
    },
  });
});

const cast = (body, who = 'player', char = 'wiz') => {
  let r = request(app).post(`/api/characters/${char}/cast`).send(body);
  if (who) r = r.set('X-Test-Role', who);
  if (who === 'player') r = r.set('X-Test-Char', 'wiz');
  return r;
};

describe('who may cast', () => {
  beforeEach(() => seed());
  it('refuses a caller with no login', async () => {
    expect((await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 }, null)).status).toBe(401);
  });
  it('refuses a player casting for someone else\'s character', async () => {
    const r = await request(app).post('/api/characters/wiz/cast').set('X-Test-Role', 'player').set('X-Test-Char', 'other')
      .send({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 });
    expect(r.status).toBe(401);
    expect(stored()['slot-3-used']).toBe('0');
  });
  it('lets the DM cast for any character', async () => {
    expect((await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 }, 'dm')).status).toBe(200);
  });
});

describe('spending', () => {
  beforeEach(() => seed());

  it('spends exactly one slot of the chosen level and says what changed', async () => {
    const r = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, keys: ['slot-3-used'], data: { 'slot-3-used': '1' } });
    expect(stored()['slot-3-used']).toBe('1');
    expect(broadcasts.find(b => b.event === 'characters').payload).toMatchObject({ id: 'wiz', keys: ['slot-3-used'] });
  });

  it('upcasts with a higher slot', async () => {
    const r = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 5 });
    expect(r.status).toBe(200);
    expect(stored()['slot-5-used']).toBe('1');
    expect(r.body.entry).toMatchObject({ damage: '10d6', spell: { castLevel: 5, level: 3 } });
  });

  it('refuses a lower slot than the spell, and a level that is spent', async () => {
    expect((await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 1 })).status).toBe(400);
    await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 5 });
    const again = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 5 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SPENT');
    expect(stored()['slot-5-used']).toBe('1');
  });

  it('two casts at once cannot both take the last slot', async () => {
    const [a, b] = await Promise.all([cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 5 }), cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 5 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(stored()['slot-5-used']).toBe('1');
  });

  it('a no-slot spell spends its own use, once', async () => {
    const r = await cast({ spellId: 'sp-ms', mode: 'free' });
    expect(r.status).toBe(200);
    expect(r.body.keys).toEqual(['_spells']);
    expect(storedSpell('sp-ms').used).toBe(1);
    expect((await cast({ spellId: 'sp-ms', mode: 'free' })).status).toBe(409);
  });

  it('a ritual and a cantrip spend nothing', async () => {
    const before = stored();
    expect((await cast({ spellId: 'sp-dm', mode: 'ritual' })).status).toBe(200);
    expect((await cast({ spellId: 'sp-bolt', mode: 'cantrip' })).status).toBe(200);
    expect(stored()).toEqual(before);
    expect(broadcasts.filter(b => b.event === 'characters')).toHaveLength(0);
  });

  it('refuses a spell that is not prepared, and one not on the sheet', async () => {
    const r = await cast({ spellId: 'sp-sh', mode: 'slot', slotLevel: 3 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Not prepared/);
    expect((await cast({ spellId: 'nope', mode: 'cantrip' })).status).toBe(404);
    expect((await cast({ spellId: 'sp-fb', mode: 'teleport' })).status).toBe(400);
  });
});

describe('the chat card', () => {
  beforeEach(() => seed());

  it('goes to the chat log and the table, with the slot it was cast at', async () => {
    const r = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 });
    const log = ldb.listChatLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: 'spell', sender: 'Aliyr', charId: 'wiz',
      spell: { name: 'Fireball', level: 3, castLevel: 3, mode: 'slot', school: 'Evocation', components: 'V, S, M (bat guano)' },
      save: 'Dexterity', saveDc: '15', damage: '8d6', damageType: 'fire',
    });
    expect(log[0].desc).toContain('<b>8d6</b>');
    expect(broadcasts.find(b => b.event === 'chat').payload.id).toBe(r.body.entry.id);
    expect(notes[0]).toMatchObject({ to: 'all', exclude: ['wiz'], title: 'Aliyr cast Fireball' });
  });

  it('uses the library\'s data: attack roll, and cantrip damage by character level', async () => {
    const r = await cast({ spellId: 'sp-bolt', mode: 'cantrip' });
    expect(r.body.entry).toMatchObject({ attack: 'ranged', attackBonus: '+7', damage: '2d10', damageType: 'fire' });
  });

  it('escapes what the sheet typed into the card\'s description', async () => {
    ldb.deleteCharacter('wiz');
    ldb.deleteCharacter('other');
    seed({ _spells: JSON.stringify([{ id: 'x', name: 'Evil', level: 0, entries: ['<img src=x onerror=alert(1)>'] }]) });
    const r = await cast({ spellId: 'x', mode: 'cantrip' });
    expect(r.body.entry.desc).not.toContain('<img');
    expect(r.body.entry.desc).toContain('&lt;img');
  });
});

describe('a sheet still holding pre-v320 spell rows', () => {
  it('finds the spell by name and level, and saves the sheet in the new form', async () => {
    seed({ _spells: JSON.stringify([['3', 'Fireball', '1 Action', '150 ft', false, false, '', true]]) });
    const r = await cast({ spellId: 'whatever-the-page-had', name: 'fireball', level: 3, mode: 'slot', slotLevel: 3 });
    expect(r.status).toBe(200);
    expect(r.body.keys.sort()).toEqual(['_spells', 'slot-3-used']);
    const list = JSON.parse(stored()._spells);
    expect(list[0]).toMatchObject({ name: 'Fireball', level: 3, prepared: true });
    expect(Array.isArray(list[0])).toBe(false);
  });
});
