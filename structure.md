# Project Structure

Complete file tree of the RPG Play repository — **git-tracked files only**. Untracked/ignored content (`node_modules/`, `.git/`, runtime uploads under `public/uploads/` and `public/story-images/`, local `.db` files, `.env`, daily memory logs, sample XML imports) is excluded.

← Back to [README.md](README.md)

*Last updated: 2026-09-27 (frontend v242).*

---

## Full Tree

```
char_sheet/
├── Application/                        # The web app (Node.js + Express + vanilla JS frontend)
│   ├── db/                             # Database layers (one set of files PER CAMPAIGN)
│   │   ├── campaign-store.js           #   Opens/caches each campaign’s DBs; provisions + migrates
│   │   ├── campaignsdb.js              #   Campaign registry (names, covers, hashed DM passwords, sessions)
│   │   ├── localdb.js                  #   openCampaignDb() — characters, media, tokens, …
│   │   ├── mediadb.js                  #   openMediaDb() — chat images + table map blob
│   │   └── storiesdb.js                #   openStoriesDb() — stories and sequences
│   ├── lib/                            # Cross-cutting server helpers
│   │   ├── auth.js                     #   Token checks: masterAuth, charAuth, sessionAuth (any login to this campaign)
│   │   ├── captcha.js                  #   In-house maths captcha, rendered to PNG by sharp
│   │   ├── login-guard.js              #   Failed-login lockout per address + account
│   │   ├── passwords.js                #   Async scrypt hash/verify (salt:hash)
│   │   ├── realtime-audience.js        #   Who each live connection is, and which events it may receive
│   │   ├── request-context.js          #   AsyncLocalStorage campaign scope + db proxies
│   │   ├── security-middleware.js      #   Security headers, session gate, body limits by caller
│   │   ├── sessions.js                 #   Opaque session tokens (stored as SHA-256) + setup tickets
│   │   └── upload-paths.js             #   The one rule for resolving upload paths safely
│   ├── public/                         # Served frontend (HTML / CSS / JS + PWA)
│   │   ├── console/                    #   Mobile companion PWA (d20 + companion screens)
│   │   │   ├── index.html              #     Companion PWA launcher
│   │   │   ├── manifest-d20-companion.json  # PWA manifest — companion info screen
│   │   │   ├── manifest-d20.json       #     PWA manifest — tactical map screen
│   │   │   ├── manifest.json           #     PWA manifest — launcher
│   │   │   ├── table-console.html      #     Primary map screen (Screen 1)
│   │   │   └── table-secondary.html    #     Secondary info screen (Screen 2)
│   │   ├── css/                        #   Stylesheets
│   │   │   ├── console/                #     Companion styles
│   │   │   │   └── table-console.css   #       Console screen styles
│   │   │   ├── app-shell.css           #     Full-height DM tool layout
│   │   │   ├── base.css                #     Lamplit design primitives (scoped to html.lamplit)
│   │   │   ├── calendar.css            #     Calendar of Harptos styles
│   │   │   ├── campaigns.css           #     Campaign picker styles (master-detail)
│   │   │   ├── dm.css                  #     DM dashboard styles
│   │   │   ├── fonts.css               #     Self-hosted webfonts (work offline)
│   │   │   ├── handouts.css            #     Handout manager styles (master-detail)
│   │   │   ├── index.css               #     Character sheet styles
│   │   │   ├── loot.css                #     Retired loot manager styles (page redirects to Treasury)
│   │   │   ├── merchant.css            #     Retired merchant shop styles (page redirects to Treasury)
│   │   │   ├── monsters.css            #     Monster library styles
│   │   │   ├── notifications.css       #     Notification bell, panel and toasts
│   │   │   ├── stories.css             #     Stories (dashboard/builder/viewer) styles
│   │   │   ├── table-sheet-popout.css  #     Scoped layout for the popped-out character sheet
│   │   │   ├── table-theme-modern.css  #     Modern HUD table theme
│   │   │   ├── table.css               #     Virtual table styles
│   │   │   ├── tokens.css              #     Design tokens — loaded first on every page
│   │   │   ├── treasury.css            #     Treasury manager styles (master-detail)
│   │   │   ├── waiting-screens.css     #     Waiting-screen manager styles
│   │   │   └── weather.css             #     Weather sprite icons, tooltip, table widget
│   │   ├── fonts/                      #   Self-hosted webfonts (Atkinson Hyperlegible, Fraunces)
│   │   ├── img/                        #   Static images & PWA icons
│   │   │   ├── parchment/              #     Parchment theme assets
│   │   │   │   ├── bg.jpeg             #       Theme background
│   │   │   │   └── header.jpeg         #       Theme header
│   │   │   ├── icon-192.png            #     PWA icon (192px)
│   │   │   ├── icon-512.png            #     PWA icon (512px)
│   │   │   ├── weather.jpeg            #     Weather icon sprite (source)
│   │   │   └── weather.png             #     Weather icon sprite
│   │   ├── js/                         #   Frontend scripts
│   │   │   ├── console/                #     Companion PWA scripts
│   │   │   │   ├── secondary.js        #       Secondary info screen (own live connection + state)
│   │   │   │   └── table-console.js    #       Primary↔secondary sync bridge
│   │   │   ├── index/                  #     Character sheet — 15 modules
│   │   │   │   ├── index-actions.js    #       Actions tab (weapons + action spells + custom actions)
│   │   │   │   ├── index-calc.js       #       AC / init / speed / derived stat calc
│   │   │   │   ├── index-calendar.js   #       Player calendar tab
│   │   │   │   ├── index-char.js       #       Character data load/save + XML import/export
│   │   │   │   ├── index-dice.js       #       Dice rolling + roll history + toast
│   │   │   │   ├── index-dice3d.js     #       3D dice animation + chat posting
│   │   │   │   ├── index-handouts.js   #       Handouts tab — blind Examine, unread badge
│   │   │   │   ├── index-initiative.js #       Player initiative tracker panel
│   │   │   │   ├── index-items.js      #       Inventory / equipment
│   │   │   │   ├── index-main.js       #       Bootstrap + event wiring
│   │   │   │   ├── index-media.js      #       Portrait + media attachments
│   │   │   │   ├── index-realtime.js   #       Live sync
│   │   │   │   ├── index-state.js      #       Shared mutable state, session, sheetAuthHeaders()
│   │   │   │   ├── index-treasury.js   #       Treasury tab — Free Loot / Shop segments, carts, claimed loots
│   │   │   │   └── index-utils.js      #       Ability/modifier helpers
│   │   │   ├── lib/                    #     Shared frontend utilities — 16 files
│   │   │   │   ├── auth-ui.js          #       Login helpers + captcha widget for every password form
│   │   │   │   ├── chat-pm.js          #       Private messages: recipient picker, own credential headers
│   │   │   │   ├── chat-render.js      #       Render chat messages; sanitises HTML message bodies
│   │   │   │   ├── desktop-link.js     #       Offers the Windows desktop client to browser users
│   │   │   │   ├── dice-engine.js      #       3D dice engine (d20 icosahedron, d10 trapezohedron)
│   │   │   │   ├── dnd-data.js         #       D&D 5e constants (skills, abilities)
│   │   │   │   ├── esc.js              #       esc() / escJs() — escaping for markup and inline handlers
│   │   │   │   ├── fr_calendar.js      #       Calendar of Harptos logic
│   │   │   │   ├── icons.js            #       Stroke icon sprite (replaces emoji as UI icons)
│   │   │   │   ├── lightbox.js         #       Fullscreen image/video viewer
│   │   │   │   ├── modal-guard.js      #       Backdrop/Escape guard so a filled-in modal is never lost
│   │   │   │   ├── music-sync.js       #       Music audio ownership across windows on one machine
│   │   │   │   ├── notifications.js    #       Notification bell, feed and toasts
│   │   │   │   ├── realtime.js         #       WS/SSE transport (session token), force-reload, campaign guard
│   │   │   │   ├── stories-auth.js     #       Stories login gate + authenticated fetch
│   │   │   │   └── weather-ui.js       #       Shared weather icons, tooltip, day markers
│   │   │   ├── table/                  #     Virtual table — 17 modules
│   │   │   │   ├── table-addtoken.js   #       Add-token modal
│   │   │   │   ├── table-auth.js       #       Session load, authHeaders(), logout
│   │   │   │   ├── table-chat.js       #       Table chat, dice broadcast, info cards
│   │   │   │   ├── table-handouts.js   #       Handout pop-up, right-panel tab, multi-character hand-out modal
│   │   │   │   ├── table-hppanel.js    #       HP panel + group ability/save rolls
│   │   │   │   ├── table-initiative.js #       Initiative tracker UI
│   │   │   │   ├── table-main.js       #       Bootstrap + DM tools modal
│   │   │   │   ├── table-map.js        #       Canvas, tokens, drawing, fog, ruler, ping
│   │   │   │   ├── table-monsters.js   #       Monster tokens + stat block
│   │   │   │   ├── table-music.js      #       Synced music playback
│   │   │   │   ├── table-panel.js      #       Right-side token quick-roll panel
│   │   │   │   ├── table-popout.js     #       Pop panels into separate windows
│   │   │   │   ├── table-realtime.js   #       Live event handling
│   │   │   │   ├── table-state.js      #       Shared state + session
│   │   │   │   ├── table-utils.js      #       Helpers (canvas pos, display names, HP colours)
│   │   │   │   ├── table-waiting.js    #       Waiting-screen overlay, picker + pop-out lock
│   │   │   │   └── table-weather.js    #       Toolbar weather widget for the current date
│   │   │   ├── campaigns.js            #     Campaign picker — list, detail, login, create/settings/delete
│   │   │   ├── dm.js                   #     DM dashboard
│   │   │   ├── events.js               #     DM calendar + weather roller
│   │   │   ├── handouts.js             #     Handout manager (DM) — authoring, hand-out, outcome tagging
│   │   │   ├── login.js                #     Login screen logic (campaign-scoped)
│   │   │   ├── loot.js                 #     Retired loot manager (page redirects to Treasury)
│   │   │   ├── maintenance.js          #     Maintenance page — clients, sessions, lockouts, login activity
│   │   │   ├── merchant.js             #     Retired merchant manager (page redirects to Treasury)
│   │   │   ├── monster-stat-block.js   #     Shared monster stat-block renderer
│   │   │   ├── monsters.js             #     Monster library (DM)
│   │   │   ├── prepare-map.js          #     Map prep tool (DM) — fetches map images with the DM login
│   │   │   ├── treasury.js             #     Treasury manager (DM) — master-detail, images, ledger
│   │   │   └── waiting-screens.js      #     Waiting-screen manager (DM) — images, captions, show/close
│   │   ├── campaigns.html              #   Campaign picker — served at / (the front door)
│   │   ├── dm.html                     #   DM dashboard page
│   │   ├── events.html                 #   DM calendar page
│   │   ├── handouts.html               #   Handout manager page (DM)
│   │   ├── index.html                  #   Character sheet page
│   │   ├── login.html                  #   Login page (all users)
│   │   ├── loot.html                   #   Retired — server 301-redirects /loot.html to /treasury.html
│   │   ├── maintenance.html            #   Unlisted super-admin diagnostics
│   │   ├── manifest.json               #   Main app PWA manifest
│   │   ├── merchant.html               #   Retired — server 301-redirects /merchant.html to /treasury.html
│   │   ├── monsters.html               #   Monster library page
│   │   ├── music.html                  #   Music player — DM controls or player readout;
│   │   │                               #   standalone window, table modal iframe, desktop app
│   │   ├── music-player.html           #   Redirect stub -> music.html (old pop-out URL)
│   │   ├── playlists.html              #   Music library: sound uploads & playlist editing (DM)
│   │   ├── prepare-map.html            #   Map prep page
│   │   ├── stories.html                #   Story dashboard page
│   │   ├── story-builder.html          #   Story editor page (panels, cast, images and videos)
│   │   ├── story-viewer.html           #   Story viewer page (grid / strip)
│   │   ├── sw.js                       #   Service worker (PWA cache; version-synced with FRONTEND_VERSION)
│   │   ├── table.html                  #   Virtual table page
│   │   ├── treasury.html               #   Treasury manager page (loot + shop, DM)
│   │   └── waiting-screens.html        #   Waiting-screen manager page (DM)
│   ├── scripts/
│   │   └── seed_demo_data.py           #   Seeds a demo campaign with sample data
│   ├── server/                         # Backend
│   │   ├── notify.js                   #   Notification emitter — ctx.notify(), fan-out + coalescing
│   │   └── routes/                     #   17 Express route modules (each exports register(app, ctx))
│   │       ├── auth.js                 #     Login, logout, captcha, passwords, stories gate
│   │       ├── backup.js               #     Per-section JSON export / restore, raw database backup
│   │       ├── campaigns.js            #     Campaign registry API — list/detail/enter/create/settings/delete
│   │       ├── characters.js           #     Character CRUD, quick-roll, roll history, spell slots
│   │       ├── chat.js                 #     Chat, private messages, image sharing, dice broadcast, drawings
│   │       ├── events.js               #     Calendar dates, events, journals & media, weather
│   │       ├── handouts.js             #     Handouts: two bodies, blind server-side check, DM confirm
│   │       ├── initiative.js           #     Initiative CRUD + turn control
│   │       ├── loot.js                 #     Legacy loot API — kept for cached clients
│   │       ├── maintenance.js          #     Connected clients, sessions, lockouts, login activity
│   │       ├── monsters.js             #     Monster library + XML/JSON import
│   │       ├── notifications.js        #     Notification feed: list, mark seen, clear
│   │       ├── shop.js                 #     Legacy shop API — kept for cached clients
│   │       ├── sound.js                #     Playlists & synced playback
│   │       ├── stories.js              #     Stories & panels (images, MP4/WebM videos)
│   │       ├── table.js                #     Tokens, map, fog, ping, prepared maps, waiting screens
│   │       └── treasury.js             #     Unified catalogue: modes, claim, purchase, images, ledger
│   ├── tests/                          # Vitest suites — 51 files, 1341 tests
│   │   ├── api/                        #   API / integration tests (19)
│   │   │   ├── auth.api.test.js        #     Login, captcha, lockout, sessions
│   │   │   ├── backup-restore.api.test.js  # Backup restore, upload-path safety
│   │   │   ├── calendar.api.test.js    #     Calendar events & journal visibility
│   │   │   ├── campaigns.api.test.js   #     Campaign registry, per-campaign DM passwords, isolation
│   │   │   ├── characters.api.test.js  #     Characters, quick-roll, roll history, spell slots
│   │   │   ├── chat.api.test.js        #     Chat per campaign, private messages, login for table writes
│   │   │   ├── handouts.api.test.js    #     Handout redaction boundary, blind roll, DC guidance
│   │   │   ├── import-roundtrip.api.test.js  # Export → import round-trips
│   │   │   ├── initiative.api.test.js  #     Initiative CRUD + turn control
│   │   │   ├── maintenance.api.test.js #     Maintenance page API
│   │   │   ├── notifications.api.test.js  #  Notification addressing and folding
│   │   │   ├── sound.api.test.js       #     Playlists & playback
│   │   │   ├── stories-context.api.test.js  # Story uploads inside the campaign context
│   │   │   ├── stories.api.test.js     #     Stories, panels, videos
│   │   │   ├── table.api.test.js       #     Tokens, map, ping, prepared maps
│   │   │   ├── treasury-requests.api.test.js  # Loot requests queue
│   │   │   ├── treasury.api.test.js    #     Treasury: modes, claim/purchase, redaction, images
│   │   │   ├── waiting-screens.api.test.js  # Waiting screens + parked table
│   │   │   └── weather.api.test.js     #     Weather config, roll and log
│   │   ├── helpers/                    #   Shared test scaffolding
│   │   │   ├── make-ldb.js             #     In-memory localdb factory
│   │   │   ├── setup.test.js           #     Global test setup
│   │   │   └── test-app.js             #     Express app builder for tests
│   │   └── unit/                       #   Unit tests (31)
│   │       ├── auth-events.test.js     #     Login audit events
│   │       ├── auth.test.js            #     lib/auth.js token checks
│   │       ├── backup-tar.test.js      #     Raw backup tar stream
│   │       ├── captcha.test.js         #     Captcha issue/verify
│   │       ├── chat-html.test.js       #     Chat HTML sanitiser
│   │       ├── dice-fairness.test.js   #     Seeded chi-square dice fairness
│   │       ├── index-actions.test.js   #     Actions tab
│   │       ├── index-calc.test.js      #     Derived-stat calc
│   │       ├── index-char-data.test.js #     Character data model
│   │       ├── index-char-xml.test.js  #     XML export, creator import, spell slots 1–9
│   │       ├── index-damage.test.js    #     Typed damage rolls
│   │       ├── index-dice-history.test.js  # Roll history
│   │       ├── index-dice.test.js      #     Dice rolling
│   │       ├── index-initiative.test.js#     Initiative panel
│   │       ├── index-items.test.js     #     Inventory/equipment
│   │       ├── index-treasury.test.js  #     Treasury tab: carts, rendering, unidentified marker
│   │       ├── index-utils.test.js     #     Ability/modifier helpers
│   │       ├── lib-esc.test.js         #     HTML-escape helper
│   │       ├── lib-upload-paths.test.js#     Upload path resolution
│   │       ├── localdb-import.test.js  #     localdb import
│   │       ├── login-guard.test.js     #     Failed-login lockout
│   │       ├── music-sync.test.js      #     Music audio ownership
│   │       ├── realtime-audience.test.js  #  Per-connection event delivery
│   │       ├── realtime.test.js        #     Frontend live transport
│   │       ├── security-middleware.test.js  # Headers, session gate, body limits
│   │       ├── sessions.test.js        #     Session tokens
│   │       ├── table-map.test.js       #     Table map/canvas
│   │       ├── table-monster-damage.test.js  # Monster damage extraction
│   │       ├── table-utils.test.js     #     Table helpers
│   │       ├── upload-paths.test.js    #     Upload paths (server wiring)
│   │       └── xss-render.test.js      #     User text stays text in the page renderers
│   ├── .env.example                    # Environment template (app)
│   ├── .gitignore                      # Git ignore rules (app)
│   ├── gaston.xml                      # Sample character export (committed reference)
│   ├── package.json                    # Dependencies & npm scripts
│   ├── server.js                       # Express entry point — loads route modules + shared context
│   └── vitest.config.js                # Vitest configuration
├── Desktop/                            # Electron desktop client (thin client over the web app), v1.0.3
│   ├── assets/                         #   Icons
│   │   ├── icon.png                    #     App icon (512px, source for the Windows .ico)
│   │   ├── tray.png                    #     Tray icon 16px
│   │   └── tray@2x.png                 #     Tray icon 32px (high-DPI)
│   ├── src/                            #   Application source
│   │   ├── main/                       #     Main process
│   │   │   ├── certs.js                #       Per-host TLS trust, pinned by fingerprint
│   │   │   ├── config.js               #       JSON settings store in userData
│   │   │   ├── downloads.js            #       Native save dialogs for backups/exports
│   │   │   ├── ipc.js                  #       Every channel the renderer can reach
│   │   │   ├── main.js                 #       Lifecycle, single instance, permission policy
│   │   │   ├── menu.js                 #       Application menu (rebuilt on display change)
│   │   │   ├── session-store.js        #       Shared login state across windows
│   │   │   ├── shortcuts.js            #       Global hotkeys
│   │   │   ├── tray.js                 #       Tray icon and menu
│   │   │   └── windows.js              #       Window roles, geometry, navigation policy
│   │   ├── preload/                    #     Preload scripts
│   │   │   ├── app-preload.js          #       Web-app windows — the sessionStorage mirror
│   │   │   └── ui-preload.js           #       Setup/settings — the configuration API
│   │   └── renderer/                   #     The app's own local pages
│   │       ├── error.html              #       Offline screen (auto-retries every 20s)
│   │       ├── error.js                #       Offline screen logic
│   │       ├── settings.html           #       Shortcuts, tray, maintenance
│   │       ├── settings.js             #       Settings logic + hotkey capture
│   │       ├── setup.html              #       First-run server picker
│   │       ├── setup.js                #       Server probe + host-mismatch warning
│   │       └── ui.css                  #       Shared styling (Dark Gold theme)
│   ├── test/
│   │   └── e2e-window-reuse.js         #   Electron end-to-end check: notification window reuse
│   ├── .gitignore                      #   Ignores node_modules/ and dist/
│   ├── README.md                       #   Build, run, and how the session mirror works
│   ├── package-lock.json               #   Dependency lockfile
│   └── package.json                    #   Electron + electron-builder config
├── retired/                            # Code kept for reference, NOT deployed
│   └── aiDM/                           #   The retired AI Dungeon Master, unchanged since v236
│       ├── public/                     #     Its frontend (ai-dm.html / .js / .css)
│       ├── scenarios/index.json        #     Built-in scenario catalogue
│       ├── README.md                   #     Why it was retired; do not revive as-is
│       ├── db.js                       #     Its SQLite layer
│       └── routes.js                   #     Its API + streaming endpoints
├── args/                               # GOTCHA: behaviour settings
│   └── README.md                       #   Layer overview / placeholder
├── context/                            # GOTCHA: domain knowledge
│   └── README.md                       #   Layer overview / placeholder
├── data/                               # GOTCHA: memory store
│   └── memory.db                       #   Searchable SQLite memory (committed)
├── goals/                              # GOTCHA: process definitions
│   ├── build_app.md                    #   Greenfield build workflow (ATLAS)
│   ├── char_sheet_dev.md               #   Feature/bugfix/optimization workflow
│   ├── extend_db_backup_uploads.md     #   Backlog: bundle public/uploads/ into raw DB backup
│   ├── fix_map_export_memory.md        #   Backlog: fix map export/import OOM via streaming
│   ├── new_dev_machine_setup.md        #   Setting up a second development machine
│   └── manifest.md                     #   Goals index
├── hardprompts/                        # GOTCHA: reusable instruction templates
│   └── README.md                       #   Layer overview / placeholder
├── memory/                             # GOTCHA: persistent memory
│   └── MEMORY.md                       #   Session-start index (daily logs are untracked)
├── tools/                              # GOTCHA: execution scripts
│   ├── memory/                         #   Memory tool scripts (Python)
│   │   ├── __init__.py                 #     Package marker
│   │   ├── embed_memory.py             #     Generate embeddings for search
│   │   ├── hybrid_search.py            #     Keyword + vector search
│   │   ├── memory_db.py                #     SQLite memory store CRUD/search
│   │   ├── memory_read.py              #     Load MEMORY.md + recent logs
│   │   ├── memory_write.py             #     Write events / facts / logs
│   │   └── semantic_search.py          #     Vector similarity search
│   ├── manifest.md                     #   Tools index
│   └── requirements.txt                #   Python dependencies
├── docs/screenshots/                   # README screenshots
├── .dockerignore                       # Docker build ignore rules
├── .env.docker                         # Docker environment template
├── .env.template                       # General environment template
├── .gitignore                          # Git ignore rules (root)
├── CHANGELOG.md                        # Release history, numbered by FRONTEND_VERSION
├── CLAUDE.md                           # System handbook (GOTCHA framework + release/memory protocol)
├── DOCKER.md                           # Docker deployment guide
├── Dockerfile.dev                      # Development Docker image
├── FEATURES.md                         # Historical: the original single-file backup
├── README.md                           # Project readme
├── docker-compose.yml                  # Docker Compose configuration
├── docker-start.sh                     # Start helper script
├── docker-stop.sh                      # Stop helper script
├── renew-cert.sh                       # Let's Encrypt renewal (PM2-aware)
└── structure.md                        # This file
```

