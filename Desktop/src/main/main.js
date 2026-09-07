'use strict';

// RPG Table desktop client.
//
// This is a thin client: it renders the pages served by an existing RPG Table
// server and adds the things a browser tab cannot give you — real windows on
// real monitors, a menu, system-wide hotkeys, a tray icon and native save
// dialogs. No server code and no web-app code lives here.

const { app, BrowserWindow, session } = require('electron');

const config = require('./config');
const certs = require('./certs');
const downloads = require('./downloads');
const ipc = require('./ipc');
const menu = require('./menu');
const shortcuts = require('./shortcuts');
const tray = require('./tray');
const windows = require('./windows');

const isDev = process.argv.includes('--dev');

// Windows shows notifications under this identity; without it the download
// notifications appear as "electron.app.Electron".
app.setAppUserModelId('com.irmakh.rpgtable');

// A second launch should surface the running app, not start a rival instance
// with its own tray icon and hotkey registrations.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windows.focusAny();
  });

  app.whenReady().then(() => {
    config.load();

    certs.install();
    downloads.install();
    ipc.register();

    // The web app needs neither camera nor microphone. Fullscreen matters for
    // the table screen; everything else is refused.
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(permission === 'fullscreen' || permission === 'notifications');
    });

    menu.build();
    menu.watchDisplays();
    tray.sync();
    shortcuts.register();

    if (!config.get('serverUrl')) {
      windows.openLocal('setup', { title: 'RPG Table — Server', width: 720, height: 560 });
    } else {
      const win = windows.open('main');
      if (isDev) win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // With a tray icon and "close to tray" on, closing the last window leaves the
  // app running so the hotkeys still work. Otherwise closing everything quits.
  app.on('window-all-closed', () => {
    if (config.get('closeToTray') && tray.isActive()) return;
    app.quit();
  });

  // Keeps the Always-on-Top tick honest as focus moves between windows.
  app.on('browser-window-focus', () => menu.syncFocusState());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.open('main');
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    shortcuts.unregisterAll();
    config.saveNow();
  });
}
