# char_sheet_dev — Character Sheet App Development Workflow

## Goal

Standard process for all feature development, bug fixes, and optimizations on the char_sheet application. Ensures changes are planned, backward-compatible, Docker-verified, and properly documented before commit.

---

## When to Use This Goal

Use this goal whenever the task involves modifying any file inside `Application/` — server routes, DB layer, frontend JS, CSS, or HTML. For greenfield app creation, use `build_app.md` instead.

---

## Process — 7 Steps

### 1. READ — Load Context

Before touching any code:

```bash
# Load project memory
cat memory/MEMORY.md

# Load today's log (if exists)
cat memory/logs/$(date +%Y-%m-%d).md 2>/dev/null

# Load yesterday's log for continuity
cat memory/logs/$(date -d yesterday +%Y-%m-%d).md 2>/dev/null
```

Key things to confirm from memory:
- What was last worked on (avoid re-doing or conflicting with recent changes)
- Any active constraints or in-progress work
- Docker status (was image recently rebuilt?)

---

### 2. CHECK — Understand the Task

Before designing anything:

1. **Clarify the request** — Is this a bug fix, new feature, or optimization? Who does it affect (DM only, players, both)?
2. **Check both DB modes** — Every server route must work for `DB_PROVIDER=localdb` AND `DB_PROVIDER=instantdb`. Check if the change touches a route that has both branches.
3. **Check tools/manifest.md** — Does a helper already exist for what you need? Don't duplicate `processImageSizes`, `saveUploadFile`, `broadcast`, etc.
4. **Identify backward-compat risk** — Does this change a DB schema, API response shape, or SSE event payload? Existing clients and backups must not break.

---

### 3. PLAN — Design Before Building

For any change touching more than 2 files or with meaningful architectural choice:

- Use `EnterPlanMode` — explore affected files, identify all call sites, present the approach
- Get explicit user approval before writing code
- For DB schema changes: confirm migration pattern (`try { ALTER TABLE ... ADD COLUMN ... } catch {}`)
- For new upload routes: confirm whether images or non-images — images need `processImageSizes`, others use `saveUploadFile`
- For API response changes: confirm all consumers (frontend JS files that call the endpoint)

Skip plan mode only for single-file, obviously-scoped fixes (typo, wrong constant, etc.).

---

### 4. IMPLEMENT — Edit Application Files

Follow these rules during implementation:

**Server (server.js):**
- Image uploads → call `processImageSizes(mimeType, buffer, subdir, id)` for `IMAGE_MIME` types; fall back to `saveUploadFile` for video/audio
- Map uploads → always `saveUploadFile`, never `processImageSizes` (maps need full quality)
- New endpoints → add both `localdb` and `instantdb` branches
- Token broadcast events → always include `portraitThumb` alongside `portrait` in payload
- DB schema changes → add `try { db.exec('ALTER TABLE...') } catch {}` to the migrations block in `localdb.js`

