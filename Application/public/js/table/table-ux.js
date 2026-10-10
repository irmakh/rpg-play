// Written by Irmak Hakman — 2026-10-11 01:12
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Table screen: ease of use ─────────────────────────────────────────────────
// Everything here sits ON TOP of the other table modules and is loaded by
// table.html only. The console's map screen shares js/table/* but has its own
// controls (touch + gamepad), so it does not load this file: nothing below may
// be needed for the map to work.
//
//   1. Getting around the map   wheel zoom, pan from any tool, touch, follow the turn
//   2. Keyboard                 tool keys, turn keys, Ctrl+Z, the ? sheet
//   3. Toolbar                  View menu, dice settings, tool hint, remembered view
//   4. Tokens                   right-click menu, quick damage, hover summary
//
// Where a function of another module needs to do one thing more (remember the
// zoom, refresh the hint), it is wrapped the same way js/console/table-console.js
// wraps renderTokens: keep the original, replace the global, call through.

// ── Pure helpers (unit-tested in tests/unit/table-ux.test.js) ─────────────────

/**
 * The zoom a wheel movement leads to, from the current zoom in percent.
 * A mouse reports about 100 per notch and a trackpad a stream of small numbers,
 * so the step is proportional rather than a fixed 10% - one notch is roughly
 * 15%, and a slow trackpad swipe still moves at least 1% a tick.
 */
function uxWheelZoom(pct, deltaY, deltaMode) {
  // deltaMode 1 = lines (Firefox mouse), 2 = pages; bring both to pixels.
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 300 : deltaY;
  if (!px) return pct;
  let next = Math.round(pct * Math.exp(-px * 0.0015));
  if (next === pct) next += px < 0 ? 1 : -1;
  return Math.max(50, Math.min(200, next));
}

/** The zoom a two-finger pinch leads to: the fingers' spread scales the zoom. */
function uxPinchZoom(startPct, startDist, dist) {
  if (!(startDist > 0) || !(dist > 0)) return startPct;
  return Math.max(50, Math.min(200, Math.round(startPct * dist / startDist)));
}

/**
 * What a quick HP entry means. "7" and "-7" are damage, "+7" heals - damage is
 * the default because it is by far the more common thing to type in a fight.
 * Returns null for anything that is not a whole number above zero.
 */
function uxParseHp(text) {
  const m = /^([+-]?)\s*(\d{1,4})$/.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const amount = parseInt(m[2], 10);
  if (!amount) return null;
  return { mode: m[1] === '+' ? 'heal' : 'dmg', amount };
}

/**
 * The HP fields a token ends up with. Same rules as applyHpChange() in
 * table-hppanel.js: damage is soaked by temporary HP first and stops at 0,
 * healing stops at the maximum and leaves temporary HP alone.
 */
function uxHpAfter(tok, mode, amount) {
  const cur = tok.hpCurrent || 0, temp = tok.hpTemp || 0;
  if (mode === 'heal') return { hpCurrent: Math.min(tok.hpMax || 0, cur + amount) };
  const through = Math.max(0, amount - temp);
  return { hpCurrent: Math.max(0, cur - through), hpTemp: Math.max(0, temp - amount) };
}

// One key per map tool. Multi-select is the DM's tool, so M does nothing for a player.
const UX_TOOL_KEYS = { v: 'move', h: 'pan', r: 'ruler', p: 'ping', d: 'draw', m: 'multi' };
function uxToolForKey(key, dm) {
  const tool = UX_TOOL_KEYS[String(key || '').toLowerCase()];
  if (!tool || (tool === 'multi' && !dm)) return null;
  return tool;
}
function uxKeyForTool(tool) {
  for (const k in UX_TOOL_KEYS) if (UX_TOOL_KEYS[k] === tool) return k.toUpperCase();
  return '';
}

/** The line under the toolbar's tools: what the current tool does with a click. */
function uxHintText(tool, o) {
  const touch = !!(o && o.touch);
  if (tool === 'move') {
    if (o && o.selected) {
      return o.canEdit
        ? `${o.selected} — arrow keys move · type a number for damage, +N to heal · Esc lets go`
        : `${o.selected} — arrow keys move · Esc lets go`;
    }
    return touch
      ? 'Move — tap a token to select · hold it to drag · pinch to zoom'
      : 'Move — drag a token · right-click it for actions · wheel zooms · Space + drag pans';
  }
  if (tool === 'pan')   return 'Pan — drag the map';
  if (tool === 'ruler') return 'Ruler — drag to measure';
  if (tool === 'ping')  return touch ? 'Ping — tap to show everyone a spot' : 'Ping — click to show everyone a spot';
  if (tool === 'draw')  return 'Draw — drag to draw a shape · Esc to finish';
  if (tool === 'multi') return 'Multi-select — drag a box around tokens · Shift adds to the selection';
  return '';
}

/** Who may see a token's numbers - the same rule renderTokens() uses for its tooltip. */
function uxSeesStats(tok, dm) {
  return !!dm || tok.type !== 'monster' || !!tok.assignedCharId;
}

/**
 * The hover summary for one token. Every value is escaped: names, labels and
 * conditions are typed by people.
 * o = { name, dm, owner, inCombat }
 */
