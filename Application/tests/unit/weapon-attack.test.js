// Written by Irmak Hakman — 2026-11-20 17:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/weapon-attack.js — the server's copy of the sheet's weapon maths, used by
 * the save-time refresh, treasury claims and shop purchases. Same expectations
 * as tests/unit/index-items.test.js so the two sides stay identical.
 */
import { describe, it, expect } from 'vitest';
import { weaponAtkStr, weaponDmgStr, profBonusOf, profBonusForLevel, refreshWeaponRows } from '../../lib/weapon-attack.js';

const sword = { id: 1, itemType: 'weapon', weaponAtk: '', weaponDmg: '1d8 slashing', weaponProperties: [] };

describe('weaponAtkStr / weaponDmgStr', () => {
  it('STR weapon: prof + STR mod, bonus on the damage', () => {
    const d = { str: '16', dex: '10', profbonus: '2' };
    expect(weaponAtkStr(d, sword)).toBe('+5');
    expect(weaponDmgStr(d, sword)).toBe('1d8+3 slashing');
  });

  it('Finesse takes the better of STR and DEX; magic bonus counts twice', () => {
    const rapier = { weaponAtk: '+1', weaponDmg: '1d8 piercing', weaponProperties: ['Finesse'] };
    const d = { str: '10', dex: '18', profbonus: '3' };
    expect(weaponAtkStr(d, rapier)).toBe('+8');
    expect(weaponDmgStr(d, rapier)).toBe('1d8+5 piercing');
  });

  it('Ammunition uses DEX; properties may arrive as a JSON string', () => {
    const bow = { weaponDmg: '1d8 piercing', weaponProperties: '["Ammunition"]' };
    expect(weaponAtkStr({ str: '18', dex: '12', profbonus: '2' }, bow)).toBe('+3');
  });

  it('merges into an existing modifier and only touches the first damage part', () => {
    const flame = { weaponAtk: '1', weaponDmg: '1d8+1 slashing, 2d6 fire', weaponProperties: [] };
    expect(weaponDmgStr({ str: '14', profbonus: '2' }, flame)).toBe('1d8+4 slashing, 2d6 fire');
  });

  it('leaves unparseable damage text alone, and a zero bonus changes nothing', () => {
    expect(weaponDmgStr({ str: '16' }, { weaponDmg: 'see notes' })).toBe('see notes');
    expect(weaponDmgStr({ str: '10' }, sword)).toBe('1d8 slashing');
  });
});

describe('proficiency', () => {
  it('uses the stored bonus, else the level', () => {
    expect(profBonusOf({ profbonus: '4', level: '1' })).toBe(4);
    expect(profBonusOf({ level: '9' })).toBe(4);
    expect(profBonusForLevel('5')).toBe(3);
    expect(profBonusForLevel('')).toBeNull();
  });
});

describe('refreshWeaponRows', () => {
  it('rewrites linked rows only and reports no change when already right', () => {
    const data = { str: '16', profbonus: '2', _items: JSON.stringify([sword]),
      _weapons: JSON.stringify([['Longsword', '+2', '1d8 slashing', 'n', 1], ['Bite', '+9', '2d6', '', null]]) };
    const out = JSON.parse(refreshWeaponRows(data));
    expect(out).toEqual([['Longsword', '+5', '1d8+3 slashing', 'n', 1], ['Bite', '+9', '2d6', '', null]]);
    expect(refreshWeaponRows({ ...data, _weapons: JSON.stringify(out) })).toBeNull();
  });
});
