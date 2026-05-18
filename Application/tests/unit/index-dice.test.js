/**
 * Unit tests for parseDice and parseDiceCommand in lib/dice-engine.js.
 *
 * Both functions are self-contained pure/near-pure helpers.  We extract them
 * with the same brace-counting technique used for table-map.test.js, then run
 * them in a vm context where Math.random can be replaced with a fixed function.
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

const DICE_SRC = extractFunctions(SRC, 'parseDice', 'parseDiceCommand');

/**
 * Creates a vm context with an optional Math.random override.
 * mockRandom: () => number in [0, 1)
 */
function load(mockRandom = null) {
  const ctx = createContext({});
  if (mockRandom) {
    // Inject the mock and point Math.random at it before the script runs.
    ctx._mockRandom = mockRandom;
    runInContext('Math.random = _mockRandom;', ctx);
  }
  runInContext(DICE_SRC, ctx);
  return { parseDice: ctx.parseDice, parseDiceCommand: ctx.parseDiceCommand };
}

// ── parseDice ─────────────────────────────────────────────────────────────────
describe('parseDice — invalid / edge inputs', () => {
  const { parseDice } = load();

  it('returns null for null', () => expect(parseDice(null)).toBeNull());
  it('returns null for empty string', () => expect(parseDice('')).toBeNull());
  it('returns null for undefined', () => expect(parseDice(undefined)).toBeNull());
  it('returns null for a plain non-numeric string', () => expect(parseDice('hello')).toBeNull());
  it('returns null for malformed dice like "d6"', () => expect(parseDice('d6')).toBeNull());
});

describe('parseDice — flat integers', () => {
  const { parseDice } = load();

  it('parses the string "5" as { total: 5, detail: "5" }', () => {
    expect(parseDice('5')).toEqual({ total: 5, detail: '5' });
  });

  it('parses "-3" as { total: -3, detail: "-3" }', () => {
    expect(parseDice('-3')).toEqual({ total: -3, detail: '-3' });
  });

  it('parses "0" as { total: 0, detail: "0" }', () => {
    expect(parseDice('0')).toEqual({ total: 0, detail: '0' });
  });
});

describe('parseDice — dice expressions (structure)', () => {
  const { parseDice } = load();

  it('1d6 returns an object with the correct shape', () => {
    const r = parseDice('1d6');
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ num: 1, die: 6, mod: 0, diceExpr: '1d6' });
    expect(Array.isArray(r.rolls)).toBe(true);
    expect(r.rolls).toHaveLength(1);
  });

  it('2d8+3 has correct num/die/mod fields', () => {
    const r = parseDice('2d8+3');
    expect(r).toMatchObject({ num: 2, die: 8, mod: 3, diceExpr: '2d8' });
    expect(r.rolls).toHaveLength(2);
  });

  it('3d4-2 has negative modifier', () => {
    const r = parseDice('3d4-2');
    expect(r.mod).toBe(-2);
    expect(r.rolls).toHaveLength(3);
  });
});

describe('parseDice — total calculation (fixed Math.random)', () => {
  it('all rolls are 1 when random returns near-zero (Math.ceil(ε*die) = 1)', () => {
    // Math.ceil(0.0001 * die) = 1 for any die size
    const { parseDice } = load(() => 0.0001);
    const r = parseDice('3d6+2');
    expect(r.rolls).toEqual([1, 1, 1]);
    expect(r.total).toBe(5);   // 1+1+1+2
  });

  it('all rolls are max when random returns ~1 (Math.ceil(0.999*6) = 6)', () => {
    const { parseDice } = load(() => 0.9999);
    const r = parseDice('2d6');
    expect(r.rolls).toEqual([6, 6]);
    expect(r.total).toBe(12);
  });

  it('applies a negative modifier correctly', () => {
    const { parseDice } = load(() => 0.9999);
    const r = parseDice('1d4-1');
    expect(r.total).toBe(3);  // 4 - 1
  });

  it('total is within [num, num*die] for 0 modifier', () => {
    const { parseDice } = load();
    const r = parseDice('4d6');
    expect(r.total).toBeGreaterThanOrEqual(4);
    expect(r.total).toBeLessThanOrEqual(24);
  });
});

describe('parseDice — detail string format', () => {
  it('detail includes dice expression and roll values', () => {
    const { parseDice } = load(() => 0.0001);
    const r = parseDice('2d6');
    expect(r.detail).toBe('2d6(1,1)');
  });

  it('detail includes positive modifier', () => {
    const { parseDice } = load(() => 0.0001);
    const r = parseDice('1d6+3');
    expect(r.detail).toBe('1d6(1)+3');
  });

  it('detail includes negative modifier', () => {
    const { parseDice } = load(() => 0.0001);
    const r = parseDice('1d6-2');
    expect(r.detail).toBe('1d6(1)-2');
  });
});

// ── parseDiceCommand ──────────────────────────────────────────────────────────
describe('parseDiceCommand — non-matching inputs', () => {
  const { parseDiceCommand } = load();

  it('returns null for plain text', () => expect(parseDiceCommand('hello')).toBeNull());
  it('returns null for empty string', () => expect(parseDiceCommand('')).toBeNull());
  it('returns null for /r without dice', () => expect(parseDiceCommand('/r 5')).toBeNull());
});

describe('parseDiceCommand — valid /r command', () => {
  const { parseDiceCommand } = load();

  it('parses /r d20 as 1d20+0 with no label', () => {
    expect(parseDiceCommand('/r d20')).toMatchObject({ count: 1, sides: 20, modifier: 0, label: null });
  });

  it('parses /r 2d6+3 correctly', () => {
    expect(parseDiceCommand('/r 2d6+3')).toMatchObject({ count: 2, sides: 6, modifier: 3, label: null });
  });

  it('parses /r 1d20-1 with negative modifier', () => {
    expect(parseDiceCommand('/r 1d20-1')).toMatchObject({ count: 1, sides: 20, modifier: -1, label: null });
  });

  it('parses /r d6 Stealth with a label', () => {
    expect(parseDiceCommand('/r d6 Stealth')).toMatchObject({ count: 1, sides: 6, label: 'Stealth' });
  });

  it('parses /roll alias correctly', () => {
    expect(parseDiceCommand('/roll d20')).toMatchObject({ count: 1, sides: 20 });
  });

  it('clamps count to 1 when omitted', () => {
    expect(parseDiceCommand('/r d6').count).toBe(1);
  });

  it('clamps count to 20 when above limit', () => {
    expect(parseDiceCommand('/r 99d6').count).toBe(20);
  });

  it('clamps count to 1 when 0 would result', () => {
    expect(parseDiceCommand('/r 0d6').count).toBe(1);
  });
});
