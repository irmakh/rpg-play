'use strict';

// Shared login state across windows.
//
// The web app keeps its login in sessionStorage (`rpgSession`, plus the legacy
// `tableMasterPw` / `dmMasterPw` keys). sessionStorage is scoped to a single
// browser window, so in a multi-window desktop app every new window would open
// on the login screen even though the user is already signed in.
//
// The main process therefore holds one copy of those keys and the preload mirrors
// it into each window. Kept in memory only, never written to disk: closing the
// app logs you out, exactly as closing the browser does today.

const { webContents } = require('electron');

const KEYS = ['rpgSession', 'tableMasterPw', 'dmMasterPw'];

const state = Object.create(null);
for (const k of KEYS) state[k] = null;

let revision = 0;

function snapshot() {
  return { revision, values: { ...state } };
}

// Applies changes observed in one window and tells every other window.
// `values` carries the full key set; a null means "removed".
function apply(values, originWebContentsId) {
  let changed = false;
  for (const k of KEYS) {
    const next = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
    if (state[k] !== next) { state[k] = next; changed = true; }
  }
  if (!changed) return snapshot();

  revision += 1;
  const payload = snapshot();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.id === originWebContentsId || wc.isDestroyed()) continue;
    wc.send('rpg:session-changed', payload);
  }
  return payload;
}

function clear() {
  const empty = Object.create(null);
  for (const k of KEYS) empty[k] = null;
  return apply(empty, null);
}

function isSignedIn() {
  return !!state.rpgSession;
}

function role() {
  try {
    return (JSON.parse(state.rpgSession || 'null') || {}).role || null;
  } catch {
    return null;
  }
}

module.exports = { KEYS, snapshot, apply, clear, isSignedIn, role };
