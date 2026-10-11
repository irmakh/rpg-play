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

### 3a. Demo campaign (always, on a new install)
- Every new install gets the demo campaign, **"Shadows over Emberfall"** — **do not ask whether**, install it as soon as the container is up (user's decision, 2026-10-11).
- **Nothing of the campaign is in git — neither its data nor its media** (user's decision, 2026-10-11: the pictures and music may be copyrighted, and the user wants no campaign data on GitHub at all). The whole campaign is one file, `demo_campaign.zip` (63 MB), which the user shares and copies by hand. It belongs at `Application/scripts/demo_campaign.zip` and is ignored by `.gitignore`. **Never `git add` it, never commit an unpacked copy.** If it is not there, **ask the user for it** — do not look for another source and do not fetch it from the production server unasked.
- With the zip in place:
  ```
  docker compose exec -T app python3 scripts/seed_demo_data.py --defaults
  docker compose restart app
  ```
- The restart is part of the step: the app upgrades a campaign's tables when it first opens them and will not look again at databases it already had open.
- `--defaults` asks nothing: DM password `demo-dm`, player password `demo-player` (shared by the 5 characters). Tell the user these at the end. They are written in the script, so this is for development machines only — never run it against a server other people can reach. `--dm-password` / `--player-password` override; without `--defaults` it asks for whichever is missing. `--zip PATH` takes the zip from elsewhere (a path the container can see, so under `Application/`).
- **Every run puts the campaign back as it is in the zip.** It keeps its fixed id (`16f681be-6e2e-4ea6-8644-c32a34888eaf`), so running again overwrites the demo campaign on that machine — databases, files and both passwords — and anything changed in it since is lost. Other campaigns are never touched. That is what the user asked for: the example campaign goes on top of the existing one at each run.
- What the zip holds: `campaign.json` (its registry row, plus `copies` — files to duplicate after unpacking), `data/{localdb,media,stories,aiDM}.db`, and `uploads/` (112 files: portraits, maps, handout/treasury/calendar images, waiting screens, 7 music tracks, one video), which becomes `public/uploads/<id>/`. It fills every screen: 5 characters, 11 monsters, the table with a map, tokens and a fight, 4 prepared maps, treasury with ledger and requests, handouts, calendar, weather, playlists, chat, notifications.
- Must run **inside the container** (the container's Python 3 plus the bind-mounted `campaigns.db`, `data/` and `public/uploads/`, all root-owned on the host). Use `-T` and never feed it a heredoc on stdin — a `docker exec` reading a heredoc without `-i` hung here. `campaigns.db` must exist, i.e. the app has started once.
- It writes the files itself rather than going through the HTTP API — creating a campaign and setting passwords need a DM/admin session, which only the captcha-gated login can give (no automation bypass, by design). The registry row gets a Python replica of `lib/passwords.js`'s scrypt format (verified against `verifyPasswordAsync` again on 2026-10-11 — if that scheme ever changes, `hash_password()` must follow). The databases are copied with SQLite's backup call, which is safe while the app has them open. A zip with a missing part or a file path leading outside its folders is refused.
- Verify after running: `curl http://localhost:3000/api/campaigns` lists "Shadows over Emberfall" with a cover; with `-H "X-Campaign-Id: 16f681be-6e2e-4ea6-8644-c32a34888eaf"`, `/api/table` shows tokens and `hasMap`, `/api/table/map` returns the map and a file under `/uploads/<id>/sounds/` returns audio. A real DM login in the browser is the user's end-to-end check.
- **Rebuilding the zip** (only when the user asks — the original campaign lives on the production server, where it was first built; its generator was never committed): copy `data/campaigns/<id>/*.db` and `public/uploads/<id>/` from the server with scp into a scratch folder outside the repo as `data/` and `uploads/`. Then set every `characters.passwordHash` to `''` and `VACUUM`; point the `table-map` row in `media.db` at `/uploads/<id>/maps/table-map-<id>.png` (on the server it sits in the old shared `uploads/maps/` folder and is a copy of one prepared map — `campaign.json` `copies` recreates it at install, so it is stored once); write `campaign.json` from that campaign's entry in `GET /api/campaigns` (id, name, slug, description, the three cover fields) plus `copies`; zip the three together.

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

---

## GOTCHA Layer Map

- **Goals:** this file.
- **Orchestration:** run checklist → fix safe items → ask questions for the rest → summarize → wait for explicit commit/push instruction.
- **Tools:** `tools/memory/*.py` (via venv where needed), `docker`, `docker compose`, `git`, `curl`.
- **Context:** CLAUDE.md §6a (frontend release/version rules), §8 (Memory Protocol); memory entries from the 2026-09-15 session (ids 189–190) documenting the first real run of this checklist.
- **Hardprompts:** N/A.
- **Args:** N/A.
