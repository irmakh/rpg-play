// Written by Irmak Hakman — 2026-10-10 21:28
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Console gamepad ──────────────────────────────────────────────────────────
// Lets the handheld's buttons and sticks drive both console screens.
//
// HOW IT FITS TOGETHER
//  1. Every animation frame the pad is read (the Gamepad API has no events for
//     buttons) and turned into a set of held control names: 'a', 'l1', 'up',
//     'ls-left' (left stick pushed left), 'rs-down', ...
//  2. Comparing that set with the previous frame gives presses. Directions and
//     zoom REPEAT while held - after a short delay, then steadily - the way a
//     held key does.
//  3. Each control stands for one named ACTION ('tab-next', 'move-up', ...).
//     The table is PAD_ACTIONS below, the same on both screens.
//  4. A screen handles the actions it owns and FORWARDS the rest to the other
//     screen over the console relay (the same server relay the two screens
//     already use to stay in step). So it does not matter which of the two
//     windows the handheld is giving its buttons to.
//
// The mapping assumes the browser's "standard" gamepad layout. Whether the AYN
// Thor reports that layout is checked with /console/probe.html; if it does not,
// PAD_BUTTONS is the one table to change.
//
// A keyboard fallback (PAD_KEYS) makes the same actions reachable on a PC, and
// covers handhelds that send their buttons as key presses.

// ── Tables ───────────────────────────────────────────────────────────────────
// Standard-layout button index -> control name.
const PAD_BUTTONS = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y',
  4: 'l1', 5: 'r1', 6: 'l2', 7: 'r2',
  8: 'select', 9: 'start',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

// Control name -> action.
const PAD_ACTIONS = {
  up: 'focus-up', down: 'focus-down', left: 'focus-left', right: 'focus-right',
  a: 'activate', b: 'back', x: 'end-turn', y: 'dice',
  l1: 'tab-prev', r1: 'tab-next',
  'ls-up': 'move-up', 'ls-down': 'move-down', 'ls-left': 'move-left', 'ls-right': 'move-right',
  'rs-up': 'pan-up', 'rs-down': 'pan-down', 'rs-left': 'pan-left', 'rs-right': 'pan-right',
  l2: 'zoom-out', r2: 'zoom-in',
  start: 'tools', select: 'undo',
};

// Actions that keep firing while the control is held.
const PAD_REPEATS = new Set([
  'focus-up', 'focus-down', 'focus-left', 'focus-right',
  'move-up', 'move-down', 'move-left', 'move-right',
  'pan-up', 'pan-down', 'pan-left', 'pan-right',
  'zoom-in', 'zoom-out',
]);

// Actions BOTH screens act on, each in its own way ("back" closes whatever is
// open on either screen).
const PAD_SHARED = new Set(['back']);

// Keyboard fallback: KeyboardEvent.key -> action. Arrow keys are left out on
// purpose - the map already moves the selected token with them, and on the
// panel the browser's own Tab/arrow handling covers form controls.
const PAD_KEYS = {
  Escape: 'back',
  '[': 'tab-prev', ']': 'tab-next',
  x: 'end-turn', y: 'dice',
  w: 'move-up', s: 'move-down', a: 'move-left', d: 'move-right',
  i: 'pan-up', k: 'pan-down', j: 'pan-left', l: 'pan-right',
  '-': 'zoom-out', '=': 'zoom-in',
  t: 'tools', u: 'undo',
};

const PAD_STICK_DEADZONE = 0.55;   // how far a stick must be pushed to count
const PAD_REPEAT_DELAY   = 380;    // ms held before repeating starts
const PAD_REPEAT_EVERY   = 130;    // ms between repeats

// ── Pure helpers (no DOM; unit-tested) ───────────────────────────────────────

/** The set of control names held on a Gamepad object right now. */
function padHeld(gp) {
  const held = new Set();
  if (!gp) return held;
  (gp.buttons || []).forEach((b, i) => {
    const name = PAD_BUTTONS[i];
    // Triggers are analog: count them as pressed past the halfway point.
    if (name && b && (b.pressed || b.value > 0.5)) held.add(name);
  });
  const ax = gp.axes || [];
  const stick = (prefix, x, y) => {
    // The dominant direction wins, so a slightly diagonal push is not two moves.
    if (Math.abs(x) < PAD_STICK_DEADZONE && Math.abs(y) < PAD_STICK_DEADZONE) return;
    if (Math.abs(x) >= Math.abs(y)) held.add(prefix + (x < 0 ? '-left' : '-right'));
    else held.add(prefix + (y < 0 ? '-up' : '-down'));
  };
  stick('ls', ax[0] || 0, ax[1] || 0);
  stick('rs', ax[2] || 0, ax[3] || 0);
  return held;
}

