# Tools Manifest

> Master list of all available tools and their functions
> Each tool is a deterministic script that executes one specific job

## Memory Tools (`tools/memory/`)

- **memory_read.py** - Read memory entries from database and format for display
- **memory_write.py** - Write new memory entries and update MEMORY.md
- **memory_db.py** - Direct database operations (search, update, delete memory entries)
- **semantic_search.py** - Search memory using semantic similarity (embeddings)
- **hybrid_search.py** - Combined keyword + semantic search for best results
- **embed_memory.py** - Generate and manage embeddings for memory entries

## Application — Multi-Tenant Campaigns

> Every campaign is a separate tenant with its own DM password and its own set of
> SQLite files. Cross-campaign reads are impossible by construction: a request
> never holds a database handle that spans two campaigns.

**`Application/db/campaignsdb.js`** — the only cross-tenant database (`campaigns.db`). One row per campaign: name, slug, description, cover, and the scrypt-hashed DM password.
- `listCampaigns()` / `getCampaign(id)` / `getCampaignBySlug(slug)` / `resolveCampaign(idOrSlug)` — reads; `resolveCampaign` accepts either key because the campaign cookie may carry either
- `createCampaign({name, description, dmPassword})` / `updateCampaign(id, patch)` / `deleteCampaign(id)` — CRUD; create hashes the plaintext password and derives a unique slug
- `setDmPassword(id, plaintext)` / `verifyDmPassword(id, plaintext)` — the DM credential. Successful verifications are memoised for 5 minutes, keyed by SHA-256 of campaign+password, because scrypt would otherwise run on ~100 authenticated call sites per page load; changing or deleting a campaign drops its cached entries
- `touchCampaign(id)` stamps `lastPlayedAt`; `LEGACY_CAMPAIGN_ID` is the fixed id of the migrated campaign
- Env `CAMPAIGNS_DB` overrides the registry file path (used by tests)

**`Application/db/campaign-store.js`** — owns `Application/data/campaigns/<id>/` and hands out cached per-campaign handles.
- `getCampaignData(campaignId)` — returns `{ ldb, mdb, sdb, adb }`, opening the four databases on first use. Opening IS provisioning: every table is created from the current schema, so a new campaign starts empty but complete
- `releaseCampaign(id)` / `destroyCampaignData(id)` / `campaignDataSize(id)` / `campaignDir(id)` — `campaignDir` validates the id against `[A-Za-z0-9._-]+` so a path can never escape the data directory
- `bootstrapCampaigns({defaultDmPassword})` — one-time: creates the first campaign and COPIES the pre-multi-tenant `localdb.db` / `media.db` / `stories.db` / `aiDM.db` into it. No-op once any campaign exists; the originals are left in place as a rollback
- Env `CAMPAIGN_DATA_DIR` overrides the data directory (used by tests)

**`Application/lib/request-context.js`** — the mechanism that made ~200 existing route handlers campaign-aware without editing them.
- `requestContext` — an AsyncLocalStorage store holding `{campaignId, campaign, data}` for the in-flight request; propagates across `await`
- `ldb` / `sdb` / `adb` / `mediaDb` / `mediaGet` / `mapUpsert` — Proxies that resolve to the current request's campaign at property-access time. Route modules destructure their dependencies once at `register()`, so a plain object would freeze one campaign into the closure forever; a Proxy defers resolution to the access inside the handler. They THROW outside a request rather than guessing a campaign
- `currentCampaignId()` / `currentCampaign()` / `insertSharedMedia(id, mime, buf)`

**`Application/lib/passwords.js`** — `hashPassword` / `verifyPassword` (scrypt, `salt:hash` format), shared by the server, the registry and the bootstrap.

**`Application/db/mediadb.js`** — `openMediaDb(file)`: per-campaign `shared_media` (chat images + the table map blob), lifted out of `server.js`. The 50-item cap is now per campaign, so a busy campaign no longer evicts a quiet one's map.

**`Application/db/localdb.js`** — now `openCampaignDb(file)`, a factory returning the same 120-name API. Function bodies are unchanged; they close over a per-campaign `db`. `lootRowToTreasury`, `shopRowToTreasury`, `normalizeShopTags` and `SHOP_MAX_ACTIVE_TAGS` stay module-level exports because they are pure. `db/storiesdb.js` (`openStoriesDb`) and `aiDM/db.js` (`openAiDmDb`) got the same treatment.

