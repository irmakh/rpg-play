// Written by Irmak Hakman — 2026-11-11 19:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The 5etools spell books, fetched for an import and then thrown away.
 *
 * Source: the 5etools data files in the public GitHub repository
 * 5etools-mirror-3/5etools-src (5e.tools itself answers automated requests
 * with a Cloudflare challenge). Used by the DM's "Import from books" button
 * (server/routes/spells.js) and by scripts/import_spells.mjs.
 *
 * Everything is held in memory for the length of one import. Nothing is
 * written to disk, so there are no downloaded files to clean up, and nothing
 * from that repository ever lands in this project.
 */

export const MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/spells';
const TIMEOUT_MS = 60 * 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;     // the largest book file is under 1 MB
const BOOK_FILE = /^spells-[a-z0-9-]+\.json$/;

// Readable names for the books 5etools lists; an unknown code is shown as is.
export const BOOK_NAMES = {
  XPHB: "Player's Handbook (2024)",
  PHB: "Player's Handbook (2014)",
  XGE: "Xanathar's Guide to Everything",
  TCE: "Tasha's Cauldron of Everything",
  FTD: "Fizban's Treasury of Dragons",
  FRHoF: 'Forgotten Realms: Heroes of Faerûn',
  EGW: "Explorer's Guide to Wildemount",
  SCC: 'Strixhaven: A Curriculum of Chaos',
  AAG: "Astral Adventurer's Guide",
  AI: 'Acquisitions Incorporated',
  'AitFR-AVT': 'Adventures in the Forgotten Realms: A Verdant Tomb',
  AU: 'Arcana Unearthed',
  BMT: 'The Book of Many Things',
  EFA: 'Eberron: Forge of the Artificer',
  GGR: "Guildmasters' Guide to Ravnica",
  IDRotF: 'Icewind Dale: Rime of the Frostmaiden',
  LLK: 'Lost Laboratory of Kwalish',
  SatO: 'Sigil and the Outlands',
  WoW: 'Warriors of Krynn / World of Warcraft',
};
// The order the DM sees them in: the core books first, then by name.
const FIRST = ['XPHB', 'PHB', 'XGE', 'TCE'];

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()} (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`${url.split('/').pop()} is unexpectedly large`);
  try { return JSON.parse(text); } catch { throw new Error(`${url.split('/').pop()} is not valid JSON`); }
}

/** The books on offer: [{ code, name, file }], core books first. */
export async function listBooks(fetchImpl = fetch) {
  const index = await getJson(`${MIRROR}/index.json`, fetchImpl);
  const books = [];
  for (const [code, file] of Object.entries(index || {})) {
    if (typeof file !== 'string' || !BOOK_FILE.test(file)) continue;   // only plain book files are fetched
    books.push({ code, name: BOOK_NAMES[code] || code, file });
  }
  const rank = b => { const i = FIRST.indexOf(b.code); return i < 0 ? FIRST.length : i; };
  return books.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Every spell in the chosen books (all of them when `codes` is empty), with
 * the class lists attached. Returns { spells, books: [{ code, name, count }] }.
 * Unknown codes are refused rather than guessed at.
 */
export async function fetchBooks(codes, fetchImpl = fetch) {
  const all = await listBooks(fetchImpl);
  const want = Array.isArray(codes) && codes.length ? codes.map(String) : all.map(b => b.code);
  const chosen = [];
  for (const code of want) {
    const b = all.find(x => x.code === code);
    if (!b) throw new Error(`Unknown book: ${code}`);
    if (!chosen.includes(b)) chosen.push(b);
  }
  const sources = await getJson(`${MIRROR}/sources.json`, fetchImpl);
  const files = [];
  for (const b of chosen) files.push({ book: b, data: await getJson(`${MIRROR}/${b.file}`, fetchImpl) });
  const spells = [];
  const books = [];
  for (const f of files) {
    const list = collectSpells([{ name: f.book.file, data: f.data }], sources);
    spells.push(...list);
    books.push({ code: f.book.code, name: f.book.name, count: list.length });
  }
  return { spells, books };
}

/**
 * The spells in 5etools book files, each with its class list from
 * sources.json attached (5etools keeps the two apart; the library's class
 * filter needs them together). A file is { name, data } or { name, text }.
 */
export function collectSpells(files, sources) {
  const out = [];
  for (const f of files) {
    let parsed = f.data;
    if (parsed === undefined) {
      try { parsed = JSON.parse(f.text); } catch { throw new Error(`${f.name} is not valid JSON`); }
    }
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.spell) ? parsed.spell : []);
    for (const sp of list) {
      if (!sp || typeof sp !== 'object') continue;
      const cls = sources && sources[sp.source] && sources[sp.source][sp.name];
      if (cls && !sp.classes) {
        const classes = {};
        if (Array.isArray(cls.class)) classes.fromClassList = cls.class;
        if (Array.isArray(cls.classVariant)) classes.fromClassListVariant = cls.classVariant;
        if (Object.keys(classes).length) sp.classes = classes;
      }
      out.push(sp);
    }
  }
  return out;
}