/**
 * Which actions fire this frame.
 *
 * @param {Map<string, number>} timers  control -> time its next repeat is due;
 *        kept by the caller between frames and updated here
 * @param {Set<string>} held  controls held this frame (from padHeld)
 * @param {number} now  a millisecond clock
 * @returns {string[]} action names, in the order of PAD_ACTIONS
 */
function padStep(timers, held, now) {
  const fired = [];
  for (const control of [...timers.keys()]) if (!held.has(control)) timers.delete(control);
  for (const control of Object.keys(PAD_ACTIONS)) {
    if (!held.has(control)) continue;
    const action = PAD_ACTIONS[control];
    if (!timers.has(control)) {
      // Fresh press: fire, and for a repeating action schedule the first repeat.
      timers.set(control, PAD_REPEATS.has(action) ? now + PAD_REPEAT_DELAY : Infinity);
      fired.push(action);
    } else if (now >= timers.get(control)) {
      timers.set(control, now + PAD_REPEAT_EVERY);
      fired.push(action);
    }
  }
  return fired;
}

/**
 * Where an action goes, given the actions this screen handles itself.
 * @returns {{local: boolean, forward: boolean}}
 */
function padRoute(action, ownActions) {
  const mine = ownActions.has(action);
  if (PAD_SHARED.has(action)) return { local: mine, forward: true };
  return { local: mine, forward: !mine };
}

/**
 * Picks the next thing to focus when a direction is pressed.
 *
 * Works on rectangles, not elements, so it can be tested: `rects` is one
 * {left, top, right, bottom} per focusable thing, `from` the index focused now
 * (-1 for none). A candidate must lie beyond the current one in the pressed
 * direction; among those, the nearest wins, with sideways distance counted
 * double so focus runs along a row or down a column before it jumps across.
 *
 * @returns {number} index into rects, or -1 when there is nowhere to go
 */
function padPick(rects, from, dir) {
  if (!rects.length) return -1;
  if (from < 0 || from >= rects.length) return 0;
  const c = r => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
  const cur = c(rects[from]);
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const p = c(r);
    const dx = p.x - cur.x, dy = p.y - cur.y;
    let along, across;
    if (dir === 'up')         { along = -dy; across = Math.abs(dx); }
    else if (dir === 'down')  { along = dy;  across = Math.abs(dx); }
    else if (dir === 'left')  { along = -dx; across = Math.abs(dy); }
    else                      { along = dx;  across = Math.abs(dy); }
    if (along <= 1) return;            // not in that direction
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// ── Runtime ──────────────────────────────────────────────────────────────────
const ConsolePad = (function () {
  let _handlers = {};
  let _own = new Set();
  let _relay = () => {};
  const _timers = new Map();
  let _lastLocalInput = 0;      // when THIS window last saw the pad itself
  let _running = false;

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  // The first real input switches the page into "pad" mode: css shows the focus
  // ring on whatever is focused and the button legends appear.
  function markPadOn() {
    document.documentElement.classList.add('pad-on');
  }

  function dispatch(action) {
    const { local, forward } = padRoute(action, _own);
    if (local) run(action);
    if (forward) _relay({ type: 'PAD', action });
  }

  function run(action) {
    const fn = _handlers[action];
    if (!fn) return;
    try { fn(action); } catch (err) { console.error('[pad]', action, err); }
  }

  function frame() {
    let pads = [];
    try { pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); } catch {}
    // Every connected pad counts as one: the handheld may list its built-in
    // controls and a virtual device side by side.
    const held = new Set();
    for (const gp of pads) for (const c of padHeld(gp)) held.add(c);
    const fired = padStep(_timers, held, now());
    if (held.size) { _lastLocalInput = now(); markPadOn(); }
    for (const action of fired) dispatch(action);
    requestAnimationFrame(frame);
  }

  function typingInField(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typingInField(e.target)) return;
    const action = PAD_KEYS[e.key];
    if (!action) return;
    dispatch(action);
  }

  return {
    /**
     * @param {{handlers: Object<string, Function>, relay: (msg: object) => void}} opts
     *   handlers  action name -> what this screen does for it
     *   relay     sends a message to this person's other console screen
     */
    init({ handlers, relay }) {
      _handlers = handlers || {};
      _own = new Set(Object.keys(_handlers));
      _relay = relay || (() => {});
      window.addEventListener('keydown', onKey);
      if (!_running && 'getGamepads' in navigator) { _running = true; requestAnimationFrame(frame); }
    },

    /**
     * An action forwarded by the other screen. Ignored when this window is
     * reading the pad itself: on a device that gives its buttons to both
     * windows at once, each would otherwise act twice.
     */
    remote(action) {
      if (now() - _lastLocalInput < 1500) return;
      markPadOn();
      run(action);
    },
  };
})();