**`Application/server/routes/campaigns.js`** — the registry API; the only routes that work with no campaign selected.
- `GET /api/campaigns` · `GET /api/campaigns/:id` (detail + character roster + stats) · `GET /api/campaign/current`
- `POST /api/campaigns/:id/enter` — sets the `campaign` cookie; grants nothing on its own, the login still has to succeed · `POST /api/campaigns/leave`
- `POST /api/campaigns` and `DELETE /api/campaigns/:id` — SUPER-ADMIN only (`MASTER_PASSWORD` env). Delete requires `confirmName` to match the campaign name exactly and refuses to remove the last campaign
- `PUT /api/campaigns/:id`, `PUT /api/campaigns/:id/dm-password`, `POST /api/campaigns/:id/cover` — campaign DM or super-admin

**Server wiring (`Application/server.js`)**
- `resolveCampaignForReq(req)` — resolution order: `X-Campaign-Id` header → `?campaign=` query (SSE/WS URLs cannot set headers) → `campaign` cookie → the only campaign when exactly one exists. The cookie is what keeps all ~276 existing frontend `fetch()` calls working untouched
- Campaign middleware — wraps each request in `requestContext.run(...)`; any `/api` request with no resolvable campaign gets `409 {code:'NO_CAMPAIGN'}`. Exempt: `/api/config`, `/api/campaigns*`, `/api/maintenance/*`
- `isSuperAdminPassword(pw)` vs `isMasterPassword(pw, campaignId)` — the latter keeps its old name and signature so the ~100 `masterAuth()` call sites did not change; it now answers "is this the DM of THIS campaign, or the super-admin?"
- `broadcast(event, payload, campaignId = currentCampaignId())` — only reaches clients whose `_meta.campaignId` matches, so the ~130 existing call sites became campaign-scoped for free. `broadcastAll()` exists for server-wide events (force-reload)
- `/` serves `campaigns.html`; `/index.html` is still the character sheet
- `/api/maintenance/*` is SUPER-ADMIN only — it lists clients across every campaign, so one campaign's DM password must not open it

**Frontend**
- `public/campaigns.html` + `js/campaigns.js` + `css/campaigns.css` — master-detail campaign picker with per-campaign login, create (admin password), settings, cover upload and delete
- `js/lib/realtime.js` is now also the shared campaign layer: a `fetch` interceptor that bounces to the picker on `409 NO_CAMPAIGN`, `enforceCampaignSession()` which drops a session belonging to another campaign, `initCampaignBadge()` which fills any `#campaign-badge` element, and `campaign=` on the WS/SSE URL


## Application — Handouts

> DM-authored handouts. Each carries TWO bodies — what a player reads on a
> successful skill check and what they read on a failed one — plus an optional
> prompt shown before the check resolves.

**Redaction is server-side and non-negotiable.** `playerObj()` in
`server/routes/handouts.js` assembles a per-recipient payload holding only the
body that recipient has earned. A `pending` or `rolled` recipient's JSON
contains neither body, no skill name, no DC and no roll total. Hiding the wrong
variant in the browser would still ship it in the response — the same leak fixed
in the treasury in session 80.

**The check is blind and rolled on the server.** `POST /api/handouts/:id/roll`
reads the character's stored `data['sk-<i>']` (kept current by
`recalcDerived()`), rolls `d20 + mod`, stores the total and returns
`{ok:true}` with no number. Rolling server-side also means a total cannot be
forged. The roll is written to chat with `dmOnly:true`, so only the DM sees it.

**The DC only suggests.** `dmObj()` adds `suggested: 'success'|'fail'` per
recipient when a DC is set, but nothing a player can read changes until the DM
`PATCH`es an outcome — that single call is the gate.

`seenAt` is what stops the table screen replaying a handout on every page load: the pop-up gate is `!seenAt`, stamped when the card is shown, and the SERVER clears it whenever the DM re-sends the handout or changes the outcome. It has to be server-side — a client-side "already shown" list dies with the page. Marking seen only ever happens on a VISIBLE tab, or a background refresh would silently consume the handout and suppress the pop-up.

