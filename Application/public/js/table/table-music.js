// ── Music Player — table screen module ───────────────────────────────────────
// The table screen is an audio SINK: it holds the page's <audio> element, plays
// whatever the DM broadcasts over realtime, and shows the Now Playing bar.
//
// It owns NO player UI of its own. The controls live in /music.html, which the
// modal loads in an iframe and the ↗ button opens as a standalone window — the
// same page the desktop client opens. See js/lib/music-sync.js for how the two
// agree on which window actually makes the sound.

let _musicPlaying     = false;
let _musicCurrentName = null;
let _musicDuration    = 0;
let _musicLoopMode    = 'none';
let _musicSeeking     = false;
let _musicProgressTick = null;

let _musicArb         = null;   // audio-ownership arbiter
let _musicOwning      = true;   // does THIS window play the audio?
let _musicModalLoaded = false;  // iframe src is set on first open, not on page load

// ── Time helpers ──────────────────────────────────────────────────────────────
function fmtTime(s) {
  return typeof musicFmtTime === 'function'
    ? musicFmtTime(s)
    : (!isFinite(s) || s < 0 ? '0:00'
       : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));
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
  renderMusicPosition(pos);
  // Windows that are not playing the audio (the modal's iframe, a second
  // screen) run their clock off these broadcasts.
  if (_musicOwning && _musicArb) _musicArb.post({ t: 'pos', position: pos, duration: dur });
}

function renderMusicPosition(pos) {
  if (!_musicSeeking) {
    const sk = document.getElementById('now-playing-seek');
    if (sk) { sk.max = _musicDuration || 100; sk.value = pos; }
  }
  const posEl = document.getElementById('now-playing-pos');
  if (posEl) posEl.textContent = fmtTime(pos);
}

function updateDurationDisplay(dur) {
  _musicDuration = dur;
  const durEl = document.getElementById('now-playing-dur');
  if (durEl) durEl.textContent = fmtTime(dur);
  const sk = document.getElementById('now-playing-seek');
  if (sk && dur) sk.max = dur;
}

// ── Resume audio from the server's playback state ─────────────────────────────
function _resumeAudioFromServer() {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;
  fetch('/api/sound/state').then(r => r.json()).then(st => {
    _musicLoopMode = st.loopMode || 'none';
    applyLoopToAudio(_musicLoopMode);
    if (st.duration) updateDurationDisplay(st.duration);
    if (!st.url) return;

    _musicCurrentName = st.name;
    const currentPos  = st.currentPosition ?? 0;

    if (!st.isPlaying) { updateNowPlaying(st.name, 'paused'); return; }

    _musicPlaying = true;
    updateNowPlaying(st.name, _musicOwning ? 'loading' : 'playing');
    if (!_musicOwning) { renderMusicPosition(currentPos); return; }

    const fullUrl = new URL(st.url, location.origin).href;
    if (audioEl.src !== fullUrl) {
      if (currentPos > 0) {
        audioEl.addEventListener('loadedmetadata', () => { audioEl.currentTime = currentPos; }, { once: true });
      }
      audioEl.src = st.url;
    } else if (currentPos > 0) {
      audioEl.currentTime = currentPos;
    }
    audioEl.play()
      .then(() => updateNowPlaying(_musicCurrentName, 'playing'))
      .catch(() => {});
    startProgressTick();
  }).catch(() => {});
}

// ── Init (called by table-main.js once the role is known) ─────────────────────
function initMusicPlayer() {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;

  const savedVol = localStorage.getItem('localVolume');
  if (savedVol !== null) applyLocalVolume(savedVol);

  if (sessionRole === 'dm') {
    const btn = document.getElementById('btn-music');
    if (btn) btn.style.display = '';
    audioEl.addEventListener('loadedmetadata', () => {
      if (_musicOwning && isFinite(audioEl.duration) && audioEl.duration > 0) {
        musicSendControl({ action: 'duration', duration: audioEl.duration });
      }
    });
  } else {
    const sk = document.getElementById('now-playing-seek');
    if (sk) { sk.style.pointerEvents = 'none'; sk.style.cursor = 'default'; }
  }

  // Join the audio election. A dedicated music window outranks the table, so
  // opening one here hands it the sound instead of double-playing the track.
  if (typeof createAudioArbiter === 'function') {
    _musicOwning = false;       // stay silent until the election settles
    _musicArb = createAudioArbiter({
      priority: MUSIC_PRIO_TABLE,
      onAcquire() {
        _musicOwning = true;
        _resumeAudioFromServer();
      },
      onRelease() {
        _musicOwning = false;
        const el = document.getElementById('bg-music');
        if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
        stopProgressTick();
      },
      onMessage(m) {
        if (!m) return;
        if (m.t === 'pos' && !_musicOwning) {
          if (m.duration && m.duration !== _musicDuration) updateDurationDisplay(m.duration);
          renderMusicPosition(m.position);
        } else if (m.t === 'volume') {
          applyLocalVolume(m.v);
        }
      },
    }).start();
  }

  // Paint the bar from the server right away; audio waits for the election.
  _resumeAudioFromServer();
}

