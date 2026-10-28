// Written by Irmak Hakman — 2026-10-28 16:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Piles on the treasury screen (v310): a pile is an item's tag, and
 * treasury_piles holds its note and lets it exist empty.
 *
 * Covers /api/treasury/piles (make, note, rename, merge, delete) and
 * /api/treasury/give-many (a whole pile to one character, or split), through
 * the test app; and, against the real openCampaignDb, the storage the routes
 * use plus the fold that retires the shop's old list of tags on sale.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';
import { openCampaignDb } from '../../db/localdb.js';

function setup() {
  const { app, ldb } = makeApp();
  ldb.createCharacter('char-a', { name: 'Alice', passwordHash: '', dataJson: JSON.stringify({ name: 'Alice' }) });
  ldb.createCharacter('char-b', { name: 'Bob', passwordHash: '', dataJson: JSON.stringify({ name: 'Bob' }) });
  return { app, ldb };
}
const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);

let seq = 0;
function seed(ldb, over = {}) {
  const id = `pile-item-${++seq}`;
  ldb.createTreasuryItem(id, {
    name: 'Thing', mode: 'hidden', description: '', descVisible: true, itemType: 'other',
    valueCp: 0, quantity: 1, createdAt: new Date(Date.now() + seq).toISOString(), ...over,
  });
  return id;
}
const itemsOf = (ldb, charId) => JSON.parse(JSON.parse(ldb.getCharacter(charId).dataJson)._items || '[]');

describe('/api/treasury/piles', () => {
  it('is DM only', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/treasury/piles')).status).toBe(401);
    expect((await request(app).post('/api/treasury/piles').send({ tag: 'X' })).status).toBe(401);
    expect((await request(app).post('/api/treasury/piles/delete').send({ tag: 'X' })).status).toBe(401);
  });

  it('makes an empty pile with a note, and changes the note', async () => {
    const { app } = setup();
    const made = await asDM(request(app).post('/api/treasury/piles')).send({ tag: '  Goblin cave  ', note: 'Behind the altar' });
    expect(made.body).toMatchObject({ ok: true, tag: 'Goblin cave' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Goblin cave', note: 'DC 15 Investigation' });
    const list = (await asDM(request(app).get('/api/treasury/piles'))).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tag: 'Goblin cave', note: 'DC 15 Investigation' });
  });

  it('keeps the note when a pile is touched without one', async () => {
    const { app } = setup();
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Vault', note: 'Locked' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Vault' });
    expect((await asDM(request(app).get('/api/treasury/piles'))).body[0].note).toBe('Locked');
  });

  it('refuses a pile with no name', async () => {
    const { app } = setup();
    expect((await asDM(request(app).post('/api/treasury/piles')).send({ tag: '   ' })).status).toBe(400);
    expect((await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'A', newTag: ' ' })).status).toBe(400);
  });

  it('renames a pile, moving its items and its note', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb, { tag: 'Old' });
    const other = seed(ldb, { tag: 'Elsewhere' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Old', note: 'n' });
    const res = await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Old', newTag: 'New' });
    expect(res.body.tag).toBe('New');
    expect(ldb.getTreasuryItem(a).tag).toBe('New');
    expect(ldb.getTreasuryItem(other).tag).toBe('Elsewhere');
    expect((await asDM(request(app).get('/api/treasury/piles'))).body.map(p => [p.tag, p.note])).toEqual([['New', 'n']]);
  });

  it('renaming onto an existing pile merges them, keeping the target note', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb, { tag: 'A' });
    const b = seed(ldb, { tag: 'B' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'A', note: 'from A' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'B', note: 'from B' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'A', newTag: 'B' });
    expect([ldb.getTreasuryItem(a).tag, ldb.getTreasuryItem(b).tag]).toEqual(['B', 'B']);
    expect((await asDM(request(app).get('/api/treasury/piles'))).body.map(p => [p.tag, p.note])).toEqual([['B', 'from B']]);
  });

  it('deleting a pile moves its items to Unsorted by default', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb, { tag: 'Chest' });
    await asDM(request(app).post('/api/treasury/piles')).send({ tag: 'Chest', note: 'x' });
    const res = await asDM(request(app).post('/api/treasury/piles/delete')).send({ tag: 'Chest' });
    expect(res.body).toMatchObject({ ok: true, count: 1 });
    expect(ldb.getTreasuryItem(a).tag).toBe('');
    expect((await asDM(request(app).get('/api/treasury/piles'))).body).toEqual([]);
  });

  it('deleting a pile with its items deletes them and turns down their requests', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb, { tag: 'Chest', mode: 'loot' });
    const keep = seed(ldb, { tag: 'Other' });
    ldb.createTreasuryRequest('r1', { itemId: a, charId: 'char-a', charName: 'Alice', status: 'pending', requestedAt: new Date().toISOString() });
    await asDM(request(app).post('/api/treasury/piles/delete')).send({ tag: 'Chest', deleteItems: true });
    expect(ldb.getTreasuryItem(a)).toBeNull();
    expect(ldb.getTreasuryItem(keep)).not.toBeNull();
    expect(ldb.listTreasuryRequests('pending')).toHaveLength(0);
  });
});

