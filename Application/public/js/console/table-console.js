// Written by Irmak Hakman — 2026-10-11 00:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Console Mode Bridge (Screen 1 — Map) ─────────────────────────────────────
// Loaded only by table-console.html. Opens the secondary info window and keeps
// it in sync via server-side SSE relay so both screens can run in different
// browsers/devices on the same LAN.

let _secondaryWin = null;
let _consoleEs    = null;

// The console relay needs our session (v237) and only pairs screens held by the
// same person. EventSource and sendBeacon cannot send headers, so the token
// rides in the query — _storedSessionToken() is in js/lib/realtime.js.
function _consoleUrl(path) {
  const t = typeof _storedSessionToken === 'function' ? _storedSessionToken() : '';
  return path + '?token=' + encodeURIComponent(t);
}

function _consolePost(msg) {
  fetch(_consoleUrl('/api/console/event'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

function _consoleStartSSE() {
  if (_consoleEs) _consoleEs.close();
  if (!_storedSessionToken()) return;          // not logged in: the relay would refuse
  _consoleEs = new EventSource(_consoleUrl('/api/console/events'));
  _consoleEs.onmessage = ev => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    const { type } = d;
    if (type === 'SECONDARY_READY') {
      _setDot('online');
      _consolePost({
        type: 'STATE_SNAPSHOT',
        tokens: JSON.parse(JSON.stringify(tokens || [])),
        initData: JSON.parse(JSON.stringify(initData || {})),
      });
      if (selectedTokenId) {
        const tok = (tokens || []).find(t => t.id === selectedTokenId);
        if (tok) _consolePost({ type: 'TOKEN_SELECTED', token: JSON.parse(JSON.stringify(tok)) });
      }
    }
    if (type === 'SECONDARY_CLOSED') _setDot('offline');
    if (type === 'OPEN_ADD_TOKEN') openAddTokenModal?.();
    // The info panel selected a token: select it here too, so the arrows and the
    // pad move it. _prevOpenHpPanel, not openHpPanel - the wrapper below would
    // send the selection straight back to the panel.
    if (type === 'SELECT_TOKEN') {
      const tok = (tokens || []).find(t => t.id === d.id);
      if (tok && tok.id !== selectedTokenId) {
        selectToken(tok.id);
        _prevOpenHpPanel(tok);
        panToToken(tok.id);
        _consoleUpdateArrows();
      }
    }
    // A gamepad button pressed while the info panel had the pad.
    if (type === 'PAD') ConsolePad.remote(d.action);
  };
  _consoleEs.onerror = () => _setDot('offline');
}

function consoleOpenSecondary() {
  if (_secondaryWin && !_secondaryWin.closed) { _secondaryWin.focus(); return; }
  _secondaryWin = window.open('/console/table-secondary.html', 'rpg-secondary', 'width=620,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes');
  _setDot('offline');
}

let _consolePanelOnline = false;
function _setDot(state) {
  _consolePanelOnline = state === 'online';
  const dot = document.getElementById('console-secondary-dot');
  if (dot) dot.className = state;
}

// ── Notifications on the map screen ──────────────────────────────────────────
// Both screens load the shared notifications code, and both would pop up a
// toast and play the chime for the same event - twice, on one handheld. So
// while the info panel is connected the map stays quiet and only counts; on its
// own (a PC with just the map open) it behaves like any other page.
if (typeof notifToast === 'function') {
  for (const name of ['notifToast', 'notifChime', 'notifPopup']) {
    const original = window[name];
    window[name] = function (...args) { if (!_consolePanelOnline) return original.apply(this, args); };
  }
  // Opening a notification here must not navigate the map away to its link.
  window.notifFollow = function () { notifClose(); };
}

// ── Status line, Tools drawer and command line ───────────────────────────────
// The console's own frame around the map (css/console/map.css).

// Opens or closes the Tools drawer. Pass true/false to force it, nothing to flip it.
function consoleToggleTools(open) {
  const drawer = document.getElementById('m-tools');
  const btn    = document.getElementById('m-tools-btn');
  if (!drawer || !btn) return;
  const show = typeof open === 'boolean' ? open : drawer.hidden;
  drawer.hidden = !show;
  btn.setAttribute('aria-expanded', String(show));
}

// A tap anywhere outside the open drawer closes it.
document.addEventListener('pointerdown', e => {
  const drawer = document.getElementById('m-tools');
  if (!drawer || drawer.hidden) return;
  if (e.target.closest('#m-tools') || e.target.closest('#m-tools-btn')) return;
  consoleToggleTools(false);
}, true);

// What each tool does, in the words shown on the command line.
const CONSOLE_TOOLS = {
  select: ['Select', 'Tap a token to select it.'],
  move:   ['Move',   'Drag a token to move it.'],
  pan:    ['Pan',    'Drag to slide the map.'],
  ruler:  ['Ruler',  'Drag between two points to measure.'],
  ping:   ['Ping',   'Tap the map to show everyone a spot.'],
  draw:   ['Draw',   'Drag to draw. Shape and colour are above the map.'],
};

function _consoleUpdateTool() {
  const [name, hint] = CONSOLE_TOOLS[currentTool] || [currentTool, ''];
  const nameEl = document.getElementById('m-tool');
  const hintEl = document.getElementById('m-hint');
  if (nameEl) nameEl.textContent = name;
  if (hintEl) hintEl.textContent = hint;
}

// Whose turn it is, on the status line. A player sees a monster by its
// identifier only - tokDisplayName() applies that rule.
function _consoleUpdateTurn() {
  const el = document.getElementById('m-turn');
  if (!el) return;
  const entry = initData.currentId ? (initData.entries || []).find(e => e.id === initData.currentId) : null;
  if (!entry) {
    el.textContent = 'No initiative running';
    el.classList.remove('on');
    return;
  }
  const tok = (tokens || []).find(t => t.id === getActiveTurnTokenId());
  let name;
  if (tok) name = tokDisplayName(tok);
  else if (entry.monsterId && !isDM()) name = String(entry.name || '').trim().split(' ').pop();
  else name = entry.name || 'Someone';
  const mine = !!tok && !isDM() && isMyToken(tok);
  el.textContent = mine ? `Your turn, ${name}` : `${name}'s turn`;
  el.classList.add('on');
}

// Tapping the weather on the status line spells it out (there is no hover on a
// touch screen). _tableWeatherToday and weatherSummary come from the shared
// weather code.
function consoleShowWeather() {
  if (typeof _tableWeatherToday === 'undefined' || !_tableWeatherToday) return;
  showToast(weatherSummary(_tableWeatherToday));
}

// Show/hide D-pad based on whether current user can move the selected token
function _consoleUpdateArrows() {
  const wrap = document.getElementById('console-arrow-btns');
  if (!wrap) return;
  const tok = (tokens || []).find(t => t.id === selectedTokenId);
  const canMove = tok && isMyToken(tok) && (!initData.currentId || tok.id === getActiveTurnTokenId());
  wrap.style.display = canMove ? 'flex' : 'none';
}

// Wrap openHpPanel to relay the selected token to the secondary
const _prevOpenHpPanel = openHpPanel;
window.openHpPanel = function(tok) {
  _prevOpenHpPanel(tok);
  _consolePost({ type: 'TOKEN_SELECTED', token: JSON.parse(JSON.stringify(tok)) });
  _consoleUpdateArrows();
};

const _prevCloseHpPanel = closeHpPanel;
window.closeHpPanel = function() {
  _prevCloseHpPanel();
  _consolePost({ type: 'TOKEN_CLEARED' });
  _consoleUpdateArrows();
};

// Keep arrows in sync when initiative changes (turn advance hides/shows arrow for non-active tokens)
const _prevRenderTokens = renderTokens;
window.renderTokens = function() {
  _prevRenderTokens();
  _consoleUpdateArrows();
  _consoleUpdateTurn();
};

// The initiative list is redrawn on every initiative event - the status line follows.
const _prevRenderInitiativeTracker = renderInitiativeTracker;
window.renderInitiativeTracker = function(showBadge) {
  _prevRenderInitiativeTracker(showBadge);
  _consoleUpdateTurn();
  _consoleUpdateArrows();
};

// Picking a tool names it on the status line and closes the drawer.
const _prevSetTool = setTool;
window.setTool = function(name) {
  _prevSetTool(name);
  _consoleUpdateTool();
  consoleToggleTools(false);
};

// Detect secondary window closed via polling (no close event from window.open)
setInterval(() => {
  if (_secondaryWin && _secondaryWin.closed) { _secondaryWin = null; _setDot('offline'); }
}, 2000);

// On logout: end the session on the server, tell the other console screens on
// THIS device (BroadcastChannel — session messages never go through the server
// relay any more), clear it here and reload.
window.logout = function() {
  if (typeof revokeStoredSession === 'function') revokeStoredSession();
  try { new BroadcastChannel('rpg-console-session').postMessage({ type: 'SESSION_LOGOUT' }); } catch {}
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
  location.reload();
};

// ── Gamepad: the map screen's half ───────────────────────────────────────────
// js/console/console-gamepad.js reads the pad and names the actions. The map
// owns moving the selected token (left stick), sliding the map (right stick),
// zoom (L2/R2), the Tools drawer (Start) and Undo move (Select). Everything
// else belongs to the info panel and is forwarded to it.

// May the current user move this token right now? The same rule that decides
// whether the on-screen arrows are shown.
function _consoleCanMove(tok) {
  return !!tok && isMyToken(tok) && (!initData.currentId || tok.id === getActiveTurnTokenId());
}

let _consolePadToastAt = 0;
function _consolePadToast(msg) {
  // A held stick repeats; say it once, not ten times a second.
  if (Date.now() - _consolePadToastAt < 2500) return;
  _consolePadToastAt = Date.now();
  showToast(msg, true);
}

function _consolePadMove(key) {
  let tok = (tokens || []).find(t => t.id === selectedTokenId);
  // A player with nothing selected means their own token.
  if (!tok && !isDM()) {
    tok = (tokens || []).find(t => t.type !== 'monster' && isMyToken(t)) || (tokens || []).find(t => isMyToken(t));
    if (tok) { selectToken(tok.id); openHpPanel(tok); }
  }
  if (!tok) { _consolePadToast('Select a token first.'); return; }
  if (!_consoleCanMove(tok)) { _consolePadToast('This token moves on its own turn.'); return; }
  moveSelectedToken(key);
}

function _consolePadPan(dx, dy) {
  const area = document.getElementById('canvas-area');
  if (area) area.scrollBy({ left: dx * 70, top: dy * 70 });
}

window.addEventListener('load', () => {
  _consoleStartSSE();
  _consoleUpdateTool();
  _consoleUpdateTurn();
  // The legend names the buttons as they are assigned now (they can be changed
  // on the info panel's More tab).
  ConsolePad.onChange(() => document.querySelectorAll('[data-pad-control]').forEach(el => {
    el.textContent = ConsolePad.label(el.dataset.padControl);
  }));
  ConsolePad.init({
    relay: _consolePost,
    handlers: {
      'move-up':    () => _consolePadMove('ArrowUp'),
      'move-down':  () => _consolePadMove('ArrowDown'),
      'move-left':  () => _consolePadMove('ArrowLeft'),
      'move-right': () => _consolePadMove('ArrowRight'),
      'pan-up':     () => _consolePadPan(0, -1),
      'pan-down':   () => _consolePadPan(0, 1),
      'pan-left':   () => _consolePadPan(-1, 0),
      'pan-right':  () => _consolePadPan(1, 0),
      'zoom-in':    () => applyZoom(zoomPct + 10),
      'zoom-out':   () => applyZoom(zoomPct - 10),
      'tools':      () => consoleToggleTools(),
      'undo':       () => undoLastMove(),
      'back':       () => consoleToggleTools(false),
    },
  });
}, { once: true });
