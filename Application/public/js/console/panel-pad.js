// Written by Irmak Hakman — 2026-10-10 21:38
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
  // The music player is another page in a frame, which the pad cannot reach
  // into; while it is open only its Close button can be focused.
  const scope = sheet && !sheet.hidden ? sheet
              : sNotifListOpen() ? sEl('notif-panel')
              : sMusicSheetOpen() ? sEl('music-modal')
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
  if (sMusicSheetOpen()) { closeMusicModal(); return; }
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

function sPadInit() {
  if (typeof ConsolePad === 'undefined') return;
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
