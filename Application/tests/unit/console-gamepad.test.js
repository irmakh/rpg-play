// Written by Irmak Hakman — 2026-10-11 00:21
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The console gamepad's pure helpers (public/js/console/console-gamepad.js):
 * reading a pad into held controls, turning held controls into actions with
 * key-repeat, deciding which screen an action belongs to, and picking the next
 * thing to focus. None of these touch the DOM, so they run in a bare vm
 * context - the same real file the browser loads.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/console/console-gamepad.js'), 'utf-8');

function load() {
  const ctx = createContext({ console, navigator: {}, document: { documentElement: { classList: { add() {} } } } });
  // Top-level const/function declarations of a script are reachable from later
  // code run in the same context, so the helpers are handed out through one.
  runInContext(SRC, ctx);
  return runInContext('({ padHeld, padStep, padRoute, padPick, padDefaultMap, padResolveMap, padAssign, padInvert, padButtonLabel, PAD_ACTIONS, PAD_REPEATS, PAD_KEYS, PAD_REPEAT_DELAY, PAD_REPEAT_EVERY })', ctx);
}
const P = load();

// A Gamepad-shaped object with the given button indexes pressed.
function pad({ pressed = [], axes = [0, 0, 0, 0], analog = {} } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: analog[i] ?? (pressed.includes(i) ? 1 : 0) }));
  return { buttons, axes };
}

describe('padHeld: reading a gamepad', () => {
  it('names the standard buttons', () => {
    expect([...P.padHeld(pad({ pressed: [0, 5, 12] }))].sort()).toEqual(['a', 'r1', 'up']);
  });

  it('counts an analog trigger once it is past halfway', () => {
    expect(P.padHeld(pad({ analog: { 7: 0.4 } })).has('r2')).toBe(false);
    expect(P.padHeld(pad({ analog: { 7: 0.6 } })).has('r2')).toBe(true);
  });

  it('ignores a stick inside the dead zone', () => {
    expect(P.padHeld(pad({ axes: [0.3, -0.3, 0.2, 0.1] })).size).toBe(0);
  });

  it('turns a stick into one direction, the dominant one', () => {
    expect([...P.padHeld(pad({ axes: [-0.9, 0.6, 0, 0] }))]).toEqual(['ls-left']);
    expect([...P.padHeld(pad({ axes: [0, 0, 0.2, 0.95] }))]).toEqual(['rs-down']);
  });

  it('survives a missing pad', () => {
    expect(P.padHeld(null).size).toBe(0);
    expect(P.padHeld({}).size).toBe(0);
  });
});

describe('choosing the buttons', () => {
  it('starts from the standard layout', () => {
    const map = P.padDefaultMap();
    expect(map.a).toBe(0);
    expect(map.start).toBe(9);
    expect(Object.keys(map)).toHaveLength(14);
  });

  it('moves a control to another button and swaps with whatever had it', () => {
    const map = P.padAssign(P.padDefaultMap(), 'a', 1);   // A onto B's button
    expect(map.a).toBe(1);
    expect(map.b).toBe(0);
    // Every control still has a button of its own.
    expect(new Set(Object.values(map)).size).toBe(14);
  });

  it('moves a control to a button nothing was using', () => {
    const map = P.padAssign(P.padDefaultMap(), 'x', 16);
    expect(map.x).toBe(16);
    expect(Object.values(map).filter(i => i === 2)).toHaveLength(0);
  });

  it('does not change the map it was given, and ignores an unknown control', () => {
    const start = P.padDefaultMap();
    P.padAssign(start, 'a', 5);
    expect(start.a).toBe(0);
    expect(P.padAssign(start, 'nope', 5)).toEqual(start);
  });

  it('reads a custom layout: the re-assigned button now produces that control', () => {
    const table = P.padInvert(P.padAssign(P.padDefaultMap(), 'a', 1));
    expect([...P.padHeld(pad({ pressed: [1] }), table)]).toEqual(['a']);
    expect([...P.padHeld(pad({ pressed: [0] }), table)]).toEqual(['b']);
  });

  it('falls back to the standard layout for a damaged saved setting', () => {
    expect(P.padResolveMap(null)).toEqual(P.padDefaultMap());
    expect(P.padResolveMap('rubbish')).toEqual(P.padDefaultMap());
    const partly = P.padResolveMap({ a: 7, b: -1, x: 'two', bogus: 3 });
    expect(partly.a).toBe(7);
    expect(partly.b).toBe(1);
    expect(partly.x).toBe(2);
    expect('bogus' in partly).toBe(false);
  });

  it('names buttons for the screen', () => {
    expect([P.padButtonLabel(0), P.padButtonLabel(9), P.padButtonLabel(22), P.padButtonLabel(undefined)]).toEqual(['A', 'Start', 'Button 22', 'none']);
  });
});

