/**
 * API integration tests for notifications.
 *
 * The rule that matters most: a delivery belongs to exactly one viewer. A
 * player must never be able to read, mark or clear something addressed to
 * somebody else, and every handler resolves the viewer from the credentials
 * rather than from anything in the request body.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';

function setup() {
  const { app, ldb, hashPassword, broadcasts } = makeApp();
  ldb.createCharacter('char-a', {
    name: 'Aliyr', passwordHash: hashPassword(PW_A), dataJson: JSON.stringify({ name: 'Aliyr' }),
  });
  ldb.createCharacter('char-b', {
    name: 'Gerion', passwordHash: hashPassword(PW_B), dataJson: JSON.stringify({ name: 'Gerion' }),
  });
  ldb.createTreasuryItem('item-1', {
    name: 'Sunblade', mode: 'loot', quantity: 1, descVisible: true, itemType: 'weapon',
  });
  return { app, ldb, broadcasts };
}

const asDM     = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asAliyr  = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asGerion = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);

const inbox = (app, who) => who(request(app).get('/api/notifications'));
const select = (app, who, charId) =>
  who(request(app).post('/api/treasury/request')).send({ charId, items: [{ id: 'item-1' }] });

describe('notifications — addressing', () => {
  it('delivers to one character without touching anyone else', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'Just for Aliyr' });
    ldb.addNotificationRecipient('r1', 'n1', 'char-a');

    const mine = await inbox(app, asAliyr);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map(i => i.title)).toEqual(['Just for Aliyr']);
    expect(mine.body.unread).toBe(1);

    expect((await inbox(app, asGerion)).body.items).toEqual([]);
    expect((await inbox(app, asDM)).body.items).toEqual([]);
  });

  it('refuses a caller who proves nothing', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    // A character id alone is not proof when that character has a password.
    expect((await request(app).get('/api/notifications').set('X-Character-Id', 'char-a')).status).toBe(401);
  });

  it('gives the DM their own inbox, separate from the players', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'For the DM' });
    ldb.addNotificationRecipient('r1', 'n1', 'dm');
    expect((await inbox(app, asDM)).body.items.map(i => i.title)).toEqual(['For the DM']);
    expect((await inbox(app, asAliyr)).body.items).toEqual([]);
  });
});

describe('notifications — read state', () => {
  it('marks one as seen and drops the unread count', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'One' });
    ldb.addNotificationRecipient('r1', 'n1', 'char-a');
    ldb.createNotification('n2', { kind: 'test', title: 'Two' });
    ldb.addNotificationRecipient('r2', 'n2', 'char-a');

    const res = await asAliyr(request(app).post('/api/notifications/r1/seen'));
    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(1);

    const after = await inbox(app, asAliyr);
    expect(after.body.items.find(i => i.rowId === 'r1').seen).toBe(true);
    expect(after.body.items.find(i => i.rowId === 'r2').seen).toBe(false);
  });

  it('cannot mark somebody else\'s delivery as seen', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'Aliyr only' });
    ldb.addNotificationRecipient('r1', 'n1', 'char-a');

    // Gerion knows the row id and asks anyway; the handler scopes to the caller.
    await asGerion(request(app).post('/api/notifications/r1/seen'));
    expect((await inbox(app, asAliyr)).body.unread).toBe(1);
  });

  it('marks everything read at once, for that viewer only', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'Shared' });
    ldb.addNotificationRecipient('r1', 'n1', 'char-a');
    ldb.addNotificationRecipient('r2', 'n1', 'char-b');

    await asAliyr(request(app).post('/api/notifications/seen-all'));
    expect((await inbox(app, asAliyr)).body.unread).toBe(0);
    expect((await inbox(app, asGerion)).body.unread).toBe(1);
  });

  it('clears my copies without destroying anyone else\'s', async () => {
    const { app, ldb } = setup();
    ldb.createNotification('n1', { kind: 'test', title: 'Shared' });
    ldb.addNotificationRecipient('r1', 'n1', 'char-a');
    ldb.addNotificationRecipient('r2', 'n1', 'char-b');

    await asAliyr(request(app).delete('/api/notifications'));
    expect((await inbox(app, asAliyr)).body.items).toEqual([]);
    expect((await inbox(app, asGerion)).body.items.map(i => i.title)).toEqual(['Shared']);
  });
});

describe('notifications — emitted by the events themselves', () => {
  it('tells the DM when a player asks for loot, and nobody else', async () => {
    const { app } = setup();
    await select(app, asAliyr, 'char-a');

    const dm = await inbox(app, asDM);
    expect(dm.body.items).toHaveLength(1);
    expect(dm.body.items[0]).toMatchObject({ kind: 'loot-requested', priority: 'alert' });
    expect(dm.body.items[0].title).toContain('Aliyr');
    expect(dm.body.items[0].data.href).toBe('/treasury.html');

    // The player who asked does not need telling about their own action.
    expect((await inbox(app, asAliyr)).body.items).toEqual([]);
  });

  it('tells the player when the DM hands the item over', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));

    const mine = await inbox(app, asAliyr);
    const granted = mine.body.items.find(i => i.kind === 'loot-granted');
    expect(granted).toBeTruthy();
    expect(granted.title).toContain('Sunblade');
    expect(granted.priority).toBe('alert');
  });

  it('tells the player who was passed over, naming the winner', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    await select(app, asGerion, 'char-b');
    const mine = ldb.listTreasuryRequests('pending').find(r => r.charId === 'char-a');
    await asDM(request(app).post(`/api/treasury/requests/${mine.id}/approve`));

    const loser = await inbox(app, asGerion);
    const declined = loser.body.items.find(i => i.kind === 'loot-declined');
    expect(declined).toBeTruthy();
    expect(declined.body).toContain('Aliyr');
    // …and the winner is told they got it, not that they lost it.
    expect((await inbox(app, asAliyr)).body.items.some(i => i.kind === 'loot-declined')).toBe(false);
  });

  it('tells the player when the DM declines them outright', async () => {
    const { app, ldb } = setup();
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/decline`));
    expect((await inbox(app, asAliyr)).body.items.some(i => i.kind === 'loot-declined')).toBe(true);
  });

  it('withholds the name of an unidentified item', async () => {
    const { app, ldb } = setup();
    ldb.updateTreasuryItem('item-1', { descVisible: 0 });
    await select(app, asAliyr, 'char-a');
    const reqId = ldb.listTreasuryRequests('pending')[0].id;
    await asDM(request(app).post(`/api/treasury/requests/${reqId}/approve`));

    const granted = (await inbox(app, asAliyr)).body.items.find(i => i.kind === 'loot-granted');
    expect(granted.title).not.toContain('Sunblade');
    expect(granted.title).toContain('unidentified');
    // The DM's own copy must not leak it either.
    const dmItem = (await inbox(app, asDM)).body.items.find(i => i.kind === 'loot-requested');
    expect(JSON.stringify(dmItem)).not.toContain('Sunblade');
  });

  it('tells only the character whose turn it is', async () => {
    const { app, ldb } = setup();
    ldb.createInitEntry('e1', { name: 'Aliyr', roll: 20, charId: 'char-a' });
    ldb.createInitEntry('e2', { name: 'Goblin', roll: 10, monsterId: 'm1' });
    await asDM(request(app).post('/api/initiative/start'));

    const mine = await inbox(app, asAliyr);
    expect(mine.body.items.some(i => i.kind === 'your-turn')).toBe(true);
    // Combat starting is announced to every player; the turn is not.
    expect((await inbox(app, asGerion)).body.items.map(i => i.kind)).toEqual(['combat-started']);

    // A monster's turn belongs to the DM, who is watching the tracker anyway.
    await asDM(request(app).post('/api/initiative/next'));
    const after = await inbox(app, asAliyr);
    expect(after.body.items.filter(i => i.kind === 'your-turn')).toHaveLength(1);
  });

  it('puts the recipient list on the wire so clients can filter', async () => {
    const { app, broadcasts } = setup();
    await select(app, asAliyr, 'char-a');
    const sent = broadcasts.filter(b => b.channel === 'notification');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.recipients).toEqual(['dm']);
    expect(sent[0].payload.priority).toBe('alert');
  });
});

describe('notifications — housekeeping', () => {
  it('keeps the table bounded and drops orphaned deliveries', async () => {
    const { app, ldb } = setup();
    // One more than the cap, oldest first.
    for (let i = 0; i < 305; i++) {
      const id = 'n' + String(i).padStart(4, '0');
      ldb.createNotification(id, { kind: 'test', title: 'n' + i, createdAt: new Date(Date.now() + i).toISOString() });
      ldb.addNotificationRecipient('r' + i, id, 'char-a');
    }
    ldb.pruneNotifications(300);

    const rows = ldb.listNotificationsFor('char-a', 200);
    expect(rows.length).toBeLessThanOrEqual(200);
    // The newest survived and the oldest did not.
    expect(rows[0].title).toBe('n304');
    const all = await inbox(app, asAliyr);
    expect(all.body.items.every(i => i.title !== 'n0')).toBe(true);
  });
});
