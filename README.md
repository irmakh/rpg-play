# RPG Play — D&D 5e Virtual Tabletop

A self-hosted web app for running D&D 5e sessions. It hosts any number of **campaigns**, each a fully separate world with its own DM password and its own data. Every campaign bundles a full character sheet, a shared virtual battle map, a real-time initiative tracker, a monster library, a treasury for loot and shop items, a synced music player, an AI Dungeon Master, a comic-style story builder, and a mobile companion — all kept live across every connected browser with no external cloud required.

Vanilla JS, no build step, no framework. Runs on SQLite by default; nothing to provision.

---

## Feature Overview

### Campaigns (`/`) — the front door

The server hosts any number of **campaigns**, and each one is a fully separate tenant: its own characters, table, initiative, monsters, treasury, calendar, weather, maps, sounds, chat, stories and AI DM sessions — and its own DM password.

- `/` opens the **campaign picker**: a list of every campaign on the left, the selected campaign's cover, description and stats on the right
- Selecting a campaign shows its detail and its login (Character tab / DM tab). Logging in scopes the whole app to that campaign
- **Each campaign has its own DM password**, stored hashed in `campaigns.db`. A DM password grants nothing in any other campaign
- The server-wide `MASTER_PASSWORD` env var is the **super-admin** key: it unlocks any campaign, is required to create or delete campaigns, and is the recovery path when a campaign's DM password is lost
- **⚙ Campaign settings** (needs that campaign's DM password): rename, edit the description, upload a cover image, change the DM password
- **Deleting** a campaign needs the admin password *and* the campaign name typed exactly; the last remaining campaign cannot be deleted
- Every page header carries a campaign badge; clicking it — or logging out — returns to the picker

**How isolation works.** Each campaign owns a directory of SQLite files:

```
Application/
├── campaigns.db                      # registry: names, covers, hashed DM passwords
└── data/campaigns/<campaignId>/
    ├── localdb.db                    # characters, table, treasury, monsters, calendar…
    ├── media.db                      # chat images + the table map blob
    ├── stories.db                    # the comic/story builder
    └── aiDM.db                       # AI DM sessions
```

Nothing filters by a `campaign_id` column, so there is no `WHERE` clause to forget: a request simply never holds a database handle that reaches another campaign. Real-time events are filtered the same way — a token move in one campaign is never delivered to another campaign's table.

Uploaded images and audio under `public/uploads/` are shared across campaigns. Their filenames are UUIDs so they never collide, but deleting a campaign leaves its uploads on disk as orphans.

### Character Sheet (`/index.html`)
- Full D&D 5e sheet: ability scores, skills, saving throws, HP, AC, speed, initiative — all auto-calculated
- Proficiency bonus auto-derived from level; spell slot tracking with per-level counters and prepared-spell count
- **Actions tab** — aggregates weapon attacks, action-flagged spells, and freeform **custom actions** into one combat panel. Custom actions carry a category (action / bonus / reaction / other), description, dice, and limited-use tracking with short/long-rest recharge
- Weapon attacks table with custom dice rolls; weapon notes shown in the damage chat message
- Equipment / magic items panel: equipped items feed AC, initiative, and speed auto-calc; spell-bonus items supported
- Spell table with **clickable column sort** — click any header (Prep / Lvl / Name / Time / Range / Conc / Ritual / School / Dur) to sort with a ▲/▼ indicator; spells carry an action-category and duration field
- Portrait upload plus media attachments (images, video) with a fullscreen lightbox; videos autoplay with controls
- Inventory, features & traits, background, and notes tabs
- Dice rolling with full 3D animation, broadcast live to the virtual table; advantage / disadvantage dual-die rolls; per-character roll history
- Import / export character as XML (D&D Beyond–compatible) — round-trips custom actions and spell action/duration fields, and prompts update-vs-new-copy on a same-name import
- Per-character password protection (set / change / remove); multiple characters selectable from a list
- Player-facing tabs: **Treasury** (one tab with a Free Loot / Shop switch — claim dropped items for free or buy with in-character currency; item images, and unidentified items shown as such), **Initiative** (slide-out tracker with roll submission), **Calendar** (Calendar of Harptos — DM events plus your own journals with media)
- Real-time chat: free text or `/r NdS+M [label]` dice rolls (e.g. `/r 2d6+3`, `/r d20 Stealth`)
- Three themes: Dark Gold, Parchment, Midnight; quick-nav buttons to the Table and Stories

### Virtual Table (`/table.html`)
- Shared battle map with a configurable grid overlay; upload any image as the background
- Token system for PC / NPC / monster tokens, each with a portrait (thumbnails auto-generated on upload)
- **Open token movement** — anyone can drag any token (no ownership, monster, or turn gating), with a 100 ms hold delay to avoid accidental drags and a single-level **Undo** button to snap the last move back
- Movement distance is measured **Euclidean** (matching the ruler), reset per turn
- Token HP panel: damage, heal, temp HP, death saves, and live **AC display**; per-token HP bar overlay (green → yellow → red)
- **Move tool also selects** — clicking a token selects it (a dedicated Select tool is no longer needed)
- Monster names hidden from players — shown as an identifier (e.g. "Goblin #2"), editable by the DM from the side panel; per-monster visibility toggle in real time
- **Token quick-roll side panel** — click a token for full dice rolling: saves, skills, ability checks, damage, initiative. A persistent **dice-mode toggle** (Normal / Adv / Dis / Ask, default **Ask**) in the top toolbar applies to every roll
- Right-panel sections use the same gold-bar headers as the character sheet (Conditions, HP, Temp HP, etc.), with the Bulk Edit panel mirroring the same controls for multi-token edits
- **Equipment wear/unwear** in the right panel — toggling items recomputes AC, initiative, speed, and spell DC and syncs to the token
- **Monster actions panel** — each action has a **Use** button that posts the action text and a damage roll to chat; players' custom actions have the same **Use** button
- Click a weapon row to roll the attack, then a **Miss / Roll Damage** prompt; click a spell name to post its full description to chat with a 5e.tools link
- **3D dice** — animated icosahedron (d20) and pentagonal-trapezohedron (d10), shown for every roll including those broadcast from the character sheet; a toolbar switch toggles the animation on/off
- **Group rolls (DM)** — select multiple tokens and trigger a single ability check or saving throw; each token rolls by its own bonus and the results post as one combined chat message (also for group initiative)
- **Pop-out panels** — pop the initiative/chat sidebar, the right token panel, or the chat bar into a separate browser window; the real DOM node moves across windows and keeps updating over SSE. The popped-out character sheet uses a dedicated responsive "magazine" layout
- Fog-of-war regions and hidden map items (traps, chests, doors, notes): DM reveals or re-hides per region/item; hovering a panel entry highlights its spot on the canvas
- Drawing tools (freehand, line, arrow, rectangle, circle with colour/weight), ruler, ping marker, zoom
- Prepared-map selector loads a preset from Map Prep
- **DM shared-media reveal** — sending an image opens a draggable reveal card on every client (drag is local-only)
- Permanent left sidebar (initiative + chat) with a collapse toggle
- DM unlock via master password; the DM can also **log in as any character** using the master password

### DM Dashboard (`/dm.html`)
- Initiative tracker with full CRUD: add PCs and NPCs, set/reorder initiatives, edit, delete
- Start / stop combat, next / previous turn, skip; **Clean Orphans** removes stale entries without disrupting a running encounter
- Monster library table: search, filter, add to initiative in one click (identifier shown in chat rolls)
- Monster stat-block popup with correct multi-line trait/action rendering
- Media sharing: drag-and-drop image / video → shared instantly to the table
- DM chat: free text or `/r` rolls (broadcasts the 3D animation to all screens); **per-message delete** removes it from every client live
- Data backup / restore: per-section JSON export (characters, monsters, treasury, maps), non-destructive merge import; treasury backups carry item images, and older `shop` / `loot` backup files still restore
- **Raw database backup:** one-click download of all SQLite databases (`localdb`, `media`, `stories`, `aiDM`) as-is, bundled into a single streamed `.tar.gz` for full off-site backup (uploaded media under `uploads/` is stored separately and not yet included)
- Multiple themes

### DM Calendar (`/events.html`) — DM only
- Full **Calendar of Harptos** (Forgotten Realms): 12 months × 30 days as three tendays × 10 columns
- Festival rows between months: Midwinter, Greengrass, Midsummer, Shieldmeet (leap years), Highharvestide, The Feast of the Moon
- Dale Reckoning year names for years 1–1600 (e.g. 1492 DR — Year of Three Ships Sailing)
- **Campaign date control:** advance a day at a time or jump to any date/festival; current date highlighted in gold
- **Events:** title, description, type (session / combat / travel / milestone / rest / note), public or DM-only; public events broadcast live to player calendars over SSE
- **Media attachments:** attach images, video, or audio to any event (one per upload, 25 MB cap; images get auto-generated thumbnails)
- **Daily weather roller:** roll temperature, wind and precipitation for any date — each gets its own d20 against configurable thresholds, with temperature swinging from a "session normal" baseline and precipitation falling as snow below freezing. Set a day manually instead if you prefer. Results are logged per day and shown as icons on the calendar grid with a hover breakdown

### Player Calendar (tab on `/index.html`)
- Calendar showing DM-published public events, the player's own journals, and the current campaign date (live via SSE)
- **Player journals** — players author their own dated entries from the calendar (**+Journal** button). A journal defaults to **shared** (visible to everyone) or can be kept **private** (visible only to the DM and its author); each entry can carry media attachments. Players can edit and delete only their own journals
- Visibility rule: a viewer sees an event if they are the DM, the event is public, or they authored it
- Click a day to filter its events; **Go to Today** jumps back to the campaign date; ← / → month navigation
- Weather icons on each day the DM has rolled, with the same hover breakdown; the virtual table also carries a toolbar widget showing the current day's weather

### Handouts (`/handouts.html`) — DM only

- Author a handout with a title, an optional **prompt** shown before any check, and **two bodies**: one for a successful skill check, one for a failure. Each body takes its own image.
- Hand it to selected characters (or the whole party); every recipient is tracked independently.
- **Optionally require a skill check.** The check is **blind**: the player presses a neutral *Examine* button and never learns which skill was tested, what the DC was, or what they rolled. The roll happens on the server using the character's own modifier, so it cannot be forged.
- **You decide the outcome.** The DM screen lists every recipient with their total and, if you set a DC, a suggested result — but nothing reaches a player until you press **Success** or **Fail**. There is an *Apply all suggested* shortcut, and you can overrule any roll.
- Rolls are logged to chat as **DM-only**, so players never see each other's results.
- Re-tag an outcome at any time, send a recipient back to *pending* to grant a re-roll, or recall the handout entirely.
- A handout with no skill check is simply readable the moment you hand it out.
- Players see it pop up on the **table screen** and keep it in a **📜 Handouts tab** on their character sheet, with an unread badge. A handout pops **once** — reloading the page does not replay it. It surfaces again only when there is genuinely something new: you re-send it, or you change its outcome.
- **One dialog for the whole handout.** The 📜 button in the table toolbar opens it: pick a handout, tick any mix of characters (with **All** / **None**) and give it to all of them at once — then watch their checks arrive **live** and resolve each one with **Success** / **Fail** right there. Every character appears once: a tick box if they do not hold it yet, or their roll, the DC’s suggestion and the verdict buttons if they do. *Apply suggested* clears the whole queue at once. Nothing needs a token selected.
- **Run it all from the map.** The right-hand character panel on the table gains a **Handouts** tab beside Items. Rows collapse to a single title line to fit the narrow panel — anything awaiting attention opens itself, and ⌄ / ⌃ expand or collapse the lot. Select a player's token as DM and you get their handouts with the roll, the DC's suggestion, and Success / Fail / re-roll / recall — plus a *Hand Out* list to give them a new one, without leaving the map. A player selecting their own token sees the same tab with their history and the Examine button. The tab shows a dot and a count when something needs attention.

### Treasury (`/treasury.html`) — DM only
One catalogue for everything you hand out, replacing the separate Merchant and Loot managers. Every item carries the full D&D data set — type, price (PP/GP/EP/SP/CP), stock, AC / initiative / speed / spell bonuses, attunement, weapon damage and properties, description — plus a **distribution mode** you flip in place:

| Mode | Players see it | Cost |
|---|---|---|
| **Hidden** | no | — |
| **Free Loot** | yes | free, claimed once per character |
| **Shop** | while the shop is open and its tag is on sale | in-character currency |

- **Master–detail workspace:** searchable, tag-grouped sidebar with mode filter chips; the selected item is edited inline (no modal)
- **Claiming free loot creates a real inventory item**, exactly like a purchase — a claimed weapon arrives with its attack and damage worked out against the character's own stats. Stock governs how many can take it: `1` disappears after the first claim, a higher number counts down, `-1` is an open offer to the whole party
- **Item images:** drop or pick a picture per item (JPEG/PNG/GIF/WebP, 25 MB); players see a thumbnail in the list, the full size in the detail view, and can open it in the lightbox — and it follows the item into their inventory
- **Unidentified items:** leave *description visible* off and players see the item's name marked **(unidentified)** along with its kind, price and stock — the description, magic bonus, damage dice, properties and bonuses stay hidden, even from anyone who claims or buys it. The redaction happens server-side, so nothing identifying is sent to the browser at all. Turn it on and everything is revealed at once, including on copies players already hold
- **Multi-tag shop:** open the shop for any combination of tags (or all of it); a tag picker shows how many items each tag has for sale
- Bulk text import, bulk tag / mode assignment, bulk delete, multi-select
- **Ledger:** claims and purchases interleaved in one history — who took what, when, and for how much
- Legacy `/merchant.html` and `/loot.html` redirect here

### Maintenance (`/maintenance.html`) — DM only, unlisted
- Hidden diagnostics page (no link anywhere) gated by the master password on every request
- Lists every connected real-time client: IP, identity (DM or character name), login time, current page, transport (WebSocket / SSE), user agent
- Shows the **frontend version each client has loaded** against the server's, highlighting anyone running stale assets
- **Force reload** — push a refresh to every client, or only to the outdated ones, so a release reaches phones without chasing people
- Connection identity is self-reported by the client and therefore spoofable: the page is informational, **not** an access control

### Map Prep (`/prepare-map.html`) — DM only
- Upload a map and set grid size; draw fog regions; **place tokens** (with portrait and visible/hidden state) and hidden items on the prep canvas
- Save named presets and load any to the live table instantly; export / import a map as `.map.json`; delete saved maps; load warning before overwriting the live map

### Monster Library (`/monsters.html`) — DM only
- Full stat blocks: abilities, skills, saves, senses, CR, HP, AC, speed, traits, actions, legendary actions (multi-line text renders correctly)
- Portrait upload; per-token portrait override; realtime updates of monster edits
- Import monsters from XML (D&D Beyond / 5e tools) — bulk, non-destructive merge
- **Single-monster JSON export** (portrait embedded) and **import** (auto-detected via `type: "monster"`), non-destructive
- Add any monster straight to initiative; search and filter by name; extra fields for vulnerabilities and initiative

### Music & Sound Player (`/playlists.html`) — DM only
- Upload audio and organise into named playlists; reorder, rename, delete tracks
- **DM playback on the table:** play / stop / seek (seek affects all listeners); **loop modes** (none / track / playlist auto-advance)
- All clients hear audio in real time; **now-playing bar** with track name, state, and duration; clients joining mid-track start from the current position
- Pop-out music popup; loading / playing / paused notifications broadcast to all clients

### AI Dungeon Master (`/ai-dm`) — players only
- Text-based D&D 5e adventure in the Forgotten Realms, powered by a local LM Studio model, OpenRouter, or OpenAI (ChatGPT)
- Pick your existing character — the full stat block is fed to the AI as context
- Built-in or custom scenarios (manual or AI-generated from keywords); **streaming** token-by-token responses with a blocking overlay
- **Dice rolls embedded in DM text** — click to roll with your real modifiers (advantage/disadvantage); old roll buttons disable on resume
- **Option buttons** for numbered choices, plus a "Write my own" option
- **Short rest** (spend hit dice) and **long rest** (restore HP, slots, hit dice, death saves; class-appropriate spell prep screen)
- **Adventure summary** — manual or automatic (at 20 exchanges) compression of history into AI context
- Session management (view / continue / delete ended logs), mid-session model switching, retry / stop buttons
- **Turkish language support** — per-session language selector injected into the system prompt
- Seamless entry from the sheet ("⚔ AI DM" button, hidden for DM sessions; auth passed automatically); sessions persist in a separate SQLite DB (`aiDM/aiDM.db`)

### Stories (`/stories.html`) — password protected
- Comic-book story system for session recaps and campaign moments
- **Dashboard** — card grid (cover = first panel, title, cast, panel count, date) with character filter
- **Builder** (`/story-builder.html`) — title/description with debounced auto-save, **character cast multiselect by portrait**, per-panel image upload and caption, reorder ▲/▼, delete with confirm; images stored under `/story-images/{storyId}/{seqId}.ext`
- **Viewer** (`/story-viewer.html`) — grid or vertical strip layout, fullscreen lightbox, and a cast strip showing portrait / name / species / class
- Password gate on all three screens accepts the DM password or any character password (`POST /api/auth/verify-any`); bypassed if already logged in

### Mobile Companion PWA (`/console/`)
- Installable PWA for phone / tablet, works offline after first load; full SSE sync with the main table (initiative, HP, state)
- **Actions tab** for quick common actions; **D-pad** to move the selected token from the phone
- **DM controls in companion:** token visibility toggle and character assignment
- Safe-area padding for notched / punch-hole phones (iOS and Android)

---

## Authentication & Login

- Login is always **scoped to a campaign**. The campaign picker at `/` is the front door; choosing a campaign sets a `campaign` cookie, and every later request is answered from that campaign only
- **Character tab:** name + password (first-login setup for passwordless characters). **DM tab:** that campaign’s own DM password
- **Two levels of DM authority:** a campaign DM password (hashed in `campaigns.db`, valid only in its own campaign) and the server-wide `MASTER_PASSWORD` super-admin key (unlocks any campaign, required to create or delete campaigns, and the recovery path for a lost DM password)
- The DM can also log in **as any character** by using a DM password in the character tab
- `/login.html` still works and reads the campaign already selected; it redirects to the picker when there is none
- An API call made with no campaign selected answers `409 NO_CAMPAIGN`, and the frontend bounces to the picker
- Sessions live in `sessionStorage` — closing the tab logs out; HTML pages have auth guards that redirect unauthenticated access to login
- **Stories** use a separate gate (`/api/auth/verify-any`) accepting the DM or any character password, auto-bypassed when already logged in
- Token movement on the table is intentionally **open to all players** (DM retains full control); DM-only controls stay hidden until the master password is entered

---

## Pages at a Glance

| Page | URL | Who |
|---|---|---|
| Campaign Picker | `/` | All users |
| Login | `/login.html` | All users |
| Character Sheet | `/index.html` | Players |
| Virtual Table | `/table.html` | Players + DM |
| DM Dashboard | `/dm.html` | DM |
| DM Calendar | `/events.html` | DM |
| Monster Library | `/monsters.html` | DM |
| Map Prep | `/prepare-map.html` | DM |
| Treasury (loot + shop) | `/treasury.html` | DM |
| Handouts | `/handouts.html` | DM |
| Music & Sounds | `/playlists.html` | DM |
| Maintenance (unlisted) | `/maintenance.html` | Super-admin |
| Stories | `/stories.html` | Any (password gated) |
| Story Builder | `/story-builder.html` | Any (password gated) |
| Story Viewer | `/story-viewer.html` | Any (password gated) |
| AI Dungeon Master | `/ai-dm` | Players |
| Mobile Companion | `/console/` | All users |

---

## Database Modes

| Mode | Storage | Real-time |
|---|---|---|
| `localdb` | SQLite (`better-sqlite3`) | WebSocket |
| `instantdb` | [InstantDB](https://www.instantdb.com) cloud | SSE |

Set `DB_PROVIDER` in `.env`. The default and fully-featured path is `localdb` — every feature above works with no external service.

---

## Deployment

### Option A — Docker (recommended for local / LAN play)

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
git clone https://github.com/irmakh/rpg-play.git
cd rpg-play

cp .env.docker .env
# Edit .env — at minimum set MASTER_PASSWORD and DB_PROVIDER=localdb
```

```bash
./docker-start.sh
# or: docker-compose build && docker-compose up -d
```

Open `http://localhost:3000` (or whatever `HOST_PORT` you set).

**Docker commands:**
```bash
./docker-stop.sh            # Stop
docker-compose logs -f      # Live logs
docker-compose restart      # Restart
docker-compose build --no-cache && docker-compose up -d   # Rebuild
```

> **Note:** native addons (`sharp`, `better-sqlite3`) require a full rebuild when first added — `docker-compose build --no-cache` **and** `docker-compose down -v && docker-compose up -d`. Skipping `down -v` leaves the stale anonymous `node_modules` volume in place and the package stays missing.

---

### Option B — PM2 (production / HTTPS server)

**Prerequisites:** Node.js 18+, PM2 (`npm install -g pm2`)

```bash
git clone https://github.com/irmakh/rpg-play.git
cd rpg-play/Application

npm install

cp .env.example .env
# Edit .env with your values
```

```bash
pm2 start server.js --name dnd
pm2 save
pm2 startup   # auto-start on reboot
```

---

### HTTPS / SSL (Let's Encrypt)

The server supports HTTPS natively — no reverse proxy required. It listens on 443 (HTTPS) and 80 (HTTP → HTTPS redirect).

**1. Obtain a certificate:**
```bash
sudo certbot certonly --standalone -d your-domain.com
```

**2. Set environment variables:**
```bash
SSL_KEY=/etc/letsencrypt/live/your-domain.com/privkey.pem
SSL_CERT=/etc/letsencrypt/live/your-domain.com/fullchain.pem
PORT=443
```

**3. Auto-renew:** `renew-cert.sh` (project root) stops the app to free port 80, runs certbot, and restarts. Add it to cron:

```bash
# /etc/cron.d/cert-renewal
0 3 1 * * root /path/to/rpg-play/renew-cert.sh >> /var/log/cert-renewal.log 2>&1
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_PROVIDER` | Yes | `instantdb` | `localdb` or `instantdb` |
| `MASTER_PASSWORD` | Yes | — | Super-admin password: unlocks any campaign, required to create/delete campaigns, seeds the first campaign’s DM password on migration. Per-campaign DM passwords live in `campaigns.db` |
| `PORT` | No | `3000` | Port the server listens on (use `443` for HTTPS) |
| `SSL_KEY` | No | — | Path to TLS private key (enables HTTPS) |
| `SSL_CERT` | No | — | Path to TLS certificate chain (enables HTTPS) |
| `INSTANT_APP_ID` | InstantDB only | — | InstantDB application ID |
| `INSTANT_ADMIN_TOKEN` | InstantDB only | — | InstantDB admin token |
| `HOST_PORT` | Docker only | `3000` | Port exposed on the host machine |
| `WS_URL` | No | auto | Override WebSocket URL (e.g. `wss://your-domain.com/ws`) |
| `CAMPAIGNS_DB` | No | `Application/campaigns.db` | Override the campaign registry file |
| `CAMPAIGN_DATA_DIR` | No | `Application/data/campaigns` | Override where per-campaign databases live |

---

## Tech Stack

- **Backend:** Node.js (ES modules), Express — split into 15 semantic route modules under `server/routes/`, with a lean `server.js` entry point
- **Database:** SQLite (`better-sqlite3`) for `localdb` / [InstantDB](https://www.instantdb.com) for cloud. One cross-tenant registry (`campaigns.db`) plus four SQLite files per campaign under `data/campaigns/<id>/`; multi-tenancy is `localdb` only
- **Real-time:** WebSocket (`ws`) for `localdb` / Server-Sent Events for cloud
- **Frontend:** Vanilla JS, HTML, CSS — no build step, no framework, no bundler. The character sheet is 15 modules under `js/index/`, the table is 14 under `js/table/`, with shared helpers in `js/lib/`
- **Dice:** 3D CSS dice (icosahedron d20, pentagonal-trapezohedron d10) driven by a shared `dice-engine.js`
- **Image processing:** `sharp` — each upload generates `_thumb.webp` (80×80 crop) and `_medium.webp` (max 500 px); maps excluded
- **PWA:** Service Worker (`sw.js`) — network-first for HTML, cache-first for versioned static assets
- **Tests:** ~20 Vitest files (unit + API) covering the sheet, table, dice fairness, and routes
- **SSL:** Node.js native `https` with Let's Encrypt certificates

### Frontend cache-busting

Static JS/CSS is served `immutable` and cached by URL forever; the server injects `?v=N` into every `src`/`href` at request time. On any frontend change, bump **both** `FRONTEND_VERSION` in `server.js` and the `CACHE` version in `public/sw.js` together so the URLs change and clients fetch the new files. HTML is served `no-store`, so it always carries the current version.

---

## Project Structure

High-level layout — see **[structure.md](structure.md)** for the complete, annotated file tree.

```
char_sheet/
├── Application/            # The web app
│   ├── server.js           #   Express entry point — loads route modules + shared context
│   ├── server/routes/      #   15 Express route modules
│   ├── lib/                #   Request context (campaign scoping) + password hashing
│   ├── db/                 #   SQLite layers (campaignsdb, campaign-store, localdb, mediadb, storiesdb)
│   ├── aiDM/               #   AI Dungeon Master module (own DB + routes)
│   ├── tests/              #   24 Vitest unit + API suites (750 tests)
│   └── public/             #   Served frontend
│       ├── *.html          #     Page entry points (campaigns, index, table, dm, treasury, events, …)
│       ├── js/index/       #     14 character-sheet modules
│       ├── js/table/       #     15 virtual-table modules
│       ├── js/lib/         #     Shared utilities (dice engine, chat render, calendar, …)
│       ├── console/        #     Mobile companion PWA
│       ├── css/  img/      #     Styles and static images
│       ├── sw.js           #     Service worker (PWA cache)
│       └── uploads/  story-images/   #   Runtime user uploads
├── goals/ tools/ context/ args/ hardprompts/   # GOTCHA framework layers (see CLAUDE.md)
├── memory/  data/          # Persistent cross-session memory (Application/data/ holds campaign DBs)
├── docker-compose.yml  Dockerfile.dev  docker-*.sh   # Docker deployment
├── renew-cert.sh          # Let's Encrypt renewal (PM2-aware)
└── CLAUDE.md  README.md  FEATURES.md  DOCKER.md  structure.md
```

📁 **Full file listing:** [structure.md](structure.md)

---

## Troubleshooting

**Port already in use (Docker)**
```bash
HOST_PORT=3001   # change in .env
docker-compose up -d
```

**Container won't start**
```bash
docker-compose logs
docker-compose down -v
docker-compose build --no-cache && docker-compose up -d
```

**Reset all data (start fresh)**
```bash
docker-compose down
rm Application/*.db
docker-compose up -d
```

**Frontend won't update on mobile**
Bump `FRONTEND_VERSION` (`server.js`) and the `sw.js` `CACHE` together, redeploy, then on the device clear site data / reinstall the PWA once to drop the old service worker.

**Windows — Docker file sharing issues**
Docker Desktop → Settings → Resources → File Sharing → enable your drive.
