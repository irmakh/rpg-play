// Written by Irmak Hakman — 2026-11-12 13:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/** lib/item-source.js: 5etools text and items into treasury fields (no network). */
import { describe, it, expect } from 'vitest';
import { plainText, entriesText, toTreasuryFields, itemHeader, itemKind, isMagic } from '../../lib/item-source.js';

describe('plainText', () => {
  it('turns 5etools tags into words', () => {
    expect(plainText('Cast {@spell fireball} ({@dc 15}), {@hit 5} to hit, {@damage 2d6} fire.')).toBe('Cast fireball (DC 15), +5 to hit, 2d6 fire.');
    expect(plainText('{@item Bag of Holding|XDMG|the bag} and {@condition Prone|XPHB}')).toBe('the bag and Prone');
    expect(plainText('{@b {@i nested}} {@chance 25}')).toBe('nested 25 percent');
  });
});

describe('entriesText', () => {
  it('keeps paragraphs, named entries, lists and tables readable', () => {
    const txt = entriesText([
      'First.',
      { type: 'entries', name: 'Lightning Bolt', entries: ['It zaps.'] },
      { type: 'list', items: ['One', { type: 'item', name: 'Two', entry: 'second' }] },
      { type: 'table', colLabels: ['d6', 'Effect'], rows: [[{ type: 'cell', roll: { min: 1, max: 3 } }, 'Fog'], ['4', 'Rain']] },
    ]);
    expect(txt).toBe('First.\n\nLightning Bolt. It zaps.\n\n• One\n• Two. second\n\nd6 | Effect\n1–3 | Fog\n4 | Rain');
  });
});

describe('toTreasuryFields', () => {
  it('armour, shields and generic variants', () => {
    expect(toTreasuryFields({ name: 'Mithral Plate', type: 'HA', ac: 18, rarity: 'uncommon', _baseName: 'Plate Armor' }))
      .toMatchObject({ itemType: 'armor', armorType: 'heavy', acBase: 18 });
    expect(toTreasuryFields({ name: '+1 Shield', type: 'S', ac: 2, bonusAc: '+1', rarity: 'uncommon' }))
      .toMatchObject({ itemType: 'shield', acBonus: 3 });
    const v = toTreasuryFields({ name: '+2 Armor', type: 'GV', requires: [{ type: 'HA' }], bonusAc: '+2', rarity: 'rare' });
    expect(v).toMatchObject({ itemType: 'armor', acBonus: 2 });
    expect(v.description).toMatch(/^Armor \(any heavy armor\), rare\n\nGeneric: set the base armor/);
    expect(toTreasuryFields({ name: 'Vorpal Sword', type: 'GV', requires: [{ name: 'Greatsword' }, { name: 'Longsword' }], rarity: 'legendary', reqAttune: true }).description)
      .toMatch(/^Weapon \(any greatsword or longsword\), legendary \(requires attunement\)/);
  });

  it('charges, spell bonuses, speed and value', () => {
    const f = toTreasuryFields({ name: 'Staff', staff: true, rarity: 'very rare', charges: 20, recharge: 'dawn',
      bonusSpellAttack: '+2', bonusSpellSaveDc: '+1', modifySpeed: { bonus: { '*': 10 } }, value: 120000, reqAttune: 'by a wizard' });
    expect(f).toMatchObject({ itemType: 'wondrous', charges: 20, chargesRecharge: 'long', spellAtkBonus: 2, spellDcBonus: 1,
      speedBonus: 10, valueCp: 120000, requiresAttunement: true });
    expect(f.description.split('\n')[0]).toBe('Staff, very rare (requires attunement by a wizard)');
  });

  it('only magic items count, and kinds follow the 5etools type', () => {
    expect(isMagic({ name: 'Rope', rarity: 'none' })).toBe(false);
    expect(isMagic({ name: 'Odd', rarity: 'unknown' })).toBe(false);
    expect(isMagic({ name: 'Mystery', rarity: 'unknown (magic)' })).toBe(true);
    expect(itemKind({ type: 'P' })).toBe('potion');
    expect(itemKind({ type: 'RG' })).toBe('wondrous');
    expect(itemKind({ type: 'SC' })).toBe('other');
    expect(itemHeader({ type: 'RG', rarity: 'rare', reqAttune: 'optional' })).toBe('Ring, rare (attunement optional)');
  });
});
