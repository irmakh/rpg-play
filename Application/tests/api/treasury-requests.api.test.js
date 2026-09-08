/**
 * API integration tests for free-loot selection and DM approval.
 *
 * Free loot is no longer taken, it is asked for: a player registers a request,
 * every player can see who else wants it, and nothing reaches an inventory
 * until the DM approves one of those requests. Stock decides how many can be
 * approved; when it runs out the item leaves the pool and everybody still
 * waiting is declined.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';

function setup({ quantity = 1, mode = 'loot', descVisible = true } = {}) {
  const { app, ldb, hashPassword, broadcasts } = makeApp();

  ldb.createCharacter('char-a', {
    name: 'Aliyr', passwordHash: hashPassword(PW_A),
    dataJson: JSON.stringify({ name: 'Aliyr', level: '5' }),
  });
  ldb.createCharacter('char-b', {
    name: 'Gerion', passwordHash: hashPassword(PW_B),
    dataJson: JSON.stringify({ name: 'Gerion', level: '5' }),
  });

  ldb.createTreasuryItem('item-1', {
    name: 'Flametongue Longsword', mode, quantity, descVisible,
    description: 'It burns.', itemType: 'weapon', weaponDmg: '2d6', valueCp: 50000,
  });

  return { app, ldb, broadcasts };
}

const asDM     = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asAliyr  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asGerion = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);

const select = (app, who, charId, itemId = 'item-1') =>
  who(request(app).post('/api/treasury/request')).send({ charId, items: [{ id: itemId }] });

const view = (app, who) => who(request(app).get('/api/treasury'));
const queue = (app) => asDM(request(app).get('/api/treasury/requests'));
const itemsOf = (ldb, charId) => JSON.parse(JSON.parse(ldb.getCharacter(charId).dataJson)._items || '[]');

describe('free loot — selecting', () => {
  it('records a request without granting anything', async () => {
    const { app, ldb } = setup();
    const res = await select(app, asAliyr, 'char-a');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    // The whole point: the sword is still in the pool and not in the bag.
    expect(itemsOf(ldb, 'char-a')).toHaveLength(0);
    expect(ldb.getTreasuryItem('item-1').mode).toBe('loot');
    expect(ldb.getTreasuryItem('item-1').quantity).toBe(1);
    expect(ldb.listTreasuryRequestsForItem('item-1', 'pending')).toHaveLength(1);
  });

  it('lets several players want the same item', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    expect(ldb.listTreasuryRequestsForItem('item-1', 'pending').map(r => r.charName))
      .toEqual(['Aliyr', 'Gerion']);
  });

  it('shows every requester to every player, and marks your own', async () => {
    const { app } = setup();
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');

    const seen = await view(app, asGerion);
    const item = seen.body.loot.find(i => i.id === 'item-1');
    expect(item.requesters.map(r => r.charName)).toEqual(['Aliyr', 'Gerion']);
    expect(seen.body.myRequestIds).toEqual(['item-1']);

    // An anonymous viewer sees the contest but has no request of their own.
    const anon = await request(app).get('/api/treasury');
    expect(anon.body.loot[0].requesters.map(r => r.charName)).toEqual(['Aliyr', 'Gerion']);
    expect(anon.body.myRequestIds).toEqual([]);
  });

  it('ignores a second request for the same item', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const again = await select(app, asAliyr, 'char-a');
    expect(again.status).toBe(400);
    expect(ldb.listTreasuryRequestsForItem('item-1', 'pending')).toHaveLength(1);
  });

  it('refuses a request for an item that is not free loot', async () => {
    const { app, ldb } = setup({ mode: 'shop' });
    const res = await select(app, asAliyr, 'char-a');
    expect(res.status).toBe(400);
    expect(ldb.listTreasuryRequests()).toHaveLength(0);
  });

  it('refuses a request without the character password', async () => {
    const { app, ldb } = setup();
    const res = await request(app).post('/api/treasury/request')
      .set('X-Character-Id', 'char-a')
      .send({ charId: 'char-a', items: [{ id: 'item-1' }] });
    expect(res.status).toBe(401);
    expect(ldb.listTreasuryRequests()).toHaveLength(0);
  });

  it('lets a player withdraw', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const res = await asAliyr(request(app).post('/api/treasury/request/withdraw'))
      .send({ charId: 'char-a', itemId: 'item-1' });
    expect(res.status).toBe(200);
    expect(ldb.listTreasuryRequestsForItem('item-1', 'pending')).toHaveLength(0);
  });

  it('routes the old claim URL to a request, so a stale client cannot self-grant', async () => {
    const { app, ldb } = setup();
    const res = await asAliyr(request(app).post('/api/treasury/claim'))
      .send({ charId: 'char-a', items: [{ id: 'item-1' }] });
    expect(res.status).toBe(200);
    expect(itemsOf(ldb, 'char-a')).toHaveLength(0);            // nothing granted
    expect(ldb.listTreasuryRequestsForItem('item-1', 'pending')).toHaveLength(1);
  });
});

describe('free loot — the DM decides', () => {
  it('lists the pending queue with item and character names', async () => {
    const { app } = setup();
    await select(app, asAliyr, 'char-a');
    const res = await queue(app);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      itemId: 'item-1', charId: 'char-a', charName: 'Aliyr', itemName: 'Flametongue Longsword',
    });
  });

  it('hides the queue from a player', async () => {
    const { app } = setup();
    await select(app, asAliyr, 'char-a');
    expect((await asAliyr(request(app).get('/api/treasury/requests'))).status).toBe(401);
  });

  it('grants the item on approval, with weapon stats and a ledger entry', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;

    const res = await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));
    expect(res.status).toBe(200);

    const items = itemsOf(ldb, 'char-a');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Flametongue Longsword');
    expect(items[0].srcId).toBe('item-1');
    // Approved loot goes through the same grant helper as a purchase, so a
    // weapon arrives with its attack row.
    const weapons = JSON.parse(JSON.parse(ldb.getCharacter('char-a').dataJson)._weapons || '[]');
    expect(weapons).toHaveLength(1);

    expect(ldb.listLootLogs().map(l => l.itemId)).toEqual(['item-1']);
    expect(ldb.getTreasuryRequest(reqId).status).toBe('approved');
  });

  it('never grants to the player who was not approved', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    const mine = ldb.listTreasuryRequests('pending').find(r => r.charId === 'char-a');

    await asDM(request(app).post(`/api/treasury/requests/${mine.id}/approve`));

    expect(itemsOf(ldb, 'char-a')).toHaveLength(1);
    expect(itemsOf(ldb, 'char-b')).toHaveLength(0);
  });

  it('exhausts the last one and declines everybody still waiting', async () => {
    const { app, ldb } = setup({ quantity: 1 });
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    const mine = ldb.listTreasuryRequests('pending').find(r => r.charId === 'char-a');

    const res = await asDM(request(app).post(`/api/treasury/requests/${mine.id}/approve`));
    expect(res.body).toMatchObject({ exhausted: true, declined: 1 });

    const item = ldb.getTreasuryItem('item-1');
    expect(item.quantity).toBe(0);
    expect(item.mode).toBe('hidden');
    expect(ldb.listTreasuryRequests('pending')).toHaveLength(0);
    expect(ldb.listTreasuryRequestsForChar('char-b')[0].status).toBe('declined');
  });

  it('keeps the rest waiting while stock remains', async () => {
    const { app, ldb } = setup({ quantity: 2 });
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    const mine = ldb.listTreasuryRequests('pending').find(r => r.charId === 'char-a');

    const res = await asDM(request(app).post(`/api/treasury/requests/${mine.id}/approve`));
    expect(res.body.exhausted).toBe(false);
    expect(ldb.getTreasuryItem('item-1').quantity).toBe(1);
    expect(ldb.listTreasuryRequests('pending').map(r => r.charId)).toEqual(['char-b']);
  });

  it('never exhausts an unlimited item', async () => {
    const { app, ldb } = setup({ quantity: -1 });
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    for (const r of ldb.listTreasuryRequests('pending')) {
      await asDM(request(app).post(`/api/treasury/requests/${r.id}/approve`));
    }
    expect(ldb.getTreasuryItem('item-1').quantity).toBe(-1);
    expect(ldb.getTreasuryItem('item-1').mode).toBe('loot');
    expect(itemsOf(ldb, 'char-a')).toHaveLength(1);
    expect(itemsOf(ldb, 'char-b')).toHaveLength(1);
  });

  it('declines without granting', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;

    expect((await asDM(request(app).post(`/api/treasury/requests/${reqId}/decline`))).status).toBe(200);
    expect(itemsOf(ldb, 'char-a')).toHaveLength(0);
    expect(ldb.getTreasuryRequest(reqId).status).toBe('declined');
    expect(ldb.getTreasuryItem('item-1').quantity).toBe(1);     // back on offer
  });

  it('refuses to decide the same request twice', async () => {
    const { app, ldb } = setup({ quantity: 5 });
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;

    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));
    const again = await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));
    expect(again.status).toBe(409);
    expect(itemsOf(ldb, 'char-a')).toHaveLength(1);             // not granted twice
  });

  it('refuses approval from a player', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    expect((await asAliyr(request(app).post(`/api/treasury/requests/${reqId}/approve`))).status).toBe(401);
    expect(itemsOf(ldb, 'char-a')).toHaveLength(0);
  });

  it('keeps an unidentified item redacted when approved', async () => {
    const { app, ldb } = setup({ descVisible: false });
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));

    const items = itemsOf(ldb, 'char-a');
    expect(items[0].unidentified).toBe(true);
    expect(items[0].name).not.toBe('Flametongue Longsword');
    expect(items[0].notes || '').toBe('');
  });

  it('cannot be requested again once the player already has it', async () => {
    const { app, ldb } = setup({ quantity: 5 });
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));

    const again = await select(app, asAliyr, 'char-a');
    expect(again.status).toBe(400);
  });
});

describe('free loot — requests follow the item', () => {
  it('declines pending requests when the item leaves the loot pool', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    await asDM(request(app).put('/api/treasury/item-1')).send({ mode: 'hidden' });
    expect(ldb.listTreasuryRequests('pending')).toHaveLength(0);
  });

  it('declines pending requests when the item is deleted', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    await asDM(request(app).delete('/api/treasury/item-1'));
    expect(ldb.listTreasuryRequests('pending')).toHaveLength(0);
  });

  it('drops a request whose character is gone instead of showing a ghost', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    ldb.deleteCharacter('char-a');

    const seen = await request(app).get('/api/treasury');
    expect(seen.body.loot[0].requesters).toEqual([]);
  });

  it('tells everyone to refresh when a request is made or decided', async () => {
    const { app, ldb, broadcasts } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));

    const treasury = broadcasts.filter(b => b.channel === 'treasury').map(b => b.payload.action);
    expect(treasury).toContain('requested');
    expect(treasury).toContain('approved');
    // The approved player's own sheet is told to reload so the item appears.
    expect(broadcasts.some(b => b.channel === 'characters' && b.payload.id === 'char-a')).toBe(true);
  });
});
