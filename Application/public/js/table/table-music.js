// ── Music Player — table screen module ───────────────────────────────────────
// DM sees controls + modal. All clients receive sound-event SSE and auto-play audio.

let _musicPlaylists        = [];
let _musicCurrentPl        = null;
let _musicPlaying          = false;
let _musicCurrentName      = null;
let _musicCurrentTrackIdx  = 0;
let _volumeDebounce        = null;

// Called by table-auth.js after role is known
function initMusicPlayer() {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;

  // DM: show music button, fetch playlists
  if (sessionRole === 'dm') {
    const btn = document.getElementById('btn-music');
    if (btn) btn.style.display = '';
    fetchMusicPlaylists();
  }

  // Resume state from server on connect
  fetch('/api/sound/state').then(r => r.json()).then(st => {
    if (st.url) {
      _musicCurrentName = st.name;
      if (st.isPlaying) {
        audioEl.src = st.url;
        audioEl.volume = st.volume ?? 1;
        audioEl.play().catch(() => {});
        _musicPlaying = true;
        updateMusicBtn(true);
        updateNowPlaying(st.name, 'playing');
      } else {
        updateNowPlaying(st.name, 'paused');
      }
    }
    if (sessionRole === 'dm') {
      document.getElementById('music-volume').value = Math.round((st.volume ?? 1) * 100);
      document.getElementById('music-vol-pct').textContent = Math.round((st.volume ?? 1) * 100) + '%';
    }
  }).catch(() => {});
}

// Called by table-realtime.js SSE handler for 'sound' channel
function handleSoundEvent(d) {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;
  if (d.action === 'play') {
    if (d.url) {
      const fullUrl = new URL(d.url, location.origin).href;
      if (audioEl.src !== fullUrl) audioEl.src = d.url;
      audioEl.volume = d.volume ?? 1;
      audioEl.play().catch(() => {});
    }
    _musicPlaying = true;
    _musicCurrentName = d.name;
    _musicCurrentTrackIdx = d.trackIndex ?? 0;
    updateMusicBtn(true);
    updateNowPlaying(d.name, 'playing');
    if (sessionRole === 'dm' && d.playlistId) {
      const sel = document.getElementById('music-pl-sel');
      if (sel && sel.value !== d.playlistId) {
        sel.value = d.playlistId;
        loadMusicPlaylist();
      }
      renderMusicTrackList(d.trackIndex);
    }
  } else if (d.action === 'pause') {
    audioEl.pause();
    _musicPlaying = false;
    updateMusicBtn(false);
    updateNowPlaying(_musicCurrentName, 'paused');
  } else if (d.action === 'stop') {
    audioEl.pause();
    audioEl.src = '';
    _musicPlaying = false;
    _musicCurrentName = null;
    _musicCurrentTrackIdx = 0;
    updateMusicBtn(false);
    updateNowPlaying(null, null);
    if (sessionRole === 'dm') renderMusicTrackList(null);
  } else if (d.action === 'volume') {
    audioEl.volume = d.volume ?? 1;
    if (sessionRole === 'dm') {
      const pct = Math.round((d.volume ?? 1) * 100);
      document.getElementById('music-volume').value = pct;
      document.getElementById('music-vol-pct').textContent = pct + '%';
    }
  }
}

function updateMusicBtn(playing) {
  const btn = document.getElementById('music-play-btn');
  if (!btn) return;
  btn.textContent = playing ? '⏸ Pause' : '▶ Play';
}

function updateNowPlaying(name, state) {
  const bar = document.getElementById('now-playing-bar');
  const stateEl = document.getElementById('now-playing-state');
  const nameEl = document.getElementById('now-playing-name');
  if (bar) bar.style.display = name ? 'flex' : 'none';
  if (stateEl) stateEl.textContent = state === 'paused' ? 'Paused:' : 'Now playing:';
  if (nameEl) nameEl.textContent = name || '';
  const modalEl = document.getElementById('music-now-playing');
  if (modalEl) modalEl.textContent = name ? (state === 'paused' ? '⏸ ' : '♪ ') + name : '';
}

function setLocalVolume(val) {
  const pct = document.getElementById('local-vol-pct');
  if (pct) pct.textContent = val + '%';
  const audioEl = document.getElementById('bg-music');
  if (audioEl) audioEl.volume = parseFloat(val) / 100;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openMusicModal() {
  fetchMusicPlaylists().then(() => {
    document.getElementById('music-modal').style.display = 'flex';
  });
}
function closeMusicModal() {
  document.getElementById('music-modal').style.display = 'none';
}

async function fetchMusicPlaylists() {
  if (sessionRole !== 'dm' || !masterPw) return;
  try {
    const res = await fetch('/api/playlists', { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) return;
    _musicPlaylists = await res.json();
    populateMusicPlSel();
  } catch {}
}

function populateMusicPlSel() {
  const sel = document.getElementById('music-pl-sel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select Playlist —</option>' +
    _musicPlaylists.map(pl => `<option value="${pl.id}">${escHtml(pl.name)} (${pl.sounds?.length || 0})</option>`).join('');
  if (cur) sel.value = cur;
}

function loadMusicPlaylist() {
  const sel = document.getElementById('music-pl-sel');
  const plId = sel?.value;
  _musicCurrentPl = _musicPlaylists.find(p => p.id === plId) || null;
  renderMusicTrackList(null);
}

function renderMusicTrackList(activeIdx) {
  const el = document.getElementById('music-track-list');
  if (!el) return;
  const tracks = _musicCurrentPl?.sounds || [];
  if (!tracks.length) { el.innerHTML = '<div style="color:var(--txd);font-size:11px;text-align:center;padding:8px">No tracks in playlist</div>'; return; }
  el.innerHTML = tracks.map((t, i) => `
    <div onclick="musicPlayTrack(${i})" style="padding:5px 8px;border-radius:3px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;background:${i === activeIdx ? 'var(--a44)' : 'transparent'}">
      <span style="color:${i === activeIdx ? 'var(--ac)' : 'var(--txd)'};font-size:11px;flex-shrink:0">${i === activeIdx ? '▶' : (i + 1) + '.'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.name)}</span>
    </div>`).join('');
}

function musicPlayTrack(idx) {
  const plId = document.getElementById('music-pl-sel')?.value;
  if (!plId) return;
  musicSendControl({ action: 'play', playlistId: plId, trackIndex: idx });
}

function musicPlayPause() {
  if (_musicPlaying) {
    musicSendControl({ action: 'pause' });
  } else {
    const plId = document.getElementById('music-pl-sel')?.value;
    if (plId) {
      musicSendControl({ action: 'play', playlistId: plId, trackIndex: _musicCurrentTrackIdx });
    }
  }
}

function musicControl(action) {
  musicSendControl({ action });
}

function musicVolumeChange(val) {
  document.getElementById('music-vol-pct').textContent = val + '%';
  clearTimeout(_volumeDebounce);
  _volumeDebounce = setTimeout(() => {
    musicSendControl({ action: 'volume', volume: parseFloat(val) / 100 });
  }, 200);
}

function musicSendControl(body) {
  if (sessionRole !== 'dm' || !masterPw) return;
  fetch('/api/sound/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
    body: JSON.stringify(body),
  }).catch(() => {});
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close on backdrop
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('music-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMusicModal(); });
});