---

## Top-Level Layout

| Path | Purpose |
|---|---|
| `Application/` | The web application — server, database layers, frontend, tests |
| `Desktop/` | The Windows desktop client (Electron thin client) |
| `retired/` | Code kept for reference and not deployed — currently the AI DM |
| `args/` `context/` `goals/` `hardprompts/` `tools/` | The [GOTCHA framework](CLAUDE.md) layers that drive how the project is built and maintained |
| `data/` `memory/` | Persistent cross-session memory (committed index + SQLite store) |
| `CLAUDE.md` | System handbook: framework, frontend release process, memory protocol |
| `CHANGELOG.md` | What each frontend release shipped |
| `DOCKER.md` / `Dockerfile.dev` / `docker-compose.yml` | Docker deployment (local development) |
| `renew-cert.sh` | Let's Encrypt certificate renewal |

## Inside `Application/`

| Path | Purpose |
|---|---|
| `server.js` | Express entry point; injects the cache-busting `?v=N`, redirects retired pages, wires route modules |
| `server/routes/` | 17 route modules, each `register(app, ctx)` |
| `db/campaignsdb.js` | Campaign registry — the only cross-tenant database (also holds login sessions) |
| `db/campaign-store.js` | Per-campaign database handles, provisioning, bootstrap migration |
| `db/localdb.js`, `db/mediadb.js`, `db/storiesdb.js` | Per-campaign SQLite data layers (factories) |
| `lib/request-context.js` | AsyncLocalStorage campaign scope + the db proxies routes use |
| `lib/auth.js`, `lib/sessions.js` | Who a request is: session tokens and the checks routes call |
| `lib/realtime-audience.js` | Which live events each connection may receive |
| `public/` | All served HTML/CSS/JS and the companion PWA |
| `public/js/index/` | 15 character-sheet modules |
| `public/js/table/` | 17 virtual-table modules |
| `public/js/lib/` | 16 shared frontend helpers (escaping, dice engine, chat render, private messages, calendar, weather, …) |
| `tests/` | 51 Vitest unit + API files (1341 tests) |

