// Written by Irmak Hakman — 2026-11-12 16:56
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Map Prep on a phone ───────────────────────────────────────────────────────
// The layout is css/prepare-map.css; this is the behaviour behind it. Nothing
// here runs on a desktop-width screen except the zoom factor, which stays 1.
//
// - The tab bar opens one sidebar section as a bottom sheet over the map
//   (body[data-pm-tab] picks the section, body.pm-sheet-open shows the sheet).
// - A tool that waits for the map (draw fog, place an item / token / note,
//   move) closes the sheet and shows a bar saying what to do, with Done.
//   When the tool ends, the sheet the tool came from opens again.
// - The grid settings move into the More tab, and back on a wide screen.
// Zoom, pan and the minimap work on every screen: prepare-map-view.js.

const PM_MQ = window.matchMedia('(max-width:860px)');
const PM_TAB_TITLES = { maps: 'Maps', fog: 'Fog Regions', tokens: 'Tokens', notes: 'DM Notes', items: 'Hidden Items', more: 'More' };
const PM_NEEDS_MAP = new Set(['fog', 'tokens', 'notes', 'items', 'more']);
let _pmReturnTab = null;   // the sheet to reopen when the current tool ends

function pmIsMobile() { return PM_MQ.matches; }

function _pmTabButtons(tab) {
  document.querySelectorAll('#pm-tabbar [data-pm-tab]').forEach(b => {
    const on = b.dataset.pmTab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.disabled = PM_NEEDS_MAP.has(b.dataset.pmTab) && !currentMapId;
  });
  document.body.classList.toggle('pm-has-map', !!currentMapId);
}

function pmOpenTab(tab) {
  if (PM_NEEDS_MAP.has(tab) && !currentMapId) tab = 'maps';
  document.body.dataset.pmTab = tab;
  document.body.classList.add('pm-sheet-open');
  const title = document.getElementById('pm-sheet-title');
  if (title) title.textContent = PM_TAB_TITLES[tab] || '';
  _pmTabButtons(tab);
  const side = document.getElementById('pm-sidebar');
  if (side) side.scrollTop = 0;
}

function pmCloseSheet() {
  document.body.classList.remove('pm-sheet-open');
  _pmTabButtons(null);
}

function pmToggleTab(tab) {
  const open = document.body.classList.contains('pm-sheet-open') && document.body.dataset.pmTab === tab;
  if (open) pmCloseSheet(); else pmOpenTab(tab);
}

// ── Tools that wait for the map ──
function _pmActiveMode() {
  if (tokenPlacementMode) return `Tap the map to place ${pendingTokenConfig?.name || 'the token'}`;
  if (placeNoteMode)      return 'Tap the map where the note belongs';
  if (placeItemMode)      return _pendingClone ? 'Tap the map to place the copy' : 'Drag on the map to place an item';
  if (drawMode)           return 'Drag on the map to add a fog region';
  if (moveMode)           return 'Drag a token, note, item or fog region to move it';
  return '';
}

/** Called whenever a tool starts or stops (from _syncDrawInteractive). */
function pmSyncMode() {
  const bar = document.getElementById('pm-mode-bar');
  if (!bar) return;
  const text = pmIsMobile() ? _pmActiveMode() : '';
  if (text) {
    document.getElementById('pm-mode-text').textContent = text;
    bar.hidden = false;
    if (document.body.classList.contains('pm-sheet-open')) {
      _pmReturnTab = document.body.dataset.pmTab || null;
      pmCloseSheet();
    }
  } else {
    bar.hidden = true;
    if (_pmReturnTab && pmIsMobile()) { const t = _pmReturnTab; _pmReturnTab = null; pmOpenTab(t); }
    _pmReturnTab = null;
  }
}

function pmExitModes() {
  if (tokenPlacementMode) cancelTokenPlacement();
  if (placeNoteMode) togglePlaceNoteMode();
  if (placeItemMode) togglePlaceItemMode();
  if (drawMode) toggleDrawMode();
  if (moveMode) toggleMoveMode();
  pmSyncMode();
}

// ── Grid settings live under More on a phone ──
function _pmPlaceControls() {
  const ctrls = document.getElementById('pm-controls');
  const more = document.getElementById('pm-more-controls');
  const editor = document.getElementById('pm-editor');
  if (!ctrls || !more || !editor) return;
  if (pmIsMobile()) { if (ctrls.parentElement !== more) more.appendChild(ctrls); }
  else if (ctrls.parentElement !== editor) editor.appendChild(ctrls);
}

function _pmOnLayoutChange() {
  _pmPlaceControls();
  if (!pmIsMobile()) {
    pmCloseSheet();
    _pmReturnTab = null;
    const bar = document.getElementById('pm-mode-bar');
    if (bar) bar.hidden = true;
  } else {
    pmSyncMode();
  }
  if (currentMapId) refreshCanvases();
}
PM_MQ.addEventListener('change', _pmOnLayoutChange);

// Choosing a map shows it; a new map or an import does the same.
(function () {
  const _select = selectMap;
  selectMap = function (id) {
    _select(id);
    _pmTabButtons(document.body.classList.contains('pm-sheet-open') ? document.body.dataset.pmTab : null);
    if (pmIsMobile() && currentMapId) pmCloseSheet();
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  _pmPlaceControls();
  _pmTabButtons(null);
  // Nothing to look at yet: start on the map list.
  if (pmIsMobile() && !currentMapId) pmOpenTab('maps');
});
// Escape closes the sheet (after any tool has had its turn with the key).
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pmIsMobile() && document.body.classList.contains('pm-sheet-open')) pmCloseSheet();
});
