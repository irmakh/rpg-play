/**
 * Statistical fairness tests for the dice engine (lib/dice-engine.js).
 *
 * The real rolled values in the app are produced by parseDice via the idiom
 *   Math.ceil(Math.random() * die)
 * (the same formula confirmRoll uses for d20 checks). These tests roll large
 * samples and verify the results are UNBIASED and CORRECT:
 *   - every result is in range [1, sides] (no 0, no overflow)
 *   - every face actually appears
 *   - the distribution is uniform (chi-square goodness-of-fit, p = 0.001)
 *   - the empirical mean matches the theoretical mean (sides+1)/2
 *
 * To keep the statistics meaningful WITHOUT being flaky, Math.random is replaced
 * by a seeded PRNG (mulberry32). The source is uniform on [0,1), so any bias the
 * test detects comes from the engine's mapping formula, not from RNG luck — and
 * because the seed is fixed, the outcome is identical on every run.
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

const DICE_SRC = extractFunctions(SRC, 'parseDice');

// Deterministic, well-distributed PRNG on [0,1) — so the test never flakes.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadWithRandom(rand) {
  const ctx = createContext({});
  ctx._rand = rand;
  runInContext('Math.random = _rand;', ctx);
  runInContext(DICE_SRC, ctx);
  return ctx.parseDice;
}

// Upper-tail chi-square critical values at p = 0.001 by degrees of freedom (sides-1).
// A uniform die should land WELL below these; exceeding one signals real bias.
const CHI2_CRIT_0_001 = { 3: 16.27, 5: 20.52, 7: 24.32, 9: 27.88, 11: 31.26, 19: 43.82, 99: 148.23 };

const DICE = [4, 6, 8, 10, 12, 20, 100];
const PER_FACE = 5000; // expected samples per face → sample size = sides * 5000

// Roll `n` dice of the given size in one parseDice call and return the raw rolls.
function rollMany(parseDice, sides, n) {
  return parseDice(`${n}d${sides}`).rolls;
}

function tally(rolls, sides) {
  const counts = new Array(sides + 2).fill(0); // index 0 and sides+1 catch out-of-range
  for (const v of rolls) counts[v]++;
  return counts;
}

describe.each(DICE)('d%i fairness (seeded, n = sides × ' + PER_FACE + ')', (sides) => {
  const n = sides * PER_FACE;
  const parseDice = loadWithRandom(mulberry32(0x9E3779B1 ^ sides));
  const rolls = rollMany(parseDice, sides, n);
  const counts = tally(rolls, sides);

  it('produces the expected number of rolls', () => {
    expect(rolls).toHaveLength(n);
  });

  it('every result is in range [1, sides] — no 0, no overflow', () => {
    // Derive min/max from the tally (spreading 100k+ rolls overflows the stack).
    expect(counts[0]).toBe(0);          // Math.ceil never yields 0 here
    expect(counts[sides + 1]).toBe(0);  // never exceeds the die size
    let outOfRange = 0;
    for (let v = 0; v < counts.length; v++) {
      if ((v < 1 || v > sides) && counts[v] > 0) outOfRange += counts[v];
    }
    expect(outOfRange).toBe(0);
  });

  it('every face appears at least once', () => {
    for (let face = 1; face <= sides; face++) {
      expect(counts[face]).toBeGreaterThan(0);
    }
  });

  it('distribution is uniform (chi-square below p=0.001 critical value)', () => {
    const expected = n / sides;
    let chi2 = 0;
    for (let face = 1; face <= sides; face++) {
      const diff = counts[face] - expected;
      chi2 += (diff * diff) / expected;
    }
    expect(chi2).toBeLessThan(CHI2_CRIT_0_001[sides - 1]);
  });

  it('empirical mean is within 1% of the theoretical mean (sides+1)/2', () => {
    const mean = rolls.reduce((a, b) => a + b, 0) / n;
    const theoretical = (sides + 1) / 2;
    expect(Math.abs(mean - theoretical)).toBeLessThan(theoretical * 0.01);
  });
});

// The mapping must stay correct at the extreme ends of the RNG range, since an
// off-by-one (e.g. switching to Math.floor) would silently introduce 0s or
// drop the top face.
describe('parseDice — boundary correctness of the roll formula', () => {
  it('a just-below-1 random source yields the maximum face', () => {
    const parseDice = loadWithRandom(() => 0.9999999);
    for (const sides of DICE) {
      expect(parseDice(`1d${sides}`).rolls[0]).toBe(sides);
    }
  });

  it('a tiny-positive random source yields face 1', () => {
    const parseDice = loadWithRandom(() => 1e-9);
    for (const sides of DICE) {
      expect(parseDice(`1d${sides}`).rolls[0]).toBe(1);
    }
  });
});
