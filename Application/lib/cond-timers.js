// Written by Irmak Hakman — 2026-11-16 15:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Condition durations on a table token ("Poisoned, 2 rounds").
 *
 * Stored on the token as JSON in table_tokens.condTimers:
 *   { "Poisoned": { rounds: 2, ask: false, atEnd: false } }
 *
 * The count is never ticked silently. When the token's turn starts every
 * timed condition on it is marked `ask`, and whoever controls the token (its
 * player, or the DM for a monster; the DM may answer for anyone) chooses:
 *   now   - one round less, at once
 *   end   - one round less when this turn ends (`atEnd`)
 *   skip  - leave the count as it is this turn
 * A count that reaches 0 ends the condition.
 *
 * Pure: every function takes and returns plain objects, so the rules are
 * tested on their own (tests/unit/cond-timers.test.js).
 */

const MAX_ROUNDS = 999;

export function parseTimers(json) {
  let v = json;
  if (typeof v === 'string') { try { v = JSON.parse(v || '{}'); } catch { v = {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [name, t] of Object.entries(v)) {
    const rounds = parseInt(t && t.rounds);
    if (!name || !(rounds > 0)) continue;
    out[name] = { rounds: Math.min(MAX_ROUNDS, rounds), ask: !!t.ask, atEnd: !!t.atEnd };
  }
  return out;
}

export function parseConditions(json) {
  let v = json;
  if (typeof v === 'string') { try { v = JSON.parse(v || '[]'); } catch { v = []; } }
  return Array.isArray(v) ? v.map(String) : [];
}

/** Set (rounds > 0) or clear (0 / empty) the duration of one condition. */
export function setTimer(timers, name, rounds) {
  const out = { ...parseTimers(timers) };
  const n = parseInt(rounds);
  if (n > 0) out[name] = { rounds: Math.min(MAX_ROUNDS, n), ask: false, atEnd: false };
  else delete out[name];
  return out;
}

/** Only the timers of conditions the token still has. */
export function pruneTimers(timers, conditions) {
  const keep = new Set(parseConditions(conditions));
  const out = {};
  for (const [name, t] of Object.entries(parseTimers(timers))) if (keep.has(name)) out[name] = t;
  return out;
}

/** The token's turn begins: ask about every timed condition it has. */
export function markTurnStart(timers) {
  const out = {};
  for (const [name, t] of Object.entries(parseTimers(timers))) out[name] = { ...t, ask: true, atEnd: false };
  return out;
}

function tick(out, name, ended) {
  const t = out[name];
  if (t.rounds - 1 <= 0) { delete out[name]; ended.push(name); }
  else out[name] = { ...t, rounds: t.rounds - 1 };
}

/**
 * Answer the question for one condition.
 * Returns { timers, ended: [names whose count ran out], changed }.
 */
export function resolveAsk(timers, name, choice) {
  const out = { ...parseTimers(timers) };
  const ended = [];
  const t = out[name];
  if (!t) return { timers: out, ended, changed: false };
  if (choice === 'now') { out[name] = { ...t, ask: false, atEnd: false }; tick(out, name, ended); }
  else if (choice === 'end') out[name] = { ...t, ask: false, atEnd: true };
  else if (choice === 'skip') out[name] = { ...t, ask: false, atEnd: false };
  else return { timers: out, ended, changed: false };
  return { timers: out, ended, changed: true };
}

/**
 * The token's turn ends: "at end of turn" answers take their round off now.
 * A question left unanswered is dropped (the turn it was about is over).
 */
export function turnEnd(timers) {
  const out = { ...parseTimers(timers) };
  const ended = [];
  let changed = false;
  for (const name of Object.keys(out)) {
    const t = out[name];
    if (t.atEnd) { out[name] = { ...t, atEnd: false }; tick(out, name, ended); changed = true; }
    else if (t.ask) { out[name] = { ...t, ask: false }; changed = true; }
  }
  return { timers: out, ended, changed };
}
