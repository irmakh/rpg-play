# extend_db_backup_uploads — Include uploads/ in Raw DB Backup

## Goal

Extend the raw database backup into a **complete, restorable** snapshot by also bundling the uploaded media (images/audio) that the SQLite databases only reference by `FILE:` path. Keep client and server memory flat via streaming.

> Status: **NOT STARTED** (requested session 68, 2026-06-09 — memory entry 90). The DB-only backup shipped in session 68 (commit 337b41f).

---

## When to Use This Goal

Use when adding upload bundling to the existing raw DB backup. Sub-task under [char_sheet_dev.md](char_sheet_dev.md) — follow its full process; this file supplies the specifics.

---

## Background (What Already Exists)

Session 68 added `GET /api/admin/db-backup` ([backup.js](../Application/server/routes/backup.js)) — it streams a `.tar.gz` of the runtime SQLite files (`localdb.db`, `media.db`, `stories.db`, `aiDM/aiDM.db`) using consistent synchronous `copyFileSync` snapshots, a hand-rolled ustar `tarHeader` writer, and built-in `zlib` gzip (no external deps). The DM backup modal has a **"Download Raw DB Files"** button ([dm.html](../Application/public/dm.html) / [dm.js](../Application/public/js/dm.js)).

**Gap:** the DBs store only `FILE:` references; the actual bytes live on disk under `public/uploads/`. So the current archive is not a complete restore on a fresh host.

---

## Inputs

- Existing DB snapshot logic and `tarHeader` writer in [backup.js](../Application/server/routes/backup.js).
- `public/uploads/{characters,monsters,maps,media,sounds,tokens}` (~362 files as of session 68).

---

## Tools to Build / Extend

| Tool | Location | Job |
|---|---|---|
| Extend `GET /api/admin/db-backup` | [backup.js](../Application/server/routes/backup.js) | After yielding the DB snapshots, recursively walk `public/uploads/` and append each file as a tar entry under an `uploads/` prefix. Stream each file (no full-dir buffering); reuse `tarHeader` + the existing async-generator → `zlib.createGzip()` pipeline. |
| (Optional) `POST /api/admin/db-restore` | [backup.js](../Application/server/routes/backup.js) | Unpack an uploaded `.tar.gz`: write DB files and `uploads/**` back to disk. Requires a tar **reader** (more code than the writer). |
| Scope toggle | [dm.html](../Application/public/dm.html) / [dm.js](../Application/public/js/dm.js) | Let the DM choose "DBs only" vs "DBs + uploads" so the lighter backup stays available. |

---

## Outputs

- A single streamed `.tar.gz` containing DB snapshots **and** `uploads/`, restorable on a fresh host with no dangling media references.
- The lighter DBs-only backup remains selectable.

---

## Edge Cases / Gotchas

- Archive will be large (100 MB+) — streaming is mandatory; never buffer the whole tree.
- DB snapshots still need `copyFileSync` (DBs are live, `journal_mode=DELETE`); uploads are static and can be streamed directly from disk.
- Recurse subfolders; preserve relative paths under `uploads/` so restore can write them back exactly.
- Skip derived sizes if desired (`_thumb.webp` / `_medium.webp` are regenerable) to shrink the archive — but simplest/safest is to include everything as-is.
- Keep the `_dbBackupRunning` guard; a full backup runs longer.

---

## GOTCHA Layer Map

- **Goals:** this file.
- **Orchestration:** extend stream → (optional) restore → UI toggle → README + modal note → version bump → pscp → user restart.
- **Tools:** the extended/added routes + UI controls above.
- **Context:** memory entry 90; uploads-vs-`FILE:` reference model; session-68 backup implementation.
- **Hardprompts:** N/A.
- **Args:** backup-scope toggle ("DBs only" vs "DBs + uploads"); optional include/exclude globs for upload subfolders; option to skip regenerable derived image sizes.
