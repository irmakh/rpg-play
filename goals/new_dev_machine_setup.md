# new_dev_machine_setup — New Development Machine Installation Checklist

## Goal

The user develops from **multiple computers**. When they say something like "I just set up this project on a new machine," "start a new session on a new computer," or "check this new install," run this checklist end-to-end, fix what's safely fixable, and ask the user (via questions, not assumptions) wherever a decision needs their input. Report findings clearly; don't silently skip a step.

> Status: **ACTIVE** — first written 2026-09-15 (session that diagnosed a fresh Arch Linux install) after doing this work ad hoc. Update this file whenever a new machine surfaces a gotcha this checklist didn't catch.

---

## When to Use This Goal

Any time the user is bringing up a new development environment for this repo (new computer, new VM, reinstalled OS, fresh container/devbox). Also re-run relevant sections if an existing machine's setup seems to have drifted (e.g. Docker was reinstalled, Python was upgraded).

---

## Checklist

### 1. Repo state
- `git status`, `git log -5 --oneline`, confirm branch and whether local is ahead/behind `origin/main`.
- Note any uncommitted changes already present (don't assume they're yours to discard — investigate, per CLAUDE.md's general safety rules).

### 2. Git identity & push auth (commonly broken on a fresh machine)
- Check `git config user.name` / `user.email` (local AND global) — a fresh machine frequently has **neither set**, which hard-fails any commit. If missing, set them locally in the repo to match the existing commit history (`git log -5 --format='%an <%ae>'`).
- Check for push credentials: SSH key (`~/.ssh/`), `~/.netrc`, `~/.git-credentials`, `gh auth status`. A public repo will happily `fetch`/`clone` with zero auth, which masks a missing push credential — always check auth separately from fetch, e.g. `git push --dry-run`.
- **Ask the user** how they want to authenticate if nothing is configured: PAT (ask them to paste one, scoped `repo` or fine-grained Contents:Write; store via `git config --local credential.helper store` + `git credential approve`, `chmod 600 ~/.git-credentials`, never write the token into any tracked file or print it back), SSH key (generate one, show the public key to add to GitHub, switch remote to SSH), or "I'll handle it myself."

### 3. Docker (primary way this app runs locally)
- `docker --version`, `docker compose version` — confirm installed.
- `docker compose ps` / `docker ps -a` — check for the running `char_sheet_dev` container and any stray idle/never-started containers left from a previous build attempt (safe to `docker rm` if status is `Created` and never `Up`).
- If not running: needs `.env` (copy from `.env.docker` or `Application/.env.example` — check both, they may differ in scope) with at minimum `MASTER_PASSWORD` set to something real, not the placeholder.
- Bring up (`docker-compose up -d` or `./docker-start.sh`), then verify with `curl -o /dev/null -w '%{http_code}' http://localhost:3000` (expect 200) and `docker logs char_sheet_dev --tail 40` for startup errors.
- Run the test suite inside the container: `docker compose exec app npm test` — expect all tests passing (1173 tests / 44 files as of 2026-09-15; update this number if it drifts).
- Note (don't necessarily fix without asking): the container runs as root with no `user:` in `docker-compose.yml`, so bind-mounted files it writes (`Application/node_modules`, `campaigns.db`, `data/`, `stories/`) end up **root-owned on the host** — the host user can't touch them without `sudo`. This is long-standing/known behavior, not a regression; only "fix" it (e.g. add a `user:` mapping) if the user asks, since it changes container permissions on every machine.
- Sanity-check `docker-compose.yml` itself for drift/warnings (obsolete `version:` field, unset env vars triggering warnings, orphaned volume declarations) — these are safe to clean up without asking, since they're config-only with no behavior change; verify with `docker compose config -q` after.

### 3a. Demo data (optional)
- `Application/scripts/seed_demo_data.py` seeds a full demo campaign — 4 player characters (full sheets: abilities, saves, skills, AC/HP, weapons, and spells for the two casters), 5 monster stat blocks, and 8 treasury items (shop/loot/hidden mix). **Ask the user** whether they want demo data seeded on this machine before running it — it's not part of the base install.
- Must run **inside the container** (needs the container's Python 3 + the bind-mounted SQLite files + the app listening on localhost for one schema-provisioning call): `docker compose exec app python3 scripts/seed_demo_data.py`. It prompts interactively for the demo campaign name, a DM password, and a player password (shared by all 4 demo characters) — don't try to script those inputs non-interactively outside of testing; let the user type them (or ask them for the values and enter them yourself if operating hands-off).
- It writes SQLite directly rather than going through the HTTP API — campaign creation and character-password setting both require a DM/admin session, which can only be obtained via the captcha-gated login flow (no automation bypass exists, by design). See the script's own docstring for the full rationale. Password hashing is a Python replica of `lib/passwords.js`'s scrypt format, verified byte-for-byte compatible (2026-09-15) — if `lib/passwords.js` ever changes its hashing scheme, this script's `hash_password()` needs updating too.
- No portrait/map images are generated (the app's blank-portrait placeholder covers it) — keeps the script dependency-free (stdlib only, no Pillow/sharp needed).
- Verify after running: `curl http://localhost:3000/api/campaigns` should list the new campaign; log in as DM in a browser to confirm the password actually works (the script's own hash replication was verified against `verifyPasswordAsync` directly, but a real login is the end-to-end check).

### 4. Node.js (only needed for Desktop/Electron work, NOT for the main app)
- The main `Application/` runs entirely inside Docker (see `Dockerfile.dev`) — **no host Node install is required** just to run/develop the web app.
- `Desktop/` (the Electron thin client) is NOT dockerized — building or running it (`npm start`, `npm run build` inside `Desktop/`) needs Node + npm on the host. **Ask the user** whether they plan to work on the Desktop client on this machine; if yes, confirm Node is installed (`node --version`) and install it if not (Electron 44 needs a reasonably current LTS).

### 5. Python / memory tooling (`tools/memory/*.py`)
- `tools/requirements.txt` pins `fastembed==0.3.6` (and `onnxruntime==1.18.1`), which historically only supports Python <3.13 — check the host's `python3 --version` before assuming the pin installs cleanly.
- Arch Linux (and similar rolling-release distros) enforce PEP 668 (`externally-managed-environment`) — global `pip install` is refused. Create a local venv (`python3 -m venv venv` — matches the existing `.gitignore` entry for `venv/`, so it stays untracked).
- If the pinned `fastembed`/`onnxruntime` versions have no wheel for the host's Python version, **ask the user** how to proceed (install newer unpinned versions into the local venv / try to get a matching older Python via pyenv or similar / leave memory search broken for now) rather than silently picking one — it's a real tradeoff between "not tested against this exact pin" and "fully broken."
- After installing, verify for real: `venv/bin/python tools/memory/embed_memory.py --stats` and a `hybrid_search.py --query "..."` call that returns results, not just an import check.
- Remember: `./venv/bin/python`, not bare `python3`, for every `tools/memory/*.py` invocation on a machine where this was needed.

### 6. Claude Code plugins
- Plugins (this project has used `playwright` for browser/screenshot work and `hookify` to enforce the paired `FRONTEND_VERSION`/`sw.js` `CACHE` bump rule — see CLAUDE.md §6a) are **per-machine, per-install** state — they do not travel with the git repo and do not sync between computers even for the same user.
- Check `~/.claude.json` / `~/.claude/` for any plugin or marketplace keys to see if anything is already configured — usually nothing is, on a fresh machine.
- CLI Claude Code: `/plugin`. VSCode extension build: `/plugins` (note the "s") opens the graphical Manage Plugins dialog instead.
- **Ask the user** whether they want plugins (re-)installed now on this machine, rather than assuming.
- `superpowers` plugin was explicitly rejected by the user as too risky (2026-09-09) — never install or suggest it.

### 7. Session-start protocol sanity check
- Confirm CLAUDE.md's Memory Protocol §8 SESSION START begins with `git pull` before `memory_read.py` (added 2026-09-15 specifically for the two-machine workflow — if a future CLAUDE.md edit ever drops this, restore it or ask).
- Actually run it: `git status` (clean or safely stashable?) → `git pull` → `python tools/memory/memory_read.py --format markdown` (via the venv Python if that's what this machine needs).

### 8. Wrap-up
- Summarize what's fixed vs. what needs the user's decision, in plain findings form — don't bury a broken-push-auth finding under a wall of minor cosmetic notes.
- Log a memory event summarizing the machine's specific gotchas (Python version, auth method chosen, whether Desktop/Node is in scope, etc.) so the *next* new-machine session (or this same machine's next session) has it in MEMORY.md/logs without re-diagnosing from scratch.
- **Do not commit or push automatically at the end of this checklist** — infrastructure/config changes made during a new-machine setup (CLAUDE.md, docker-compose.yml, etc.) should only be committed when the user explicitly says so, same as any other change under this project's general "never commit unless asked" rule. (This differs from the routine end-of-session memory commit in §8 Session Close, which is scoped to `goals/ memory/MEMORY.md tools/manifest.md data/memory.db` — a broader infra change like this checklist produces is not covered by that pre-authorization.)

---

## Questions to Ask (don't assume defaults)

1. Push auth method: PAT / SSH key / user handles it themselves?
2. Memory-tool Python mismatch (if hit): install newer unpinned fastembed/onnxruntime into a venv / get a matching Python via pyenv / leave broken for now?
3. Does this machine need Desktop (Electron) development capability, i.e. does Node need installing?
4. Install Claude Code plugins (playwright, hookify) on this machine now, or later?
5. Any stray Docker containers/images found — OK to clean up?
6. Any uncommitted/infra changes made during the check — commit and push now, or hold?
7. Want demo data seeded (`Application/scripts/seed_demo_data.py`)? If yes, get the demo campaign name, DM password and player password from the user (or ask them to run it themselves interactively).

---

## GOTCHA Layer Map

- **Goals:** this file.
- **Orchestration:** run checklist → fix safe items → ask questions for the rest → summarize → wait for explicit commit/push instruction.
- **Tools:** `tools/memory/*.py` (via venv where needed), `docker`, `docker compose`, `git`, `curl`.
- **Context:** CLAUDE.md §6a (frontend release/version rules), §8 (Memory Protocol); memory entries from the 2026-09-15 session (ids 189–190) documenting the first real run of this checklist.
- **Hardprompts:** N/A.
- **Args:** N/A.
