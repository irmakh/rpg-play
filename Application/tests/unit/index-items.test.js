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
  });
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
