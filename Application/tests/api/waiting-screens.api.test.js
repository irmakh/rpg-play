/**
 * API integration tests for waiting screens.
 *
 * A waiting screen parks the table on a full-bleed image between scenes. The
 * point of the feature is what the PLAYERS stop receiving: while one is
 * showing, the map and everyone else's tokens are withheld on the server, not
 * merely covered in the browser, so a player cannot read the tactical picture
 * out of the network payload while the DM rearranges it.
 *
 * What a player must still get is their own token — the character panel beside
 * the image is built from it, and being able to keep rolling during a break is
 * the whole point of leaving that panel up.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asChar = (a, id) => a.set('X-Character-Id', id);

function setup() {
  const { app, ldb, broadcasts, parkedCampaigns } = makeApp();

  ldb.createCharacter('char-gerion', { name: 'Gerion', dataJson: '{}', charType: 'pc', passwordHash: '' });
  ldb.createCharacter('char-aliyr',  { name: 'Aliyr',  dataJson: '{}', charType: 'pc', passwordHash: '' });

  ldb.createTableToken('tok-gerion', { name: 'Gerion', type: 'character', linkedId: 'char-gerion', x: 1, y: 1 });
  ldb.createTableToken('tok-aliyr',  { name: 'Aliyr',  type: 'character', linkedId: 'char-aliyr',  x: 2, y: 2 });
  ldb.createTableToken('tok-goblin', { name: 'Goblin', type: 'monster',   linkedId: 'mon-1',       x: 5, y: 5 });

  ldb.updateTableState({ hasMap: true, mapWidth: 1000, mapHeight: 800, fogRegions: '[{"id":"f1"}]' });

  return { app, ldb, broadcasts, parkedCampaigns };
}

const makeScreen = async (app, name = 'ZZ Tavern') => {
  const res = await asDM(request(app).post('/api/waiting-screens')).send({ name });
  return res.body.id;
};
const park   = (app, id)  => asDM(request(app).post('/api/table/waiting-screen')).send({ id });
const unpark = (app)      => asDM(request(app).post('/api/table/waiting-screen')).send({ id: '' });

describe('waiting screens — the DM library', () => {
  it('creates, lists, renames and deletes', async () => {
    const { app } = setup();
    const id = await makeScreen(app, 'ZZ Tavern');
    expect(id).toBeTruthy();

    let list = await asDM(request(app).get('/api/waiting-screens'));
    expect(list.body.screens).toHaveLength(1);
    expect(list.body.screens[0].name).toBe('ZZ Tavern');
    expect(list.body.activeId).toBe('');

    await asDM(request(app).put(`/api/waiting-screens/${id}`)).send({ name: 'ZZ Docks', caption: 'Back in 10' });
    list = await asDM(request(app).get('/api/waiting-screens'));
    expect(list.body.screens[0].name).toBe('ZZ Docks');
    expect(list.body.screens[0].caption).toBe('Back in 10');

    expect((await asDM(request(app).delete(`/api/waiting-screens/${id}`))).status).toBe(200);
    list = await asDM(request(app).get('/api/waiting-screens'));
    expect(list.body.screens).toEqual([]);
  });

  it('is DM-only to manage', async () => {
    const { app } = setup();
    const id = await makeScreen(app);
    expect((await request(app).get('/api/waiting-screens')).status).toBe(401);
    expect((await request(app).post('/api/waiting-screens').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/table/waiting-screen').send({ id })).status).toBe(401);
    expect((await request(app).delete(`/api/waiting-screens/${id}`)).status).toBe(401);
  });

  it('deleting the screen the table is parked on un-parks it', async () => {
    const { app, parkedCampaigns } = setup();
    const id = await makeScreen(app);
    await park(app, id);
    expect(parkedCampaigns.size).toBe(1);

    const res = await asDM(request(app).delete(`/api/waiting-screens/${id}`));
    expect(res.body.closed).toBe(true);
    expect(parkedCampaigns.size).toBe(0);
    // Players must not be left held on an image that no longer exists.
    expect((await request(app).get('/api/table/waiting-screen')).body.active).toBeNull();
  });

  it('refuses to park on a screen that does not exist', async () => {
    const { app } = setup();
    expect((await park(app, 'no-such-screen')).status).toBe(404);
  });
});

describe('waiting screens — what a player can see', () => {
  it('gives everyone the whole table when nothing is parked', async () => {
    const { app } = setup();
    const res = await asChar(request(app).get('/api/table'), 'char-gerion');
    expect(res.body.state.hasMap).toBeTruthy();
    expect(res.body.tokens).toHaveLength(3);
  });

  it('withholds the map and everyone else’s tokens from a player while parked', async () => {
    const { app } = setup();
    await park(app, await makeScreen(app));

    const res = await asChar(request(app).get('/api/table'), 'char-gerion');
    expect(res.status).toBe(200);
    // The map is gone — not merely flagged for the client to hide.
    expect(res.body.state.hasMap).toBeFalsy();
    expect(res.body.state.fogRegions).toEqual([]);
    // Only their own token, so the character panel still works.
    expect(res.body.tokens.map(t => t.id)).toEqual(['tok-gerion']);
  });

  it('gives each player only their own token, never another’s', async () => {
    const { app } = setup();
    await park(app, await makeScreen(app));

    const aliyr = await asChar(request(app).get('/api/table'), 'char-aliyr');
    expect(aliyr.body.tokens.map(t => t.id)).toEqual(['tok-aliyr']);
  });

  it('never leaks a monster token to a player while parked', async () => {
    const { app } = setup();
    await park(app, await makeScreen(app));

    const res = await asChar(request(app).get('/api/table'), 'char-gerion');
    expect(res.body.tokens.some(t => t.type === 'monster')).toBe(false);
  });

  it('gives a signed-out viewer nothing but the image', async () => {
    const { app } = setup();
    await park(app, await makeScreen(app));

    const res = await request(app).get('/api/table');
    expect(res.body.state.hasMap).toBeFalsy();
    expect(res.body.tokens).toEqual([]);
  });

  it('leaves the DM’s own view completely untouched', async () => {
    const { app } = setup();
    await park(app, await makeScreen(app));

    const res = await asDM(request(app).get('/api/table'));
    expect(res.body.state.hasMap).toBeTruthy();
    expect(res.body.state.fogRegions).toEqual([{ id: 'f1' }]);
    expect(res.body.tokens).toHaveLength(3);
  });

  it('gives the whole table back the moment the screen closes', async () => {
    const { app } = setup();
    const id = await makeScreen(app);
    await park(app, id);
    expect((await asChar(request(app).get('/api/table'), 'char-gerion')).body.tokens).toHaveLength(1);

    await unpark(app);
    const res = await asChar(request(app).get('/api/table'), 'char-gerion');
    expect(res.body.state.hasMap).toBeTruthy();
    expect(res.body.tokens).toHaveLength(3);
  });

  it('serves the active image to anyone, including a signed-out tab', async () => {
    const { app } = setup();
    const id = await makeScreen(app, 'ZZ Tavern');
    expect((await request(app).get('/api/table/waiting-screen')).body.active).toBeNull();

    await park(app, id);
    const res = await request(app).get('/api/table/waiting-screen');
    expect(res.body.active.id).toBe(id);
    expect(res.body.active.name).toBe('ZZ Tavern');
  });
});

describe('waiting screens — what a player stops being told', () => {
  it('sends table events to DM clients only while parked', async () => {
    const { app, broadcasts } = setup();
    await park(app, await makeScreen(app));
    broadcasts.length = 0;

    await asDM(request(app).put('/api/table/tokens/tok-goblin')).send({ x: 9, y: 9 });

    const table = broadcasts.filter(b => b.channel === 'table');
    expect(table.length).toBeGreaterThan(0);
    expect(table.every(b => b.dmOnly)).toBe(true);
  });

  it('sends table events to everyone again once it closes', async () => {
    const { app, broadcasts } = setup();
    const id = await makeScreen(app);
    await park(app, id);
    await unpark(app);
    broadcasts.length = 0;

    await asDM(request(app).put('/api/table/tokens/tok-goblin')).send({ x: 3, y: 3 });

    const table = broadcasts.filter(b => b.channel === 'table');
    expect(table.length).toBeGreaterThan(0);
    expect(table.every(b => b.dmOnly)).toBe(false);
  });

  it('announces opening and closing to everyone, not just the DM', async () => {
    const { app, broadcasts } = setup();
    const id = await makeScreen(app);

    broadcasts.length = 0;
    await park(app, id);
    let ws = broadcasts.filter(b => b.channel === 'waiting-screen');
    expect(ws).toHaveLength(1);
    expect(ws[0].dmOnly).toBe(false);
    expect(ws[0].payload.active.id).toBe(id);

    broadcasts.length = 0;
    await unpark(app);
    ws = broadcasts.filter(b => b.channel === 'waiting-screen');
    expect(ws).toHaveLength(1);
    expect(ws[0].dmOnly).toBe(false);
    expect(ws[0].payload.active).toBeNull();
  });
});