Per-recipient state: `pending -> rolled -> success|fail`. A handout with no
check (`checkSkill = -1`) is created straight at `success`. Sending a
recipient back to `pending` clears their roll, which is how a re-roll is
granted.

- Tables `handouts` + `handout_recipients` (unique on `handoutId, charId`, so handing out twice is idempotent and never resets a roll)
- `ldb.listHandouts / getHandout / createHandout / updateHandout / deleteHandout`
- `ldb.listHandoutRecipients / listHandoutsForChar / getHandoutRecipient / addHandoutRecipient / updateHandoutRecipient / removeHandoutRecipient / clearHandoutRecipients`
- Routes: `GET /api/handouts` (DM full, player redacted) · `GET/POST/PUT/DELETE /api/handouts[/:id]` · `POST /api/handouts/media` · `POST /:id/hand-out` · `POST /:id/recall` · `POST /:id/roll` (character) · `PATCH /:id/recipients/:charId` (DM confirm) · `POST /:id/seen`
- DM page `handouts.html` + `js/handouts.js` + `css/handouts.css`, linked from the DM screen nav
- Player: `js/index/index-handouts.js` (Handouts tab, unread badge) and `js/table/table-handouts.js` (draggable pop-up on arrival AND on outcome confirmation — the second is when the body actually arrives)
- Table right panel: a fifth tab beside Items, from the same `GET /api/handouts` — the DM shape or the redacted player shape, chosen by which credentials `authHeaders()` sends. Rows are collapsible (`_sideHandoutOpen`/`_sideHandoutShut` remember explicit clicks; anything wanting attention opens itself). `toggleSideHandout` keys off the RENDERED state, not just the explicit sets, or an auto-opened row would need two clicks to close. The toolbar 📜 button opens `openHandoutModal()` — one dialog covering give → roll → verdict. Every character appears once: a tick box when they are not yet a recipient, or `_hoModalRecipientRow()` with their roll, the DC suggestion and Success/Fail/re-roll/recall when they are. The `handouts` realtime event calls `_hoModalLoad()` while it is open, so a DM watches checks land; `_hoModalCaptureChecks()` preserves ticks across that repaint
- Tests: `tests/api/handouts.api.test.js` (34), built on the real `openCampaignDb(':memory:')` because the thing under test is what the server puts in a response

## Application — Server Helpers (`Application/server.js`)

> These are runtime helpers embedded in the Express server, not standalone scripts.
> They are listed here so future sessions know they exist before writing new code.

- **processImageSizes(mimeType, buffer, subdir, baseId)** - Generates original + `_thumb.webp` (80×80 crop) + `_medium.webp` (max 500px) for any uploaded image using `sharp`; returns `{ original, thumb, medium }` URL paths
- **saveUploadFile(subdir, id, mimeType, b64)** - Saves a base64-encoded file to `public/uploads/{subdir}/` and returns its `/uploads/...` URL path; used for non-image uploads (video, audio, maps)
- **deleteUploadFile(fileUrl)** - Deletes a file from disk given its `/uploads/...` path; silently ignores missing files
- **readUploadAsBase64(fileUrl)** - Reads a file from `public/uploads/` and returns its base64 string; used in backup serialization
- **mimeToExt(mimeType)** - Maps MIME type string to file extension (e.g. `image/jpeg` → `jpg`)
- **extToMime(fileUrl)** - Infers MIME type from a file URL's extension; used during backup restore
- **broadcast(channel, data)** - Sends a JSON event to all SSE/WebSocket clients subscribed to a named channel

## Application — Shared Frontend Lib (`Application/public/js/lib/`)

- **dnd-data.js** — D&D 5e constants (SKILL_NAMES/SKILL_AB/SAVE_KEYS/CONDITIONS, etc.) shared by index + table. Also exposes the item-bonus helpers: `ITEM_BONUS_GROUPS` (picker option groups), `itemBonusTargetLabel(target)` (encoded target → label), and `aggregateItemBonuses(items)` which sums EQUIPPED items' `bonuses` (`{target,value}` where target is `save-*`/`skill-*`/`check-*`, plus `*-all`) into `{saves, skills, checks}` totals. recalcAll bakes these into the displayed save/skill/mod fields; table-panel applies check totals to ability mods.

## Application — Frontend Modules (`Application/public/js/table/`)

