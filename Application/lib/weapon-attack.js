// Written by Irmak Hakman — 2026-11-20 17:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * A weapon's attack bonus and damage string, worked out on the server exactly
 * as the sheet page does it (calcWeaponAtkStr / calcWeaponDmgStr in
 * public/js/index/index-items.js):
 *   attack = proficiency + ability modifier + magic bonus
 *   damage = the item's dice, with ability modifier + magic bonus on the FIRST part
 * Finesse takes the better of STR/DEX, Ammunition uses DEX, anything else STR.
 *
 * The damage string is parsed with the browser's own parseDamageSpec(): the
 * DOM-free top half of public/js/lib/dice-engine.js (everything before
 * parseDiceCommand) runs once in a vm context, so the two sides cannot drift.
 */
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ENGINE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../public/js/lib/dice-engine.js');

let _engine = null;
function engine() {
  if (_engine) return _engine;
  const src = readFileSync(ENGINE_FILE, 'utf-8');
  const end = src.indexOf('function parseDiceCommand');
  if (end === -1) throw new Error('weapon-attack: parseDiceCommand not found in dice-engine.js');
  const ctx = createContext({ Math, parseInt, String, Array, Number, isNaN });
  runInContext(src.slice(0, end) + '\n;this.parseDamageSpec = parseDamageSpec; this.DMG_GENERIC = DMG_GENERIC;', ctx);
  _engine = { parseDamageSpec: ctx.parseDamageSpec, DMG_GENERIC: ctx.DMG_GENERIC };
  return _engine;
}

const abilMod = score => Math.floor(((parseInt(score) || 10) - 10) / 2);
const signed  = n => (n >= 0 ? '+' : '') + n;

/** The proficiency bonus the sheet shows: the stored field, else from level. */
export function profBonusOf(data) {
  const p = parseInt(data.profbonus);
  if (!isNaN(p)) return p;
  const level = parseInt(data.level) || 1;
  return Math.floor((level - 1) / 4) + 2;
}

/** Proficiency bonus for a level (5e table), or null for no usable level. */
export function profBonusForLevel(level) {
  const l = parseInt(level);
  return l > 0 ? Math.floor((l - 1) / 4) + 2 : null;
}

function weaponProps(item) {
  const p = item.weaponProperties;
  if (Array.isArray(p)) return p;
  try { const a = JSON.parse(p || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

function abilityModFor(data, props) {
  const str = abilMod(data.str), dex = abilMod(data.dex);
  return props.includes('Finesse') ? Math.max(str, dex) : props.includes('Ammunition') ? dex : str;
}

/** "+5": proficiency + ability modifier + magic bonus. */
export function weaponAtkStr(data, item) {
  const props = weaponProps(item);
  return signed(profBonusOf(data) + abilityModFor(data, props) + (parseInt(item.weaponAtk) || 0));
}

/** "1d8+3 slashing, 2d6 fire": the bonus lands on the weapon's own (first) part. */
export function weaponDmgStr(data, item) {
  const props = weaponProps(item);
  const raw = String(item.weaponDmg || '1d4').trim() || '1d4';
  const bonus = abilityModFor(data, props) + (parseInt(item.weaponAtk) || 0);
  if (bonus === 0) return raw;
  const { parseDamageSpec, DMG_GENERIC } = engine();
  const spec = parseDamageSpec(raw);
  if (!spec) return raw;   // unparseable: leave the text alone, as the sheet does
  return spec.parts.map((p, i) => {
    const mod = p.modifier + (i === 0 ? bonus : 0);
    const modStr = mod === 0 ? '' : (mod > 0 ? '+' : '') + mod;
    const dice = p.sides ? `${p.count}d${p.sides}${modStr}` : String(p.flat + (i === 0 ? bonus : 0));
    return p.type === DMG_GENERIC ? dice : `${dice} ${p.type}`;
  }).join(', ');
}

/**
 * Rewrite the attack and damage of every _weapons row linked to a weapon item
 * (5th entry = item id), the way the sheet's refreshWeaponAttacks() does.
 * Rows added by hand, unidentified items and items with no damage dice of their
 * own keep what they have. Returns the new _weapons string, or null when no
 * row changed.
 */
export function refreshWeaponRows(data) {
  let rows, items;
  try { rows = JSON.parse(data._weapons || '[]'); } catch { return null; }
  try { items = JSON.parse(data._items || '[]'); } catch { return null; }
  if (!Array.isArray(rows) || !Array.isArray(items) || !rows.length) return null;
  const byId = new Map(items.filter(i => i && i.itemType === 'weapon' && !i.unidentified).map(i => [String(i.id), i]));
  let changed = false;
  for (const row of rows) {
    if (!Array.isArray(row) || row[4] === null || row[4] === undefined) continue;
    const item = byId.get(String(row[4]));
    if (!item) continue;
    const atk = weaponAtkStr(data, item);
    if (row[1] !== atk) { row[1] = atk; changed = true; }
    if (String(item.weaponDmg || '').trim()) {
      const dmg = weaponDmgStr(data, item);
      if (row[2] !== dmg) { row[2] = dmg; changed = true; }
    }
  }
  return changed ? JSON.stringify(rows) : null;
}
