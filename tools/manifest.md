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
