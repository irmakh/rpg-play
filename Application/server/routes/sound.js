export default function register(app, ctx) {
  const { ldb, DB_PROVIDER, masterAuth, saveUploadFile, broadcast, genId } = ctx;

  const AUDIO_MIME = new Set(['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/flac','audio/mp4','audio/aac','audio/x-m4a','video/mpeg']);

  let soundPlaybackState = {
    isPlaying: false, playlistId: null, trackIndex: 0, url: null, name: null, volume: 1.0,
    position: 0, positionSetAt: null, duration: 0, loopMode: 'none',
  };

  app.get('/api/sounds', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      return res.json(ldb.listSoundFiles());
    }
    res.json([]);
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
      if (DB_PROVIDER === 'localdb') ldb.createSoundFile(newId, fields);
      res.json({ ok: true, id: newId, url, name: fields.name, tags: fields.tags });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  app.delete('/api/sounds/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      const sf = ldb.getSoundFile(req.params.id);
      if (!sf) return res.status(404).json({ error: 'Not found' });
      ctx.deleteUploadFile(sf.url);
      ldb.deleteSoundFile(req.params.id);
    }
    res.json({ ok: true });
  });

  app.patch('/api/sounds/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (DB_PROVIDER === 'localdb') {
      if (!ldb.getSoundFile(req.params.id)) return res.status(404).json({ error: 'Not found' });
      ldb.updateSoundFile(req.params.id, { name: String(name).trim().slice(0, 120) });
    }
    res.json({ ok: true });
  });

  app.get('/api/playlists', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      const playlists = ldb.listPlaylists().map(pl => ({ ...pl, sounds: ldb.getSoundsForPlaylist(pl.id) }));
      return res.json(playlists);
    }
    res.json([]);
  });

  app.post('/api/playlists', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { name, type = 'generic', sounds = [], map_name = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const newId = genId();
    const fields = { name: String(name).trim().slice(0, 80), type: type === 'map' ? 'map' : 'generic', sounds: Array.isArray(sounds) ? sounds : [], map_name: String(map_name).slice(0, 80) };
    if (DB_PROVIDER === 'localdb') ldb.createPlaylist(newId, fields);
    res.json({ ok: true, id: newId, ...fields });
  });

  app.put('/api/playlists/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      const pl = ldb.getPlaylist(req.params.id);
      if (!pl) return res.status(404).json({ error: 'Not found' });
      const { name, type, sounds, map_name } = req.body || {};
      const update = {};
      if (name     !== undefined) update.name     = String(name).trim().slice(0, 80);
      if (type     !== undefined) update.type     = type === 'map' ? 'map' : 'generic';
      if (sounds   !== undefined) update.sounds   = Array.isArray(sounds) ? sounds : [];
      if (map_name !== undefined) update.map_name = String(map_name).slice(0, 80);
      ldb.updatePlaylist(req.params.id, update);
    }
    res.json({ ok: true });
  });

  app.delete('/api/playlists/:id', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (DB_PROVIDER === 'localdb') {
      if (!ldb.getPlaylist(req.params.id)) return res.status(404).json({ error: 'Not found' });
      ldb.deletePlaylist(req.params.id);
    }
    res.json({ ok: true });
  });

  app.get('/api/sound/state', (req, res) => {
    const st = { ...soundPlaybackState };
    st.currentPosition = (st.isPlaying && st.positionSetAt)
      ? Math.min(st.position + (Date.now() - st.positionSetAt) / 1000, st.duration || Infinity)
      : st.position;
    res.json(st);
  });

  app.post('/api/sound/control', (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { action, playlistId, trackIndex, volume, position, duration, loopMode } = req.body || {};
    if (action === 'play') {
      let tracks = [];
      if (DB_PROVIDER === 'localdb' && playlistId) tracks = ldb.getSoundsForPlaylist(playlistId);
      const idx = Math.max(0, parseInt(trackIndex) || 0);
      const track = tracks[idx] || null;
      const pos = typeof position === 'number' ? Math.max(0, position) : 0;
      const keepDur = (track?.url && track.url === soundPlaybackState.url) ? soundPlaybackState.duration : 0;
      soundPlaybackState = {
        isPlaying: true, playlistId: playlistId || null, trackIndex: idx,
        url: track?.url || null, name: track?.name || null, volume: soundPlaybackState.volume,
        position: pos, positionSetAt: Date.now(), duration: keepDur, loopMode: soundPlaybackState.loopMode,
      };
      broadcast('sound', { action: 'play', url: track?.url || null, name: track?.name || null, playlistId, trackIndex: idx, volume: soundPlaybackState.volume, position: pos, duration: keepDur });
    } else if (action === 'pause') {
      const pos = typeof position === 'number' ? Math.max(0, position) : soundPlaybackState.position;
      soundPlaybackState.isPlaying = false;
      soundPlaybackState.position = pos;
      soundPlaybackState.positionSetAt = null;
      broadcast('sound', { action: 'pause', position: pos });
    } else if (action === 'stop') {
      soundPlaybackState = { isPlaying: false, playlistId: null, trackIndex: 0, url: null, name: null, volume: soundPlaybackState.volume, position: 0, positionSetAt: null, duration: 0, loopMode: soundPlaybackState.loopMode };
      broadcast('sound', { action: 'stop' });
    } else if (action === 'next' || action === 'prev') {
      let tracks = [];
      if (DB_PROVIDER === 'localdb' && soundPlaybackState.playlistId) tracks = ldb.getSoundsForPlaylist(soundPlaybackState.playlistId);
      if (tracks.length === 0) return res.json({ ok: true });
      const dir = action === 'next' ? 1 : -1;
      const newIdx = ((soundPlaybackState.trackIndex + dir) + tracks.length) % tracks.length;
      const track = tracks[newIdx];
      soundPlaybackState = { ...soundPlaybackState, trackIndex: newIdx, url: track.url, name: track.name, isPlaying: true, position: 0, positionSetAt: Date.now(), duration: 0 };
      broadcast('sound', { action: 'play', url: track.url, name: track.name, playlistId: soundPlaybackState.playlistId, trackIndex: newIdx, volume: soundPlaybackState.volume, position: 0, duration: 0 });
    } else if (action === 'volume') {
      const vol = Math.max(0, Math.min(1, parseFloat(volume) || 1));
      soundPlaybackState.volume = vol;
      broadcast('sound', { action: 'volume', volume: vol });
    } else if (action === 'seek') {
      const pos = Math.max(0, parseFloat(position) || 0);
      soundPlaybackState.position = pos;
      soundPlaybackState.positionSetAt = soundPlaybackState.isPlaying ? Date.now() : null;
      broadcast('sound', { action: 'seek', position: pos });
    } else if (action === 'duration') {
      const dur = Math.max(0, parseFloat(duration) || 0);
      soundPlaybackState.duration = dur;
      broadcast('sound', { action: 'duration', duration: dur });
    } else if (action === 'loopMode') {
      const lm = ['none', 'track', 'playlist'].includes(loopMode) ? loopMode : 'none';
      soundPlaybackState.loopMode = lm;
      broadcast('sound', { action: 'loopMode', loopMode: lm });
    }
    res.json({ ok: true, state: soundPlaybackState });
  });
}
