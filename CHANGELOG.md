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

## [300] + Android app 1.3 — 2026-10-15 — Remembered login in the full app; super admin switches campaigns

- **Fixed: on a one-screen device the app forgot your login.** The campaign list has its own
  login form, which did not ask for a remembered login, and the app always opened on that list.
  Now every login form in the app asks for one, and when the app starts with a remembered login
  it goes straight into the campaign. Going back to the campaign list later still shows it.
- **The maintenance page logs you in by itself** while your super admin session is still open
  (it is kept for the browser tab, and in the app on the device; the server still ends it after
  24 hours unused). Lock ends it as before.
- **A super admin can open any campaign as its DM without the DM password**: "Open as super
  admin" on the campaign list's Dungeon Master tab, and "Enter as super admin" on the console's
  login form. Logging out of that campaign leaves the super admin session (and the maintenance
  page) logged in.
- **The app's Back menu has "Switch campaign"**: the campaign list in the full app; on the
  console screens it logs out of the campaign and shows the login form with its campaign choice.

## Android app 1.2 — 2026-10-15 — Switch between a campaign and the maintenance page *(no frontend bump)*

- **The app's Back menu has "Maintenance"**, which opens the super admin's maintenance page
  in its own window, and the maintenance window's menu has **"Back to campaign"**. Both stay
  open while you switch, so the campaign and the super admin login are kept on both sides.
  Installed by the app's own update on its next start.

## [299] — 2026-10-15 — The console app remembers your login, updates itself, and opens the whole app on one screen

- **In the Android app a login is remembered** until you log out, the super admin ends it
  (maintenance page → Active sessions, now marked *remembered*), the password changes, or
  it goes 90 days unused. Browsers keep the per-tab, 24-hour login. *(server: a session can
  now be "remembered", asked for only by the app's login forms; never for the super admin)*
- **With two screens, only the top one shows the login form.** The bottom screen says to log
  in on the top one and follows as soon as you do ("Log in here instead" if the top screen is
  not available).
- **On a one-screen device the app opens the whole RPG Play app** (campaigns, sheet, table…)
  instead of the console screens, and Back goes back a page there.
- **The app updates itself**: on start it checks `/downloads/rpg-console.json` and offers a
  newer version; one tap on Android's install screen updates it. Back menu → Check for updates.
- The maintenance page names the app's sessions "Console app · Android".
- A console screen whose session ends shows its own login form again instead of going to the
  main login page.

## [298] — 2026-10-15 — Live updates in the Android console app

- **Fixed: in the Android console app nothing live arrived**, so the DM's music
  buttons seemed to do nothing (the track only starts, and the panel only updates,
  when the server's music event comes back). The server names its live connection
  with an `https://` address; Chrome quietly turns that into `wss://`, but the
  app's WebView refuses it. Pages now always open it as `wss://` (or `ws://` over
  plain http), and a connection that cannot be opened is retried instead of
  silently given up.

## [297] — 2026-10-15 — An Android app for the two-screen console

- **New: the RPG Console Android app** (`Android/` in the repo) for two-screen
  handhelds such as the AYN Thor. One icon opens the map on the top screen and the
  info panel on the bottom one, so the two pages no longer have to be installed as
  web apps (Chrome refused the second while another app from the site was installed).
  The app reads the handheld's controller itself and gives it to the map, so the
  buttons work whichever screen was touched last; Back opens a menu with Reload,
  Server address, Open info panel and Exit. Installed by sideloading the APK.
- The console map's "Open info panel" opens the panel on the app's bottom screen when
  it runs inside the app, and the console's gamepad code also reads the app's
  controller. Nothing changes in a browser.

## [296] — 2026-10-15 — New portraits and waiting-screen changes show up live

- **A character's new portrait now appears on its tokens straight away**, on every
  screen. Uploading a portrait, choosing another picture as the portrait or deleting it
  updates every token of that character on the map. Before, the token kept the old
  picture until it was placed again - and since replacing a portrait deletes the old
  file, it often showed a broken image. A token the DM gave its own picture keeps it,
  and removing that picture now brings back the character's portrait (it used to leave
  the token blank).
- **A monster's new portrait reaches its tokens the same way**, and a hidden monster's
  token is no longer revealed to players by that update.
- **Replacing a waiting screen's image now shows the new one to players who are
  already looking at it.** The new image kept the old file name, so their pages kept
  the cached picture. The same was true of a token's own picture and a monster portrait;
  each replacement now gets a new file name.
- **The DM's waiting-screens page keeps up with changes made in another window or on
  another device**: new, renamed, re-pictured and deleted screens appear without a
  reload. It waits while you are typing in a field, so it never throws away your edit.

## [295] — 2026-10-15 — The maintenance page shows each client's template and UI size

- **Each connected client on the maintenance page now has a Template row**, e.g.
  "Metallic Chic · UI size 120%" or "Default · UI size 110% (chosen)". "Chosen" means the
  visitor picked that size; without it the size is the template's own. It updates
  while the client is connected: a page reports a change of template or size the
  moment it happens. Clients still on an older version show "not reported".
