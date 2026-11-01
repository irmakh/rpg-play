// Written by Irmak Hakman — 2026-11-01 18:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Two things from the same release:
 *
 *  1. Critical damage in lib/dice-engine.js — critDamageSpec, parseDamage(expr,
 *     true), isAttackLabel, and the /crit chat command. 5e rule: the damage
 *     dice roll twice, the modifiers are added once.
 *  2. Bulk selection in table-map.js — the token single-selected before a
 *     shift+click (or shift+drag) must join the bulk set, or every bulk action
 *     (group save, check, HP, conditions) silently skips it.
 *  3. rollIsSecret in table-chat.js — the DM rolling for a token hidden from
 *     players makes the roll DM-only everywhere.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Dice engine (DOM-free half, same slice as index-damage.test.js) ──────────
const ENGINE = readFileSync(resolve(__dirname, '../../public/js/lib/dice-engine.js'), 'utf-8');
const MATH_SRC = ENGINE.slice(0, ENGINE.indexOf('function advClose'));

function loadEngine(mockRandom = null) {
  const ctx = createContext({ Math, parseInt, String, Array, Number, isNaN });
  if (mockRandom) {
    ctx._mockRandom = mockRandom;
    runInContext('Math.random = _mockRandom;', ctx);
  }
  runInContext(MATH_SRC, ctx);
  return ctx;
}
const ALWAYS_MAX = () => 0.999999;

describe('critDamageSpec', () => {
  const { parseDamageSpec, critDamageSpec } = loadEngine();

  it('doubles the dice and keeps the modifier', () => {
    const spec = critDamageSpec(parseDamageSpec('1d8+3 slashing'));
    expect(spec.parts[0]).toMatchObject({ count: 2, sides: 8, modifier: 3, type: 'slashing' });
    expect(spec.crit).toBe(true);
  });

  it('doubles every typed part', () => {
    const spec = critDamageSpec(parseDamageSpec('1d6+2 piercing, 2d8 fire'));
    expect(spec.parts.map(p => p.count)).toEqual([2, 4]);
    expect(spec.parts.map(p => p.modifier)).toEqual([2, 0]);
  });

  it('leaves flat parts alone', () => {
    const spec = critDamageSpec(parseDamageSpec('1d4 fire, 5 cold'));
    expect(spec.parts[1]).toMatchObject({ count: 0, sides: 0, flat: 5 });
  });

  it('does not change the spec it was given', () => {
    const base = parseDamageSpec('1d8+3');
    critDamageSpec(base);
    expect(base.parts[0].count).toBe(1);
  });
});

describe('parseDamage with crit', () => {
  it('rolls twice the dice, adds the modifier once', () => {
    const { parseDamage } = loadEngine(ALWAYS_MAX);
    const dmg = parseDamage('1d8+3 slashing', true);
    expect(dmg.parts[0].rolls).toEqual([8, 8]);
    expect(dmg.total).toBe(8 + 8 + 3);   // not (8+3)*2
    expect(dmg.crit).toBe(true);
    expect(dmg.parts[0].dice).toBe('2d8+3');
  });

  it('a crit with a flat part adds the flat once', () => {
    const { parseDamage } = loadEngine(ALWAYS_MAX);
    expect(parseDamage('1d6 fire, 5 cold', true).total).toBe(6 + 6 + 5);
  });

  it('without crit nothing changes', () => {
    const { parseDamage } = loadEngine(ALWAYS_MAX);
    const dmg = parseDamage('1d8+3');
    expect(dmg.total).toBe(11);
    expect(dmg.crit).toBeUndefined();
  });
});

describe('isAttackLabel', () => {
  const { isAttackLabel } = loadEngine();
  it.each(['Longsword Atk', 'Bite atk', 'Spell Attack', 'Longsword Attack (Adv)'])('%s is an attack', l =>
    expect(isAttackLabel(l)).toBe(true));
  it.each(['DEX Save', 'Initiative', 'Athletics', 'Attacker Dmg', ''])('%s is not', l =>
    expect(isAttackLabel(l)).toBe(false));
});

describe('parseDiceCommand — /crit', () => {
  const { parseDiceCommand } = loadEngine();

  it('doubles the dice of a typed roll', () => {
    const r = parseDiceCommand('/crit 1d8+3 slashing');
    expect(r.crit).toBe(true);
    expect(r.damage.parts[0]).toMatchObject({ count: 2, sides: 8, modifier: 3 });
    expect(r.expr).toBe('1d8+3 slashing');
  });

  it('rejects junk', () => {
    expect(parseDiceCommand('/crit hello')).toBeNull();
  });
});

