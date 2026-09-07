'use strict';

// System tray icon. Keeps the app reachable when every window is closed, which
// is what makes "close to tray" and the global hotkeys useful together.

const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const config = require('./config');
const windows = require('./windows');

const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'tray.png');
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let tray = null;

function contextMenu() {
  const quickRoles = ['table', 'dm', 'sheet', 'campaigns'];
  // Resolved when the menu is built, so it follows whoever is signed in.
  const musicRole = windows.musicRole();
  return Menu.buildFromTemplate([
    { label: 'Open RPG Table', click: () => windows.open('main') },
    { type: 'separator' },
    ...quickRoles.map((role) => ({
      label: windows.ROLES[role].title,
      click: () => windows.open(role),
    })),
    { label: windows.ROLES[musicRole].title, click: () => windows.open(windows.musicRole()) },
    { type: 'separator' },
    {
      label: 'Bring All Windows Forward',
      click: () => {
        for (const win of windows.all()) {
          if (win.isMinimized()) win.restore();
          win.showInactive();
        }
        windows.focusAny();
      },
    },
    {
      label: 'Settings…',
      click: () => windows.openLocal('settings', { title: 'RPG Table — Settings', width: 760, height: 700 }),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function create() {
  if (tray) return tray;

  let image = nativeImage.createFromPath(TRAY_ICON);
  if (image.isEmpty()) image = nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });

  tray = new Tray(image);
  tray.setToolTip('RPG Table');
  tray.setContextMenu(contextMenu());
  tray.on('click', () => windows.focusAny());
  return tray;
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// Called at startup and whenever the setting is toggled.
function sync() {
  if (config.get('trayEnabled')) create();
  else destroy();
}

function refresh() {
  if (tray) tray.setContextMenu(contextMenu());
}

module.exports = { create, destroy, sync, refresh, isActive: () => !!tray };