**LocalDB (db/localdb.js):**
- New columns → migration block (idempotent `try/catch`)
- New query functions → export them; add to `tools/manifest.md` under "Application — LocalDB Helpers"
- INSERT statements → always explicitly list columns (don't rely on column order)

**Frontend (public/js/):**
- Portrait/image display → prefer `thumbUrl`/`mediumUrl` for display, keep `dataUrl` for lightbox/full-screen
- Always fall back: `tok.portraitThumb || tok.portrait`, `m.mediumUrl || m.dataUrl`
- SSE event handlers → update all relevant cached fields, not just the primary one

**Backup/restore:**
- New image fields (thumbUrl, mediumUrl, portraitThumb) → strip from backup (regenerate on restore)
- Restore flow → write original file, then call `processImageSizes` to regenerate derived sizes

---

### 5. VERIFY — Test Before Committing

```bash
# 1. Syntax check server.js
node --input-type=module --check < Application/server.js

# 2. Syntax check localdb.js
node --input-type=module --check < Application/db/localdb.js

# 3. Restart container and confirm clean startup
docker-compose restart
docker-compose logs --tail=5
# Expected last line: "HTTP server listening on port 3000 [localdb]"
```

If a **native npm package** was added:
```bash
# Full rebuild required — anonymous node_modules volume must be flushed
docker-compose build --no-cache
docker-compose down -v
docker-compose up -d
docker-compose logs --tail=5
```

Manual checks (do in browser before committing):
- [ ] Golden path works (the feature you changed)
- [ ] No console errors in DevTools
- [ ] Docker log shows no runtime errors after exercising the feature

---

### 6. COMMIT — Stage, Commit, Push

```bash
# Verify author email before committing
git config user.email
# Must be: irmakh@gmail.com

# Stage only the files you changed (never git add -A)
git add Application/server.js Application/db/localdb.js ...

# Commit with descriptive message
git commit -m "..."

# Push
git push
```

Commit message format:
- First line: short imperative summary (≤72 chars)
- Body: what changed and why, grouped by area (backend / frontend / DB)
- Always add: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

### 7. LOG & MANIFEST — Update Records

After every session:

```bash
# Append session event to today's log
python tools/memory/memory_write.py \
  --content "Brief description of what was done and any gotchas" \
  --type event

# If new persistent facts were learned, update MEMORY.md
python tools/memory/memory_write.py \
  --update-memory \
  --content "New fact or constraint" \
  --section key_facts
```

If new server helpers or DB functions were created, add them to `tools/manifest.md` immediately under the appropriate section.

---

## Key Constraints (Always Apply)

| Constraint | Rule |
|-----------|------|
| DB modes | Every server route must have both `localdb` and `instantdb` branches |
| Image processing | `processImageSizes` for images; `saveUploadFile` for video/audio/maps |
| Derived image files | Never include `_thumb.webp` / `_medium.webp` in backups — regenerate on restore |
| DB migrations | `try { ALTER TABLE ... ADD COLUMN } catch {}` — idempotent, runs on every startup |
| Token broadcasts | Always include `portraitThumb` alongside `portrait` in token-related SSE events |
| Backward compat | New API response fields are additive; never remove or rename existing fields |
| Native npm packages | Full Docker rebuild required: `build --no-cache` + `down -v` + `up -d` |
| Git author | Verify `irmakh@gmail.com` before every commit |

---

## Common Patterns

### Adding a new image upload route
1. Extract base64 from data URL: `const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)`
2. Validate MIME: `if (!ALLOWED_MIME.has(mimeType)) return res.status(400)...`
3. Process sizes: `const urls = await processImageSizes(mimeType, Buffer.from(mimeMatch[2], 'base64'), subdir, newId)`
4. Store `urls.original`, `urls.thumb`, `urls.medium` in DB
5. Delete old variants before overwriting: `deleteUploadFile(old.dataUrl); deleteUploadFile(old.thumbUrl); deleteUploadFile(old.mediumUrl)`

### Adding a new DB column
```javascript
// In localdb.js migration block:
try { db.exec(`ALTER TABLE my_table ADD COLUMN newCol TEXT DEFAULT ''`); } catch {}
// Update all INSERT statements in createX() and importX() functions to include the new column
```

### Broadcasting a token update
```javascript
broadcast('table', {
  action: 'token-updated',
  token: { ...tok, portrait: newPortrait, portraitThumb: newPortraitThumb }
});
```

---

## Related Files

- **Memory:** `memory/MEMORY.md` — app stack, completed work, learned behaviors
- **Tools:** `tools/manifest.md` — all available helpers and scripts
- **Build goal:** `goals/build_app.md` — ATLAS workflow for greenfield features
- **App entry:** `Application/server.js` — all Express routes and upload helpers
- **DB layer:** `Application/db/localdb.js` — SQLite abstraction (localdb mode)
