// Written by Irmak Hakman — 2026-11-16 15:48
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/** lib/cond-timers.js — condition durations asked about at the start of a turn. */
import { describe, it, expect } from 'vitest';
import { parseTimers, setTimer, pruneTimers, markTurnStart, resolveAsk, turnEnd } from '../../lib/cond-timers.js';

describe('condition timers', () => {
  it('reads only valid entries', () => {
    expect(parseTimers('{"Poisoned":{"rounds":2},"Bad":{"rounds":0},"":{"rounds":3}}'))
      .toEqual({ Poisoned: { rounds: 2, ask: false, atEnd: false } });
    expect(parseTimers('not json')).toEqual({});
    expect(parseTimers(null)).toEqual({});
  });

  it('sets and clears a duration', () => {
    let t = setTimer({}, 'Poisoned', 3);
    expect(t.Poisoned.rounds).toBe(3);
    t = setTimer(t, 'Poisoned', 0);
    expect(t).toEqual({});
  });

  it('drops timers of conditions the token no longer has', () => {
    const t = setTimer(setTimer({}, 'Poisoned', 2), 'Frightened', 1);
    expect(Object.keys(pruneTimers(t, '["Frightened"]'))).toEqual(['Frightened']);
  });

  it('asks at the start of the turn', () => {
    const t = markTurnStart(setTimer({}, 'Poisoned', 2));
    expect(t.Poisoned).toEqual({ rounds: 2, ask: true, atEnd: false });
  });

  it('"now" takes a round off at once and ends it at 0', () => {
    let t = markTurnStart(setTimer({}, 'Poisoned', 2));
    let r = resolveAsk(t, 'Poisoned', 'now');
    expect(r.timers.Poisoned).toEqual({ rounds: 1, ask: false, atEnd: false });
    expect(r.ended).toEqual([]);
    r = resolveAsk(markTurnStart(r.timers), 'Poisoned', 'now');
    expect(r.timers).toEqual({});
    expect(r.ended).toEqual(['Poisoned']);
  });

  it('"end" waits for the end of the turn', () => {
    const t = markTurnStart(setTimer({}, 'Frightened', 1));
    const r = resolveAsk(t, 'Frightened', 'end');
    expect(r.timers.Frightened).toEqual({ rounds: 1, ask: false, atEnd: true });
    const e = turnEnd(r.timers);
    expect(e.ended).toEqual(['Frightened']);
    expect(e.timers).toEqual({});
  });

  it('"skip" leaves the count alone', () => {
    const r = resolveAsk(markTurnStart(setTimer({}, 'Poisoned', 2)), 'Poisoned', 'skip');
    expect(r.timers.Poisoned).toEqual({ rounds: 2, ask: false, atEnd: false });
    expect(turnEnd(r.timers).changed).toBe(false);
  });

  it('an unanswered question is dropped when the turn ends, count unchanged', () => {
    const e = turnEnd(markTurnStart(setTimer({}, 'Poisoned', 2)));
    expect(e.timers.Poisoned).toEqual({ rounds: 2, ask: false, atEnd: false });
    expect(e.changed).toBe(true);
  });

  it('ignores an unknown condition or choice', () => {
    expect(resolveAsk({}, 'Poisoned', 'now').changed).toBe(false);
    expect(resolveAsk(setTimer({}, 'Poisoned', 2), 'Poisoned', 'maybe').changed).toBe(false);
  });
});
