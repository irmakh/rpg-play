# Spellcasting redesign — plan

Status: **release 1 released as v320–321** (11 November 2026, commit 806981c).
**Release 2 released as v322–323** (11 November 2026). Releases 3–4 not started.
Source: player feedback (below) plus spell import from 5etools JSON.

## The feedback, in short

1. The player enters each spell's details: action, bonus action, ritual casting, and so on.
2. The player picks which spells are prepared. Classes that do not prepare (Warlock,
   Sorcerer) have all their spells ready. A checkbox marks spells that need no slot.
3. In combat a **Cast a Spell** button opens a list. Choosing a spell and pressing Cast
   asks which slot level to use and spends that slot automatically. Spells that cannot be
   cast because the slots are gone are greyed out and cannot be chosen.
4. When a spell is saved, its source is recorded: "Feat: Magic Initiate", "Species
   trait", "Class feature", and so on.

## Decisions taken

| Question | Answer |
|---|---|
| Who imports spell JSON | **Both**: the DM imports into a per-campaign library; a player can also import JSON straight onto their own sheet, which adds it to the library too |
| What greys out when slots run out | **Upcasting allowed**: a spell greys out only when no slot of its level **or higher** is left; the slot picker greys the empty levels |
| What Cast does | Spends the slot and posts a **spell card** to chat, with attack and damage buttons, damage already scaled for the chosen slot |
| Monsters | **Tracked per token**: each monster token has its own slots and X/day uses |
| Spells that need no slot | **Optional uses** with a short- or long-rest recharge; blank means at will |
| Where the Cast button is | Table right panel (and its pop-out), character sheet, console screen |
| Action economy | **Shown, not tracked**: casting time is displayed and filterable; nothing counts the turn's action |
| When monster uses refill | A **DM button** (one token, or every monster); a newly placed token starts full |

## What exists today

- A character's spells are `_spells`: a list of 15-element arrays
  (`[lvl, name, time, range, conc, ritual, notes, prepared, school, v, s, m, material,
  actionCategory, duration]`). It is read by name and position in `index-char.js`,
  `index-calc.js`, `index-actions.js`, `table-panel.js`, `table-utils.js`,
  `console/panel-sheet.js`, the XML export/import and the creator import.
- Slots are `slot-N-total` / `slot-N-used` on the sheet; the table panel's slot markers
  call `PATCH /api/characters/:id/spell-slot`.
- Monster spellcasting is the 5etools `spellcasting` block in the monster's data (`will`,
  `daily`, `spells[level].slots`). It is rendered as text by `monster-stat-block.js` and
  nothing is tracked.
- No spell details are stored anywhere; the sheet holds only what was typed.

## Design

### Spell library (per campaign)

- New table `spells` in each campaign's `localdb`: `id`, `name`, `source` (book code,
  e.g. `XPHB`), `level`, `school`, `json` (the original 5etools object, kept whole),
  `createdAt`, `addedBy`. Unique on name + source, so re-importing updates instead of
  duplicating.
- Import accepts one spell object, an array of spells, or a 5etools file
  (`{"spell":[...]}`). Size cap per import; everything not a spell is skipped and
  reported ("212 imported, 3 updated, 1 skipped").
- `js/lib/spell-data.js`, shared by every page, turns the 5etools object into what the
  app needs: casting time and type, range, components and material, duration,
  concentration, ritual, school name, classes, damage types, attack or saving throw,
  description and higher-level text.
- **Damage scaling** is read from the data itself: `{@damage 1d4 + 1}` in the
  description, `{@scaledamage 8d6|3-9|1d6}` in the higher-level text, and
  `scalingLevelDice` for cantrips (by character level). When a spell has none of these,
  the card shows the text and no damage button.
- **DM page** `spells.html` in the same master-detail layout as the treasury page: list
  with search and filters (level, school, class, source), detail view, import button,
  delete. Linked from the DM panel.
- **Player import**: an "Import spell JSON" button on the Spells tab. It adds the spells
  to the library and to the sheet in one step.
- Players can add library spells to their sheet from a searchable picker, and can still
  type in a custom spell that is in no library.

### The spell on a character sheet

`_spells` becomes a list of objects. A reader accepts both shapes, so old saves, old
backups and old XML files convert on load:

```
{ id, libId,                      // libId: the library spell it came from, if any
  name, level, school,
  cast: 'action'|'bonus'|'reaction'|'minute'|'hour'|'other', castText,
  ritual, conc, range, duration, v, s, m, material,
  prepared,
  noSlot, uses, used, recharge: ''|'short'|'long',
  source: { kind: 'class'|'subclass'|'feat'|'species'|'feature'|'item'|'other', detail },
  notes }
```

- Rows linked to the library show the library's description; custom rows keep their own.
- **Source** is a kind (dropdown) plus free text: "Feat: Magic Initiate",
  "Class: Wizard", "Species: High Elf", "Class feature: Pact of the Tome".
- **Prepares spells** switch per character (`sp-prepares`, default on). Off hides the
  Prep column and treats every spell as ready.
- **No slot needed** box per spell, with optional uses and recharge.
- The Actions tab lists spells whose casting time is an action, bonus action or reaction,
  replacing the separate "show in Actions" dropdown (old values are carried over).
- **Rests**: Long rest refills all slots and every no-slot spell's uses; Short rest
  refills short-recharge uses. This joins the existing rest buttons and
  `POST /api/characters/:id/action-rest`.

### Cast a Spell