- *(server)* New `POST /api/realtime/display`. A page names its own connection by an
  id from its connection URL and must present that connection's session token, so
  nobody can relabel another visitor's connection. Display-only; it always answers 200.

## [293–294] — 2026-10-15 — Display templates on the console; the console login looks like the main one; the two screens install as two apps

- **The display templates and UI size now work on the console.** A palette button
  sits on the launcher, in the map screen's status line, in the info panel's More tab
  and on the login form. Each template recolours the console (ground, rows, text) and
  keeps its four colour meanings apart: focus, whose turn, hostile and health never
  come out looking alike. The map screen and the info panel follow one choice, change
  together, and keep it between launches. With no template the console keeps its black
  look, and a template keeps the console's own size unless a UI size is chosen.
- **The console login form now looks like the main login page**: the RPG Play mark,
  the panel, the gold Character / Dungeon Master switch and the gold Login button, with
  the screen's name and the campaign under the mark. On the Thor's short screens it
  still fits in two columns with the Login button showing.
- **The console launcher's app no longer claims the two screens.** Its manifest
  covered all of `/console/`, so on a two-screen handheld (AYN Thor) installing
  the map screen and the info panel kept landing on the same app. The launcher
  now covers only its own page, leaving the map screen (`d20`) and the info
  panel (`d20-companion`) to install as separate apps.

## [292] — 2026-10-15 — The right panel folds like the left; no "My sheet" button

- **The map screen's right panel folds to a strip** down the map's right edge,
  from its new Details header, and opens again from the strip, like the
  initiative panel. Selecting a token opens it; deselecting folds it instead of
  hiding it. View → Hide / Show right panel folds and opens it too.
- **Players open their own sheet by opening the right panel**, so the toolbar's
  "My sheet" button is gone.
- **The ✕ at the top of the right panel's sheet is gone** (fold it from its header
  instead), and the DM's edit-label and delete-token buttons now sit at the end
  of the name row instead of in a row of their own above it.
- **Names in the right panel wrap onto up to three lines** instead of being cut
  off after one, and for the DM a monster's type now sits on its own line under
  its identifier (it was in brackets after it).

---

## [289] — 2026-10-15 — The initiative panel is always there, and folds like the chat

- **The map screen's Initiative panel is always there now**, not only during
  combat. With no initiative it is folded to a thin "Initiative" strip down the
  map's left edge; opened, it says "There is no initiative yet. Roll for
  initiative."
- **It opens by itself when initiative is rolled**, and folds again when the
  tracker is cleared.
- **Click the Initiative header to fold it, the strip to open it**, the way the
  chat collapses. The initiative "!" shows on the strip too, and bulk edit opens
  the panel again. Your own choice is remembered per browser.
- **View → Hide / Show left panel** folds the panel to its strip and opens it
  again, like the header and the strip, instead of removing it completely.

---

## [286] — 2026-10-15 — UI size at the top of the template pop-up

- **UI size** is now the first row of the palette pop-up, above the templates, and
  stays in view while the template list scrolls.

---

## [285] — 2026-10-15 — Ten more display templates

- **Ten more templates** in the palette pop-up, from the next ten Visme website
  colour schemes: Lively and Inviting, Striking and Simple, Red and Lively, Artsy
  and Creative, Elegant Yet Approachable, Sleek and Futuristic, Innovative and
  Audacious, Texturized and Dynamic, Minimal Yet Warm and Vivid and Sharp. Five
  are light and five dark; like the first ten, they use 120% UI size unless
  changed and keep every text colour readable.

---

## [284] — 2026-10-15 — Headers stay on one row, with a ☰ menu on phones

- **On a phone, every page header stays on one row** at any UI size. Buttons that
  don't fit move into a **☰** menu at the end of the header, starting from the
  right. Selects, sliders and buttons that open their own pop-up stay in place.
- **The map toolbar and the character sheet's bar may use two rows on a phone**
  before anything moves into the menu.
- **The character sheet's "More" menu is gone.** Its items (Stories, Set password,
  Export, Desktop app, Log out, Delete) are buttons in the bar while they fit, and
  go into the ☰ menu when they don't, Delete first. This works at every width.
- **The map screen's toolbar never wraps onto a second row.** When it runs out of
  room it first shows icon-only buttons (Back, Move, Undo, Multi, My sheet; hover
  still names them), then hides the weather text and the campaign and user
  badges. After that a phone uses the ☰ menu, and a wider screen makes the
  toolbar itself a little smaller.
- **Map zoom floats over the map again**, in the bottom-right corner of the map
  area, and stays there when panels open, resize or pop out. It sits above
  everything drawn on the map (tokens, fog, drawings) and below panels, menus
  and dialogs.

---

## [278] — 2026-10-15 — UI size scales the whole interface; the map toolbar can hide

- **UI size** (was "Text size") in the template pop-up now scales buttons, spacing, panels and
  other sizes along with the text, so a larger size no longer squeezes words into
  boxes made for the smaller one. The ten templates (120% unless changed) grow
  the same way. Borders stay hairlines; the default look at 100% is unchanged.
