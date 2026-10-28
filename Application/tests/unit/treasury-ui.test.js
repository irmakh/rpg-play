// Written by Irmak Hakman — 2026-10-28 16:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for the pure half of js/treasury.js — the DM treasury screen.
 *
 * Everything above the "Page state" marker takes values and returns values:
 * what a typed price or stock means, where a pile's items are, which piles
 * there are, what a search finds, how many "Give pile" hands over, and which
 * groups of fields a kind of item shows. That slice is run here as the real file.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/treasury.js'), 'utf-8');
const MARK = '// ── Page state';
if (!SRC.includes(MARK)) throw new Error('treasury.js: "Page state" marker not found');

const ctx = createContext({ console });
runInContext(SRC.slice(0, SRC.indexOf(MARK))
  + '\n;globalThis.__t = { parsePrice, parseStock, stockText, cpToGp, pileState, pileEntries, searchItems, giveQty, kindOf, sectionShown, kindSummary, KINDS };', ctx);
const T = ctx.__t;
const arr = x => Array.from(x);

const item = (id, over = {}) => ({
  id, name: 'Item ' + id, tag: '', mode: 'hidden', itemType: 'other', valueCp: 0, quantity: 1,
  descVisible: true, description: '', unidName: '', charges: 0, weaponProperties: [], ...over,
});

describe('parsePrice', () => {
  it('reads a bare number as gold', () => {
    expect(T.parsePrice('50')).toBe(5000);
    expect(T.parsePrice('12.5')).toBe(1250);
    expect(T.parsePrice('1,200')).toBe(120000);
  });
  it('reads coins, alone or together, spaced or not', () => {
    expect(T.parsePrice('50 gp')).toBe(5000);
    expect(T.parsePrice('7sp')).toBe(70);
    expect(T.parsePrice('2 pp 5 gp')).toBe(2500);
    expect(T.parsePrice('1 EP 3 CP')).toBe(53);
  });
  it('treats an empty box as free', () => {
    expect(T.parsePrice('')).toBe(0);
    expect(T.parsePrice('   ')).toBe(0);
  });
  it('refuses what is not a price', () => {
    expect(T.parsePrice('cheap')).toBeNull();
    expect(T.parsePrice('50 gold')).toBeNull();
    expect(T.parsePrice('5 gp and a favour')).toBeNull();
    expect(T.parsePrice('-5')).toBeNull();
  });
});

describe('stock', () => {
  it('shows no limit as ∞ and reads it back', () => {
    expect(T.stockText(-1)).toBe('∞');
    expect(T.stockText(4)).toBe('4');
    for (const s of ['∞', 'unlimited', '-1', 'INF']) expect(T.parseStock(s)).toBe(-1);
  });
  it('reads a whole number and refuses anything else', () => {
    expect(T.parseStock('12')).toBe(12);
    expect(T.parseStock('0')).toBe(0);
    expect(T.parseStock('1.5')).toBeNull();
    expect(T.parseStock('-3')).toBeNull();
    expect(T.parseStock('lots')).toBeNull();
    expect(T.parseStock('')).toBeNull();
  });
});

describe('pileState', () => {
  it('names the one place all of a pile is in', () => {
    expect(T.pileState([item('a', { mode: 'loot' }), item('b', { mode: 'loot' })]).state).toBe('loot');
    expect(T.pileState([item('a', { mode: 'shop' })]).state).toBe('shop');
    expect(T.pileState([item('a')]).state).toBe('hidden');
  });
  it('is mixed when its items disagree, and counts each place', () => {
    const s = T.pileState([item('a', { mode: 'loot' }), item('b'), item('c', { mode: 'loot' })]);
    expect(s.state).toBe('mixed');
    expect({ ...s.counts }).toEqual({ hidden: 1, loot: 2, shop: 0 });
  });
  it('is empty with nothing in it', () => {
    expect(T.pileState([]).state).toBe('empty');
    expect(T.pileState(undefined).state).toBe('empty');
  });
});