function uxHoverHTML(tok, o) {
  const kind = tok.type === 'monster' ? 'Monster' : tok.type === 'npc' ? 'NPC' : tok.type === 'character' ? 'Character' : 'Token';
  let h = `<div class="ux-hv-kind">${kind}</div><div class="ux-hv-name">${esc(o.name)}</div>`;
  if (o.owner) h += `<div class="ux-hv-sub">Played by ${esc(o.owner)}</div>`;
  if (uxSeesStats(tok, o.dm)) {
    const max = tok.hpMax || 0, cur = tok.hpCurrent || 0, temp = tok.hpTemp || 0;
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    h += `<div class="ux-hv-bar"><div style="width:${pct * 100}%;background:${hpBarColor(pct)}"></div></div>`;
    h += `<div class="ux-hv-row"><span>HP</span><b>${cur} / ${max}${temp > 0 ? ` <i>+${temp} temp</i>` : ''}</b></div>`;
    if (tok.ac != null && tok.ac !== '') h += `<div class="ux-hv-row"><span>AC</span><b>${esc(tok.ac)}</b></div>`;
    const speed = tok.speed || 30;
    h += o.inCombat
      ? `<div class="ux-hv-row"><span>Moved</span><b>${tok.movedFt || 0} of ${speed} ft</b></div>`
      : `<div class="ux-hv-row"><span>Speed</span><b>${speed} ft</b></div>`;
  }
  const conds = parseConditions(tok.conditions);
  if (conds.length) h += `<div class="ux-hv-conds">${conds.map(c => `<span>${esc(c)}</span>`).join('')}</div>`;
  if (o.dm && tok.visible === false) h += `<div class="ux-hv-sub">Hidden from players</div>`;
  return h;
}

/** The condition switches inside the token menu. */
function uxCondsHTML(tok) {
  const active = parseConditions(tok.conditions);
  return CONDITIONS.map(c =>
    `<button type="button" class="cond-btn${active.includes(c) ? ' active' : ''}" title="${esc(c)}" onclick="uxCtxCond('${escJs(c)}')">${esc(COND_ABBREV[c] || c)}</button>`
  ).join('');
}

/**
 * The right-click menu for one token. The token is selected before the menu
 * opens, so every button here acts on the selected token through the functions
 * the side panel already uses.
 * o = { name, dm }
 */
