# Persistent Memory

> This file contains curated long-term facts, preferences, and context that persist across sessions.
> The AI reads this at the start of each session. You can edit this file directly.

## User Preferences

- Project name: char_sheet — D&D virtual tabletop / character sheet app
- Application code lives in `Application/` folder
- Working directory: `f:\proj\char_sheet`
- Git remote: github.com/irmakh/rpg-play, branch: main
- Commit author email: irmakh@gmail.com (already set in repo config — verify before committing)
- Deploy via Docker Compose; HTTPS on port 443 with Let's Encrypt certs

## App Feature Inventory

> Major screens and features — know what exists before building new things.

- **Character sheet** (`index.js`) — HP tracking, inventory, spells, portrait, conditions display
- **DM Table / Map** (`table.js`) — token placement/drag, drawing tool, initiative tracker (click-to-view, auto-advance, previous turn), HP panel, conditions panel, token labels always visible
- **DM Panel** (`dm.js`) — monster management, loot, map prep (clone + positional placement), media gallery, shop
- **Events screen** — DM-only campaign event log/tracker
- **Monster names** — hidden from players; players see identifier only (e.g. "Goblin #1")
- **Token conditions** — D&D 5e status conditions (poisoned, stunned, etc.) shown on tokens + HP tracker with 5e.tools links; any player can toggle conditions on their own token
- **Token operation queue** — all token add/move/remove network requests are serialised through an operation queue to prevent race conditions under concurrent player interaction
- **Drawing tool** — real-time freehand drawing on the table map, synced to all clients via SSE/WebSocket
- **Shop** — merchant items with tag system for filtering
- **Backup/restore** — per-section (characters, monsters, media, loot, shop, etc.), non-destructive import (merges, does not wipe existing data)
- **Image system** — uploads generate original + `_thumb.webp` (80×80) + `_medium.webp` (max 500px); maps always full quality
- **Move tool** — 500ms delay before drag activates (prevents accidental moves)

## Key Facts — App Stack

- **Backend:** Node.js ES modules, Express 4, better-sqlite3 (local) or InstantDB (cloud)
- **Frontend:** Vanilla JS — `index.js` (char sheet), `table.js` (DM map), `dm.js` (DM panel), `monsters.js`
- **Real-time:** SSE + WebSockets for broadcast
- **DB mode:** toggled via `DB_PROVIDER` env var — `localdb` (SQLite default) or `instantdb`
- **Key files:** `Application/server.js` (~2600 lines), `Application/db/localdb.js` (~630 lines)
- **Image storage:** files on disk under `public/uploads/{characters,monsters,media,maps}/`; paths stored in SQLite

## Key Facts — Docker

- Uses `node:20-alpine` with anonymous volume for `/app/node_modules`
- Adding a **native npm package** (e.g. sharp, better-sqlite3) requires full rebuild:
  1. `docker-compose build --no-cache`
  2. `docker-compose down -v && docker-compose up -d`
  — skipping step 2 leaves the stale volume in place and the package stays missing

## Completed Work (2026-04-21) — commit ba9c4a8

- **6 performance fixes:** DB indexes, backup media scan fix, chat cleanup query, initiative cleanup JOIN, map HTTP caching, monster backup parallelization
- **Multi-size image system:** `sharp` added; every image upload now generates `_thumb.webp` (80×80 crop) and `_medium.webp` (max 500px). Maps excluded. DB migrations added to `char_media`, `table_tokens`, `shared_media`. Backup strips derived sizes; restore regenerates them.
- **Frontend wired:** tokens use `portraitThumb`, gallery uses `mediumUrl`, portrait header uses `mediumUrl`, lightbox uses original. Backward-compatible — all fall back to `portrait`/`dataUrl` if thumb absent.
- **`GET /api/characters/:id/portrait`** now returns `{ portrait, portraitThumb }`
- **`POST /api/table/tokens`** now accepts and stores `portraitThumb`

## Learned Behaviors

- Always check `tools/manifest.md` before creating new scripts
- Always check `goals/manifest.md` before starting a task — create a goal if none exists (ask permission first)
- **Session start order (MANDATORY):** (1) read `memory/MEMORY.md`, (2) read today's log `memory/logs/YYYY-MM-DD.md`, (3) read yesterday's log, (4) run `python tools/memory/memory_read.py --format markdown`, (5) check `goals/manifest.md`, (6) check `tools/manifest.md`. Do NOT start from the auto-memory system (~/.claude/...) — that is secondary and supplemental only.
- Log notable session events via `python tools/memory/memory_write.py --content "..." --type event`
- Update `tools/manifest.md` immediately when a new tool/helper is created
- Never modify or create goals without explicit user permission
- Follow GOTCHA framework layers — don't collapse orchestration, tools, and goals into one place
- Read full goals before starting tasks — don't skim

## Current Projects

- Character Sheet Application — active development; base features complete, ongoing optimization and feature work

---

*Last updated: 2026-04-21*
*This file is the source of truth for persistent facts. Edit directly to update.*
