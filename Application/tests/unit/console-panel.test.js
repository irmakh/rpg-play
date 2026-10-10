// Written by Irmak Hakman — 2026-10-10 22:15
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The console info panel's pure helpers (public/js/console/panel-core.js and
 * panel-nav.js).
 *
 * sInitRows() is where the panel decides what a viewer may see in the
 * initiative order - a monster's real name, its hit points, whether it is
 * listed at all before combat starts - so that rule is tested here as data,
 * without a DOM. The scripts are classic browser scripts, loaded into a vm
 * context the same way tests/unit/table-utils.test.js does.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(resolve(__dirname, '../../public/js/console', f), 'utf-8');

function load() {
  const ctx = createContext({
    sessionStorage: { getItem: () => null },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    console,
  });
  runInContext(src('panel-core.js'), ctx);
  runInContext(src('panel-nav.js'), ctx);
  return ctx;
}

const TOKENS = [
  { id: 'tA', name: 'Aliyr', type: 'character', linkedId: 'cA', hpCurrent: 31, hpMax: 44, conditions: '["Poisoned"]' },
  { id: 'tB', name: 'Brannoch', type: 'character', linkedId: 'cB', hpCurrent: 47, hpMax: 52 },
  { id: 'tG', name: 'Goblin G7', label: 'G7', type: 'monster', linkedId: 'mG', initiativeId: 'iG', hpCurrent: 3, hpMax: 12, conditions: '["Prone"]' },
];
const ENTRIES = [
  { id: 'iB', name: 'Brannoch', roll: 15, charId: 'cB' },
  { id: 'iG', name: 'Goblin G7', roll: 17, monsterId: 'mG' },
  { id: 'iA', name: 'Aliyr', roll: 21, charId: 'cA' },
];
const DM = { isDM: true, isMine: () => true };
const playerA = { isDM: false, isMine: t => t.linkedId === 'cA' };

describe('sInitRows: the Turn tab rows', () => {
  const { sInitRows } = load();

  it('orders by roll, highest first, and marks whose turn it is', () => {
    const rows = sInitRows({ entries: ENTRIES, currentId: 'iG' }, TOKENS, DM);
    expect(rows.map(r => r.name)).toEqual(['Aliyr', 'Goblin G7', 'Brannoch']);
    expect(rows.map(r => r.current)).toEqual([false, true, false]);
  });

  it('gives the DM every name, every hit point total and every row to open', () => {
    const rows = sInitRows({ entries: ENTRIES, currentId: 'iA' }, TOKENS, DM);
    const goblin = rows.find(r => r.foe);
    expect(goblin.name).toBe('Goblin G7');
    expect(goblin.hp).toEqual({ cur: 3, max: 12, pct: 0.25 });
    expect(goblin.conditions).toEqual(['Prone']);
    expect(rows.every(r => r.canSelect)).toBe(true);
  });

  it('hides monsters from a player until combat has started', () => {
    const before = sInitRows({ entries: ENTRIES, currentId: null }, TOKENS, playerA);
    expect(before.map(r => r.name)).toEqual(['Aliyr', 'Brannoch']);
    const during = sInitRows({ entries: ENTRIES, currentId: 'iA' }, TOKENS, playerA);
    expect(during).toHaveLength(3);
  });

  it('shows a player a monster by identifier only, with no health or conditions', () => {
    const goblin = sInitRows({ entries: ENTRIES, currentId: 'iA' }, TOKENS, playerA).find(r => r.foe);
    expect(goblin.name).toBe('G7');
    expect(goblin.hp).toBeNull();
    expect(goblin.conditions).toEqual([]);
    expect(goblin.canSelect).toBe(false);
  });

  it('shows a player the party\'s health but lets them open only their own token', () => {
    const rows = sInitRows({ entries: ENTRIES, currentId: 'iA' }, TOKENS, playerA);
    const me = rows.find(r => r.name === 'Aliyr'), ally = rows.find(r => r.name === 'Brannoch');
    expect(me.mine).toBe(true);
    expect(me.canSelect).toBe(true);
    expect(me.conditions).toEqual(['Poisoned']);
    expect(ally.hp.cur).toBe(47);
    expect(ally.canSelect).toBe(false);
  });

  it('copes with an entry that has no token on the map', () => {
    const rows = sInitRows({ entries: [{ id: 'iX', name: 'Hireling', roll: 9 }], currentId: null }, [], DM);
    expect(rows[0]).toMatchObject({ name: 'Hireling', tokenId: null, canSelect: false, hp: null });
  });
});

describe('health helpers', () => {
  const { sHpPct, sHpLow, sParseConditions } = load();

  it('sHpPct clamps to 0..1 and is 0 without a maximum', () => {
    expect(sHpPct(5, 10)).toBe(0.5);
    expect(sHpPct(15, 10)).toBe(1);
    expect(sHpPct(-3, 10)).toBe(0);
    expect(sHpPct(5, 0)).toBe(0);
  });

  it('sHpLow turns at a quarter', () => {
    expect(sHpLow(0.26)).toBe(false);
    expect(sHpLow(0.25)).toBe(true);
    expect(sHpLow(0)).toBe(true);
  });

  it('sParseConditions accepts a JSON string, an array, or rubbish', () => {
    expect(sParseConditions('["Prone"]')).toEqual(['Prone']);
    expect(sParseConditions(['Stunned'])).toEqual(['Stunned']);
    expect(sParseConditions('not json')).toEqual([]);
    expect(sParseConditions(undefined)).toEqual([]);
  });
});
