// Written by Irmak Hakman — 2026-10-15 17:46
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Pictures that change while people are looking at them (v296).
 *
 * - A token keeps its own copy of its character's or monster's portrait URL, so
 *   a new portrait has to be pushed into every linked token and broadcast -
 *   otherwise the map shows the old one (or a broken image: replacing a
 *   portrait deletes the old files) until the token is placed again.
 * - A replaced picture must get a NEW URL. With the same URL a page that is
 *   already showing it keeps the cached copy.
 * - The DM's waiting-screens page in another window hears about every change
 *   to the list, not only which screen is showing.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const asDM = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function setup() {
  const ctx = makeApp();
  const { ldb } = ctx;
  ldb.createCharacter('char-gerion', { name: 'Gerion', dataJson: '{}', charType: 'pc', passwordHash: '' });
  ldb.createTableToken('tok-gerion', { name: 'Gerion', type: 'character', linkedId: 'char-gerion', x: 1, y: 1 });
  ldb.createTableToken('tok-gerion-2', { name: 'Gerion', type: 'character', linkedId: 'char-gerion', x: 3, y: 3 });
  return ctx;
}

const tokenUpdates = (broadcasts) =>
  broadcasts.filter(b => b.channel === 'table' && b.payload.action === 'token-updated');

describe('a character portrait reaches its tokens live', () => {
  it('a new portrait goes into every linked token and is broadcast', async () => {
    const { app, ldb, broadcasts } = setup();
    broadcasts.length = 0;
    const res = await asDM(request(app).post('/api/characters/char-gerion/media'))
      .send({ dataUrl: PNG, originalName: 'face.png', isPortrait: true });
    expect(res.status).toBe(200);

    const url = ldb.listMedia('char-gerion').find(m => m.isPortrait).dataUrl;
    expect(ldb.getTableToken('tok-gerion').portrait).toBe(url);
    expect(ldb.getTableToken('tok-gerion-2').portrait).toBe(url);
    const sent = tokenUpdates(broadcasts);
    expect(sent.map(b => b.payload.token.id).sort()).toEqual(['tok-gerion', 'tok-gerion-2']);
    expect(sent[0].payload.token.portrait).toBe(url);
  });

  it('choosing another picture as the portrait updates the tokens too', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'a.png', isPortrait: true });
    const second = await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'b.png' });
    const res = await asDM(request(app).put(`/api/characters/char-gerion/media/${second.body.id}/portrait`));
    expect(res.status).toBe(200);
    expect(ldb.getTableToken('tok-gerion').portrait).toBe(ldb.getMediaById(second.body.id).dataUrl);
  });

  it('deleting the portrait takes it off the tokens', async () => {
    const { app, ldb } = setup();
    const up = await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'a.png', isPortrait: true });
    await asDM(request(app).delete(`/api/characters/char-gerion/media/${up.body.id}`));
    expect(ldb.getTableToken('tok-gerion').portrait).toBeFalsy();
  });

  it('leaves a token alone that the DM gave its own picture', async () => {
    const { app, ldb } = setup();
    ldb.updateTableToken('tok-gerion-2', { portrait: '/uploads/tokens/own.jpg', customPortrait: 1 });
    await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'a.png', isPortrait: true });
    expect(ldb.getTableToken('tok-gerion-2').portrait).toBe('/uploads/tokens/own.jpg');
  });

  it('keeps a hidden token secret: only the DM and its owner hear about it', async () => {
    const { app, ldb, broadcasts } = setup();
    ldb.updateTableToken('tok-gerion', { visible: false });
    broadcasts.length = 0;
    await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'a.png', isPortrait: true });
    const hidden = tokenUpdates(broadcasts).find(b => b.payload.token.id === 'tok-gerion');
    expect(hidden.dmOnly).toBe(true);
    expect(hidden.opts.forOthers).toEqual({ action: 'token-removed', id: 'tok-gerion' });
  });

  it('a token whose own picture is removed goes back to the character portrait', async () => {
    const { app, ldb } = setup();
    await asDM(request(app).post('/api/characters/char-gerion/media')).send({ dataUrl: PNG, originalName: 'a.png', isPortrait: true });
    await asDM(request(app).post('/api/table/tokens/tok-gerion/portrait')).send({ dataUrl: PNG });
    expect(ldb.getTableToken('tok-gerion').customPortrait).toBeTruthy();
    await asDM(request(app).post('/api/table/tokens/tok-gerion/portrait')).send({ dataUrl: '' });
    expect(ldb.getTableToken('tok-gerion').portrait).toBe(ldb.listMedia('char-gerion').find(m => m.isPortrait).dataUrl);
  });
});

describe('a replaced picture gets a new URL', () => {
  it('a token\'s own picture', async () => {
    const { app } = setup();
    const a = await asDM(request(app).post('/api/table/tokens/tok-gerion/portrait')).send({ dataUrl: PNG });
    await new Promise(r => setTimeout(r, 2));
    const b = await asDM(request(app).post('/api/table/tokens/tok-gerion/portrait')).send({ dataUrl: PNG });
    expect(a.body.portrait).toBeTruthy();
    expect(b.body.portrait).not.toBe(a.body.portrait);
  });

  it('a waiting screen\'s image, and the players are sent the new one', async () => {
    const { app, broadcasts } = setup();
    const id = (await asDM(request(app).post('/api/waiting-screens')).send({ name: 'Tavern' })).body.id;
    const a = await asDM(request(app).post(`/api/waiting-screens/${id}/image`)).send({ dataUrl: PNG });
    await asDM(request(app).post('/api/table/waiting-screen')).send({ id });
    await new Promise(r => setTimeout(r, 2));
    broadcasts.length = 0;
    const b = await asDM(request(app).post(`/api/waiting-screens/${id}/image`)).send({ dataUrl: PNG });
    expect(b.body.imageUrl).not.toBe(a.body.imageUrl);
    const live = broadcasts.find(x => x.channel === 'waiting-screen');
    expect(live.payload.active.imageUrl).toBe(b.body.imageUrl);
    expect(live.dmOnly).toBe(false);
  });
});

describe('the DM\'s waiting-screens page follows changes made elsewhere', () => {
  it('create, rename, new image and delete each tell DM pages, and only them', async () => {
    const { app, broadcasts } = setup();
    const list = () => broadcasts.filter(b => b.channel === 'waiting-screens');
    broadcasts.length = 0;
    const id = (await asDM(request(app).post('/api/waiting-screens')).send({ name: 'Tavern' })).body.id;
    expect(list()).toHaveLength(1);
    await asDM(request(app).put(`/api/waiting-screens/${id}`)).send({ caption: 'Back soon' });
    expect(list()).toHaveLength(2);
    await asDM(request(app).post(`/api/waiting-screens/${id}/image`)).send({ dataUrl: PNG });
    expect(list()).toHaveLength(3);
    await asDM(request(app).delete(`/api/waiting-screens/${id}`));
    expect(list()).toHaveLength(4);
    expect(list().every(b => b.dmOnly)).toBe(true);
  });
});
