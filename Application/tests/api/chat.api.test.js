// Written by Irmak Hakman — 2026-09-26 16:50

/**
 * API integration tests for /api/chat — a campaign's history is its own.
 *
 * Chat lives in the campaign's database, reached through the request-scoped
 * ldb proxy, so two tables never see each other's messages. What no other
 * table may EVER see is a dmOnly roll: it is addressed to one campaign's DM,
 * and another campaign's DM authenticates just as successfully.
 *
 * These guard that boundary across every verb — read, delete and clear.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const AMN  = 'campaign-amn';
const WEST = 'campaign-waterdeep';

const asDM = (a, campaignId) =>
  a.set('X-Master-Password', TEST_MASTER_PW).set('X-Campaign-Id', campaignId);
const asPlayer = (a, campaignId) => a.set('X-Campaign-Id', campaignId);

const setup = () => makeApp();

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

describe('chat history is per campaign', () => {
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

  it('keeps a long history in one campaign out of another', async () => {
    const { app } = setup();
    await say(app, WEST, 'Aliyr', 'Waterdeep survives');

    for (let i = 0; i < 120; i++) await say(app, AMN, 'Gerion', `line ${i}`);

    const amn = await readAsPlayer(app, AMN);
    expect(amn.body).toHaveLength(120);

    // Waterdeep's single line is untouched by the flood next door.
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

// ── POST /api/chat/image ──────────────────────────────────────────────────────
// Needs a session since v233, and the server — not the caller — decides who the
// image is from. Before that this took a 10 MB image from anyone who could reach
// the server, wrote it to disk, logged it and broadcast it under any name asked
// for.
describe('POST /api/chat/image', () => {
  const PNG = 'data:image/png;base64,' + Buffer.from('not-really-a-png').toString('base64');

  it('refuses an image with no credential at all', async () => {
    const { app } = setup();
    const res = await asPlayer(request(app).post('/api/chat/image'), AMN)
      .send({ dataUrl: PNG, sender: 'Gerion' });
    expect(res.status).toBe(401);
    const log = await readAsPlayer(app, AMN);
    expect(log.body).toHaveLength(0);
  });

  it('lets the DM post, and as the token they name', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/chat/image'), AMN)
      .send({ dataUrl: PNG, sender: 'Goblin Boss' });
    expect(res.status).toBe(200);
    const log = await readAsPlayer(app, AMN);
    expect(log.body.map(e => e.sender)).toEqual(['Goblin Boss']);
  });

  it('stamps a character session with its own name, whatever sender it claims', async () => {
    const { app, ldbFor, hashPassword, captcha } = setup();
    // Seed into AMN's own database — the bare ldb proxy resolves to whatever
    // campaign the last request named, which is not this one.
    ldbFor(AMN).createCharacter('c1', { name: 'Gerion', charType: 'pc', passwordHash: hashPassword('secret') });

    // A real login, so the session carries the character's identity.
    const cap = await request(app).get('/api/auth/captcha').set('X-Campaign-Id', AMN);
    const login = await request(app).post('/api/auth/login').set('X-Campaign-Id', AMN).send({
      type: 'character', characterId: 'c1', password: 'secret',
      captchaId: cap.body.id, captchaAnswer: String(captcha._answerOf(cap.body.id)),
    });
    expect(login.status).toBe(200);

    const res = await request(app).post('/api/chat/image')
      .set('X-Campaign-Id', AMN)
      .set('X-Character-Password', login.body.token)
      .send({ dataUrl: PNG, sender: 'The Dungeon Master' });
    expect(res.status).toBe(200);

    const log = await readAsPlayer(app, AMN);
    expect(log.body.map(e => e.sender)).toEqual(['Gerion']);
  });
});

// ── Private messages ──────────────────────────────────────────────────────────
// A `to` on POST /api/chat makes a message private. The sender comes from the
// SESSION, so it needs a real login; the text is never broadcast, only an id;
// and the history and /api/chat/entry/:id show it to the two people named on
// it and to the DM — nobody else.
describe('private messages', () => {
  async function loginAs(app, captcha, characterId, password) {
    const cap = await request(app).get('/api/auth/captcha').set('X-Campaign-Id', AMN);
    const login = await request(app).post('/api/auth/login').set('X-Campaign-Id', AMN).send({
      type: 'character', characterId, password,
      captchaId: cap.body.id, captchaAnswer: String(captcha._answerOf(cap.body.id)),
    });
    expect(login.status).toBe(200);
    return login.body.token;
  }

  // Three players, each logged in: Gerion writes to Aliyr, Brenna is the third.
  async function table() {
    const made = setup();
    const { app, ldbFor, hashPassword, captcha } = made;
    const db = ldbFor(AMN);
    db.createCharacter('c1', { name: 'Gerion', charType: 'pc', passwordHash: hashPassword('pw1') });
    db.createCharacter('c2', { name: 'Aliyr',  charType: 'pc', passwordHash: hashPassword('pw2') });
    db.createCharacter('c3', { name: 'Brenna', charType: 'pc', passwordHash: hashPassword('pw3') });
    const tokens = {
      c1: await loginAs(app, captcha, 'c1', 'pw1'),
      c2: await loginAs(app, captcha, 'c2', 'pw2'),
      c3: await loginAs(app, captcha, 'c3', 'pw3'),
    };
    const as = (req, id) => req.set('X-Campaign-Id', AMN).set('X-Character-Password', tokens[id]);
    return { ...made, tokens, as };
  }

  const whisper = (t, from, to, message = 'Meet me by the well.') =>
    t.as(request(t.app).post('/api/chat'), from).send({ type: 'text', sender: 'Gerion', message, to });

  it('refuses a private message with no login', async () => {
    const t = await table();
    const res = await asPlayer(request(t.app).post('/api/chat'), AMN)
      .send({ type: 'text', sender: 'Gerion', message: 'psst', to: 'c2' });
    expect(res.status).toBe(401);
    expect((await readAsDM(t.app, AMN)).body).toHaveLength(0);
  });

  it('refuses a message addressed to yourself', async () => {
    const t = await table();
    const res = await whisper(t, 'c1', 'c1');
    expect(res.status).toBe(400);
  });

  it('refuses a recipient that does not exist', async () => {
    const t = await table();
    const res = await whisper(t, 'c1', 'nobody');
    expect(res.status).toBe(404);
  });

  it('stamps the sender from the session, whatever the body claims', async () => {
    const t = await table();
    const res = await t.as(request(t.app).post('/api/chat'), 'c1')
      .send({ type: 'text', sender: 'Gerion', message: 'hi', to: 'c2', fromId: 'c3' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ to: 'c2', fromId: 'c1', toName: 'Aliyr' });
  });

  it('names a character sender from the session, so a player cannot whisper as the DM', async () => {
    const t = await table();
    const res = await t.as(request(t.app).post('/api/chat'), 'c1')
      .send({ type: 'text', sender: 'DM', message: 'Trust me.', to: 'c2' });
    expect(res.status).toBe(200);
    expect(res.body.sender).toBe('Gerion');
  });

  it('refuses a roll addressed to someone', async () => {
    const t = await table();
    const res = await t.as(request(t.app).post('/api/chat'), 'c1')
      .send({ sender: 'Gerion', dice: '1d20', results: [5], modifier: 0, total: 5, to: 'c2' });
    expect(res.status).toBe(400);
    expect((await readAsDM(t.app, AMN)).body).toEqual([]);
  });

  it('broadcasts only an id, never the text', async () => {
    const t = await table();
    const res = await whisper(t, 'c1', 'c2', 'The password is swordfish.');
    const sent = t.broadcasts.filter(b => b.channel === 'chat' || b.channel === 'chat-pm');
    expect(sent).toEqual([expect.objectContaining({ channel: 'chat-pm', payload: { id: res.body.id } })]);
    expect(JSON.stringify(t.broadcasts)).not.toContain('swordfish');
    // v237: and the knock itself reaches only the two people on it and the DM.
    expect(sent[0].opts).toEqual({ to: ['c2', 'c1', 'dm'] });
  });

  it('shows the history to sender, recipient and DM, and hides it from a third player', async () => {
    const t = await table();
    await whisper(t, 'c1', 'c2', 'Private');
    await say(t.app, AMN, 'Brenna', 'Public');

    const read = id => t.as(request(t.app).get('/api/chat'), id);
    expect((await read('c1')).body.map(e => e.message)).toEqual(['Private', 'Public']);
    expect((await read('c2')).body.map(e => e.message)).toEqual(['Private', 'Public']);
    expect((await read('c3')).body.map(e => e.message)).toEqual(['Public']);
    expect((await readAsPlayer(t.app, AMN)).body.map(e => e.message)).toEqual(['Public']);
    // The DM reads players' notes to each other too — the table's own choice.
    expect((await readAsDM(t.app, AMN)).body.map(e => e.message)).toEqual(['Private', 'Public']);
  });

  it('answers /api/chat/entry/:id only for someone who may read it', async () => {
    const t = await table();
    const { body: { id } } = await whisper(t, 'c1', 'c2', 'For Aliyr');
    const entry = req => req.get(`/api/chat/entry/${id}`);

    expect((await t.as(entry(request(t.app)), 'c2')).body.message).toBe('For Aliyr');
    expect((await t.as(entry(request(t.app)), 'c1')).status).toBe(200);
    expect((await asDM(entry(request(t.app)), AMN)).status).toBe(200);
    // Not addressed to them is indistinguishable from not existing.
    expect((await t.as(entry(request(t.app)), 'c3')).status).toBe(404);
    expect((await asPlayer(entry(request(t.app)), AMN)).status).toBe(404);
  });

  it('delivers a message to the DM, and keeps it from other players', async () => {
    const t = await table();
    const res = await whisper(t, 'c1', 'dm', 'I steal the gem.');
    expect(res.body).toMatchObject({ to: 'dm', toName: 'DM' });

    expect((await readAsDM(t.app, AMN)).body.map(e => e.message)).toEqual(['I steal the gem.']);
    expect((await t.as(request(t.app).get('/api/chat'), 'c2')).body).toEqual([]);
  });

  it('lets the DM whisper to a player', async () => {
    const t = await table();
    const res = await asDM(request(t.app).post('/api/chat'), AMN)
      .send({ type: 'text', sender: 'DM', message: 'You hear a voice.', to: 'c3' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ to: 'c3', fromId: 'dm' });

    expect((await t.as(request(t.app).get('/api/chat'), 'c3')).body).toHaveLength(1);
    expect((await t.as(request(t.app).get('/api/chat'), 'c1')).body).toEqual([]);
  });

  it('leaves an ordinary message open to anyone, as before', async () => {
    const t = await table();
    const res = await say(t.app, AMN, 'Gerion', 'Hello all');
    expect(res.status).toBe(200);
    expect(res.body.to).toBeUndefined();
    expect(t.broadcasts.some(b => b.channel === 'chat' && b.payload.message === 'Hello all')).toBe(true);
  });
});

// ── HTML messages ─────────────────────────────────────────────────────────────
// v235: html:true is honoured only from a logged-in sender. Before, anyone could
// post markup that every page inserted raw — script in the DM's tab.
describe('HTML chat messages', () => {
  const card = '<strong>Fireball</strong><img src=x onerror=alert(1)>';

  it('keeps a stranger’s HTML as plain text', async () => {
    const { app } = setup();
    const res = await asPlayer(request(app).post('/api/chat'), AMN)
      .send({ type: 'text', sender: 'Anyone', message: card, html: true });
    expect(res.status).toBe(200);
    expect(res.body.html).toBeUndefined();
  });

  it('keeps the HTML flag for a logged-in sender', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/chat'), AMN)
      .send({ type: 'text', sender: 'DM', message: card, html: true });
    expect(res.body.html).toBe(true);
  });
});

// ── Who a chat event reaches (v237) ───────────────────────────────────────────
// The server knows who each live connection is now, so these are addressed on
// the server instead of being sent to everyone and hidden by the page.
describe('chat broadcast audience', () => {
  it('sends a dmOnly roll to DM connections only', async () => {
    const { app, broadcasts } = setup();
    await roll(app, AMN, 'DM', { dmOnly: true });
    const sent = broadcasts.filter(b => b.channel === 'chat');
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toEqual({ dmOnly: true });
  });

  it('sends an ordinary roll to everyone', async () => {
    const { app, broadcasts } = setup();
    await roll(app, AMN, 'Gerion');
    expect(broadcasts.find(b => b.channel === 'chat').opts).toEqual({});
  });

});
