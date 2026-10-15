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
  info panel, Switch campaign, Maintenance, Check for updates, Exit.
- **Maintenance** opens the super admin's maintenance page in a window of its
  own (`MaintenanceActivity`) on the same screen. Its menu has **Back to
  campaign**, which sends it behind the campaign screens without closing it, so
  switching back and forth keeps both logged in. Reload in either one leaves
  the other alone. The super admin login is also kept on the device (see
  Logging in), so the page logs in by itself after a restart while the server
  still has that session.
- **Switch campaign** goes back to choosing a campaign: the campaign list in the
  whole app; on the console screens it logs both screens out of the campaign and
  shows the login form with its campaign choice (it calls
  `window.ConsoleLogin.logout()`). With a live super admin session either one
  offers **Enter as super admin**, no password.
- Screens stay on, system bars are hidden (swipe to show), file pickers work for
  portraits, chat pictures and handouts, and links to other sites open in the
  browser.

Both screens share the app's cookies (the campaign) and localStorage (button
layout, display template, the remembered login). Logging in on one logs in the
other.

## Closing

The screens are separate windows, but they close together: closing any one
(swiping it away in Recents, Exit in the menu) closes the others, removes them
from Recents and ends the app's process (`Screens.screenClosed`). "Back to
campaign" in the maintenance window only sends it behind, so it stays open.

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
the server ending the session, removes it. When the app starts with a remembered
login, the campaign list goes straight on into the campaign (`window.__rpgRestored`).

The super admin's maintenance login is kept the same way (`rpgAdminToken`), so the
maintenance page logs in by itself while the server still has that session (24
hours unused). With it, the campaign list and the console login offer to open any
campaign as its DM without the DM password; logging out of such a campaign leaves
the super admin logged in.

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

The default comes from the build: `server.properties` in this folder, one line
`defaultServer=https://your.server`. It is outside git, like the signing key, so
no server address is kept in the repository. A build without it has no default
and asks for the address on first start. Change it any time from the Back menu,
e.g. to a local dev server such as `http://192.168.1.20:3000` (plain http is
allowed).

## Building

Everything builds inside Docker; nothing is installed on the machine.

```bash
./make-keystore.sh   # once: the signing key (keystore/ + keystore.properties)
echo 'defaultServer=https://your.server' > server.properties   # once: the default server
./build.sh           # every build -> dist/rpg-console.apk + dist/rpg-console.json
```

The first build makes the `rpg-console-android:1` image (JDK 17, Android SDK
platform 34, build-tools 34.0.0, Gradle 8.7; about 2 GB) and fills the Gradle
cache in `.gradle-home/`.

**Keep the signing key.** `keystore/` and `keystore.properties` are outside git
(so is `server.properties`; copy all three to the other dev machine).
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

## Versions

| App | versionCode | What changed |
|---|---|---|
| 1.0 | 1 | Both console screens from one icon, native controller, Back menu |
| 1.1 | 2 | Remembered login, one login form on two screens, the whole app on one screen, self-update |
| 1.2 | 3 | Maintenance window with Back to campaign |
| 1.3 | 4 | Switch campaign; the super admin login kept on the device |
| 1.4 | 5 | Closing any screen closes the app |

1.0 has no updater, so it is updated to 1.1 or later by installing the APK by hand once.
The server-side changes the app relies on shipped in web releases v297–v302 (see
CHANGELOG.md).

