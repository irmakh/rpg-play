// Written by Irmak Hakman — 2026-11-12 13:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * 3rd Party items — magic items from 5etools books or an uploaded homebrew
 * file, imported into a campaign's catalogue (the book_items table). DM only.
 * The catalogue is read-only: the DM adds a copy to a treasury pile, and from
 * then on the copy is an ordinary treasury item, edited like any other.
 *
 *   GET    /api/book-items?q=&source=&rarity=&kind=&limit=&offset=   search
 *   GET    /api/book-items/sources                 books this campaign holds
 *   GET    /api/book-items/books                   5etools books with magic items (network)
 *   POST   /api/book-items/import-books { books }  import whole 5etools books
 *   POST   /api/book-items/upload { file }         import a 5etools homebrew file (its JSON)
 *   DELETE /api/book-items/books/:code             remove one book
 *   GET    /api/book-items/:id                     one item, as treasury fields
 *   POST   /api/book-items/:id/copy { tag }        a hidden copy in that treasury pile
 *
 * The downloaded or uploaded data is used for the import and dropped; only the
 * catalogue rows are kept (lib/item-source.js).
 */
import * as defaultSource from '../../lib/item-source.js';
import { sanitizeFields } from './treasury.js';

export default function register(app, ctx) {
  const { ldb, genId, masterAuth, broadcast } = ctx;
  const source = ctx.itemSource || defaultSource;
  const { toTreasuryFields, itemKind } = defaultSource;
  const deny = (req, res) => { if (masterAuth(req)) return false; res.status(401).json({ error: 'Unauthorized' }); return true; };
  const rowsOf = list => list.map(i => ({ ...i, kind: itemKind(i.data) }));

  app.get('/api/book-items', (req, res) => {
    if (deny(req, res)) return;
    try {
      res.set('Cache-Control', 'no-store');
      res.json(ldb.searchBookItems({
        q: String(req.query.q || '').slice(0, 100), source: String(req.query.source || '').slice(0, 40),
        rarity: String(req.query.rarity || '').slice(0, 40), kind: String(req.query.kind || '').slice(0, 20),
        limit: parseInt(req.query.limit, 10) || 60, offset: parseInt(req.query.offset, 10) || 0,
      }));
    } catch (err) { console.error('GET /api/book-items:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/book-items/sources', (req, res) => {
    if (deny(req, res)) return;
    try { res.set('Cache-Control', 'no-store'); res.json(ldb.listBookItemBooks()); }
    catch (err) { console.error('GET /api/book-items/sources:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/book-items/books', async (req, res) => {
    if (deny(req, res)) return;
    try { res.set('Cache-Control', 'no-store'); res.json(await source.listItemBooks()); }
    catch (err) {
      console.error('GET /api/book-items/books:', err.message);
      res.status(502).json({ error: 'Could not reach the 5etools data. Try again later.' });
    }
  });

  // One import at a time per server: an import downloads a few MB.
  let running = false;
  const once = async (res, fn) => {
    if (running) return res.status(409).json({ error: 'Another item import is running. Try again in a moment.' });
    running = true;
    try { await fn(); }
    catch (err) { console.error('book-items import:', err); if (!res.headersSent) res.status(500).json({ error: 'Server error' }); }
    finally { running = false; }
  };

  app.post('/api/book-items/import-books', async (req, res) => {
    if (deny(req, res)) return;
    const codes = Array.isArray(req.body?.books) ? req.body.books.slice(0, 200).map(String) : [];
    if (!codes.length) return res.status(400).json({ error: 'Choose at least one book.' });
    await once(res, async () => {
      let got;
      try { got = await source.fetchItemBooks(codes); }
      catch (err) {
        console.error('POST /api/book-items/import-books (download):', err.message);
        return res.status(/^Unknown book/.test(err.message) ? 400 : 502).json({ error: err.message });
      }
      const out = ldb.upsertBookItems(rowsOf(got.items), '5etools');
      broadcast('bookItems', { action: 'updated' });
      res.json({ books: got.books, imported: out.imported, updated: out.updated });
    });
  });

  app.post('/api/book-items/upload', async (req, res) => {
    if (deny(req, res)) return;
    const file = req.body ? req.body.file : null;
    await once(res, async () => {
      let got;
      try { got = await source.parseHomebrew(file); }
      catch (err) { return res.status(400).json({ error: err.message }); }
      if (!got.items.length) {
        return res.status(400).json({ error: `No magic items in that file${got.skipped ? ` (${got.skipped} items without a rarity were skipped)` : ''}.` });
      }
      const out = ldb.upsertBookItems(rowsOf(got.items), 'upload');
      broadcast('bookItems', { action: 'updated' });
      res.json({ books: got.books, imported: out.imported, updated: out.updated, skipped: got.skipped, unresolved: got.unresolved });
    });
  });

  app.delete('/api/book-items/books/:code', (req, res) => {
    if (deny(req, res)) return;
    try {
      const removed = ldb.deleteBookItemBook(String(req.params.code).slice(0, 40));
      if (removed) broadcast('bookItems', { action: 'updated' });
      res.json({ ok: true, removed });
    } catch (err) { console.error('DELETE /api/book-items/books/:code:', err); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/book-items/:id', (req, res) => {
    if (deny(req, res)) return;
    try {
      const it = ldb.getBookItem(req.params.id);
      if (!it) return res.status(404).json({ error: 'Not found' });
      res.set('Cache-Control', 'no-store');
      res.json({ id: it.id, name: it.name, source: it.source, bookName: it.bookName, rarity: it.rarity, kind: it.kind,
                 fields: toTreasuryFields(it.data) });
    } catch (err) { console.error('GET /api/book-items/:id:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // A hidden copy in the pile; from then on an ordinary treasury item.
  app.post('/api/book-items/:id/copy', (req, res) => {
    if (deny(req, res)) return;
    try {
      const it = ldb.getBookItem(req.params.id);
      if (!it) return res.status(404).json({ error: 'Not found' });
      const fields = sanitizeFields({ ...toTreasuryFields(it.data), tag: String(req.body?.tag ?? ''), mode: 'hidden' }, { partial: false });
      if (!fields.name) return res.status(400).json({ error: 'Name required' });
      fields.createdAt = new Date().toISOString();
      const id = genId();
      ldb.createTreasuryItem(id, fields);
      broadcast('treasury', { action: 'created', id });
      res.json({ ok: true, id });
    } catch (err) { console.error('POST /api/book-items/:id/copy:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
