// ── Music Player — table screen module ───────────────────────────────────────
// DM sees controls + modal. All clients receive sound-event SSE and auto-play audio.

let _musicPlaylists        = [];
let _musicCurrentPl        = null;
let _musicPlaying          = false;
let _musicCurrentName      = null;
let _musicCurrentTrackIdx  = 0;
let _musicDuration         = 0;
let _musicLoopMode         = 'none';
let _musicSeeking          = false;
let _musicProgressTick     = null;

// ── Time helpers ──────────────────────────────────────────────────────────────
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

// ── Progress tick (runs every 500ms while playing) ────────────────────────────
function startProgressTick() {
  if (_musicProgressTick) return;
  _musicProgressTick = setInterval(tickProgress, 500);
}

function stopProgressTick() {
  clearInterval(_musicProgressTick);
  _musicProgressTick = null;
}

function tickProgress() {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;
  const pos = audioEl.currentTime;
  const dur = isFinite(audioEl.duration) ? audioEl.duration : _musicDuration;
  if (!_musicSeeking) {
    const sk = document.getElementById('now-playing-seek');
    if (sk) { sk.max = dur || 100; sk.value = pos; }
    const msk = document.getElementById('music-seek');
    if (msk) { msk.max = dur || 100; msk.value = pos; }
  }
  const posEl = document.getElementById('now-playing-pos');
  if (posEl) posEl.textContent = fmtTime(pos);
  const mpos = document.getElementById('music-pos');
  if (mpos) mpos.textContent = fmtTime(pos);
}

function updateDurationDisplay(dur) {
  _musicDuration = dur;
  const durEl = document.getElementById('now-playing-dur');
  if (durEl) durEl.textContent = fmtTime(dur);
  const mdur = document.getElementById('music-dur');
  if (mdur) mdur.textContent = fmtTime(dur);
  const sk = document.getElementById('now-playing-seek');
  if (sk && dur) sk.max = dur;
  const msk = document.getElementById('music-seek');
  if (msk && dur) msk.max = dur;
}

// ── Init (called by table-auth.js after role is known) ────────────────────────
function initMusicPlayer() {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;

  // Restore each client's own local volume preference
  const savedVol = localStorage.getItem('localVolume');
  if (savedVol !== null) {
    const slider = document.getElementById('local-vol-slider');
    if (slider) slider.value = savedVol;
    const pct = document.getElementById('local-vol-pct');
    if (pct) pct.textContent = savedVol + '%';
    audioEl.volume = parseFloat(savedVol) / 100;
  }

  if (sessionRole === 'dm') {
    const btn = document.getElementById('btn-music');
    if (btn) btn.style.display = '';
    fetchMusicPlaylists();
    // DM reports duration to server when track metadata is known
    audioEl.addEventListener('loadedmetadata', () => {
      if (isFinite(audioEl.duration) && audioEl.duration > 0) {
        musicSendControl({ action: 'duration', duration: audioEl.duration });
      }
    });
  } else {
    // Players can see the seek bar but cannot interact with it
    const sk = document.getElementById('now-playing-seek');
    if (sk) { sk.style.pointerEvents = 'none'; sk.style.cursor = 'default'; }
  }

  // Resume state from server on connect
  fetch('/api/sound/state').then(r => r.json()).then(st => {
    _musicLoopMode        = st.loopMode || 'none';
    _musicCurrentTrackIdx = st.trackIndex ?? 0;
    updateLoopBtns(_musicLoopMode);
    applyLoopToAudio(_musicLoopMode);
    if (st.duration) updateDurationDisplay(st.duration);

    if (st.url) {
      _musicCurrentName = st.name;
      const currentPos  = st.currentPosition ?? 0;

      if (st.isPlaying) {
        const fullUrl = new URL(st.url, location.origin).href;
        if (audioEl.src !== fullUrl) {
          if (currentPos > 0) {
            audioEl.addEventListener('loadedmetadata', () => {
              audioEl.currentTime = currentPos;
            }, { once: true });
          }
          audioEl.src = st.url;
        } else if (currentPos > 0) {
          audioEl.currentTime = currentPos;
        }
        updateNowPlaying(st.name, 'loading');
        audioEl.play()
          .then(() => updateNowPlaying(_musicCurrentName, 'playing'))
          .catch(() => {});
        _musicPlaying = true;
        updateMusicBtn(true);
        startProgressTick();
      } else {
        updateNowPlaying(st.name, 'paused');
      }
    }

  }).catch(() => {});
}

