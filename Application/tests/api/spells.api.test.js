// Written by Irmak Hakman — 2026-11-11 19:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The spell library routes (server/routes/spells.js), against the REAL
 * openCampaignDb(':memory:'). Sessions are stubbed: a request is the DM, a
 * player, or nobody, by its X-Test-Role header.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerSpells, { unwrapImport, checkSpell } from '../../server/routes/spells.js';

const MM = { name: 'Magic Missile', source: 'XPHB', page: 295, level: 1, school: 'V', entries: ['Three darts.'] };
const SHIELD = { name: 'Shield', source: 'XPHB', level: 1, school: 'A', entries: ['+5 AC.'] };
const LIGHT = { name: 'Light', source: 'XPHB', level: 0, school: 'V', entries: ['Glow.'] };

let ldb, app, broadcasts;

beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = [];
  const role = req => String(req.headers['x-test-role'] || '');
  app = express();
  app.use(express.json({ limit: '20mb' }));
  registerSpells(app, {
    ldb,
    genId: () => crypto.randomUUID(),
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    masterAuth: req => role(req) === 'dm',
    sessionAuth: req => role(req) === 'dm' || role(req) === 'player',
    auth: { sessionFromReq: req => (role(req) === 'player' ? { role: 'character', charName: 'Aliyr' } : null) },
  });
});

const as = (r, who) => (who ? r.set('X-Test-Role', who) : r);
const imp = (body, who = 'dm') => as(request(app).post('/api/spells/import').send({ spells: body }), who);
const list = (who = 'dm') => as(request(app).get('/api/spells'), who);

describe('who may use the library', () => {
  it('refuses a caller with no login on every route', async () => {
    expect((await list(null)).status).toBe(401);
    expect((await imp([MM], null)).status).toBe(401);
    expect((await request(app).get('/api/spells/x')).status).toBe(401);
    expect((await request(app).delete('/api/spells/x')).status).toBe(401);
    expect((await request(app).post('/api/spells/delete').send({ ids: ['x'] })).status).toBe(401);
  });

  it('lets a player read and import, but not delete', async () => {
    const r = await imp([MM], 'player');
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1);
    const rows = (await list('player')).body;
    expect(rows.map(s => s.name)).toEqual(['Magic Missile']);
    expect(rows[0].addedBy).toBe('Aliyr');
    expect((await as(request(app).delete('/api/spells/' + rows[0].id), 'player')).status).toBe(401);
    expect((await as(request(app).post('/api/spells/delete').send({ ids: [rows[0].id] }), 'player')).status).toBe(401);
    expect((await list()).body).toHaveLength(1);
  });
});

describe('importing', () => {
  it('takes one spell, a list, or a whole 5etools file', async () => {
    expect((await imp(MM)).body.imported).toBe(1);
    expect((await imp([SHIELD])).body.imported).toBe(1);
    expect((await imp({ spell: [LIGHT] })).body.imported).toBe(1);
    const names = (await list()).body.map(s => s.name);
    expect(names).toEqual(['Light', 'Magic Missile', 'Shield']);   // level, then name
  });

  it('keeps the whole spell object and the columns beside it', async () => {
    await imp([MM]);
    const [row] = (await list()).body;
    expect(row).toMatchObject({ name: 'Magic Missile', source: 'XPHB', level: 1, school: 'V' });
    expect(row.data.entries).toEqual(['Three darts.']);
    expect(row.data.page).toBe(295);
    const one = await request(app).get('/api/spells/' + row.id).set('X-Test-Role', 'player');
    expect(one.body.data.name).toBe('Magic Missile');
  });

  it('lists every accepted spell in order, so the sheet can add exactly those', async () => {
    const r = await imp([SHIELD, MM]);
    expect(r.body.spells.map(s => s.name)).toEqual(['Shield', 'Magic Missile']);
    expect(r.body.spells[0].id).toBeTruthy();
  });

  it('counts the same spell twice in one file once', async () => {
    const r = await imp([MM, { ...MM }, { ...MM, name: 'magic missile ' }]);
    expect(r.body.imported).toBe(1);
    expect((await list()).body).toHaveLength(1);
  });

  it('keeps the same name from two books apart', async () => {
    await imp([MM, { ...MM, source: 'PHB' }]);
    expect((await list()).body.map(s => s.source).sort()).toEqual(['PHB', 'XPHB']);
  });

  it('lets the DM update a spell by importing it again, and a player not', async () => {
    await imp([MM]);
    const p = await imp([{ ...MM, entries: ['Changed by a player.'] }], 'player');
    expect(p.body).toMatchObject({ imported: 0, updated: 0, existing: 1 });
    expect(p.body.spells).toHaveLength(1);    // still listed, so it can go on the sheet
    expect((await list()).body[0].data.entries).toEqual(['Three darts.']);
    const d = await imp([{ ...MM, entries: ['Changed by the DM.'] }]);
    expect(d.body).toMatchObject({ imported: 0, updated: 1 });
    const [row] = (await list()).body;
    expect(row.data.entries).toEqual(['Changed by the DM.']);
    expect(row.updatedAt).toBeTruthy();
  });

  it('skips what is not a spell, says why, and imports the rest', async () => {
    const r = await imp([MM, { level: 1 }, 'text', { name: 'Big', level: 12 }, { name: 'Copy', source: 'X', _copy: { name: 'Shield' } }]);
    expect(r.body).toMatchObject({ imported: 1, skipped: 4 });
    expect(r.body.skips.join(' ')).toMatch(/no name/);
    expect(r.body.skips.join(' ')).toMatch(/level must be 0-9/);
    expect(r.body.skips.join(' ')).toMatch(/reprint/);
  });

  it('refuses an import with no spells in it', async () => {
    expect((await imp([])).status).toBe(400);
    expect((await imp(null)).status).toBe(400);
  });

  it('tells the other screens only when something changed', async () => {
    await imp([MM]);
    expect(broadcasts.filter(b => b.event === 'spells')).toHaveLength(1);
    await imp([MM], 'player');
    expect(broadcasts.filter(b => b.event === 'spells')).toHaveLength(1);
  });
});

