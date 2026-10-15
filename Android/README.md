# RPG Console for Android

A small Android app for two-screen handhelds (built for the AYN Thor). One icon
opens the **map** on the main (top) screen and the **info panel** on the second
(bottom) screen: the same `/console/table-console.html` and
`/console/table-secondary.html` pages as the browser console, each in its own
full-screen WebView. It replaces installing the two pages as web apps, which
Chrome refuses while another app from the same site is installed.

## What the app adds over the browser

- **Both screens from one icon.** `LaunchActivity` opens `MapActivity` on the
  main display and `PanelActivity` on the second one (`setLaunchDisplayId`),
  each in its own task. On a one-screen device only the map opens; the Back
  menu offers the panel on the same screen.
- **The controller, read natively.** Both screens hand controller keys and stick
  movement to `NativePad`, which keeps one standard-layout gamepad and gives it
  to the map page as `window.__rpgNativePad`. `js/console/console-gamepad.js`
  reads it like any other pad, so the button table, repeats and the button
  remapping in the panel's More tab work unchanged, whichever screen was
  touched last.
- **The map's "Open info panel"** calls `RpgNative.openPanel()` and opens the
  panel on the bottom screen instead of a browser window.
- **Back** on either screen opens the app menu: Reload, Server address, Open
  info panel, Check for updates, Exit.
- Screens stay on, system bars are hidden (swipe to show), file pickers work for
  portraits, chat pictures and handouts, and links to other sites open in the
  browser.

Both screens share the app's cookies (the campaign) and localStorage (button
layout, display template, the remembered login). Logging in on one logs in the
other.

## One screen

On a device with one screen the icon opens the whole RPG Play app (`AppActivity`,
the server's `/`) instead of the console screens: campaigns, sheet, table and the
rest, as in a browser. Back goes back a page, and opens the app menu on the first.

## Logging in

With both console screens open only the top one shows the login form
(`RpgNative.isLoginScreen()`); the bottom one waits and follows.

A login in the app is **remembered**: the login forms ask the server for a session
with no fixed end (`remember: true`; it lapses after 90 days unused, and the super
admin can end it from the maintenance page), and the app keeps the pages'
sessionStorage login in localStorage (`REMEMBER_JS` in `ScreenActivity.kt`, run
before each page's own scripts), so it survives closing the app. Logging out, or
the server ending the session, removes it.

## Updates

On start the app reads `<server>/downloads/rpg-console.json`
(`{versionCode, versionName, url, sha256}`, written by `build.sh`). When it names a
newer `versionCode`, the app offers it, downloads the APK, checks its SHA-256 and
hands it to Android's installer (`Updater.kt`). Android always shows its own
"Update" screen for a sideloaded app, and the first time asks to allow installs
from RPG Console. Back menu → **Check for updates** checks on demand.

To publish a version: raise `versionCode` (and `versionName`) in
`app/build.gradle.kts`, run `./build.sh`, then upload `dist/rpg-console.apk` and
`dist/rpg-console.json` to `public/downloads/` on the server.

## Server address

Defaults to `https://dnd.kimse.me`. Change it from the Back menu, e.g. to a
local dev server such as `http://192.168.1.20:3000` (plain http is allowed).

## Building

Everything builds inside Docker; nothing is installed on the machine.

```bash
./make-keystore.sh   # once: the signing key (keystore/ + keystore.properties)
./build.sh           # every build -> dist/rpg-console.apk
```

The first build makes the `rpg-console-android:1` image (JDK 17, Android SDK
platform 34, build-tools 34.0.0, Gradle 8.7; about 2 GB) and fills the Gradle
cache in `.gradle-home/`.

**Keep the signing key.** `keystore/` and `keystore.properties` are outside git.
Android only installs an update over the app when it is signed with the same
key, so copy both to the other dev machine and keep a backup. With a new key the
old app has to be uninstalled first.

## Installing on the Thor

Copy `dist/rpg-console.apk` to the device (USB, cloud drive, or a download link)
and open it; allow installing from that source when Android asks. To update,
install the new APK over the old one.

## Debugging

The WebViews can be inspected from a PC: connect the Thor over USB with USB
debugging on and open `chrome://inspect` in Chrome. The app's user agent ends in
`RpgConsoleApp/<version>`, which the maintenance page shows.
