// Written by Irmak Hakman — 2026-11-11 18:14
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/monster-source.js — the 5etools bestiary books for the official monsters.
 * No network: fetch is a stub serving a tiny fake mirror.
 */
import { describe, it, expect } from 'vitest';
import { fetchBestiaryBooks, listBestiaryBooks, resolveCopy, toRow, MIRROR } from '../../lib/monster-source.js';

const SPAWN = { name: 'Vampire Spawn', source: 'MM', cr: '5', type: 'undead', hp: { average: 82 }, str: 16,
  trait: [{ name: 'Regeneration', entries: ['The vampire regains 10 hit points. {@b the vampire} stays.'] }],
  action: [{ name: 'Multiattack', entries: ['Two attacks.'] }, { name: 'Claws', entries: ['Hit.'] }, { name: 'Bite', entries: ['Bite.'] }],
  spellcasting: [{ name: 'Spellcasting', will: ['{@spell light}'], daily: { '1e': ['{@spell fear}'] } }] };

const FILES = {
  'bestiary/index.json': { MM: 'bestiary-mm.json', CoS: 'bestiary-cos.json', EVIL: '../../etc/passwd' },
  'books.json': { book: [{ id: 'MM', name: 'Monster Manual (2014)' }] },
  'adventures.json': { adventure: [{ id: 'CoS', name: 'Curse of Strahd' }] },
  'bestiary/bestiary-mm.json': { monster: [SPAWN, { name: 'Goblin', source: 'MM', cr: { cr: '1/4' }, type: { type: 'humanoid', tags: ['goblinoid'] } }] },
  'bestiary/bestiary-cos.json': { monster: [
    { name: 'Anastrasya', source: 'CoS', isNamedCreature: true, _copy: { name: 'Vampire Spawn', source: 'MM', _mod: {
      '*': { mode: 'replaceTxt', replace: 'the vampire', with: 'Anastrasya', flags: 'i' },
      action: [{ mode: 'removeArr', names: 'Bite' }, { mode: 'replaceArr', replace: 'Claws', items: { name: 'Rapier', entries: ['Stab.'] } }],
      trait: { mode: 'appendArr', items: { name: 'Charm', entries: ['New.'] } },
      _: [{ mode: 'setProp', prop: 'hp.average', value: 99 }, { mode: 'replaceSpells', daily: { '1e': [{ replace: '{@spell fear}', with: '{@spell hold person}' }] } }],
    } } },
    { name: 'Ghost of Nothing', source: 'CoS', _copy: { name: 'Missing', source: 'MM' } },
  ] },
};

const fakeFetch = async (url) => {
  const key = url.slice(MIRROR.length + 1);
  const body = FILES[key];
  return { ok: !!body, status: body ? 200 : 404, text: async () => JSON.stringify(body) };
};

describe('listBestiaryBooks', () => {
  it('lists plain book files with their real names, and nothing else', async () => {
    const books = await listBestiaryBooks(fakeFetch);
    expect(books).toEqual([
      { code: 'MM', name: 'Monster Manual (2014)', file: 'bestiary-mm.json' },
      { code: 'CoS', name: 'Curse of Strahd', file: 'bestiary-cos.json' }]);
  });
});

describe('fetchBestiaryBooks', () => {
  it('resolves copies from a book that was not chosen, and reports what it cannot build', async () => {
    const out = await fetchBestiaryBooks(['CoS'], fakeFetch);
    expect(out.books).toEqual([{ code: 'CoS', name: 'Curse of Strahd', count: 1 }]);
    expect(out.unresolved).toEqual(['Ghost of Nothing']);
    const a = out.monsters[0];
    expect(a).toMatchObject({ name: 'Anastrasya', source: 'CoS', cr: '5', type: 'undead' });
    expect(a.data._copy).toBeUndefined();
    expect(a.data.hp).toEqual({ average: 99 });
    expect(a.data.trait.map(t => t.name)).toEqual(['Regeneration', 'Charm']);
    // Text outside tags changes; the tag and the names stay.
    expect(a.data.trait[0].entries[0]).toBe('Anastrasya regains 10 hit points. {@b the vampire} stays.');
    expect(a.data.action.map(x => x.name)).toEqual(['Multiattack', 'Rapier']);
    expect(a.data.spellcasting[0].daily['1e']).toEqual(['{@spell hold person}']);
    expect(a.data.isNamedCreature).toBe(true);
    // The original is untouched.
    expect(SPAWN.action).toHaveLength(3);
  });

  it('refuses a book it does not offer', async () => {
    await expect(fetchBestiaryBooks(['EVIL'], fakeFetch)).rejects.toThrow(/Unknown book/);
  });
});

describe('toRow', () => {
  it('reads CR and type in their object forms', () => {
    expect(toRow({ name: 'Goblin', source: 'MM', cr: { cr: '1/4' }, type: { type: 'humanoid', tags: ['goblinoid'] } }, 'MM'))
      .toMatchObject({ cr: '1/4', type: 'humanoid' });
    expect(toRow({ name: 'Odd', type: { type: { choose: ['beast', 'monstrosity'] } } }, 'X')).toMatchObject({ source: 'X', cr: '?', type: 'beast/monstrosity' });
  });

  it('gives up on a copy loop instead of hanging', () => {
    const a = { name: 'A', source: 'X', _copy: { name: 'B', source: 'X' } };
    const b = { name: 'B', source: 'X', _copy: { name: 'A', source: 'X' } };
    expect(resolveCopy(a, new Map([['a|X', a], ['b|X', b]]))).toBeNull();
  });
});