describe('deleting', () => {
  it('removes one spell or many', async () => {
    await imp([MM, SHIELD, LIGHT]);
    const rows = (await list()).body;
    expect((await as(request(app).delete('/api/spells/' + rows[0].id), 'dm')).status).toBe(200);
    const r = await as(request(app).post('/api/spells/delete').send({ ids: rows.slice(1).map(s => s.id) }), 'dm');
    expect(r.body.removed).toBe(2);
    expect((await list()).body).toEqual([]);
    expect((await as(request(app).delete('/api/spells/' + rows[0].id), 'dm')).status).toBe(404);
  });
});

describe('whole books from 5etools (DM)', () => {
  // A fake source: the routes never reach the network in tests.
  function bookApp(fake) {
    const a = express();
    a.use(express.json());
    registerSpells(a, {
      ldb, genId: () => crypto.randomUUID(), broadcast: (e, p) => broadcasts.push({ event: e, payload: p }),
      masterAuth: req => req.headers['x-test-role'] === 'dm',
      sessionAuth: req => !!req.headers['x-test-role'],
      auth: { sessionFromReq: () => null },
      spellSource: fake,
    });
    return a;
  }
  const BOOKS = [{ code: 'XPHB', name: "Player's Handbook (2024)", file: 'spells-xphb.json' },
                 { code: 'XGE', name: "Xanathar's Guide to Everything", file: 'spells-xge.json' }];
  const fake = {
    listBooks: async () => BOOKS,
    fetchBooks: async (codes) => {
      for (const c of codes) if (!BOOKS.some(b => b.code === c)) throw new Error(`Unknown book: ${c}`);
      const spells = [];
      if (codes.includes('XPHB')) spells.push(MM, SHIELD);
      if (codes.includes('XGE')) spells.push({ name: 'Tidal Wave', source: 'XGE', level: 3, entries: ['Water.'] });
      return { spells, books: codes.map(c => ({ code: c, name: c, count: c === 'XPHB' ? 2 : 1 })) };
    },
  };

  it('is the DM\'s alone', async () => {
    const a = bookApp(fake);
    expect((await request(a).get('/api/spells/books').set('X-Test-Role', 'player')).status).toBe(401);
    expect((await request(a).post('/api/spells/import-books').set('X-Test-Role', 'player').send({ books: ['XPHB'] })).status).toBe(401);
    expect((await request(a).get('/api/spells/books')).status).toBe(401);
  });

  it('lists the books (and is not mistaken for a spell id)', async () => {
    const r = await request(bookApp(fake)).get('/api/spells/books').set('X-Test-Role', 'dm');
    expect(r.status).toBe(200);
    expect(r.body.map(b => b.code)).toEqual(['XPHB', 'XGE']);
  });

  it('imports the chosen books into this campaign and reports per book', async () => {
    const r = await request(bookApp(fake)).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: ['XPHB', 'XGE'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ imported: 3, updated: 0 });
    expect(r.body.books.map(b => b.count)).toEqual([2, 1]);
    expect(r.body.spells).toBeUndefined();       // the downloaded data is not sent back
    expect(ldb.listSpells().map(s => s.name)).toEqual(['Magic Missile', 'Shield', 'Tidal Wave']);
    expect(ldb.listSpells()[0].addedBy).toBe('DM (from books)');
    expect(broadcasts.some(b => b.event === 'spells')).toBe(true);
  });

  it('a second import of the same book updates rather than duplicates', async () => {
    const a = bookApp(fake);
    await request(a).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: ['XPHB'] });
    const r = await request(a).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: ['XPHB'] });
    expect(r.body).toMatchObject({ imported: 0, updated: 2 });
    expect(ldb.listSpells()).toHaveLength(2);
  });

  it('refuses no books, an unknown book, and says when the download fails', async () => {
    const a = bookApp(fake);
    expect((await request(a).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: [] })).status).toBe(400);
    const unknown = await request(a).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: ['NOPE'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/Unknown book: NOPE/);
    const down = bookApp({ listBooks: async () => { throw new Error('offline'); }, fetchBooks: async () => { throw new Error('HTTP 503'); } });
    expect((await request(down).get('/api/spells/books').set('X-Test-Role', 'dm')).status).toBe(502);
    expect((await request(down).post('/api/spells/import-books').set('X-Test-Role', 'dm').send({ books: ['XPHB'] })).status).toBe(502);
    expect(ldb.listSpells()).toEqual([]);
  });
});

