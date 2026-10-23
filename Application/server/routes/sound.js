// Written by Irmak Hakman — 2026-10-23 11:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

import fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';

export default function register(app, ctx) {
  const { ldb, masterAuth, saveUploadFile, broadcast, genId } = ctx;
  // Older harnesses register these routes without the campaign helper; then
  // every request shares one key, which is exactly the pre-campaign behaviour.
  const currentCampaignId = ctx.currentCampaignId || (() => '');

  const AUDIO_MIME = new Set(['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/flac','audio/mp4','audio/aac','audio/x-m4a','video/mpeg']);

  // A sound file sent raw (POST /api/sounds/upload) may be this large. Base64
  // inside JSON could never get there: 250 MB is a 334 MB string, past the
  // 200 MB body limit, and held in memory several times over.
  const MAX_SOUND_BYTES = ctx.MAX_SOUND_BYTES || 250 * 1024 * 1024;   // tests pass a smaller one
  const TOO_LARGE = { error: 'Sound files can be at most 250 MB.', code: 'TOO_LARGE' };

  // What is playing, per campaign. Two groups at two tables are two separate
  // sessions: each has its own track, position, loop mode and volume, and
  // broadcast() already delivers a sound event only to its own campaign's
  // clients. One shared object would have let whichever campaign pressed play
  // last decide what every other campaign's client hears on load.
  //
  // In memory, like the single-campaign version it replaces: a restart stops the
  // music everywhere rather than resurrecting a track nobody is listening to.
  const playback = new Map();   // campaignId -> playback state

  const emptyPlayback = () => ({
    isPlaying: false, playlistId: null, trackIndex: 0, url: null, name: null, volume: 1.0,
    position: 0, positionSetAt: null, duration: 0, loopMode: 'none',
  });

  // '' keys an install with no campaign resolved at all. The campaign middleware
  // answers 409 for those before a handler runs, so it stays empty in practice.
  function playbackKey() {
    return currentCampaignId() || '';
  }

  function playbackState() {
    const key = playbackKey();
    let st = playback.get(key);
    if (!st) { st = emptyPlayback(); playback.set(key, st); }
    return st;
  }

  function setPlaybackState(st) {
    playback.set(playbackKey(), st);
    return st;
  }

  app.get('/api/sounds', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.json(ldb.listSoundFiles());
  });

  app.post('/api/sounds', async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { name, dataUrl, tags = [] } = req.body || {};
      if (!name || !dataUrl) return res.status(400).json({ error: 'name and dataUrl required' });
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!mimeMatch) return res.status(400).json({ error: 'Invalid data URL' });
      const mimeType = mimeMatch[1];
      if (!AUDIO_MIME.has(mimeType)) return res.status(400).json({ error: 'Invalid audio type' });
      const newId = genId();
      const url = saveUploadFile('sounds', newId, mimeType, mimeMatch[2]);
      const fields = { name: String(name).trim().slice(0, 120), url, mime_type: mimeType, tags: Array.isArray(tags) ? tags : [], created_at: new Date().toISOString() };
      ldb.createSoundFile(newId, fields);
      res.json({ ok: true, id: newId, url, name: fields.name, tags: fields.tags });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Raw upload ──────────────────────────────────────────────────────────────
  // The body is the audio file itself (Content-Type: its audio type), the name
  // rides in ?name=. It streams to a .part file, counted as it arrives, and is
  // renamed into place only once complete — the same scheme as story videos.
  // The JSON route above stays for pages loaded before this one existed.
  app.post('/api/sounds/upload', (req, res) => {
    // A refusal sent before the body is read closes the connection, so the
    // client stops streaming a file nobody will keep.
    const refuse = (status, body) => res.set('Connection', 'close').status(status).json(body);
    if (!masterAuth(req)) return refuse(401, { error: 'Unauthorized' });
    const name = String(req.query.name || '').trim().slice(0, 120);
    if (!name) return refuse(400, { error: 'name required' });
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_MIME.has(mimeType)) return refuse(400, { error: 'Invalid audio type' });
    if (Number(req.headers['content-length']) > MAX_SOUND_BYTES) return refuse(413, TOO_LARGE);

    const newId = genId();
    const { abs, url } = ctx.uploadTarget('sounds', newId, mimeType);
    const partPath = abs + '.part';
    const out = fs.createWriteStream(partPath);
    let received = 0;
    let failed = false;

    const fail = (status, body) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      try { fs.unlinkSync(partPath); } catch {}
      if (!res.headersSent) refuse(status, body);
    };

    req.on('data', chunk => {
      if (failed) return;
      received += chunk.length;
      // Content-Length can be absent (chunked) or wrong, so the count is the real limit.
      if (received > MAX_SOUND_BYTES) fail(413, TOO_LARGE);
    });
    req.on('close', () => { if (!req.complete) fail(400, { error: 'Upload interrupted.' }); });
    out.on('error', () => fail(500, { error: 'Could not save the sound.' }));

    // Bound to the request's campaign context now: 'finish' fires from socket
    // reads outside it, where ldb (campaign-scoped) would throw — see stories.js.
    out.on('finish', AsyncLocalStorage.bind(() => {
      if (failed) return;
      if (!received) return fail(400, { error: 'The file is empty.' });
      try {
        fs.renameSync(partPath, abs);
        const fields = { name, url, mime_type: mimeType, tags: [], created_at: new Date().toISOString() };
        ldb.createSoundFile(newId, fields);
        res.json({ ok: true, id: newId, url, name, tags: [] });
      } catch (err) {
        console.error('[sounds] upload save failed:', err);
        try { fs.unlinkSync(abs); } catch {}
        fail(500, { error: 'Could not save the sound.' });
      }
    }));

    req.pipe(out);
  });

  app.delete('/api/sounds/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const sf = ldb.getSoundFile(req.params.id);
    if (!sf) return res.status(404).json({ error: 'Not found' });
    ctx.deleteUploadFile(sf.url);
    ldb.deleteSoundFile(req.params.id);
    res.json({ ok: true });
  });

  app.patch('/api/sounds/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!ldb.getSoundFile(req.params.id)) return res.status(404).json({ error: 'Not found' });
    ldb.updateSoundFile(req.params.id, { name: String(name).trim().slice(0, 120) });
    res.json({ ok: true });
  });

  app.get('/api/playlists', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.json(ldb.listPlaylists().map(pl => ({ ...pl, sounds: ldb.getSoundsForPlaylist(pl.id) })));
  });

  app.post('/api/playlists', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name, type = 'generic', sounds = [], map_name = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const newId = genId();
    const fields = { name: String(name).trim().slice(0, 80), type: type === 'map' ? 'map' : 'generic', sounds: Array.isArray(sounds) ? sounds : [], map_name: String(map_name).slice(0, 80) };
    ldb.createPlaylist(newId, fields);
    res.json({ ok: true, id: newId, ...fields });
  });

  app.put('/api/playlists/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const pl = ldb.getPlaylist(req.params.id);
    if (!pl) return res.status(404).json({ error: 'Not found' });
    const { name, type, sounds, map_name } = req.body || {};
    const update = {};
    if (name     !== undefined) update.name     = String(name).trim().slice(0, 80);
    if (type     !== undefined) update.type     = type === 'map' ? 'map' : 'generic';
    if (sounds   !== undefined) update.sounds   = Array.isArray(sounds) ? sounds : [];
    if (map_name !== undefined) update.map_name = String(map_name).slice(0, 80);
    ldb.updatePlaylist(req.params.id, update);
    res.json({ ok: true });
  });

  app.delete('/api/playlists/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (!ldb.getPlaylist(req.params.id)) return res.status(404).json({ error: 'Not found' });
    ldb.deletePlaylist(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/sound/state', (req, res) => {
    const st = { ...playbackState() };
    st.currentPosition = (st.isPlaying && st.positionSetAt)
      ? Math.min(st.position + (Date.now() - st.positionSetAt) / 1000, st.duration || Infinity)
      : st.position;
    res.json(st);
  });

  app.post('/api/sound/control', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { action, playlistId, trackIndex, volume, position, duration, loopMode } = req.body || {};
    // Every read and write below is this campaign's own playback, and every
    // broadcast() reaches only this campaign's clients.
    const state = playbackState();
    if (action === 'play') {
      let tracks = [];
      if (playlistId) tracks = ldb.getSoundsForPlaylist(playlistId);
      const idx = Math.max(0, parseInt(trackIndex) || 0);
      const track = tracks[idx] || null;
      const pos = typeof position === 'number' ? Math.max(0, position) : 0;
      const keepDur = (track?.url && track.url === state.url) ? state.duration : 0;
      setPlaybackState({
        isPlaying: true, playlistId: playlistId || null, trackIndex: idx,
        url: track?.url || null, name: track?.name || null, volume: state.volume,
        position: pos, positionSetAt: Date.now(), duration: keepDur, loopMode: state.loopMode,
      });
      broadcast('sound', { action: 'play', url: track?.url || null, name: track?.name || null, playlistId, trackIndex: idx, volume: state.volume, position: pos, duration: keepDur });
      // Only a genuine track change is worth a line in the feed; resuming the
      // same track after a pause is not news.
      if (track?.name && track.url !== state.url) {
        ctx.notify?.({
          to: 'players', kind: 'music', title: 'Now playing: ' + track.name,
          // `window` opens the player in its own window rather than replacing
          // whatever the reader was looking at. Named, so a second click
          // focuses the window they already have.
          data: { href: '/music.html', window: 'rpg-music' },
        });
      }
    } else if (action === 'pause') {
      const pos = typeof position === 'number' ? Math.max(0, position) : state.position;
      state.isPlaying = false;
      state.position = pos;
      state.positionSetAt = null;
      broadcast('sound', { action: 'pause', position: pos });
    } else if (action === 'stop') {
      setPlaybackState({ isPlaying: false, playlistId: null, trackIndex: 0, url: null, name: null, volume: state.volume, position: 0, positionSetAt: null, duration: 0, loopMode: state.loopMode });
      broadcast('sound', { action: 'stop' });
    } else if (action === 'next' || action === 'prev') {
      let tracks = [];
      if (state.playlistId) tracks = ldb.getSoundsForPlaylist(state.playlistId);
      if (tracks.length === 0) return res.json({ ok: true });
      const dir = action === 'next' ? 1 : -1;
      const newIdx = ((state.trackIndex + dir) + tracks.length) % tracks.length;
      const track = tracks[newIdx];
      setPlaybackState({ ...state, trackIndex: newIdx, url: track.url, name: track.name, isPlaying: true, position: 0, positionSetAt: Date.now(), duration: 0 });
      broadcast('sound', { action: 'play', url: track.url, name: track.name, playlistId: state.playlistId, trackIndex: newIdx, volume: state.volume, position: 0, duration: 0 });
    } else if (action === 'volume') {
      const vol = Math.max(0, Math.min(1, parseFloat(volume) || 1));
      state.volume = vol;
      broadcast('sound', { action: 'volume', volume: vol });
    } else if (action === 'seek') {
      const pos = Math.max(0, parseFloat(position) || 0);
      state.position = pos;
      state.positionSetAt = state.isPlaying ? Date.now() : null;
      broadcast('sound', { action: 'seek', position: pos });
    } else if (action === 'duration') {
      const dur = Math.max(0, parseFloat(duration) || 0);
      state.duration = dur;
      broadcast('sound', { action: 'duration', duration: dur });
    } else if (action === 'loopMode') {
      const lm = ['none', 'track', 'playlist'].includes(loopMode) ? loopMode : 'none';
      state.loopMode = lm;
      broadcast('sound', { action: 'loopMode', loopMode: lm });
    }
    res.json({ ok: true, state: playbackState() });
  });
}
