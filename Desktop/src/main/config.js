'use strict';

// Persistent settings, stored as one JSON file in the Electron userData folder.
// Hand-rolled instead of a dependency: the shape is small, and keeping the
// dependency list at exactly two packages (electron + electron-builder) means a
// build never breaks on someone else's release.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Where the RPG Table server lives, e.g. "https://rpg.example.com".
  // null means the app has never been set up and the first-run screen shows.
  serverUrl: null,

  // Certificates the user has explicitly chosen to trust, keyed by "host:port".
  // Value is the SHA-256 fingerprint that was approved. See main/certs.js —
  // nothing is trusted implicitly, and a changed fingerprint re-prompts.
  trustedCerts: {},

  // Saved geometry per window role, so each screen reopens where it was left.
  windowState: {},

  // System-wide hotkeys. Empty string disables one.
  shortcuts: {
    table: 'Control+Alt+T',
    dm: 'Control+Alt+D',
    sheet: 'Control+Alt+C',
    music: 'Control+Alt+M',
    focus: 'Control+Alt+R',
  },
  shortcutsEnabled: true,

  // Tray behaviour.
  trayEnabled: true,
  closeToTray: false,

  // Remembered folder for the native save dialog.
  lastDownloadDir: null,

  // Per-role zoom factor, so a table on a TV can stay larger than the sheet.
  zoom: {},
};

let filePath = null;
let data = null;
let writeTimer = null;

function load() {
  filePath = path.join(app.getPath('userData'), 'config.json');
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    stored = {};                       // missing or corrupt: fall back to defaults
  }
  data = { ...structuredClone(DEFAULTS), ...stored };
  // Merge one level deep so a new default shortcut appears for existing installs.
  data.shortcuts = { ...DEFAULTS.shortcuts, ...(stored.shortcuts || {}) };
  return data;
}

function flush() {
  writeTimer = null;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);      // atomic: a crash mid-write cannot truncate the config
  } catch (err) {
    console.error('[config] write failed', err);
  }
}

function save() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 250);
}

function get(key) {
  return data[key];
}

function set(key, value) {
  data[key] = value;
  save();
}

function patch(partial) {
  Object.assign(data, partial);
  save();
}

function all() {
  return structuredClone(data);
}

// Called on quit — the debounce must not eat the last write.
function saveNow() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}

module.exports = { DEFAULTS, load, get, set, patch, all, saveNow, configPath: () => filePath };