function uxTokenMenuHTML(tok, o) {
  const max = tok.hpMax || 0, cur = tok.hpCurrent || 0, temp = tok.hpTemp || 0;
  const n = parseConditions(tok.conditions).length;
  const ico = name => `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  let h = `<div class="mctx-kind">Token</div><div class="mctx-name">${esc(o.name)}</div>`
    + `<div class="mctx-state" id="ux-ctx-hpline">HP ${cur} / ${max}${temp > 0 ? ` · +${temp} temp` : ''}</div>`
    + `<form class="ux-ctx-hp" onsubmit="uxCtxHp();return false">`
    +   `<input type="text" id="ux-ctx-hp" inputmode="numeric" autocomplete="off" placeholder="7 or +7" aria-label="Damage, or +N to heal" title="A number is damage, +N heals. Enter applies." oninput="this.classList.remove('ux-bad')">`
    +   `<button type="button" class="btn sm danger" onclick="uxCtxHp('dmg')">Dmg</button>`
    +   `<button type="button" class="btn sm success" onclick="uxCtxHp('heal')">Heal</button>`
    + `</form>`
    + `<button type="button" class="btn sm ux-ctx-item" id="ux-ctx-conds-btn" aria-expanded="false" onclick="uxCtxToggleConds()">Conditions${n ? ` (${n})` : ''} ${ico('chevron-down')}</button>`
    + `<div class="rp-cond-grid ux-ctx-conds" id="ux-ctx-conds" hidden>${uxCondsHTML(tok)}</div>`;
  if (o.dm) {
    h += tok.visible === false
      ? `<button type="button" class="btn sm ux-ctx-item" onclick="_dismissMapCtxMenu();toggleTokenVisibility()">${ico('eye')} Show to players</button>`
      : `<button type="button" class="btn sm ux-ctx-item" onclick="_dismissMapCtxMenu();toggleTokenVisibility()">${ico('eye-off')} Hide from players</button>`;
    h += `<button type="button" class="btn sm ux-ctx-item" onclick="_dismissMapCtxMenu();rollTokenInitiative()">${ico('dice')} Roll initiative</button>`;
  }
  h += `<button type="button" class="btn sm ux-ctx-item" onclick="_dismissMapCtxMenu();uxShowDetails()">${ico('document')} Show details</button>`;
  if (o.dm) h += `<button type="button" class="btn sm danger ux-ctx-item" onclick="_dismissMapCtxMenu();deleteSelectedToken()">${ico('trash')} Remove from map</button>`;
  return h;
}

// ── Remembered settings ───────────────────────────────────────────────────────
// Same 'tbl_' prefix as the panel widths table-main.js already keeps. Storage can
// be unavailable (private window, blocked site data), so every access is guarded
// and the page simply starts from its defaults.
function uxGet(key, def) {
  try { const v = localStorage.getItem('tbl_' + key); return v === null ? def : v; } catch { return def; }
}
function uxSet(key, val) {
  try { localStorage.setItem('tbl_' + key, String(val)); } catch {}
}

function uxTyping() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
// True while any dialog is up: a key press then belongs to the dialog, not the map.
function uxDialogOpen() {
  const sel = '[id$="-modal"]:not(#image-reveal-modal),#media-lightbox,#waiting-overlay,#ux-help';
  for (const el of document.querySelectorAll(sel)) {
    if (!el.hidden && getComputedStyle(el).display !== 'none') return true;
  }
  return false;
}
function uxCanEdit(tok) { return !!tok && (isDM() || isMyToken(tok)); }
function uxTokenEl(id) {
  for (const el of document.querySelectorAll('#token-layer .token, #token-layer-bg .token')) {
    if (el.dataset.id === id) return el;
  }
  return null;
}

// ══ 1. Getting around the map ═════════════════════════════════════════════════

// ── Zoom that stays where you are looking ─────────────────────────────────────
// applyZoom() scales the map from its top-left corner, so zooming used to slide
// whatever you were looking at away. Zooming "at" a screen point puts the same
// map point back under it afterwards by correcting the scroll position.
const _uxApplyZoom = applyZoom;
function uxZoomAt(pct, clientX, clientY) {
  const at = getCanvasPos({ clientX, clientY });      // map point under the cursor now
  _uxApplyZoom(pct);
  const rect = canvasWrap.getBoundingClientRect();
  const scale = zoomPct / 100;
  canvasArea.scrollLeft += rect.left + at.x * scale - clientX;
  canvasArea.scrollTop  += rect.top  + at.y * scale - clientY;
  uxSet('zoom', zoomPct);
}
// The slider and the +/- buttons call applyZoom() by name, so they get this:
// zoom about the middle of the visible map instead of its corner.
window.applyZoom = function (pct) {
  const r = canvasArea.getBoundingClientRect();
  uxZoomAt(pct, r.left + r.width / 2, r.top + r.height / 2);
};

canvasArea.addEventListener('wheel', e => {
  if (e.shiftKey) return;                 // Shift + wheel keeps scrolling sideways
  e.preventDefault();
  uxHideHover();
  uxZoomAt(uxWheelZoom(zoomPct, e.deltaY, e.deltaMode), e.clientX, e.clientY);
}, { passive: false });

// ── Pan from any tool: hold Space, or drag with the middle button ─────────────
// Caught in the capture phase and stopped there, so the token or the tool under
// the cursor never sees the press - no token is picked up, no ruler started.
let _uxSpace = false;      // Space is held while the pointer is over the map
let _uxOverMap = false;
let _uxPan = null;         // { x, y, left, top, moved }
let _uxPanClick = false;   // a Space-drag just ended: swallow the click it produces

canvasArea.addEventListener('mouseenter', () => { _uxOverMap = true; });
canvasArea.addEventListener('mouseleave', () => { _uxOverMap = false; });

canvasArea.addEventListener('mousedown', e => {
  if (!(e.button === 1 || (e.button === 0 && _uxSpace))) return;
  e.preventDefault();                     // also stops the middle-button auto-scroll
  e.stopPropagation();
  uxHideHover();
  _uxPan = { x: e.clientX, y: e.clientY, left: canvasArea.scrollLeft, top: canvasArea.scrollTop, moved: false };
  canvasArea.classList.add('ux-panning');
}, true);

document.addEventListener('mousemove', e => {
  if (!_uxPan) return;
  const dx = e.clientX - _uxPan.x, dy = e.clientY - _uxPan.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _uxPan.moved = true;
  canvasArea.scrollLeft = _uxPan.left - dx;
  canvasArea.scrollTop  = _uxPan.top  - dy;
});
document.addEventListener('mouseup', () => {
  if (!_uxPan) return;
  _uxPanClick = _uxPan.moved;
  _uxPan = null;
  canvasArea.classList.remove('ux-panning');
  setTimeout(() => { _uxPanClick = false; }, 0);
});
// The fog/hidden-item menu opens on a click on the map; a pan is not a click.
canvasArea.addEventListener('click', e => {
  if (_uxPanClick) { e.stopPropagation(); e.preventDefault(); }
}, true);

function uxSetSpace(on) {
  _uxSpace = on;
  canvasArea.classList.toggle('ux-pan-ready', on);
}
window.addEventListener('blur', () => uxSetSpace(false));

// ── Touch: pinch to zoom, hold a token to drag it, tools work with a finger ───
// One finger on the map already pans it (the map is a scrolling box; table-ux.css
// sets touch-action so the browser keeps doing that and leaves the pinch to us).
// The map's own code listens to the mouse only, so the other gestures are handed
// to it as the mouse events it already understands.
let _uxTouch = null;   // { mode:'wait'|'tokdrag'|'bridge'|'pinch', ... }

function uxMouse(target, type, t) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, button: 0 }));
}
function uxTouchDist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
function uxTouchMid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

// Give up whatever a single finger had started, without committing it.
function uxTouchAbandon() {
  if (!_uxTouch) return;
  if (_uxTouch.timer) clearTimeout(_uxTouch.timer);
  if (_uxTouch.mode === 'tokdrag' && dragState) {
    dragState = null;
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    renderGrid(); renderTokens();
  }
  if (_uxTouch.mode === 'bridge') {
    rulerState = null; drawingState = null; multiSelectState = null; shapeEditState = null;
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
  _uxTouch = null;
}

canvasArea.addEventListener('touchstart', e => {
  uxHideHover();
  if (e.touches.length === 2) {
    uxTouchAbandon();
    const [a, b] = e.touches;
    _uxTouch = { mode: 'pinch', dist: uxTouchDist(a, b), pct: zoomPct, mid: uxTouchMid(a, b) };
    e.preventDefault();
    return;
  }
  if (e.touches.length !== 1) { uxTouchAbandon(); return; }
  const t = e.touches[0];

  // A tool that works by dragging: the finger is the mouse.
  if (!placementState && ['ruler', 'draw', 'multi'].includes(currentTool) && e.target === overlayCanvas) {
    e.preventDefault();                   // no scrolling, no second (synthesised) mouse press
    _uxTouch = { mode: 'bridge', last: t };
    uxMouse(overlayCanvas, 'mousedown', t);
    return;
  }

  // Holding still on a token picks it up; moving first is an ordinary pan.
  const el = currentTool === 'move' ? e.target.closest?.('.token') : null;
  if (!el) return;
  const tok = tokens.find(x => x.id === el.dataset.id);
  if (!tok) return;
  _uxTouch = { mode: 'wait', tok, x: t.clientX, y: t.clientY, last: t };
  _uxTouch.timer = setTimeout(() => {
    if (!_uxTouch || _uxTouch.mode !== 'wait') return;
    _uxTouch.mode = 'tokdrag';
    _uxTouch.timer = null;
    // The synthesised mouse press that follows a tap also arms a drag in
    // table-map.js; this hold has taken over, so stand that one down.
    if (_dragPendingTimer) { clearTimeout(_dragPendingTimer); _dragPendingTimer = null; }
    _pendingClickToken = null;
    startDrag(tok, _uxTouch.last);
    try { navigator.vibrate?.(15); } catch {}
  }, 350);
}, { passive: false });

canvasArea.addEventListener('touchmove', e => {
  if (!_uxTouch) return;
  if (_uxTouch.mode === 'pinch') {
    if (e.touches.length < 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const mid = uxTouchMid(a, b);
    // Two fingers moving together slide the map; spreading them zooms it.
    canvasArea.scrollLeft -= mid.x - _uxTouch.mid.x;
    canvasArea.scrollTop  -= mid.y - _uxTouch.mid.y;
    _uxTouch.mid = mid;
    const pct = uxPinchZoom(_uxTouch.pct, _uxTouch.dist, uxTouchDist(a, b));
    if (pct !== zoomPct) uxZoomAt(pct, mid.x, mid.y);
    return;
  }
  const t = e.touches[0];
  if (!t) return;
  if (_uxTouch.mode === 'wait') {
    // Moved before the hold completed: this is a pan, let the browser scroll.
    if (Math.hypot(t.clientX - _uxTouch.x, t.clientY - _uxTouch.y) > 10) uxTouchAbandon();
    return;
  }
  e.preventDefault();
  _uxTouch.last = t;
  if (_uxTouch.mode === 'tokdrag') uxMouse(document, 'mousemove', t);
  else if (_uxTouch.mode === 'bridge') uxMouse(overlayCanvas, 'mousemove', t);
}, { passive: false });

function uxTouchEnd(e) {
  if (!_uxTouch) return;
  const st = _uxTouch;
  if (st.mode === 'pinch') {
    if (e.touches.length < 2) _uxTouch = null;
    return;
  }
  if (st.timer) clearTimeout(st.timer);
  _uxTouch = null;
  if (st.mode === 'wait') return;         // a plain tap: the browser's own click selects the token
  e.preventDefault();                     // handled here - no synthesised click on top
  const t = e.changedTouches[0] || st.last;
  if (st.mode === 'bridge') { uxMouse(overlayCanvas, 'mouseup', t); return; }
  if (st.mode === 'tokdrag') {
    const moved = dragState && dragState.didMove;
    finishDrag({ clientX: t.clientX, clientY: t.clientY, shiftKey: false });
    if (!moved) _selectTokenClick(st.tok, { shiftKey: false });   // held but not moved: select it
  }
}
canvasArea.addEventListener('touchend', uxTouchEnd, { passive: false });
canvasArea.addEventListener('touchcancel', () => uxTouchAbandon());

// ── Follow the turn ───────────────────────────────────────────────────────────
// When the turn passes to a token that is off screen (or near the edge), the
// map glides to it. It is NOT selected: a turn change must not pull the side
// panel away from what you chose to look at (see the initiative handler in
// table-realtime.js). The pulse and the white ring already mark whose turn it is.
let _uxTurnShown;                         // undefined until the first render: do not jump on page load
function uxFollowOn() { return uxGet('followTurn', '1') !== '0'; }

function uxTokenInView(id) {
  const el = uxTokenEl(id);
  if (!el) return false;
  const r = el.getBoundingClientRect(), a = canvasArea.getBoundingClientRect();
  const m = 70;                           // close to an edge counts as out of view
  return r.left >= a.left + m && r.right <= a.right - m && r.top >= a.top + m && r.bottom <= a.bottom - m;
}
function uxFollowTurn() {
  const current = initData.currentId || null;
  if (_uxTurnShown === undefined) { _uxTurnShown = current; return; }
  if (current === _uxTurnShown) return;
  _uxTurnShown = current;
  if (!current || !uxFollowOn() || dragState || _uxPan || _uxTouch) return;
  const id = getActiveTurnTokenId();
  if (!id || uxTokenInView(id)) return;
  panToToken(id);
}
const _uxRenderInitiativeTracker = renderInitiativeTracker;
window.renderInitiativeTracker = function (showBadge) {
  _uxRenderInitiativeTracker(showBadge);
  uxFollowTurn();
};

// ══ 2. Keyboard ═══════════════════════════════════════════════════════════════
// Capture phase, so Esc can close one of the pop-ups below without also
// reaching the older handler in table-panel.js and deselecting the token.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uxCloseTransient()) { e.stopPropagation(); e.preventDefault(); }
    return;
  }
  // Space pans only while the pointer is over the map, so it still presses a
  // focused button anywhere else on the page.
  if (e.code === 'Space' && _uxOverMap && !uxTyping()) {
    e.preventDefault();
    if (!e.repeat) uxSetSpace(true);
    return;
  }
  if (uxTyping() || uxDialogOpen()) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    if (lastTokenMove) { e.preventDefault(); undoLastMove(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === '?') { e.preventDefault(); uxShowHelp(); return; }

  // A number typed with a token selected starts a damage entry beside it.
  if (/^[0-9+\-]$/.test(e.key) && currentTool === 'move') {
    const tok = tokens.find(t => t.id === selectedTokenId);
    if (uxCanEdit(tok)) { e.preventDefault(); uxOpenHpBox(e.key === '0' ? '' : e.key); return; }
  }

  const tool = uxToolForKey(e.key, isDM());
  if (tool) { e.preventDefault(); if (placementState) exitPlacementMode(); setTool(tool); return; }

  // Turn keys are the DM's: one stray key from a player must not end a turn.
  if (isDM() && initData.currentId) {
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); initSkipTurn(); }
    else if (k === 'b') { e.preventDefault(); dmPrevTurn(); }
  }
}, true);

document.addEventListener('keyup', e => {
  if (e.code !== 'Space' || !_uxSpace) return;
  e.preventDefault();
  uxSetSpace(false);
}, true);

// ── The ? sheet ───────────────────────────────────────────────────────────────
// [keys, what it does, DM only]
const UX_SHORTCUTS = [
  ['Map', null],
  ['Wheel', 'Zoom in and out where the pointer is'],
  ['Shift + wheel', 'Scroll sideways'],
  ['Space + drag', 'Pan the map from any tool (or drag with the middle button)'],
  ['Tools', null],
  ['V', 'Move and select tokens'],
  ['H', 'Pan'],
  ['R', 'Ruler'],
  ['P', 'Ping'],
  ['D', 'Draw'],
  ['M', 'Multi-select', true],
  ['Tokens', null],
  ['Arrow keys', 'Move the selected token one square'],
  ['Ctrl + Z', 'Undo the last token move'],
  ['0–9', 'Damage the selected token; start with + to heal'],
  ['Right-click', 'Token actions: HP, conditions, hide, initiative'],
  ['Shift + click', 'Add a token to the bulk selection', true],
  ['Delete', 'Remove the selected token', true],
  ['Esc', 'Let go of the token, or leave the tool'],
  ['Turns', null],
  ['N', 'Next turn', true],
  ['B', 'Back one turn', true],
  ['Rolls', null],
  ['A / N / D', 'Advantage, normal, disadvantage when a roll asks'],
  ['?', 'This sheet'],
];
function uxHelpHTML(dm) {
  let h = '';
  for (const [keys, what, dmOnly] of UX_SHORTCUTS) {
    if (dmOnly && !dm) continue;
    h += what === null
      ? `<div class="ux-help-grp">${esc(keys)}</div>`
      : `<div class="ux-help-row"><kbd>${esc(keys)}</kbd><span>${esc(what)}</span></div>`;
  }
  return h;
}
function uxShowHelp() {
  uxClosePops();
  let el = document.getElementById('ux-help');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ux-help';
    el.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="ux-help-title">`
      + `<div class="ct ct-row"><span id="ux-help-title">Keyboard shortcuts</span>`
      + `<button type="button" class="btn sm" onclick="uxHideHelp()" aria-label="Close"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button></div>`
      + `<div class="ux-help-body" id="ux-help-body"></div></div>`;
    el.addEventListener('click', e => { if (e.target === el) uxHideHelp(); });
    document.body.appendChild(el);
  }
  document.getElementById('ux-help-body').innerHTML = uxHelpHTML(isDM());
  el.hidden = false;
}
function uxHideHelp() {
  const el = document.getElementById('ux-help');
  if (el) el.hidden = true;
}

