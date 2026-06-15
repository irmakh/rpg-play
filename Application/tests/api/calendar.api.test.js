/**
 * API integration tests for /api/calendar/events + /api/calendar/media.
 * Covers the journal visibility model (shared/private), author stamping,
 * edit/delete ownership, and media upload validation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const PW_A = 'alice-pw';
const PW_B = 'bob-pw';

function setup() {
  const { app, ldb, hashPassword } = makeApp();
  ldb.createCharacter('char-a', { name: 'Alice', passwordHash: hashPassword(PW_A) });
  ldb.createCharacter('char-b', { name: 'Bob',   passwordHash: hashPassword(PW_B) });
  return { app, ldb };
}

const asDM   = (a) => a.set('X-Master-Password', TEST_MASTER_PW);
const asA    = (a) => a.set('X-Character-Id', 'char-a').set('X-Character-Password', PW_A);
const asB    = (a) => a.set('X-Character-Id', 'char-b').set('X-Character-Password', PW_B);

const dayEvent = (over = {}) => ({ title: 'T', frYear: 1492, frMonth: 1, frDay: 5, frFestival: '', ...over });

describe('POST /api/calendar/events — authoring', () => {
  it('DM creates a DM event with no author', async () => {
    const { app, ldb } = setup();
    const res = await asDM(request(app).post('/api/calendar/events')).send(dayEvent({ isPublic: true }));
    expect(res.status).toBe(200);
    const ev = ldb.getCalendarEvent(res.body.id);
    expect(ev.authorCharId).toBe('');
    expect(ev.isPublic).toBe(true);
  });

  it('character creates a journal — author + eventType are forced', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/calendar/events'))
      .send(dayEvent({ shared: false, eventType: 'event' /* should be ignored */ }));
    expect(res.status).toBe(200);
    const ev = ldb.getCalendarEvent(res.body.id);
    expect(ev.authorCharId).toBe('char-a');
    expect(ev.authorName).toBe('Alice');
    expect(ev.eventType).toBe('journal');
    expect(ev.isPublic).toBe(false); // private
  });

  it('shared journal becomes public', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/calendar/events')).send(dayEvent({ shared: true }));
    expect(ldb.getCalendarEvent(res.body.id).isPublic).toBe(true);
  });

  it('rejects an unauthenticated write', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/calendar/events').send(dayEvent());
    expect(res.status).toBe(401);
  });

  it('sanitises media to /uploads descriptors only', async () => {
    const { app, ldb } = setup();
    const res = await asA(request(app).post('/api/calendar/events')).send(dayEvent({
      shared: true,
      media: [
        { type: 'image', url: '/uploads/calendar/x.jpg', thumb: '/uploads/calendar/x_t.jpg' },
        { type: 'image', url: 'http://evil/x.jpg' },        // dropped — not /uploads
        { type: 'script', url: '/uploads/calendar/y.jpg' }, // dropped — bad type
      ],
    }));
    const ev = ldb.getCalendarEvent(res.body.id);
    expect(ev.media).toHaveLength(1);
    expect(ev.media[0].url).toBe('/uploads/calendar/x.jpg');
  });
});

describe('GET /api/calendar/events — visibility', () => {
  async function seedMix(app) {
    await asDM(request(app).post('/api/calendar/events')).send(dayEvent({ title: 'DM public', isPublic: true }));
    await asDM(request(app).post('/api/calendar/events')).send(dayEvent({ title: 'DM only', isPublic: false }));
    await asA(request(app).post('/api/calendar/events')).send(dayEvent({ title: 'A shared',  shared: true }));
    await asA(request(app).post('/api/calendar/events')).send(dayEvent({ title: 'A private', shared: false }));
  }
  const titles = (res) => res.body.map(e => e.title).sort();

  it('DM sees everything', async () => {
    const { app } = setup();
    await seedMix(app);
    const res = await asDM(request(app).get('/api/calendar/events'));
    expect(titles(res)).toEqual(['A private', 'A shared', 'DM only', 'DM public']);
  });

  it('author sees public events + their own private journal', async () => {
    const { app } = setup();
    await seedMix(app);
    const res = await asA(request(app).get('/api/calendar/events'));
    expect(titles(res)).toEqual(['A private', 'A shared', 'DM public']);
  });

  it('other player sees shared but NOT another author\'s private journal or DM-only', async () => {
    const { app } = setup();
    await seedMix(app);
    const res = await asB(request(app).get('/api/calendar/events'));
    expect(titles(res)).toEqual(['A shared', 'DM public']);
  });

  it('anonymous viewer sees only public', async () => {
    const { app } = setup();
    await seedMix(app);
    const res = await request(app).get('/api/calendar/events');
    expect(titles(res)).toEqual(['A shared', 'DM public']);
  });
});