- Picking a UI size closes the template pop-up, as picking a template does.
- **The map screen's toolbar can be hidden** with the ▲ at its end, leaving a thin
  "Toolbar" strip that brings it back, the way the chat collapses. Remembered per browser.
- **Map zoom moved into the toolbar** (−, slider, +, percentage), instead of a box
  floating over the map's corner.

---

## [274] — 2026-10-15 — Ten large-text display templates, and a text size choice

- **A small palette button** in the header of every page (except the handheld
  console) opens a list of templates, each with a colour preview, and switches the
  whole app between the default look and ten new templates.
- **Every new template uses bigger text**, a fifth larger throughout, and its own
  colour scheme: Metallic Chic, Deep Vintage Mood, Cool and Collected, Earthy and
  Serene, Texture and Contrast, Mechanical and Floaty, Pixel Intensity, Gradient
  Pop, Cosmic Artistry and Vibrant but Calm. Two are light, eight are dark, and
  all keep text readable on every surface.
- **Text size** at the bottom of the same pop-up: 50%, 75%, 100%, 110%, 120% or 135%, for any
  template including the default. Until one is picked, the new templates use 120%.
- Both choices are kept for the browser session and carry into a table pop-out.
  The default look is unchanged.
- With larger text, the character sheet's top bar stays on one row.
- **Stories** moved from the character sheet's top bar into its **More** menu.

---

## [269] — 2026-10-15 — The HTTPS certificate renews itself again

- The site's certificate renews automatically again, and a renewed certificate is
  picked up without restarting the server.
- The server can run as a normal user instead of root.

---

## [268] — 2026-10-15 — Security hardening

- Security hardening.

---

## [267] — 2026-10-15 — Creating characters works again

- **New character** on the character sheet saves the character again. It appeared in
  the list but was gone after a refresh, because it was never saved.
- If a character can't be created, the sheet now says so instead of showing an entry
  that isn't really there.

---

## [266] — 2026-10-12 — Treasury: a new DM screen

The DM's treasury (`/treasury.html`) is rebuilt around one table.

**One tag at a time**
- **A tag button** at the top left chooses what the table shows: one tag, "No tag", "All
  items" or "Asked for". Each tag shows its item count and a gold dot when it is on sale.
  The screen reopens on the tag you last looked at.
- **Search and the Hidden / Free loot / Shop filter** work inside the tag on show. Click a
  column heading to sort.

**Change things in the row**
- **Where it is** — Hidden, Free loot or Shop — is a three-way switch in every row.
- **Price and stock:** click the number and type. A price can be "50", "7 sp" or
  "2 pp 5 gp"; stock can be a number or ∞.
- **Identify** is a button on every unidentified row.
- **Requests** show as "2 asking" on the item; open it for Give and Decline. The Requests
  button on the top bar lists everything somebody is waiting for.

**The drawer**
- Click a row for everything else: Basics, Properties, Picture and History (who was given
  or bought it).
- **Kinds:** Weapon, Armour, Shield, Potion, Wondrous or Other. Only that kind's fields are
  shown. Potion is new; it starts with one charge.
- **Give to a character:** put an item straight into someone's inventory, with no request.
- **Duplicate** makes a hidden copy to rename.

**No Save button**
- Changes are saved as you make them. **Undo** on the top bar (or Ctrl+Z) takes back the
  last one. Identifying cannot be undone.

**The shop**
- A strip under the top bar shows open or closed and which tags are on sale; click a tag to
  add or remove it.

**Keyboard:** ↑ ↓ move, Enter open, H / L / S move the item to hidden, free loot or shop,
I identify, D duplicate, N new, T tags, / search, Esc close.

Ticking rows still brings up the bar for moving, tagging or deleting many at once; Import
and the Ledger are unchanged in what they do.

---

## [265] — 2026-10-11 — Notifications that matter pop up; HP bars go green, yellow, red

- **More notifications pop up** instead of waiting silently in the bell: damage and healing
  the DM applies to your character, a condition gained or lost, the shop opening or
  closing, and a private message. They behave like the new-day and weather notices.
- Dice rolls, table chat and "now playing" stay quiet in the bell, so a fight does not
  bury the screen.
- **Fixed: hit point bars had no yellow.** A bar went from green straight to red at half.
  It is now green down to half, yellow down to a quarter, and red below that — on tokens,
  the initiative list, the hit point panel and the hover card.

---

## [264] — 2026-10-11 — Table: spell slots you can read, and the whole spellbook

The Spells tab of the character panel on the table screen, and its pop-out window.

- **Spell slots are one row per level** with large markers and the count in words — "2 of
  4 left". A slot that can still be spent is solid and lit; a spent one is a struck-through
  ring. A level with nothing left is dimmed. Click a slot to use or restore it, as before.
- **The whole spellbook is listed,** grouped by level, not only the prepared spells.
  Unprepared spells are dimmed and marked with a hollow dot.
- **Filter: Prepared / Not prepared / All,** each with its count. It starts on Prepared and
  is remembered as you move between characters.
- **Search box** to find a spell by name.
- Clicking a spell's name still sends it to chat.

---