// Each tool button says which key picks it.
function uxLabelToolKeys() {
  for (const tool of Object.values(UX_TOOL_KEYS)) {
    const key = uxKeyForTool(tool);
    for (const b of document.querySelectorAll(`#btn-tool-${tool}, [data-mstrip-tool="${tool}"]`)) {
      if (b.title && !b.title.endsWith(`(${key})`)) b.title += ` (${key})`;
    }
  }
}

// ══ 3. Toolbar ════════════════════════════════════════════════════════════════

// ── Pop-overs (View menu, dice settings) ──────────────────────────────────────
function uxClosePops() {
  let closed = false;
  for (const pop of document.querySelectorAll('.ux-pop')) {
    if (pop.hidden) continue;
    pop.hidden = true;
    closed = true;
    document.querySelector(`[aria-controls="${pop.id}"]`)?.setAttribute('aria-expanded', 'false');
  }
  return closed;
}
function uxTogglePop(id) {
  const pop = document.getElementById(id);
  if (!pop) return;
  const open = pop.hidden;
  uxClosePops();
  if (!open) return;
  if (id === 'ux-view-pop') uxSyncViewMenu();
  pop.hidden = false;
  // It hangs from its button's right edge. On a narrow screen the toolbar wraps
  // and that can push it off the left side - hang it from the left edge instead.
  pop.style.left = ''; pop.style.right = '';
  if (pop.getBoundingClientRect().left < 8) { pop.style.left = '0'; pop.style.right = 'auto'; }
  document.querySelector(`[aria-controls="${id}"]`)?.setAttribute('aria-expanded', 'true');
}
document.addEventListener('pointerdown', e => {
  if (!e.target.closest?.('.ux-anchor')) uxClosePops();
}, true);

