// Written by Irmak Hakman — 2026-11-16 15:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Small combat rules shared by the table and the character sheet. Pure
 * functions with no DOM, so tests/unit/combat-rules.test.js runs them as they
 * are.
 */

/**
 * What a player typed into an HP box:
 *   "-7"  → 7 damage        "+5" → heal 5        "20" (or "=20") → set HP to 20
 * Returns { mode: 'dmg'|'heal'|'set', n } or null for anything else.
 */
function parseHpEntry(text) {
  const m = /^\s*([+\-=]?)\s*(\d{1,4})\s*$/.exec(String(text == null ? '' : text).replace('−', '-'));
  if (!m) return null;
  const n = parseInt(m[2], 10);
  const mode = m[1] === '-' ? 'dmg' : m[1] === '+' ? 'heal' : 'set';
  if (mode !== 'set' && n === 0) return null;
  return { mode, n };
}

/**
 * The new HP after an entry. Damage takes temporary HP first; healing and
 * setting stop at the maximum (when one is known) and never touch temporary
 * HP. Returns { hpCurrent, hpTemp, damage } where damage is what reached the
 * real HP (for a concentration save).
 */
function applyHpEntry(hp, entry) {
  const cur = Math.max(0, parseInt(hp && hp.hpCurrent) || 0);
  const temp = Math.max(0, parseInt(hp && hp.hpTemp) || 0);
  const max = Math.max(0, parseInt(hp && hp.hpMax) || 0);
  const cap = (v) => (max > 0 ? Math.min(max, v) : v);
  if (!entry) return { hpCurrent: cur, hpTemp: temp, damage: 0 };
  if (entry.mode === 'dmg') {
    const fromTemp = Math.min(temp, entry.n);
    const rest = entry.n - fromTemp;
    return { hpCurrent: Math.max(0, cur - rest), hpTemp: temp - fromTemp, damage: entry.n };
  }
  if (entry.mode === 'heal') return { hpCurrent: cap(cur + entry.n), hpTemp: temp, damage: 0 };
  return { hpCurrent: cap(entry.n), hpTemp: temp, damage: 0 };
}

/** Constitution save DC to keep concentrating after taking damage: half the damage, at least 10. */
function concentrationDc(damage) {
  return Math.max(10, Math.floor((parseInt(damage) || 0) / 2));
}
