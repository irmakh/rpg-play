# RPG Play — D&D 5e Virtual Tabletop

A self-hosted web app for running D&D 5e sessions. It bundles a full character sheet, a shared virtual battle map, a real-time initiative tracker, a monster library, loot and merchant managers, a synced music player, an AI Dungeon Master, a comic-style story builder, and a mobile companion — all kept live across every connected browser with no external cloud required.

Vanilla JS, no build step, no framework. Runs on SQLite by default; nothing to provision.

---

## Feature Overview

### Character Sheet (`/`)
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
- Player-facing tabs: **Shop** (browse by tag, cart, buy with in-character currency), **Loot** (claim dropped items), **Initiative** (slide-out tracker with roll submission), **Calendar** (Calendar of Harptos — DM events plus your own journals with media)
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
- Data backup / restore: per-section JSON export, non-destructive merge import
- **Raw database backup:** one-click download of all SQLite databases (`localdb`, `media`, `stories`, `aiDM`) as-is, bundled into a single streamed `.tar.gz` for full off-site backup (uploaded media under `uploads/` is stored separately and not yet included)
- Multiple themes

### DM Calendar (`/events.html`) — DM only
- Full **Calendar of Harptos** (Forgotten Realms): 12 months × 30 days as three tendays × 10 columns
- Festival rows between months: Midwinter, Greengrass, Midsummer, Shieldmeet (leap years), Highharvestide, The Feast of the Moon
- Dale Reckoning year names for years 1–1600 (e.g. 1492 DR — Year of Three Ships Sailing)
- **Campaign date control:** advance a day at a time or jump to any date/festival; current date highlighted in gold
- **Events:** title, description, type (session / combat / travel / milestone / rest / note), public or DM-only; public events broadcast live to player calendars over SSE
- **Media attachments:** attach images, video, or audio to any event (one per upload, 25 MB cap; images get auto-generated thumbnails)

### Player Calendar (tab on `/`)
- Calendar showing DM-published public events, the player's own journals, and the current campaign date (live via SSE)
- **Player journals** — players author their own dated entries from the calendar (**+Journal** button). A journal defaults to **shared** (visible to everyone) or can be kept **private** (visible only to the DM and its author); each entry can carry media attachments. Players can edit and delete only their own journals
- Visibility rule: a viewer sees an event if they are the DM, the event is public, or they authored it
- Click a day to filter its events; **Go to Today** jumps back to the campaign date; ← / → month navigation

### Merchant Shop (`/merchant.html`) — DM only
- Add / edit / delete items with full D&D data: type, price (PP/GP/EP/SP/CP), quantity, AC / initiative / speed / spell bonuses, attunement, weapon properties, notes
- Tagging into collapsible sections, bulk tag assignment, bulk delete, tag autocomplete
- Shop open / closed toggle; **open shop directly to a tag** for players; real-time purchase log and inventory sync

### Loot Manager (`/loot.html`) — DM only
- Add / edit / delete loot (name, description, quantity, value); tagging with collapsible sections and bulk ops
- Import loot from JSON; show / hide the loot panel to players; players claim from their sheet; claim log records who and when

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

- Unified **login screen** (`/login.html`) before any page. **Character tab:** name + password (first-login setup for passwordless characters). **DM tab:** master password for DM access everywhere
- The DM can also log in **as any character** by using the master password in the character tab
- Sessions live in `sessionStorage` — closing the tab logs out; HTML pages have auth guards that redirect unauthenticated access to login
- **Stories** use a separate gate (`/api/auth/verify-any`) accepting the DM or any character password, auto-bypassed when already logged in
- Token movement on the table is intentionally **open to all players** (DM retains full control); DM-only controls stay hidden until the master password is entered

---

## Pages at a Glance

| Page | URL | Who |
|---|---|---|
| Login | `/login.html` | All users |
| Character Sheet | `/` | Players |
| Virtual Table | `/table.html` | Players + DM |
| DM Dashboard | `/dm.html` | DM |
| DM Calendar | `/events.html` | DM |
| Monster Library | `/monsters.html` | DM |
| Map Prep | `/prepare-map.html` | DM |
| Merchant | `/merchant.html` | DM |
| Loot | `/loot.html` | DM |
| Music & Sounds | `/playlists.html` | DM |
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
| `MASTER_PASSWORD` | Yes | — | DM master password for all protected screens |
| `PORT` | No | `3000` | Port the server listens on (use `443` for HTTPS) |
| `SSL_KEY` | No | — | Path to TLS private key (enables HTTPS) |
| `SSL_CERT` | No | — | Path to TLS certificate chain (enables HTTPS) |
| `INSTANT_APP_ID` | InstantDB only | — | InstantDB application ID |
| `INSTANT_ADMIN_TOKEN` | InstantDB only | — | InstantDB admin token |
| `HOST_PORT` | Docker only | `3000` | Port exposed on the host machine |
| `WS_URL` | No | auto | Override WebSocket URL (e.g. `wss://your-domain.com/ws`) |

---

## Tech Stack

- **Backend:** Node.js (ES modules), Express — split into 12 semantic route modules under `server/routes/`, with a lean `server.js` entry point
- **Database:** SQLite (`better-sqlite3`) for `localdb` / [InstantDB](https://www.instantdb.com) for cloud; stories and the AI DM each use their own SQLite DB
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
│   ├── server/routes/      #   12 Express route modules
│   ├── db/                 #   SQLite layers (localdb.js, storiesdb.js)
│   ├── aiDM/               #   AI Dungeon Master module (own DB + routes)
│   ├── tests/              #   ~20 Vitest unit + API suites
│   └── public/             #   Served frontend
│       ├── *.html          #     Page entry points (index, table, dm, events, monsters, …)
│       ├── js/index/       #     15 character-sheet modules
│       ├── js/table/       #     14 virtual-table modules
│       ├── js/lib/         #     Shared utilities (dice engine, chat render, calendar, …)
│       ├── console/        #     Mobile companion PWA
│       ├── css/  img/      #     Styles and static images
│       ├── sw.js           #     Service worker (PWA cache)
│       └── uploads/  story-images/   #   Runtime user uploads
├── goals/ tools/ context/ args/ hardprompts/   # GOTCHA framework layers (see CLAUDE.md)
├── memory/  data/          # Persistent cross-session memory
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