## [263] — 2026-10-11 — Treasury: charges, and a name for what is not yet identified

**Charges on items**
- **An item can hold charges.** Set how many in the treasury editor or on an item in a
  character's inventory, and whether a long rest refills them.
- **Use button.** An item with charges shows how many are left and a Use button — on the
  character sheet's inventory and on the table screen's Items tab. Each use takes one
  charge and says so in chat; at zero the button is off. The sheet also has Refill.
- **A long rest refills** the items set to refill, from the sheet or the table.
- Claimed and bought items arrive fully charged. Charges are carried in the character XML.

**A name for an unidentified item**
- **"Name while unidentified"** on a treasury item is what players read until you identify
  it — in the treasury, in their inventory and in the notifications about it. The real
  name stays on the server until then, and an inventory copy is marked "unidentified".
- **Copies players already hold follow it.** Add or change the name later and their
  inventory is renamed too, so nobody keeps reading the real one.
- **Identify button** in the treasury editor, on any unidentified item: one click reveals
  its real name, description and properties on every copy held.
- Leave it empty and nothing changes: players see the real name marked "(unidentified)".
- An unidentified item shows no charges, like its other properties.

**Fixed**
- Editing an inventory item no longer drops what the form does not show — where it came
  from, its picture, and whether it is still unidentified. An unidentified item that was
  edited could no longer be identified.

---

## [262] — 2026-10-11 — Calendar: find an event, look around freely, weather by itself

The DM's calendar (`/events.html`) and the players' Calendar tab.

**Finding an event**
- **Events are grouped under their day,** one line each. Click a line to open its text,
  attachments and buttons; the day the campaign is on is marked "Today".
- **Search and filters** above the list: a search box over titles, text and authors, and
  pickers for kind, who can see it (DM) and author.
- **How much to show:** Day, Month, Upcoming (from the campaign date on) or All.
- **Click a day in the grid to see that day.** Click it again for the whole month. Adding
  an event or journal uses the day on show.

**Looking around without moving the campaign**
- **The calendar has its own controls** — previous day, next day, Today and, for the DM,
  "Go to…" any date. None of them change the campaign date.
- **The top bar is the campaign date only,** and says so: "Back a day", "Advance day",
  "Set campaign date…".

**Weather**
- **A day gets its weather by itself** when the campaign date moves onto it. Days that
  are jumped over get none, and a day that already has weather keeps it.
- **The DM is told the details** (every value with its roll); **players are told what the
  day is like** in words — cold, wind, rain or snow, and what it means for travel.
- **The weather window shows the day first.** The base temperature, the dice ranges and
  the fields for setting a day by hand are under "Edit details".
- The weather tip on a calendar day now includes the description.

---

## [261] — 2026-10-11 — Table: easier to get around, quicker in a fight

Sixteen ease-of-use changes to the table screen (`/table.html`). The console is unchanged,
apart from the drag distance, which it shares.

**Getting around the map**
- **The mouse wheel zooms,** and it zooms where the pointer is instead of sliding the map
  toward its top-left corner. The slider and the + / − buttons now zoom about the middle
  of the view. Shift + wheel scrolls sideways.
- **Pan from any tool:** hold Space and drag, or drag with the middle mouse button.
- **Touch:** pinch to zoom, hold a token to drag it, and the ruler, draw and multi-select
  tools work with a finger. One-finger panning is as before.
- **The map follows the turn.** When the turn passes to a token that is off screen, the map
  glides to it. It does not select the token or change the side panel. Switch it off under
  View → Follow the turn.

**Keyboard**
- **A key for each tool:** V move, H pan, R ruler, P ping, D draw, M multi-select (DM).
  Each tool's tooltip names its key.
- **N and B** move to the next and the previous turn (DM, while a fight is running).
- **Ctrl + Z** undoes the last token move. Arrow keys already moved the selected token.
- **?** opens a sheet listing every shortcut (also under View).

**Toolbar**
- **One View menu** replaces five icon buttons: show/hide for both panels and the three
  pop-outs, plus the new switches.
- **Dice settings sit behind one button** next to the dice roller. It shows the roll mode
  in force (Ask / Normal / Adv / Dis) and turns green or red while advantage or
  disadvantage is left on. The animation switch is in the same place.
- **A hint over the map** says what the current tool does, and what you can do with the
  selected token. Switch it off under View → Tool hints.
- **The table remembers** your zoom, your tool, and which panels and the chat were open.

**Tokens**
- **Right-click a token** for damage and healing, conditions, hide/show, roll initiative,
  details and remove. Players get the menu on their own token, without the DM's actions.
- **Type a number with a token selected** to damage it: `7` then Enter takes 7, `+7` heals 7.
- **Hover a token** for a summary card: HP, AC, speed (or movement used this turn) and
  conditions. Players see a monster's name and conditions only, as before.
- **Dragging a token shows the distance** outside a fight too, with a line back to where it
  started. It turns amber past the creature's speed; in a fight it still counts the turn's
  movement down and turns red when overspent.

## [260] — 2026-10-11 — Console: follow the turn; the DM moves any token

