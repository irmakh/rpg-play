// Written by Irmak Hakman — 2026-09-26 17:55

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
import fs from 'fs';
import path from 'path';
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

// ── Panel videos ──────────────────────────────────────────────────────────────
// A video goes up as the raw MP4 body (not base64 JSON), streams to a .part file
// and is renamed into place only when complete and recognisably an MP4.

// The smallest thing the route accepts as an MP4: a box whose type is 'ftyp'.
const fakeMp4 = (extra = 64) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(extra, 7)]);

async function panel(app) {
  const story = await asDM(request(app).post('/api/stories')).send({ title: 'Moving pictures' });
  const seq   = await asDM(request(app).post(`/api/stories/${story.body.id}/sequences`)).send({ caption: 'one' });
  return { storyId: story.body.id, seqId: seq.body.id };
}

const filesIn = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir) : [];

describe('/api/stories — panel video upload', () => {
  it('saves an MP4 and records it as the panel media', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    const body = fakeMp4(1000);

    const res = await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(body);
    expect(res.status).toBe(200);
    expect(res.body.imagePath).toBe(`/story-images/${storyId}/${seqId}.mp4`);

    const onDisk = path.join(storyImagesDir, storyId, `${seqId}.mp4`);
    expect(fs.readFileSync(onDisk).equals(body)).toBe(true);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([`${seqId}.mp4`]);   // no .part left

    const story = await asDM(request(app).get(`/api/stories/${storyId}`));
    expect(story.body.sequences[0].image_path).toBe(res.body.imagePath);
  });

  it('replaces an image the panel already had', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/image`))
      .send({ dataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([`${seqId}.png`]);

    const res = await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(fakeMp4());
    expect(res.status).toBe(200);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([`${seqId}.mp4`]);
  });

  it('refuses a body that is not labelled video/mp4', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    const res = await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/webm').send(fakeMp4());
    expect(res.status).toBe(415);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([]);
  });

  it('refuses a file that is labelled MP4 but is not one, and keeps the old media', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/image`))
      .send({ dataUrl: 'data:image/png;base64,aGVsbG8=' });

    const res = await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(Buffer.from('<html><script>alert(1)</script></html>'));
    expect(res.status).toBe(415);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([`${seqId}.png`]);

    const story = await asDM(request(app).get(`/api/stories/${storyId}`));
    expect(story.body.sequences[0].image_path).toMatch(/\.png$/);
  });

  it('refuses a video over the size limit and leaves nothing on disk', async () => {
    const { app, storyImagesDir } = makeApp({ maxStoryVideoBytes: 100 });
    const { storyId, seqId } = await panel(app);
    const res = await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(fakeMp4(500));
    expect(res.status).toBe(413);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([]);
  });

  it('refuses a video upload with no credential', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    const res = await anonymous(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(fakeMp4());
    expect(res.status).toBe(401);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([]);
  });

  it('deleting the panel deletes its video', async () => {
    const { app, storyImagesDir } = setup();
    const { storyId, seqId } = await panel(app);
    await asDM(request(app).post(`/api/stories/${storyId}/sequences/${seqId}/video`))
      .set('Content-Type', 'video/mp4').send(fakeMp4());
    const del = await asDM(request(app).delete(`/api/stories/${storyId}/sequences/${seqId}`));
    expect(del.status).toBe(200);
    expect(filesIn(path.join(storyImagesDir, storyId))).toEqual([]);
  });
});
