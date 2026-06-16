# Project Structure

Complete file tree of the RPG Play repository — **git-tracked files only**. Untracked/ignored content (`node_modules/`, `.git/`, runtime uploads under `public/uploads/` and `public/story-images/`, local `.db` files, `.env`, daily memory logs, sample XML imports) is excluded.

← Back to [README.md](README.md)

---

## Full Tree

```
char_sheet/
├── Application/                        # The web app (Node.js + Express + vanilla JS frontend)
│   ├── aiDM/                           # AI Dungeon Master module (own SQLite DB + routes)
│   │   ├── public/                     #   AI DM frontend (self-contained)
│   │   │   ├── ai-dm.css               #     AI DM page styles
│   │   │   ├── ai-dm.html              #     AI DM adventure page
│   │   │   └── ai-dm.js                #     AI DM client (streaming, rolls, rests, sessions)
│   │   ├── scenarios/                  #   Built-in adventure scenarios
│   │   │   └── index.json              #     Scenario catalog (Forgotten Realms starters)
│   │   ├── db.js                       #   AI DM SQLite layer (sessions, messages)
│   │   └── routes.js                   #   AI DM API + streaming endpoints
│   ├── db/                             # Database layers
│   │   ├── localdb.js                  #   SQLite layer (characters, media, tokens, …)
│   │   └── storiesdb.js                #   SQLite layer for stories and sequences
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
│   │   │   ├── calendar.css            #     Calendar of Harptos styles
│   │   │   ├── dm.css                  #     DM dashboard styles
│   │   │   ├── index.css               #     Character sheet styles
│   │   │   ├── loot.css                #     Loot manager styles
│   │   │   ├── merchant.css            #     Merchant shop styles
│   │   │   ├── monsters.css            #     Monster library styles
│   │   │   ├── stories.css             #     Stories (dashboard/builder/viewer) styles
│   │   │   ├── table-sheet-popout.css  #     Scoped layout for the popped-out character sheet
│   │   │   ├── table-theme-modern.css  #     Modern HUD table theme
│   │   │   └── table.css               #     Virtual table styles
│   │   ├── img/                        #   Static images & PWA icons
│   │   │   ├── parchment/              #     Parchment theme assets
│   │   │   │   ├── bg.jpeg             #       Theme background
│   │   │   │   └── header.jpeg         #       Theme header
│   │   │   ├── icon-192.png            #     PWA icon (192px)
│   │   │   └── icon-512.png            #     PWA icon (512px)
│   │   ├── js/                         #   Frontend scripts
│   │   │   ├── console/                #     Companion PWA scripts
│   │   │   │   ├── secondary.js        #       Secondary info screen (own SSE + state)
│   │   │   │   └── table-console.js    #       Primary↔secondary sync bridge
│   │   │   ├── index/                  #     Character sheet — 15 modules
│   │   │   │   ├── index-actions.js    #       Actions tab (weapons + action spells + custom actions)
│   │   │   │   ├── index-calc.js       #       AC / init / speed / derived stat calc
│   │   │   │   ├── index-calendar.js   #       Player calendar tab
│   │   │   │   ├── index-char.js       #       Character data load/save + XML import/export
│   │   │   │   ├── index-dice.js       #       Dice rolling + roll history + toast
│   │   │   │   ├── index-dice3d.js     #       3D dice animation
│   │   │   │   ├── index-initiative.js #       Player initiative tracker panel
│   │   │   │   ├── index-items.js      #       Inventory / equipment
│   │   │   │   ├── index-loot.js       #       Loot claim tab
│   │   │   │   ├── index-main.js       #       Bootstrap + event wiring
│   │   │   │   ├── index-media.js      #       Portrait + media attachments
│   │   │   │   ├── index-realtime.js   #       SSE/WS sync
│   │   │   │   ├── index-shop.js       #       Shop tab (browse/cart/buy)
│   │   │   │   ├── index-state.js      #       Shared mutable state + session
│   │   │   │   └── index-utils.js      #       Ability/modifier helpers
│   │   │   ├── lib/                    #     Shared frontend utilities
│   │   │   │   ├── chat-render.js      #       Render chat messages (text / dice / html)
│   │   │   │   ├── dice-engine.js      #       3D dice engine (d20 icosahedron, d10 trapezohedron)
│   │   │   │   ├── dnd-data.js         #       D&D 5e constants (skills, abilities)
│   │   │   │   ├── esc.js              #       HTML escaping helper
│   │   │   │   ├── fr_calendar.js      #       Calendar of Harptos logic
│   │   │   │   ├── lightbox.js         #       Fullscreen image/video viewer
│   │   │   │   └── realtime.js         #       WS (localdb) / SSE (instantdb) transport
│   │   │   ├── table/                  #     Virtual table — 14 modules
│   │   │   │   ├── table-addtoken.js   #       Add-token modal
│   │   │   │   ├── table-auth.js       #       Session load + DM unlock
│   │   │   │   ├── table-chat.js       #       Table chat + info cards
│   │   │   │   ├── table-hppanel.js    #       HP panel + group ability/save rolls
│   │   │   │   ├── table-initiative.js #       Initiative tracker UI
│   │   │   │   ├── table-main.js       #       Bootstrap + DM tools modal
│   │   │   │   ├── table-map.js        #       Canvas, tokens, drawing, fog, ruler
│   │   │   │   ├── table-monsters.js   #       Monster tokens + stat block
│   │   │   │   ├── table-music.js      #       Synced music playback
│   │   │   │   ├── table-panel.js      #       Right-side token quick-roll panel
│   │   │   │   ├── table-popout.js     #       Pop panels into separate windows
│   │   │   │   ├── table-realtime.js   #       SSE/WS event handling
│   │   │   │   ├── table-state.js      #       Shared state + session
│   │   │   │   └── table-utils.js      #       Helpers (canvas pos, display names)
│   │   │   ├── dm.js                   #     DM dashboard
│   │   │   ├── events.js               #     DM calendar
│   │   │   ├── login.js                #     Login screen logic
│   │   │   ├── loot.js                 #     Loot manager (DM)
│   │   │   ├── merchant.js             #     Merchant shop manager (DM)
│   │   │   ├── monster-stat-block.js   #     Shared monster stat-block renderer
│   │   │   ├── monsters.js             #     Monster library (DM)
│   │   │   └── prepare-map.js          #     Map prep tool (DM)
│   │   ├── dm.html                     #   DM dashboard page
│   │   ├── events.html                 #   DM calendar page
│   │   ├── index.html                  #   Character sheet page
│   │   ├── login.html                  #   Login page (all users)
│   │   ├── loot.html                   #   Loot manager page
│   │   ├── manifest.json               #   Main app PWA manifest
│   │   ├── merchant.html               #   Merchant shop page
│   │   ├── monsters.html               #   Monster library page
│   │   ├── music-player.html           #   Standalone now-playing popup
│   │   ├── playlists.html              #   Music & playlist manager page (DM)
│   │   ├── prepare-map.html            #   Map prep page
│   │   ├── stories.html                #   Story dashboard page
│   │   ├── story-builder.html          #   Story editor page (panels, cast, images)
│   │   ├── story-viewer.html           #   Story viewer page (grid / strip)
│   │   ├── sw.js                       #   Service worker (PWA cache; version-synced with FRONTEND_VERSION)
│   │   └── table.html                  #   Virtual table page
│   ├── server/                         # Backend
│   │   └── routes/                     #   12 Express route modules (each exports register(app, ctx))
│   │       ├── auth.js                 #     Login, passwords, stories gate
│   │       ├── backup.js               #     Per-section JSON export / restore
│   │       ├── characters.js           #     Character CRUD + quick-roll + action use
│   │       ├── chat.js                 #     Chat messages + image sharing
│   │       ├── events.js               #     Calendar dates, events, player journals & media
│   │       ├── initiative.js           #     Initiative CRUD + turn control
│   │       ├── loot.js                 #     Loot items & claims
│   │       ├── monsters.js             #     Monster library + XML/JSON import
│   │       ├── shop.js                 #     Merchant items & purchases
│   │       ├── sound.js                #     Playlists & synced playback
│   │       ├── stories.js              #     Stories & panels
│   │       └── table.js                #     Tokens, map, fog, drawing
│   ├── tests/                          # Vitest suites
│   │   ├── api/                        #   API / integration tests
│   │   │   ├── auth.api.test.js        #     Auth route tests
│   │   │   ├── characters.api.test.js  #     Characters route tests
│   │   │   ├── initiative.api.test.js  #     Initiative route tests
│   │   │   └── table.api.test.js       #     Table route tests
│   │   ├── helpers/                    #   Shared test scaffolding
│   │   │   ├── make-ldb.js             #     In-memory localdb factory
│   │   │   ├── setup.test.js           #     Global test setup
│   │   │   └── test-app.js             #     Express app builder for tests
│   │   └── unit/                       #   Unit tests (per frontend module)
│   │       ├── dice-fairness.test.js   #     Seeded chi-square dice fairness
│   │       ├── index-actions.test.js   #     Actions tab tests
│   │       ├── index-calc.test.js      #     Derived-stat calc tests
│   │       ├── index-char-data.test.js #     Character data model tests
│   │       ├── index-char-xml.test.js  #     XML import/export tests
│   │       ├── index-dice-history.test.js  # Roll-history tests
│   │       ├── index-dice.test.js      #     Dice rolling tests
│   │       ├── index-initiative.test.js#     Initiative panel tests
│   │       ├── index-items.test.js     #     Inventory/equipment tests
│   │       ├── index-loot.test.js      #     Loot tab tests
│   │       ├── index-shop.test.js      #     Shop tab tests
│   │       ├── index-utils.test.js     #     Ability/modifier helper tests
│   │       ├── lib-esc.test.js         #     HTML-escape helper tests
│   │       ├── table-map.test.js       #     Table map/canvas tests
│   │       └── table-utils.test.js     #     Table helper tests
│   ├── .env.example                    # Environment template (app)
│   ├── .gitignore                      # Git ignore rules (app)
│   ├── clear-db.js                     # Wipe all InstantDB data (dev utility)
│   ├── gaston.xml                       # Sample character export (committed reference)
│   ├── migrate.js                      # One-time SQLite → InstantDB migration
│   ├── package.json                    # Dependencies & npm scripts
│   ├── server.js                       # Express entry point — loads route modules + shared context
│   └── vitest.config.js                # Vitest configuration
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
├── .dockerignore                       # Docker build ignore rules
├── .env.docker                         # Docker environment template
├── .env.template                       # General environment template
├── .gitignore                          # Git ignore rules (root)
├── CLAUDE.md                           # System handbook (GOTCHA framework + release/memory protocol)
├── DOCKER.md                           # Docker deployment guide
├── Dockerfile.dev                      # Development Docker image
├── FEATURES.md                         # Feature documentation
├── README.md                           # Project readme
├── docker-compose.yml                  # Docker Compose configuration
├── docker-start.sh                     # Start helper script
├── docker-stop.sh                      # Stop helper script
└── renew-cert.sh                       # Let's Encrypt renewal (PM2-aware)
```

