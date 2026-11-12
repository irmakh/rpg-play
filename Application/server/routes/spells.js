// Written by Irmak Hakman — 2026-11-12 12:49
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The campaign's spell library.
 *
 * Spells arrive as 5etools JSON: one spell object, a list of them, or a whole
 * 5etools file ({ "spell": [...] }). Each is kept whole in dataJson; the browser
 * (public/js/lib/spell-data.js) turns it into what a sheet or a card needs.
 *
 * Who may do what:
 *   read     anyone logged into this campaign (players add spells from it)
 *   import   anyone logged into this campaign. A player can only ADD spells the
 *            library does not have yet; re-importing a spell the library already
 *            has changes nothing unless the DM does it.
 *   delete   the DM
 *   books    the DM: list the 5etools books and import whole books into this
 *            campaign (lib/spell-source.js — fetched into memory, imported,
 *            discarded; nothing is written to disk)
 */

import * as defaultSource from '../../lib/spell-source.js';

export const MAX_IMPORT     = 3000;            // spells per import
export const MAX_SPELL_JSON = 100 * 1024;      // one spell, serialised
const MAX_REPORTED_SKIPS = 25;

/** The list of spell objects inside whatever was imported. */
export function unwrapImport(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.spell)) return body.spell;
    if (Array.isArray(body.spells)) return body.spells;
    if (body.spells && typeof body.spells === 'object') return unwrapImport(body.spells);
    return [body];
  }
  return [];
}

/**
 * The columns stored beside one spell, or { error } saying why it is refused.
 * The object itself is kept as it came: the parts this app does not use yet
 * cost a few hundred bytes and may be wanted later.
 */
export function checkSpell(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a spell object' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return { error: 'no name' };
  if (name.length > 120) return { error: `"${name.slice(0, 40)}…": name too long` };
  // A 5etools reprint stub ({ name, source, _copy: {...} }) has no text of its own.
  if (raw._copy && !raw.entries) return { error: `${name}: a reprint reference, not a full spell` };
  const level = Number(raw.level ?? 0);
  if (!Number.isInteger(level) || level < 0 || level > 9) return { error: `${name}: level must be 0-9` };
  const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, 24) : '';
  const school = typeof raw.school === 'string' ? raw.school.trim().slice(0, 8) : '';
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { error: `${name}: not valid JSON data` }; }
  if (size > MAX_SPELL_JSON) return { error: `${name}: too large` };
  return { name, level, source, school, data: { ...raw, name } };
}

