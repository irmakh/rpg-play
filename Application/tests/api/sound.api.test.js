/**
 * API integration tests for /api/sound — playback is per campaign.
 *
 * Two campaigns running at the same time are two separate sessions: each has
 * its own track, position, loop mode and volume, and neither can hear or
 * disturb the other. Before this, one shared object meant whichever campaign
 * pressed play last decided what every other campaign's client heard on load.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

const AMN  = 'campaign-amn';
const WEST = 'campaign-waterdeep';

// A campaign's DM: the master password plus the campaign the request is for.
const asDM = (a, campaignId) =>
  a.set('X-Master-Password', TEST_MASTER_PW).set('X-Campaign-Id', campaignId);
const asPlayer = (a, campaignId) => a.set('X-Campaign-Id', campaignId);

function setup() {
  const { app, ldb, broadcasts } = makeApp();

  // Two playlists with distinct tracks. The databases are genuinely separate in
  // production (one SQLite file per campaign); here one store holds both, which
  // only makes the playback-state assertions stricter.
  ldb.createSoundFile('snd-tavern', { name: 'Tavern Brawl', url: '/uploads/sounds/tavern.mp3' });
  ldb.createSoundFile('snd-chase',  { name: 'Chase',        url: '/uploads/sounds/chase.mp3' });
  ldb.createSoundFile('snd-dirge',  { name: 'Dirge',        url: '/uploads/sounds/dirge.mp3' });
  ldb.createPlaylist('pl-amn',  { name: 'Amn',       sounds: ['snd-tavern', 'snd-chase'] });
  ldb.createPlaylist('pl-west', { name: 'Waterdeep', sounds: ['snd-dirge'] });

  return { app, ldb, broadcasts };
}

const play = (app, campaignId, playlistId, trackIndex = 0, extra = {}) =>
  asDM(request(app).post('/api/sound/control'), campaignId)
    .send({ action: 'play', playlistId, trackIndex, ...extra });

const state = (app, campaignId) =>
  asPlayer(request(app).get('/api/sound/state'), campaignId);

describe('sound playback state is per campaign', () => {
  it('starts silent in a campaign that has never played anything', async () => {
    const { app } = setup();
    const res = await state(app, AMN);
    expect(res.status).toBe(200);
    expect(res.body.isPlaying).toBe(false);
    expect(res.body.url).toBe(null);
    expect(res.body.name).toBe(null);
  });

  it('does not leak one campaign’s track into another campaign', async () => {
    const { app } = setup();
    await play(app, AMN, 'pl-amn', 0);

    // The whole point: Waterdeep must still be silent.
    const west = await state(app, WEST);
    expect(west.body.isPlaying).toBe(false);
    expect(west.body.name).toBe(null);

    const amn = await state(app, AMN);
    expect(amn.body.isPlaying).toBe(true);
    expect(amn.body.name).toBe('Tavern Brawl');
  });

  it('lets two campaigns play different tracks at the same time', async () => {
    const { app } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);

    const amn  = await state(app, AMN);
    const west = await state(app, WEST);

    expect(amn.body.name).toBe('Tavern Brawl');
    expect(west.body.name).toBe('Dirge');
    expect(amn.body.isPlaying).toBe(true);
    expect(west.body.isPlaying).toBe(true);
    // Starting the second one must not have disturbed the first.
    expect(amn.body.playlistId).toBe('pl-amn');
    expect(west.body.playlistId).toBe('pl-west');
  });

  it('stops only the campaign that asked to stop', async () => {
    const { app } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);

    await asDM(request(app).post('/api/sound/control'), WEST).send({ action: 'stop' });

    expect((await state(app, WEST)).body.isPlaying).toBe(false);
    const amn = await state(app, AMN);
    expect(amn.body.isPlaying).toBe(true);
    expect(amn.body.name).toBe('Tavern Brawl');
  });

  it('pauses one campaign without pausing the other', async () => {
    const { app } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);

    await asDM(request(app).post('/api/sound/control'), AMN).send({ action: 'pause', position: 12.5 });

    const amn = await state(app, AMN);
    expect(amn.body.isPlaying).toBe(false);
    expect(amn.body.currentPosition).toBeCloseTo(12.5, 3);
    expect(amn.body.name).toBe('Tavern Brawl');       // paused, not cleared

    expect((await state(app, WEST)).body.isPlaying).toBe(true);
  });

  it('advances the right campaign’s playlist on next', async () => {
    const { app } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);

    await asDM(request(app).post('/api/sound/control'), AMN).send({ action: 'next' });

    // Amn moves to its own second track; before this fix "next" read the shared
    // playlistId and could walk another campaign's list entirely.
    const amn = await state(app, AMN);
    expect(amn.body.trackIndex).toBe(1);
    expect(amn.body.name).toBe('Chase');

    const west = await state(app, WEST);
    expect(west.body.trackIndex).toBe(0);
    expect(west.body.name).toBe('Dirge');
  });

  it('keeps loop mode, seek position and volume separate', async () => {
    const { app } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);

    await asDM(request(app).post('/api/sound/control'), AMN).send({ action: 'loopMode', loopMode: 'playlist' });
    await asDM(request(app).post('/api/sound/control'), AMN).send({ action: 'volume', volume: 0.25 });
    await asDM(request(app).post('/api/sound/control'), WEST).send({ action: 'loopMode', loopMode: 'track' });
    await asDM(request(app).post('/api/sound/control'), WEST).send({ action: 'seek', position: 42 });

    const amn  = (await state(app, AMN)).body;
    const west = (await state(app, WEST)).body;

    expect(amn.loopMode).toBe('playlist');
    expect(amn.volume).toBe(0.25);
    expect(west.loopMode).toBe('track');
    expect(west.volume).toBe(1);
    expect(west.currentPosition).toBeGreaterThanOrEqual(42);
    expect(amn.currentPosition).toBeLessThan(42);
  });

  it('sends every sound event only to the campaign it belongs to', async () => {
    const { app, broadcasts } = setup();
    await play(app, AMN,  'pl-amn',  0);
    await play(app, WEST, 'pl-west', 0);
    await asDM(request(app).post('/api/sound/control'), AMN).send({ action: 'next' });

    const sound = broadcasts.filter(b => b.channel === 'sound');
    expect(sound).toHaveLength(3);
    expect(sound.every(b => b.campaignId === AMN || b.campaignId === WEST)).toBe(true);

    // Nothing addressed to Waterdeep may carry an Amn track, and vice versa.
    const westNames = sound.filter(b => b.campaignId === WEST).map(b => b.payload.name);
    const amnNames  = sound.filter(b => b.campaignId === AMN).map(b => b.payload.name);
    expect(westNames).toEqual(['Dirge']);
    expect(amnNames).toEqual(['Tavern Brawl', 'Chase']);
  });

  it('still refuses control from a non-DM', async () => {
    const { app } = setup();
    const res = await asPlayer(request(app).post('/api/sound/control'), AMN)
      .send({ action: 'play', playlistId: 'pl-amn', trackIndex: 0 });
    expect(res.status).toBe(401);
    expect((await state(app, AMN)).body.isPlaying).toBe(false);
  });

  it('reports position for the asking campaign only', async () => {
    const { app } = setup();
    await play(app, AMN, 'pl-amn', 0, { position: 30 });

    const amn = (await state(app, AMN)).body;
    expect(amn.currentPosition).toBeGreaterThanOrEqual(30);

    const west = (await state(app, WEST)).body;
    expect(west.currentPosition).toBe(0);
  });
});