One shared pop-up, `js/lib/spell-cast.js`, used by the sheet, the table panel, the
pop-out and the console:

- Lists the spells the character can cast: prepared spells (or all when the character
  does not prepare), cantrips and no-slot spells. Grouped by level, searchable, with a
  filter for Action / Bonus / Reaction / Ritual.
- A spell is **greyed and cannot be chosen** when it needs a slot and no slot of its level
  or higher is left, or when it has no slot and its uses are spent.
- Choosing a spell shows the **slot picker**: levels from the spell's own up to 9, empty
  levels greyed, the lowest available level selected. A ritual spell also offers "Cast as
  ritual (no slot)".
- **Cast** calls a new `POST /api/characters/:id/cast` with `{ spellId, slotLevel,
  ritual }`. The server checks the slot or use is really available, spends it, posts the
  chat card and broadcasts the change. Two windows casting at once cannot both spend the
  last slot.
- **The chat card** is a new chat entry type `spell`: caster, spell, the level it was cast
  at, casting time, range, duration, concentration, a short description with a "more"
  toggle, and buttons for **Attack** (spell attack bonus) or the **save DC**, and
  **Damage** (scaled dice, damage type). The buttons roll through the existing dice code.
  Only the caster and the DM see working buttons; everyone sees the card. Rendered by
  `chat-render.js`, so all five chat views get it.

### Monsters

- The monster's spellcasting block becomes a list of castable entries: at will, X/day
  (each and shared), slots per level, and cantrips. Spell names are looked up in the
  campaign library for details; a spell not in the library still casts, with a link
  instead of a description.
- New token column `spellUses` (JSON): slots used per level, uses per X/day group. Empty
  means full, so existing and newly placed tokens start full.
- The DM's monster panel gets the same **Cast a Spell** pop-up and slot rule.
  `POST /api/table/tokens/:id/cast` (DM only) spends the use and posts the card.
  A hidden monster's cast goes to the DM only.
- **Long rest** button on a monster's panel, and "Rest all monsters" for the whole table:
  `POST /api/table/tokens/:id/spell-rest` and `POST /api/table/spell-rest`.
- The monster's save DC and spell attack come from its spellcasting header
  (`{@dc 15}`, `{@hit 7}`), as the stat block shows them now.

## Releases

Each release is usable and testable on its own.

| Release | Contents |
|---|---|
| **1. Library and the new spell record** | `spells` table and routes; `spell-data.js`; DM `spells.html` with import; player JSON import; library picker on the sheet; new spell object with conversion of old data; Spells tab redesign (source, no-slot uses, casting type, Prepares switch); rests refill slots and uses; XML export/import and creator import updated; every reader of `_spells` moved to the new shape |
| **2. Cast a Spell for players** | `spell-cast.js` pop-up; cast route; `spell` chat card with roll buttons; button on the sheet (Spells and Actions tabs) and the table panel and pop-out |
| **3. Monsters** | spellcasting parser; `spellUses` per token; DM cast pop-up and route; rest buttons |
| **4. Console** | Cast pop-up on the console info panel for players and the DM |

## Import script

Built 2026-11-11: `Application/scripts/import_spells.mjs` (see tools/manifest.md), plus a DM
button **Import from books** on `spells.html` that imports chosen books into the campaign on
screen. Both download through `lib/spell-source.js` into memory only (user: delete the
downloaded files) — nothing is cached or kept anywhere. 5e.tools blocks
automated downloads, so the user approved the GitHub copy of the same data
(`5etools-mirror-3/5etools-src`), plus `--from <folder>`. Decisions taken:

- **Data**: downloaded from the GitHub copy of the 5etools data (5e.tools itself refuses automated
  downloads), the raw JSON files, not HTML scraping. Downloaded data is never
  committed (copyright, same rule as the demo campaign media).
- **Campaigns**: one campaign per run by name or id, or `--all`; a dry run first
  reports what would change.
- **Library**: every downloaded spell goes into the chosen campaign's library
  (same upsert rule as the DM import).
- **Linking**: each sheet spell is matched by name to the library. When a name is in
  several books, prefer XPHB, then PHB, then any other.
- **Merge**: the library overwrites casting time, range, duration, school,
  components, concentration and ritual, and adds the description. The player's
  prepared flag, notes, source and uses are kept.

## Tests

- Unit: 5etools spell conversion (time, range, components, duration, ritual,
  concentration); damage scaling for `{@damage}`, `{@scaledamage}` and cantrip level
  dice; conversion of old 15-element rows; the greying rule (upcasting, empty levels,
  spent uses); monster spellcasting parsing (`will`, `daily` incl. `1e`, slots).
- API: library import (single, array, file, re-import updates); a player cannot delete
  library spells; cast spends exactly one slot and refuses when none is left; a ritual
  cast spends nothing; rests refill the right things; monster cast is DM-only; a hidden
  monster's card reaches the DM only.
- Every new route makes its own auth check (see the security roadmap).

## Points to watch

- Spell text from imported JSON is rendered through the existing 5etools tag parser and
  escaped; check that `parseEntry` escapes plain text before reusing it for the card.
- 5etools data is the user's own import and lives only in each campaign's database; none
  is committed to the repo or shipped with the demo campaign.
- Warlock Pact Magic (slots that refill on a short rest) is not in this plan; it can be
  added later as a slot group with its own recharge.
- Old cached pages read `_spells` as arrays. The release bumps `FRONTEND_VERSION`, and the
  server keeps accepting array-shaped saves for one release so a stale tab cannot corrupt
  a sheet.
