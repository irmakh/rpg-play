/**
 * API integration tests for the unified /api/treasury routes.
 *
 * Covers the merged loot+shop model: mode filtering and description reveal,
 * shop open/closed + activeTag gating, free claim (claim-once via the log,
 * grants a real inventory item), purchase (funds, stock, weapon ATK/DMG),
 * bulk operations, text import, the merged ledger, and image upload.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';

function setup(charData = {}) {
  const { app, ldb, hashPassword, broadcasts, deletedFiles } = makeApp();
  ldb.createCharacter('char-a', {
    name: 'Alice',
    passwordHash: hashPassword(PW_A),
    dataJson: JSON.stringify({ name: 'Alice', str: '16', dex: '14', level: '5', gp: '100', ...charData }),
  });
  return { app, ldb, broadcasts, deletedFiles };
}

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asA  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);

// Seed straight through ldb so tests do not depend on the create endpoint.
// descVisible defaults to true here so most tests see the item as identified;
// the unidentified-redaction tests opt in with descVisible: false.
let seq = 0;
function seed(ldb, over = {}) {
  const id = `item-${++seq}`;
  ldb.createTreasuryItem(id, {
    name: 'Thing', mode: 'hidden', description: '', descVisible: true,
    itemType: 'other', valueCp: 0, quantity: 1,
    createdAt: new Date(Date.now() + seq).toISOString(),
    ...over,
  });
  return id;
}

function charData(ldb) {
  return JSON.parse(ldb.getCharacter('char-a').dataJson);
}
function charItems(ldb) {
  return JSON.parse(charData(ldb)._items || '[]');
}

describe('GET /api/treasury — player view', () => {
  it('returns loot items and hides hidden ones', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Free Sword', mode: 'loot' });
    seed(ldb, { name: 'Secret Plans', mode: 'hidden' });
    const res = await request(app).get('/api/treasury');
    expect(res.status).toBe(200);
    expect(res.body.loot.map(i => i.name)).toEqual(['Free Sword']);
    expect(JSON.stringify(res.body)).not.toContain('Secret Plans');
  });

  it('withholds a description until the DM reveals it', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Orb', mode: 'loot', description: 'It hums.', descVisible: false });
    let res = await request(app).get('/api/treasury');
    expect(res.body.loot[0].description).toBe('');

    ldb.updateTreasuryItem(id, { descVisible: true });
    res = await request(app).get('/api/treasury');
    expect(res.body.loot[0].description).toBe('It hums.');
  });

  it('serves shop items only while the shop is open', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 5000 });

    ldb.setShopConfig(false, '');
    let res = await request(app).get('/api/treasury');
    expect(res.body.shopOpen).toBe(false);
    expect(res.body.shop).toEqual([]);

    ldb.setShopConfig(true, '');
    res = await request(app).get('/api/treasury');
    expect(res.body.shop.map(i => i.name)).toEqual(['Potion']);
  });

  it('filters the shop by activeTag and hides out-of-stock items', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Potion', mode: 'shop', tag: 'Potions', quantity: 3 });
    seed(ldb, { name: 'Sword',  mode: 'shop', tag: 'Weapons', quantity: 1 });
    seed(ldb, { name: 'Empty',  mode: 'shop', tag: 'Potions', quantity: 0 });

    ldb.setShopConfig(true, 'Potions');
    const res = await request(app).get('/api/treasury');
    expect(res.body.activeTag).toBe('Potions');
    expect(res.body.shop.map(i => i.name)).toEqual(['Potion']);
  });

  it('serves several tags at once when the shop is open for a set', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Potion', mode: 'shop', tag: 'Potions' });
    seed(ldb, { name: 'Sword',  mode: 'shop', tag: 'Weapons' });
    seed(ldb, { name: 'Rope',   mode: 'shop', tag: 'Gear' });

    ldb.setShopConfig(true, ['Potions', 'Weapons']);
    const res = await request(app).get('/api/treasury');
    expect(res.body.activeTags).toEqual(['Potions', 'Weapons']);
    expect(res.body.shop.map(i => i.name).sort()).toEqual(['Potion', 'Sword']);
  });

  it('opens the whole shop when no tags are selected', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Potion', mode: 'shop', tag: 'Potions' });
    seed(ldb, { name: 'Sword',  mode: 'shop', tag: 'Weapons' });
    ldb.setShopConfig(true, []);
    const res = await request(app).get('/api/treasury');
    expect(res.body.activeTags).toEqual([]);
    expect(res.body.shop).toHaveLength(2);
  });

  it('keeps unlimited stock (-1) available', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Rations', mode: 'shop', quantity: -1 });
    const res = await request(app).get('/api/treasury');
    expect(res.body.shop[0].quantity).toBe(-1);
  });

  it('returns claimedIds only to an authenticated character', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Ring', mode: 'loot' });
    ldb.createLootLog('log-1', { charId: 'char-a', charName: 'Alice', itemName: 'Ring', itemId: id });

    const anon = await request(app).get('/api/treasury');
    expect(anon.body.claimedIds).toEqual([]);

    const auth = await asA(request(app).get('/api/treasury'));
    expect(auth.body.claimedIds).toEqual([id]);
  });

  it('redacts an unidentified item down to kind, price and stock', async () => {
    const { app, ldb } = setup();
    seed(ldb, {
      name: 'Flame Tongue', mode: 'shop', descVisible: false, description: 'It burns.',
      itemType: 'weapon', weaponAtk: '2', weaponDmg: '2d6 fire',
      weaponPropertiesJson: '["Finesse","Light"]',
      acBonus: 3, initBonus: 2, speedBonus: 10, spellAtkBonus: 1, spellDcBonus: 1,
      requiresAttunement: true, valueCp: 64000, quantity: 4,
    });
    const res = await request(app).get('/api/treasury');
    const item = res.body.shop[0];

    // Visible: its name, what kind of thing it is, cost and stock.
    expect(item).toMatchObject({
      name: 'Flame Tongue', unidentified: true,
      itemType: 'weapon', valueCp: 64000, quantity: 4,
    });
    // Withheld: everything that would identify it.
    expect(item).toMatchObject({
      description: '', weaponAtk: '', weaponDmg: '', weaponProperties: [],
      acBonus: 0, initBonus: 0, speedBonus: 0, spellAtkBonus: 0, spellDcBonus: 0,
      requiresAttunement: false,
    });
    // No property of the item survives anywhere in the payload — the name is
    // deliberately the one thing that does.
    const raw = JSON.stringify(res.body);
    for (const secret of ['It burns', '2d6 fire', 'Finesse']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('shows everything once the DM reveals the description', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, {
      name: 'Flame Tongue', mode: 'shop', descVisible: false,
      description: 'It burns.', itemType: 'weapon', weaponAtk: '2', acBonus: 3,
    });
    await asDM(request(app).put(`/api/treasury/${id}`)).send({ descVisible: true });
    const res = await request(app).get('/api/treasury');
    expect(res.body.shop[0]).toMatchObject({
      name: 'Flame Tongue', description: 'It burns.', weaponAtk: '2', acBonus: 3,
    });
    expect(res.body.shop[0].unidentified).toBeUndefined();
  });

  it('never leaks image paths for hidden items', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Hidden', mode: 'hidden', imageUrl: '/uploads/treasury/secret.jpg' });
    const res = await request(app).get('/api/treasury');
    expect(JSON.stringify(res.body)).not.toContain('secret.jpg');
  });
});

describe('/api/treasury/all — DM catalogue', () => {
  it('requires the master password', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/treasury/all')).status).toBe(401);
  });

  it('returns every mode with full detail', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'A', mode: 'hidden' });
    seed(ldb, { name: 'B', mode: 'loot', description: 'quiet', descVisible: false });
    seed(ldb, { name: 'C', mode: 'shop' });
    const res = await asDM(request(app).get('/api/treasury/all'));
    expect(res.body.map(i => i.name).sort()).toEqual(['A', 'B', 'C']);
    // The DM always sees the description, revealed or not.
    expect(res.body.find(i => i.name === 'B').description).toBe('quiet');
  });
});

describe('treasury CRUD', () => {
  it('creates an item with defaults and requires a name', async () => {
    const { app, ldb } = setup();
    const bad = await asDM(request(app).post('/api/treasury')).send({ name: '  ' });
    expect(bad.status).toBe(400);

    const res = await asDM(request(app).post('/api/treasury')).send({ name: 'Lantern', mode: 'loot' });
    expect(res.status).toBe(200);
    const row = ldb.getTreasuryItem(res.body.id);
    expect(row.name).toBe('Lantern');
    expect(row.mode).toBe('loot');
    expect(row.quantity).toBe(1);
  });

  it('coerces an unknown mode to hidden', async () => {
    const { app, ldb } = setup();
    const res = await asDM(request(app).post('/api/treasury')).send({ name: 'X', mode: 'nonsense' });
    expect(ldb.getTreasuryItem(res.body.id).mode).toBe('hidden');
  });

  it('updates only the supplied fields', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Old', mode: 'hidden', valueCp: 500 });
    const res = await asDM(request(app).put(`/api/treasury/${id}`)).send({ mode: 'shop' });
    expect(res.status).toBe(200);
    const row = ldb.getTreasuryItem(id);
    expect(row.mode).toBe('shop');
    expect(row.name).toBe('Old');
    expect(row.valueCp).toBe(500);
  });

  it('404s on a missing item', async () => {
    const { app } = setup();
    expect((await asDM(request(app).put('/api/treasury/nope')).send({ name: 'x' })).status).toBe(404);
    expect((await asDM(request(app).delete('/api/treasury/nope'))).status).toBe(404);
  });

  it('deletes the item and its image files', async () => {
    const { app, ldb, deletedFiles } = setup();
    const id = seed(ldb, {
      name: 'Painting',
      imageUrl: '/uploads/treasury/a.jpg',
      imageThumb: '/uploads/treasury/a_thumb.webp',
      imageMedium: '/uploads/treasury/a_medium.webp',
    });
    await asDM(request(app).delete(`/api/treasury/${id}`));
    expect(ldb.getTreasuryItem(id)).toBeNull();
    expect(deletedFiles).toEqual([
      '/uploads/treasury/a.jpg',
      '/uploads/treasury/a_thumb.webp',
      '/uploads/treasury/a_medium.webp',
    ]);
  });

  it('removes the previous image files when the image is replaced', async () => {
    const { app, ldb, deletedFiles } = setup();
    const id = seed(ldb, { imageUrl: '/uploads/treasury/old.jpg', imageThumb: '/uploads/treasury/old_thumb.webp' });
    await asDM(request(app).put(`/api/treasury/${id}`)).send({ imageUrl: '/uploads/treasury/new.jpg' });
    expect(deletedFiles).toContain('/uploads/treasury/old.jpg');
    expect(deletedFiles).toContain('/uploads/treasury/old_thumb.webp');
  });

  it('leaves image files alone on an unrelated edit', async () => {
    const { app, ldb, deletedFiles } = setup();
    const id = seed(ldb, { imageUrl: '/uploads/treasury/keep.jpg' });
    await asDM(request(app).put(`/api/treasury/${id}`)).send({ name: 'Renamed' });
    expect(deletedFiles).toEqual([]);
  });
});

describe('bulk operations', () => {
  it('applies a tag to many items', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb), b = seed(ldb);
    const res = await asDM(request(app).post('/api/treasury/bulk-update-tag')).send({ ids: [a, b], tag: 'Vault' });
    expect(res.body.count).toBe(2);
    expect(ldb.getTreasuryItem(a).tag).toBe('Vault');
    expect(ldb.getTreasuryItem(b).tag).toBe('Vault');
  });

  it('sets mode on many items and rejects an invalid mode', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb), b = seed(ldb);
    expect((await asDM(request(app).post('/api/treasury/bulk-mode')).send({ ids: [a], mode: 'bogus' })).status).toBe(400);

    await asDM(request(app).post('/api/treasury/bulk-mode')).send({ ids: [a, b], mode: 'loot' });
    expect(ldb.getTreasuryItem(a).mode).toBe('loot');
    expect(ldb.getTreasuryItem(b).mode).toBe('loot');
  });

  it('bulk-deletes and cleans up images', async () => {
    const { app, ldb, deletedFiles } = setup();
    const a = seed(ldb, { imageUrl: '/uploads/treasury/x.jpg' });
    const b = seed(ldb);
    await asDM(request(app).post('/api/treasury/bulk-delete')).send({ ids: [a, b] });
    expect(ldb.listTreasuryItems()).toHaveLength(0);
    expect(deletedFiles).toContain('/uploads/treasury/x.jpg');
  });

  it('rejects an empty id list', async () => {
    const { app } = setup();
    expect((await asDM(request(app).post('/api/treasury/bulk-delete')).send({ ids: [] })).status).toBe(400);
  });
});

describe('POST /api/treasury/import', () => {
  it('parses blank-line-separated blocks into hidden items', async () => {
    const { app, ldb } = setup();
    const text = 'Gold Coins\nA handful of coins.\n\nRusty Sword\nAn old blade.\nStill sharp.';
    const res = await asDM(request(app).post('/api/treasury/import')).send({ text, tag: 'Chest' });
    expect(res.body.count).toBe(2);

    const rows = ldb.listTreasuryItems();
    expect(rows.map(r => r.name)).toEqual(['Gold Coins', 'Rusty Sword']);
    expect(rows[0].description).toBe('A handful of coins.');
    expect(rows[1].description).toBe('An old blade.\nStill sharp.');
    expect(rows.every(r => r.mode === 'hidden' && r.tag === 'Chest')).toBe(true);
  });

  it('rejects empty text and text with no usable blocks', async () => {
    const { app } = setup();
    expect((await asDM(request(app).post('/api/treasury/import')).send({ text: '' })).status).toBe(400);
    expect((await asDM(request(app).post('/api/treasury/import')).send({ text: '\n \n' })).status).toBe(400);
  });
});

describe('POST /api/treasury/claim', () => {
  it('grants a real inventory item, not just a note', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Cloak', mode: 'loot', acBonus: 1, description: 'Warm', descVisible: true });
    const res = await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    expect(res.status).toBe(200);

    const items = charItems(ldb);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Cloak', acBonus: 1, srcId: id, notes: 'Warm', equipped: false });
  });

  it('computes weapon ATK and DMG the same way a purchase does', async () => {
    const { app, ldb } = setup();
    // STR 16 (+3), level 5 (prof +3), +1 magic → atk +7, dmg 1d8+4 slashing
    const id = seed(ldb, {
      name: 'Longsword', mode: 'loot', itemType: 'weapon',
      weaponAtk: '1', weaponDmg: '1d8 slashing', weaponPropertiesJson: '[]',
    });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });

    const weapons = JSON.parse(charData(ldb)._weapons);
    expect(weapons[0][0]).toBe('Longsword');
    expect(weapons[0][1]).toBe('+7');
    expect(weapons[0][2]).toBe('1d8+4 slashing');
  });

  it('grants an unidentified item redacted, so acquiring it reveals nothing', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, {
      name: 'Orb of Doom', mode: 'loot', description: 'Cursed!', descVisible: false,
      itemType: 'wondrous', acBonus: 3, initBonus: 2, requiresAttunement: true,
    });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });

    const it = charItems(ldb)[0];
    expect(it).toMatchObject({
      name: 'Orb of Doom - (unidentified)', unidentified: true, srcId: id,
      notes: '', acBonus: 0, initBonus: 0, requiresAttunement: false,
    });
    // The name is kept; the properties are not.
    expect(JSON.stringify(charData(ldb))).not.toContain('Cursed!');
  });

  it('gives an unidentified weapon no attack row until it is identified', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, {
      name: 'Flame Tongue', mode: 'loot', descVisible: false,
      itemType: 'weapon', weaponAtk: '2', weaponDmg: '2d6 fire',
    });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    expect(JSON.parse(charData(ldb)._weapons || '[]')).toHaveLength(0);
    expect(charItems(ldb)[0].weaponDmg).toBe('');
  });

  it('identifies copies players already hold when the DM reveals it', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, {
      name: 'Flame Tongue', mode: 'loot', descVisible: false, description: 'It burns.',
      itemType: 'weapon', weaponAtk: '2', weaponDmg: '2d6 fire', quantity: 5,
    });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    expect(charItems(ldb)[0].unidentified).toBe(true);

    await asDM(request(app).put(`/api/treasury/${id}`)).send({ descVisible: true });

    const it = charItems(ldb)[0];
    expect(it.name).toBe('Flame Tongue');
    expect(it.unidentified).toBeUndefined();
    expect(it.notes).toContain('It burns.');
    // STR 16 (+3), level 5 (prof +3), +2 magic → +8 to hit, 2d6+5 fire
    const weapons = JSON.parse(charData(ldb)._weapons);
    expect(weapons[0]).toEqual(['Flame Tongue', '+8', '2d6+5 fire', expect.stringContaining('It burns.')]);
  });

  it('leaves an already-identified held item alone on an unrelated edit', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Cloak', mode: 'loot', descVisible: true, description: 'Warm' });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    const before = JSON.stringify(charItems(ldb));
    await asDM(request(app).put(`/api/treasury/${id}`)).send({ tag: 'Vault' });
    expect(JSON.stringify(charItems(ldb))).toBe(before);
  });

  it('refuses a second claim of the same item', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Ring', mode: 'loot' });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    // The item leaves the pool, so a replay finds nothing to grant.
    const again = await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    expect(again.status).toBe(400);
    expect(charItems(ldb)).toHaveLength(1);
  });

  it('a single-stock item leaves the pool once claimed', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Ring', mode: 'loot', quantity: 1 });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    const row = ldb.getTreasuryItem(id);
    expect(row.mode).toBe('hidden');
    expect(row.quantity).toBe(0);
  });

  it('a multi-stock item decrements and stays claimable', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Torch', mode: 'loot', quantity: 3 });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    const row = ldb.getTreasuryItem(id);
    expect(row.quantity).toBe(2);
    expect(row.mode).toBe('loot');
  });

  it('unlimited loot never runs out', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Rations', mode: 'loot', quantity: -1 });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    const row = ldb.getTreasuryItem(id);
    expect(row.quantity).toBe(-1);
    expect(row.mode).toBe('loot');
  });

  it('hides exhausted loot from the player view', async () => {
    const { app, ldb } = setup();
    seed(ldb, { name: 'Gone', mode: 'loot', quantity: 0 });
    const res = await request(app).get('/api/treasury');
    expect(res.body.loot).toEqual([]);
  });

  it('refuses to claim an item that is not free loot', async () => {
    const { app, ldb } = setup();
    const shopId = seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 5000 });
    const hidId  = seed(ldb, { name: 'Secret', mode: 'hidden' });
    const res = await asA(request(app).post('/api/treasury/claim'))
      .send({ charId: 'char-a', items: [{ id: shopId }, { id: hidId }] });
    expect(res.status).toBe(400);
    expect(charItems(ldb)).toHaveLength(0);
  });

  it('records the claim in the log with the item id', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Ring', mode: 'loot' });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    const logs = ldb.listLootLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ charId: 'char-a', charName: 'Alice', itemName: 'Ring', itemId: id });
  });

  it('rejects a claim without valid character auth', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { mode: 'loot' });
    const res = await request(app).post('/api/treasury/claim').send({ charId: 'char-a', items: [{ id }] });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/treasury/purchase', () => {
  const buy = (app, itemId, qty = 1) =>
    asA(request(app).post('/api/treasury/purchase')).send({ charId: 'char-a', items: [{ itemId, qty }] });

  it('deducts currency and decrements stock', async () => {
    const { app, ldb } = setup();                       // 100 gp = 10000 cp
    const id = seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 5000, quantity: 3 });
    const res = await buy(app, id);
    expect(res.status).toBe(200);
    // 10000cp − 5000cp; change is normalised up into the largest denominations.
    expect(res.body.newCurrency).toEqual({ pp: 5, gp: 0, ep: 0, sp: 0, cp: 0 });
    expect(ldb.getTreasuryItem(id).quantity).toBe(2);
    expect(charItems(ldb)[0].name).toBe('Potion');
  });

  it('makes change across denominations', async () => {
    const { app, ldb } = setup({ gp: '1', sp: '0', cp: '0' }); // 100 cp
    const id = seed(ldb, { name: 'Rope', mode: 'shop', valueCp: 45 });
    await buy(app, id);
    const d = charData(ldb);
    // 55cp left → 1 ep (50) + 5 cp
    expect({ gp: d.gp, ep: d.ep, sp: d.sp, cp: d.cp }).toEqual({ gp: '0', ep: '1', sp: '0', cp: '5' });
  });

  it('refuses when funds are short and changes nothing', async () => {
    const { app, ldb } = setup({ gp: '1' });
    const id = seed(ldb, { name: 'Crown', mode: 'shop', valueCp: 100000, quantity: 1 });
    const res = await buy(app, id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Insufficient/i);
    expect(charItems(ldb)).toHaveLength(0);
    expect(ldb.getTreasuryItem(id).quantity).toBe(1);
  });

  it('refuses when stock is short', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 10, quantity: 1 });
    const res = await buy(app, id, 5);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stock/i);
  });

  it('never decrements unlimited stock', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Rations', mode: 'shop', valueCp: 10, quantity: -1 });
    await buy(app, id, 3);
    expect(ldb.getTreasuryItem(id).quantity).toBe(-1);
    expect(charItems(ldb)).toHaveLength(3);
  });

  it('refuses to sell an item that is not in shop mode', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Free Sword', mode: 'loot', valueCp: 0 });
    const res = await buy(app, id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not for sale/i);
  });

  it('refuses while the shop is closed', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 10 });
    ldb.setShopConfig(false, '');
    const res = await buy(app, id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });

  it('logs the purchase with the item id and total', async () => {
    const { app, ldb } = setup();
    const id = seed(ldb, { name: 'Potion', mode: 'shop', valueCp: 250, quantity: 5 });
    await buy(app, id, 2);
    const logs = ldb.listPurchaseLogs();
    expect(logs[0]).toMatchObject({ itemName: 'Potion', itemId: id, qty: 2, totalCp: 500 });
  });
});

describe('GET /api/treasury/logs — merged ledger', () => {
  it('interleaves claims and purchases newest first', async () => {
    const { app, ldb } = setup();
    ldb.createLootLog('l1', { charId: 'char-a', charName: 'Alice', itemName: 'Ring', itemId: 'i1', claimedAt: '2026-01-01T10:00:00.000Z' });
    ldb.createPurchaseLog('p1', { charId: 'char-a', charName: 'Alice', itemName: 'Potion', itemId: 'i2', qty: 2, totalCp: 500, purchasedAt: '2026-01-02T10:00:00.000Z' });

    const res = await asDM(request(app).get('/api/treasury/logs'));
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.type)).toEqual(['purchase', 'claim']);
    expect(res.body[0]).toMatchObject({ itemName: 'Potion', qty: 2, totalCp: 500 });
    expect(res.body[1]).toMatchObject({ itemName: 'Ring', qty: 1, totalCp: 0 });
  });

  it('requires the master password', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/treasury/logs')).status).toBe(401);
  });
});

describe('POST /api/treasury/media — image upload', () => {
  const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');

  it('accepts an image and returns three sizes', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/treasury/media')).send({ dataUrl: PNG });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/treasury\//);
    expect(res.body.thumb).toMatch(/_thumb/);
    expect(res.body.medium).toMatch(/_medium/);
  });

  it('rejects a non-image mime type', async () => {
    const { app } = setup();
    const txt = 'data:text/plain;base64,' + Buffer.from('hello').toString('base64');
    const res = await asDM(request(app).post('/api/treasury/media')).send({ dataUrl: txt });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Images only/i);
  });

  it('rejects a malformed data URL', async () => {
    const { app } = setup();
    expect((await asDM(request(app).post('/api/treasury/media')).send({ dataUrl: 'not-a-data-url' })).status).toBe(400);
  });

  it('requires the master password', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/treasury/media').send({ dataUrl: PNG })).status).toBe(401);
  });
});

describe('shop status', () => {
  it('opens the shop for several tags and closes it again', async () => {
    const { app, ldb } = setup();
    let res = await asDM(request(app).put('/api/treasury/status'))
      .send({ isOpen: true, activeTags: ['Potions', 'Weapons'] });
    expect(res.body).toMatchObject({ isOpen: true, activeTags: ['Potions', 'Weapons'] });
    expect(ldb.getShopConfig().activeTags).toEqual(['Potions', 'Weapons']);

    // Closing always clears the tag filter.
    res = await asDM(request(app).put('/api/treasury/status')).send({ isOpen: false, activeTags: ['Potions'] });
    expect(res.body).toMatchObject({ isOpen: false, activeTags: [] });
  });

  it('still accepts a lone activeTag from an older client', async () => {
    const { app, ldb } = setup();
    const res = await asDM(request(app).put('/api/treasury/status')).send({ isOpen: true, activeTag: 'Potions' });
    expect(res.body.activeTags).toEqual(['Potions']);
    // The legacy single field keeps the first tag for older readers.
    expect(ldb.getShopConfig().activeTag).toBe('Potions');
  });

  it('trims, dedupes and drops blank tags', async () => {
    const { app } = setup();
    const res = await asDM(request(app).put('/api/treasury/status'))
      .send({ isOpen: true, activeTags: ['  Potions ', 'Potions', '', '   ', 'Weapons'] });
    expect(res.body.activeTags).toEqual(['Potions', 'Weapons']);
  });

  it('reports the open tag set', async () => {
    const { app, ldb } = setup();
    ldb.setShopConfig(true, ['A', 'B']);
    const res = await asDM(request(app).get('/api/treasury/status'));
    expect(res.body).toMatchObject({ isOpen: true, activeTags: ['A', 'B'], activeTag: 'A' });
  });

  it('requires the master password to read or write status', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/treasury/status')).status).toBe(401);
    expect((await request(app).put('/api/treasury/status').send({ isOpen: true })).status).toBe(401);
  });
});

describe('GET /api/treasury/visibility', () => {
  it('maps every item to its reveal state so held items can catch up', async () => {
    const { app, ldb } = setup();
    const a = seed(ldb, { name: 'A', description: 'shown', descVisible: true });
    const b = seed(ldb, { name: 'B', description: 'hidden', descVisible: false });
    const res = await request(app).get('/api/treasury/visibility');
    expect(res.body[a]).toEqual({ descVisible: true, description: 'shown' });
    expect(res.body[b].descVisible).toBe(false);
  });
});

describe('broadcasts', () => {
  it('announces treasury changes on the treasury channel', async () => {
    const { app, broadcasts } = setup();
    await asDM(request(app).post('/api/treasury')).send({ name: 'Lantern' });
    expect(broadcasts.some(b => b.channel === 'treasury' && b.payload.action === 'created')).toBe(true);
  });

  it('announces both character and treasury updates on a claim', async () => {
    const { app, ldb, broadcasts } = setup();
    const id = seed(ldb, { name: 'Ring', mode: 'loot' });
    await asA(request(app).post('/api/treasury/claim')).send({ charId: 'char-a', items: [{ id }] });
    expect(broadcasts.some(b => b.channel === 'characters')).toBe(true);
    expect(broadcasts.some(b => b.channel === 'treasury' && b.payload.action === 'claimed')).toBe(true);
  });
});