describe('lib/spell-source.js (no network)', () => {
  it('offers only plain book files, core books first', async () => {
    const { listBooks } = await import('../../lib/spell-source.js');
    const fakeFetch = async () => ({ ok: true, text: async () => JSON.stringify({
      XGE: 'spells-xge.json', PHB: 'spells-phb.json', XPHB: 'spells-xphb.json', EVIL: '../../etc/passwd', ODD: 'spells-x.json?y=1' }) });
    const books = await listBooks(fakeFetch);
    expect(books.map(b => b.code)).toEqual(['XPHB', 'PHB', 'XGE']);
    expect(books[0].name).toBe("Player's Handbook (2024)");
  });
  it('downloads only the chosen books, with class lists, and keeps nothing', async () => {
    const { fetchBooks } = await import('../../lib/spell-source.js');
    const asked = [];
    const files = {
      'index.json': { XPHB: 'spells-xphb.json', XGE: 'spells-xge.json' },
      'sources.json': { XPHB: { 'Magic Missile': { class: [{ name: 'Wizard' }] } } },
      'spells-xphb.json': { spell: [MM] },
      'spells-xge.json': { spell: [LIGHT] },
    };
    const fakeFetch = async url => { const f = url.split('/').pop(); asked.push(f); return { ok: true, text: async () => JSON.stringify(files[f]) }; };
    const got = await fetchBooks(['XPHB'], fakeFetch);
    expect(asked).not.toContain('spells-xge.json');
    expect(got.spells.map(s => s.name)).toEqual(['Magic Missile']);
    expect(got.spells[0].classes.fromClassList[0].name).toBe('Wizard');
    expect(got.books).toEqual([{ code: 'XPHB', name: "Player's Handbook (2024)", count: 1 }]);
    await expect(fetchBooks(['ZZZ'], fakeFetch)).rejects.toThrow(/Unknown book/);
  });
});

describe('unwrapImport / checkSpell', () => {
  it('finds the spells in every accepted shape', () => {
    expect(unwrapImport([1, 2])).toEqual([1, 2]);
    expect(unwrapImport({ spell: [1] })).toEqual([1]);
    expect(unwrapImport({ spells: [2] })).toEqual([2]);
    expect(unwrapImport({ name: 'x' })).toEqual([{ name: 'x' }]);
    expect(unwrapImport('x')).toEqual([]);
  });
  it('trims names and caps the book code', () => {
    const c = checkSpell({ name: '  Fireball ', level: 3, source: 'X'.repeat(40) });
    expect(c.name).toBe('Fireball');
    expect(c.source).toHaveLength(24);
    expect(c.data.name).toBe('Fireball');
  });
  it('refuses a spell that is too big to be real', () => {
    expect(checkSpell({ name: 'Huge', level: 1, entries: ['x'.repeat(200 * 1024)] }).error).toMatch(/too large/);
  });
});

describe('backup', () => {
  it('exports the library and restores it without duplicating', async () => {
    await imp([MM, SHIELD]);
    const rows = ldb.exportSpells();
    expect(rows).toHaveLength(2);
    const other = openCampaignDb(':memory:');
    expect(other.importSpells(rows)).toBe(2);
    expect(other.importSpells(rows)).toBe(2);   // attempted again: the unique key keeps one each
    expect(other.listSpells().map(s => s.name)).toEqual(['Magic Missile', 'Shield']);
  });
});