- **When the turn changes, the console goes to that token.** The map slides to it, and for
  the DM (and for the player whose token it is) it becomes the selected token on both
  screens, ready to move. The info panel stays on the tab you were on.
- **The DM can move any token with the arrows or the stick at any time,** not only on
  that token's turn. Players still move their own token on its turn.

## [259] — 2026-10-11 — Console: choose your gamepad buttons

- **Every gamepad button can be re-assigned.** The More tab lists each action with the
  button it is on; press Change, then the button you want. If that button was doing
  something else, the two swap. The choice is remembered on the device and used by both
  screens; one button puts everything back to the standard layout.
- The button hints on both screens show the buttons as you have set them.

## [258] — 2026-10-11 — Console: music controls for the DM

- **The DM's music controls on the info panel are the console's own:** playlist, track
  list, Play or Pause, Previous, Next, Stop, repeat, and the volume everyone hears. They
  replace the framed player, which the gamepad could not reach into and which kept the
  main app's look.

## [257] — 2026-10-11 — Console: the map screen's dialogs in the console design

- **Add token, the dice roller, monster info and the confirm box** on the console's map
  screen now use the console design: black and square, the console typeface, and controls
  large enough for a finger. They fit a short screen and scroll inside themselves.
- **The draw options strip, the toast and the notification list** on the map screen
  follow the same design.

## [256] — 2026-10-11 — Console: live pop-ups on the map, initiative rolls

- **A picture the DM shows everyone now appears on the console's map screen.** It was
  missing there, so the reveal silently did nothing. The "Loading the map" notice is back
  as well.
- **A player can roll their own initiative from the info panel.** The Turn tab offers
  *Roll my initiative* (with the sheet's bonus) until they are in the order, and a re-roll
  until the fight starts.
- **Initiative rolled by the DM on the console now includes the bonus:** Dexterity (and
  proficiency or a flat bonus, where the stat block has one) for a monster, the sheet's
  initiative for a character. It used to be a bare d20. The panel shows the result.

## [255] — 2026-10-11 — Console login fits the screen again

- **The console's Log in button is back on screen** on a short, wide display. Adding the
  campaign choice in v254 had pushed it below the fold; the title now sits beside the
  campaign field and the form is a little more compact.

## [254] — 2026-10-11 — Console: choose a campaign at login, initiative fixes

- **The console login lets you choose the campaign** when the server hosts more than one.
  The character list follows the choice, and the launcher shows which campaign you are in.
- **Starting initiative no longer fails silently.** If nobody has rolled yet the panel says
  so; any other refusal is shown as well.
- **The DM's Table tab has the initiative controls too** (Start or End, Previous, Next
  turn), and a button that rolls initiative for every monster that has no roll yet.

## [253] — 2026-10-11 — Console: the full character sheet

The last of the features the console was missing. For a player character the info panel's
Token tab now has four parts beside Health, matching the table screen's right panel:

- **Skills:** ability checks, saving throws and all eighteen skills, each one tap to roll,
  with proficiency bonus, passive Perception and spell save DC shown.
- **Combat:** attacks and damage, then the character's actions, bonus actions, reactions
  and others, including action spells. Limited uses are boxes to tap, with Short rest and
  Long rest to bring them back.
- **Spells:** spell slots to spend and restore, and prepared spells by level. Tapping a
  spell or an action posts its description to chat.
- **Items:** tap to wear or take off; armour class and everything else an item changes
  are recalculated.
- The sheet on the console updates by itself when the character is edited elsewhere.

## [252] — 2026-10-10 — Console: handouts

- **The info panel has a Handouts tab.** A player sees the handouts their character holds,
  examines the ones that need a check, and reads the result once the DM has called it. The
  tab is marked while something is waiting.
- **The DM runs a handout from the same tab:** pick one, choose who gets it, watch the
  checks come in, and call each a success or a failure (or accept what the DC suggests,
  ask for another roll, or take the handout back).
- A handout notification opens this tab.

## [251] — 2026-10-10 — Console: notifications

- **The info panel has the notification bell**, at the end of its tab bar, with the unread
  count. Alerts pop up and chime there: your turn, combat started, loot, handouts.
- **Opening a notification on the console goes to the matching tab** (Turn, Chat, Token)
  instead of leaving the console for another page.
- **The map screen shows the unread count** on its status line. It stays silent while the
  info panel is connected, so one event does not chime twice on the same device.

## [250] — 2026-10-10 — Console: weather, the shared music player, stat block

The first of the features the console was missing.

- **Today's weather is on the map screen's status line** once the DM has set it for the
  current date. Tap it for the details.
- **The info panel uses the same music player as the rest of the app.** The DM opens the
  full player from the More tab. Everyone gets a volume control for their own device, and
  two open screens no longer risk playing the same track twice.
- **Pictures in the info panel's chat open full screen** when tapped.
- Fixed: a monster's stat block being updated while its Info window was open raised an
  error on the console map.

## [249] — 2026-10-10 — Console redesign, step 4: gamepad

The console can be driven with the handheld's buttons and sticks. It does not matter which
of the two screens the device gives its buttons to; each screen passes on what belongs to
the other.

