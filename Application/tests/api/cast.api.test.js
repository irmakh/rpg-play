// Written by Irmak Hakman — 2026-11-12 20:25
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

describe('class rules (v325)', () => {
  it('casts an unprepared ritual as a ritual, and refuses it with a slot', async () => {
    seed({ _spells: JSON.stringify([{ id: 'r', name: 'Detect Magic', level: 1, ritual: true, prepared: false }]) });
    expect((await cast({ spellId: 'r', mode: 'slot', slotLevel: 3 })).status).toBe(400);
    expect((await cast({ spellId: 'r', mode: 'ritual' })).status).toBe(200);
    expect(stored()['slot-3-used']).toBe('0');
  });

  it('Warlock: spends a pact slot and casts at the pact level', async () => {
    seed({ class: 'Warlock', 'pact-slots': '2', 'pact-level': '3', 'pact-used': '0',
           _spells: JSON.stringify([{ id: 'h', name: 'Hex', level: 1, entries: ['{@damage 1d6} Necrotic damage'] }]) });
    const r = await cast({ spellId: 'h', mode: 'pact' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ keys: ['pact-used'], data: { 'pact-used': '1' } });
    expect(r.body.entry.spell).toMatchObject({ mode: 'pact', castLevel: 3 });
    await cast({ spellId: 'h', mode: 'pact' });
    expect((await cast({ spellId: 'h', mode: 'pact' })).status).toBe(409);
  });

  it('Warlock: a Mystic Arcanum casts once without a slot', async () => {
    seed({ class: 'Warlock', _spells: JSON.stringify([{ id: 'e', name: 'Eyebite', level: 6 }]) });
    expect((await cast({ spellId: 'e', mode: 'free' })).status).toBe(200);
    expect(storedSpell('e').used).toBe(1);
    expect((await cast({ spellId: 'e', mode: 'free' })).status).toBe(409);
  });

  it('Sorcerer: Metamagic costs sorcery points, is checked first, and shows on the card', async () => {
    seed({ class: 'Sorcerer', 'sorc-points': '3', 'sorc-used': '0', 'mm-quickened': true, 'mm-twinned': true });
    const r = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3, metamagic: ['quickened', 'twinned'] });
    expect(r.status).toBe(200);
    expect(stored()['sorc-used']).toBe('3');
    expect(r.body.entry).toMatchObject({ metamagic: ['Quickened Spell', 'Twinned Spell'], points: 3, spell: { castText: '1 Bonus Action (Quickened)' } });
    // no points left: refused before the slot is spent
    const broke = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3, metamagic: ['twinned'] });
    expect(broke.status).toBe(409);
    expect(stored()['slot-3-used']).toBe('1');
  });

  it('refuses Metamagic the character does not know', async () => {
    seed({ class: 'Sorcerer', 'sorc-points': '5', 'mm-quickened': true });
    expect((await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3, metamagic: ['heightened'] })).status).toBe(400);
    expect(stored()['slot-3-used']).toBe('0');
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