// Esc closes the newest thing first. Returns true when something was closed.
function uxCloseTransient() {
  if (uxHpBoxOpen()) { uxCloseHpBox(); return true; }
  if (_mapCtxMenu) { _dismissMapCtxMenu(); return true; }
  const help = document.getElementById('ux-help');
  if (help && !help.hidden) { uxHideHelp(); return true; }
  return uxClosePops();
}

function uxSyncViewMenu() {
  const set = (id, on) => document.getElementById(id)?.setAttribute('aria-checked', on ? 'true' : 'false');
  set('ux-follow', uxFollowOn());
  set('ux-hints', uxHintsOn());
}
function uxToggleFollow() { uxSet('followTurn', uxFollowOn() ? '0' : '1'); uxSyncViewMenu(); }

// ── Dice settings: the roll mode shows on the button that opens them ──────────
const UX_DICE_LABEL = { norm: 'Normal', adv: 'Adv', dis: 'Dis', ask: 'Ask' };
function uxSyncDiceChip() {
  const btn = document.getElementById('btn-dice-opts');
  const lbl = document.getElementById('ux-dice-mode-lbl');
  if (lbl) lbl.textContent = UX_DICE_LABEL[diceMode] || 'Ask';
  // Advantage or disadvantage left on is easy to forget; the colour says so.
  if (btn) btn.dataset.mode = diceMode;
}
const _uxSetDiceMode = setDiceMode;
window.setDiceMode = function (mode) {
  _uxSetDiceMode(mode);
  uxSyncDiceChip();
};

