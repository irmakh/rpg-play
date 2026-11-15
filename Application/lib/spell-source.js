// Written by Irmak Hakman — 2026-11-15 14:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The 5etools spell books, fetched for an import and then thrown away.
 *
 * Source: the data folder in BOOK_DATA_URL (lib/book-data.js), in the
 * 5etools layout; the repository names none. Used by the DM's "Import from books" button
 * (server/routes/spells.js) and by scripts/import_spells.mjs.
 *
 * Everything is held in memory for the length of one import. Nothing is
 * written to disk, so there are no downloaded files to clean up, and nothing
 * from that repository ever lands in this project.
 */

import { bookDataBase, sourceBookNames } from './book-data.js';

// Spells sit in the data folder's spells/ (lib/book-data.js names the folder).
const spellsBase = () => `${bookDataBase()}/spells`;
const TIMEOUT_MS = 60 * 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;     // the largest book file is under 1 MB
const BOOK_FILE = /^spells-[a-z0-9-]+\.json$/;

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
  const index = await getJson(`${spellsBase()}/index.json`, fetchImpl);
  const names = await sourceBookNames(getJson, fetchImpl);
  const books = [];
  for (const [code, file] of Object.entries(index || {})) {
    if (typeof file !== 'string' || !BOOK_FILE.test(file)) continue;   // only plain book files are fetched
    books.push({ code, name: names[code] || code, file });
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
  const sources = await getJson(`${spellsBase()}/sources.json`, fetchImpl);
  const files = [];
  for (const b of chosen) files.push({ book: b, data: await getJson(`${spellsBase()}/${b.file}`, fetchImpl) });
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
