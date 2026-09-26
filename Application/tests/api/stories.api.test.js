// Written by Irmak Hakman — 2026-09-26 15:10

/**
 * API integration tests for /api/stories — the login it never had.
 *
 * Until v233 not one of these twelve endpoints checked anything. That was not
 * caught by the session gate either: lib/security-middleware.js validates a
 * credential only when one is SENT, so a request with no header at all reached
 * the route unchallenged and could create, rewrite or delete any story, and
 * upload or delete its panel images.
 *
 * The gate is on the /api/stories prefix rather than per route, so a new
 * endpoint is covered the moment it is written — these tests speak for that
 * whole prefix, not just the handlers named below.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const setup = () => makeApp();

const asDM     = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const anonymous = (a) => a;

describe('/api/stories — the prefix gate', () => {
  it('refuses a read with no credential', async () => {
    const { app } = setup();
    const res = await anonymous(request(app).get('/api/stories'));
    expect(res.status).toBe(401);
  });

  it('refuses a create with no credential, and writes nothing', async () => {
    const { app } = setup();
    const res = await anonymous(request(app).post('/api/stories')).send({ title: 'Trespass' });
    expect(res.status).toBe(401);

    // Prove it never reached the database, rather than trusting the status.
    const after = await asDM(request(app).get('/api/stories'));
    expect(after.status).toBe(200);
    expect(after.body).toEqual([]);
  });

  it('refuses a delete with no credential', async () => {
    const { app } = setup();
    const made = await asDM(request(app).post('/api/stories')).send({ title: 'Keep me' });
    expect(made.status).toBe(200);

    const res = await anonymous(request(app).delete(`/api/stories/${made.body.id}`));
    expect(res.status).toBe(401);

    const still = await asDM(request(app).get('/api/stories'));
    expect(still.body.map(s => s.story_name ?? s.title)).toHaveLength(1);
  });

  it('refuses an image upload with no credential', async () => {
    const { app } = setup();
    const made = await asDM(request(app).post('/api/stories')).send({ title: 'Panels' });
    const seq  = await asDM(request(app).post(`/api/stories/${made.body.id}/sequences`)).send({ caption: 'one' });
    expect(seq.status).toBe(200);

    const res = await anonymous(request(app).post(`/api/stories/${made.body.id}/sequences/${seq.body.id}/image`))
      .send({ dataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(res.status).toBe(401);
  });

  it('refuses the character-portraits lookup with no credential', async () => {
    const { app } = setup();
    const res = await anonymous(request(app).get('/api/stories/character-portraits'));
    expect(res.status).toBe(401);
  });

  it('lets the DM through', async () => {
    const { app } = setup();
    const res = await asDM(request(app).post('/api/stories')).send({ title: 'Shadows over Emberfall' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });

  it('lets a logged-in player through — stories are not DM-only', async () => {
    const { app, ldb, hashPassword } = setup();
    ldb.createCharacter('c1', { name: 'Gerion', charType: 'pc', passwordHash: hashPassword('secret') });

    const res = await request(app).get('/api/stories').set('X-Character-Password', 'secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