// ── Tool hint ─────────────────────────────────────────────────────────────────
function uxHintsOn() { return uxGet('hints', '1') !== '0'; }
function uxToggleHints() { uxSet('hints', uxHintsOn() ? '0' : '1'); uxSyncViewMenu(); uxUpdateHint(); }

let _uxHintShown = null;
function uxUpdateHint() {
  const el = document.getElementById('ux-hint');
  if (!el) return;
  const on = uxHintsOn() && !placementState;      // placement has its own banner
  el.hidden = !on;
  if (!on) { _uxHintShown = null; return; }
  const tok = currentTool === 'move' ? tokens.find(t => t.id === selectedTokenId) : null;
  const text = uxHintText(currentTool, {
    touch: window.matchMedia?.('(pointer: coarse)').matches,
    selected: tok ? tokDisplayName(tok) : '',
    canEdit: uxCanEdit(tok),
  });
  if (text === _uxHintShown) return;              // redrawn on every token render: skip no-ops
  _uxHintShown = text;
  const key = uxKeyForTool(currentTool);
  el.textContent = '';
  if (key) { const k = document.createElement('kbd'); k.textContent = key; el.appendChild(k); }
  el.appendChild(document.createTextNode(text));
}

// ── Remember the view: tool, zoom, which panels are open ──────────────────────
const _uxSetTool = setTool;
window.setTool = function (name) {
  _uxSetTool(name);
  uxSet('tool', name);
  uxUpdateHint();
};
const _uxToggleLeftPanel = toggleLeftPanel;
window.toggleLeftPanel = function () {
  _uxToggleLeftPanel();
  uxSet('lpHidden', document.getElementById('left-panel')?.style.display === 'none' ? '1' : '0');
};
const _uxToggleSidePanel = toggleSidePanel;
window.toggleSidePanel = function () {
  _uxToggleSidePanel();
  uxSet('rpHidden', document.getElementById('side-panel')?.style.display === 'none' ? '1' : '0');
};
const _uxChatToggle = chatToggle;
window.chatToggle = function () {
  _uxChatToggle();
  uxSet('chatOpen', chatOpen ? '1' : '0');
};