// ── Bulk selection fold (table-map.js) ───────────────────────────────────────
const MAP = readFileSync(resolve(__dirname, '../../public/js/table/table-map.js'), 'utf-8');
function extract(src, name) {
  const m = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  let depth = 0, i = m.index;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(m.index, i + 1);
}
const SEL_SRC = extract(MAP, '_selectTokenClick') + '\n' + extract(MAP, '_foldSingleIntoBulk');

function loadSel(selectedTokenId) {
  const ctx = createContext({
    tokens: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    bulkTokenIds: new Set(),
    selectedTokenId,
    isDM: () => true,
    closeHpPanel() {}, renderTokens() {}, renderBulkPanel() {},
    selectToken(id) { ctx.selectedTokenId = id; }, openHpPanel() {},
  });
  runInContext(SEL_SRC, ctx);
  return ctx;
}
const shift = { shiftKey: true };

describe('shift+click keeps the single-selected token', () => {
  it('click A, shift+click B and C → A, B and C are all selected', () => {
    const ctx = loadSel(null);
    ctx._selectTokenClick({ id: 'a' }, { shiftKey: false });
    ctx._selectTokenClick({ id: 'b' }, shift);
    ctx._selectTokenClick({ id: 'c' }, shift);
    expect([...ctx.bulkTokenIds].sort()).toEqual(['a', 'b', 'c']);
    expect(ctx.selectedTokenId).toBeNull();
  });

  it('shift+clicking the single-selected token itself selects just it', () => {
    const ctx = loadSel('a');
    ctx._selectTokenClick({ id: 'a' }, shift);
    expect([...ctx.bulkTokenIds]).toEqual(['a']);
  });

  it('shift+click toggles off a token already in the set', () => {
    const ctx = loadSel('a');
    ctx._selectTokenClick({ id: 'b' }, shift);
    ctx._selectTokenClick({ id: 'b' }, shift);
    expect([...ctx.bulkTokenIds]).toEqual(['a']);
  });

  it('a plain click clears the bulk set', () => {
    const ctx = loadSel('a');
    ctx._selectTokenClick({ id: 'b' }, shift);
    ctx._selectTokenClick({ id: 'c' }, { shiftKey: false });
    expect(ctx.bulkTokenIds.size).toBe(0);
    expect(ctx.selectedTokenId).toBe('c');
  });

  it('a stale single selection (token gone) is not added', () => {
    const ctx = loadSel('zzz');
    ctx._foldSingleIntoBulk(null);
    expect(ctx.bulkTokenIds.size).toBe(0);
    expect(ctx.selectedTokenId).toBeNull();
  });
});

// ── rollIsSecret (table-chat.js): the DM rolling for a hidden token ──────────
const CHAT = readFileSync(resolve(__dirname, '../../public/js/table/table-chat.js'), 'utf-8');
function loadSecret({ dm, panelId = null, selectedId = null }) {
  const ctx = createContext({
    isDM: () => dm,
    _sideQrollTokenId: panelId,
    selectedTokenId: selectedId,
    tokens: [{ id: 'gob', visible: false }, { id: 'orc', visible: true }, { id: 'pc', visible: undefined }],
  });
  runInContext(extract(CHAT, 'rollIsSecret'), ctx);
  return ctx.rollIsSecret;
}

describe('rollIsSecret', () => {
  it('is secret when the DM rolls from a hidden token\'s panel', () =>
    expect(loadSecret({ dm: true, panelId: 'gob' })()).toBe(true));
  it('falls back to the selected token (a chat /r roll)', () =>
    expect(loadSecret({ dm: true, selectedId: 'gob' })()).toBe(true));
  it('is public for a visible token', () =>
    expect(loadSecret({ dm: true, panelId: 'orc' })()).toBe(false));
  it('is public for a token with no visibility set', () =>
    expect(loadSecret({ dm: true, panelId: 'pc' })()).toBe(false));
  it('is public with nothing selected', () =>
    expect(loadSecret({ dm: true })()).toBe(false));
  it('never applies to a player', () =>
    expect(loadSecret({ dm: false, panelId: 'gob' })()).toBe(false));
});