---

## Top-Level Layout

| Path | Purpose |
|---|---|
| `Application/` | The web application — server, database layers, frontend, AI DM, tests |
| `args/` `context/` `goals/` `hardprompts/` `tools/` | The [GOTCHA framework](CLAUDE.md) layers that drive how the project is built and maintained |
| `data/` `memory/` | Persistent cross-session memory (committed index + SQLite store) |
| `CLAUDE.md` | System handbook: framework, frontend release process, memory protocol |
| `DOCKER.md` / `Dockerfile.dev` / `docker-compose.yml` | Docker deployment |
| `renew-cert.sh` | Let's Encrypt certificate renewal |

## Inside `Application/`

| Path | Purpose |
|---|---|
| `server.js` | Express entry point; injects the cache-busting `?v=N` and wires route modules |
| `server/routes/` | 12 route modules, each `register(app, ctx)` |
| `db/localdb.js`, `db/storiesdb.js` | SQLite data layers |
| `aiDM/` | Self-contained AI Dungeon Master (own DB, routes, frontend) |
| `public/` | All served HTML/CSS/JS and the companion PWA |
| `public/js/index/` | 15 character-sheet modules |
| `public/js/table/` | 14 virtual-table modules |
| `public/js/lib/` | Shared frontend helpers (dice engine, chat render, calendar, …) |
| `tests/` | Vitest unit + API suites |

> **Not in the tree:** runtime content created at install/use time is git-ignored — `node_modules/`, the working SQLite databases (`localdb.db`, `characters.db`, `media.db`, `stories.db`, `aiDM/aiDM.db`), uploaded assets under `public/uploads/` and `public/story-images/`, environment files (`.env`), and the dated memory logs under `memory/logs/`. These are created on first run / during play.