function uxRestoreView() {
  const zoom = parseInt(uxGet('zoom', ''), 10);
  if (zoom >= 50 && zoom <= 200 && zoom !== zoomPct) _uxApplyZoom(zoom);
  if (uxGet('lpHidden', '0') === '1') _uxToggleLeftPanel();
  if (uxGet('rpHidden', '0') === '1') _uxToggleSidePanel();
  if (uxGet('chatOpen', '1') === '0' && chatOpen) _uxChatToggle();
  const tool = uxGet('tool', 'move');
  const known = Object.values(UX_TOOL_KEYS).includes(tool);
  if (known && tool !== currentTool && (tool !== 'multi' || isDM())) _uxSetTool(tool);
}

// ══ 4. Tokens ═════════════════════════════════════════════════════════════════

// The token under a screen point. With the move tool the token's own element is
// under the cursor; with any other tool the overlay canvas covers the tokens,
// so fall back to the geometry.
function uxTokenAt(e) {
  const el = e.target.closest?.('.token');
  if (el) return tokens.find(t => t.id === el.dataset.id) || null;
  const pos = getCanvasPos(e);
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (!tok.visible && !isDM()) continue;
    const span = (tok.tokenSize || 1) * cs;
    const cx = ox + (tok.x || 0) * cs + span / 2, cy = oy + (tok.y || 0) * cs + span / 2;
    if (Math.hypot(pos.x - cx, pos.y - cy) <= span / 2) return tok;
  }
  return null;
}

// ── Right-click menu ──────────────────────────────────────────────────────────
canvasArea.addEventListener('contextmenu', e => {
  if (_uxTouch) { e.preventDefault(); return; }   // a long press is a drag here, not a menu
  const tok = uxTokenAt(e);
  if (!uxCanEdit(tok)) return;                    // someone else's token: the browser's own menu
  e.preventDefault();
  uxHideHover();
  uxCloseHpBox();
  // Select it exactly as a click would, so the menu and the side panel agree
  // and the menu's buttons can use the side panel's own functions.
  if (selectedTokenId !== tok.id) _selectTokenClick(tok, { shiftKey: false });
  _showMapCtxMenu(e.clientX, e.clientY, uxTokenMenuHTML(tok, { name: tokDisplayName(tok), dm: isDM() }));
  _mapCtxMenu?.classList.add('ux-ctx');
});

function uxApplyHp(mode, amount) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!uxCanEdit(tok) || !(amount > 0)) return false;
  const fields = uxHpAfter(tok, mode, amount);
  _putHp(fields);
  renderTokens();
  showToast(`${tokDisplayName(tok)}: ${mode === 'heal' ? '+' : '−'}${amount} HP → ${fields.hpCurrent} / ${tok.hpMax || 0}`);
  return true;
}

// From the menu: the Dmg/Heal buttons force the direction, Enter reads the sign.
function uxCtxHp(force) {
  const input = document.getElementById('ux-ctx-hp');
  if (!input) return;
  const parsed = uxParseHp(input.value);
  if (!parsed) { input.focus(); input.classList.add('ux-bad'); return; }
  if (uxApplyHp(force || parsed.mode, parsed.amount)) _dismissMapCtxMenu();
}
function uxCtxToggleConds() {
  const box = document.getElementById('ux-ctx-conds');
  const btn = document.getElementById('ux-ctx-conds-btn');
  if (!box || !_mapCtxMenu) return;
  box.hidden = !box.hidden;
  btn?.setAttribute('aria-expanded', String(!box.hidden));
  // The menu was placed for its closed height; keep the opened list on screen.
  const top = Math.min(parseFloat(_mapCtxMenu.style.top) || 0, window.innerHeight - _mapCtxMenu.offsetHeight - 8);
  _mapCtxMenu.style.top = Math.max(8, top) + 'px';
}
function uxCtxCond(name) {
  toggleCondition(name);                          // acts on the selected token
  const tok = tokens.find(t => t.id === selectedTokenId);
  const box = document.getElementById('ux-ctx-conds');
  if (tok && box) box.innerHTML = uxCondsHTML(tok);
}
// "Show details": the side panel may be folded away or scrolled elsewhere.
function uxShowDetails() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const sp = document.getElementById('side-panel');
  if (sp && sp.style.display === 'none') toggleSidePanel();
  openHpPanel(tok);
}

