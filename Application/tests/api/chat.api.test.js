/**
 * API integration tests for /api/chat — the in-memory chat log is per campaign.
 *
 * Only the non-localdb providers use the in-memory log; localdb keeps chat in
 * the campaign's own database and was always isolated. The in-memory log was a
 * single shared array, so GET /api/chat handed one campaign another campaign's
 * history — including its dmOnly rolls, which no other table should ever see —
 * and a clear or a delete in one campaign reached into every other one.
 *
 * These run with dbProvider 'instantdb' precisely because that is the path the
 * bug lived on.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const AMN  = 'campaign-amn';
const WEST = 'campaign-waterdeep';

const asDM = (a, campaignId) =>
  a.set('X-Master-Password', TEST_MASTER_PW).set('X-Campaign-Id', campaignId);
const asPlayer = (a, campaignId) => a.set('X-Campaign-Id', campaignId);

const setup = () => makeApp({ dbProvider: 'instantdb' });

const say = (app, campaignId, sender, message) =>
  asPlayer(request(app).post('/api/chat'), campaignId)
    .send({ type: 'text', sender, message });

const roll = (app, campaignId, sender, extra = {}) =>
  asPlayer(request(app).post('/api/chat'), campaignId)
    .send({ sender, dice: '1d20', results: [17], modifier: 2, total: 19, ...extra });

const readAsPlayer = (app, campaignId) =>
  asPlayer(request(app).get('/api/chat'), campaignId);

const readAsDM = (app, campaignId) =>
  asDM(request(app).get('/api/chat'), campaignId);

describe('in-memory chat log is per campaign', () => {
  it('starts empty in a campaign that has never said anything', async () => {
    const { app } = setup();
    const res = await readAsPlayer(app, AMN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not leak one campaign’s messages into another campaign', async () => {
    const { app } = setup();
    await say(app, AMN, 'Gerion', 'The gate is barred.');

    const west = await readAsPlayer(app, WEST);
    expect(west.body).toEqual([]);

    const amn = await readAsPlayer(app, AMN);
    expect(amn.body).toHaveLength(1);
    expect(amn.body[0].message).toBe('The gate is barred.');
  });

  it('keeps two campaigns’ histories separate when both are talking', async () => {
    const { app } = setup();
    await say(app, AMN,  'Gerion', 'Amn one');
    await say(app, WEST, 'Aliyr',  'Waterdeep one');
    await say(app, AMN,  'Gerion', 'Amn two');

    const amn  = await readAsPlayer(app, AMN);
    const west = await readAsPlayer(app, WEST);

    expect(amn.body.map(e => e.message)).toEqual(['Amn one', 'Amn two']);
    expect(west.body.map(e => e.message)).toEqual(['Waterdeep one']);
  });

  it('never shows a dmOnly roll to another campaign’s DM', async () => {
    const { app } = setup();
    await roll(app, AMN, 'DM', { dmOnly: true, label: 'Secret ambush check' });

    // The DM of Waterdeep authenticates fine — they are just a different table.
    const west = await readAsDM(app, WEST);
    expect(west.body).toEqual([]);

    // Their own DM still sees it.
    const amn = await readAsDM(app, AMN);
    expect(amn.body).toHaveLength(1);
    expect(amn.body[0].dmOnly).toBe(true);
  });

  it('still hides a dmOnly roll from a player in its own campaign', async () => {
    const { app } = setup();
    await roll(app, AMN, 'DM', { dmOnly: true });
    await say(app, AMN, 'Gerion', 'Anything out there?');

    const asAPlayer = await readAsPlayer(app, AMN);
    expect(asAPlayer.body.map(e => e.message)).toEqual(['Anything out there?']);
  });

  it('deletes a message only from the campaign it belongs to', async () => {
    const { app } = setup();
    const posted = await say(app, AMN, 'Gerion', 'Delete me.');
    await say(app, WEST, 'Aliyr', 'Keep me.');

    // The same id, aimed at the wrong campaign, must find nothing.
    const stray = await asDM(request(app).delete(`/api/chat/${posted.body.id}`), WEST);
    expect(stray.status).toBe(200);
    expect((await readAsPlayer(app, AMN)).body).toHaveLength(1);

    const real = await asDM(request(app).delete(`/api/chat/${posted.body.id}`), AMN);
    expect(real.status).toBe(200);
    expect((await readAsPlayer(app, AMN)).body).toEqual([]);
    expect((await readAsPlayer(app, WEST)).body).toHaveLength(1);
  });

  it('clears only the campaign whose DM asked', async () => {
    const { app } = setup();
    await say(app, AMN,  'Gerion', 'Amn history');
    await say(app, WEST, 'Aliyr',  'Waterdeep history');

    const res = await asDM(request(app).post('/api/chat/clear'), WEST).send({});
    expect(res.status).toBe(200);

    expect((await readAsPlayer(app, WEST)).body).toEqual([]);
    expect((await readAsPlayer(app, AMN)).body).toHaveLength(1);
  });

  it('trims to CHAT_MAX per campaign, not across all of them', async () => {
    const { app } = setup();
    await say(app, WEST, 'Aliyr', 'Waterdeep survives');

    // 120 lines in Amn is well past the 100-entry cap.
    for (let i = 0; i < 120; i++) await say(app, AMN, 'Gerion', `line ${i}`);

    const amn = await readAsPlayer(app, AMN);
    expect(amn.body).toHaveLength(100);
    expect(amn.body[0].message).toBe('line 20');

    // Waterdeep's single line was never at risk of being shifted out.
    const west = await readAsPlayer(app, WEST);
    expect(west.body.map(e => e.message)).toEqual(['Waterdeep survives']);
  });

  it('behaves like a single-campaign install when no campaign is named', async () => {
    const { app } = setup();
    await request(app).post('/api/chat').send({ type: 'text', sender: 'Gerion', message: 'No header' });

    const res = await request(app).get('/api/chat');
    expect(res.body.map(e => e.message)).toEqual(['No header']);
  });
});
