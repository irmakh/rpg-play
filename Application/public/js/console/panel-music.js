// Written by Irmak Hakman — 2026-10-11 00:19
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: music ────────────────────────────────────────────────────────
// Playing the music is the shared code's job, the same as on the table screen:
//
//   js/table/table-music.js  the audio element, the "now playing" line and the
//                            per-device volume
//   js/lib/music-sync.js     decides which ONE window on this device makes the
//                            sound, so two open screens never play a track twice
//
// table-music.js finds its elements by id (bg-music, now-playing-*, ...), and
// the panel's page provides those ids in its own design.
//
// This file adds the DM's controls on the More tab - playlist, tracks,
// play/pause/previous/next/stop, repeat, and the volume everyone hears. They
// are the console's own (the table screen opens /music.html in a frame for
// this, which a gamepad cannot reach into). Every control only SENDS a command
// to the server (musicSendControl, DM only); what is shown always comes back
// from the server's 'sound' event, so two DM screens can never disagree.

let _sMusicPlaylists = [];
let _sMusicPlaylistId = '';    // the playlist whose tracks are listed
let _sMusicTrackIdx = null;    // the track playing, when it is from that playlist

// ── What the shared code tells us ────────────────────────────────────────────
// When something starts or stops: swap the "No music playing" line for the
// now-playing line, show the position row, mark the More tab, label the button.
const _sPrevUpdateNowPlaying = updateNowPlaying;
window.updateNowPlaying = function (name, state) {
  _sPrevUpdateNowPlaying(name, state);
  const none = sEl('s-music-none');
  if (none) none.hidden = !!name;
  const seek = sEl('s-music-seekrow');
  if (seek) seek.hidden = !name;
  const playing = !!name && state !== 'paused';
  sMark('more', playing);
  const btn = sEl('s-music-play-btn');
  if (btn) btn.textContent = playing ? 'Pause' : 'Play';
};

// Every 'sound' event passes through here after the shared code has acted on it.
const _sPrevHandleSoundEvent = handleSoundEvent;
window.handleSoundEvent = function (d) {
  _sPrevHandleSoundEvent(d);
  if (!sIsDM() || !d) return;
  if (d.action === 'play') {
    if (d.playlistId) _sMusicPlaylistId = d.playlistId;
    _sMusicTrackIdx = d.trackIndex ?? 0;
    const sel = sEl('s-music-pl-sel');
    if (sel && d.playlistId) sel.value = d.playlistId;
    if (d.volume !== undefined) sMusicShowVolume(d.volume);
    sMusicRenderTracks();
  } else if (d.action === 'stop') {
    _sMusicTrackIdx = null;
    sMusicRenderTracks();
  } else if (d.action === 'volume') {
    sMusicShowVolume(d.volume ?? 1);
  } else if (d.action === 'loopMode') {
    sMusicShowLoop(d.loopMode || 'none');
  }
};

// ── The DM's controls ────────────────────────────────────────────────────────
async function sMusicInit() {
  if (!sIsDM()) return;
  await sMusicLoadPlaylists();
  try {
    const st = await (await fetch('/api/sound/state')).json();
    if (st.playlistId) _sMusicPlaylistId = st.playlistId;
    _sMusicTrackIdx = st.url ? (st.trackIndex ?? 0) : null;
    sMusicShowVolume(st.volume ?? 1);
    sMusicShowLoop(st.loopMode || 'none');
  } catch {}
  const sel = sEl('s-music-pl-sel');
  if (sel && _sMusicPlaylistId) sel.value = _sMusicPlaylistId;
  sMusicRenderTracks();
}

async function sMusicLoadPlaylists() {
  if (!sIsDM()) return;
  try {
    const r = await fetch('/api/playlists', { headers: sAuthHeaders() });
    if (!r.ok) return;
    _sMusicPlaylists = await r.json();
  } catch { return; }
  const sel = sEl('s-music-pl-sel');
  if (!sel) return;
  // Names go in as text - the DM typed them.
  sel.replaceChildren(new Option('Choose a playlist', ''),
    ..._sMusicPlaylists.map(pl => new Option(`${pl.name} (${pl.sounds?.length || 0})`, pl.id)));
  sel.value = _sMusicPlaylistId;
}

function sMusicPickPlaylist() {
  const picked = sEl('s-music-pl-sel')?.value || '';
  // Looking at another playlist does not change what is playing; the playing
  // mark simply belongs to the playlist the track came from.
  if (picked !== _sMusicPlaylistId) _sMusicTrackIdx = null;
  _sMusicPlaylistId = picked;
  sMusicRenderTracks();
}

function sMusicRenderTracks() {
  const el = sEl('s-music-track-list');
  if (!el) return;
  const pl = _sMusicPlaylists.find(p => p.id === _sMusicPlaylistId);
  const tracks = (pl && pl.sounds) || [];
  if (!tracks.length) {
    el.innerHTML = `<li class="p-empty">${pl ? 'This playlist has no tracks.' : 'Choose a playlist to see its tracks.'}</li>`;
    return;
  }
  el.innerHTML = tracks.map((t, i) => `
    <li><button type="button" class="p-roll${i === _sMusicTrackIdx ? ' playing' : ''}" onclick="sMusicPlayTrack(${i})">
      <span class="lbl">${esc(t.name)}</span><span class="val">${i === _sMusicTrackIdx ? 'playing' : i + 1}</span>
    </button></li>`).join('');
}

function sMusicPlayTrack(idx) {
  if (!_sMusicPlaylistId) return;
  musicSendControl({ action: 'play', playlistId: _sMusicPlaylistId, trackIndex: idx });
}

// Where the track is now, on whichever window is playing it: table-music.js
// keeps the position slider in step on every window.
function sMusicPosition() {
  return parseFloat(sEl('now-playing-seek')?.value) || 0;
}

function sMusicPlayPause() {
  if (sEl('s-music-play-btn')?.textContent === 'Pause') {
    musicSendControl({ action: 'pause', position: sMusicPosition() });
  } else if (_sMusicPlaylistId) {
    musicSendControl({ action: 'play', playlistId: _sMusicPlaylistId, trackIndex: _sMusicTrackIdx ?? 0, position: sMusicPosition() });
  } else {
    sToast('Choose a playlist first.');
  }
}

function sMusicControl(action) { musicSendControl({ action }); }

function sMusicSetLoop(mode) {
  sMusicShowLoop(mode);
  musicSendControl({ action: 'loopMode', loopMode: mode });
}
function sMusicShowLoop(mode) {
  document.querySelectorAll('#btn-music [data-loop]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.loop === mode)));
}

// The volume EVERYONE hears (each device also has its own, above this).
let _sMusicVolTimer = null;
function sMusicVolume(val) {
  const pct = sEl('s-music-vol-pct');
  if (pct) pct.textContent = val + '%';
  // Sent once the slider rests, not for every step of the drag.
  clearTimeout(_sMusicVolTimer);
  _sMusicVolTimer = setTimeout(() => musicSendControl({ action: 'volume', volume: parseFloat(val) / 100 }), 200);
}
function sMusicShowVolume(volume) {
  const v = Math.round((volume ?? 1) * 100);
  const slider = sEl('s-music-volume');
  if (slider && document.activeElement !== slider) slider.value = v;
  const pct = sEl('s-music-vol-pct');
  if (pct) pct.textContent = v + '%';
}
