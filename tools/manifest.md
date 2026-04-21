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

## Application — LocalDB Helpers (`Application/db/localdb.js`)

> Exported functions from the SQLite abstraction layer.

- **listOrphanMonsterInitEntries()** - Returns initiative entries for monsters that have no matching table token; used by the initiative cleanup endpoint to avoid a double full-table scan

---

*Add new tools here as they are created*
*Format: `- **script_name.py** - One-sentence description of what it does`*
*Organize by workflow/category*
