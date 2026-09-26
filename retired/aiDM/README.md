# AI DM — retired (v236, 2026-09-26)

The AI Dungeon Master text adventure, moved here unchanged from `Application/aiDM/`.
It lives outside `Application/` so it is no longer deployed, and the server no longer
registers its routes (`/ai-dm`, `/api/ai-dm/*`) or opens its database.

**It will not run from here as it is.** `routes.js` imports `../lib/request-context.js`,
and the campaign store no longer opens each campaign's `aiDM.db`. Bringing it back means
reversing both, and the v236 changes to `server.js`, `db/campaign-store.js`,
`lib/request-context.js` and the character sheet's AI DM button.

**Do not bring it back as it is.** A security review in v235–v236 found its endpoints
need no login. Anyone who could reach the server could replace or wipe the stored
OpenRouter/OpenAI API keys, spend them on any model through `scenarios/generate` or
`PATCH sessions/:id/model`, and make the server request arbitrary URLs through the
LM Studio address (`lmStudioUrl`). Those need fixing first.

Existing sessions are not lost: each campaign's `data/campaigns/<id>/aiDM.db` stays on
disk and is still included in the raw database backup.