// ── Summon spells (lib/summon.js) ─────────────────────────────────────────────
describe('summon spells', () => {
  const FAMILIAR = { id: 'sp-ff', name: 'Find Familiar', level: 1, ritual: true, prepared: true };
  const SBEAST = { id: 'sp-sb', name: 'Summon Beast', level: 2, prepared: true,
    entries: ['uses the {@creature Bestial Spirit|XPHB} stat block.'] };
  // Summons come from the 3rd Party monsters (imported books); `ids` maps a
  // test's short name to the id the book import gives the monster.
  const ids = {};
  const addMonster = (key, name, data, source = 'XMM') => {
    ldb.upsertOfficialMonsters([{ name, source, cr: data.cr, type: data.type, data: { name, source, ...data } }]);
    ids[key] = ldb.officialMonsterId(source, name);
  };
  const companions = () => JSON.parse(stored()._companions || '[]');
  beforeEach(() => {
    seed({ 'slot-2-total': '2', 'slot-2-used': '0', 'slot-1-used': '0',
           _spells: JSON.stringify([FIREBALL, FAMILIAR, SBEAST]) });
    addMonster('m-owl', 'Owl', { type: 'beast', cr: '0', size: ['T'], ac: [11], hp: { average: 1 }, speed: { walk: 5, fly: 60 } });
    addMonster('m-cat', 'Cat', { type: 'beast', cr: '0', size: ['T'], ac: [12], hp: { average: 2 }, speed: { walk: 40 } });
    addMonster('m-lich', 'Lich', { type: 'undead', cr: '21' });
  });

  it('a spell that summons nothing says nothing about it', async () => {
    const r = await cast({ spellId: 'sp-fb', mode: 'slot', slotLevel: 3 });
    expect(r.body.summon).toBeUndefined();
  });

  it('one candidate goes straight into the companions', async () => {
    addMonster('m-bs', 'Bestial Spirit', { type: 'beast', cr: '', size: ['S'], hp: { special: '30 + 5 for each spell level above 2' }, ac: [{ special: '11 + the spell\'s level' }] });
    const r = await cast({ spellId: 'sp-sb', mode: 'slot', slotLevel: 3 });
    expect(r.status).toBe(200);
    expect(r.body.summon).toMatchObject({ spell: 'Summon Beast', added: { name: 'Bestial Spirit', updated: false } });
    expect(r.body.keys).toContain('_companions');
    expect(JSON.parse(r.body.data._companions)).toHaveLength(1);
    expect(companions()[0]).toMatchObject({ name: 'Bestial Spirit', monsterId: ids['m-bs'], hpMax: 35, ac: 14, size: 1 });
    expect(broadcasts.some(b => b.event === 'characters' && b.payload.keys.includes('_companions'))).toBe(true);
  });

  it('several candidates come back to pick from, and nothing is added yet', async () => {
    const r = await cast({ spellId: 'sp-ff', mode: 'ritual' });
    expect(r.status).toBe(200);
    expect(r.body.summon.candidates.map(c => c.name)).toEqual(['Cat', 'Owl']);
    expect(r.body.summon).toMatchObject({ spellId: 'sp-ff', castLevel: 1 });
    expect(companions()).toEqual([]);
  });

  it('none that fit says so', async () => {
    const r = await cast({ spellId: 'sp-sb', mode: 'slot', slotLevel: 2 });
    expect(r.body.summon).toMatchObject({ spell: 'Summon Beast', none: true });
  });

  const pick = (body, who = 'player', asChar = 'wiz') => {
    let q = request(app).post('/api/characters/wiz/summon').send(body);
    if (who) q = q.set('X-Test-Role', who);
    if (who === 'player') q = q.set('X-Test-Char', asChar);
    return q;
  };

  it('the pick adds that creature, and picking it again updates it instead of adding a second', async () => {
    const r = await pick({ spellId: 'sp-ff', castLevel: 1, monsterId: ids['m-owl'] });
    expect(r.status).toBe(200);
    expect(r.body.summon.added).toEqual({ name: 'Owl', updated: false });
    expect(JSON.parse(r.body.data._companions)[0]).toMatchObject({ name: 'Owl', monsterId: ids['m-owl'] });
    const again = await pick({ spellId: 'sp-ff', castLevel: 1, monsterId: ids['m-owl'] });
    expect(again.body.summon.added.updated).toBe(true);
    expect(companions()).toHaveLength(1);
  });

  it('refuses a monster the spell may not summon', async () => {
    const r = await pick({ spellId: 'sp-ff', castLevel: 1, monsterId: ids['m-lich'] });
    expect(r.status).toBe(400);
    expect(companions()).toEqual([]);
  });

  it('refuses a spell that is not a summon spell, and someone else\'s character', async () => {
    expect((await pick({ spellId: 'sp-fb', castLevel: 3, monsterId: ids['m-owl'] })).status).toBe(404);
    expect((await pick({ spellId: 'sp-ff', castLevel: 1, monsterId: ids['m-owl'] }, 'player', 'other')).status).toBe(401);
    expect((await pick({ spellId: 'sp-ff', castLevel: 1, monsterId: ids['m-owl'] }, null)).status).toBe(401);
  });

  it('a spell ticked "Summons a creature" works like a known one', async () => {
    const HOUNDS = { id: 'sp-h', name: 'Call the Hounds', level: 1, prepared: true, summon: true,
      entries: ['A spectral {@creature Cat} answers.'] };
    ldb.updateCharacter('wiz', { dataJson: JSON.stringify({ ...stored(), _spells: JSON.stringify([HOUNDS]) }) });
    const r = await cast({ spellId: 'sp-h', mode: 'slot', slotLevel: 1 });
    expect(r.body.summon.added).toMatchObject({ name: 'Cat' });
  });

  it("only 3rd Party monsters are offered, not the DM's custom ones", async () => {
    ldb.createMonster('own-cat', { name: 'Shadow Cat', cr: '0', dataJson: JSON.stringify({ name: 'Shadow Cat', type: 'beast', cr: '0' }) });
    const r = await cast({ spellId: 'sp-ff', mode: 'ritual' });
    expect(r.body.summon.candidates.map(c => c.name)).toEqual(['Cat', 'Owl']);
  });

  it('a creature in several books is offered once, from the newest core book', async () => {
    addMonster('m-owl-mm', 'Owl', { type: 'beast', cr: '0', size: ['T'], ac: [11], hp: { average: 1 } }, 'MM');
    addMonster('m-owl-hb', 'Owl', { type: 'beast', cr: '0', size: ['T'], ac: [13], hp: { average: 3 } }, 'HOMEBREW');
    const r = await cast({ spellId: 'sp-ff', mode: 'ritual' });
    const owls = r.body.summon.candidates.filter(c => c.name === 'Owl');
    expect(owls).toHaveLength(1);
    expect(owls[0]).toMatchObject({ id: ids['m-owl'], source: 'XMM' });
  });
});

describe('summon spells search only what is imported', () => {
  it('never fetches anything: a creature in no imported book is not found', async () => {
    seed({ 'slot-2-total': '2', 'slot-2-used': '0',
           _spells: JSON.stringify([{ id: 'sp-sb', name: 'Summon Beast', level: 2, prepared: true }]) });
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async () => { fetched++; throw new Error('no network'); };
    try {
      const r = await cast({ spellId: 'sp-sb', mode: 'slot', slotLevel: 2 });
      expect(r.status).toBe(200);
      expect(r.body.summon).toMatchObject({ spell: 'Summon Beast', none: true });
      expect(fetched).toBe(0);
    } finally { globalThis.fetch = realFetch; }
  });
});
