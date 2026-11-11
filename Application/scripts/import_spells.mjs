#!/usr/bin/env node
// Written by Irmak Hakman — 2026-11-11 20:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Fill a campaign's spell library from the 5etools data, then link every spell
 * on its character sheets to the library.
 *
 *   node scripts/import_spells.mjs --campaign "For the Glory of Amn"        (dry run)
 *   node scripts/import_spells.mjs --campaign "For the Glory of Amn" --apply
 *   node scripts/import_spells.mjs --all --apply
 *   node scripts/import_spells.mjs --all --from ./my-spell-files
 *   node scripts/import_spells.mjs --campaign demo --books XPHB,XGE --apply
 *   node scripts/import_spells.mjs --campaign demo --link-only --apply
 *   node scripts/import_spells.mjs --campaign demo --link-only --use-closest --apply
 *
 * --link-only skips the download and the library: it links the sheets to what
 * the campaign's library already holds (e.g. books the DM imported with the
 * Spells page's "Import from books").
 *
 * --use-closest links a spell with no exact match to the closest library name
 * (the first of the names the report lists after "closest:") — for sheets
 * whose misses are typos. Those lines are marked "~" in the report; check
 * them in a dry run first. The sheet then shows the library's spelling.
 *
 * Run it from Application/ (in local Docker: docker exec char_sheet_dev node
 * scripts/import_spells.mjs ...). Without --apply nothing is written: it only
 * reports what would change.
 *
 * Where the data comes from
 *   default         the 5etools data files in the public GitHub repo
 *                   5etools-mirror-3/5etools-src (5e.tools itself refuses
 *                   automated downloads), fetched into memory for this run and
 *                   then discarded — nothing is written to disk
 *                   (lib/spell-source.js, shared with the DM's Import from books).
 *   --books a,b     only these books (codes as in 5etools: XPHB, PHB, XGE…);
 *                   every official book otherwise, not just the PHB.
 *   --from <dir>    spells-*.json files saved by hand (and sources.json, which
 *                   holds the class lists, if you have it).
 *   Nothing from that repository is ever stored in, or committed to, this project.
 *
 * What happens to a campaign
 *   1. Library: every spell goes in. A spell already there (same name and book)
 *      is replaced when the data differs — the same rule as the DM's import.
 *   2. Sheets: each spell is matched by name. When a name is in several books
 *      the version used is XPHB, then PHB, then any other book. On a match the
 *      library's casting time, range, duration, school, components,
 *      concentration, ritual and level replace what was typed, and the
 *      description is added. The player's prepared flag, notes, source and uses
 *      are kept; an empty source is filled with the character's class when the
 *      spell is on that class's list.
 *   Spells with no match are left as they are and listed, with the closest
 *   library names, so typos and homebrew are easy to spot.
 *
 * Run it when nobody is editing a sheet's spells: an open sheet that saves its
 * spell list afterwards would write its older copy back. Players reload to see
 * the change.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import * as cdb from '../db/campaignsdb.js';
import { campaignDir, DB_FILES } from '../db/campaign-store.js';
import { openCampaignDb } from '../db/localdb.js';
import { checkSpell } from '../server/routes/spells.js';
import { fetchBooks, collectSpells } from '../lib/spell-source.js';

export { collectSpells };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
export const BOOK_ORDER = ['XPHB', 'PHB'];   // then any other book, alphabetically

// The browser's own spell code, so a linked spell is built exactly as the
// sheet's "From library" builds one.
const SP = vm.createContext({ JSON, Math, Date, String, Number, Array, Object, Set });
vm.runInContext(fs.readFileSync(path.join(APP, 'public/js/lib/spell-data.js'), 'utf8'), SP);

// ── Arguments ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { campaign: '', all: false, apply: false, from: '', books: [], linkOnly: false, useClosest: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--campaign') a.campaign = argv[++i] || '';
    else if (k === '--all') a.all = true;
    else if (k === '--apply') a.apply = true;
    else if (k === '--from') a.from = argv[++i] || '';
    else if (k === '--books') a.books = String(argv[++i] || '').split(',').map(x => x.trim()).filter(Boolean);
    else if (k === '--link-only') a.linkOnly = true;
    else if (k === '--use-closest') a.useClosest = true;
    else if (k === '--verbose' || k === '-v') a.verbose = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown option: ${k}`);
  }
  return a;
}

// ── Loading the 5etools data ──────────────────────────────────────────────────
/** { files: number, spells, withClasses } — from a folder, or fetched into memory. */
async function loadData({ from, books }) {
  if (from) {
    const dir = path.resolve(from);
    const names = fs.readdirSync(dir).filter(f => /\.json$/i.test(f) && f !== 'sources.json' && f !== 'index.json');
    if (!names.length) throw new Error(`No spell JSON files in ${dir}`);
    const files = names.map(n => ({ name: n, text: fs.readFileSync(path.join(dir, n), 'utf8') }));
    const srcFile = path.join(dir, 'sources.json');
    const sources = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, 'utf8')) : null;
    return { files: files.length, spells: collectSpells(files, sources), withClasses: !!sources };
  }
  const got = await fetchBooks(books);
  return { files: got.books.length, spells: got.spells, withClasses: true, books: got.books };
}

// ── Matching names ────────────────────────────────────────────────────────────
/** A name as it is compared: case, apostrophes, punctuation and spacing ignored. */
export function nameKey(name) {
  return String(name || '').toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\((?:ritual|r|concentration|c)\)/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
/** The same name with nothing but letters and digits: "Wind Wall" = "Windwall", "Hunter's Mark" = "Hunters Mark". */
export function compactKey(name) {
  return nameKey(name).replace(/[^a-z0-9]/g, '');
}
/** "Tasha's Hideous Laughter" also answers to "Hideous Laughter", and back. */
function withoutOwner(key) {
  return key.replace(/^[a-z]+'s /, '');
}

function bookRank(source) {
  const i = BOOK_ORDER.indexOf(source);
  return i >= 0 ? i : BOOK_ORDER.length;
}

/**
 * name key -> library rows, best book first. Each spell is indexed under its
 * name, its SRD names (5etools' `srd` / `srd52`, e.g. "Hideous Laughter") and
 * the name without a wizard's possessive.
 */
export function buildIndex(rows) {
  const idx = new Map();
  const add = (key, row) => {
    if (!key) return;
    const list = idx.get(key) || [];
    if (!list.includes(row)) list.push(row);
    idx.set(key, list);
  };
  for (const row of rows) {
    const keys = [row.name, row.data && typeof row.data.srd === 'string' ? row.data.srd : '',
                  row.data && typeof row.data.srd52 === 'string' ? row.data.srd52 : ''].map(nameKey);
    for (const k of keys) {
      add(k, row); add(withoutOwner(k), row);
      add('#' + compactKey(k), row); add('#' + compactKey(withoutOwner(k)), row);
    }
  }
  for (const list of idx.values()) {
    list.sort((a, b) => bookRank(a.source) - bookRank(b.source) || a.source.localeCompare(b.source));
  }
  return idx;
}

/** The library row a sheet spell belongs to, or null. A row it is already linked to wins. */
export function findMatch(sp, idx, byId) {
  if (sp.libId && byId.has(sp.libId)) return byId.get(sp.libId);
  const k = nameKey(sp.name);
  const hit = idx.get(k) || idx.get(withoutOwner(k))
    || idx.get('#' + compactKey(k)) || idx.get('#' + compactKey(withoutOwner(k)));
  return hit && hit.length ? hit[0] : null;
}

/** Closest library names for an unmatched spell (shared words, then shared letters). */
function suggest(name, rows, n = 3) {
  const k = nameKey(name);
  const words = new Set(k.split(' ').filter(w => w.length > 2));
  const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const gk = grams(k);
  const scored = [];
  const seen = new Set();
  for (const r of rows) {
    const rk = nameKey(r.name);
    if (seen.has(rk)) continue;
    seen.add(rk);
    let w = 0; for (const x of rk.split(' ')) if (words.has(x)) w++;
    const gr = grams(rk); let c = 0; for (const g of gk) if (gr.has(g)) c++;
    const score = w * 2 + (2 * c) / (gk.size + gr.size || 1);
    if (score > 0.5) scored.push([score, r.name]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
}

// The fields the library replaces on a linked spell (the user's rule).
const LIB_FIELDS = ['level', 'school', 'cast', 'castText', 'range', 'duration', 'conc', 'ritual', 'v', 's', 'm', 'material'];

/**
 * A sheet spell linked to a library row: library facts in, player's choices kept.
 * Returns { spell, changes } — changes as [field, before, after].
 */
export function linkSpell(sp, row, charClass) {
  const lib = SP.spellFrom5e(row.data, row.id);
  const next = { ...sp, libId: row.id, book: lib.book, name: lib.name, entries: lib.entries, higher: lib.higher };
  const changes = [];
  if (sp.name !== lib.name) changes.push(['name', sp.name, lib.name]);
  for (const f of LIB_FIELDS) {
    if (JSON.stringify(sp[f]) !== JSON.stringify(lib[f])) changes.push([f, sp[f], lib[f]]);
    next[f] = lib[f];
  }
  if (sp.libId !== row.id) changes.push(['library', sp.libId || '(none)', `${row.name} (${row.source})`]);
  if (!sp.entries.length && lib.entries.length) changes.push(['description', '', 'added']);
  // An empty source becomes the character's class, when the spell is on its list.
  if (!sp.source.kind && !sp.source.detail && charClass) {
    const cls = SP.spellClasses(row.data).find(c => c.toLowerCase() === charClass.toLowerCase());
    if (cls) { next.source = { kind: 'class', detail: cls }; changes.push(['source', '', `Class: ${cls}`]); }
  }
  return { spell: SP.normalizeSpell(next), changes };
}

// ── One campaign ──────────────────────────────────────────────────────────────
function libraryPass(ldb, spells, apply) {
  const r = { added: 0, updated: 0, same: 0, skipped: 0 };
  const seen = new Set();
  const run = () => {
    for (const raw of spells) {
      const c = checkSpell(raw);
      if (c.error) { r.skipped++; continue; }
      const key = c.name.toLowerCase() + '|' + c.source;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = ldb.findSpell(c.name, c.source);
      if (!row) { r.added++; if (apply) ldb.createSpell(crypto.randomUUID(), { ...c, addedBy: 'import script' }); }
      else if (JSON.stringify(row.data) !== JSON.stringify(c.data)) { r.updated++; if (apply) ldb.updateSpell(row.id, c); }
      else r.same++;
    }
  };
  if (apply) ldb._db.transaction(run)(); else run();
  return r;
}

const fmt = v => (v === true ? 'yes' : v === false ? 'no' : v === '' || v == null ? '—' : String(v));

function sheetPass(ldb, rows, apply, verbose, log, useClosest = false) {
  const idx = buildIndex(rows);
  const byId = new Map(rows.map(r => [r.id, r]));
  const t = { chars: 0, spells: 0, linked: 0, already: 0, unmatched: 0, closest: 0, changedChars: 0 };
  for (const ch of ldb.listCharacters()) {
    let data = {};
    try { data = JSON.parse(ch.dataJson || '{}'); } catch { continue; }
    if (data._spells === undefined) continue;
    const list = SP.parseSpellList(data._spells);
    if (!list.length) continue;
    t.chars++;
    const lines = [];
    const missing = [];
    let changed = false;
    const out = list.map(sp => {
      if (!sp.name) return sp;           // an empty row on the sheet: nothing to match
      t.spells++;
      let row = findMatch(sp, idx, byId);
      let guessed = false;
      // A typo: take the closest library name, as if it had been typed.
      if (!row && useClosest) {
        const best = suggest(sp.name, rows, 1)[0];
        if (best) { row = findMatch({ name: best, libId: '' }, idx, byId); guessed = !!row; }
      }
      if (!row) {
        t.unmatched++;
        missing.push(sp.name || '(no name)');
        return sp;
      }
      const { spell, changes } = linkSpell(sp, row, String(data.class || '').trim());
      if (!changes.length) { t.already++; return sp; }
      t.linked++;
      if (guessed) t.closest++;
      changed = true;
      const shown = verbose ? changes : changes.filter(([f]) => f !== 'description');
      lines.push(`  ${guessed ? '~ ' : '  '}${sp.name} -> ${row.name} (${row.source}${row.data.page ? ' p' + row.data.page : ''})`
        + (shown.length ? ': ' + shown.map(([f, a, b]) => `${f} ${fmt(a)} -> ${fmt(b)}`).join('; ') : ''));
      return spell;
    });
    // A sheet still holding the old array rows is written back as objects too.
    const before = typeof data._spells === 'string' ? data._spells : JSON.stringify(data._spells);
    const after = JSON.stringify(out);
    const converted = !changed && before !== after && /^\s*\[\s*\[/.test(before);
    if (changed || converted) {
      t.changedChars++;
      if (apply) ldb.updateCharacter(ch.id, { dataJson: JSON.stringify({ ...data, _spells: after }) });
    }
    if (lines.length || missing.length || converted) {
      log(`  ${ch.name || 'Unnamed'}${data.class ? ' (' + data.class + ')' : ''}`
        + `: ${lines.length} to link${lines.some(l => l.startsWith('  ~')) ? ` (${lines.filter(l => l.startsWith('  ~')).length} by closest name)` : ''}${missing.length ? `, ${missing.length} not found` : ''}${converted ? ', old spell rows converted' : ''}`);
      for (const l of lines) log(l);
      for (const m of missing) {
        const s = suggest(m, rows);
        log(`    ? ${m}${s.length ? '   (closest: ' + s.join(', ') + ')' : '   (no similar name — homebrew?)'}`);
      }
    }
  }
  return t;
}

/** `spells` null = link only: no library changes, match against the library as it is. */
export function runCampaign(campaign, spells, { apply, verbose, useClosest = false, log = console.log }) {
  const file = path.join(campaignDir(campaign.id), DB_FILES.local);
  if (!fs.existsSync(file)) { log(`  (no database for ${campaign.name}; skipped)`); return null; }
  const ldb = openCampaignDb(file);
  try {
    let lib = null, rows;
    if (spells) {
      lib = libraryPass(ldb, spells, apply);
      log(`  Library: ${lib.added} new, ${lib.updated} updated, ${lib.same} unchanged${lib.skipped ? `, ${lib.skipped} skipped (reprint references)` : ''}`);
      // A dry run matches against what the library WOULD hold.
      rows = apply ? ldb.listSpells() : previewRows(ldb, spells);
    } else {
      rows = ldb.listSpells();
      log(`  Library: ${rows.length} spells already there (link only, nothing downloaded)`);
      if (!rows.length) { log('  The library is empty: import books first.'); return { lib, sheets: null }; }
    }
    const t = sheetPass(ldb, rows, apply, verbose, log, useClosest);
    log(`  Sheets: ${t.chars} with spells, ${t.spells} spells — ${t.linked} to link/update${t.closest ? ` (${t.closest} by closest name)` : ''}, ${t.already} already up to date, ${t.unmatched} not found; ${t.changedChars} sheet(s) to save`);
    return { lib, sheets: t };
  } finally {
    ldb.close();
  }
}

/** The library after the import, without writing it (for the dry run). */
function previewRows(ldb, spells) {
  const rows = new Map(ldb.listSpells().map(r => [r.name.toLowerCase() + '|' + r.source, r]));
  for (const raw of spells) {
    const c = checkSpell(raw);
    if (c.error) continue;
    const key = c.name.toLowerCase() + '|' + c.source;
    const old = rows.get(key);
    rows.set(key, { id: old ? old.id : 'new:' + key, name: c.name, source: c.source, level: c.level, school: c.school, data: c.data });
  }
  return [...rows.values()];
}

// ── Main ──────────────────────────────────────────────────────────────────────
const HELP = `Usage: node scripts/import_spells.mjs (--campaign <name|id|slug> | --all) [--apply] [--books XPHB,PHB | --link-only] [--use-closest] [--from <dir>] [--verbose]
  --campaign  one campaign, by name, id or slug
  --all       every campaign
  --apply     write the changes (without it: a dry run that only reports)
  --from      read spell JSON files from this folder instead of downloading
  --books     only these books (5etools codes, comma-separated); all otherwise
  --link-only no download, no library changes: link the sheets to the library as it is
  --use-closest  link a spell with no exact match to the closest library name
              (marked ~ in the report; check a dry run first)
  --verbose   list every change, the added descriptions included`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.campaign && !args.all)) { console.log(HELP); process.exit(args.help ? 0 : 1); }

  let campaigns;
  if (args.all) campaigns = cdb.listCampaigns({ includeInactive: true });
  else {
    const want = args.campaign.trim();
    const c = cdb.resolveCampaign(want)
      || cdb.listCampaigns({ includeInactive: true }).find(x => x.name.toLowerCase() === want.toLowerCase());
    if (!c) {
      console.error(`No campaign "${want}". Campaigns: ${cdb.listCampaigns({ includeInactive: true }).map(x => x.name).join(', ')}`);
      process.exit(1);
    }
    campaigns = [c];
  }

  let spells = null;
  if (!args.linkOnly) {
    console.log(args.from ? `Reading spell files from ${args.from}` : 'Downloading the 5etools spell data into memory (GitHub copy; nothing is saved)…');
    const got = await loadData(args);
    spells = got.spells;
    if (got.books) console.log(got.books.map(b => `  ${b.code}: ${b.count}`).join('\n'));
    console.log(`${spells.length} spells in ${got.files} file(s)${got.withClasses ? ', with class lists' : ' (no sources.json: no class lists)'}`);
  }
  console.log(args.apply ? 'APPLYING changes.\n' : 'DRY RUN — nothing is written. Add --apply to save.\n');

  for (const c of campaigns) {
    console.log(`== ${c.name}`);
    runCampaign(c, spells, { apply: args.apply, verbose: args.verbose, useClosest: args.useClosest });
    console.log('');
  }
  if (args.apply) console.log('Done. Players reload their sheets to see the change.');
}

// Run only when started directly, so tests can import the helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}
