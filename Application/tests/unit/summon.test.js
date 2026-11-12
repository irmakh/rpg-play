// Written by Irmak Hakman — 2026-11-12 20:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/summon.js — which campaign monsters a summon spell calls up, and a
 * monster as a sheet companion.
 */
import { describe, it, expect } from 'vitest';
import {
  isSummonSpell, summonCandidates, monsterToCompanion, upsertCompanion,
  creaturesInText, filterInText, crNum, damageOf, candidateSummary, bestOfEach,
} from '../../lib/summon.js';

const mon = (id, name, data) => ({ id, name, cr: data.cr ?? '0', data: { name, ...data } });

const OWL = mon('m-owl', 'Owl', { type: 'beast', cr: '0', size: ['T'], ac: [11], hp: { average: 1 }, speed: { walk: 5, fly: 60 }, dex: 13,
  action: [{ name: 'Talons', entries: ['{@atkr m} {@hit 3}, reach 5 ft. {@h}1 Slashing damage.'] }] });
const CAT = mon('m-cat', 'Cat', { type: 'beast', cr: '0', size: ['T'], ac: [12], hp: { average: 2 }, speed: { walk: 40 } });
const BAT_SWARM = mon('m-sw', 'Swarm of Bats', { type: { type: 'beast', swarmSize: 'T' }, cr: '1/4', size: ['M'] });
const WOLF = mon('m-wolf', 'Wolf', { type: 'beast', cr: '1/4', size: ['M'], ac: [12], hp: { average: 11 }, speed: { walk: 40 }, dex: 15,
  action: [{ name: 'Bite', entries: ['{@atk mw} {@hit 4} to hit, reach 5 ft. {@h}7 ({@damage 2d4 + 2}) piercing damage.'] }] });
const BEAR = mon('m-bear', 'Brown Bear', { type: 'beast', cr: '1', size: ['L'] });
const MAMMOTH = mon('m-mam', 'Mammoth', { type: 'beast', cr: '6', size: ['H'] });
const EARTH = mon('m-ee', 'Earth Elemental', { type: 'elemental', cr: '5', size: ['L'] });
const LICH = mon('m-lich', 'Lich', { type: 'undead', cr: '21', size: ['M'] });
const SPIRIT = mon('m-bs', 'Bestial Spirit', {
  type: 'beast', cr: { cr: '' }, size: ['S'], summonedBySpell: 'Summon Beast|XPHB', dex: 14,
  ac: [{ special: '11 + the spell\'s level' }], hp: { special: '20 (Air only) or 30 (Land and Water only) + 5 for each spell level above 2' },
  speed: { walk: 30, climb: 30 },
  action: [{ name: 'Rend', entries: ['{@atkr m} {@hitYourSpellAttack Bonus equals your spell attack modifier}, reach 5 ft. {@h}{@damage 1d8 + 4 + summonSpellLevel} Piercing damage.'] }],
  trait: [{ name: 'Pack Tactics', entries: ['The spirit has {@variantrule Advantage|XPHB} on an attack roll against a creature if at least one of the spirit\'s allies is within 5 feet of the creature.'] }],
});
const ALL = [OWL, CAT, BAT_SWARM, WOLF, BEAR, MAMMOTH, EARTH, LICH, SPIRIT];
const names = list => list.map(m => m.name);

describe('which spells summon', () => {
  it('knows the summon spells by name, in any case', () => {
    expect(isSummonSpell({ name: 'Find Familiar' })).toBe(true);
    expect(isSummonSpell({ name: 'summon beast' })).toBe(true);
    expect(isSummonSpell({ name: 'Conjure Animals' })).toBe(true);
  });
  it('takes any other spell only when it is ticked', () => {
    expect(isSummonSpell({ name: 'Fireball' })).toBe(false);
    expect(isSummonSpell({ name: 'Call the Hounds', summon: true })).toBe(true);
  });
});

describe('reading the spell text', () => {
  it('finds the creatures it names', () => {
    expect(creaturesInText('uses the {@creature Bestial Spirit|XPHB} stat block, or a {@creature Owl}')).toEqual(['bestial spirit', 'owl']);
  });
  it('reads a bestiary filter into a type and highest CR', () => {
    expect(filterInText('another Beast that has a {@filter Challenge Rating of 0|bestiary|challenge rating=[&0]|type=beast|miscellaneous=!swarm}'))
      .toEqual({ maxCr: 0, types: ['beast'] });
  });
  it('reads fractional and object CRs', () => {
    expect(crNum('1/4')).toBe(0.25);
    expect(crNum({ cr: '2' })).toBe(2);
    expect(Number.isNaN(crNum(''))).toBe(true);
  });
});