describe('POST /api/treasury/give-many', () => {
  it('is DM only and checks every grant', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb);
    const post = body => asDM(request(app).post('/api/treasury/give-many')).send(body);
    expect((await request(app).post('/api/treasury/give-many').send({ grants: [{ itemId: id, charId: 'char-a' }] })).status).toBe(401);
    expect((await post({})).status).toBe(400);
    expect((await post({ grants: [] })).status).toBe(400);
    expect((await post({ grants: [{ itemId: id }] })).status).toBe(400);
    expect((await post({ grants: [{ itemId: id, charId: 'char-a', quantity: 0 }] })).status).toBe(400);
    expect((await post({ grants: [{ itemId: 'nope', charId: 'char-a' }] })).status).toBe(404);
    expect((await post({ grants: [{ itemId: id, charId: 'ghost' }] })).status).toBe(404);
    expect(itemsOf(ldb, 'char-a')).toEqual([]);
  });

  it('gives a whole pile to one character, with one notification', async () => {
    const { app, ldb } = setup();
    const sword = seed(ldb, { name: 'Sword', tag: 'Hoard', quantity: 1 });
    const potion = seed(ldb, { name: 'Potion', tag: 'Hoard', quantity: 3 });
    const res = await asDM(request(app).post('/api/treasury/give-many')).send({
      grants: [{ itemId: sword, charId: 'char-a' }, { itemId: potion, charId: 'char-a', quantity: 3 }],
    });
    expect(res.body).toMatchObject({ ok: true, count: 2 });
    const names = itemsOf(ldb, 'char-a').map(i => i.name);
    expect(names.filter(n => n === 'Sword')).toHaveLength(1);
    expect(names.filter(n => n === 'Potion').length).toBeGreaterThanOrEqual(1);
    expect(ldb.getTreasuryItem(sword).quantity).toBe(0);
    expect(ldb.getTreasuryItem(potion).quantity).toBe(0);
    const notes = ldb.listNotificationsFor('char-a', 20).filter(n => n.kind === 'loot-granted');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('The DM gave you 2 items');
    expect(notes[0].body).toContain('Potion ×3');
  });

  it('splits a pile between characters, and counts stock down across grants', async () => {
    const { app, ldb } = setup();
    const arrows = seed(ldb, { name: 'Arrows', quantity: 5 });
    const ring = seed(ldb, { name: 'Ring', quantity: -1 });
    await asDM(request(app).post('/api/treasury/give-many')).send({
      grants: [
        { itemId: arrows, charId: 'char-a', quantity: 2 },
        { itemId: arrows, charId: 'char-b', quantity: 2 },
        { itemId: ring, charId: 'char-b' },
      ],
    });
    expect(ldb.getTreasuryItem(arrows).quantity).toBe(1);
    expect(ldb.getTreasuryItem(ring).quantity).toBe(-1);
    expect(itemsOf(ldb, 'char-a').some(i => i.name === 'Arrows')).toBe(true);
    expect(itemsOf(ldb, 'char-b').map(i => i.name)).toEqual(expect.arrayContaining(['Arrows', 'Ring']));
    expect(ldb.listNotificationsFor('char-b', 20).find(n => n.kind === 'loot-granted').title).toBe('The DM gave you 2 items');
  });

  it('takes spent free loot out of the pool and turns down whoever was waiting', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Amulet', mode: 'loot', quantity: 1 });
    ldb.createTreasuryRequest('r1', { itemId: id, charId: 'char-b', charName: 'Bob', status: 'pending', requestedAt: new Date().toISOString() });
    const res = await asDM(request(app).post('/api/treasury/give-many')).send({ grants: [{ itemId: id, charId: 'char-a' }] });
    expect(res.body.declined).toBe(1);
    expect(ldb.getTreasuryItem(id)).toMatchObject({ quantity: 0, mode: 'hidden' });
  });

  it('hands an unidentified item over under the name players see', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Ring of Wishes', unidName: 'Dull Ring', descVisible: false });
    await asDM(request(app).post('/api/treasury/give-many')).send({ grants: [{ itemId: id, charId: 'char-a' }] });
    expect(itemsOf(ldb, 'char-a')[0]).toMatchObject({ name: 'Dull Ring', unidentified: true });
    const note = ldb.listNotificationsFor('char-a', 20).find(n => n.kind === 'loot-granted');
    expect(note.title).toBe('The DM gave you Dull Ring');
  });
});