// ── SSE handler (called by table-realtime.js for 'sound' channel) ─────────────
function handleSoundEvent(d) {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;

  if (d.action === 'play') {
    _musicCurrentName = d.name;
    _musicPlaying     = true;
    if (d.duration) updateDurationDisplay(d.duration);

    if (_musicOwning) {
      const fullUrl     = d.url ? new URL(d.url, location.origin).href : '';
      const isSameTrack = fullUrl && audioEl.src === fullUrl;
      if (fullUrl && !isSameTrack) {
        const pos = d.position ?? 0;
        if (pos > 0) {
          audioEl.addEventListener('loadedmetadata', () => { audioEl.currentTime = pos; }, { once: true });
        }
        audioEl.src = d.url;
      } else if (isSameTrack && typeof d.position === 'number' && Math.abs(audioEl.currentTime - d.position) > 1) {
        audioEl.currentTime = d.position;
      }
      updateNowPlaying(d.name, 'loading');
      audioEl.play()
        .then(() => updateNowPlaying(_musicCurrentName, 'playing'))
        .catch(() => {});
      startProgressTick();
    } else {
      updateNowPlaying(d.name, 'playing');
      renderMusicPosition(d.position ?? 0);
    }
  } else if (d.action === 'pause') {
    if (_musicOwning) audioEl.pause();
    _musicPlaying = false;
    stopProgressTick();
    updateNowPlaying(_musicCurrentName, 'paused');
  } else if (d.action === 'stop') {
    if (_musicOwning) { audioEl.pause(); audioEl.src = ''; }
    _musicPlaying     = false;
    _musicCurrentName = null;
    stopProgressTick();
    updateDurationDisplay(0);
    renderMusicPosition(0);
    updateNowPlaying(null, null);
  } else if (d.action === 'seek') {
    if (_musicOwning) audioEl.currentTime = d.position ?? 0;
    else renderMusicPosition(d.position ?? 0);
  } else if (d.action === 'duration') {
    updateDurationDisplay(d.duration ?? 0);
  } else if (d.action === 'loopMode') {
    _musicLoopMode = d.loopMode || 'none';
    applyLoopToAudio(_musicLoopMode);
  }
}

// ── Now Playing bar ───────────────────────────────────────────────────────────
function updateNowPlaying(name, state) {
  const bar     = document.getElementById('now-playing-bar');
  const stateEl = document.getElementById('now-playing-state');
  const nameEl  = document.getElementById('now-playing-name');
  if (bar) bar.style.display = name ? 'flex' : 'none';
  if (stateEl) stateEl.textContent =
      state === 'paused'  ? 'Paused:'  :
      state === 'loading' ? 'Loading:' : 'Now playing:';
  if (nameEl) nameEl.textContent = name || '';
}

// ── Local volume — this machine only, shared by every window of the app ───────
function applyLocalVolume(val) {
  const pct = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  const slider = document.getElementById('local-vol-slider');
  if (slider && String(slider.value) !== String(pct)) slider.value = pct;
  const label = document.getElementById('local-vol-pct');
  if (label) label.textContent = pct + '%';
  const audioEl = document.getElementById('bg-music');
  if (audioEl) audioEl.volume = pct / 100;
  localStorage.setItem('localVolume', String(pct));
}

function setLocalVolume(val) {
  applyLocalVolume(val);
  if (_musicArb) _musicArb.post({ t: 'volume', v: parseInt(val, 10) || 0 });
}

// ── Seek from the Now Playing bar (DM only) ───────────────────────────────────
function musicSeekInput(val) {
  if (sessionRole !== 'dm') return;
  _musicSeeking = true;
  const posEl = document.getElementById('now-playing-pos');
  if (posEl) posEl.textContent = fmtTime(parseFloat(val));
}

function musicSeekSend(val) {
  if (sessionRole !== 'dm') return;
  _musicSeeking = false;
  const pos = parseFloat(val);
  const audioEl = document.getElementById('bg-music');
  if (audioEl && _musicOwning) audioEl.currentTime = pos;
  musicSendControl({ action: 'seek', position: pos });
}

function applyLoopToAudio(mode) {
  const audioEl = document.getElementById('bg-music');
  if (!audioEl) return;
  audioEl.loop = (mode === 'track');
  // Only the DM's client advances the playlist, and only while it is the window
  // actually playing the track — otherwise every client would fire a 'next'.
  audioEl.onended = (sessionRole === 'dm' && _musicOwning)
    ? (mode === 'playlist' ? () => musicSendControl({ action: 'next' })
     : mode === 'none'     ? () => musicSendControl({ action: 'stop' })
     : null)
    : null;
}

function musicSendControl(body) {
  if (sessionRole !== 'dm' || !masterPw) return;
  fetch('/api/sound/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// ── Modal — the real controls, loaded from /music.html ────────────────────────
function openMusicModal() {
  const modal = document.getElementById('music-modal');
  if (!modal) return;
  const frame = document.getElementById('music-frame');
  if (frame && !_musicModalLoaded) {
    frame.src = '/music.html?embed=1';
    _musicModalLoaded = true;
  }
  modal.style.display = 'flex';
}

function closeMusicModal() {
  const modal = document.getElementById('music-modal');
  if (modal) modal.style.display = 'none';
}

// ── Pop-out player ────────────────────────────────────────────────────────────
// A plain standalone window on the same page the desktop client opens. It seeds
// itself from the server and claims the audio through the arbiter, so there is
// no opener handshake to get wrong and closing it hands the sound straight back.
function openMusicPopup() {
  closeMusicModal();
  window.open(
    '/music.html', 'rpg-music',
    'width=440,height=620,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no'
  );
}

// Close on backdrop
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('music-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMusicModal(); });
});