- **table-console.js** - BroadcastChannel bridge for console theme Screen 1 (map); opens secondary window, broadcasts TOKEN_SELECTED
- **table-music.js** - Music player module for table screen; DM controls (modal), hidden `<audio>` element, handles `sound` SSE events for all clients
- **secondary.js** - Self-contained logic for Screen 2 (info panel); own SSE, own state, own API calls; receives TOKEN_SELECTED via BroadcastChannel

## Application — LocalDB Helpers (`Application/db/localdb.js`)

> Exported functions from the SQLite abstraction layer.

- **listOrphanMonsterInitEntries()** - Returns initiative entries for monsters that have no matching table token; used by the initiative cleanup endpoint to avoid a double full-table scan
- **listSoundFiles() / createSoundFile() / deleteSoundFile()** - CRUD for uploaded audio files
- **listPlaylists() / createPlaylist() / updatePlaylist() / deletePlaylist()** - CRUD for tag-based playlists (generic or map-typed)
- **getSoundsForPlaylist(playlistId)** - Returns sounds whose tags intersect with a playlist's tag filter
- **listCalendarEvents({ isDM, charId })** - Viewer-aware calendar event list: DM sees all; a player sees public events plus their own (private journals authored by `charId`); empty `charId` returns public only
- **getCalendarEvent(id)** - Single calendar event row (used for journal edit/delete ownership checks)
- **createCalendarEvent / updateCalendarEvent / deleteCalendarEvent** - Calendar event CRUD; rows carry `authorCharId`/`authorName` (empty = DM event) and a `media` array (image/audio/video descriptors) serialised to `media_json`
- **getWeatherConfig / saveWeatherConfig(sessionNormal)** - Single-row persisted DM "Session Normal" base temperature for the weather system (defaults 60)
- **listWeatherLog / getWeatherForDate(id) / saveWeatherEntry(entry)** - Per-day weather log CRUD; `id` is a date key (`YYYY-M-D` or `YYYY-F-festival`) so re-rolling a day overwrites it; rows store the d20 roll + level + computed value for temperature/wind/precipitation

## Application — Calendar / Journal API (`Application/server/routes/events.js`)

- `GET /api/calendar/events` — viewer-aware list (DM via master pw; player via `X-Character-Id` + `X-Character-Password`; anonymous = public only)
- `POST /api/calendar/events` — DM creates an event; a character creates a journal (author forced, `shared` → public, `eventType='journal'`)
- `PUT/DELETE /api/calendar/events/:id` — ownership-gated: DM edits/deletes anything; a player only their own journal
- `POST /api/calendar/media` — upload one attachment (base64 data URL); images → `processImageSizes` (`calendar/`), audio/video → `saveUploadFile`; validates against `SHARED_MEDIA_MIME`, capped at `MAX_MEDIA_BYTES`

## Application — Weather API (`Application/server/routes/events.js`, DM-only)

> DM daily-weather roller surfaced in events.html (button next to "Set Date…"). All routes require master password.

- `GET/PUT /api/weather/config` — read/save the persisted "Session Normal" base temperature
- `GET /api/weather/log` — full per-day weather history (newest first)
- `POST /api/weather/roll` — server rolls weather for `{date, sessionNormal, dateLabel}`, stores it against the date key (overwrites that day), broadcasts `calendar-updated`. Mechanics: each of Temperature/Wind/Precipitation rolls its own d20 (1–14 normal, 15–17 level1, 18–20 level2). Temperature: normal = SN, level1 = SN−2d6 (colder), level2 = SN+2d6 (hotter). Wind: Normal/Light/Strong. Precip: None/Light/Heavy with snow when temp ≤ 32°F (`WEATHER_FREEZING`) else rain.
- `POST /api/weather/set` — DM manual override: `{date, dateLabel, sessionNormal, temperature:{level,value}, wind:{level,value}, precipitation:{level,value}}`. Stored with `roll:null` (no dice). Unknown levels coerce to `normal`.
- `DELETE /api/weather/log/:id` — DM removes a day's weather.
- **NOTE:** `GET /api/weather/log` is PUBLIC (no auth) so the player index-calendar tab and the table-screen toolbar can read weather. `config`/`roll`/`set`/`delete` stay master-password gated.

## Application — Weather UI (shared frontend)

