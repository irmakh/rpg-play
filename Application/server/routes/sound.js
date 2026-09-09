export default function register(app, ctx) {
  const { ldb, masterAuth, saveUploadFile, broadcast, genId } = ctx;
  // Older harnesses register these routes without the campaign helper; then
  // every request shares one key, which is exactly the pre-campaign behaviour.
  const currentCampaignId = ctx.currentCampaignId || (() => '');

  const AUDIO_MIME = new Set(['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/flac','audio/mp4','audio/aac','audio/x-m4a','video/mpeg']);

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
