// Written by Irmak Hakman — 2026-11-15 14:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Where "Import from books" (spells, monsters, items) reads its data: the
 * folder named by BOOK_DATA_URL in the server's .env — one holding spells/,
 * bestiary/, items.json and books.json in the 5etools layout. The repository
 * names no source; a server without BOOK_DATA_URL has no book import, and the
 * three import screens say so instead of offering books.
 *
 * Read on every call rather than once, so tests and a changed .env (after a
 * restart) both see the current value.
 */

export class BookSourceUnset extends Error {
  constructor() {
    super('Importing from books is not set up on this server (BOOK_DATA_URL in its .env).');
    this.code = 'BOOK_SOURCE_UNSET';
  }
}

/** The data folder's URL, without a trailing slash. Throws BookSourceUnset when there is none. */
export function bookDataBase() {
  const u = String(process.env.BOOK_DATA_URL || '').trim().replace(/\/+$/, '');
  if (!u) throw new BookSourceUnset();
  if (!/^https?:\/\//i.test(u)) throw new Error('BOOK_DATA_URL must start with http:// or https://');
  return u;
}

/** True when a book import can run at all. */
export function bookSourceSet() {
  return !!String(process.env.BOOK_DATA_URL || '').trim();
}

/**
 * The readable names the source gives its books and adventures
 * (books.json / adventures.json): { code: name }. A file that cannot be read
 * just leaves its codes unnamed.
 */
export async function sourceBookNames(getJson, fetchImpl) {
  const base = bookDataBase();
  const names = {};
  for (const [file, key] of [['books.json', 'book'], ['adventures.json', 'adventure']]) {
    try {
      const d = await getJson(`${base}/${file}`, fetchImpl);
      for (const b of (d && d[key]) || []) if (b && b.id && b.name) names[b.id] = String(b.name);
    } catch { /* names are a nicety */ }
  }
  return names;
}
