'use strict';

// System-wide hotkeys: reach the table, the DM panel or your sheet without
// alt-tabbing, even while another application has focus.

const { globalShortcut } = require('electron');
const config = require('./config');
const windows = require('./windows');

// Which config key drives which action.
const ACTIONS = {
  table: { label: 'Show table', run: () => toggleRole('table') },
  dm: { label: 'Show DM panel', run: () => toggleRole('dm') },
  sheet: { label: 'Show character sheet', run: () => toggleRole('sheet') },
  // Resolved per press, not once at startup: whether this opens the DM control
  // panel or the Now Playing window depends on who is signed in right now.
  music: { label: 'Show music player', run: () => toggleRole(windows.musicRole()) },
  focus: { label: 'Bring all windows forward', run: () => raiseAll() },
};

// A second press of the same key gets out of the way again — useful when the
// table is on the monitor you were just working on.
function toggleRole(role) {
  const existing = windows.get(role);
  if (existing && !existing.isDestroyed() && existing.isFocused()) {
    existing.minimize();
    return;
  }
  windows.open(role);
}

function raiseAll() {
  const list = windows.all();
  if (!list.length) {
    windows.open('main');
    return;
  }
  for (const win of list) {
    if (win.isMinimized()) win.restore();
    win.showInactive();
  }
  list[0].focus();
}

let lastFailures = [];

function unregisterAll() {
  globalShortcut.unregisterAll();
}

// Returns the accelerators that could not be claimed — normally because another
// application already owns them. The settings screen shows these back to the user.
function register() {
  unregisterAll();
  lastFailures = [];

  if (!config.get('shortcutsEnabled')) return lastFailures;

  const accelerators = config.get('shortcuts') || {};
  for (const [action, spec] of Object.entries(ACTIONS)) {
    const accelerator = (accelerators[action] || '').trim();
    if (!accelerator) continue;
    try {
      const ok = globalShortcut.register(accelerator, spec.run);
      if (!ok) lastFailures.push({ action, accelerator, label: spec.label });
    } catch (err) {
      lastFailures.push({ action, accelerator, label: spec.label, error: String(err.message || err) });
    }
  }
  return lastFailures;
}

function failures() {
  return lastFailures;
}

module.exports = { ACTIONS, register, unregisterAll, failures };
