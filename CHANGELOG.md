# Changelog

All notable changes to RPG Play.

## How releases are numbered

This project has no semantic version. The release marker is **`FRONTEND_VERSION`** in
`Application/server.js`, which the server injects as `?v=N` into every `src` and `href`
at request time, and which must always equal the `CACHE` version in
`Application/public/sw.js`. Bumping the pair is what actually delivers a change to a
browser, so a bump *is* a release, and each heading below is the version a user ends up
running.

Frontend versioning arrived at **v29** (2026-05-17). Everything before that is grouped
under [Before frontend versioning](#before-frontend-versioning--2026-04-04--2026-05-14).
Some entries below cover a range of versions: incremental bumps made while one feature
was being finished are folded into the release they belong to.

Backend-only work that shipped without a frontend bump is listed under the release it
went out with, marked *(no frontend bump)*.

---

## [226] — 2026-09-11 — A maths problem on every login, and real login sessions

Every form that asks for a password now also asks a small sum, drawn as a
picture. And logging in now gives the browser a session key: your password is no
longer kept in the browser or sent with every click, so the login form is the only
place a password is ever checked — behind the sum and a lockout.

**Everyone logs in once more after this update.** Tabs that were open before it
still hold the old password, which no longer opens anything; they go to the login
page by themselves.

- **Maths captcha** on every password form: the login page, the campaign picker
  (log in, create, settings, delete), the three console screens, the DM panel,
  Treasury, Monsters, Map Prep, Calendar, Playlists, the maintenance page, the
  Stories pages, the AI DM and the sheet's unlock screen. One sum per attempt; a
  wrong answer brings a new one. Built in-house — no captcha service, nothing new
  installed.
- **Lockout.** Five wrong passwords for one account from one address lock it for
  a minute, doubling each time up to 30 minutes; one player mistyping does not
  lock out the rest of the table. 25 wrong from one address, across accounts,
  lock that address.
- **The DM is told** when one account collects five wrong passwords, and when a
  character's password is set, changed or removed.
- **Sessions** last a day unused and a week at most. Logging out ends the session
  on the server too. Changing a character's password logs that character out
  everywhere else; changing the DM password logs every DM session out.
- Choosing the first password for an unclaimed character follows straight on from
  the login form's sum — it can no longer be done by a script.
- The two console screens share a login only when they run on the **same
  device**; a screen on another device logs in on its own. The old way passed the
  whole session through a relay anyone could listen to.
- **Maintenance page:** the admin password plus the sum, and a new **Login
  activity** list covering every campaign for 30 days.
- *(no frontend bump)* Server hardening in the same release: security headers on
  every response; anonymous requests limited to 1 MB (uploads by a logged-in user
  still up to 200 MB); password checks no longer freeze the server while they
  run; **no built-in admin password** — without `MASTER_PASSWORD` in `.env` the
  admin features are switched off; the campaign cookie is marked Secure over
  HTTPS.

---

## [225] — 2026-09-10 — A player can change their own password again

Opening Set Password while signed in as a character showed only the new-password
box, with no way to enter the current one — so the change was always refused. It
worked correctly for the DM, which is the tell: only the DM path recorded whether
a character already had a password, so for a player that fact was simply unknown
and the modal assumed there was none. The rejection then focused a field that was
not on screen.

A character session now looks that up for itself, so the modal asks for the current
password and the change goes through.

---

## [224] — 2026-09-10 — Initiative tracker and monster table off the DM panel

The DM panel no longer carries the Initiative Tracker card or the Monsters stat
table. Both duplicated what the table screen already does, which is where combat is
actually run; the monster table existed mainly for its "+ Init" button, and
monsters are still managed on the Monsters page.

The panel now goes straight from the navigation cards to Share Media to Chat and
the chat log. Nothing else moved.

---

## [223] — 2026-09-10 — Both backup archives follow the ticked sections

The images archive used to ignore the section ticks and always take every file in
the campaign. Now both downloads follow the same selection, so a records archive
and an images archive taken from one set of ticks describe exactly the same thing —
and backing up one section no longer means downloading all the media.

On a real campaign: ticking Waiting screens and Handouts gives 833 B of records and
482 KB of images, where the images archive was previously 270 MB regardless.
Sections that have no files of their own (Chat log is text; its pictures belong to
Chat media) simply contribute nothing.

---

## [222] — 2026-09-10 — A parked table no longer blanks everyone's map; backups cover the rest of the campaign

**The map that would not load**

Loading a prepared map to the table showed nothing, while the same map displayed
fine in Map Prep. The cause was not the map: a campaign parked on a waiting screen
closed the table-map file for **every** campaign, not just its own. Every campaign
wrote to one shared `table-map.<ext>`, so the guard that hides a parked table's map
could not tell whose request it was and had to refuse them all.

Each campaign's table map now has its own file, and the guard refuses only the
campaign that is actually parked. Existing maps are moved to their own copy on
first start. This also settles two older faults in the same place: two campaigns
could overwrite each other's table map, and deleting one campaign's map deleted
the other's file.

**Uploads are now filed per campaign**

New uploads go to `uploads/<campaign>/…` instead of one shared folder. Existing
files are left exactly where they are and keep working — nothing needs moving.

Deleting a campaign removes its databases and **keeps its uploaded images and
audio**. Those are the part that cannot be regenerated; an unwanted folder is easy
to remove by hand, a deleted one is not.

**Six more sections can be backed up**

The backup covered characters, monsters, treasury and maps. It now also covers:

- **Waiting screens** — the park pages, their captions and images
- **Handouts** — prompts, both reveals with their images, and who has seen what
- **Events** — the event log, the calendar, and the weather history
- **Music** — playlists and the sound library, with the audio in the media archive
- **Chat log** — the message history
- **Treasury requests** — pending player claims, restored with the treasury

**Restoring a map no longer loses its tokens**

Prepared tokens were missing from the restore's insert, so restoring a maps backup
silently dropped every token placed on every prepared map. Verified fixed against a
real campaign: 4, 2 and 13 tokens restored where all were previously lost.

**Also**
- Test suite 1003 → 1025 across 36 files.

---

## [219] — 2026-09-10 — Backup modal shows only the archives and the raw DB

The per-part JSON download is gone from the backup modal. It was superseded by the
records archive in the previous release and only made the dialog ambiguous — two
ways to take the same backup, one of which is the memory-hungry one.

The modal now offers three downloads and nothing else: **Records** (the ticked
sections, as one `.tar.gz`), **Images**, and **Raw Database Files**. The section
checkboxes now clearly belong to the records archive, and the raw-DB note points at
the images archive as its companion rather than saying media is missing.

The `GET /api/admin/backup?part=` endpoint is still served, and Import still
restores the `.json` files it produces — backups taken before the archives existed
keep working exactly as they did.

---

## [218] — 2026-09-10 — Backups that stream, in two archives

**Why downloading maps could kill the server**

The maps backup built one JSON object containing every image as base64, entirely
in memory, before sending a byte. On a real campaign that was 47 MB of images
becoming 64 MB of base64 inside an 80 MB JSON string — held several times over
between the array, `JSON.stringify` and the socket. Measured peak memory: **37 MB
→ 222 MB**. A server with a smaller heap than the dev machine simply dies.

Two things made it worse than it looked. The maps part quietly included **every
image ever posted in chat** (45 of 57 media rows), so it grew without bound. And
older character media is stored as a `data:` URL *inside the database column* —
another 32 MB of base64 that was being copied straight through.

**The new download: two archives, built and streamed on the server**

- **Records** (`.tar.gz`) — the selected sections as one JSON file each, with no
  images inside. Each part is written out incrementally, so no whole part is ever
  assembled in memory. For the campaign above this is **83 KB**, down from ~136 MB
  across the old per-part files.
- **Images** (`.tar.gz`) — every picture, portrait, map and shared file, each as a
  real file copied through as raw bytes. No base64 anywhere, so it is a third
  smaller than the equivalent JSON, and the records archive stays tiny.

Peak memory for the whole cycle now: **40 MB** for records, **74 MB** for images
(against 222 MB before), and **51 MB** to restore a 106 MB archive.

**Restoring**

Import accepts either archive — drop the `.tar.gz` in and the server works out
which it is from the entries themselves. The upload is consumed as a stream and
image bytes go straight to disk, so nothing large is buffered on either side.
Restoring both archives reproduces a campaign exactly: verified table by table
against the source, every row matching.

Restoring an archive also migrates legacy inline `data:` images into real files,
which shrinks the database.

**Also**
- **Chat media is now its own backup section**, unticked by default, instead of
  riding along inside Maps. A maps backup is small and fast again.
- The existing per-part JSON download and JSON import are unchanged and still
  work, so files you already have keep restoring exactly as before.
- Backups are named after the campaign they came from.
- Test suite 960 → 977 across 34 files, including a round-trip test that pins the
  tar writer and reader against each other across split chunk boundaries.

**Still outstanding:** the raw SQLite `.tar.gz` remains database-only — the images
archive is now the companion to it, but the two are separate downloads. Map export
from the Map Prep screen still builds the image in browser memory
(`goals/fix_map_export_memory.md`).

---

## [217] — 2026-09-10 — Backup, export and import repairs

An audit of every backup/export/import path found six ways data was being lost or
misreported. All six are fixed. No file format changed: everything exported before
this release still imports, and the new fields are additive.

**The raw database backup was the wrong database entirely**
- `/api/admin/db-backup` read the SQLite files from the application folder — the
  location they lived in *before* campaigns became multi-tenant. Every campaign
  therefore downloaded the same untouched copy of the original single-tenant
  database, byte-identical no matter which campaign you were in, and weeks stale.
- Measured against the live data at the time: 23 tables instead of 29 (missing
  handouts, handout recipients, treasury requests, notifications, notification
  recipients and waiting screens outright) and 32 treasury rows instead of 34.
- It now reads the requesting campaign's own directory, and the download is named
  after the campaign so two campaigns' backups cannot be confused.

**A monster exported from the app could not be imported back**
- Export wraps the stored row; import assumed every entry was a raw stat block, so
  re-importing an export stored the wrapper *as* the stat block. The monster came
  back with its name and CR but no actions, no HP, no AC — the real stat block
  stranded inside a nested field nothing reads.
- Import now recognises both shapes. Portraits survive too (they were dropped
  before), written under the new monster's own id so deleting either copy cannot
  take the other's image with it.

**Imported loot vanished**
- `/api/loot/import` wrote to the retired `loot_items` table, which is only read by
  the one-time migration that folds it into the treasury — and that migration only
  runs while the treasury is still empty. In any campaign that had ever held
  treasury data, imported loot was invisible on the Treasury screen and absent from
  every backup. It now imports into the treasury directly.

**Character XML**
- Speed grew on every export/import round trip. The export wrote only the computed
  total, so re-importing treated that total as the base and added the bonus again:
  a 30 ft character with a +10 bonus went 40 → 50 → 60 → 70 across three cycles.
  The base is now exported in its own right; older files still fall back to the
  previous behaviour.
- An item's **value** was dropped entirely on export. A non-armour item also came
  back marked as light armour, and a weapon's magic bonus came back as text rather
  than a number.

**Prepared maps**
- Exporting a map and importing it discarded every placed token. Tokens now travel
  with the map, hidden ones included. A map file exported before this release
  imports exactly as it does today.

**Also**
- Test suite 925 → 960 across 33 files. The new import tests were checked against
  the old code first: 9 of the 26 fail there, so they genuinely pin the bugs.

---

## [216] — 2026-09-10 — Multiple damage types on one attack

**A weapon can now deal several typed damages, rolled together with one click**
- The Damage/Type field takes a comma-separated list — `1d6 piercing, 2d8 fire`. One
  click rolls every part, and each part's dice, type and subtotal are reported
  separately alongside the grand total.
- A part with no type is shown as **generic**, so an untyped roll still lines up with
  the typed ones instead of being a special case.
- Flat amounts are allowed as a part (`1d4 fire, 5 cold`), as are per-part modifiers
  (`1d8+3 slashing, 1d6 radiant`).
- The 3D dice overlay grew a grouped mode: one column per damage type, each captioned
  with the type and its own subtotal, with the grand total underneath. Mixed dice
  (a d6 next to two d8s) roll in a single overlay rather than several in a row.
- The ability and magic bonus lands on the **first** part only — a flaming sword adds
  Strength to its slashing, not to its fire.

**In chat**
- `/dmg 1d6 piercing, 2d8 fire` (alias `/damage`) rolls typed damage from the chat box
  on the table, the character sheet and the DM panel.
- `/r` also accepts a comma-separated list — `/r 1d6 piercing, 2d8 fire`. Its existing
  behaviour is untouched: trailing words after a single dice expression are still a
  label, so `/r 2d6 Sneak Attack` labels the roll exactly as before.
- Roll messages show the per-type breakdown as its own row per part. Messages logged
  before this release render exactly as they did.

**Monster stat blocks**
- An attack reading "…piercing damage **plus** 3 (1d6) fire damage" now rolls both.
  Only the first `{@damage}` tag was ever read, so the second type was silently
  dropped on every multi-type monster attack.
- Versatile weapons are excluded from that: a second tag introduced by "or" is the
  two-handed *alternative*, not extra damage, and must not stack.

**Also**
- `usedIdx` is now relayed by `/api/dice/broadcast`. The clients already read it, but
  the server never passed it on, so advantage/disadvantage rolls did not dim the
  unused die on anyone's screen but the roller's.
- `dm.html` now loads the shared `dice-engine.js` instead of dm.js keeping its own
  copy of `parseDiceCommand`.
- Test suite 866 → 925 across 32 files.

---

## [215] — 2026-09-10 — One modal style everywhere, DM logout, stacked map layers

**Modal chrome is now defined once, in `base.css`**
- `.ct` — the modal title — had drifted into three different looks: the display-font
  header on dm/index, a near-white `--bone` bar with dark centred 11px system-font text
  on loot/merchant/monsters/treasury, and a `--slate-hi` bar that still carried `--ink`
  text on the table screen, which was dark navy on dark navy and barely legible.
- Modal borders had drifted the same way: a 1px `--bone` hairline (near-white) ringing
  a dark panel on six stylesheets and seven inline styles, against `--rule-hi`
  elsewhere. `--rule-hi` is the token that means "the edge of something raised", so
  that is what a modal gets. The map context menu had its own hardcoded blue
  `rgba(140,158,255,.4)` border; it uses the token now too. One inline border pointed
  at `--bdr`, which is not a defined token at all — that declaration was being dropped
  entirely by the browser.
- Page stylesheets now set only a modal's *size*; colour and type come from `base.css`.
  Ad-hoc header classes (`.modal-hdr`, `.dlg-hdr`, `.ho-mo-hdr`, `.cal-modal-title`)
  are styled alongside `.ct`, so a dialog written on any page starts out matching.
  `.ct-row` adds the flex row for headers carrying a close button; `.lt-modal-title` is
  for a title inside an already-padded box, which must not grow its own bar.

**DM panel — Logout**
- The DM panel had no way out; the button now sits beside Refresh and clears every key
  a session is rebuilt from (`rpgSession`, `dmMasterPw`, `tableMasterPw` — the
  auto-auth block reads the first and falls back to the second, so leaving either
  behind would have unlocked the gate again on the next load), then returns to the
  campaign picker.

**Table — overlapping fog regions and hidden items**
- Clicking the map as DM stopped at the *first* fog region it hit and never looked at
  hidden items once one matched, so anything underneath was unreachable. Overlap is the
  normal case — a chest inside a fogged room, nested regions, a door on a region
  boundary — and on a real map three layers on one cell is common.
- Every layer under the cursor is now listed, each with its own reveal/hide switch,
  ordered by what is painted on top (the items canvas sits above the fog canvas, and
  within each, later entries draw over earlier ones). A single layer keeps exactly the
  menu it had; only a genuine stack gets the count heading and dividers, and a tall
  stack scrolls rather than running off the screen.

## [214] — 2026-09-10 — My sheet fixes, Map & Tokens retired, handout dialogs

Seven fixes reported after the lamplit redesign went live.

*(There is no 213. It was bumped mid-session and never deployed anywhere; the work
went out as 214 instead, so no user ever ran a 213.)*

**Table — "My sheet"**
- The button was crushed into the icon rail's fixed 38px square, so its label wrapped
  to two lines and the button stood 49px tall against its 32px neighbours. The rail
  now uses `min-width`, so labelled buttons (My sheet, Move, Undo, Multi) size to
  their text.
- Opening the sheet during combat used to close it again a moment later: it clears the
  selected token, and every real-time tick (initiative, active-token HP, character
  updates) then fell through to the active-turn token and took the panel over. A
  deliberately opened own-sheet is now only replaced by a deliberate pick — a token
  click or an initiative row.
- The sheet showed no HP, AC or Speed at all — the stats row was hidden wholesale
  because it is normally filled from a token. It is now filled from the character
  instead (`qroll` returns `hpcur`/`hpmax`/`hptemp`/`speed`); only the parts that
  genuinely need a token — conditions, damage/heal — stay hidden.
- Wearing or removing an item did not update anything. The save fired and its result
  was thrown away, so AC, speed, initiative and the item-derived saves/skills kept
  their old values, and the real-time refresh could not see the tokenless sheet at
  all. The sheet is now refetched after each change, and a save that fails says so
  instead of leaving the tick showing a change the server refused.

**Table — Map & Tokens modal removed**
- The toolbar's map button and its modal are gone. Fog regions and hidden items are
  reachable by clicking them on the map, loading a prepared map lives on the
  prepare-map screen and the console, and the active turn and party HP are in the
  initiative tracker.
- **Clear All Tokens** moved into the Add Token modal, set apart on the left.
- The movement-remaining readout went with the modal; the movement limit itself still
  applies when dragging a token.

**Table — DM can see the players' screen**
- While the table is parked, the DM's banner has a new **See their screen** button
  beside "Bring them back", which drops the waiting screen over their own map so they
  can check the image and caption, and switches back with **Back to map**. It is local
  to that browser: nothing is sent to the server, so what the players are looking at
  does not change while the DM checks it, and "Bring them back" stays reachable
  throughout.

**Table — panel toggle icons**
- The two top-bar panel toggles swapped their stroke chevron for a bare `◀` text
  character and the solid play triangle when pressed — a leftover from the
  emoji-to-icon pass, which sat differently in the toolbar and ignored `currentColor`.
  Both now stay in the chevron family and point the way the panel will move, and carry
  `aria-expanded` plus a title saying what pressing them does.

**Handouts — real dialogs instead of browser ones**
- "New Handout" and "Hand Out" did nothing on the desktop client. Electron does not
  implement `prompt()` — it returns `undefined`, which the code then called `.trim()`
  on, throwing before anything happened.
- Every browser dialog on the page is now an in-page modal matching the table screen,
  and the character picker is a tick list with All / None instead of typing numbers
  into a prompt. Characters who already hold the handout are shown, marked.

## [212] — 2026-09-10 — The lamplit redesign

A full visual and interaction pass over the whole app, developed on `redesign/lamplit`
over 21 commits and merged to `main`. Covers v152–212.

**Design system**
- `css/tokens.css` is now the single source of truth for colour and type. It had been
  the same `:root` block copy-pasted into ten files, already drifted apart
- `css/base.css` holds the primitives and the focus ring, scoped to `html.lamplit`
- `css/app-shell.css` is one full-height DM-tool layout, now shared by all five tools
  (monsters, events, prepare-map, playlists, treasury)
- Fraunces and Atkinson Hyperlegible Next are self-hosted as four variable WOFF2 files
  (180 KB) so the PWA keeps its typography offline
- Repainted navy and gold; a palette change now means editing one file

**Icons**
- `js/lib/icons.js` injects an SVG sprite of 65 stroke icons
- Emoji-as-iconography replaced across 20 pages, the console PWA and 28 JS files. Seven
  deliberate glyphs remain — weather pictograms, the inspiration star, the loot-request
  hand — plus stored chat history, which is user data and was left alone

**Interaction**
- The phone layout existed only as `body.theme-mobile` behind a theme dropdown; it is now
  a real media query. The sheet had been overflowing 1240 px inside a 375 px viewport
- Eleven tab strips were `<div onclick>` with no `role` or `aria-` attributes anywhere on
  the page. They are now a WAI-ARIA tablist
- A persistent vitals bar with damage/heal; HP used to live inside the Main tab only
- Ability-score hierarchy un-inverted, and touch targets sized for a thumb

**Fixed**
- Five separate bugs traced to one cause: a surface that never loaded `base.css`. The
  table pop-outs (built with `document.write`), the whole console PWA, `music.html`
  painting a white canvas inside the table modal, `login.html` rendering an icon at the
  SVG default 300×150, and the desktop app's own screens. `color-scheme` and `.lt-icon`
  moved into `tokens.css`, the one file every page links
- `base.css` scoped its element rules as `html.lamplit <el>`, which outranks any plain
  class in a page stylesheet. Its 21 element rules are now wrapped in `:where()`, which
  contributes no specificity
- The table's Music Player modal was a fixed 600 px box

**Documentation**
- README rebuilt with a screenshot for every page, technology badges, and the desktop
  client given its own block at the top

## [151] — 2026-09-09 — Waiting screens

Park the table on a full-bleed image between scenes. Players get the image over the map
and the left panel but keep their character panel, so they can still roll; the DM keeps
the map and carries on arranging it.

- Hiding is enforced **server-side**: while parked, a player's `GET /api/table` returns
  `hasMap:false`, no fog or hidden items, and only their own token
- `/api/table/map` used to redirect to a fixed static path that `express.static` would
  serve to anyone, so a guard on the API alone would have been cosmetic. A
  `parkedCampaigns` set gates that one static file, re-derived at boot so a restart
  mid-break cannot expose it
- A player whose character has no token on the map now still gets their sheet in the right
  panel, with their own portrait — reachable any time from a new **My sheet** button
- *(no frontend bump)* The per-process chat log became a map keyed by campaign. Latent
  rather than live: production runs the local SQLite backend, where chat was always
  campaign-isolated
- *(no frontend bump)* The InstantDB backend was retired — 240 `DB_PROVIDER` guards and
  318 calls removed across 21 files, −990 lines. That path had already decayed: handouts,
  notifications, weather, calendar events, drawings and prepared maps all answered 501 or
  empty there

## [147] — 2026-09-08 — Notifications

Covers v144–147.

- People are told what happened to them: loot handed out, handouts resolved, and the
  quieter half of the event stream
- Dice and chat notifications, and real Windows toast popups through the desktop client
- A music notification opens the player in its own window

## [143] — 2026-09-08 — Free loot is requested, not taken

Players ask for a free-loot item and the DM hands it out, instead of claiming it directly.

## [142] — 2026-09-08 — One music player page

- The modal, the pop-out window and the desktop app now share a single music player page
- *(no frontend bump)* Music playback became per campaign

## [141] — 2026-09-07 — The Windows desktop client

An Electron **thin client** that renders the pages the server already serves, so the web
app is unchanged and nothing needs redeploying when the desktop app changes.

- Multi-monitor windows, each remembering size, position, monitor, fullscreen and zoom
- Global hotkeys (`Ctrl+Alt+T/D/C/R`) that reach a window from another application
- Tray icon, application menu, per-window zoom, native Save dialogs
- First run validates the server address; self-signed certificates are trusted per host
  after an explicit prompt and pinned by fingerprint
- The login survives opening a second window; role-aware music shortcut; 9 MB trimmed
  off the build
- The app is offered as a download from the character sheet's nav menu — Windows only,
  and never from inside the desktop client itself

## [140] — 2026-09-05 — Handouts

Covers v136–140. A handout carries an optional prompt and two bodies: one read on a
successful skill check, one read instead on a failure.

- The check is **blind**. The player presses a neutral *Examine* button and never learns
  which skill was tested, the DC, or what they rolled. The roll happens on the server
  using the character's own modifier, so it cannot be forged
- Nothing reaches a player until the DM presses Success or Fail; the DC only pre-selects
  a suggestion
- A Handouts tab in the table's right panel runs the whole flow from the map
- One dialog hands a handout to any mix of characters and shows their checks arriving live
- A handout pops once; reloading the page no longer replays it

## [134] — 2026-09-05 — Multi-tenant campaigns

The server now hosts any number of campaigns, each a fully separate tenant with its own
DM password and its own set of SQLite files.

- Cross-campaign reads are impossible by construction: nothing filters on a `campaign_id`
  column, so there is no `WHERE` clause to forget — a request simply never holds a
  database handle that reaches another campaign
- `lib/request-context.js` resolves the campaign at property-access time through an
  `AsyncLocalStorage` store and a set of proxies, so roughly 200 existing route handlers,
  ~130 broadcasts and ~103 auth calls became campaign-scoped **without being edited**
- `/` is now the campaign picker; the campaign cookie is why none of the 276 frontend
  `fetch()` calls needed changing
- `MASTER_PASSWORD` became the super-admin key: create and delete campaigns, unlock any
  campaign, and recover a lost DM password

## [133] — 2026-08-25 — Treasury

Loot and the shop merged into a single Treasury: one item list with a Hidden / Free Loot /
Shop switch, item images, and unidentified items that show as such to players.

## [129] — 2026-06-21 — Map prep overhaul

Move tool, token portraits, multi-select recolour and undo on the prepare-map screen.

Also in this period, without a recorded frontend bump:

- **2026-07-04** — Playlists screen redesigned as master-detail: track reorder, bulk add,
  multi-upload, and a table soundboard

## [125] — 2026-06-20 — Maintenance page

A DM-password-gated, unlisted `/maintenance.html` listing every connected real-time
client: IP, identity, login time, current page, transport and user-agent.

- Client-supplied identity is spoofable, so the dashboard is informational, not an auth
  control. `X-Forwarded-For` is trusted only when `TRUST_PROXY` is set, and every field
  is length-capped and escaped

## [124] — 2026-06-20 — Field-level character save

Character saves became field-level, so two people editing the same sheet stop clobbering
each other.

## [123] — 2026-06-19 — Weather

A daily weather roller: temperature, wind and precipitation each get their own d20 against
configurable thresholds, with temperature swinging from a session baseline and
precipitation falling as snow below freezing. Results show as icons on the calendar grid
and in a table toolbar widget.

## [114–117] — 2026-06-19 — Item bonuses and the tabbed right panel

- Items can carry bonuses to saves, skills and ability checks
- The classic HUD was retired; the table's right panel became tabbed with combat sub-tabs
- Adjust HP reworked: quick buttons set the value, Dmg/Heal apply it
- Fixed pop-out CSS going stale, and index versioning at `/`

## [108–113] — 2026-06-15 — Player calendar journals

Players author their own dated calendar entries, shared by default or kept private to
themselves and the DM, each able to carry media attachments.

## [103–107] — 2026-06-09 → 06-14 — Raw database backup

- One-click download of every SQLite database as a single streamed `.tar.gz`
- Clicking a combatant in the initiative list loads them into the right panel,
  permission-gated
- Fixed apostrophes breaking inline handlers, via an `escJs()` escaper

## [94–102] — 2026-06-05 → 06-08 — Actions, 3D dice and pop-outs

- **Actions tab** aggregating weapon attacks, action-flagged spells and freeform custom
  actions with limited-use tracking and rest recharge
- Flat d20 and d10 replaced with 3D CSS dice — an icosahedron and a pentagonal
  trapezohedron
- Table panels pop out into separate browser windows; the real DOM node moves across
  windows and keeps updating over SSE
- Group checks and saves: select several tokens, each rolls by its own bonus, results post
  as one combined chat message
- An **Ask** dice mode, select merged into the move tool, and equipment wear/unwear in the
  right panel recomputing AC, initiative, speed and spell DC
- Character XML export/import round-trips actions and spell action/duration fields
- The service worker went **network-first for HTML**, cache-first for versioned static
  assets. Cache-first HTML had been serving a stale app shell to mobile Chrome PWAs,
  hiding newly added pages

## [76–91] — 2026-06-04 → 06-05 — The initiative rewrite

- Initiative rebuilt on a clean API after a run of bugs: wrong HP during combat, stale
  player portraits and AC, and cross-contamination between entries
- Draw tool gained a select mode — edit, move, reshape and delete existing shapes
- Real-time AC sync between the sheet and the table
- Token drag activation cut from 500 ms to 100 ms
- Chat sender identity fixed: players post as their own character, the DM as the selected
  token
- Monster types hidden from the sheet's initiative list; identifier only

## [63–68] — 2026-06-03 — Table screen UI overhaul

Panel auto-hide, character sheet redesign, click-to-reveal map fog, monster search in the
add-token modal, and a floating zoom widget. The modern HUD became the default.

## [53–56] — 2026-06-02 — Chat images and prepared tokens

- Drag-and-drop image sharing in chat, with upload progress, for every user
- Tokens can be placed, given portraits, hidden and edited during map prep

## [46–51] — 2026-05-29 → 05-30 — AI Dungeon Master

A text-adventure DM for solo play in the Forgotten Realms.

- Runs against LM Studio, OpenRouter or OpenAI, with dice rolling and scenarios
- Mobile-first layout, a retry system with a Stop button, and back/continue on ended
  sessions
- Turkish language support, stored per session and injected into the system prompt
- A prompt-quality overhaul covering narrative craft, NPC depth, pacing and combat

## [29–45] — 2026-05-17 → 05-24 — Frontend versioning, and the initiative overhaul

- **`FRONTEND_VERSION` introduced** (v29) — the cache-busting scheme this changelog is
  numbered by
- Initiative overhaul, monster initiative and bulk selection
- Monster vulnerability and initiative-bonus fields; per-token portrait upload; real-time
  monster updates
- AC and Speed bonus fields; the Fly condition and three-letter condition abbreviations
- Clicking a token name selects it and pans the map there
- The music pop-out player, and a fix for dismiss-on-load double play
- *(no frontend bump)* The Vitest suite was built from scratch — 449 tests across 16 files
  at the time, covering the table and character-sheet screens

---

## Before frontend versioning — 2026-04-04 → 2026-05-14

No cache-busting scheme existed yet, so these are grouped by date rather than version.

### 2026-05-13 → 05-14 — Stories, and the server split
- `server.js` split into semantic route modules
- The comic-style story system: dashboard, panel builder and viewer, with a character cast
  multiselect by portrait and a password gate accepting the DM or any character password
- Fixed `white-space: pre-wrap` on monster stat blocks and chat

### 2026-05-04 → 05-10 — Login, PWA and music
- Login and permissions: per-character passwords, a DM password, and auth guards
- The console PWA for phone and tablet: session sync, an Actions tab, DM controls, a D-pad
  for moving the selected token, and safe-area padding for notched phones
- Monster actions panel with action-to-chat
- Music: playlist redesign, now-playing bar, seek, duration, loop modes, position sync,
  and a 50 MB upload limit with a progress bar
- Chat bottom bar, text formatting fixes and local volume control

### 2026-04-26 → 04-27 — The module split
- `table.js` (2940 lines) split into 12 focused modules under `js/table/`
- `index.js` split into 14 modules under `js/index/`
- Shared code extracted into `js/lib/` — lightbox, realtime connection and D&D constants —
  removing the duplication between the two screens
- Monster dice rolling, an info modal, initiative advantage/disadvantage, and editable
  token identifiers
- Clickable column sort on the spell table; videos open in the lightbox
- DM per-message chat delete

### 2026-04-20 → 04-22 — Conditions, concurrency and the calendar
- D&D 5e status conditions on tokens, shown in the HP tracker with 5e.tools links; any
  player can toggle conditions on their own token
- Token operations serialised through an operation queue, in four phases, to stop races
  under concurrent play: re-entry guards, request serialisation, drag cancellation on
  remote removal, and selection clearing when the selected token disappears
- Players blocked from moving monster tokens by arrow key or direct API call
- The Forgotten Realms Calendar of Harptos, with Roll of Years names for 1501–1600 DR
- Performance pass and the multi-size image system: every upload generates an 80×80
  `_thumb.webp` and a 500 px `_medium.webp`
- Dice animation on the character sheet, and text chat on every screen

### 2026-04-12 → 04-18 — Real-time drawing and HTTPS
- Real-time drawing tool on the table
- Monster names hidden from players — identifier only
- HTTPS with HTTP-to-HTTPS redirect and a certificate renewal script
- Backup/restore reworked as selective per-section, non-destructive import
- Initiative fixes: orphaned entries, click-to-view, auto-advance, previous turn
- Shop item tagging

### 2026-04-04 — Initial release
- The D&D 5e character sheet and shared virtual table
- Image and media storage moved from database blobs to the filesystem
- Map prep with hidden-item cloning and positional placement
- The Events screen for DM campaign tracking

---

## Keeping this file current

`CHANGELOG.md` is updated **as part of every release**, alongside the paired
`FRONTEND_VERSION` / `sw.js CACHE` bump — see the frontend release process in
`CLAUDE.md`. A release that changes what a user sees but leaves no entry here is an
incomplete release.

Add the new version at the top, dated, with a one-line summary of what the release is for
and bullets grouped the way the entries above are. Backend-only changes that ship in the
same deploy belong under that release, marked *(no frontend bump)*.
