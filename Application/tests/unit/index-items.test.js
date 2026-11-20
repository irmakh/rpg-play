// Written by Irmak Hakman — 2026-11-20 17:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for weapon calculation helpers in index-items.js.
 *
 * calcWeaponAtkStr and calcWeaponDmgStr are the only pure/near-pure functions
 * in that file. Both read getMod() (which reads DOM ability scores) and the
 * profbonus DOM field. We extract them with brace-counting and load them into
 * a vm context with controlled getMod and querySelector stubs.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/index/index-items.js'), 'utf-8'
);

function extractFunctions(src, ...names) {
  return names.map(name => {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(src);
    if (!m) throw new Error(`Function "${name}" not found — was it renamed?`);
    let depth = 0, i = m.index;
    while (i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    return src.slice(m.index, i + 1);
  }).join('\n');
}

const FN_SRC = extractFunctions(SRC, 'calcWeaponAtkStr', 'calcWeaponDmgStr');

// calcWeaponDmgStr parses the damage string with parseDamageSpec so it can put
// the ability bonus on the FIRST part of a multi-type value ("1d6 piercing,
// 2d8 fire"). Pull in that half of dice-engine.js — everything up to
// parseDiceCommand is the DOM-free dice/damage math. Sliced by string index
// rather than brace-counted because the parser's regexes contain braces.
const ENGINE_SRC = (() => {
  const src = readFileSync(resolve(__dirname, '../../public/js/lib/dice-engine.js'), 'utf-8');
  const end = src.indexOf('function parseDiceCommand');
  if (end === -1) throw new Error('parseDiceCommand not found — was dice-engine.js restructured?');
  return src.slice(0, end);
})();

/**
 * Load both functions into a vm context with injected ability scores and prof.
 *
 * scores — { str, dex } as raw ability score numbers (default 10 = mod 0)
 * prof   — proficiency bonus number (default 2)
 */
function load({ str = 10, dex = 10, prof = 2 } = {}) {
  function abMod(score) { return Math.floor((score - 10) / 2); }
  const getMod = (stat) => stat === 'str' ? abMod(str) : stat === 'dex' ? abMod(dex) : 0;

  const ctx = createContext({
    getMod,
    document: {
      querySelector: (sel) => {
        if (sel.includes('"profbonus"')) return { value: String(prof) };
        return null;
      },
    },
    Math,
    parseInt,
    String,
    Array,
    Number,
    isNaN,
  });
  runInContext(ENGINE_SRC, ctx);
  runInContext(FN_SRC, ctx);
  return {
    calcWeaponAtkStr: ctx.calcWeaponAtkStr,
    calcWeaponDmgStr: ctx.calcWeaponDmgStr,
  };
}

// ── calcWeaponAtkStr ──────────────────────────────────────────────────────────
describe('calcWeaponAtkStr — default (STR-based)', () => {
  it('prof 2 + STR mod 0 + magic 0 → +2', () => {
    const { calcWeaponAtkStr } = load({ str: 10, prof: 2 });
    expect(calcWeaponAtkStr(0, [])).toBe('+2');
  });

  it('prof 3 + STR mod +4 (STR 18) + magic 0 → +7', () => {
    const { calcWeaponAtkStr } = load({ str: 18, prof: 3 });
    expect(calcWeaponAtkStr(0, [])).toBe('+7');
  });

  it('adds positive magic bonus', () => {
    const { calcWeaponAtkStr } = load({ str: 10, prof: 2 });
    expect(calcWeaponAtkStr(3, [])).toBe('+5');
  });

  it('result is negative when all mods are small', () => {
    // STR 6 → mod -2; prof 2; magic 0 → total 0
    const { calcWeaponAtkStr } = load({ str: 6, prof: 2 });
    expect(calcWeaponAtkStr(0, [])).toBe('+0');
  });

  it('negative total when magic bonus is very negative', () => {
    const { calcWeaponAtkStr } = load({ str: 10, prof: 2 });
    // prof 2 + mod 0 + magic -5 = -3
    expect(calcWeaponAtkStr(-5, [])).toBe('-3');
  });
});

describe('calcWeaponAtkStr — Finesse (max of STR/DEX mod)', () => {
  it('uses DEX when DEX mod > STR mod', () => {
    // STR 10 (mod 0), DEX 18 (mod +4); prof 2 → total +6
    const { calcWeaponAtkStr } = load({ str: 10, dex: 18, prof: 2 });
    expect(calcWeaponAtkStr(0, ['Finesse'])).toBe('+6');
  });

  it('uses STR when STR mod > DEX mod', () => {
    // STR 18 (mod +4), DEX 10 (mod 0); prof 2 → total +6
    const { calcWeaponAtkStr } = load({ str: 18, dex: 10, prof: 2 });
    expect(calcWeaponAtkStr(0, ['Finesse'])).toBe('+6');
  });

  it('uses either when mods are equal', () => {
    const { calcWeaponAtkStr } = load({ str: 14, dex: 14, prof: 2 });
    // Both mod +2; prof 2 → +4
    expect(calcWeaponAtkStr(0, ['Finesse'])).toBe('+4');
  });
});

describe('calcWeaponAtkStr — Ammunition (ranged, DEX-based)', () => {
  it('uses DEX mod regardless of STR', () => {
    // STR 18 (mod +4), DEX 12 (mod +1); prof 2 → total +3 (uses DEX)
    const { calcWeaponAtkStr } = load({ str: 18, dex: 12, prof: 2 });
    expect(calcWeaponAtkStr(0, ['Ammunition'])).toBe('+3');
  });

  it('applies magic bonus on top of DEX mod', () => {
    const { calcWeaponAtkStr } = load({ dex: 16, prof: 3 });
    // DEX mod +3; prof 3; magic +2 → +8
    expect(calcWeaponAtkStr(2, ['Ammunition'])).toBe('+8');
  });
});

// ── calcWeaponDmgStr ──────────────────────────────────────────────────────────
describe('calcWeaponDmgStr — zero bonus', () => {
  it('returns the raw damage string when bonus is 0', () => {
    const { calcWeaponDmgStr } = load({ str: 10, prof: 2 });
    expect(calcWeaponDmgStr(0, '1d8', [])).toBe('1d8');
  });

  it('keeps the damage type when bonus is 0', () => {
    const { calcWeaponDmgStr } = load({ str: 10 });
    expect(calcWeaponDmgStr(0, '1d6 slashing', [])).toBe('1d6 slashing');
  });

  it('falls back to "1d4" when dmgRaw is empty/null', () => {
    const { calcWeaponDmgStr } = load({ str: 10 });
    // str mod 0, magic 0 → bonus 0 → raw returned as-is (1d4)
    expect(calcWeaponDmgStr(0, '', [])).toBe('1d4');
  });
});

describe('calcWeaponDmgStr — positive bonus', () => {
  it('appends +N to dice expression', () => {
    // STR 16 (mod +3); magic 0 → +3
    const { calcWeaponDmgStr } = load({ str: 16 });
    expect(calcWeaponDmgStr(0, '1d8', [])).toBe('1d8+3');
  });

  it('appends +N before damage type', () => {
    const { calcWeaponDmgStr } = load({ str: 16 });
    expect(calcWeaponDmgStr(0, '1d6 piercing', [])).toBe('1d6+3 piercing');
  });

  it('adds magic bonus to ability mod', () => {
    // STR 14 (mod +2); magic +2 → total +4
    const { calcWeaponDmgStr } = load({ str: 14 });
    expect(calcWeaponDmgStr(2, '2d6', [])).toBe('2d6+4');
  });
});

describe('calcWeaponDmgStr — negative bonus', () => {
  it('appends -N when ability mod is negative', () => {
    // STR 6 (mod -2); magic 0 → -2
    const { calcWeaponDmgStr } = load({ str: 6 });
    expect(calcWeaponDmgStr(0, '1d4', [])).toBe('1d4-2');
  });

  it('appends -N before damage type', () => {
    const { calcWeaponDmgStr } = load({ str: 6 });
    expect(calcWeaponDmgStr(0, '1d6 bludgeoning', [])).toBe('1d6-2 bludgeoning');
  });
});

describe('calcWeaponDmgStr — Finesse and Ammunition', () => {
  it('Finesse uses DEX when DEX mod > STR mod', () => {
    // STR 10 (mod 0), DEX 18 (mod +4) → +4
    const { calcWeaponDmgStr } = load({ str: 10, dex: 18 });
    expect(calcWeaponDmgStr(0, '1d6', ['Finesse'])).toBe('1d6+4');
  });

  it('Ammunition uses DEX mod for damage', () => {
    // STR 18 (mod +4), DEX 14 (mod +2) → Ammunition uses DEX → +2
    const { calcWeaponDmgStr } = load({ str: 18, dex: 14 });
    expect(calcWeaponDmgStr(0, '1d8', ['Ammunition'])).toBe('1d8+2');
  });
});

// ── refreshWeaponAttacks (v367) ───────────────────────────────────────────────
// recalcAll() calls it so attack rows linked to a weapon item follow STR / DEX /
// proficiency. Rows the player added by hand (no item) are left alone.
describe('refreshWeaponAttacks — linked rows follow the character', () => {
  function loadRefresh({ str = 10, dex = 10, prof = 2, items = [], rows = {} } = {}) {
    const abMod = s => Math.floor((s - 10) / 2);
    const inputs = {};   // item id → [name, atk, dmg, notes] inputs
    for (const [id, vals] of Object.entries(rows)) inputs[id] = vals.map(v => ({ value: v }));
    let summaries = 0;
    const ctx = createContext({
      getMod: s => s === 'str' ? abMod(str) : s === 'dex' ? abMod(dex) : 0,
      items,
      renderWeaponsSummary: () => { summaries++; },
      document: {
        activeElement: null,
        querySelector: (sel) => {
          if (sel.includes('"profbonus"')) return { value: String(prof) };
          const m = sel.match(/data-item-id="([^"]+)"/);
          if (m && inputs[m[1]]) return { querySelectorAll: () => inputs[m[1]] };
          return null;
        },
      },
      Math, parseInt, String, Array, Number, isNaN,
    });
    runInContext(ENGINE_SRC, ctx);
    runInContext(extractFunctions(SRC, 'calcWeaponAtkStr', 'calcWeaponDmgStr', 'refreshWeaponAttacks'), ctx);
    return { ctx, inputs, get summaries() { return summaries; } };
  }
  const sword = { id: 1, name: 'Longsword', itemType: 'weapon', weaponAtk: '', weaponDmg: '1d8 slashing', weaponProperties: [] };

  it('rewrites attack and damage of a linked row after STR changes', () => {
    const env = loadRefresh({ str: 16, items: [sword], rows: { 1: ['Longsword', '+2', '1d8 slashing', 'heavy'] } });
    env.ctx.refreshWeaponAttacks();
    expect(env.inputs[1].map(i => i.value)).toEqual(['Longsword', '+5', '1d8+3 slashing', 'heavy']);
    expect(env.summaries).toBe(1);
  });

  it('follows the proficiency bonus', () => {
    const env = loadRefresh({ prof: 4, items: [sword], rows: { 1: ['Longsword', '+2', '1d8 slashing', ''] } });
    env.ctx.refreshWeaponAttacks();
    expect(env.inputs[1][1].value).toBe('+4');
  });

  it('does nothing (no re-render) when the row is already right', () => {
    const env = loadRefresh({ items: [sword], rows: { 1: ['Longsword', '+2', '1d8 slashing', ''] } });
    env.ctx.refreshWeaponAttacks();
    expect(env.summaries).toBe(0);
  });

  it('leaves the damage alone when the item has no damage dice of its own', () => {
    const club = { id: 3, name: 'Club', itemType: 'weapon', weaponAtk: '', weaponDmg: '', weaponProperties: [] };
    const env = loadRefresh({ str: 14, items: [club], rows: { 3: ['Club', '+2', '1d4 bludgeoning', ''] } });
    env.ctx.refreshWeaponAttacks();
    expect(env.inputs[3][1].value).toBe('+4');
    expect(env.inputs[3][2].value).toBe('1d4 bludgeoning');
  });

  it('skips unidentified items and items that are not weapons', () => {
    const odd = { id: 4, name: 'Mystery', itemType: 'weapon', unidentified: true, weaponDmg: '1d6', weaponProperties: [] };
    const env = loadRefresh({ str: 18, items: [odd], rows: { 4: ['Mystery', '+0', '?', ''] } });
    env.ctx.refreshWeaponAttacks();
    expect(env.inputs[4][1].value).toBe('+0');
  });
});
