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

## Application Tools (`Application/scripts/`)

- **build_templates.py** - Generates `public/css/templates.css`, the ten large-text display templates (Visme's first ten website colour schemes mapped onto the design tokens, `--fs` 1.2), plus the template selectbox styles. Checks every text colour for WCAG AA on all four surfaces and moves a failing colour's OKLCH lightness until it passes, and checks the ids match `public/js/lib/template.js`. Edit the palettes there, never templates.css. Run: `python3 scripts/build_templates.py` (`--check` reports only).
- **seed_demo_data.py** - Installs the demo campaign "Shadows over Emberfall" on a development machine from `Application/scripts/demo_campaign.zip` (its registry row, four databases and 112 uploaded files incl. music). The zip is NOT in git — no campaign data or media is — and is shared by hand; `--zip PATH` for another location, and without it nothing is installed. Every run overwrites the local copy of that campaign (fixed id) and leaves other campaigns alone. Writes the files directly (registry row with Node-compatible scrypt hashing, databases via SQLite backup, uploads unpacked with path checks) since campaign/password creation is captcha-gated over HTTP. Unattended with `--defaults` (DM `demo-dm`, players `demo-player`); `--dm-password` / `--player-password` override. Run inside the app container, then restart it: `docker compose exec -T app python3 scripts/seed_demo_data.py --defaults && docker compose restart app`. Part of every new install — see goals/new_dev_machine_setup.md §3a, which also says how to rebuild the zip.

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


## Application — Login Security (captcha, sessions, lockout — v226)

> Passwords are checked ONLY at login. Every login is captcha-gated and
> throttled, and returns a session token that the browser stores where the
> password used to be (rpgSession.masterPw / .charPw, dmMasterPw, tableMasterPw),
> so the ~180 frontend header sites did not change. The server accepts only
> tokens in X-Master-Password / X-Character-Password. Nothing new installed:
> node:crypto, better-sqlite3 and sharp (already dependencies).

**`Application/lib/captcha.js`** — `createCaptchaStore({now, random})`: `issue(ip)` -> `{id, image, expiresIn}` (PNG data URL), `verify(id, answer)` single-use, 5-min expiry, 60 issues / 5 min / IP, 5,000 outstanding max. `makeProblem()` (a op b, answers 0..99), `renderSvg()` (hand-coded stroke glyphs + jitter + noise), `renderPng()` (sharp rasterises it so no readable shapes reach the page). `_answerOf(id)` is for tests only.

**`Application/lib/login-guard.js`** — `createLoginGuard({now})`: `check(ip, account)`, `fail(ip, account, {alertable})`, `succeed(ip, account)`, `sweep()`, `listLocks()` (live locks with ip/account/timesLocked/failures/first+last attempt — v227), `unlock({ip, account?})` (one account, or the whole address and every account lock on it; resets the escalation). 5 failures per (IP, account) lock 60 s doubling to 30 min; 25 per IP lock the address; `fail().alert` is true once per 15 min when an account reaches 5 wrong PASSWORDS (captcha misses do not count toward it). Also `clientIp(req, trustProxy)`.

**`Application/lib/sessions.js`** — `createSessionStore(db, {now})` on the `sessions` table in campaigns.db: `create({campaignId, role:'dm'|'character'|'admin', charId})` -> `{token:'rpgs_…', tokenHash, expiresAt}` (only the SHA-256 is stored), `resolve(token)` SYNC, `revoke`, `revokeCharacter(campaignId, charId, exceptHash)`, `revokeCampaignRole`, `revokeCampaign`, `sweep`. 24 h idle / 7 days absolute. Also `createSetupTickets()` — single-use 10-min tickets that let a player choose an unclaimed character's first password after the login form's captcha.

**`Application/lib/auth.js`** — `createAuth({sessions, campaignIdFromReq, getCharacter})`: `masterAuth(req)` (sync, same name/signature as before), `charAuth(charId, req)`, `campaignDmAuth(req, campaignId)`, `isAdmin(req)`, `callerFor(req, charId)`, `credentialsValid(req)`, `hasAnySession(req)`, plus `credentialHeader(req, name)`.

**`Application/lib/security-middleware.js`** — `securityHeaders({hsts})`, `jsonBody({smallLimit, bigLimit, bigPaths, hasSession})` (1 MB anonymous / 200 MB with a session or on an open upload route), `bodyErrors()` (JSON 413/400), `sessionGate({auth, exempt})` (401 `SESSION_EXPIRED` for a stale credential).

**`Application/lib/passwords.js`** — adds `hashPasswordAsync` / `verifyPasswordAsync` (scrypt off the event loop). The sync pair stays for start-up code only and is NOT in ctx; the ctx names are the async ones plus `checkDmPassword(pw, campaignId)` (async — replaced `isMasterPassword` under a new name so a missed `await` fails loudly instead of passing a truthy Promise).

**`Application/db/campaignsdb.js`** — `verifyDmPassword` is now ASYNC. New `recordAuthEvent(ev)` / `listAuthEvents({limit, offset})` / `countAuthEvents()` / `pruneAuthEvents()` / `lastAuthEventForIp(ip)` (v227, the "last browser" on the maintenance page) on the `auth_events` table (30 days / 5,000 rows).

**Routes (`server/routes/auth.js`)** — `GET /api/auth/captcha` · `POST /api/auth/login {type, characterId, password, captchaId, captchaAnswer}` -> `{token, …}` or `{needsSetup, setupTicket}` · `POST /api/auth/admin-login` (no campaign needed) · `POST /api/auth/logout {token}` · `POST /api/auth/verify-any` (Stories gate, captcha + lockout). `PUT /api/characters/:id/password` takes a setup ticket or a DM session for a first password, ends the character's other sessions on change, and returns a token to a caller who had none. **`server/routes/maintenance.js` (v227–228):** `GET /api/maintenance/auth-events?page=&pageSize=` (admin session; paged, pageSize 10–200 default 50, a page past the end answers with the last page; `{events, page, pageSize, total, pages}` — moved here from server.js in v228), `GET /api/maintenance/blocked` (every live lock in words — "Aliyr in <campaign>", "DM of <campaign>", "Whole address" — with the last browser from the audit log; a deleted campaign is never reopened for a name) and `POST /api/maintenance/unblock {ip, account?}` (records an `unblocked` audit event). ctx gains `characterName(campaignId, charId)` and `audit.lastForIp`. `/api/console/event` refuses `SESSION_*` messages.

**Frontend** — `public/js/lib/auth-ui.js`: `AuthUI.captcha(el, {onEnter, lazy})`, `login`, `adminLogin`, `verifyAny`, `setFirstPassword`, `logout(token)`, `dmGate({capEl, pwInput, errEl, onUnlock})` (the DM tool pages' gate: unlocks from a live stored session or mounts the captcha), `storedDmToken()`. Self-contained styles (works on the console, AI DM and Stories pages). `js/lib/realtime.js` gained `revokeStoredSession()`, `goToLogin()`, a load-time drop of any pre-v226 plain-password session, and a fetch interceptor for `401 SESSION_EXPIRED`. Console screens share a login through `BroadcastChannel('rpg-console-session')` (SESSION_REQUEST / SESSION_SYNC / SESSION_LOGOUT), same device only.

## Application — Install reporting (v243)

**`Application/lib/telemetry.js`** — the daily anonymous install report: `telemetryEnabled(env)` (off for `TELEMETRY=off/0/false/no`), `createHostTracker()` (middleware + `list()`, first 5 Host headers), `buildPayload(deps)`, `sendReport(url, payload, {fetchImpl})` (never throws), `startTelemetry(deps, {env, log, fetchImpl, firstDelayMs, intervalMs})` -> stop() or null.

**`Application/server/routes/telemetry.js`** — the collector, registered only on the licensor's server (`collectorEnabled()` checks a key against a scrypt hash): `POST /api/telemetry/ping` (no login, `cleanReport()` validates/truncates, 30 reports/hour/IP). `GET /api/maintenance/installs` (super-admin) in `maintenance.js` lists them. `db/campaignsdb.js` gains `getInstallId()`, `countActiveAccounts(days)`, `upsertInstall(r)`, `listInstalls()` (tables `settings`, `installs`, kept 365 days).

**`Desktop/src/main/telemetry.js`** — `reportOnLaunch()`: once a day, unless the `telemetryEnabled` setting is off, posts install id / version / platform / server host.

## Application — Uploads, live delivery, private messages (v234–v237)

**`Application/lib/upload-paths.js`** — the single rule for where an uploaded file may live. `resolveUploadPath(uploadsDir, url, {campaignId, forWrite})` -> absolute path or null (inside uploads, this campaign's folder or a legacy shared folder, media extensions only when writing); `mimeToExt(mime)` (fixed table, else `'bin'`); `safeFileId(id)`. server.js wraps it as `uploadPath(url, forWrite)` (in ctx); every upload read/write/delete and backup restore/export goes through it.

**`Application/lib/realtime-audience.js`** — who a live event reaches. `identityFromSession(session, campaignId)` -> `{campaignId, role, key, charId, charName}`; `payloadFor(identity, campaignId, payload, {dmOnly, to, forOthers, alsoFor})` -> payload / substitute / null; `tokenFromQuery(q)`. server.js `broadcast()` calls it per connection; SSE/WS/console relay take identity from `?token=`.

**`Application/public/js/lib/stories-auth.js`** — the Stories pages' session: `storiesSession()`, `storiesHeaders()`, `storiesFetch()` (re-shows the gate on 401), `storiesStoreSession(data)`.

**`Application/public/js/lib/chat-pm.js`** — private messages on all five chat pages: `initChatRecipients(selectId, inputId)`, `bindChatRecipientPicker`, `chatPmTarget`, `resetChatRecipient`, `chatPmHeaders`, `onPrivateChatSignal(id)` (fetches `/api/chat/entry/:id`; resolves true when shown).

`public/js/lib/chat-render.js` gained `sanitizeChatHtml(html)` / `chatHtmlAttr(tag, name, value)` — HTML chat bodies are rendered through an allowlist.

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

## Application — Console screens (AYN Thor two-screen mode, redesign from v246)

> `/console/` is the two-screen mode: the map on the top screen
> (`console/table-console.html`), an info panel on the bottom one
> (`console/table-secondary.html`), opened from the launcher (`console/index.html`).
> It has its own design system, separate from the main app.

- **`public/css/console/console.css`** — the console design system ("Field Chart"): its own tokens (`--c-*`, never `tokens.css`), the IBM Plex Sans Condensed `@font-face` rules (files in `public/fonts/plex-cond-*.woff2`), and the shared pieces `.c-btn`, `.c-input`, `.c-seg`, `.c-rows`/`.c-row`, `.c-key`, `.c-gate`, `.c-page`. Tokens apply under `html.console` (a converted page) or `.cx` (a new-design island inside an unconverted page).
- **`public/js/console/console-login.js`** — `ConsoleLogin.init({title, sub, onLogin})` returns the stored session or covers the page with the one shared login form (campaign choice when there are several, then character / first-password setup / DM, built on `AuthUI`); `ConsoleLogin.logout()`; `ConsoleLogin.session()`. Also owns the same-device session sync over `BroadcastChannel('rpg-console-session')`.
- **`public/css/console/panel.css`** — the info panel's layout (`.p-*` classes): tabs, the Turn rows, the Token tab's parts, chat, the command bar, the confirm sheet. Also answers to the main app's token names (`--bone`, `--ash`, …) so the shared `chat-render.js` / `chat-pm.js` paint in the console palette.
- **`public/js/console/panel-*.js`** — the info panel, split by tab (classic scripts sharing globals, loaded in this order): `panel-core.js` (state, session, `sAuthHeaders`, `sInitRows()` — the Turn rows as plain data with the who-may-see-what rules, `sConfirm()`, `sToast()`), `panel-nav.js` (`sShowTab`, unread marks `sMark`, command bar `sCmdFor`/`sRenderCmd`), `panel-turn.js`, `panel-token.js` (`sSelectTokenObj`, hit points, conditions, character and monster rolls, stat block, DM manage), `panel-sheet.js` (a character's Skills / Combat / Spells / Items parts of the Token tab: `sRenderSheetPane(name)`, spell slots `sSheetSlot`, limited uses `sSheetUseBox` + `sSheetRest`, wear/unwear `sSheetEquip`; `sReloadSheet()` in panel-token.js re-reads the sheet), `panel-chat.js` (also `sPostInfoCard()`), `panel-table.js` (DM: initiative controls + `sRollInitMonsters()`, maps, token list, fog, hidden items), `panel-music.js` (playback is the shared `js/table/table-music.js` + `js/lib/music-sync.js`, whose element ids the panel provides; this file adds the DM's own controls — playlist, tracks, transport, repeat, volume for everyone — which only send `/api/sound/control` commands), `panel-handouts.js` (Handouts tab: player examine/read, DM give/judge/take back, over the existing `/api/handouts` routes), `panel-notify.js` (routes an opened notification to a tab instead of following its link; the bell itself is the shared `js/lib/notifications.js`), `panel-pad.js` (the panel's gamepad actions, and the button-remapping list `sPadRenderKeys` / `sPadChange` / `sPadReset`), `panel-realtime.js` (live events, the console relay to the map screen, start-up). Replaces the old single `secondary.js`.
- **`public/css/console/map.css`** also restyles the shared table dialogs on the map page (add token, dice roller, monster info, confirm, draw strip, toast, notification list) by giving the main app's token names console values under `body.console-mode`, and holds the live pop-ups `#image-reveal-modal` (`.m-reveal`) and `#map-loading-overlay`.
- **`public/css/console/map.css`** + **`public/js/console/table-console.js`** — the console's frame around the shared map on `console/table-console.html` (`.m-*` classes): status line (`_consoleUpdateTurn`, `_consoleUpdateTool`), Tools drawer (`consoleToggleTools(open?)`), command line with the move arrows and Undo move. `table-console.js` wraps `renderTokens`, `renderInitiativeTracker`, `setTool`, `openHpPanel` and `closeHpPanel` to keep the frame and the info panel in step, and still relays to the panel over `/api/console/event`.
- **`public/js/console/console-gamepad.js`** — gamepad support for both console screens. Pure helpers: `padHeld(gp)` (held control names), `padStep(timers, held, now)` (actions fired this frame, with key-repeat), `padRoute(action, ownActions)`, `padPick(rects, from, dir)` (spatial focus movement). Tables: `PAD_BUTTONS` (standard layout index → control), `PAD_ACTIONS` (control → action), `PAD_KEYS` (keyboard fallback). Button choice: `padDefaultMap()`, `padResolveMap(saved)`, `padAssign(map, control, index)` (swaps), `padInvert(map)`, kept in localStorage `consolePadButtons`. Runtime: `ConsolePad.init({handlers, relay})`, `ConsolePad.remote(action)`, `ConsolePad.capture(done)` / `assign` / `reset` / `label(control)` / `onChange(fn)`. A screen runs the actions it has handlers for and forwards the rest to the other screen as `{type:'PAD', action}` over `/api/console/event`. Handlers: `js/console/panel-pad.js` (info panel: focus, activate, back, tabs, end turn, dice) and the end of `table-console.js` (map: move token, pan, zoom, tools, undo). The panel also sends `{type:'SELECT_TOKEN', id}` so a token chosen there is selected on the map.
- **`public/js/table/table-ux.js`** + **`public/css/table-ux.css`** — the table screen's ease-of-use layer, loaded by `table.html` only (never the console map). Wraps `applyZoom`, `setTool`, `setDiceMode`, `renderTokens`, `renderInitiativeTracker`, `toggleLeftPanel`, `toggleSidePanel`, `chatToggle` (originals kept as `_ux*`). Pure helpers, kept above the "Remembered settings" marker so `tests/unit/table-ux.test.js` can run that slice: `uxWheelZoom(pct, deltaY, deltaMode)`, `uxPinchZoom(startPct, startDist, dist)`, `uxParseHp(text)` ("7"/"-7" damage, "+7" heal), `uxHpAfter(tok, mode, amount)`, `uxToolForKey(key, dm)` / `uxKeyForTool(tool)`, `uxHintText(tool, o)`, `uxSeesStats(tok, dm)`, `uxHoverHTML(tok, o)`, `uxCondsHTML(tok)`, `uxTokenMenuHTML(tok, o)`. Others worth reusing: `uxZoomAt(pct, clientX, clientY)` (zoom keeping a screen point fixed), `uxApplyHp(mode, amount)` (selected token), `uxTogglePop(id)` (toolbar pop-overs: `.ux-anchor` > button[aria-controls] + `.ux-pop`), `uxGet/uxSet(key)` (localStorage under `tbl_`: zoom, tool, lpHidden, rpHidden, chatOpen, followTurn, hints).
- **`dragDistanceLabel(dist, speed, remainingFt, freeMove)`** in `public/js/table/table-utils.js` — text and tone (`ok`/`warn`/`over`) for the label beside a dragged token; used by `table-map.js`, shared with the console map.
- **`public/console/probe.html`** — device check: page size, pixel ratio, gamepad buttons/axes and key events as the browser reports them. No login, sends nothing.
- **`tests/unit/sw-precache.test.js`** — every file in the `sw.js` precache list exists, none is listed twice, and `FRONTEND_VERSION` equals the `sw.js` cache number.

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
- (the info panel's scripts are listed under "Application — Console screens")

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

## Application — DM treasury screen (rebuilt in v266)

- **`public/treasury.html` + `js/treasury.js` + `css/treasury.css`** — one table, one tag at a time, a drawer for the rest; saves as you go. Pure helpers above the "Page state" marker, run by `tests/unit/treasury-ui.test.js`: `parsePrice(text)` ("50", "7 sp", "2 pp 5 gp" → copper, null if not a price), `parseStock(text)` / `stockText(q)` (∞ = -1), `itemsInView(items, {view, mode, q, askedIds})` (view = a tag, `''` for no tag, `VIEW_ALL` or `VIEW_ASKED`), `sortItems(list, key, dir, askCount)`, `tagEntries(items, shopOpen, activeTags)` (count / forSale / onSale per tag), `shopTagsAfterToggle(active, tag)`, `KINDS` / `kindOf(key)` / `sectionShown(item, sect)` / `kindSummary(item)`.
- Page side worth knowing: `queueSave(id, patch, {now, label})` → `flushSave(id)` (optimistic, debounced 700 ms, one step of `undoLast()`; identify is never undoable); `loadItems()` re-applies patches still in flight; `renderTable()` holds off while a cell is being typed in (`editing`, `renderDue`); `fillDrawer(item, force)` skips the focused field; every plain drawer field carries `data-f` and goes through `onField(el)`. The view is remembered in localStorage `treasury-view`.
- **Server** (`server/routes/treasury.js`): `POST /api/treasury/:id/duplicate` (hidden copy, own picture files) · `POST /api/treasury/:id/give {charId, quantity}` (DM hands an item straight to a character through `grantItems()`; stock counts down but never blocks; exhausted free loot goes hidden and pending requests are declined) · item kind `potion` added to `ITEM_TYPES` (labelled on the sheet in `index-items.js`, `index-treasury.js` and the `im-type` select).

## Application — Spells tab of the table panel (v264)

- **`public/js/table/table-utils.js`** gained the pure builders for the right panel's Spells tab (and its pop-out), tested in `tests/unit/table-spells.test.js`: `spellShown(s, filter, query)` (filter `prepared` / `unprepared` / `all` on spell row index 7, plus a name search), `spellCounts(spells)`, `spellSlotsHTML(slots, canEdit)` (one `.rp-slot-row` per level, `.rp-slot-pip` / `.used`, "N of M left"; pip `j` still calls `clickSpellSlotPip(level, j)` with open slots first), `spellbookHTML(spells, {filter, query, spAtk})` (every spell in the markup under `#rp-sb`, rows carry `data-idx` = index in the full list and call `postSpellInfoFromAll(idx)`; filtered-out rows are only hidden).
- **`public/js/table/table-panel.js`**: `_sideSpellFilter` / `_sideSpellQuery`, `setSideSpellFilter(f)`, `setSideSpellQuery(q)` and `_applySideSpellFilter()` — the filter and search show and hide rows in place instead of re-rendering, so the search box keeps its cursor. The query is cleared when the panel moves to another token; the filter is kept.

## Application — Item charges and the name while unidentified (v263)

- **Treasury item fields** (`treasury_items` columns, `objFromRecord` in `server/routes/treasury.js`): `unidName` (what players read until the item is identified), `charges` (0–999, 0 = none), `chargesRecharge` (`'long'` or `''`). `playerObj()` sends an unidentified item as `name: unidName || name` with `alias: true|false`, no `unidName`, and `charges: 0`; `shownName(item)` is the name a player may be shown in any message. `grantItems()` stores a hidden copy under `unidName` (or the old "name - (unidentified)") and an identified copy with `charges` / `chargesUsed: 0` / `chargesRecharge`; `identifyHeldCopies()` fills them in on identify.
- **Inventory item fields** (a character's `_items`): `charges`, `chargesUsed`, `chargesRecharge`. `PATCH /api/characters/:id/item-charges {itemId, used}` (DM or that character; clamps to 0..charges; broadcasts `characters` with `keys:['_items']`). `POST /api/characters/:id/action-rest {type:'long'}` also zeroes `chargesUsed` on items with `chargesRecharge:'long'`.
- **Sheet** (`public/js/index/index-items.js`): `itemChargesMax(item)`, `itemChargesLeft(item)`, `useItemCharge(id)` (spends one, autosaves, posts to chat), `refillItemCharges(id)`, `restItemCharges(type)` (called by `actionRest`). `saveItemModal()` now merges over the stored item, so fields the form does not show (`srcId`, `img`, `unidentified`) survive an edit.
- **Table panel** (`public/js/table/table-panel.js`): `clickUseItem(itemId)` — optimistic, saved through `item-charges`, announced with `postChatInfoCard`.

## Application — Calendar list and weather wording (v262)

- **`public/js/lib/calendar-list.js`** — the events list both calendars use (events.html and the index Calendar tab). Pure helpers, kept above the "The list on a page" marker so `tests/unit/calendar-list.test.js` can run that slice: `calOrdinal(d)` (one sortable number per day, festivals in place), `calKind(e)` (a character's entry is always `journal`), `calVisibility(e)` (`public`/`dm`/`shared`/`private`), `calFilterEvents(events, {scope, view, selected, today, q, kind, vis, author})` (scope `day`/`month`/`upcoming`/`all`), `calGroupByDay(events)`, `calKindsIn`, `calAuthorsIn`, `calScopeHeading(f)`, `calRowHTML(e, o)`, `calGroupsHTML(groups, o)`. Page side: `calListCreate(name, cfg)` → `{state, render(), setScope()}`; cfg gives element ids, getters for the page's events/view/selected day/campaign date, and `actionsHTML` / `mediaHTML` / `weatherHTML` / `onPickDay` / `onScope`. Needs `fr_calendar.js` and the page's `esc()` / `escJs()`.
- **`lib/weather-words.js`** — a weather entry in words: `describeWeather(entry)` (what players are told; never a number) and `weatherDetail(entry)` (values with their rolls, for the DM). `server/routes/events.js` adds both to every entry it returns (`description`, `detail`) instead of storing them.
- **`PUT /api/calendar/state`** now also makes the weather: when the date really changes, the day landed on gets a roll from the stored config unless it already has weather; players get a `calendar` notification with the description, the DM a `weather` one with the detail. Response: `{ok, weather, rolledNow}`. The browser sends `dateLabel` with the date (the server has no month names).

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

## Desktop Client (`Desktop/`)

> Electron thin client over the existing web app. It renders the pages the server
> already serves — no server code and no web-app code lives here, and nothing
> under `Application/` was changed to support it. See `Desktop/README.md`.

**`Desktop/src/main/main.js`** — lifecycle: single-instance lock, permission policy (fullscreen and notifications only; camera/microphone refused), first-run routing to the setup window.

**`Desktop/src/main/config.js`** — settings as one atomic-written JSON file in the Electron userData folder: server URL, trusted certificate fingerprints, per-role window geometry and zoom, hotkeys, tray preferences.

**`Desktop/src/main/windows.js`** — window roles (table, dm, sheet, monsters, events, treasury, stories, playlists, nowplaying, campaigns, console, secondary). `musicRole()` picks the music screen from the signed-in role: DM gets the `playlists` control panel, everyone else the compact `nowplaying` window (music-player.html has no auth guard, playlists.html is DM-gated). Each role remembers size, position, monitor and zoom; table and second-screen prefer a secondary display. Also the navigation policy: same-origin pop-outs stay native windows so `table-popout.js` keeps working, everything else opens in the system browser.

**`Desktop/src/main/session-store.js`** + **`src/preload/app-preload.js`** — the cross-window login mirror. `sessionStorage` is per-window, so a second window would open on the login screen; the main process holds the authoritative copy and the preload seeds it synchronously before page scripts run, polls outward every 700ms (an isolated world cannot observe `sessionStorage` writes), and applies broadcasts inward. In memory only — quitting signs you out.

**`Desktop/src/main/certs.js`** — per-host TLS trust pinned by SHA-256 fingerprint, prompted once with issuer/subject/fingerprint shown. Needed because a public CA cannot issue for a bare IP; connecting by domain validates normally and never prompts.

**`Desktop/src/main/downloads.js`** — native Save dialogs for DB backups, map exports and character XML, remembering the last folder and notifying with "show in folder" on completion.

**`Desktop/src/main/menu.js`** / **`tray.js`** / **`shortcuts.js`** — application menu (rebuilt when monitors change), tray icon, and global hotkeys (defaults `Ctrl+Alt+T/D/C/M/R`, where M resolves per press via `windows.musicRole()`; a second press minimises; accelerators another app owns are reported, not swallowed).

**`Desktop/src/main/ipc.js`** — every renderer-reachable channel. `ui:probe-server` validates an address against `GET /api/config` before it can be saved, and compares the server's published `wsUrl` host against the entered host to catch the IP-vs-domain mismatch that would put realtime traffic on a different origin.

**Build** — `npm start` to run, `npm run build` for the Windows NSIS installer + portable exe. Inside a VS Code terminal or agent session, launch with `env -u ELECTRON_RUN_AS_NODE` or Electron boots as plain Node and crashes on `setAppUserModelId`.

---

*Add new tools here as they are created*
*Format: `- **script_name.py** - One-sentence description of what it does`*
*Organize by workflow/category*
