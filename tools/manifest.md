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