- **Info panel:** the D-pad moves a blue highlight between buttons and rows, A presses it,
  B goes back, L1/R1 change tab, Y opens the dice. X runs the turn action (Next turn, End
  my turn or Start initiative) and has to be pressed twice.
- **Map:** the left stick moves the selected token, the right stick slides the map, L2/R2
  zoom, Start opens Tools, Select undoes the last move.
- **A token picked on the info panel is now selected on the map as well**, so it can be
  moved straight away.
- The More tab lists the buttons. Button hints appear on both screens once a gamepad has
  been used.
- A keyboard works too, for testing on a PC: `[` `]` tabs, WASD move, IJKL slide, `-` `=`
  zoom, T tools, U undo, X turn, Y dice, Esc back.

## [248] — 2026-10-10 — Console redesign, step 3: the map screen

The frame around the console's map is rebuilt in the new design. The map, its tokens and
its dialogs are unchanged.

- **A thin status line replaces the toolbar:** whose turn it is, the tool in use, the zoom
  level, and whether the info panel is connected.
- **The tools moved into a Tools drawer** opened from the status line: Select, Move, Pan,
  Ruler, Ping, Draw, zoom, and for the DM Add token and Remove all tokens.
- **A command line under the map** says what the current tool does and holds the arrows
  that move the selected token.
- **Undo move is now on the console map** too; it was only on the normal table screen.
- The map leaves more room: two lines of frame instead of a toolbar that wrapped onto
  several rows on a small screen.

## [247] — 2026-10-10 — Console redesign, step 2: the info panel

The info panel (the console's bottom screen) is rebuilt in the new design. Everything it
could do before is still there; where it lives has changed.

- **Five tabs instead of seven:** Turn, Token, Chat, Table (DM only) and More.
- **Turn** shows the initiative order with each combatant's health, and a line about you:
  your character, your hit points, and whether it is your turn. The turn buttons sit in a
  bar at the bottom. A player gets an **End my turn** button while it is their turn.
- **Token** is everything about the selected token, in up to four parts: Health (damage,
  healing, conditions), Rolls, Stat block and Manage. The old HP, Actions and Monster tabs
  are folded into it. A player's own token is selected when the panel opens.
- **Table** (DM) has the map picker, every token with its health, fog regions and hidden
  items. **More** has the music controls and Log out.
- **Questions are asked on the panel itself**, not in a browser pop-up, before deleting a
  token, removing all tokens, loading a map, removing someone from initiative, or ending
  initiative.
- Condition buttons show the full name instead of a three-letter code.

## [246] — 2026-10-10 — Console redesign, step 1: new login and launcher

The console screens (the two-screen mode for the AYN Thor handheld) are being rebuilt in a
new look of their own. This is the first of several releases; the map and the info panel
themselves still look as before.

- **One login form for all three console pages**, in the new design. On the Thor's short,
  wide screens the form is laid out in two columns, so the Log in button is reachable
  without scrolling.
- **The console launcher is redesigned**, and now offers the map screen to players as well
  as the DM.
- **New Device check page** (`/console/probe.html`, also linked from the launcher): shows
  the screen size, pixel ratio and gamepad buttons exactly as the browser reports them.

## [245] — 2026-10-10 — Token names keep pace with the token

- **Token names on the map are no longer tiny beside big tokens.** The name, the
  controller badge, the condition tags and the HP bar now grow with the map's grid size
  and with the creature's size (a 4-cell creature gets a name twice as tall, not four
  times). A map on the default 50px grid looks exactly as before.
- **A long name that wraps now grows downward**, away from the token, instead of climbing
  up over the HP bar.

## [244] — 2026-09-27 — Installs list only where reports are collected

- **The Installs section is gone from the maintenance page** on every server except the
  licensor's. It used to show an empty table with setup instructions.
- *(no frontend bump)* Receiving install reports now needs a secret key; only a scrypt
  hash of it is in the code.

## [243] — 2026-09-27 — Install reporting

Each install now tells the licensor it exists, so installs outside the non-commercial
licence can be spotted. Documented in the README under "Install reporting".

- **Servers send an anonymous install report** a minute after start and then daily: a
  random install id, the release number, Node/OS, counts of campaigns, characters and
  accounts active in the last 7 days, and up to five host names. No names or content.
  Announced in the startup log; `TELEMETRY=off` in `.env` turns it off.
- **The maintenance page has an Installs list** — kind, host, version, counts, first and
  last seen, address. It fills only on the licensor's server.
- **Desktop 1.0.4** reports at launch, at most once a day (install id, version, OS,
  server host), and has a Settings switch to turn it off.

## [242] — 2026-09-27 — Spell levels on the Spells tab

- **The spell level now shows in full** in the Cantrips & Prepared Spells list. Its box
  was too narrow for the number to be seen.
- **Spell slots go up to 9th level.** The Spell Slots card only had levels 1–6, so a
  high-level caster could not record 7th–9th level slots. The character XML export and
  the character-creator import now include levels 7–9 as well; a full caster made from
  the creator import gets the right high-level slots.

---

## [241] — 2026-09-27 — Security hardening

