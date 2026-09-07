'use strict';

// Window manager. Every window has a "role" — which screen of the web app it
// shows — and each role remembers its own geometry, display and zoom level, so a
// table on the second monitor reopens there next session.

const { BrowserWindow, screen, shell } = require('electron');
const path = require('path');
const config = require('./config');
const sessionStore = require('./session-store');

const APP_PRELOAD = path.join(__dirname, '..', 'preload', 'app-preload.js');
const UI_PRELOAD = path.join(__dirname, '..', 'preload', 'ui-preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// Screens of the web app that can be opened as their own native window.
// `secondary: true` means "prefer a different monitor than the main window".
const ROLES = {
  main:      { path: '/',                             title: 'RPG Table',       width: 1280, height: 860 },
  table:     { path: '/table.html',                   title: 'Table',           width: 1600, height: 950, secondary: true },
  dm:        { path: '/dm.html',                      title: 'DM Panel',        width: 1280, height: 900 },
  sheet:     { path: '/index.html',                   title: 'Character Sheet', width: 1120, height: 900 },
  monsters:  { path: '/monsters.html',                title: 'Monsters',        width: 1200, height: 880 },
  events:    { path: '/events.html',                  title: 'Events',          width: 1100, height: 820 },
  treasury:  { path: '/treasury.html',                title: 'Treasury',        width: 1100, height: 820 },
  stories:   { path: '/stories.html',                 title: 'Stories',         width: 1200, height: 880 },
  playlists: { path: '/playlists.html',               title: 'Music & Sounds',  width: 1100, height: 820 },
  nowplaying:{ path: '/music-player.html',            title: 'Now Playing',     width: 460,  height: 150, minWidth: 320, minHeight: 110 },
  campaigns: { path: '/campaigns.html',               title: 'Campaigns',       width: 1000, height: 780 },
  console:   { path: '/console/table-console.html',   title: 'Console',         width: 900,  height: 700 },
  secondary: { path: '/console/table-secondary.html', title: 'Second Screen',   width: 1600, height: 900, secondary: true },
};

const windows = new Map();   // role -> BrowserWindow (only for role-owned windows)
const popups = new Set();    // windows the web app opened via window.open

function serverUrl() {
  const raw = config.get('serverUrl');
  return raw ? String(raw).replace(/\/+$/, '') : null;
}

function urlFor(role) {
  const base = serverUrl();
  if (!base) return null;
  return base + (ROLES[role] ? ROLES[role].path : '/');
}

function sameOrigin(target) {
  const base = serverUrl();
  if (!base) return false;
  try {
    return new URL(target).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

// ── Geometry ──────────────────────────────────────────────────────────────────

// Keeps a restored window on a monitor that still exists. Unplugging the second
// screen would otherwise reopen a window at coordinates nobody can reach.
function clampToDisplay(bounds) {
  if (!bounds || typeof bounds.x !== 'number') return null;
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

// A fresh table or second-screen window belongs on the other monitor if there is
// one — that is the whole point of the feature.
function defaultBounds(role) {
  const spec = ROLES[role] || ROLES.main;
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target =
    spec.secondary && displays.length > 1
      ? displays.find((d) => d.id !== primary.id) || primary
      : primary;
  const area = target.workArea;
  const width = Math.min(spec.width, area.width);
  const height = Math.min(spec.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function saveState(role, win) {
  if (!win || win.isDestroyed()) return;
  const state = config.get('windowState') || {};
  const maximized = win.isMaximized();
  const fullScreen = win.isFullScreen();
  // Persist the restored size, not the maximized frame, or un-maximizing later
  // would snap the window to full-screen dimensions.
  const previous = state[role] && state[role].bounds;
  const bounds = maximized || fullScreen ? previous || win.getBounds() : win.getBounds();
  state[role] = { bounds, maximized, fullScreen };
  config.set('windowState', state);
}

function trackState(role, win) {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveState(role, win), 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('enter-full-screen', schedule);
  win.on('leave-full-screen', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    saveState(role, win);
  });
}

// ── Navigation policy ─────────────────────────────────────────────────────────

// Links that leave the server open in the real browser; the 5e.tools references
// scattered through the app would otherwise hijack a game window with no way back.
function applyNavigationPolicy(win) {
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== 'about:blank' && !sameOrigin(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // The web app's own pop-out panels (table-popout.js) open an about:blank
    // window and then move real DOM nodes into it, so they must stay as real,
    // same-process child windows with a working window.opener.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900,
        height: 720,
        icon: ICON,
        backgroundColor: '#1a1a2e',
        title: frameName || 'RPG Table',
        autoHideMenuBar: true,
        webPreferences: {
          preload: APP_PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on('did-create-window', (child) => {
    // A pop-out inherits the same policy, so a link clicked inside it still
    // leaves for the system browser instead of stranding the panel.
    applyNavigationPolicy(child);
    popups.add(child);
    child.on('closed', () => popups.delete(child));
  });
}

function showLoadError(win, role, errorCode, errorDescription, failedUrl) {
  const q = new URLSearchParams({
    role,
    code: String(errorCode),
    message: errorDescription || 'The server could not be reached.',
    url: failedUrl || '',
  });
  win.loadFile(path.join(RENDERER, 'error.html'), { search: q.toString() });
}

// ── Creation ──────────────────────────────────────────────────────────────────

function createAppWindow(role) {
  const spec = ROLES[role] || ROLES.main;
  const saved = (config.get('windowState') || {})[role];
  const bounds = clampToDisplay(saved && saved.bounds) || defaultBounds(role);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: spec.minWidth || 640,
    minHeight: spec.minHeight || 480,
    title: spec.title,
    icon: ICON,
    show: false,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: role !== 'main',
    webPreferences: {
      preload: APP_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.rpgRole = role;
  windows.set(role, win);

  if (saved && saved.maximized) win.maximize();
  if (saved && saved.fullScreen) win.setFullScreen(true);

  applyNavigationPolicy(win);
  trackState(role, win);

  win.webContents.on('did-finish-load', () => {
    const zoom = (config.get('zoom') || {})[role];
    if (typeof zoom === 'number') win.webContents.setZoomFactor(zoom);
  });

  win.webContents.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires for ordinary redirects and cancelled loads.
    if (!isMainFrame || code === -3) return;
    showLoadError(win, role, code, description, failedUrl);
  });

  win.webContents.on('page-title-updated', (event) => {
    event.preventDefault();           // keep the role name, not whatever the page sets
    win.setTitle(spec.title);
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (windows.get(role) === win) windows.delete(role);
  });

  const url = urlFor(role);
  if (url) win.loadURL(url);
  else showLoadError(win, role, 0, 'No server has been configured yet.', '');

  return win;
}

function open(role) {
  if (!ROLES[role]) role = 'main';
  const existing = windows.get(role);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  return createAppWindow(role);
}

// Which music screen belongs to the person signed in. The DM gets the control
// panel — playlists.html is DM-gated anyway, so it would only bounce a player to
// the login page. Everyone else gets the compact Now Playing window, which has
// no auth guard and follows the DM's sound events over realtime.
function musicRole() {
  return sessionStore.role() === 'dm' ? 'playlists' : 'nowplaying';
}

// A second window showing the same screen — for two character sheets side by
// side. Not tracked by role, so its geometry is not saved.
function openExtra(role) {
  const spec = ROLES[role] || ROLES.main;
  const win = new BrowserWindow({
    ...defaultBounds(role),
    title: spec.title,
    icon: ICON,
    show: false,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: APP_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.rpgRole = role;
  applyNavigationPolicy(win);
  win.once('ready-to-show', () => win.show());
  const url = urlFor(role);
  if (url) win.loadURL(url);
  popups.add(win);
  win.on('closed', () => popups.delete(win));
  return win;
}

// ── Local UI windows (setup / settings) ───────────────────────────────────────

const uiWindows = new Map();

function openLocal(name, { width = 760, height = 640, title = 'RPG Table' } = {}) {
  const existing = uiWindows.get(name);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width,
    height,
    title,
    icon: ICON,
    show: false,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: UI_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  uiWindows.set(name, win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => uiWindows.delete(name));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(RENDERER, `${name}.html`));
  return win;
}

function getLocal(name) {
  return uiWindows.get(name);
}

// ── Bulk operations ───────────────────────────────────────────────────────────

function all() {
  return [...windows.values(), ...popups].filter((w) => w && !w.isDestroyed());
}

function appWindows() {
  return [...windows.entries()].filter(([, w]) => w && !w.isDestroyed());
}

function focusAny() {
  const list = all();
  if (!list.length) return open('main');
  const win = list[0];
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function reloadAll() {
  for (const win of all()) win.webContents.reload();
}

// After the server URL changes, every open window still points at the old host.
function repointAll() {
  for (const [role, win] of appWindows()) {
    const url = urlFor(role);
    if (url) win.loadURL(url);
  }
}

function moveToDisplay(win, displayId) {
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!win || win.isDestroyed() || !display) return;
  const area = display.workArea;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (win.isMaximized()) win.unmaximize();
  const current = win.getBounds();
  win.setBounds({
    x: area.x + 40,
    y: area.y + 40,
    width: Math.min(current.width, area.width - 80),
    height: Math.min(current.height, area.height - 80),
  });
}

function setZoom(win, factor) {
  if (!win || win.isDestroyed()) return;
  const clamped = Math.min(Math.max(factor, 0.4), 3);
  win.webContents.setZoomFactor(clamped);
  const role = win.rpgRole;
  if (role) {
    const zoom = config.get('zoom') || {};
    zoom[role] = clamped;
    config.set('zoom', zoom);
  }
}

async function clearCacheAndReload(win) {
  if (!win || win.isDestroyed()) return;
  await win.webContents.session.clearCache();
  win.webContents.reloadIgnoringCache();
}

module.exports = {
  ROLES,
  serverUrl,
  urlFor,
  sameOrigin,
  open,
  openExtra,
  musicRole,
  openLocal,
  getLocal,
  all,
  appWindows,
  focusAny,
  reloadAll,
  repointAll,
  moveToDisplay,
  setZoom,
  clearCacheAndReload,
  showLoadError,
  get: (role) => windows.get(role),
};
