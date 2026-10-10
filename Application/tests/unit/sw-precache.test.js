// Written by Irmak Hakman — 2026-10-10 21:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The service worker's precache list and the release number.
 *
 * Two mistakes are easy to make in a frontend release and invisible until a
 * device goes offline or keeps an old page:
 *   - listing a file in sw.js that does not exist (the install quietly skips it,
 *     so the installed app is missing that file offline), and
 *   - bumping FRONTEND_VERSION in server.js without the CACHE name in sw.js, or
 *     the other way round.
 * Both are read straight from the real files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = resolve(__dirname, '../..');
const SW = readFileSync(join(APP, 'public/sw.js'), 'utf-8');
const SERVER = readFileSync(join(APP, 'server.js'), 'utf-8');

// The entries of `const STATIC = [ ... ]`, comments ignored.
function precacheList() {
  const block = SW.match(/const STATIC = \[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js: STATIC list not found');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('service worker precache', () => {
  const list = precacheList();

  it('lists a sensible number of files', () => {
    expect(list.length).toBeGreaterThan(40);
  });

  it('lists no file twice', () => {
    expect(list.filter((p, i) => list.indexOf(p) !== i)).toEqual([]);
  });

  it('lists only files that exist under public/', () => {
    const missing = list.filter(p => {
      // A folder URL is served as that folder's index.html.
      const file = join(APP, 'public', p.endsWith('/') ? p + 'index.html' : p);
      return !(existsSync(file) && statSync(file).isFile());
    });
    expect(missing).toEqual([]);
  });
});

describe('release number', () => {
  it('is the same in server.js and sw.js', () => {
    const version = SERVER.match(/const FRONTEND_VERSION = (\d+);/)?.[1];
    const cache = SW.match(/const CACHE = 'rpg-v(\d+)';/)?.[1];
    expect(version).toBeTruthy();
    expect(cache).toBe(version);
  });
});
