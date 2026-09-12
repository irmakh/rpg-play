'use strict';

/**
 * End-to-end check for notification window reuse, run inside a real Electron.
 *
 * Launch:
 *   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/e2e-window-reuse.js \
 *     --user-data-dir=<a temp dir holding a config.json with serverUrl>
 *
 * It drives the real main-process window policy (src/main/windows.js) and the
 * real shipped web code (js/lib/notifications.js, loaded from the server) in
 * real BrowserWindows, and checks both halves of the behaviour:
 *
 *   target already open  -> it is focused, NO new window, and the window that
 *                           asked stays exactly where it was
 *   target not open      -> a new window opens, and the window that asked
 *                           still stays where it was
 *
 * The second case always worked. The first is the regression: the main process
 * answers a reused window.open with null, and notifFollow used to read that as
 * "popup blocked" and navigate the asking window on top of focusing the target.
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');

// Test-harness only, never the shipped app: the Chromium sandbox and the GPU
// often cannot start under a restricted/automation shell, and a renderer that
// never starts looks exactly like a hang.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
const config = require('../src/main/config');
const certs = require('../src/main/certs');
const downloads = require('../src/main/downloads');
const ipc = require('../src/main/ipc');
const windows = require('../src/main/windows');

// Electron's main process is a GUI binary on Windows: console.log does not
// reach a piped stdout. Results go to a file the caller reads instead.
const REPORT = process.argv.find(a => a.startsWith('--report='))?.slice('--report='.length)
  || 'e2e-report.txt';
const lines = [];
const say = (line) => {
  lines.push(line);
  try { fs.writeFileSync(REPORT, lines.join('\n') + '\n'); } catch {}
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const settled = (win, label) => new Promise((resolve) => {
  let done = false;
  const finish = (why) => { if (done) return; done = true; say(`  ${label}: ${why}`); resolve(); };
  win.webContents.once('did-finish-load', () => finish('did-finish-load'));
  win.webContents.once('did-fail-load', (e, code, desc) => finish(`did-fail-load ${code} ${desc}`));
  win.webContents.once('dom-ready', () => finish('dom-ready'));
  setTimeout(() => finish('gave up waiting'), 15000);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const appWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

/**
 * Did this window try to navigate itself?
 *
 * Comparing the URL before and after is NOT enough: /music.html bounces an
 * unauthenticated visitor straight back to the campaign picker, so a window
 * that wrongly navigated lands back where it started and looks innocent. The
 * attempt is the thing to watch.
 */
function watchNavigation(win) {
  const seen = [];
  const onNav = (e, url, isInPlace, isMainFrame) => { if (isMainFrame) seen.push(url); };
  win.webContents.on('did-start-navigation', onNav);
  return { seen, stop: () => win.webContents.off('did-start-navigation', onNav) };
}

/** Put the real shipped notifications.js into this page, then call notifFollow. */
async function follow(win, data) {
  say('  calling notifFollow ' + JSON.stringify(data));
  await win.webContents.executeJavaScript(`
    (async () => {
      {
        // Always re-fetch, past the cache: JS is served immutable by URL, so a
        // stale copy would quietly test the previous build instead of this one.
        const url = '/js/lib/notifications.js?e2e=' + Date.now() + Math.random();
        const src = await fetch(url, { cache: 'no-store' }).then(r => r.text());
        (0, eval)(src);                       // same file the app itself loads
      }
      notifFollow(${JSON.stringify(data)});
      return true;
    })()
  `, true);
  await wait(700);                            // let a window appear or a navigation start
}

setTimeout(() => {
  say('FAIL  harness timed out after 90s');
  say('RESULT: FAIL');
  app.exit(1);
}, 90000).unref?.();

app.whenReady().then(async () => {
  say('electron ready');
  // Same startup as src/main/main.js. ipc.register() is not optional: the app
  // preload talks to those handlers, and without them the renderer never loads.
  config.load();
  certs.install();
  downloads.install();
  ipc.register();
  say('serverUrl = ' + config.get('serverUrl'));

  try {
    // ── The window that will ask ───────────────────────────────────────────
    say('opening the main window');
    const opener = windows.open('main');
    await settled(opener, 'main');
    say('main window settled at ' + opener.webContents.getURL());
    const openerPathBefore = pathOf(opener.webContents.getURL());
    check('the asking window loaded', !!openerPathBefore, openerPathBefore);

    const desktopFlag = await opener.webContents.executeJavaScript(
      '!!(window.rpgDesktop && window.rpgDesktop.isDesktop)');
    check('the page knows it is in the desktop app', desktopFlag === true);

    // ── Case 1: the target is ALREADY open ────────────────────────────────
    say('opening the music window');
    const music = windows.open('music');
    await settled(music, 'music');
    say('music window settled at ' + music.webContents.getURL());
    const before = appWindows().length;

    const nav1 = watchNavigation(opener);
    await follow(opener, { href: '/music.html', window: 'rpg-music' });
    nav1.stop();

    const afterReuse = appWindows().length;
    check('target already open: no extra window is created',
      afterReuse === before, `${before} -> ${afterReuse}`);
    check('target already open: the existing window is focused',
      !music.isDestroyed() && music.isFocused());
    check('target already open: the asking window did NOT navigate',
      nav1.seen.length === 0, nav1.seen.join(', ') || 'no navigation');

    // ── Case 2: the target is NOT open ────────────────────────────────────
    music.destroy();
    await wait(300);
    const beforeNew = appWindows().length;

    const nav2 = watchNavigation(opener);
    await follow(opener, { href: '/music.html', window: 'rpg-music' });
    await wait(500);
    nav2.stop();

    const afterNew = appWindows().length;
    check('target not open: a new window IS created',
      afterNew === beforeNew + 1, `${beforeNew} -> ${afterNew}`);
    check('target not open: the asking window still did NOT navigate',
      nav2.seen.length === 0, nav2.seen.join(', ') || 'no navigation');

    // ── Case 3: reusing the window that case 2 just opened ────────────────
    const beforeSecond = appWindows().length;
    await follow(opener, { href: '/music.html', window: 'rpg-music' });
    const afterSecond = appWindows().length;
    check('a named window opened by the page is reused too',
      afterSecond === beforeSecond, `${beforeSecond} -> ${afterSecond}`);
  } catch (err) {
    check('harness ran without throwing', false, err && err.stack);
  }

  const failed = results.filter((r) => !r.pass);
  say(`${results.length - failed.length}/${results.length} checks passed`);
  say(failed.length ? 'RESULT: FAIL' : 'RESULT: PASS');
  app.exit(failed.length ? 1 : 0);
});
