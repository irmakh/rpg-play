// Written by Irmak Hakman — 2026-11-12 13:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * 3rd Party items (server/routes/book-items.js + lib/item-source.js) on the
 * REAL openCampaignDb(':memory:'). The 5etools download is a stub serving small
 * stand-ins for items.json, items-base.json and magicvariants.json, so the real
 * resolving and mapping runs. X-Test-Role 'dm' is the DM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerBookItems from '../../server/routes/book-items.js';
import * as S from '../../lib/item-source.js';

const FILES = {
  'items.json': { item: [
    { name: 'Cloak of Protection', source: 'XDMG', rarity: 'uncommon', reqAttune: true, wondrous: true, bonusAc: '+1',
      entries: ['You gain a {@b +1} bonus to Armor Class while you wear this cloak.'] },
    { name: 'Javelin of Lightning', source: 'XDMG', rarity: 'uncommon', type: 'M|XPHB', baseItem: 'javelin|xphb',
      entries: ['It deals {@damage 4d6} Lightning damage. {@dc 13} Dexterity save.'] },
    { name: 'Potion of Healing', source: 'XDMG', rarity: 'common', type: 'P', value: 5000, entries: ['Regain {@dice 2d4 + 2} Hit Points.'] },
    { name: 'Rope', source: 'XPHB', rarity: 'none', type: 'G', entries: ['Mundane.'] },
    { name: 'Wand of Sparks', source: 'XGE', rarity: 'rare', type: 'WD', charges: 7, recharge: 'dawn',
      entries: [{ type: 'list', items: ['One', 'Two'] }] },
  ], itemGroup: [] },
  'items-base.json': { baseitem: [
    { name: 'Javelin', source: 'XPHB', type: 'M|XPHB', dmg1: '1d6', dmgType: 'P', property: ['T|XPHB'], range: '30/120' },
  ] },
  'magicvariants.json': { magicvariant: [
    { name: '+1 Weapon', type: 'GV|DMG', requires: [{ weapon: true }],
      inherits: { namePrefix: '+1 ', source: 'XDMG', rarity: 'uncommon', bonusWeapon: '+1', entries: ['You have a {=bonusWeapon} bonus.'] } },
  ] },
  'books.json': { book: [{ id: 'XDMG', name: "Dungeon Master's Guide (2024)" }, { id: 'XGE', name: "Xanathar's Guide to Everything" }] },
  'adventures.json': { adventure: [] },
};
const fakeFetch = async (url) => {
  const f = FILES[url.split('/').pop()];
  return f ? { ok: true, text: async () => JSON.stringify(f) } : { ok: false, status: 404, text: async () => '' };
};

let ldb, app, broadcasts;
beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = [];
  app = express();
  app.use(express.json({ limit: '10mb' }));
  registerBookItems(app, {
    ldb, genId: () => crypto.randomUUID(),
    masterAuth: req => req.headers['x-test-role'] === 'dm',
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    itemSource: {
      listItemBooks: () => S.listItemBooks(fakeFetch),
      fetchItemBooks: codes => S.fetchItemBooks(codes, fakeFetch),
      parseHomebrew: file => S.parseHomebrew(file, fakeFetch),
    },
  });
});

const dm = r => r.set('X-Test-Role', 'dm');
const importXDMG = () => dm(request(app).post('/api/book-items/import-books')).send({ books: ['XDMG'] });
const search = async (qs = '') => (await dm(request(app).get(`/api/book-items${qs}`))).body;

describe('5etools books', () => {
  it('is the DM\'s alone', async () => {
    expect((await request(app).get('/api/book-items/books')).status).toBe(401);
    expect((await request(app).post('/api/book-items/import-books').send({ books: ['XDMG'] })).status).toBe(401);
    expect((await request(app).get('/api/book-items')).status).toBe(401);
  });

  it('lists only books with magic items, with their counts', async () => {
    const r = await dm(request(app).get('/api/book-items/books'));
    expect(r.body).toEqual([
      { code: 'XDMG', name: "Dungeon Master's Guide (2024)", count: 4 },
      { code: 'XGE', name: "Xanathar's Guide to Everything", count: 1 },
    ]);
  });

  it('imports magic items and generic variants, never mundane gear', async () => {
    const r = await importXDMG();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ imported: 4, updated: 0 });
    expect((await search()).rows.map(i => i.name)).toEqual(['+1 Weapon', 'Cloak of Protection', 'Javelin of Lightning', 'Potion of Healing']);
    expect(broadcasts.some(b => b.event === 'bookItems')).toBe(true);
    expect((await dm(request(app).get('/api/book-items/sources'))).body)
      .toEqual([{ source: 'XDMG', bookName: "Dungeon Master's Guide (2024)", origin: '5etools', count: 4 }]);
  });

  it('a second import updates in place', async () => {
    await importXDMG();
    const before = (await search()).rows.map(i => i.id);
    const r = await importXDMG();
    expect(r.body).toMatchObject({ imported: 0, updated: 4 });
    expect((await search()).rows.map(i => i.id)).toEqual(before);
  });

  it('refuses an unknown book', async () => {
    const r = await dm(request(app).post('/api/book-items/import-books')).send({ books: ['NOPE'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown book: NOPE/);
  });

  it('searches by name, rarity and kind', async () => {
    await importXDMG();
    expect((await search('?q=cloak')).rows.map(i => i.name)).toEqual(['Cloak of Protection']);
    expect((await search('?rarity=common')).rows.map(i => i.name)).toEqual(['Potion of Healing']);
    expect((await search('?kind=weapon')).rows.map(i => i.name)).toEqual(['+1 Weapon', 'Javelin of Lightning']);
  });
});

