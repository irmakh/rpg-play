'use strict';

// Application menu. Rebuilt whenever the monitor layout changes, because the
// Window menu lists the displays a window can be thrown onto.

const { Menu, BrowserWindow, screen, shell, app, dialog } = require('electron');
const windows = require('./windows');
const config = require('./config');

function focused() {
  return BrowserWindow.getFocusedWindow();
}

function withFocused(fn) {
  const win = focused();
  if (win && !win.isDestroyed()) fn(win);
}

// One "New Window" entry per screen of the web app.
function newWindowItems() {
  const order = [
    'table', 'dm', 'sheet', 'monsters', 'events',
    'treasury', 'stories', 'playlists', 'nowplaying', 'campaigns', 'console', 'secondary',
  ];
  return order.map((role) => ({
    label: windows.ROLES[role].title,
    click: () => windows.open(role),
  }));
}

function displayItems() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  if (displays.length < 2) {
    return [{ label: 'Only one display detected', enabled: false }];
  }
  return displays.map((display, index) => ({
    label:
      `Display ${index + 1} — ${display.size.width}×${display.size.height}` +
      (display.id === primaryId ? ' (primary)' : ''),
    click: () => withFocused((win) => windows.moveToDisplay(win, display.id)),
  }));
}

function zoomStep(win, delta) {
  windows.setZoom(win, win.webContents.getZoomFactor() + delta);
}

function template() {
  return [
    {
      label: '&File',
      submenu: [
        { label: 'New Window', submenu: newWindowItems() },
        {
          label: 'Duplicate This Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => withFocused((win) => windows.openExtra(win.rpgRole || 'main')),
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => windows.openLocal('settings', { title: 'RPG Table — Settings', width: 760, height: 700 }),
        },
        {
          label: 'Change Server…',
          click: () => windows.openLocal('setup', { title: 'RPG Table — Server', width: 720, height: 560 }),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => withFocused((win) => {
            // navigationHistory is the supported API on current Electron; the
            // older goBack() shim was removed.
            const nav = win.webContents.navigationHistory;
            if (nav && nav.canGoBack()) nav.goBack();
          }),
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => withFocused((win) => {
            const nav = win.webContents.navigationHistory;
            if (nav && nav.canGoForward()) nav.goForward();
          }),
        },
        {
          label: 'Home',
          accelerator: 'Alt+Home',
          click: () => withFocused((win) => {
            const url = windows.urlFor(win.rpgRole || 'main');
            if (url) win.loadURL(url);
          }),
        },
        { type: 'separator' },
        { role: 'reload', label: 'Reload' },
        {
          label: 'Reload and Clear Cache',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => withFocused((win) => windows.clearCacheAndReload(win)),
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => withFocused((win) => zoomStep(win, 0.1)),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => withFocused((win) => zoomStep(win, -0.1)),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => withFocused((win) => windows.setZoom(win, 1)),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
      ],
    },
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        {
          id: 'always-on-top',
          label: 'Always on Top',
          type: 'checkbox',
          checked: !!(focused() && focused().isAlwaysOnTop()),
          click: (item) => withFocused((win) => win.setAlwaysOnTop(item.checked)),
        },
        { label: 'Move to Display', submenu: displayItems() },
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
          label: 'Reload All Windows',
          click: () => windows.reloadAll(),
        },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Open Server in Browser',
          click: () => {
            const url = windows.serverUrl();
            if (url) shell.openExternal(url);
          },
        },
        {
          label: 'Open Settings Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        {
          label: 'About RPG Table',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About RPG Table',
              message: `RPG Table ${app.getVersion()}`,
              detail:
                `Desktop client for the RPG Table virtual tabletop.\n\n` +
                `Server: ${config.get('serverUrl') || 'not configured'}\n` +
                `Electron ${process.versions.electron}\n` +
                `Chromium ${process.versions.chrome}`,
            });
          },
        },
      ],
    },
  ];
}

function build() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
}

// The menu is built once but "Always on Top" is a per-window state, so the tick
// has to follow whichever window just took focus.
function syncFocusState() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('always-on-top');
  const win = focused();
  if (item && win && !win.isDestroyed()) item.checked = win.isAlwaysOnTop();
}

// The Window menu lists monitors, so it must be rebuilt when one is plugged in.
function watchDisplays() {
  screen.on('display-added', build);
  screen.on('display-removed', build);
  screen.on('display-metrics-changed', build);
}

module.exports = { build, syncFocusState, watchDisplays };