describe('summon candidates', () => {
  it('Find Familiar: the named familiars and any other CR 0 beast, never a swarm', () => {
    expect(names(summonCandidates({ name: 'Find Familiar' }, null, 1, ALL))).toEqual(['Cat', 'Owl']);
  });
  it('Summon Beast: the stat block its text names, or one that says the spell summons it', () => {
    const viaText = { name: 'Summon Beast', entries: ['uses the {@creature Bestial Spirit|XPHB} stat block.'] };
    expect(names(summonCandidates(viaText, null, 2, ALL))).toEqual(['Bestial Spirit']);
    expect(names(summonCandidates({ name: 'Summon Beast' }, null, 2, ALL))).toEqual(['Bestial Spirit']);
  });
  it('reads the text from the library entry when the sheet row has none', () => {
    const lib = { entries: ['You gain the service of a familiar: {@creature Owl|XMM}.'] };
    expect(names(summonCandidates({ name: 'My Familiar', summon: true }, lib, 1, ALL))).toEqual(['Owl']);
  });
  it('Conjure Animals: beasts of CR 2 or lower', () => {
    expect(names(summonCandidates({ name: 'Conjure Animals' }, null, 3, ALL))).toEqual(['Brown Bear', 'Cat', 'Owl', 'Wolf']);
  });
  it('Conjure Elemental: an elemental of CR up to the slot level', () => {
    expect(names(summonCandidates({ name: 'Conjure Elemental' }, null, 4, ALL))).toEqual([]);
    expect(names(summonCandidates({ name: 'Conjure Elemental' }, null, 5, ALL))).toEqual(['Earth Elemental']);
  });
  it('a ticked spell with nothing to go on summons nothing rather than everything', () => {
    expect(summonCandidates({ name: 'Mystery', summon: true }, null, 3, ALL)).toEqual([]);
  });
});

describe('a monster as a companion', () => {
  it('copies its numbers, size, turn and attacks', () => {
    const c = monsterToCompanion(WOLF, { castLevel: 3, spellName: 'Conjure Animals' });
    expect(c).toMatchObject({ monsterId: 'm-wolf', name: 'Wolf', hpMax: 11, ac: 12, speed: 40, initBonus: 2, initMode: 'shared', size: 1 });
    expect(c.attacks).toEqual([{ name: 'Bite', toHit: '4', damage: '2d4+2 piercing' }]);
    expect(c.notes).toContain('Summoned with Conjure Animals (level 3).');
  });
  it('scales a summoned spirit with the slot and the caster\'s spell attack', () => {
    const c = monsterToCompanion(SPIRIT, { castLevel: 4, spellAtk: '+7' });
    expect(c.hpMax).toBe(40);                 // Land/Water: 30 + 5 for each level above 2
    expect(c.ac).toBe(15);                    // 11 + the spell's level
    expect(c.attacks).toEqual([{ name: 'Rend', toHit: '7', damage: '1d8+8 piercing' }]);
    // The full stat block comes along, with the slot's numbers filled in.
    expect(c.statBlock).toMatchObject({ name: 'Bestial Spirit', dex: 14, hp: { average: 40 }, ac: [15] });
    expect(c.statBlock.trait[0].name).toBe('Pack Tactics');
    expect(c.statBlock.action[0].entries[0]).toContain('{@hit 7}');
    expect(c.statBlock.action[0].entries[0]).toContain('{@damage 1d8+8}');
    expect(c.statBlock.summonedBySpell).toBeUndefined();
    // …so the notes need not repeat its traits.
    expect(c.notes).toBe('');
  });
  it('a stat block too large to keep leaves the traits in the notes instead', () => {
    const big = mon('m-big', 'Chatterbox', { type: 'beast', trait: [{ name: 'Lore', entries: ['x'.repeat(30000)] }] });
    const c = monsterToCompanion(big, { spellName: 'Find Familiar' });
    expect(c.statBlock).toBeUndefined();
    expect(c.notes).toContain('Lore.');
  });
  it('"5 + 10 per spell level" (Otherworldly Steed) scales with the whole slot level', () => {
    const steed = mon('m-st', 'Otherworldly Steed', { type: 'celestial', size: ['L'],
      hp: { special: '5 + 10 per spell level (the steed has a number of Hit Dice [d10s] equal to the spell level)' },
      ac: [{ special: '10 + 1 per spell level' }] });
    expect(monsterToCompanion(steed, { castLevel: 3 })).toMatchObject({ hpMax: 35, ac: 13, size: 2 });
  });
  it('a size from the stat block: Large is 2 cells, Huge 3', () => {
    expect(monsterToCompanion(BEAR).size).toBe(2);
    expect(monsterToCompanion(MAMMOTH).size).toBe(3);
  });
  it('damage: every typed part, not the versatile alternative', () => {
    expect(damageOf('{@h}7 ({@damage 1d10 + 2}) piercing damage plus 3 ({@damage 1d6}) fire damage.')).toBe('1d10+2 piercing, 1d6 fire');
    expect(damageOf('{@h}5 ({@damage 1d8 + 3}) slashing damage, or 6 ({@damage 1d10 + 3}) slashing damage if used with two hands')).toBe('1d8+3 slashing');
    expect(damageOf('{@h}1 Slashing damage.')).toBe('1 slashing');
  });
  it('the picker summary', () => {
    expect(candidateSummary(OWL)).toMatchObject({ id: 'm-owl', name: 'Owl', cr: '0', type: 'beast', hp: 1, ac: 11, speed: 5 });
  });
});

