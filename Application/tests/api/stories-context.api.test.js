// Written by Irmak Hakman — 2026-09-26 18:05

/**
 * The story routes under the real per-request campaign context.
 *
 * tests/helpers/test-app.js hands routes an sdb that resolves the campaign from
 * a plain variable, so it cannot see a handler losing its AsyncLocalStorage
 * context. Production can: the video upload's WriteStream 'finish' callback ran
 * outside the request's store, so touching sdb there threw "No campaign in
 * context" — uncaught, which took the whole server down (v238).
 *
 * This file mounts the route exactly as server.js does: the real sdb proxy from
 * lib/request-context.js, and a middleware that runs each request inside
 * requestContext.run().
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { requestContext, sdb } from '../../lib/request-context.js';
import { openStoriesDb } from '../../db/storiesdb.js';
import registerStories from '../../server/routes/stories.js';

function makeContextApp() {
  const storyImagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-media-'));
  const store = openStoriesDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    requestContext.run({ campaignId: 'c1', campaign: { id: 'c1' }, data: { sdb: store } }, next);
  });
  registerStories(app, {
    sdb, ldb: null, path, fs, crypto,
    __dirname: path.resolve('.'),
    sessionAuth: () => true,
    STORY_IMAGES_DIR: storyImagesDir,
  });
  return { app, storyImagesDir };
}

// A real upload arrives over many socket reads, so the request stream's events —
// and the WriteStream 'finish' they lead to — fire from the connection, not from
// the handler. supertest sends the body in one go, which hides that; this sends
// it in pieces with pauses, the way a large upload arrives.
function slowUpload(app, urlPath, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const req = http.request({
        port: server.address().port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': body.length },
      }, res => {
        let text = '';
        res.on('data', c => { text += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(text || '{}') }); });
      });
      req.on('error', e => { server.close(); reject(e); });
      const pieces = [body.subarray(0, 16), body.subarray(16, 128), body.subarray(128)];
      let i = 0;
      const next = () => {
        if (i < pieces.length) { req.write(pieces[i++]); setTimeout(next, 30); }
        else req.end();
      };
      next();
    });
  });
}

const fakeMp4 = () =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(256, 7)]);

describe('/api/stories — video upload inside the campaign context', () => {
  it('records the video once the file is written, without losing the campaign', async () => {
    const { app, storyImagesDir } = makeContextApp();
    const story = await request(app).post('/api/stories').send({ title: 'Context' });
    const seq   = await request(app).post(`/api/stories/${story.body.id}/sequences`).send({ caption: '' });

    const res = await slowUpload(app, `/api/stories/${story.body.id}/sequences/${seq.body.id}/video`, fakeMp4());
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(storyImagesDir, story.body.id, `${seq.body.id}.mp4`))).toBe(true);

    const got = await request(app).get(`/api/stories/${story.body.id}`);
    expect(got.body.sequences[0].image_path).toBe(res.body.imagePath);
  });
});