## Retired pages

The loot and merchant managers merged into the **Treasury** (`/treasury.html`). Their files are still in the tree:

| Still present | State |
|---|---|
| `public/loot.html`, `public/merchant.html` | Unreachable — `server.js` 301-redirects both to `/treasury.html` |
| `public/js/loot.js`, `public/js/merchant.js`, `public/css/loot.css`, `public/css/merchant.css` | Orphaned assets, no longer loaded by any page |
| `server/routes/loot.js`, `server/routes/shop.js` | Still registered so a browser running cached pre-merge assets keeps working |
| `loot_items`, `shop_items` tables | Left intact as a rollback path after the one-time migration into `treasury_items` |

All of the above are removed once every client reports the current `FRONTEND_VERSION`.

The **AI Dungeon Master** was retired in v236 and moved, unchanged, to `retired/aiDM/`
at the repository root. The server no longer loads it and its URLs return 404.

> **Not in the tree:** runtime content created at install/use time is git-ignored — `node_modules/`, the campaign registry (`campaigns.db`) and every per-campaign database under `data/campaigns/<id>/`, plus the retained pre-multi-tenant copies (`localdb.db`, `characters.db`, `media.db`, `stories.db`), uploaded assets under `public/uploads/` and `public/story-images/`, environment files (`.env`), and the dated memory logs under `memory/logs/`. These are created on first run / during play.
