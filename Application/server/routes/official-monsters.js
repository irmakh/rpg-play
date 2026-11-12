// Written by Irmak Hakman — 2026-11-12 12:49
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Official monsters — whole 5etools bestiary books imported into a campaign.
 * DM only. Registered BEFORE server/routes/monsters.js, whose /api/monsters/:id
 * would otherwise take "official" for an id.
 *
 *   GET    /api/monsters/official?q=&source=&limit=&offset=   search, no stat blocks
 *   GET    /api/monsters/official/sources                     books this campaign holds
 *   GET    /api/monsters/official/books                       books 5etools offers (network)
 *   POST   /api/monsters/official/import-books { books }      import whole books
 *   DELETE /api/monsters/official/books/:code                 remove one book
 *   POST   /api/monsters/official/:id/copy                    copy into My Monsters
 *
 * The stat block itself comes from GET /api/monsters/:id (getMonster finds an
 * official monster too), and tokens and initiative entries link to it by its
 * id like any monster. Official monsters cannot be edited: the PUT, portrait
 * and DELETE routes in monsters.js refuse them.
 */
import { listBestiaryBooks as defaultListBooks, fetchBestiaryBooks as defaultFetchBooks } from '../../lib/monster-source.js';

export default function register(app, ctx) {
  const { ldb, genId, masterAuth, broadcast } = ctx;
  const source = ctx.monsterSource || { listBestiaryBooks: defaultListBooks, fetchBestiaryBooks: defaultFetchBooks };
  const deny = (req, res) => { if (masterAuth(req)) return false; res.status(401).json({ error: 'Unauthorized' }); return true; };

  app.get('/api/monsters/official', (req, res) => {
    if (deny(req, res)) return;
    try {
      res.set('Cache-Control', 'no-store');
      res.json(ldb.searchOfficialMonsters({
        q: String(req.query.q || '').slice(0, 100), source: String(req.query.source || '').slice(0, 40),
        limit: parseInt(req.query.limit, 10) || 60, offset: parseInt(req.query.offset, 10) || 0,
      }));
    } catch (err) { console.error('GET /api/monsters/official:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/monsters/official/sources', (req, res) => {
    if (deny(req, res)) return;
    try { res.set('Cache-Control', 'no-store'); res.json(ldb.listOfficialBooks()); }
    catch (err) { console.error('GET /api/monsters/official/sources:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/monsters/official/books', async (req, res) => {
    if (deny(req, res)) return;
    try { res.set('Cache-Control', 'no-store'); res.json(await source.listBestiaryBooks()); }
    catch (err) {
      console.error('GET /api/monsters/official/books:', err.message);
      res.status(502).json({ error: 'Could not reach the 5etools data. Try again later.' });
    }
  });

  let running = false;
  app.post('/api/monsters/official/import-books', async (req, res) => {
    if (deny(req, res)) return;
    const codes = Array.isArray(req.body?.books) ? req.body.books.slice(0, 200).map(String) : [];
    if (!codes.length) return res.status(400).json({ error: 'Choose at least one book.' });
    if (running) return res.status(409).json({ error: 'Another book import is running. Try again in a moment.' });
    running = true;
    try {
      let got;
      try { got = await source.fetchBestiaryBooks(codes); }
      catch (err) {
        console.error('POST /api/monsters/official/import-books (download):', err.message);
        return res.status(/^Unknown book/.test(err.message) ? 400 : 502).json({ error: err.message });
      }
      const out = ldb.upsertOfficialMonsters(got.monsters);
      broadcast('monsters', { action: 'official-updated' });
      // The downloaded data is not kept: only the counts go back.
      res.json({ books: got.books, imported: out.imported, updated: out.updated, unresolved: got.unresolved.slice(0, 50) });
    } catch (err) {
      console.error('POST /api/monsters/official/import-books:', err);
      res.status(500).json({ error: 'Server error' });
    } finally { running = false; }
  });

  app.delete('/api/monsters/official/books/:code', (req, res) => {
    if (deny(req, res)) return;
    try {
      // Monsters a token, initiative entry or prepared map uses are kept.
      const { removed, kept } = ldb.deleteOfficialBook(req.params.code);
      if (removed) broadcast('monsters', { action: 'official-updated' });
      res.json({ ok: true, removed, kept });
    } catch (err) { console.error('DELETE /api/monsters/official/books:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // A copy the DM owns and can edit. Tokens of the official one stay as they are.
  app.post('/api/monsters/official/:id/copy', (req, res) => {
    if (deny(req, res)) return;
    try {
      const m = ldb.getMonster(req.params.id);
      if (!m || !m.official) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(m.dataJson || '{}'); } catch {}
      const name = String(req.body?.name || m.name).trim().slice(0, 120) || m.name;
      data.name = name;
      const id = genId();
      ldb.createMonster(id, { name, cr: m.cr, dataJson: JSON.stringify(data), createdAt: new Date().toISOString() });
      broadcast('monsters', { action: 'created', id, name, cr: m.cr, data });
      res.json({ ok: true, id, name });
    } catch (err) { console.error('POST /api/monsters/official/:id/copy:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