- Names, notes and numbers from character sheets, monster stat blocks and shop
  records are now always shown as plain text on every screen.
- A shop purchase must be for a whole number of items (1–1000).
- Fixed: an ability score, armour class or bonus of **0** sometimes showed as blank.
- Fixed: the monster import message showed icon code instead of the check-mark icon.

---

## [240] — 2026-09-27 — Security hardening

- Posting to chat, rolling the 3D dice, drawing on the map, pinging, and moving to the
  next or previous turn now require a login (the DM or any character of the campaign).
  **A page that is not logged in can still be viewed, but can no longer post, roll or
  draw.**
- Prepared maps can only be opened by the DM.

---

## [239] — 2026-09-26 — WebM videos in Stories

- Story panels now accept **WebM** videos as well as MP4, with the same 500 MB limit.
  Each file is checked to make sure it really is the format it claims to be.

---

## [238] — 2026-09-26 — Videos in Stories

A story panel can now hold an MP4 video instead of an image.

- **Upload an MP4 of up to 500 MB** to any panel in the story editor. The panel shows the
  upload's progress, and the page asks before you leave while an upload is running.
- **Videos play in place** in the story viewer, in both grid and strip layouts, with
  their own controls and fullscreen button. Only the first frame loads until you press play.
- **A video panel can be the story's cover** on the Stories list, where it shows its first frame.
- Replacing or removing a panel's video, or deleting the panel, also deletes the file.
- The offline cache now skips video and audio files.
- *(no frontend bump)* The server now allows up to an hour to receive a request, so a
  large video upload over a slow connection isn't cut off. This needs a server restart.
- *(no frontend bump)* Fixed: a video upload could stop the server just as it
  finished. The video is now saved and the upload completes normally.

---

## [237] — 2026-09-26 — Live updates need a login

- The live connection that keeps every page up to date now requires a login, and is
  closed when a session ends. **A tab that is not logged in — for example a table left
  open as a display screen — still loads, but no longer updates by itself.**
- Hidden tokens, DM-only rolls, notifications and private messages are now delivered
  only to the people meant to see them.
- Monsters lined up before combat stay off the players' initiative list until combat
  starts.
- The two console screens now pair only with each other (the same login in the same
  campaign), so two tables using consoles at once no longer interfere.
- Security hardening.

## [236] — 2026-09-26 — The AI DM is retired

- The AI DM is removed from the app: its button on the character sheet is gone and its
  pages no longer load. Its code is kept, unchanged, in `retired/aiDM/` at the top of the
  repository, outside the deployed application.
- Existing AI DM sessions are not deleted — each campaign's `aiDM.db` stays on disk and
  is still included in the raw database backup.

**On the production server:** uploading does not remove the old `Application/aiDM/`
folder. It is no longer used; delete it by hand when convenient (keep `aiDM/aiDM.db` if
you want the pre-campaigns rollback copy).

## [235] — 2026-09-26 — Stories work again

- **The Stories pages work again.** v233 left them unable to load or save anything. The
  Stories password now logs you in properly, and a tab already logged in elsewhere goes
  straight in. **Do not deploy v233 without this release.**
- Restoring a single-monster export, or an old shop or loot backup, failed with an error.
  Fixed.
- Backup restore and export are stricter about the files they will read and write.
- Formatted chat messages (spell cards, group rolls) are cleaned before they are shown;
  spell links lose their two small icons as a result.
- Security hardening.

## [234] — 2026-09-26 — Private messages in chat

Every chat box — the table, the character sheet, the DM panel and both console
screens — now has a recipient picker next to the input. Leave it on **Everyone** and
chat works exactly as before; pick the DM or another character and the message goes to
them alone, shown with a lock and a coloured edge.

- **Who can read one:** the sender, the recipient and the DM. The DM reads players'
  messages to each other too, by the table's choice, but is not notified about each
  one — only the recipient gets a bell entry.
- **The picker goes back to Everyone after each private message**, so nobody keeps
  whispering when they think they are talking to the room, or the other way round.
- Sending a private message needs a login. Ordinary messages and dice rolls are
  unchanged.
- Chat history on every page now includes the private messages addressed to you, so
  they are still there after a reload.

## [233] — 2026-09-26 — Security fixes, and the console table screen starts fully

- **Creating a character is now the DM's job.** A new player still needs no account
  beforehand: the DM adds the character, and the player sets their own password on first
  login.
- **Sharing an image in chat needs a login**, and a player's image is always posted under
  their own character's name. The DM can still post as the selected token.
- **The console table screen was losing half its startup** — chat drag-and-drop,
  resizable panels, draggable windows and the chat history did not load there. Fixed.
- Security hardening.

## [232] — 2026-09-26 — The campaign login is visible again on the picker

Selecting a campaign showed its name, description and stats but not the login form
beside them: the campaign list stretched across the whole window and pushed the detail
pane, login and all, off the right edge. It affected every window size, and it started
when a campaign with a long description was added.