- **`public/js/lib/weather-ui.js`** — shared weather helpers loaded by events.html, index.html, table.html. `weatherDateKey(d)`, `weatherSetRegistry(map)`, `weatherIconsHTML/weatherIconSpan` (CSS-sprite glyphs cropped from `/img/weather.png`), `weatherSummary(e)`, `weatherTooltipHTML(e)`, and a singleton floating tooltip (`weatherCellTip`/`weatherShowTipEntry`/`weatherMoveTip`/`weatherHideTip`). `weatherDayMarkHTML(e,key)` builds a calendar-cell marker with hover handlers.
- **`public/css/weather.css`** — sprite icon classes (`.wx-ico.wx-hot/.wx-normal/.wx-cold/.wx-rain/.wx-snow/.wx-wind`) cropped from `/img/weather.png` (1305×299, 6 equal columns), base 48px tile at background-size 313×72, plus the `#wx-tooltip` floating card, day-cell markers, and the table `#wx-toolbar` widget. Sprite px positions are tunable in one place.
- **`public/js/table/table-weather.js`** — table-screen toolbar widget: `loadTableWeather()` reads calendar state + weather log, finds today's entry into `_tableWeatherToday`, renders `#wx-toolbar`; refreshed on the `calendar-updated` SSE event.
- Events calendar (`events.js`) and player calendar (`index-calendar.js`) both load `/api/weather/log` into a `*Weather` map, draw per-day markers in their grid render, and register the map for tooltips. The events weather modal additionally edits weather (roll / manual level+value / save / delete) per `weatherTargetDate`.

## Application — Treasury (unified loot + shop)

> Replaces the separate loot and shop systems (session 80). One catalogue table
> `treasury_items`; each row's `mode` decides how players reach it —
> `hidden` (DM only), `loot` (free claim) or `shop` (for sale). Claiming and
> buying both produce real inventory items.

