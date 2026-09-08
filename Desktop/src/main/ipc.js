'use strict';

// Every channel the renderer side can reach. The web app itself gets none of
// these: the only privileged surface exposed to remote content is the session
// mirror, which carries login state the page already had.

const { ipcMain, app, screen, BrowserWindow, shell, net, dialog, session, Notification } = require('electron');
const config = require('./config');
const sessionStore = require('./session-store');
const windows = require('./windows');
const shortcuts = require('./shortcuts');
const tray = require('./tray');
const certs = require('./certs');
const menu = require('./menu');

const PROBE_TIMEOUT_MS = 8000;

// Accepts "rpg.example.com", "192.168.1.9:3000" or a full URL. A bare host is
// tried over HTTPS first, then HTTP, so a LAN dev server still resolves.
function candidatesFor(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  return [`https://${raw}`, `http://${raw}`];
}

// A server counts as valid only if /api/config answers with the RPG Table
// payload — that rules out pointing the app at an unrelated web server.
function probeOne(baseUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) { settled = true; resolve(result); }
    };

    let request;
    try {
      request = net.request({ method: 'GET', url: `${baseUrl}/api/config` });
    } catch (err) {
      return done({ ok: false, error: String(err.message || err) });
    }

    const timer = setTimeout(() => {
      try { request.abort(); } catch {}
      done({ ok: false, error: 'Timed out waiting for the server.' });
    }, PROBE_TIMEOUT_MS);

    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          return done({ ok: false, error: `Server answered HTTP ${response.statusCode}.` });
        }
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed.dbProvider !== 'string') {
            return done({ ok: false, error: 'That address is reachable but is not an RPG Table server.' });
          }
          done({ ok: true, url: baseUrl, dbProvider: parsed.dbProvider, wsUrl: parsed.wsUrl || null });
        } catch {
          done({ ok: false, error: 'That address is reachable but is not an RPG Table server.' });
        }
      });
    });

    request.on('error', (err) => {
      clearTimeout(timer);
      done({ ok: false, error: String((err && err.message) || err) });
    });

    request.end();
  });
}

// The server reports the absolute WebSocket URL it wants clients to use (the
// WS_URL env var). When that names a different host than the address the user
// typed — reaching the server by IP when it publishes a domain — realtime
// updates would come from an origin the page is not on. Worth saying out loud
// before it looks like a mysterious "the table doesn't update" bug.
function hostMismatchOf(result) {
  if (!result.wsUrl) return null;
  try {
    const wsHost = new URL(result.wsUrl).host;
    const baseHost = new URL(result.url).host;
    return wsHost === baseHost ? null : wsHost;
  } catch {
    return null;
  }
}

async function probe(input) {
  const candidates = candidatesFor(input);
  if (!candidates.length) return { ok: false, error: 'Enter a server address.' };

  let lastError = 'Could not reach that address.';
  for (const candidate of candidates) {
    const result = await probeOne(candidate);
    if (result.ok) {
      result.hostMismatch = hostMismatchOf(result);
      return result;
    }
    lastError = result.error;
  }
  return { ok: false, error: lastError };
}

function uiState() {
  return {
    config: config.all(),
    defaults: config.DEFAULTS,
    appVersion: app.getVersion(),
    configPath: config.configPath(),
    shortcutFailures: shortcuts.failures(),
    shortcutActions: Object.fromEntries(
      Object.entries(shortcuts.ACTIONS).map(([key, spec]) => [key, spec.label])
    ),
    roles: Object.fromEntries(
      Object.entries(windows.ROLES).map(([key, spec]) => [key, spec.title])
    ),
    displays: screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: `Display ${index + 1} — ${display.size.width}×${display.size.height}`,
      primary: display.id === screen.getPrimaryDisplay().id,
    })),
  };
}

// Which windows have already loaded a document. The preload needs to tell a
// brand-new window (seed it from the shared session) apart from a window that
// simply navigated (its own sessionStorage is authoritative — the user just
// signed in or out and the page moved before the poll could report it).
const documentsSeen = new Set();

