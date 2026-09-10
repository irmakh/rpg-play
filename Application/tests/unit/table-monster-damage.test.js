/**
 * Unit tests for _monsterDamageStr in table-monsters.js — the 5etools stat-block
 * damage extractor.
 *
 * Before typed damage existed only the FIRST {@damage} tag was read, so an
 * attack like "…piercing damage plus 3 ({@damage 1d6}) fire damage" silently
 * dropped the fire. These tests pin the multi-tag behaviour and the versatile
 * exception, which must NOT stack.
 *
 * The module is loaded whole (its regexes contain braces, which defeats the
 * brace-counting extractor used elsewhere) with stubs for its DOM helpers.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/table/table-monsters.js'), 'utf-8'
);

function load() {
  const ctx = createContext({
    esc: s => s, escJs: s => s, parseEntry: s => s,
    document: { getElementById: () => null, querySelector: () => null },
  });
  runInContext(SRC, ctx);
  if (typeof ctx._monsterDamageStr !== 'function')
    throw new Error('_monsterDamageStr not found — was it renamed?');
  return ctx._monsterDamageStr;
}

const monsterDamage = load();

describe('_monsterDamageStr — single damage tag', () => {
  it('reads dice and the type that follows the tag', () => {
    expect(monsterDamage('{@h}7 ({@damage 1d10 + 2}) piercing damage.'))
      .toBe('1d10+2 piercing');
  });

  it('reads a tag with no modifier', () => {
    expect(monsterDamage('{@h}3 ({@damage 1d6}) fire damage.')).toBe('1d6 fire');
  });

  it('keeps a full attack line intact', () => {
    expect(monsterDamage('{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}7 ({@damage 1d10 + 2}) piercing damage.'))
      .toBe('1d10+2 piercing');
  });

  it('falls back to bare dice when there is no tag', () => {
    expect(monsterDamage('The creature deals 2d6 damage on a failed save.')).toBe('2d6');
  });

  it('returns an empty string when nothing is rollable', () => {
    expect(monsterDamage('The creature is frightened until the end of its next turn.')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(monsterDamage('')).toBe('');
    expect(monsterDamage(null)).toBe('');
  });
});

describe('_monsterDamageStr — multiple damage tags', () => {
  it('captures a second "plus" damage type', () => {
    expect(monsterDamage('{@h}7 ({@damage 1d10 + 2}) piercing damage plus 3 ({@damage 1d6}) fire damage.'))
      .toBe('1d10+2 piercing, 1d6 fire');
  });

  it('captures three types', () => {
    expect(monsterDamage('{@h}5 ({@damage 1d6 + 2}) slashing damage plus 3 ({@damage 1d6}) acid damage plus 2 ({@damage 1d4}) cold damage.'))
      .toBe('1d6+2 slashing, 1d6 acid, 1d4 cold');
  });

  it('leaves a tag with no following type word untyped', () => {
    expect(monsterDamage('{@h}7 ({@damage 1d10}) piercing damage plus {@damage 2d6}.'))
      .toBe('1d10 piercing, 2d6');
  });
});

describe('_monsterDamageStr — versatile weapons must not stack', () => {
  it('skips the "or …" alternative', () => {
    expect(monsterDamage('{@h}6 ({@damage 1d8 + 2}) slashing damage, or 7 ({@damage 1d10 + 2}) slashing damage if used with two hands.'))
      .toBe('1d8+2 slashing');
  });

  it('still captures a "plus" that follows a versatile clause', () => {
    expect(monsterDamage('{@h}6 ({@damage 1d8 + 2}) slashing damage, or 7 ({@damage 1d10 + 2}) slashing damage if used with two hands, plus 3 ({@damage 1d6}) fire damage.'))
      .toBe('1d8+2 slashing, 1d6 fire');
  });
});
