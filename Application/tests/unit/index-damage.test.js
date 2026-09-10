/**
 * Unit tests for typed multi-part damage in lib/dice-engine.js —
 * parseDamageSpec (pure), rollDamageSpec (rolls), and the damage forms of
 * parseDiceCommand.
 *
 * The whole DOM-free half of the engine is loaded by slicing the file at
 * parseDiceCommand's successor rather than brace-counting individual functions:
 * the damage parser's regexes contain { and }, which defeats brace counting.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/lib/dice-engine.js'), 'utf-8'
);

// Everything up to advClose() is dice/damage math; after it the file is DOM
// animation code that cannot run headless.
const MATH_SRC = (() => {
  const end = SRC.indexOf('function advClose');
  if (end === -1) throw new Error('advClose not found — was dice-engine.js restructured?');
  return SRC.slice(0, end);
})();

function load(mockRandom = null) {
  const ctx = createContext({ Math, parseInt, String, Array, Number, isNaN });
  if (mockRandom) {
    ctx._mockRandom = mockRandom;
    runInContext('Math.random = _mockRandom;', ctx);
  }
  runInContext(MATH_SRC, ctx);
  return ctx;
}

// Every die lands on its maximum, so totals are exactly predictable.
const ALWAYS_MAX = () => 0.999999;

// ── parseDamageSpec ───────────────────────────────────────────────────────────
describe('parseDamageSpec — single part', () => {
  const { parseDamageSpec } = load();

  it('reads dice and type', () => {
    expect(parseDamageSpec('1d6 piercing').parts).toEqual([
      { count: 1, sides: 6, modifier: 0, flat: 0, type: 'piercing' },
    ]);
  });

  it('reads a modifier', () => {
    expect(parseDamageSpec('1d8+3 slashing').parts[0]).toMatchObject({ count: 1, sides: 8, modifier: 3 });
  });

  it('reads a negative modifier', () => {
    expect(parseDamageSpec('2d6-1 cold').parts[0]).toMatchObject({ modifier: -1 });
  });

  it('tolerates spaces around the modifier', () => {
    expect(parseDamageSpec('1d10 + 2 piercing').parts[0]).toMatchObject({ sides: 10, modifier: 2 });
  });

  it('defaults an omitted count to 1', () => {
    expect(parseDamageSpec('d6 fire').parts[0]).toMatchObject({ count: 1, sides: 6 });
  });

  it('marks an untyped part generic', () => {
    expect(parseDamageSpec('2d6').parts[0].type).toBe('generic');
    expect(parseDamageSpec('2d6').typed).toBe(false);
  });

  it('strips a trailing "damage" word from the type', () => {
    expect(parseDamageSpec('2d6 fire damage').parts[0].type).toBe('fire');
  });

  it('accepts an unrecognised type as free text', () => {
    expect(parseDamageSpec('1d6 chaos').parts[0].type).toBe('chaos');
  });

  it('accepts a flat amount with a type', () => {
    expect(parseDamageSpec('5 cold').parts[0]).toMatchObject({ sides: 0, flat: 5, type: 'cold' });
  });

  it('is not multi for one part', () => {
    expect(parseDamageSpec('1d6 fire').multi).toBe(false);
  });
});

describe('parseDamageSpec — multiple parts', () => {
  const { parseDamageSpec } = load();

  it('splits on commas', () => {
    const s = parseDamageSpec('1d6 piercing, 2d8 fire');
    expect(s.parts).toHaveLength(2);
    expect(s.parts[0]).toMatchObject({ count: 1, sides: 6, type: 'piercing' });
    expect(s.parts[1]).toMatchObject({ count: 2, sides: 8, type: 'fire' });
    expect(s.multi).toBe(true);
    expect(s.typed).toBe(true);
  });

  it('handles three parts', () => {
    expect(parseDamageSpec('1d6 slashing, 1d6 acid, 1d4 cold').parts).toHaveLength(3);
  });

  it('mixes dice and flat parts', () => {
    const s = parseDamageSpec('1d4 fire, 5 cold');
    expect(s.parts[0]).toMatchObject({ sides: 4, type: 'fire' });
    expect(s.parts[1]).toMatchObject({ sides: 0, flat: 5, type: 'cold' });
  });

  it('allows one part to stay generic', () => {
    const s = parseDamageSpec('3d6 psychic, 1d4');
    expect(s.parts[1].type).toBe('generic');
    expect(s.typed).toBe(true);
  });

  it('ignores empty segments from a trailing comma', () => {
    expect(parseDamageSpec('1d6 fire, ').parts).toHaveLength(1);
  });
});

describe('parseDamageSpec — invalid input', () => {
  const { parseDamageSpec } = load();

  it('returns null for null', () => expect(parseDamageSpec(null)).toBeNull());
  it('returns null for an empty string', () => expect(parseDamageSpec('')).toBeNull());
  it('returns null for plain words', () => expect(parseDamageSpec('hello')).toBeNull());
  it('returns null when only commas', () => expect(parseDamageSpec(', ,')).toBeNull());

  it('rejects the whole expression when one part is bad', () => {
    expect(parseDamageSpec('1d6 fire, nonsense')).toBeNull();
  });
});

// ── rollDamageSpec ────────────────────────────────────────────────────────────
describe('rollDamageSpec', () => {
  it('totals every part', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    // 1d6 max 6, plus 2d8 max 16 → 22
    const r = rollDamageSpec(parseDamageSpec('1d6 piercing, 2d8 fire'));
    expect(r.parts[0].total).toBe(6);
    expect(r.parts[1].total).toBe(16);
    expect(r.total).toBe(22);
  });

  it('applies each part\'s own modifier', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    const r = rollDamageSpec(parseDamageSpec('1d6+3 piercing, 1d4 fire'));
    expect(r.parts[0].total).toBe(9);   // 6 + 3
    expect(r.parts[1].total).toBe(4);
    expect(r.total).toBe(13);
  });

  it('adds a flat part without rolling it', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    const r = rollDamageSpec(parseDamageSpec('1d4 fire, 5 cold'));
    expect(r.parts[1].rolls).toEqual([]);
    expect(r.total).toBe(9);
  });

  it('builds a per-type summary', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    expect(rollDamageSpec(parseDamageSpec('1d6 piercing, 2d8 fire')).summary)
      .toBe('6 piercing · 16 fire');
  });

  it('omits the type from the summary for a generic part', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    expect(rollDamageSpec(parseDamageSpec('1d6')).summary).toBe('6');
  });

  it('shows the individual dice in detail', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    expect(rollDamageSpec(parseDamageSpec('2d8 fire')).detail).toBe('2d8(8,8) fire');
  });

  it('produces one group per part for the overlay', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    const g = rollDamageSpec(parseDamageSpec('1d6 piercing, 2d8 fire')).groups;
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ sides: 6, type: 'piercing', total: 6 });
    expect(g[1]).toMatchObject({ sides: 8, type: 'fire', total: 16 });
  });

  it('rolls the right number of dice per part', () => {
    const { parseDamageSpec, rollDamageSpec } = load(ALWAYS_MAX);
    const r = rollDamageSpec(parseDamageSpec('3d6 fire, 1d4 cold'));
    expect(r.parts[0].rolls).toHaveLength(3);
    expect(r.parts[1].rolls).toHaveLength(1);
  });

  it('returns null for a null spec', () => {
    const { rollDamageSpec } = load();
    expect(rollDamageSpec(null)).toBeNull();
  });

  it('stays within bounds over many rolls', () => {
    const { parseDamage } = load();
    for (let i = 0; i < 200; i++) {
      const r = parseDamage('1d6 piercing, 2d8 fire');
      expect(r.total).toBeGreaterThanOrEqual(3);   // 1 + 2
      expect(r.total).toBeLessThanOrEqual(22);     // 6 + 16
    }
  });
});

// ── parseDiceCommand — damage forms ───────────────────────────────────────────
describe('parseDiceCommand — /dmg', () => {
  const { parseDiceCommand } = load();

  it('parses a single typed part', () => {
    const c = parseDiceCommand('/dmg 1d6 fire');
    expect(c.damage.parts).toHaveLength(1);
    expect(c.damage.parts[0].type).toBe('fire');
  });

  it('parses multiple parts', () => {
    const c = parseDiceCommand('/dmg 1d6 piercing, 2d8 fire');
    expect(c.damage.parts.map(p => p.type)).toEqual(['piercing', 'fire']);
  });

  it('treats an untyped /dmg part as generic', () => {
    expect(parseDiceCommand('/dmg 2d6').damage.parts[0].type).toBe('generic');
  });

  it('accepts the /damage alias', () => {
    expect(parseDiceCommand('/damage 1d6 acid').damage.parts[0].type).toBe('acid');
  });

  it('keeps the legacy fields pointing at the first part', () => {
    expect(parseDiceCommand('/dmg 2d8+1 fire, 1d4 cold'))
      .toMatchObject({ count: 2, sides: 8, modifier: 1 });
  });

  it('carries the original expression for the roll label', () => {
    expect(parseDiceCommand('/dmg 1d6 piercing, 2d8 fire').expr)
      .toBe('1d6 piercing, 2d8 fire');
  });

  it('returns null for an unrollable /dmg', () => {
    expect(parseDiceCommand('/dmg nonsense')).toBeNull();
  });
});

describe('parseDiceCommand — /r stays backwards compatible', () => {
  const { parseDiceCommand } = load();

  it('still treats trailing words as a LABEL, not a damage type', () => {
    const c = parseDiceCommand('/r 2d6 Sneak Attack');
    expect(c.damage).toBeUndefined();
    expect(c.label).toBe('Sneak Attack');
  });

  it('still labels a single part that looks like a type', () => {
    const c = parseDiceCommand('/r 1d6+2 fire');
    expect(c.damage).toBeUndefined();
    expect(c).toMatchObject({ count: 1, sides: 6, modifier: 2, label: 'fire' });
  });

  it('reads a comma-separated list as typed damage', () => {
    const c = parseDiceCommand('/r 1d6 piercing, 2d8 fire');
    expect(c.damage.parts.map(p => p.type)).toEqual(['piercing', 'fire']);
  });

  it('does not treat a comma inside a LABEL as a damage list', () => {
    // The second segment does not open with a dice expression, so this is a label.
    const c = parseDiceCommand('/r 2d6 Sneak Attack, upcast');
    expect(c.damage).toBeUndefined();
    expect(c.label).toBe('Sneak Attack, upcast');
  });

  it('leaves an ordinary roll untouched', () => {
    expect(parseDiceCommand('/r 1d20+5 Perception'))
      .toMatchObject({ count: 1, sides: 20, modifier: 5, label: 'Perception' });
  });

  it('returns null for a non-command', () => {
    expect(parseDiceCommand('hello there')).toBeNull();
  });
});

// ── chat payload ──────────────────────────────────────────────────────────────
describe('dmgChatPayload', () => {
  it('attaches parts for a multi-type roll', () => {
    const { parseDamage, dmgChatPayload } = load(ALWAYS_MAX);
    const p = dmgChatPayload(parseDamage('1d6 piercing, 2d8 fire'), 'Flame Tongue');
    expect(p.parts).toHaveLength(2);
    expect(p.total).toBe(22);
    expect(p.label).toBe('Flame Tongue');
  });

  it('keeps the legacy dice/results describing the first part', () => {
    const { parseDamage, dmgChatPayload } = load(ALWAYS_MAX);
    const p = dmgChatPayload(parseDamage('1d6 piercing, 2d8 fire'), 'x');
    expect(p.dice).toBe('1d6');
    expect(p.results).toEqual([6]);
  });

  it('omits parts for a plain untyped roll, so old rendering is unchanged', () => {
    const { parseDamage, dmgChatPayload } = load(ALWAYS_MAX);
    expect(dmgChatPayload(parseDamage('2d6'), 'x').parts).toBeUndefined();
  });

  it('attaches parts for a single TYPED roll', () => {
    const { parseDamage, dmgChatPayload } = load(ALWAYS_MAX);
    expect(dmgChatPayload(parseDamage('2d6 fire'), 'x').parts).toHaveLength(1);
  });

  it('merges extra fields such as description', () => {
    const { parseDamage, dmgChatPayload } = load(ALWAYS_MAX);
    const p = dmgChatPayload(parseDamage('1d6 fire'), 'x', { description: 'note' });
    expect(p.description).toBe('note');
  });
});