describe('PUT/DELETE /api/calendar/events/:id — ownership', () => {
  async function makeJournal(app) {
    const res = await asA(request(app).post('/api/calendar/events')).send(dayEvent({ shared: false }));
    return res.body.id;
  }

  it('author can edit own journal', async () => {
    const { app, ldb } = setup();
    const id = await makeJournal(app);
    const res = await asA(request(app).put(`/api/calendar/events/${id}`)).send(dayEvent({ title: 'Edited', shared: true }));
    expect(res.status).toBe(200);
    expect(ldb.getCalendarEvent(id).title).toBe('Edited');
    expect(ldb.getCalendarEvent(id).isPublic).toBe(true);
  });

  it('another player cannot edit', async () => {
    const { app, ldb } = setup();
    const id = await makeJournal(app);
    const res = await asB(request(app).put(`/api/calendar/events/${id}`)).send(dayEvent({ title: 'Hacked' }));
    expect(res.status).toBe(403);
    expect(ldb.getCalendarEvent(id).title).toBe('T');
  });

  it('DM can edit any journal but keeps the original author', async () => {
    const { app, ldb } = setup();
    const id = await makeJournal(app);
    const res = await asDM(request(app).put(`/api/calendar/events/${id}`)).send(dayEvent({ title: 'DM edit' }));
    expect(res.status).toBe(200);
    expect(ldb.getCalendarEvent(id).authorCharId).toBe('char-a');
  });

  it('another player cannot delete', async () => {
    const { app, ldb } = setup();
    const id = await makeJournal(app);
    const res = await asB(request(app).delete(`/api/calendar/events/${id}`));
    expect(res.status).toBe(403);
    expect(ldb.getCalendarEvent(id)).not.toBeNull();
  });

  it('author can delete own journal', async () => {
    const { app, ldb } = setup();
    const id = await makeJournal(app);
    const res = await asA(request(app).delete(`/api/calendar/events/${id}`));
    expect(res.status).toBe(200);
    expect(ldb.getCalendarEvent(id)).toBeNull();
  });
});

describe('POST /api/calendar/media — upload', () => {
  const imgDataUrl = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
  const mp3DataUrl = 'data:audio/mpeg;base64,' + Buffer.from('fakemp3').toString('base64');

  it('character can upload an image and gets image descriptor', async () => {
    const { app } = setup();
    const res = await asA(request(app).post('/api/calendar/media')).send({ dataUrl: imgDataUrl });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('image');
    expect(res.body.url).toMatch(/^\/uploads\/calendar\//);
    expect(res.body.thumb).toMatch(/^\/uploads\/calendar\//);
  });

  it('accepts audio (music) via SHARED_MEDIA_MIME', async () => {
    const { app } = setup();
    const res = await asA(request(app).post('/api/calendar/media')).send({ dataUrl: mp3DataUrl });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('audio');
  });

  it('rejects unsupported mime', async () => {
    const { app } = setup();
    const res = await asA(request(app).post('/api/calendar/media'))
      .send({ dataUrl: 'data:application/x-msdownload;base64,' + Buffer.from('x').toString('base64') });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated upload', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/calendar/media').send({ dataUrl: imgDataUrl });
    expect(res.status).toBe(401);
  });
});