describe('pile storage (real localdb)', () => {
  it('stores, renames, merges, deletes and imports piles', () => {
    const db = openCampaignDb(':memory:');
    db.upsertTreasuryPile('A', 'note A');
    db.upsertTreasuryPile('A');
    expect(db.listTreasuryPiles().map(p => [p.tag, p.note])).toEqual([['A', 'note A']]);
    db.createTreasuryItem('i1', { name: 'x', tag: 'A' });
    db.renameTreasuryPile('A', 'B');
    expect(db.getTreasuryItem('i1').tag).toBe('B');
    expect(db.listTreasuryPiles().map(p => [p.tag, p.note])).toEqual([['B', 'note A']]);
    db.renameTreasuryPile('B', '');
    expect(db.getTreasuryItem('i1').tag).toBe('');
    expect(db.listTreasuryPiles()).toEqual([]);
    db.importTreasuryPiles([{ tag: 'C', note: 'c' }, { tag: '' }, null]);
    expect(db.listTreasuryPiles().map(p => p.tag)).toEqual(['C']);
    db.deleteTreasuryPile('C');
    expect(db.listTreasuryPiles()).toEqual([]);
  });

  it('folds the old tags-on-sale list: shop items outside it become hidden', () => {
    const db = openCampaignDb(':memory:');
    db.createTreasuryItem('on', { name: 'On sale', tag: 'Market', mode: 'shop' });
    db.createTreasuryItem('off', { name: 'Not on sale', tag: 'Armoury', mode: 'shop' });
    db.createTreasuryItem('loose', { name: 'No tag', tag: '', mode: 'shop' });
    db.createTreasuryItem('loot', { name: 'Loot', tag: 'Armoury', mode: 'loot' });
    db.setShopConfig(true, ['Market']);
    db.foldShopSaleTags();
    expect(db.getTreasuryItem('on').mode).toBe('shop');
    expect(db.getTreasuryItem('off').mode).toBe('hidden');
    expect(db.getTreasuryItem('loose').mode).toBe('hidden');
    expect(db.getTreasuryItem('loot').mode).toBe('loot');
    expect(db.getShopConfig()).toMatchObject({ isOpen: 1, activeTags: [] });
  });

  it('leaves everything alone when the whole shop was on sale', () => {
    const db = openCampaignDb(':memory:');
    db.createTreasuryItem('s', { name: 'S', tag: 'X', mode: 'shop' });
    db.setShopConfig(false, []);
    db.foldShopSaleTags();
    expect(db.getTreasuryItem('s').mode).toBe('shop');
  });

  it('folds a restored backup that still carries a tags-on-sale list', () => {
    const db = openCampaignDb(':memory:');
    db.importTreasury([
      { id: 'a', name: 'A', tag: 'Market', mode: 'shop' },
      { id: 'b', name: 'B', tag: 'Crypt', mode: 'shop' },
    ], [{ isOpen: 1, activeTags: ['Market'] }], [], []);
    expect(db.getTreasuryItem('b').mode).toBe('hidden');
    expect(db.getShopConfig().activeTags).toEqual([]);
  });
});