// ── Quick damage: a number typed with a token selected ────────────────────────
function uxHpBoxOpen() {
  const box = document.getElementById('ux-hp-box');
  return !!box && !box.hidden;
}
function uxCloseHpBox() {
  const box = document.getElementById('ux-hp-box');
  if (box) box.hidden = true;
}
function uxOpenHpBox(first) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!uxCanEdit(tok)) return;
  uxHideHover();
  let box = document.getElementById('ux-hp-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ux-hp-box';
    box.innerHTML = `<div class="ux-hp-name" id="ux-hp-name"></div>`
      + `<input type="text" id="ux-hp-input" inputmode="numeric" autocomplete="off" maxlength="5" aria-label="Damage, or +N to heal">`
      + `<div class="ux-hp-help">Enter: damage · +N heals · Esc cancels</div>`;
    document.body.appendChild(box);
    const input = box.querySelector('input');
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const parsed = uxParseHp(input.value);
      if (!parsed) { input.classList.add('ux-bad'); return; }
      uxApplyHp(parsed.mode, parsed.amount);
      uxCloseHpBox();
    });
    input.addEventListener('input', () => input.classList.remove('ux-bad'));
    input.addEventListener('blur', uxCloseHpBox);
  }
  document.getElementById('ux-hp-name').textContent = tokDisplayName(tok);
  const input = document.getElementById('ux-hp-input');
  input.value = first || '';
  input.classList.remove('ux-bad');
  box.hidden = false;
  // Under the token, or in the middle of the map when the token is off screen.
  const el = uxTokenEl(tok.id);
  const area = canvasArea.getBoundingClientRect();
  const r = el ? el.getBoundingClientRect() : null;
  const onScreen = r && r.bottom > area.top && r.top < area.bottom && r.right > area.left && r.left < area.right;
  const x = onScreen ? r.left + r.width / 2 : area.left + area.width / 2;
  const y = onScreen ? r.bottom + 10 : area.top + area.height / 2;
  box.style.left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, x - box.offsetWidth / 2)) + 'px';
  box.style.top  = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, y)) + 'px';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ── Hover summary ─────────────────────────────────────────────────────────────
let _uxHoverId = null;      // token the card is showing, or waiting to show
let _uxHoverTimer = null;

function uxHideHover() {
  clearTimeout(_uxHoverTimer);
  _uxHoverTimer = null;
  _uxHoverId = null;
  const card = document.getElementById('ux-hover');
  if (card) card.hidden = true;
}
function uxHoverOwner(tok) {
  const ownerId = tok.assignedCharId || (tok.type !== 'monster' ? tok.linkedId : '');
  const owner = ownerId ? _charList.find(c => c.id === ownerId) : null;
  return owner && owner.name !== tokDisplayName(tok) ? owner.name : '';
}
function uxFillHover(tok) {
  let card = document.getElementById('ux-hover');
  if (!card) {
    card = document.createElement('div');
    card.id = 'ux-hover';
    card.setAttribute('role', 'tooltip');
    document.body.appendChild(card);
  }
  card.innerHTML = uxHoverHTML(tok, {
    name: tokDisplayName(tok), dm: isDM(), owner: uxHoverOwner(tok), inCombat: !!initData.currentId,
  });
  return card;
}
// A monster a player cannot see because fog covers it is still in the page
// (drawn under the fog), so the pointer can find it. No card for those.
function uxUnderFog(tok) {
  const x = tok.x || 0, y = tok.y || 0;
  return fogRegions.some(r => !r.visible && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}
function uxShowHover(id) {
  const tok = tokens.find(t => t.id === id);
  const el = uxTokenEl(id);
  if (!tok || !el || dragState || _uxPan || _mapCtxMenu || uxHpBoxOpen()) { uxHideHover(); return; }
  if (!isDM() && uxUnderFog(tok)) { uxHideHover(); return; }
  const card = uxFillHover(tok);
  card.hidden = false;
  // Beside the token - to its right, or its left when there is no room.
  const r = el.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  let left = r.right + 10;
  if (left + w > window.innerWidth - 8) left = r.left - w - 10;
  card.style.left = Math.max(8, left) + 'px';
  card.style.top  = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2)) + 'px';
}

canvasArea.addEventListener('mouseover', e => {
  const el = e.target.closest?.('.token');
  const id = el ? el.dataset.id : null;
  if (id === _uxHoverId) return;
  uxHideHover();
  if (!id || e.buttons) return;                   // not while a button is held (dragging)
  if (window.matchMedia?.('(hover: none)').matches) return;   // touch: a tap would leave it stuck open
  _uxHoverId = id;
  _uxHoverTimer = setTimeout(() => { if (_uxHoverId === id) uxShowHover(id); }, 350);
});
canvasArea.addEventListener('mouseleave', uxHideHover);
canvasArea.addEventListener('mousedown', uxHideHover, true);
canvasArea.addEventListener('scroll', uxHideHover, { passive: true });

// Tokens are rebuilt on every change, so after each render: drop the plain
// title tooltip (the card replaces it), keep an open card's numbers current,
// and let the hint follow the selection.
const _uxRenderTokens = renderTokens;
window.renderTokens = function () {
  _uxRenderTokens();
  for (const el of document.querySelectorAll('#token-layer .token, #token-layer-bg .token')) el.removeAttribute('title');
  const card = document.getElementById('ux-hover');
  if (card && !card.hidden && _uxHoverId) {
    const tok = tokens.find(t => t.id === _uxHoverId);
    if (tok && uxTokenEl(_uxHoverId)) uxFillHover(tok); else uxHideHover();
  }
  uxUpdateHint();
};

// ── Start-up ──────────────────────────────────────────────────────────────────
// Registered after table-main.js's own load handler, so the session is read and
// the default tool is set by the time this runs.
window.addEventListener('load', () => {
  uxLabelToolKeys();
  uxRestoreView();
  uxSyncDiceChip();
  uxSyncViewMenu();
  uxUpdateHint();
});