function register() {
  // ── Session mirror (available to web-app windows) ───────────────────────────
  ipcMain.on('rpg:session-get-sync', (event) => {
    const id = event.sender.id;
    const isFirstDocument = !documentsSeen.has(id);
    if (isFirstDocument) {
      documentsSeen.add(id);
      event.sender.once('destroyed', () => documentsSeen.delete(id));
    }
    event.returnValue = { ...sessionStore.snapshot(), isFirstDocument };
  });

  ipcMain.handle('rpg:session-get', () => sessionStore.snapshot());

  ipcMain.on('rpg:session-set', (event, values) => {
    if (values && typeof values === 'object') {
      sessionStore.apply(values, event.sender.id);
    }
  });

  // ── Local UI windows ────────────────────────────────────────────────────────
  ipcMain.handle('ui:state', () => uiState());

  ipcMain.handle('ui:probe-server', (event, url) => probe(url));

  ipcMain.handle('ui:save-server', async (event, url) => {
    const result = await probe(url);
    if (!result.ok) return result;

    const previous = config.get('serverUrl');
    config.set('serverUrl', result.url);

    if (previous && previous !== result.url) {
      // Cookies and storage belong to the old host; a stale campaign cookie
      // would otherwise follow the user to a server that has no such campaign.
      sessionStore.clear();
    }

    if (windows.all().length) windows.repointAll();
    else windows.open('main');

    const setupWindow = windows.getLocal('setup');
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();

    tray.refresh();
    return result;
  });

  ipcMain.handle('ui:save-settings', (event, patch) => {
    const allowed = ['shortcuts', 'shortcutsEnabled', 'trayEnabled', 'closeToTray'];
    const clean = {};
    for (const key of allowed) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) clean[key] = patch[key];
    }
    config.patch(clean);

    const failures = shortcuts.register();
    tray.sync();
    tray.refresh();
    menu.build();
    return { ok: true, shortcutFailures: failures };
  });

  ipcMain.handle('ui:reset-window-state', () => {
    config.set('windowState', {});
    config.set('zoom', {});
    return { ok: true };
  });

  ipcMain.handle('ui:forget-certificates', () => {
    certs.forgetAll();
    return { ok: true };
  });

  ipcMain.handle('ui:clear-data', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning',
      buttons: ['Cancel', 'Clear browsing data'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Clear browsing data',
      message: 'Clear cached pages, cookies and local storage?',
      detail:
        'You will be signed out and will have to pick a campaign again. ' +
        'Nothing on the server is affected.',
    });
    if (response !== 1) return { ok: false, cancelled: true };

    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    sessionStore.clear();
    windows.reloadAll();
    return { ok: true };
  });

  ipcMain.on('ui:open-role', (event, role) => windows.open(role));

  ipcMain.on('ui:open-external', (event, url) => {
    if (/^https?:\/\//i.test(String(url || ''))) shell.openExternal(url);
  });

  ipcMain.on('ui:open-setup', () => {
    windows.openLocal('setup', { title: 'RPG Table — Server', width: 720, height: 560 });
  });

  ipcMain.on('ui:close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // ── Error page ──────────────────────────────────────────────────────────────
  ipcMain.on('error:retry', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const url = windows.urlFor(win.rpgRole || 'main');
    if (url) win.loadURL(url);
  });

  // A real Windows notification for something the app wants to interrupt for.
  // The page only asks when it is in the background, and clicking one brings
  // back the window that raised it — which a web notification cannot do.
  ipcMain.on('notify:show', (event, payload) => {
    try {
      if (!Notification.isSupported()) return;
      const title = String((payload && payload.title) || '').slice(0, 120);
      if (!title) return;
      const win = BrowserWindow.fromWebContents(event.sender);
      const note = new Notification({
        title,
        body: String((payload && payload.body) || '').slice(0, 300),
        silent: false,
      });
      note.on('click', () => {
        const target = (win && !win.isDestroyed()) ? win : windows.focusAny();
        if (!target || target.isDestroyed()) return;
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
        // Only follow the link when it names a different screen; otherwise
        // raising the window is the whole point.
        const href = String((payload && payload.href) || '');
        try {
          if (href && new URL(target.webContents.getURL()).pathname !== href) {
            const base = windows.serverUrl();
            if (base) target.loadURL(base + href);
          }
        } catch {}
      });
      note.show();
    } catch (err) { console.error('notify:show:', err); }
  });
}

module.exports = { register, probe, uiState };
