'use strict';

// Preload for windows showing the web app.
//
// Its one real job is keeping the login alive across windows. The web app stores
// its session in sessionStorage, which every browser window gets a private copy
// of, so a second window would land on the login screen. The main process holds
// the authoritative copy and this script mirrors it in both directions.
//
// Nothing here changes web-app code: it reads and writes the same keys the app
// already uses.

const { contextBridge, ipcRenderer } = require('electron');

const KEYS = ['rpgSession', 'tableMasterPw', 'dmMasterPw'];
const POLL_MS = 700;

let lastSeen = Object.create(null);
let lastRevision = -1;

function readLocal() {
  const values = Object.create(null);
  for (const key of KEYS) {
    try {
      values[key] = window.sessionStorage.getItem(key);
    } catch {
      values[key] = null;      // opaque origin (about:blank pop-outs) — nothing to mirror
    }
  }
  return values;
}

function writeLocal(values) {
  for (const key of KEYS) {
    const value = values[key];
    try {
      if (value === null || value === undefined) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // Storage unavailable in this document; the poll simply does nothing.
    }
  }
}

function differs(a, b) {
  return KEYS.some((key) => (a[key] ?? null) !== (b[key] ?? null));
}

// ── Seed before any page script runs ─────────────────────────────────────────
// Synchronous on purpose: the login page checks sessionStorage in a top-level
// script, so the value has to be there before that script is parsed.
try {
  const snapshot = ipcRenderer.sendSync('rpg:session-get-sync');
  if (snapshot && snapshot.values) {
    const local = readLocal();
    const hasLocal = KEYS.some((key) => local[key] !== null);
    const hasShared = KEYS.some((key) => snapshot.values[key] !== null);

    // A window that already has its own session wins — it is the one the user
    // just signed in on, and its values reach the main process on the next poll.
    if (hasShared && !hasLocal) writeLocal(snapshot.values);

    lastRevision = snapshot.revision;
  }
  lastSeen = readLocal();
} catch {
  lastSeen = readLocal();
}

// ── Push local changes out ───────────────────────────────────────────────────
// sessionStorage cannot be observed from an isolated world (the page mutates a
// different JS wrapper over the same storage), and the `storage` event does not
// fire for the window that made the change. Polling is the reliable option, and
// three short string reads a second costs nothing.
setInterval(() => {
  const current = readLocal();
  if (!differs(current, lastSeen)) return;
  lastSeen = current;
  ipcRenderer.send('rpg:session-set', current);
}, POLL_MS);

// ── Pull remote changes in ───────────────────────────────────────────────────
ipcRenderer.on('rpg:session-changed', (event, snapshot) => {
  if (!snapshot || snapshot.revision === lastRevision) return;
  lastRevision = snapshot.revision;
  writeLocal(snapshot.values);
  lastSeen = readLocal();     // never echo a change back to the main process
});

// ── Minimal surface for the page ─────────────────────────────────────────────
// Deliberately tiny: these windows render remote content, so they get a flag the
// web app may use for desktop-only tweaks plus the two actions the built-in
// error page needs. No filesystem, no settings, no session access.
contextBridge.exposeInMainWorld('rpgDesktop', {
  isDesktop: true,
  version: process.versions.electron,
  retry: () => ipcRenderer.send('error:retry'),
  openServerSetup: () => ipcRenderer.send('ui:open-setup'),
});