// ── SSE handler (called by table-realtime.js for 'sound' channel) ─────────────
function handleSoundEvent(d) {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;

  if (d.action === 'play') {
    const fullUrl    = d.url ? new URL(d.url, location.origin).href : '';
    const isSameTrack = fullUrl && audioEl.src === fullUrl;
    if (fullUrl && !isSameTrack) {
      const pos = d.position ?? 0;
      if (pos > 0) {
        audioEl.addEventListener('loadedmetadata', () => {
          audioEl.currentTime = pos;
        }, { once: true });
      }
      audioEl.src = d.url;
    } else if (isSameTrack && typeof d.position === 'number' && Math.abs(audioEl.currentTime - d.position) > 1) {
      audioEl.currentTime = d.position;
    }
    _musicCurrentName      = d.name;
    _musicCurrentTrackIdx  = d.trackIndex ?? 0;
    if (d.duration) updateDurationDisplay(d.duration);
    updateNowPlaying(d.name, 'loading');
    audioEl.play()
      .then(() => updateNowPlaying(_musicCurrentName, 'playing'))
      .catch(() => {});
    _musicPlaying = true;
    updateMusicBtn(true);
    startProgressTick();
    if (sessionRole === 'dm' && d.playlistId) {
      const sel = document.getElementById('music-pl-sel');
      if (sel && sel.value !== d.playlistId) { sel.value = d.playlistId; loadMusicPlaylist(); }
      renderMusicTrackList(d.trackIndex);
    }
  } else if (d.action === 'pause') {
    audioEl.pause();
    _musicPlaying = false;
    stopProgressTick();
    updateMusicBtn(false);
    updateNowPlaying(_musicCurrentName, 'paused');
  } else if (d.action === 'stop') {
    audioEl.pause();
    audioEl.src = '';
    _musicPlaying          = false;
    _musicCurrentName      = null;
    _musicCurrentTrackIdx  = 0;
    stopProgressTick();
    updateDurationDisplay(0);
    const posEl = document.getElementById('now-playing-pos');
    if (posEl) posEl.textContent = '0:00';
    const mpos = document.getElementById('music-pos');
    if (mpos) mpos.textContent = '0:00';
    updateMusicBtn(false);
    updateNowPlaying(null, null);
    if (sessionRole === 'dm') renderMusicTrackList(null);
  } else if (d.action === 'seek') {
    audioEl.currentTime = d.position ?? 0;
  } else if (d.action === 'duration') {
    updateDurationDisplay(d.duration ?? 0);
  } else if (d.action === 'loopMode') {
    _musicLoopMode = d.loopMode || 'none';
    updateLoopBtns(_musicLoopMode);
    applyLoopToAudio(_musicLoopMode);
  }
}

// ── UI state helpers ──────────────────────────────────────────────────────────
function updateMusicBtn(playing) {
  const btn = document.getElementById('music-play-btn');
  if (!btn) return;
  btn.textContent = playing ? '⏸ Pause' : '▶ Play';
}

function updateNowPlaying(name, state) {
  const bar     = document.getElementById('now-playing-bar');
  const stateEl = document.getElementById('now-playing-state');
  const nameEl  = document.getElementById('now-playing-name');
  if (bar) bar.style.display = name ? 'flex' : 'none';
  if (stateEl) stateEl.textContent =
      state === 'paused'  ? 'Paused:'  :
      state === 'loading' ? 'Loading:' : 'Now playing:';
  if (nameEl) nameEl.textContent = name || '';
  const modalEl = document.getElementById('music-now-playing');
  if (modalEl) modalEl.textContent = name
      ? (state === 'paused' ? '⏸ ' : state === 'loading' ? '⏳ ' : '♪ ') + name
      : '';
}

