# fix_map_export_memory — Map Export/Import Memory Fix

## Goal

Make map **export** and **import** work on memory-constrained clients (< 100 MB free RAM) without crashing the browser tab. Move the heavy work off the client to the server via streaming, while keeping the existing `.map.json` file format so old exports still import.

> Status: **NOT STARTED** (diagnosed session 68, 2026-06-09 — memory entry 89). Implement only on explicit request.

---

## When to Use This Goal

Use when picking up the map export/import OOM crash. This is a sub-task under [char_sheet_dev.md](char_sheet_dev.md) — follow that goal's READ → PLAN → BUILD → VERIFY → VERSION → DEPLOY → COMMIT process; this file supplies the technical specifics.

---

## Problem (Root Cause)

Map export runs entirely in the browser ([prepare-map.js:668](../Application/public/js/prepare-map.js#L668)) and builds **3–4 full copies of the map image in memory simultaneously**:

1. `fetch(...).blob()` → raw image Blob (~20 MB)
2. `FileReader.readAsDataURL(blob)` → base64 string (+33%, ~27 MB)
3. `JSON.stringify(payload)` → second giant string with base64 inlined (~27 MB)
4. `new Blob([...])` → another copy (~27 MB)

Maps are full-quality, capped ~30 MB ([table.js:609](../Application/server/routes/table.js#L609)), so peak can exceed **120 MB** → the browser silently kills the tab on low-memory devices. **Import has the same bug** (`file.text()` + `JSON.parse` + re-`stringify`, [prepare-map.js:710](../Application/public/js/prepare-map.js#L710)).

The server side is fine: the image is stored as `FILE:/uploads/maps/...` on disk and the GET endpoint redirects to the static file.

---

## Inputs

- `currentMapId` and `prepState` (client) — already available in `prepare-map.js`.
- On-disk map image at `/uploads/maps/...` referenced by the `prep-map-<id>` row in `shared_media`.

---

## Tools to Build

| Tool | Location | Job |
|---|---|---|
| `GET /api/prepared-maps/:id/export` | [table.js](../Application/server/routes/table.js) | Stream the `.map.json`: write JSON head, pipe the on-disk image through a base64 transform in chunks, write tail. Flat server memory. Browser just downloads via `<a href>` / navigation. |
| `POST /api/prepared-maps/import` | [table.js](../Application/server/routes/table.js) | Accept the uploaded file streamed to a temp file, parse, write image to disk, create the map record (reuse existing logic at [table.js:600](../Application/server/routes/table.js#L600)). |
| Client rewrite | [prepare-map.js:668](../Application/public/js/prepare-map.js#L668), [:710](../Application/public/js/prepare-map.js#L710) | `exportMap()` → just trigger the download URL. `handleImportFile()` → send the raw `File` as the `fetch` body (browsers stream a File body from disk; no `file.text()`). |

---

## Outputs

- Export/import that holds near-zero client memory; works on < 100 MB devices.
- `.map.json` format unchanged → existing exported maps still import.

---

## Edge Cases / Gotchas

- Base64 stream chunks must align to 3-byte boundaries — buffer the remainder between chunks.
- Keep the ~30 MB map cap and the `express.json` 34 MB limit in mind; the server import no longer needs `express.json` for this path (it streams a raw body).
- Server holds the parsed object briefly on import — acceptable; the memory constraint is the client/device, not the server.
- **Do not** switch to a `.zip` container — it breaks backward compatibility with existing `.map.json` files for no required benefit.

---

## GOTCHA Layer Map

- **Goals:** this file.
- **Orchestration:** add endpoints → rewrite client → version bump → pscp → user restart → verify on throttled device.
- **Tools:** the two routes above + client functions.
- **Context:** memory entry 89; the copy-chain analysis above.
- **Hardprompts:** N/A.
- **Args:** map size cap and upload/JSON limits are candidates to move from hard-coded constants into a config/args value.
