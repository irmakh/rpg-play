# RPG Play — D&D 5e Virtual Tabletop

A self-hosted web application for running D&D 5e sessions. Includes a full character sheet, shared virtual battle map, real-time initiative tracker, monster library, loot manager, merchant shop, and DM tools — all synced live across every connected browser with no external cloud required.

---

## Feature Overview

### Character Sheet (`/`)
- Full D&D 5e character sheet: ability scores, skills, saving throws, HP, AC, speed, initiative (all auto-calculated)
- Proficiency bonus auto-derived from level
- Spell slot tracking with per-level counters and prepared spell count
- Weapon attacks table with custom dice rolls; weapon notes shown in damage chat
- Equipment / magic items panel: equipped items feed AC, initiative, and speed auto-calc; items with spell bonuses supported
- Portrait image upload and media attachments (images, video)
- Image and video lightbox — clicking any media card opens a fullscreen viewer; videos autoplay with full controls
- Spell table with **clickable column sort** — click any header (Prep/Lvl/Name/Time/Range/Conc/Ritual/School) to sort ascending / descending with ▲/▼ indicator
- Inventory, features & traits, background, and notes tabs
- Dice rolling with full 3D animation — results broadcast to the virtual table in real time
- Advantage / disadvantage rolls with dual-die animation
- Roll history log per character
- Import / export character as XML (compatible with D&D Beyond XML export format)
- Per-character password protection (set, change, or remove)
- Multiple characters supported — player selects from a list
- Player-facing shop tab: browse items by tag, add to cart, purchase with in-character currency
- Player-facing loot tab: claim dropped loot items
- Player-facing initiative tracker panel (slide-out) with roll submission and NPC add
- Player-facing calendar tab (read-only Calendar of Harptos with DM-published events)
- Real-time chat panel: type free text or use `/r NdS+M [label]` to roll dice (e.g. `/r 2d6+3`, `/r d20 Stealth`)
- 3D dice animation overlay shown locally when rolling and for any roll broadcast from the table
- Three themes: Dark Gold, Parchment, Midnight

### Virtual Table (`/table.html`)
- Shared battle map with configurable grid overlay
- Upload any image as the map background
- Token system — place PC, NPC, and monster tokens on the grid
- Token portraits (per character, per monster); thumbnails auto-generated at upload
- Drag-and-drop token movement (500 ms hold delay prevents accidental moves on click)
- Token HP tracking panel: damage, heal, temp HP, death saves, **AC display** (fetched live from character/monster data)
- HP bar overlay on each token (colour shifts green → yellow → red)
- Movement distance tracking per token (feet moved, reset each turn)
- Monster name hidden from players — shown only as an identifier (e.g. "Goblin #2"); **token identifier editable** by DM directly from the side panel
- Monster visibility toggle: DM shows / hides monsters from players in real time
- **Monster token quick-roll panel** — click a monster token to open the side panel with full dice rolling: saves, skills, ability checks, damage rolls, initiative (advantage / disadvantage / normal modal)
- **Monster actions panel** — collapsible section above the stat block listing all monster actions; each action has a **Use** button that posts the action text and a damage roll to the chat
- Fog of war regions — DM draws, players see darkness; DM can reveal or re-hide per region
- Hidden map items (traps, chests, doors, notes): DM can reveal or hide individually
- Panel hover highlighting — hovering a fog region or item highlights its location on the canvas
- Drawing tools: freehand, line, arrow, rectangle, circle; choose colour and stroke weight
- Ruler tool: click-drag to measure distances in feet
- Ping tool: click to place a temporary visible marker for all players
- Zoom in / out
- Prepared map selector: load a map preset saved in Map Prep
- Permanent left sidebar — initiative tracker and chat in a fixed 240 px panel; toolbar toggle button to collapse
- **Token assignment & unassign** — DM assigns tokens to characters; **Unassign button** appears when a token is assigned; clicking an unowned token clears the HP panel
- 3D dice animation overlay for all rolls (including rolls broadcast from the character sheet)
- Real-time chat panel: type free text or use `/r NdS+M [label]` to roll dice; **damage rolls show a description** (weapon name / action name) in all chat messages; media sharing also supported
- DM unlock via master password (DM controls remain hidden until unlocked)