### DB (`Application/db/localdb.js`)
- **listTreasuryItems / listTreasuryItemsByMode / getTreasuryItem / getTreasuryItemsByIds** — catalogue reads
- **createTreasuryItem / updateTreasuryItem / deleteTreasuryItem** — catalogue CRUD
- **bulkUpdateTreasuryTag / bulkUpdateTreasuryMode / bulkDeleteTreasuryItems / bulkCreateTreasuryItems** — multi-select operations, each in one transaction
- **listClaimedItemIds(charId)** — distinct `itemId`s this character has claimed; backs claim-once dedupe and the `✓ Claimed` marker (replaces the old check against the character's `_loots` list)
- **lootRowToTreasury(r) / shopRowToTreasury(r)** — legacy→unified field mapping, shared by the one-time boot migration and by backup restore so both produce identical rows
- **importTreasury(items, shopConfig, purchaseLogs, lootLogs)** — merge-style restore; `importShop`/`importLoot` now convert old backup files through the same path
- A boot migration folds `loot_items` + `shop_items` into `treasury_items` once, preserving ids. The legacy tables are left intact as a rollback path and are dropped in a later release.

### API Routes (`Application/server/routes/treasury.js`)
- `GET /api/treasury` — player view: `{ shopOpen, activeTag, loot[], shop[], claimedIds[] }`. Unrevealed descriptions are blanked server-side; `claimedIds` is only returned to a caller who authenticates as that character
- `GET /api/treasury/all` — DM catalogue (master password)
- `POST /api/treasury` · `PUT /:id` · `DELETE /:id` — CRUD; PUT is partial, and replacing or clearing an image deletes the old files
- `POST /api/treasury/bulk-update-tag` · `/bulk-mode` · `/bulk-delete` — multi-select operations
- `POST /api/treasury/import` — blank-line-separated text import (first line = name, rest = description)
- `GET`/`PUT /api/treasury/status` — shop open/closed + which tags are on sale. `activeTags` (a JSON array on `shop_config`) is the source of truth and the shop can be open for **several tags at once**; an empty list means the whole shop is open. The legacy `activeTag` column keeps the first tag so older readers still work, and a `PUT` carrying only `activeTag` is still accepted. A pre-existing single `activeTag` is seeded into `activeTags` once on boot.
- `POST /api/treasury/claim` — free claim; dedupes against the claim log, decrements stock, grants real items
- `POST /api/treasury/purchase` — paid; currency, stock, weapon ATK/DMG
- `GET /api/treasury/logs` — merged ledger of claims + purchases, newest first
- `GET /api/treasury/visibility` — reveal-state map so already-held items pick up a description the DM reveals later
- `POST /api/treasury/media` — one item image (images only, 25 MB cap) through `processImageSizes` into `uploads/treasury/`
- **grantItems(charData, item, qty)** — internal helper shared by claim and purchase; builds the `_items` entry (and the `_weapons` row with computed ATK/DMG for weapons), stamps `srcId` and the image, bumps `_itemIdCounter`

### Screens
- **treasury.html** (`js/treasury.js`, `css/treasury.css`) — DM master-detail manager: searchable tag-grouped sidebar with mode filter chips, inline editor with a 3-way mode selector and image drop zone, bulk bar, merged ledger, bulk-import modal. Replaces `loot.html` + `merchant.html`, which now 301-redirect here.
- **Player `💰 Treasury` tab** (`js/index/index-treasury.js`) — one tab with a Free Loot / Shop segmented control, shared detail modal, thumbnails that open the shared lightbox. Replaces the separate Shop and Loot tabs; the Main-tab "Loots" card still holds manual entries and pre-merge claims.
- **Unidentified items** — `descVisible: false` means the item is UNIDENTIFIED, and the redaction happens in `playerObj()` on the **server**, never in the browser. The player receives the item's real **name** (a placeholder name was tried and dropped as confusing — the client appends a ` - (unidentified)` marker instead), its kind (`itemType`/`armorType`), `valueCp`, `quantity` and the image. The description, magic bonus, damage dice, weapon properties, AC/init/speed/spell bonuses and attunement are all replaced with neutral defaults, so none of it appears in the network payload.
  - `grantItems()` stores a claimed or bought unidentified item **redacted too** (`unidentified: true`, no stats, and no `_weapons` attack row) — acquiring something must not reveal what browsing it would not.
  - `identifyHeldCopies()` / `identifyForEveryone()` run from `PUT /api/treasury/:id` the moment `descVisible` flips false→true: every character holding a copy (matched by `srcId`) gets the real name, notes, stats and — for weapons — a freshly computed attack row, followed by a `characters` broadcast so open sheets update live.
  - `GET /api/treasury/visibility` is public, so it returns a description **only** for revealed items; sending them all would hand out exactly what the redaction withholds.

## Application — Stories Module

> Stories is a self-contained image-generation module. Prompt files live in `Application/stories/{character}/`, generated images in `Application/public/story-images/`, and records in `stories.db`.

### DB (`Application/db/storiesdb.js`)
- **listStories / getStory / getStoryByFile / createStory / updateStoryStatus / deleteStory** - CRUD for story records
- **listSequences / replaceSequences / updateSequence / updateSequenceStatus** - CRUD for per-story image sequences
- **listPresets / getPreset / createPreset / updatePreset / deletePreset** - CRUD for saved image-server presets

### API Routes (`Application/server.js` — Stories section)
- `GET /api/stories/files` — scan `Application/stories/` folder tree
- `POST /api/stories/folders` — create a character folder under `Application/stories/`
- `GET /api/stories/files/*` — read and parse a prompt `.txt` file
- `PUT /api/stories/files/*` — create or overwrite a prompt `.txt` file
- `DELETE /api/stories/files/*` — delete a prompt file
- `GET /api/stories/presets` / `POST` / `PUT /:pid` / `DELETE /:pid` — image-server preset CRUD
- `GET /api/stories` / `GET /:id` — list or fetch story DB records
- `POST /api/stories` — create or reset a story record from a prompt file (idempotent on promptFile)
- `DELETE /api/stories/:id` — delete story record and its generated images
- `POST /api/stories/:id/generate` — stream SSE generation progress; calls ComfyUI or OpenRouter per sequence

### Screens
- **stories.html** — dashboard; character sidebar, story cards, generation modal with preset support
- **story-builder.html** — prompt editor; create character folders, numbered textarea rows, save to disk
- **story-viewer.html** — storyboard viewer; grid or strip layout, lightbox on click

---

*Add new tools here as they are created*
*Format: `- **script_name.py** - One-sentence description of what it does`*
*Organize by workflow/category*