describe('pileEntries', () => {
  const items = [
    item('a', { tag: 'Market', mode: 'shop' }), item('b', { tag: 'Market', mode: 'shop' }),
    item('c', { tag: 'Crypt', mode: 'loot' }), item('d', { tag: '' }),
  ];
  const rows = [{ tag: 'Crypt', note: 'Behind the altar' }, { tag: 'Armoury', note: '' }];
  const list = () => arr(T.pileEntries(items, rows, [{ itemId: 'c' }, { itemId: 'c' }, { itemId: 'gone' }]));

  it('lists every tag in use and every pile row, by name, with Unsorted last', () => {
    expect(list().map(p => p.tag)).toEqual(['Armoury', 'Crypt', 'Market', '']);
  });
  it('keeps an empty pile, and its note', () => {
    const crypt = list().find(p => p.tag === 'Crypt');
    expect(crypt.note).toBe('Behind the altar');
    expect(list().find(p => p.tag === 'Armoury')).toMatchObject({ state: 'empty' });
    expect(arr(list().find(p => p.tag === 'Armoury').items)).toEqual([]);
  });
  it('gives each pile its items, its state and the requests waiting on it', () => {
    const market = list().find(p => p.tag === 'Market');
    expect(arr(market.items).map(i => i.id)).toEqual(['a', 'b']);
    expect(market.state).toBe('shop');
    expect(list().find(p => p.tag === 'Crypt').asks).toBe(2);
    expect(market.asks).toBe(0);
  });
  it('leaves Unsorted out when nothing is unsorted', () => {
    const tags = arr(T.pileEntries(items.filter(i => i.tag), [], [])).map(p => p.tag);
    expect(tags).toEqual(['Crypt', 'Market']);
  });
});

describe('searchItems', () => {
  const items = [
    item('a', { tag: 'Market', name: 'Potion of Healing' }),
    item('b', { tag: 'Market', name: 'Emberglass Dagger', description: 'A blade of red glass' }),
    item('c', { tag: 'Crypt', name: 'Obsidian Ring', unidName: 'Black Stone Band' }),
  ];
  const ids = q => arr(T.searchItems(items, q)).map(i => i.id);
  it('finds by name, the name players see, description and pile, without minding capitals', () => {
    expect(ids('GLASS')).toEqual(['b']);
    expect(ids('black stone')).toEqual(['c']);
    expect(ids('market')).toEqual(['a', 'b']);
  });
  it('returns everything for an empty search, and nothing for no match', () => {
    expect(ids('  ')).toEqual(['a', 'b', 'c']);
    expect(ids('zzz')).toEqual([]);
  });
});

describe('giveQty', () => {
  it('hands over the whole stock, one of an endless one, and none of a spent one', () => {
    expect(T.giveQty(item('a', { quantity: 4 }))).toBe(4);
    expect(T.giveQty(item('a', { quantity: -1 }))).toBe(1);
    expect(T.giveQty(item('a', { quantity: 0 }))).toBe(0);
  });
  it('never asks the server for more than 100 at once', () => {
    expect(T.giveQty(item('a', { quantity: 500 }))).toBe(100);
  });
});

describe('kinds', () => {
  it('offers the six kinds, and falls back to Other for one it does not know', () => {
    expect(arr(T.KINDS).map(k => k.key)).toEqual(['weapon', 'armor', 'shield', 'potion', 'wondrous', 'other']);
    expect(T.kindOf('mystery').key).toBe('other');
  });
  it('shows only the fields a kind uses', () => {
    const potion = item('p', { itemType: 'potion' });
    expect(T.sectionShown(potion, 'charges')).toBe(true);
    expect(T.sectionShown(potion, 'weapon')).toBe(false);
    expect(T.sectionShown(potion, 'bonuses')).toBe(false);
    const sword = item('s', { itemType: 'weapon' });
    expect(T.sectionShown(sword, 'weapon')).toBe(true);
    expect(T.sectionShown(sword, 'armor')).toBe(false);
  });
  it('never hides a group that already holds something', () => {
    const odd = item('o', { itemType: 'potion', acBonus: 1, weaponDmg: '1d4' });
    expect(T.sectionShown(odd, 'bonuses')).toBe(true);
    expect(T.sectionShown(odd, 'weapon')).toBe(true);
  });
  it('sums an item up in one line', () => {
    expect(T.kindSummary(item('s', { itemType: 'weapon', weaponAtk: '1', weaponDmg: '1d8 slashing' }))).toBe('Weapon · +1 · 1d8 slashing');
    expect(T.kindSummary(item('a', { itemType: 'armor', acBase: 14 }))).toBe('Armour · AC 14');
    expect(T.kindSummary(item('r', { itemType: 'wondrous', charges: 3, requiresAttunement: true }))).toBe('Wondrous · 3 charges · attunement');
    expect(T.kindSummary(item('p', { itemType: 'potion', charges: 1 }))).toBe('Potion · 1 charge');
  });
});