describe('into the companions list', () => {
  it('adds a new companion with a fresh id', () => {
    const r = upsertCompanion([], OWL, { castLevel: 1 }, 'cmp-new');
    expect(r.updated).toBe(false);
    expect(r.list).toHaveLength(1);
    expect(r.companion).toMatchObject({ id: 'cmp-new', name: 'Owl', monsterId: 'm-owl' });
  });
  it('updates the one made from the same monster instead of adding it twice', () => {
    const first = upsertCompanion([{ id: 'cmp-x', name: 'Cat' }], OWL, {}, 'cmp-1').list;
    const again = upsertCompanion(first, OWL, {}, 'cmp-2');
    expect(again.updated).toBe(true);
    expect(again.list).toHaveLength(2);
    expect(again.list[1].id).toBe('cmp-1');
  });
  it('updates a hand-built companion with the same name, keeping its id, turn and picture', () => {
    const mine = { id: 'cmp-owl', name: 'owl', initMode: 'own', portrait: '/uploads/c/companions/p.webp', portraitThumb: '/uploads/c/companions/p_t.webp', hpMax: 99 };
    const r = upsertCompanion([mine], OWL, {}, 'cmp-new');
    expect(r.updated).toBe(true);
    expect(r.list).toHaveLength(1);
    expect(r.companion).toMatchObject({ id: 'cmp-owl', name: 'Owl', initMode: 'own', hpMax: 1,
      portrait: '/uploads/c/companions/p.webp', portraitThumb: '/uploads/c/companions/p_t.webp' });
  });
});

describe('a creature in several books', () => {
  const owl = (id, source) => ({ id, name: 'Owl', source, cr: '0', data: { name: 'Owl', type: 'beast', cr: '0', source } });
  const books = [owl('o-hb', 'HOMEBREW'), owl('o-mm', 'MM'), owl('o-xmm', 'XMM')];
  it('keeps one, from the newest core book', () => {
    expect(bestOfEach(books).map(m => m.id)).toEqual(['o-xmm']);
  });
  it('prefers the book the spell names', () => {
    expect(bestOfEach(books, new Map([['owl', 'mm']])).map(m => m.id)).toEqual(['o-mm']);
    const sp = { name: 'Find Familiar', entries: ['a {@creature Owl|MM}'] };
    expect(summonCandidates(sp, null, 1, books).map(m => m.id)).toEqual(['o-mm']);
  });
  it('falls back to any book when no core book has it', () => {
    expect(bestOfEach([owl('o-hb', 'HOMEBREW')]).map(m => m.id)).toEqual(['o-hb']);
  });
});

describe('the 2024 and 2014 books, both imported', () => {
  const spirit = (id, source) => ({ id, name: 'Bestial Spirit', source, data: { name: 'Bestial Spirit', source } });
  it('prefers the 2024 spirit, unless the spell names the 2014 book', () => {
    const both = [spirit('s-tce', 'TCE'), spirit('s-xphb', 'XPHB')];
    expect(summonCandidates({ name: 'Summon Beast' }, null, 2, both).map(m => m.id)).toEqual(['s-xphb']);
    const old = { name: 'Summon Beast', entries: ['uses the {@creature Bestial Spirit|TCE} stat block'] };
    expect(summonCandidates(old, null, 2, both).map(m => m.id)).toEqual(['s-tce']);
  });
});
