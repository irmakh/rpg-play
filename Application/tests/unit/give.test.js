// Written by Irmak Hakman — 2026-11-15 12:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/give.js — one character handing an item or coins to another.
 */
import { describe, it, expect } from 'vitest';
import { moveItem, moveCoins, cleanCoins, coinsLabel, GiveError } from '../../lib/give.js';

const SWORD = { id: 3, name: 'Flame Tongue', itemType: 'weapon', weaponAtk: '1', weaponDmg: '1d8 slashing',
                weaponProperties: ['Versatile'], equipped: true, attuned: true, srcId: 'tr-1', notes: 'Hot — Versatile',
                charges: 3, chargesUsed: 1 };
const RING = { id: 4, name: 'Dull Iron Ring', itemType: 'wondrous', unidentified: true, equipped: false };
const SPEAR = { id: 5, name: 'Spear', itemType: 'weapon', unidentified: true, weaponDmg: '', equipped: false };

function giver() {
  return {
    _items: JSON.stringify([SWORD, RING, SPEAR]),
    _weapons: JSON.stringify([['Flame Tongue', '+6', '1d8+4 slashing', 'Hot', 3], ['Dagger', '+5', '1d4+3', '', null]]),
    _itemIdCounter: 5,
    gp: '20', sp: '7', cp: '', pp2: '1',
  };
}
const row = (data, it) => [it.name, '+9', it.weaponDmg, it.notes];

describe('moveItem', () => {
  it('takes the item and its attack row from the giver, and leaves the rest', () => {
    const from = giver(), to = {};
    moveItem(from, to, 3, row);
    expect(JSON.parse(from._items).map(i => i.id)).toEqual([4, 5]);
    expect(JSON.parse(from._weapons)).toEqual([['Dagger', '+5', '1d4+3', '', null]]);
  });

  it('hands it over as it is held, but taken off and out of attunement, under a new id', () => {
    const from = giver();
    const to = { _items: JSON.stringify([{ id: 1, name: 'Rope' }, { id: 7, name: 'Torch' }]), _itemIdCounter: 7 };
    const { item, wasEquipped } = moveItem(from, to, 3, row);
    expect(wasEquipped).toBe(true);
    expect(item).toMatchObject({ id: 8, name: 'Flame Tongue', srcId: 'tr-1', equipped: false, attuned: false, charges: 3, chargesUsed: 1 });
    expect(to._itemIdCounter).toBe(8);
    expect(JSON.parse(to._items).map(i => i.id)).toEqual([1, 7, 8]);
  });

  it('builds the attack row again for the receiver, tied to the new id', () => {
    const from = giver(), to = { _weapons: JSON.stringify([['Club', '+2', '1d4', '', null]]) };
    moveItem(from, to, 3, row);
    expect(JSON.parse(to._weapons)).toEqual([['Club', '+2', '1d4', '', null], ['Flame Tongue', '+9', '1d8 slashing', 'Hot — Versatile', 1]]);
  });

  it('never gives an unidentified weapon an attack row, and keeps it unidentified', () => {
    const from = giver(), to = {};
    const { item } = moveItem(from, to, 5, row);
    expect(item.unidentified).toBe(true);
    expect(to._weapons).toBeUndefined();
  });

  it('finds the item whether its id came as a number or a string', () => {
    const from = giver(), to = {};
    expect(moveItem(from, to, '4', row).item.name).toBe('Dull Iron Ring');
  });

  it('refuses an item the giver does not hold, changing nothing', () => {
    const from = giver(), to = {};
    const before = JSON.stringify(from);
    expect(() => moveItem(from, to, 99, row)).toThrow(GiveError);
    expect(JSON.stringify(from)).toBe(before);
    expect(to).toEqual({});
  });

  it('copes with a receiver whose lists are missing or broken', () => {
    const from = giver(), to = { _items: 'not json', _weapons: '{' };
    const { item } = moveItem(from, to, 3, row);
    expect(item.id).toBe(1);
    expect(JSON.parse(to._weapons)).toHaveLength(1);
  });
});

describe('moveCoins', () => {
  it('moves coin for coin, as strings the sheet keeps', () => {
    const from = giver(), to = { gp: '3' };
    const c = moveCoins(from, to, { gp: 5, pp: 1 });
    expect(c).toEqual({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 1 });
    expect(from).toMatchObject({ gp: '15', pp2: '0', sp: '7' });
    expect(to).toMatchObject({ gp: '8', pp2: '1' });
    expect(to.sp).toBeUndefined();
  });

  it('never changes coins into other coins: not enough of one kind is refused', () => {
    const from = giver(), to = {};
    expect(() => moveCoins(from, to, { sp: 8 })).toThrow('Not enough SP');
    expect(from.sp).toBe('7');
    expect(to).toEqual({});
  });

  it('refuses nothing, fractions, negatives and text', () => {
    expect(() => cleanCoins({})).toThrow(GiveError);
    expect(() => cleanCoins(null)).toThrow(GiveError);
    expect(() => cleanCoins({ gp: 1.5 })).toThrow(GiveError);
    expect(() => cleanCoins({ gp: -2 })).toThrow(GiveError);
    expect(() => cleanCoins({ gp: 'lots' })).toThrow(GiveError);
    expect(cleanCoins({ gp: '4', sp: '' })).toEqual({ cp: 0, sp: 0, ep: 0, gp: 4, pp: 0 });
  });
});

describe('coinsLabel', () => {
  it('reads from the most valuable coin down', () => {
    expect(coinsLabel({ cp: 3, sp: 0, ep: 0, gp: 12, pp: 1 })).toBe('1 PP, 12 GP, 3 CP');
  });
});