describe('treasury fields and copies', () => {
  it('maps a magic weapon with its base item', async () => {
    await importXDMG();
    const id = (await search('?q=javelin')).rows[0].id;
    const r = await dm(request(app).get(`/api/book-items/${id}`));
    expect(r.body.fields).toMatchObject({ name: 'Javelin of Lightning', itemType: 'weapon', weaponDmg: '1d6 piercing', weaponProperties: ['Thrown', 'Range'] });
    expect(r.body.fields.description).toBe('Weapon (javelin), uncommon\n\nIt deals 4d6 Lightning damage. DC 13 Dexterity save.');
  });

  it('copies an item into a pile as a hidden, ordinary treasury item', async () => {
    await importXDMG();
    const id = (await search('?q=cloak')).rows[0].id;
    const r = await dm(request(app).post(`/api/book-items/${id}/copy`)).send({ tag: 'Dragon hoard' });
    expect(r.status).toBe(200);
    const t = ldb.getTreasuryItem(r.body.id);
    expect(t).toMatchObject({ name: 'Cloak of Protection', tag: 'Dragon hoard', mode: 'hidden', itemType: 'wondrous', acBonus: 1 });
    expect(!!t.requiresAttunement).toBe(true);
    expect(t.description).toContain('You gain a +1 bonus to Armor Class');
    expect(broadcasts.some(b => b.event === 'treasury' && b.payload.action === 'created')).toBe(true);
  });

  it('removing a book leaves copies in piles alone', async () => {
    await importXDMG();
    const id = (await search('?q=potion')).rows[0].id;
    const copy = (await dm(request(app).post(`/api/book-items/${id}/copy`)).send({ tag: '' })).body.id;
    const r = await dm(request(app).delete('/api/book-items/books/XDMG'));
    expect(r.body).toEqual({ ok: true, removed: 4 });
    expect((await search()).total).toBe(0);
    expect(ldb.getTreasuryItem(copy).valueCp).toBe(5000);
    expect((await dm(request(app).get(`/api/book-items/${id}`))).status).toBe(404);
  });
});

describe('homebrew upload', () => {
  const BREW = {
    _meta: { sources: [{ json: 'MyBrew', full: 'My Homebrew Book' }] },
    item: [
      { name: 'Shard Blade', source: 'MyBrew', rarity: 'rare', baseItem: 'javelin|xphb', bonusWeapon: '+2', entries: ['Sharp.'] },
      { name: 'Copied Cloak', source: 'MyBrew', _copy: { name: 'Cloak of Protection', source: 'XDMG' } },
      { name: 'Plain Spoon', source: 'MyBrew', rarity: 'none', entries: ['A spoon.'] },
    ],
  };

  it('imports the magic items, resolving base items and copies from the core data', async () => {
    const r = await dm(request(app).post('/api/book-items/upload')).send({ file: BREW });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ imported: 2, updated: 0, skipped: 1, books: [{ code: 'MyBrew', name: 'My Homebrew Book', count: 2 }] });
    const rows = (await search('?source=MyBrew')).rows;
    expect(rows.map(i => i.name)).toEqual(['Copied Cloak', 'Shard Blade']);
    const blade = (await dm(request(app).get(`/api/book-items/${rows[1].id}`))).body.fields;
    expect(blade).toMatchObject({ itemType: 'weapon', weaponAtk: '2', weaponDmg: '1d6 piercing' });
    const cloak = (await dm(request(app).get(`/api/book-items/${rows[0].id}`))).body.fields;
    expect(cloak).toMatchObject({ itemType: 'wondrous', acBonus: 1, requiresAttunement: true });
    expect((await dm(request(app).get('/api/book-items/sources'))).body[0]).toMatchObject({ source: 'MyBrew', origin: 'upload', count: 2 });
  });

  it('refuses a file with no magic items, and a non-file', async () => {
    const none = await dm(request(app).post('/api/book-items/upload')).send({ file: { item: [{ name: 'Spoon', source: 'X', rarity: 'none' }] } });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/No magic items/);
    expect((await dm(request(app).post('/api/book-items/upload')).send({ file: [1, 2] })).status).toBe(400);
    expect((await request(app).post('/api/book-items/upload').send({ file: BREW })).status).toBe(401);
  });
});