function setLocalVolume(val) {
  const pct = document.getElementById('local-vol-pct');
  if (pct) pct.textContent = val + '%';
  const audioEl = document.getElementById('bg-music');
  if (audioEl) audioEl.volume = parseFloat(val) / 100;
  localStorage.setItem('localVolume', val);
}

// ── Seek controls (DM only — players get pointer-events:none on the element) ──
function musicSeekInput(val) {
  if (sessionRole !== 'dm') return;
  _musicSeeking = true;
  const t = fmtTime(parseFloat(val));
  const posEl = document.getElementById('now-playing-pos');
  if (posEl) posEl.textContent = t;
  const mpos = document.getElementById('music-pos');
  if (mpos) mpos.textContent = t;
}

function musicSeekSend(val) {
  if (sessionRole !== 'dm') return;
  _musicSeeking = false;
  const pos = parseFloat(val);
  const audioEl = document.getElementById('bg-music');
  if (audioEl) audioEl.currentTime = pos;
  musicSendControl({ action: 'seek', position: pos });
}

// ── Loop mode (DM only) ───────────────────────────────────────────────────────
function musicSetLoopMode(mode) {
  if (sessionRole !== 'dm') return;
  _musicLoopMode = mode;
  musicSendControl({ action: 'loopMode', loopMode: mode });
  updateLoopBtns(mode);
  applyLoopToAudio(mode);
}

function applyLoopToAudio(mode) {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;
  audioEl.loop = (mode === 'track');
  if (sessionRole === 'dm') {
    audioEl.onended =
      mode === 'playlist' ? () => musicSendControl({ action: 'next' }) :
      mode === 'none'     ? () => musicSendControl({ action: 'stop' }) :
      null;
  }
}

function updateLoopBtns(mode) {
  ['none', 'track', 'playlist'].forEach(m => {
    const btn = document.getElementById('music-loop-' + m);
    if (btn) btn.classList.toggle('primary', m === mode);
  });
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
  const sel  = document.getElementById('music-pl-sel');
  const plId = sel?.value;
  _musicCurrentPl = _musicPlaylists.find(p => p.id === plId) || null;
  renderMusicTrackList(null);
}

function renderMusicTrackList(activeIdx) {
  const el = document.getElementById('music-track-list');
  if (!el) return;
  const tracks = _musicCurrentPl?.sounds || [];
  if (!tracks.length) {
    el.innerHTML = '<div style="color:var(--txd);font-size:11px;text-align:center;padding:8px">No tracks in playlist</div>';
    return;
  }
  el.innerHTML = tracks.map((t, i) => `
    <div onclick="musicPlayTrack(${i})" style="padding:5px 8px;border-radius:3px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;background:${i === activeIdx ? 'var(--a44)' : 'transparent'}">
      <span style="color:${i === activeIdx ? 'var(--ac)' : 'var(--txd)'};font-size:11px;flex-shrink:0">${i === activeIdx ? '▶' : (i + 1) + '.'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.name)}</span>
    </div>`).join('');
}

function musicPlayTrack(idx) {
  const plId = document.getElementById('music-pl-sel')?.value;
  if (!plId) return;
  musicSendControl({ action: 'play', playlistId: plId, trackIndex: idx, position: 0 });
}

function musicPlayPause() {
  const audioEl = document.getElementById('bg-music');
  if (_musicPlaying) {
    musicSendControl({ action: 'pause', position: audioEl?.currentTime ?? 0 });
  } else {
    const plId = document.getElementById('music-pl-sel')?.value;
    if (plId) {
      musicSendControl({ action: 'play', playlistId: plId, trackIndex: _musicCurrentTrackIdx, position: audioEl?.currentTime ?? 0 });
    }
  }
}

function musicControl(action) {
  musicSendControl({ action });
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
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Close on backdrop
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('music-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMusicModal(); });
});
