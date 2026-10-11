// Written by Irmak Hakman — 2026-10-12 00:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for the pure half of js/treasury.js — the DM treasury screen.
 *
 * Everything above the "Page state" marker takes values and returns values:
 * what a typed price or stock means, which items a tag view shows, how they
 * sort, what the tag picker and the shop strip offer, and which groups of
 * fields a kind of item shows. That slice is run here as the real file.
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
  + '\n;globalThis.__t = { parsePrice, parseStock, stockText, cpToGp, cpToDenoms, itemsInView, sortItems, tagEntries, shopTagsAfterToggle, kindOf, sectionShown, kindSummary, KINDS, VIEW_ALL, VIEW_ASKED };', ctx);
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

describe('itemsInView', () => {
  const items = [
    item('a', { tag: 'Market', mode: 'shop', name: 'Potion of Healing' }),
    item('b', { tag: 'Market', mode: 'hidden', name: 'Emberglass Dagger', description: 'A blade of red glass' }),
    item('c', { tag: 'Crypt', mode: 'loot', name: 'Obsidian Ring', unidName: 'Black Stone Band' }),
    item('d', { tag: '', mode: 'hidden', name: 'Loose Coins' }),
  ];
  const ids = f => arr(T.itemsInView(items, { mode: 'all', q: '', ...f })).map(i => i.id);

  it('shows one tag at a time', () => {
    expect(ids({ view: 'Market' })).toEqual(['a', 'b']);
    expect(ids({ view: 'Crypt' })).toEqual(['c']);
  });
  it('has a view for items with no tag, one for everything, and one for what is asked for', () => {
    expect(ids({ view: '' })).toEqual(['d']);
    expect(ids({ view: T.VIEW_ALL })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ view: T.VIEW_ASKED, askedIds: new Set(['c']) })).toEqual(['c']);
    expect(ids({ view: T.VIEW_ASKED })).toEqual([]);
  });
  it('narrows by where the item is', () => {
    expect(ids({ view: 'Market', mode: 'shop' })).toEqual(['a']);
    expect(ids({ view: T.VIEW_ALL, mode: 'hidden' })).toEqual(['b', 'd']);
  });
  it('searches name, the name players see, description and tag — inside the view', () => {
    expect(ids({ view: T.VIEW_ALL, q: 'GLASS' })).toEqual(['b']);
    expect(ids({ view: T.VIEW_ALL, q: 'black stone' })).toEqual(['c']);
    expect(ids({ view: T.VIEW_ALL, q: 'market' })).toEqual(['a', 'b']);
    expect(ids({ view: 'Crypt', q: 'potion' })).toEqual([]);
  });
});

describe('sortItems', () => {
  const items = [
    item('a', { name: 'Zebra hide', valueCp: 100, quantity: 5, mode: 'shop' }),
    item('b', { name: 'apple', valueCp: 900, quantity: -1, mode: 'hidden', descVisible: false }),
    item('c', { name: 'Mace', valueCp: 100, quantity: 0, mode: 'loot' }),
  ];
  const order = (key, dir, fn) => arr(T.sortItems(items, key, dir, fn)).map(i => i.id);
  it('sorts by name without minding capitals', () => {
    expect(order('name', 'asc')).toEqual(['b', 'c', 'a']);
    expect(order('name', 'desc')).toEqual(['a', 'c', 'b']);
  });
  it('sorts by price, breaking ties by name', () => {
    expect(order('price', 'asc')).toEqual(['c', 'a', 'b']);
    expect(order('price', 'desc')).toEqual(['b', 'c', 'a']);
  });
  it('puts unlimited stock above any number', () => {
    expect(order('stock', 'desc')[0]).toBe('b');
    expect(order('stock', 'asc')).toEqual(['c', 'a', 'b']);
  });
  it('sorts by place, by state and by how many are asking', () => {
    expect(order('mode', 'asc')).toEqual(['b', 'c', 'a']);
    expect(order('state', 'asc')[0]).toBe('b');
    expect(order('asked', 'desc', id => (id === 'c' ? 2 : 0))[0]).toBe('c');
  });
  it('does not change the list it was given', () => {
    T.sortItems(items, 'name', 'asc');
    expect(items.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('tagEntries', () => {
  const items = [
    item('a', { tag: 'Market', mode: 'shop' }), item('b', { tag: 'Market', mode: 'hidden' }),
    item('c', { tag: 'Crypt', mode: 'loot' }), item('d', { tag: '' }), item('e', { tag: 'Armoury', mode: 'shop' }),
  ];
  const by = (open, active) => Object.fromEntries(arr(T.tagEntries(items, open, active)).map(e => [e.tag, e]));
  it('counts each tag and lists them by name, with "no tag" last', () => {
    const list = arr(T.tagEntries(items, true, []));
    expect(list.map(e => e.tag)).toEqual(['Armoury', 'Crypt', 'Market', '']);
    expect(list.find(e => e.tag === 'Market')).toMatchObject({ count: 2, forSale: 1 });
  });
  it('marks a tag as on sale only when its shop items can be bought now', () => {
    expect(by(true, []).Market.onSale).toBe(true);
    expect(by(true, []).Crypt.onSale).toBe(false);            // nothing of it is in the shop
    expect(by(true, ['Armoury']).Market.onSale).toBe(false);  // the shop sells another tag
    expect(by(true, ['Armoury']).Armoury.onSale).toBe(true);
    expect(by(false, []).Market.onSale).toBe(false);          // the shop is closed
  });
});

describe('shopTagsAfterToggle', () => {
  it('adds a tag, takes it off, and goes back to everything when the last one goes', () => {
    expect(arr(T.shopTagsAfterToggle([], 'Market'))).toEqual(['Market']);
    expect(arr(T.shopTagsAfterToggle(['Market'], 'Crypt'))).toEqual(['Market', 'Crypt']);
    expect(arr(T.shopTagsAfterToggle(['Market', 'Crypt'], 'Market'))).toEqual(['Crypt']);
    expect(arr(T.shopTagsAfterToggle(['Market'], 'Market'))).toEqual([]);
    expect(arr(T.shopTagsAfterToggle(undefined, 'Market'))).toEqual(['Market']);
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