describe('padStep: presses and repeats', () => {
  it('fires once for a button that does not repeat, however long it is held', () => {
    const timers = new Map();
    expect(P.padStep(timers, new Set(['a']), 0)).toEqual(['activate']);
    expect(P.padStep(timers, new Set(['a']), 5000)).toEqual([]);
  });

  it('fires again after the button is released and pressed', () => {
    const timers = new Map();
    P.padStep(timers, new Set(['x']), 0);
    P.padStep(timers, new Set(), 16);
    expect(P.padStep(timers, new Set(['x']), 32)).toEqual(['end-turn']);
  });

  it('repeats a direction after the delay, then at the repeat rate', () => {
    const timers = new Map();
    const held = new Set(['ls-up']);
    expect(P.padStep(timers, held, 0)).toEqual(['move-up']);
    expect(P.padStep(timers, held, P.PAD_REPEAT_DELAY - 1)).toEqual([]);
    expect(P.padStep(timers, held, P.PAD_REPEAT_DELAY)).toEqual(['move-up']);
    expect(P.padStep(timers, held, P.PAD_REPEAT_DELAY + P.PAD_REPEAT_EVERY - 1)).toEqual([]);
    expect(P.padStep(timers, held, P.PAD_REPEAT_DELAY + P.PAD_REPEAT_EVERY)).toEqual(['move-up']);
  });

  it('handles several controls at once', () => {
    expect(P.padStep(new Map(), new Set(['r1', 'rs-left']), 0).sort()).toEqual(['pan-left', 'tab-next']);
  });
});

describe('the tables agree with each other', () => {
  it('every repeating action is produced by some control', () => {
    const actions = new Set(Object.values(P.PAD_ACTIONS));
    for (const a of P.PAD_REPEATS) expect(actions.has(a)).toBe(true);
  });

  it('every keyboard action is a real action', () => {
    const actions = new Set(Object.values(P.PAD_ACTIONS));
    for (const a of Object.values(P.PAD_KEYS)) expect(actions.has(a)).toBe(true);
  });

  it('gives every action to exactly one screen, except Back which both have', () => {
    // The two handler lists, read from the files that register them.
    const read = f => readFileSync(resolve(__dirname, '../../public/js/console', f), 'utf-8');
    const keysIn = text => new Set([...text.matchAll(/^\s+'([a-z-]+)':/gm)].map(m => m[1]));
    const panel = keysIn(read('panel-pad.js').split('handlers: {')[1]);
    const map   = keysIn(read('table-console.js').split('handlers: {')[1]);
    for (const action of new Set(Object.values(P.PAD_ACTIONS))) {
      const owners = (panel.has(action) ? 1 : 0) + (map.has(action) ? 1 : 0);
      expect([action, owners]).toEqual([action, action === 'back' ? 2 : 1]);
    }
  });
});

describe('padRoute: which screen acts', () => {
  const own = new Set(['tab-next', 'back']);

  it('keeps an action this screen owns', () => {
    expect(P.padRoute('tab-next', own)).toEqual({ local: true, forward: false });
  });

  it('forwards an action it does not own', () => {
    expect(P.padRoute('move-up', own)).toEqual({ local: false, forward: true });
  });

  it('runs Back here and forwards it too', () => {
    expect(P.padRoute('back', own)).toEqual({ local: true, forward: true });
  });
});

describe('padPick: moving the focus ring', () => {
  // A 2 x 3 grid of 100 x 40 boxes, index = row * 3 + column, plus one wide bar under it.
  const box = (col, row) => ({ left: col * 110, right: col * 110 + 100, top: row * 50, bottom: row * 50 + 40 });
  const rects = [box(0, 0), box(1, 0), box(2, 0), box(0, 1), box(1, 1), box(2, 1), { left: 0, right: 320, top: 100, bottom: 140 }];

  it('starts on the first thing when nothing is focused', () => {
    expect(P.padPick(rects, -1, 'down')).toBe(0);
  });

  it('moves along a row', () => {
    expect(P.padPick(rects, 0, 'right')).toBe(1);
    expect(P.padPick(rects, 2, 'left')).toBe(1);
  });

  it('moves down a column rather than jumping sideways', () => {
    expect(P.padPick(rects, 2, 'down')).toBe(5);
    expect(P.padPick(rects, 4, 'up')).toBe(1);
  });

  it('reaches a wide element below the grid', () => {
    expect(P.padPick(rects, 4, 'down')).toBe(6);
  });

  it('stays put at an edge', () => {
    expect(P.padPick(rects, 0, 'left')).toBe(-1);
    expect(P.padPick(rects, 1, 'up')).toBe(-1);
  });

  it('copes with an empty list', () => {
    expect(P.padPick([], 0, 'down')).toBe(-1);
  });
});