The list pane is a flex item sized `flex:0 0 380px`, but a flex item cannot shrink below
its min-content width unless it is given `min-width:0`, and the description line inside
each card is `white-space:nowrap`. One 279-character description therefore demanded a
single 1400px line, the pane grew to 1508px to hold it, and the detail pane was left
with 52px off the edge of the screen. Both panes now set `min-width:0`, so the pane
keeps its 380px and the description ellipsises as it was always meant to.

The handouts screen is built from the same master-detail pair and had the same latent
bug waiting on a long enough handout title, so it is fixed there too.

## [231] — 2026-09-12 — A notification no longer drags the window you were reading

Fixes a regression in v230. In the desktop app, clicking a notification whose screen
was already open focused that window — and navigated the window you clicked from as
well, so you lost the page you were on. When the screen was not already open, nothing
was wrong.

The desktop client answers `window.open` with null whenever its main process handled
the request itself, which is what v230 taught it to do when it reuses an open window.
The web page read that null as "the popup was blocked" and fell back to navigating
itself. There are no blocked popups in the desktop app, so null there now means
"already dealt with" and the fallback is skipped.

Web-only — **no desktop rebuild needed**, the client loads this file from the server.

### Desktop client 1.0.2 *(desktop only — no frontend bump)*

**A shortcut no longer opens a screen you already have.** If the music window had
been opened by clicking a notification, Ctrl+Alt+M opened a second one — and the
same went for the table, the character sheet and every other screen with a shortcut,
menu entry or tray entry.

Windows the page opens and windows a role opens lived in two separate registries, and
"is this screen already open?" only ever consulted the first. Both are now consulted,
and the question is answered from the screen a window was **opened for** rather than
the URL it currently shows — an expired session parks every window on the login page,
and matching live URLs there would raise someone's login window when you asked for the
table.

Needs a fresh download; there is no auto-update.

- Covered by a new end-to-end test that drives a real Electron with real windows
  against a real server (`Desktop/test/e2e-window-reuse.js`, `npm run test:e2e`). It
  fails without the fix and passes with it, checking both halves: the target already
  open, and not.

## [230] — 2026-09-12 — One connection per page, and ending a session from maintenance

Three bugs behind the same symptom — the maintenance page showing the same person
on the same page twice — plus a way to sign someone out.

**End a session (new).** The maintenance page now lists everyone signed in: who they
are, which campaign, when they signed in, when they were last seen, their address and
browser. **End session** signs that browser out; it finds out at its next request.
**End all sessions** does it to everyone but you. Every ending is written to the login
activity log. A lockout stops someone getting in — this throws out someone already in,
for a lost phone or a shared password. Your own session is marked *(you)* and can only
be ended with Lock.

**Fixes**

- Four pages held **two** WebSockets each — events, monsters, map prep and the music
  library. Each has a notification bell that asks for a connection, and each also
  opened its own, so they were listed twice and handled every event twice.
  `connectRealtime()` now serves the second and later callers from the first
  connection.
- A client that vanished without closing cleanly — a laptop that sleeps, a phone that
  loses signal, a window killed outright — stayed in the list until the operating
  system gave up on the socket, which could be hours, while its reconnect appeared
  alongside it. The server now pings every 30 seconds and drops anyone who does not
  answer, so a dead row is gone within about a minute.
- **Desktop client:** clicking a notification opened another window even when that
  screen was already open, and each new window made its own connection. Electron does
  not implement the browser's rule that `window.open` with a name reuses the window of
  that name; it does now, and an already-open screen is brought forward instead.
  *(Needs a desktop rebuild — the web fixes above reach the desktop app without one.)*

## [229] — 2026-09-12 — The character sheet's More menu opens on a phone

On a narrow screen the character-sheet toolbar wraps, and the More button can end up
in the middle of a row or alone at the left of one. The menu was pinned to the
button's right edge, so from there it opened off the left side of the screen and
looked like nothing had happened when you tapped it.

- The menu now hangs off the toolbar rather than off the button, so it stays on
  screen wherever the button has wrapped to. Where the button is last in its row —
  every desktop layout — it lands exactly where it always did.
- On a phone the menu spans the full width of the toolbar, and scrolls instead of
  growing taller than the screen.

## [228] — 2026-09-11 — See and lift login lockouts; login activity in pages

The maintenance page now lists every address that is locked out of logging in, and
can lift a lock early — so a player who mistyped five times does not have to sit out
the timer. Its login activity now pages back through the whole 30-day log.

*(v227 only ever ran on the local test server; this entry covers it.)*

- **Blocked addresses** section: the address, what is blocked (the whole address,
  or one account such as "Aliyr in For the Glory of Amn" or "DM of …"), a live
  countdown, how many times it has been locked, the wrong attempts (first and last
  on hover) and the browser last used from there.
- **Unblock** lifts that one account's lock; **Unblock address** lifts every lock on
  the address. Either way the next mistake starts again at one minute. Every
  unblock shows up in Login activity as "Unblocked by admin".
- Locks still lift by themselves when they run out, and all at once on a server
  restart.
- **Login activity comes in pages** — 25, 50 or 100 at a time, remembered — so the
  whole 30-day log can be read, not just the newest 200. The first page keeps
  refreshing itself; older pages hold still so rows do not move while you read.

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
