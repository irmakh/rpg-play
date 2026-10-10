// Written by Irmak Hakman — 2026-10-11 00:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: what the gamepad does here ───────────────────────────────────
// js/console/console-gamepad.js reads the pad and names the actions; this file
// is the info panel's half of them. The map screen has the other half (moving
// a token, panning, zoom) in js/console/table-console.js.
//
//   D-pad    move the focus ring between buttons, rows and fields
//   A        press whatever has the focus ring
//   B        back: cancel a question, leave a part of the Token tab, go to Turn
//   L1 / R1  previous / next tab
//   X        the turn action on the Turn tab (Next turn, End my turn, Start
//            initiative) - pressed twice, so a bumped button does not end a turn
//   Y        open Chat with the d20 button focused

// Everything the focus ring may land on right now. While a question is open
// only its two buttons count, so the pad cannot wander off behind it.
function sPadFocusables() {
  const sheet = sEl('s-confirm');
  const scope = sheet && !sheet.hidden ? sheet
              : sNotifListOpen() ? sEl('notif-panel')
              : document.querySelector('.p-app');
  if (!scope) return [];
  return [...scope.querySelectorAll('button, a[href], input, select, summary')]
    .filter(el => !el.disabled && el.getClientRects().length > 0);
}

function sPadFocus(dir) {
  const els = sPadFocusables();
  if (!els.length) return;
  const from = els.indexOf(document.activeElement);
  // Nothing focused yet: start on the open tab's own button.
  if (from < 0) {
    (document.querySelector('.p-tab[aria-selected="true"]') || els[0]).focus();
    return;
  }
  const idx = padPick(els.map(el => el.getBoundingClientRect()), from, dir);
  if (idx < 0) return;
  els[idx].focus();
  els[idx].scrollIntoView({ block: 'nearest' });
}

function sPadActivate() {
  const el = document.activeElement;
  if (!el || el === document.body) { sPadFocus('down'); return; }
  if (el.tagName === 'SELECT') {
    // Opens the option list where the browser allows it; otherwise the select
    // is at least focused and can be tapped.
    try { el.showPicker(); } catch {}
    return;
  }
  if (el.tagName === 'INPUT' && el.type !== 'range') return;   // focusing it is the action
  el.click();
}

function sPadBack() {
  const sheet = sEl('s-confirm');
  if (sheet && !sheet.hidden) { sConfirmAnswer(false); return; }
  if (sNotifListOpen()) { notifClose(); return; }
  if (sCurrentTab === 'token' && sTokenPane !== 'health') { sSetTokenPane('health'); return; }
  if (sCurrentTab === 'handouts' && sHoPick) { sHoPickHandout(null); return; }
  if (sCurrentTab !== 'turn') sShowTab('turn');
}

function sPadTab(step) {
  const tabs = [...document.querySelectorAll('.p-tab')].filter(b => !b.hidden);
  const at = tabs.findIndex(b => b.dataset.tab === sCurrentTab);
  const next = tabs[(at + step + tabs.length) % tabs.length];
  if (!next) return;
  sShowTab(next.dataset.tab);
  next.focus();
}

// X: the Turn tab's main action, whatever tab is showing. Two presses within a
// moment; the first only says what the second will do.
let _sPadTurnArmed = 0;
function sPadEndTurn() {
  const cmd = sCmdFor('turn').find(c => c[2] === 'go');
  if (!cmd) { sToast('It is not your turn.'); return; }
  const [label, fnName] = cmd;
  if (Date.now() - _sPadTurnArmed > 2500) {
    _sPadTurnArmed = Date.now();
    sToast(`Press X again: ${label}`);
    return;
  }
  _sPadTurnArmed = 0;
  window[fnName]();
}

function sPadDice() {
  sShowTab('chat');
  document.querySelector('.p-dice .d20')?.focus();
}

// ── Choosing the buttons (More tab) ──────────────────────────────────────────
// The list of buttons on the More tab is also where they are changed: press
// Change beside an action, then the button it should use.

// [control, what it does]. The sticks are listed for reference only.
const S_PAD_ROWS = [
  ['up', 'Move the highlight up'], ['down', 'Move the highlight down'],
  ['left', 'Move the highlight left'], ['right', 'Move the highlight right'],
  ['a', 'Press the highlighted button'], ['b', 'Back'],
  ['l1', 'Previous tab'], ['r1', 'Next tab'],
  ['x', 'Next turn or end my turn (press twice)'], ['y', 'Dice'],
  ['l2', 'Zoom the map out'], ['r2', 'Zoom the map in'],
  ['start', 'Map tools'], ['select', 'Undo the last token move'],
];
let _sPadChanging = null;   // the control waiting for a button press

function sPadRenderKeys() {
  const el = sEl('s-pad-keys');
  if (!el || typeof ConsolePad === 'undefined') return;
  // Everything here is fixed text from the table above - nothing typed by a user.
  el.innerHTML = S_PAD_ROWS.map(([control, what]) => {
    const waiting = _sPadChanging === control;
    return `<div class="p-key-row${waiting ? ' waiting' : ''}">
      <span class="c-key">${waiting ? '…' : ConsolePad.label(control)}</span>
      <span class="what">${waiting ? 'Press the button to use for this.' : what}</span>
      <button type="button" class="c-btn" onclick="sPadChange('${control}')">${waiting ? 'Cancel' : 'Change'}</button>
    </div>`;
  }).join('')
  + `<div class="p-key-row"><span class="c-key">L stick</span><span class="what">Move the selected token on the map</span></div>
     <div class="p-key-row"><span class="c-key">R stick</span><span class="what">Slide the map</span></div>`;
}

function sPadChange(control) {
  if (_sPadChanging === control) {            // pressed Cancel
    _sPadChanging = null;
    ConsolePad.cancelCapture();
    sPadRenderKeys();
    return;
  }
  _sPadChanging = control;
  sPadRenderKeys();
  ConsolePad.capture(index => {
    _sPadChanging = null;
    ConsolePad.assign(control, index);         // repaints through onChange
    sToast(`${padButtonLabel(index)} is now: ${S_PAD_ROWS.find(r => r[0] === control)[1]}.`);
  });
}

async function sPadReset() {
  if (!await sConfirm('Put every gamepad button back to the standard layout?', 'Reset buttons')) return;
  _sPadChanging = null;
  ConsolePad.cancelCapture();
  ConsolePad.reset();
}

function sPadInit() {
  if (typeof ConsolePad === 'undefined') return;
  // Redraw the list, and the X badge on the command bar, when buttons change.
  ConsolePad.onChange(() => { sPadRenderKeys(); sRenderCmd(); });
  ConsolePad.init({
    relay: _sConsolePost,
    handlers: {
      'focus-up':    () => sPadFocus('up'),
      'focus-down':  () => sPadFocus('down'),
      'focus-left':  () => sPadFocus('left'),
      'focus-right': () => sPadFocus('right'),
      'activate':    sPadActivate,
      'back':        sPadBack,
      'tab-prev':    () => sPadTab(-1),
      'tab-next':    () => sPadTab(1),
      'end-turn':    sPadEndTurn,
      'dice':        sPadDice,
    },
  });
}
