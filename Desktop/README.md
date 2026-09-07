# RPG Table — Desktop Client

An Electron shell around the existing RPG Table web app. It is a **thin client**:
it renders the pages your server already serves and adds what a browser tab
cannot — real windows on real monitors, an application menu, system-wide
hotkeys, a tray icon and native save dialogs.

No server code and no web-app code lives here. Nothing under `Application/` was
changed to make this work, and nothing here needs to change when the web app
does.

---

## Running it

```bash
cd Desktop
npm install
npm start
```

If `npm install` finishes without downloading the Electron binary (no
`node_modules/electron/dist/`), run the download step directly:

```bash
node node_modules/electron/install.js
```

> **Running from inside a VS Code terminal or an agent session:** these set
> `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary boot as plain Node
> and crash with `Cannot read properties of undefined (reading 'setAppUserModelId')`.
> Launch with the variable cleared: `env -u ELECTRON_RUN_AS_NODE npm start`.
> A normal terminal or a built installer is unaffected.

`npm run dev` does the same and opens DevTools.

## Building the Windows installer

```bash
npm run build      # NSIS installer + portable .exe, into Desktop/dist/
npm run pack       # unpacked folder only, for a quick check
```

Both artifacts are x64. The app is unsigned, so SmartScreen will warn on first
run of the installer.

---

## First run

The app asks for a server address. Enter a bare host (`dnd.example.com`,
`192.168.1.20:3000`) or a full URL; a bare host is tried over HTTPS first, then
HTTP. The address is only accepted if `GET /api/config` answers with the RPG
Table payload, so a typo cannot be saved.

Two things the setup screen handles for you:

- **Self-hosted certificates.** If the certificate does not validate — the usual
  case when reaching a server by IP, since a public CA cannot issue for a bare IP
  — you are shown the issuer, subject and SHA-256 fingerprint and asked once.
  The approved fingerprint is pinned; if it ever changes, you are asked again.
  Nothing is trusted silently.
- **Host mismatch.** The server publishes the host it sends live updates from
  (`WS_URL`). If you connect by IP while the server publishes a domain, realtime
  traffic would arrive from a different origin than the pages. The setup screen
  says so and offers to switch to the published address.

Change the server later from **File → Change Server…**.

---

## What the desktop adds

**Multi-monitor windows** — `File → New Window` opens any screen of the app as
its own native window: Table, DM Panel, Character Sheet, Monsters, Events,
Treasury, Stories, Music & Sounds, Now Playing, Campaigns, Console, Second
Screen. Each remembers
its own size, position, monitor, maximised/fullscreen state and zoom level.
`Window → Move to Display` throws the focused window at another monitor, and the
Table and Second Screen open on a secondary monitor by default when one exists.

**Menus and shortcuts** — Back/Forward/Home, Reload, Reload-and-clear-cache,
zoom in/out/reset (remembered per screen), real fullscreen, Always on Top,
DevTools.

**Global hotkeys** — reach a window while another application has focus.
Defaults: `Ctrl+Alt+T` table, `Ctrl+Alt+D` DM panel, `Ctrl+Alt+C` character
sheet, `Ctrl+Alt+M` music, `Ctrl+Alt+R` bring everything forward. Pressing one
again minimises that window. Rebind them in Settings by clicking a box and
pressing the keys; a shortcut another application already owns is reported
instead of failing silently.

The music key is resolved on each press from whoever is signed in, because the
two roles want different screens:

| Signed in as | Opens | Why |
|---|---|---|
| DM | **Music & Sounds** (`/playlists.html`) | The control panel where tracks are chosen and triggered. It is DM-gated server-side, so it would only bounce a player to the login page. |
| Player, or signed out | **Now Playing** (`/music-player.html`) | A compact window with the track name, position and volume. No auth guard, and it follows the DM's sound events over realtime. |

Two things to know about the Now Playing window: it opens showing nothing until
the next command from the DM, because it normally receives its initial state
from the page that spawned it; and it closes itself when a table window loads,
which is the web app's own guard against the same track playing twice.

**Tray icon** — quick access to the main screens. With *keep running when the
last window closes* enabled, the app stays in the tray so the hotkeys keep
working.

**Native save dialogs** — database backups, map exports and character XML open a
real Save dialog, remember the last folder, and give a "show in folder"
notification when finished, instead of dropping silently into Downloads.

**Offline screen** — when the server cannot be reached you get a page naming the
address and the failure, with a manual retry and an automatic one every 20
seconds, so a server restart recovers on its own.

---

## How it works

```
src/main/         main process
  main.js           lifecycle, single-instance lock, permission policy
  config.js         JSON settings in the Electron userData folder
  windows.js        window roles, geometry, navigation policy
  certs.js          per-host certificate trust, pinned by fingerprint
  downloads.js      native save dialogs
  menu.js           application menu (rebuilt when monitors change)
  tray.js           tray icon
  shortcuts.js      global hotkeys
  session-store.js  the shared login state
  ipc.js            every channel the renderer can reach
src/preload/
  app-preload.js    loaded into web-app windows — the session mirror
  ui-preload.js     loaded into setup/settings — the configuration API
src/renderer/     the app's own pages (setup, settings, offline)
```

### The one non-obvious part: the session mirror

The web app keeps its login in `sessionStorage` (`rpgSession`, plus the legacy
`tableMasterPw` / `dmMasterPw` keys). Every browser window gets a private copy of
`sessionStorage`, so opening the table in a second window would land on the login
screen even though you just signed in.

`session-store.js` holds one authoritative copy in the main process and
`app-preload.js` mirrors it into every window:

- **Seeding** happens synchronously in the preload, before any page script is
  parsed, because `login.js` checks `sessionStorage` in a top-level script. A
  window that already has its own session keeps it — that is the window you just
  signed in on.
- **Outward sync** is a 700ms poll. `sessionStorage` cannot be observed from a
  preload's isolated world (the page mutates a different JS wrapper over the same
  storage) and the `storage` event never fires for the window that made the
  change, so polling three short strings is the reliable option.
- **Inward sync** is a broadcast: signing out in one window signs out the rest.

Kept in memory only, never written to disk — quitting the app signs you out,
exactly as closing the browser does today.

### Security posture

Web-app windows run with `contextIsolation: true`, `nodeIntegration: false` and
`sandbox: true`. The only thing exposed to them is `window.rpgDesktop`, carrying
an `isDesktop` flag and the two actions the offline page needs — no filesystem,
no settings, no session access. Configuration is reachable only from the app's
own local pages, which use a separate preload. Camera and microphone permission
requests are refused; only fullscreen and notifications are granted. Links that
leave your server open in the system browser rather than hijacking a game window.

### Settings

Stored as one JSON file in the Electron userData folder (`Settings → Open
Settings Folder`, or `%APPDATA%/RPG Table/config.json`). Server URL, trusted
certificate fingerprints, per-role window geometry and zoom, hotkeys, and tray
preferences. Maintenance buttons reset window positions, forget trusted
certificates, or clear cookies and cached pages.