### DM Dashboard (`/dm.html`)
- Initiative tracker with full CRUD: add PCs and NPCs, set initiatives, reorder, edit, delete
- Start / stop combat, advance turns, previous turn, skip turn
- Clean Orphans button to remove stale initiative entries without disrupting a running encounter
- Monster library table: search, filter, add to initiative with a single click; monster identifier shown in initiative rolls in chat
- Monster info popup: full stat block view inline
- Media sharing panel: drag-and-drop image / video upload → shared instantly to the table chat
- DM chat panel: type free text or use `/r NdS+M [label]` to roll dice; roll broadcasts the 3D animation to all connected screens; **per-message delete** (✕ button, removes from all clients in real time)
- Data backup: download a full JSON snapshot of all application data (per-section selective export)
- Data restore: upload a backup JSON to restore (non-destructive merge — does not wipe existing data)
- Multiple themes

### DM Calendar (`/events.html`) — DM only
- Full **Calendar of Harptos** (Forgotten Realms calendar system)
- 12 months × 30 days, displayed as three tendays (1st. / 2nd. / 3rd.) × 10 columns per row
- Festival days shown as distinct rows between months: Midwinter, Greengrass, Midsummer, Shieldmeet (leap years only, every 4 DR years), Highharvestide, The Feast of the Moon
- Year names for all years 1–1600 in the Dale Reckoning system (e.g. 1492 DR — Year of Three Ships Sailing)
- **Campaign date control:** DM sets the current campaign date; advance one day at a time (◀ Day / Day ▶) or jump to any specific date or festival
- **Event creation:** add campaign events to any day or festival — title, description, event type (session / combat / travel / milestone / rest / note), and public / DM-only visibility flag
- Public events broadcast live to all player calendars via SSE when created, edited, or deleted
- Gold highlight marks the current campaign date on the grid; colour-coded dots show events per day

### Player Calendar (tab on `/`)
- Read-only calendar tab on the character sheet — players access it alongside their other tabs
- Shows only events the DM has marked as public
- Displays the current campaign date set by the DM (updates live via SSE)
- Click any day cell to filter the events list to that specific day; click again or use the back link to return to the full month view
- Month navigation with ← / → arrows; **Go to Today** button jumps back to the campaign date

### Merchant Shop (`/merchant.html`) — DM only
- Add, edit, and delete shop items with full D&D item data: type, price (PP/GP/EP/SP/CP), quantity, AC bonus, initiative bonus, speed bonus, spell bonus, attunement, weapon properties, and notes
- Item tagging: group items into collapsible tag sections (e.g. Weapons, Potions, Quest Items)
- Bulk tag assignment and bulk delete across selected items
- Tag autocomplete from existing tags
- Shop open / closed toggle: players see items only when the shop is open
- **Open shop by tag:** DM can push players directly to a specific tag section in the shop
- Real-time purchase log: every player purchase is recorded with character, item, quantity, and amount
- Real-time sync — inventory updates broadcast to all connected clients immediately

### Loot Manager (`/loot.html`) — DM only
- Add, edit, and delete loot items with name, description, quantity, and value
- Item tagging with collapsible sections and bulk tag operations
- Bulk delete
- Import loot from a JSON file
- Loot visibility control: show / hide the loot panel to players
- Players claim items from the loot tab on their character sheet
- Claim log: records who claimed what and when

### Map Prep (`/prepare-map.html`) — DM only
- Upload a map image and configure grid size
- Draw fog of war regions on the prep canvas
- Place hidden items (markers with labels) on the map
- Save named map presets; load any preset to the live table instantly
- Export a map as a `.map.json` file; import on another instance
- Delete saved maps

### Monster Library (`/monsters.html`) — DM only
- Full monster stat blocks: abilities, skills, saving throws, senses, CR, HP, AC, speed, traits, actions, legendary actions
- Monster portrait upload
- Import monsters from XML (D&D Beyond / D&D 5e tools format) — bulk import with non-destructive merge
- **Single-monster JSON export** with portrait image embedded — Export button per monster on both library and DM screens
- **Single-monster JSON import** — auto-detected by `type: "monster"` field, non-destructive
- Add any monster directly to the initiative tracker from the library
- Search and filter by name

### Music & Sound Player (`/playlists.html`) — DM only
- Upload sound / music files and organize them into named playlists
- Playlists display with track listing; DM can reorder, rename, and delete tracks
- **DM playback controls on the table:** play, stop, seek (seek bar affects all listeners simultaneously)
- **Loop modes:** No Loop / Track Loop (repeats current track) / Playlist auto-advance (plays next track on end)
- All connected clients hear audio in real time — background audio syncs to every browser tab
- **Now-playing bar** visible to all clients showing current track name and playback state
- **Song duration** displayed for all clients next to the now-playing bar
- New clients joining mid-session automatically receive the current position and start from there
- Loading / playing / paused state notifications broadcast to all clients