export default function register(app, ctx) {
  const { ldb, genId, masterAuth, sessionAuth, auth, broadcast } = ctx;
  // Tests hand in a fake that never touches the network.
  const source = ctx.spellSource || defaultSource;

  /**
   * Upserts a list of spell objects into this campaign's library. The DM's
   * copy replaces a spell already there; a player's only adds new ones.
   */
  function importList(list, isDm, who) {
    const out = { imported: 0, updated: 0, existing: 0, skipped: 0, skips: [], spells: [] };
    const seen = new Set();   // the same spell twice in one file counts once
    for (const raw of list) {
      const c = checkSpell(raw);
      if (c.error) {
        out.skipped++;
        if (out.skips.length < MAX_REPORTED_SKIPS) out.skips.push(c.error);
        continue;
      }
      const key = c.name.toLowerCase() + '|' + c.source;
      if (seen.has(key)) continue;
      seen.add(key);
      let row = ldb.findSpell(c.name, c.source);
      if (row) {
        if (isDm) { row = ldb.updateSpell(row.id, c); out.updated++; }
        else out.existing++;
      } else {
        row = ldb.createSpell(genId(), { ...c, addedBy: who });
        out.imported++;
      }
      out.spells.push({ id: row.id, name: row.name, source: row.source, level: row.level });
    }
    return out;
  }

  const denied = (req, res) => {
    if (sessionAuth(req)) return false;
    res.status(401).json({ error: 'Unauthorized' });
    return true;
  };

  app.get('/api/spells', (req, res) => {
    if (denied(req, res)) return;
    try {
      res.set('Cache-Control', 'no-store');
      res.json(ldb.listSpells());
    } catch (err) { console.error('GET /api/spells:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Registered before /api/spells/:id, which would otherwise take 'books' for an id.
  // ── Whole books from 5etools (DM) ───────────────────────────────────────────
  // GET /api/spells/books -> [{ code, name, file }]
  app.get('/api/spells/books', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await source.listBooks());
    } catch (err) {
      console.error('GET /api/spells/books:', err.message);
      res.status(502).json({ error: 'Could not reach the 5etools data. Try again later.' });
    }
  });

  // POST /api/spells/import-books { books: ['XPHB', 'PHB'] } -> per-book counts
  // and the import totals. One at a time per server: an import fetches a few MB.
  let booksRunning = false;
  app.post('/api/spells/import-books', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const codes = Array.isArray(req.body?.books) ? req.body.books.slice(0, 100).map(String) : [];
    if (!codes.length) return res.status(400).json({ error: 'Choose at least one book.' });
    if (booksRunning) return res.status(409).json({ error: 'Another book import is running. Try again in a moment.' });
    booksRunning = true;
    try {
      let got;
      try { got = await source.fetchBooks(codes); }
      catch (err) {
        console.error('POST /api/spells/import-books (download):', err.message);
        return res.status(/^Unknown book/.test(err.message) ? 400 : 502).json({ error: err.message });
      }
      const out = importList(got.spells, true, 'DM (from books)');
      if (out.imported || out.updated) broadcast('spells', { action: 'updated' });
      // The downloaded data is not kept: only the counts go back.
      res.json({ books: got.books, imported: out.imported, updated: out.updated, skipped: out.skipped, skips: out.skips });
    } catch (err) {
      console.error('POST /api/spells/import-books:', err);
      res.status(500).json({ error: 'Server error' });
    } finally {
      booksRunning = false;
    }
  });

  // DELETE /api/spells/books/:code -> { removed, kept }. Spells a character sheet
  // took stay in the library, so the sheet's link back to them keeps working.
  app.delete('/api/spells/books/:code', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const out = ldb.deleteSpellBook(String(req.params.code).slice(0, 24));
      if (out.removed) broadcast('spells', { action: 'updated' });
      res.json({ ok: true, ...out });
    } catch (err) { console.error('DELETE /api/spells/books/:code:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/spells/:id', (req, res) => {
    if (denied(req, res)) return;
    try {
      const s = ldb.getSpell(req.params.id);
      if (!s) return res.status(404).json({ error: 'Not found' });
      res.json(s);
    } catch (err) { console.error('GET /api/spells/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/spells/import { spells: <spell | spell[] | { spell: [...] }> }
  //   -> { imported, updated, existing, skipped, skips: [why], spells: [{ id, name, source, level }] }
  // `spells` lists every spell the import accepted, in order — including ones
  // the library already had — so the sheet can add exactly those to itself.
  app.post('/api/spells/import', (req, res) => {
    if (denied(req, res)) return;
    try {
      const list = unwrapImport(req.body ? req.body.spells : null);
      if (!list.length) return res.status(400).json({ error: 'No spells found in that JSON.' });
      if (list.length > MAX_IMPORT) return res.status(413).json({ error: `At most ${MAX_IMPORT} spells per import.` });

      const isDm = masterAuth(req);
      const who = isDm ? 'DM' : String(auth.sessionFromReq(req)?.charName || 'a player').slice(0, 60);
      const out = importList(list, isDm, who);
      if (out.imported || out.updated) broadcast('spells', { action: 'updated' });
      res.json(out);
    } catch (err) { console.error('POST /api/spells/import:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // DELETE /api/spells/:id — DM. Sheets that took the spell keep their copy.
  app.delete('/api/spells/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const n = ldb.deleteSpells([req.params.id]);
      if (!n) return res.status(404).json({ error: 'Not found' });
      broadcast('spells', { action: 'updated' });
      res.json({ ok: true });
    } catch (err) { console.error('DELETE /api/spells/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/spells/delete { ids: [] } — DM, many at once.
  app.post('/api/spells/delete', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 5000).map(String) : [];
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      const removed = ldb.deleteSpells(ids);
      if (removed) broadcast('spells', { action: 'updated' });
      res.json({ ok: true, removed });
    } catch (err) { console.error('POST /api/spells/delete:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
