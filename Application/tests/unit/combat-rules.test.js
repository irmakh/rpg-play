// Written by Irmak Hakman — 2026-11-16 15:22
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/** public/js/lib/combat-rules.js — HP entry and the concentration DC. */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/lib/combat-rules.js'), 'utf-8');
const ctx = createContext({});
runInContext(SRC, ctx);
const { parseHpEntry, applyHpEntry, concentrationDc } = ctx;

describe('parseHpEntry', () => {
  it('reads damage, healing and a set value', () => {
    expect(parseHpEntry('-7')).toEqual({ mode: 'dmg', n: 7 });
    expect(parseHpEntry('+5')).toEqual({ mode: 'heal', n: 5 });
    expect(parseHpEntry('20')).toEqual({ mode: 'set', n: 20 });
    expect(parseHpEntry('=0')).toEqual({ mode: 'set', n: 0 });
  });
  it('allows spaces and a typographic minus', () => {
    expect(parseHpEntry('  - 12 ')).toEqual({ mode: 'dmg', n: 12 });
    expect(parseHpEntry('−3')).toEqual({ mode: 'dmg', n: 3 });
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '-', '+0', '-0', '1d6', '5.5', '99999', null]) expect(parseHpEntry(bad)).toBeNull();
  });
});

describe('applyHpEntry', () => {
  const hp = { hpCurrent: 24, hpTemp: 3, hpMax: 31 };
  it('takes damage from temporary HP first', () => {
    expect(applyHpEntry(hp, { mode: 'dmg', n: 7 })).toEqual({ hpCurrent: 20, hpTemp: 0, damage: 7 });
    expect(applyHpEntry(hp, { mode: 'dmg', n: 2 })).toEqual({ hpCurrent: 24, hpTemp: 1, damage: 2 });
  });
  it('never goes below 0', () => {
    expect(applyHpEntry(hp, { mode: 'dmg', n: 100 }).hpCurrent).toBe(0);
  });
  it('heals and sets up to the maximum, leaving temporary HP alone', () => {
    expect(applyHpEntry(hp, { mode: 'heal', n: 50 })).toEqual({ hpCurrent: 31, hpTemp: 3, damage: 0 });
    expect(applyHpEntry(hp, { mode: 'set', n: 40 })).toEqual({ hpCurrent: 31, hpTemp: 3, damage: 0 });
    expect(applyHpEntry(hp, { mode: 'set', n: 10 })).toEqual({ hpCurrent: 10, hpTemp: 3, damage: 0 });
  });
  it('has no cap when the maximum is unknown', () => {
    expect(applyHpEntry({ hpCurrent: 5 }, { mode: 'heal', n: 10 }).hpCurrent).toBe(15);
  });
});

describe('concentrationDc', () => {
  it('is half the damage, at least 10', () => {
    expect(concentrationDc(7)).toBe(10);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(22)).toBe(11);
    expect(concentrationDc(45)).toBe(22);
  });
});