### Mobile Companion PWA (`/table-console.html`)
- Installable Progressive Web App for phone or tablet — works offline after first load
- Full session sync with the main table: shows the same initiative order, HP, and state
- **Actions tab** — quick-access panel for common actions
- **DM controls in companion:** token visibility toggle and character assignment from the phone
- **D-pad arrows** on the map screen — move the selected token from the companion without touching the main display
- Safe-area padding for notched / punched-hole phones (iOS and Android)
- Companion app and main table stay in sync via SSE; no page refresh needed

---

## Authentication & Login

- All users go through a unified **login screen** (`/login.html`) before accessing any page
- **Character tab:** enter your character name and password (setup flow for passwordless characters on first login)
- **DM tab:** enter the master password to get DM access across all screens
- Sessions stored in `sessionStorage` — closing the tab logs out; the browser back button does not re-enter protected pages without re-authenticating
- All 8 HTML pages have auth guards — unauthenticated access redirects to login
- **Token ownership enforcement on the table:** players can only move and interact with tokens assigned to their character; DM retains full control
- Character-role users see their own password / export buttons; DM-only controls remain hidden

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
| Mobile Companion | `/table-console.html` | All users |

---

## Database Modes

| Mode | Description |
|---|---|
| `localdb` | SQLite + WebSocket. No cloud required. Best for LAN or self-hosted play. |
| `instantdb` | Cloud database via [InstantDB](https://www.instantdb.com). Accessible from anywhere. |

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

> **Note:** `sharp` (native image-processing addon) requires a full rebuild (`--no-cache` + `down -v`) when first adding it — skipping `down -v` leaves the stale anonymous volume in place.

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

The server natively supports HTTPS — no reverse proxy required. It listens on port 443 (HTTPS) and port 80 (HTTP → HTTPS redirect).

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

**3. Renew certificates automatically:**

`renew-cert.sh` in the project root handles renewal — it stops the app (to free port 80), runs certbot, and restarts. Add it to cron:

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

- **Backend:** Node.js, Express
- **Database:** SQLite (`better-sqlite3`) for `localdb` mode / [InstantDB](https://www.instantdb.com) for cloud mode
- **Real-time:** WebSocket (`ws`) for `localdb` mode / Server-Sent Events (SSE) for cloud mode
- **Frontend:** Vanilla JS, HTML, CSS — no build step, no framework, no bundler
- **Image processing:** `sharp` — every upload generates `_thumb.webp` (80×80 crop) and `_medium.webp` (max 500 px); maps excluded
- **PWA:** Service Worker (`sw.js`) for offline caching on the companion app
- **SSL:** Node.js native `https` module with Let's Encrypt certificates

---

## Project Structure

```
rpg-play/
├── Application/
│   ├── server.js               # Express server, all API routes, WebSocket broadcast
│   ├── db/
│   │   └── localdb.js          # SQLite database layer (better-sqlite3)
│   └── public/
│       ├── index.html          # Character sheet
│       ├── table.html          # Virtual battle table
│       ├── dm.html             # DM dashboard
│       ├── events.html         # DM Calendar (Calendar of Harptos)
│       ├── monsters.html       # Monster library
│       ├── prepare-map.html    # Map prep tool
│       ├── merchant.html       # Merchant shop manager
│       ├── loot.html           # Loot manager
│       ├── playlists.html      # Music & sound player manager
│       ├── login.html          # Login screen (all users)
│       ├── table-console.html  # Mobile companion PWA
│       ├── sw.js               # Service worker (PWA offline cache)
│       ├── js/
│       │   ├── index/          # 14 modules for the character sheet
│       │   ├── table/          # 12 modules for the virtual table
│       │   └── lib/            # Shared utilities (dice engine, chat render, lightbox, calendar, etc.)
│       ├── css/                # Stylesheets
│       └── img/                # Static images
├── renew-cert.sh               # Let's Encrypt renewal script (PM2-aware)
├── Dockerfile.dev
├── docker-compose.yml
├── docker-start.sh
├── docker-stop.sh
├── .env.docker                 # Environment template for Docker
└── .env.template               # General environment template
```

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

**Windows — Docker file sharing issues**
Docker Desktop → Settings → Resources → File Sharing → enable your drive.
