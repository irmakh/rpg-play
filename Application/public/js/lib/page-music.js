// Written by Irmak Hakman — 2026-11-17 14:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── The DM's music on every page (v365) ──────────────────────────────────────
// Music used to play only on the table screen and in the music window, so a
// player who opened their sheet, or a DM checking a monster, lost it. Every
// logged-in page now loads this file and plays the same track at the same spot,
// from the server's playback state (/api/sound/state) and its live 'sound'
// events.
//
// What a browser allows decides the rest:
//   - Changing page stops all sound, so the new page picks the track up again
//     where the server says it is: a pause of about a second.
//   - Phones (iPhones always, Android sometimes) will not start sound on a new
//     page until it is touched. The chip then says "Tap to resume music", and
//     the first tap anywhere on the page starts it.
//
// One player per device: this page joins the same election as the table and
// the music window (js/lib/music-sync.js) at the lowest priority, so an open
// table or music window keeps the sound and this page stays quiet.
//
// The chip beside the bell shows the track; tapping it opens this device's
// volume and mute. Volume is the table's own setting ('localVolume').

const PGM_VOL_KEY  = 'localVolume';
const PGM_MUTE_KEY = 'localVolumeBeforeMute';

const pgm = {
  audio: null, arb: null, owning: false,
  name: null, url: null, playing: false, loopMode: 'none',
  blocked: false,     // the browser refused to start the sound until a tap
  chip: null, pop: null,
};

function pgmSession() {
  try { return JSON.parse(sessionStorage.getItem('rpgSession') || 'null'); } catch { return null; }
}
function pgmIsDm() { const s = pgmSession(); return !!s && s.role === 'dm'; }
function pgmDmToken() { const s = pgmSession(); return (s && s.role === 'dm' && s.masterPw) || ''; }

// This page plays the music when it is logged in and has no player of its own
// (the table and the music window do).
function pgmShouldRun() {
  if (typeof document === 'undefined') return false;
  if (document.getElementById('bg-music')) return false;
  if (/\/music(-player)?\.html$/.test(location.pathname)) return false;
  const s = pgmSession();
  if (!s || !s.role) return false;
  return typeof _storedSessionToken !== 'function' || !!_storedSessionToken();
}

// ── Volume ───────────────────────────────────────────────────────────────────
function pgmVolume() {
  let v = 100;
  try { const s = localStorage.getItem(PGM_VOL_KEY); if (s !== null) v = parseInt(s, 10); } catch {}
  return Math.max(0, Math.min(100, isNaN(v) ? 100 : v));
}
function pgmSetVolume(v, fromPeer) {
  const pct = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
  try { localStorage.setItem(PGM_VOL_KEY, String(pct)); } catch {}
  if (pgm.audio) pgm.audio.volume = pct / 100;
  if (!fromPeer && pgm.arb) pgm.arb.post({ t: 'volume', v: pct });
  pgmRenderPop();
  pgmRenderChip();
}
function pgmToggleMute() {
  const v = pgmVolume();
  if (v > 0) {
    try { localStorage.setItem(PGM_MUTE_KEY, String(v)); } catch {}
    pgmSetVolume(0);
  } else {
    let back = 70;
    try { back = parseInt(localStorage.getItem(PGM_MUTE_KEY), 10) || 70; } catch {}
    pgmSetVolume(back);
  }
}

// ── Playing ──────────────────────────────────────────────────────────────────
function pgmLoad(url, position) {
  const a = pgm.audio;
  if (!a || !url) return;
  const full = new URL(url, location.origin).href;
  if (a.src !== full) {
    if (position > 0) a.addEventListener('loadedmetadata', () => { a.currentTime = position; }, { once: true });
    a.src = url;
  } else if (typeof position === 'number' && Math.abs(a.currentTime - position) > 1) {
    a.currentTime = position;
  }
}

function pgmPlay() {
  const a = pgm.audio;
  if (!a || !pgm.owning || !pgm.playing || !a.src) return;
  const p = a.play();
  if (p && p.then) {
    p.then(() => { pgm.blocked = false; pgmRenderChip(); })
     .catch(err => {
       // NotAllowedError: the browser wants a tap first.
       if (err && err.name === 'NotAllowedError') { pgm.blocked = true; pgmRenderChip(); }
     });
  }
}

// Pick up the track from the server: on gaining the sound, after a tap, and
// when the page loads (for the chip).
function pgmResume() {
  return fetch('/api/sound/state').then(r => r.json()).then(st => {
    pgm.loopMode = st.loopMode || 'none';
    pgm.name = st.url ? st.name : null;
    pgm.url = st.url || null;
    pgm.playing = !!(st.url && st.isPlaying);
    pgmApplyLoop();
    if (pgm.owning && pgm.playing) { pgmLoad(st.url, st.currentPosition || 0); pgmPlay(); }
    pgmRenderChip();
  }).catch(() => {});
}

// The live 'sound' events, the same ones the table follows.
function pgmOnSound(d) {
  if (!d) return;
  const a = pgm.audio;
  if (d.action === 'play') {
    pgm.name = d.name; pgm.url = d.url || pgm.url; pgm.playing = true;
    if (pgm.owning && a) { pgmLoad(d.url, d.position || 0); pgmPlay(); }
  } else if (d.action === 'pause') {
    pgm.playing = false;
    if (pgm.owning && a) a.pause();
  } else if (d.action === 'stop') {
    pgm.playing = false; pgm.name = null; pgm.url = null; pgm.blocked = false;
    if (pgm.owning && a) { a.pause(); a.removeAttribute('src'); a.load(); }
  } else if (d.action === 'seek') {
    if (pgm.owning && a && typeof d.position === 'number') a.currentTime = d.position;
  } else if (d.action === 'loopMode') {
    pgm.loopMode = d.loopMode || 'none';
    pgmApplyLoop();
  }
  pgmRenderChip();
}

// The playlist moves on from the DM's own device, as on the table: only the
// DM's window that is making the sound tells the server the track ended.
function pgmApplyLoop() {
  const a = pgm.audio;
  if (!a) return;
  a.loop = pgm.loopMode === 'track';
  a.onended = (pgmIsDm() && pgm.owning)
    ? (pgm.loopMode === 'playlist' ? () => pgmControl({ action: 'next' })
     : pgm.loopMode === 'none'     ? () => pgmControl({ action: 'stop' })
     : null)
    : null;
}
function pgmControl(body) {
  const token = pgmDmToken();
  if (!token) return;
  fetch('/api/sound/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Master-Password': token },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// ── The chip and its pop-over ────────────────────────────────────────────────
function pgmIcon(id) { return `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-${id}"></use></svg>`; }
function pgmEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pgmRenderChip() {
  const chip = pgm.chip;
  if (!chip) return;
  if (!pgm.name) { chip.hidden = true; pgmClosePop(); return; }
  chip.hidden = false;
  const muted = pgmVolume() === 0;
  const elsewhere = pgm.playing && !pgm.owning;
  chip.classList.toggle('pgm-blocked', pgm.blocked && pgm.playing);
  chip.innerHTML = pgm.blocked && pgm.playing
    ? `${pgmIcon('play')}<span class="pgm-name">Tap to resume music</span>`
    : `${pgmIcon(muted ? 'minus' : 'music')}<span class="pgm-name">${pgmEsc(pgm.name)}</span>${pgm.playing ? '' : '<span class="pgm-state">Paused</span>'}`;
  chip.title = pgm.blocked && pgm.playing ? 'Tap to resume the music'
    : `${pgm.playing ? 'Now playing' : 'Paused'}: ${pgm.name}${elsewhere ? ' (playing in another window)' : ''}${muted ? ' (muted)' : ''}`;
  chip.setAttribute('aria-label', chip.title);
}

function pgmChipClick(e) {
  e.preventDefault(); e.stopPropagation();
  if (pgm.blocked && pgm.playing) { pgmResume(); return; }
  if (pgm.pop && !pgm.pop.hidden) pgmClosePop(); else pgmOpenPop();
}

function pgmOpenPop() {
  if (!pgm.pop) {
    pgm.pop = document.createElement('div');
    pgm.pop.className = 'pgm-pop';
    pgm.pop.setAttribute('role', 'dialog');
    pgm.pop.setAttribute('aria-label', 'Music on this device');
    document.body.appendChild(pgm.pop);
  }
  pgm.pop.hidden = false;
  pgmRenderPop();
  const r = pgm.chip.getBoundingClientRect();
  const w = pgm.pop.offsetWidth || 260;
  pgm.pop.style.top = Math.round(r.bottom + 6) + 'px';
  pgm.pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
  if (pgm.chip.classList.contains('pgm-float')) {
    pgm.pop.style.top = Math.round(Math.max(8, r.top - (pgm.pop.offsetHeight || 120) - 6)) + 'px';
  }
}
function pgmClosePop() { if (pgm.pop) pgm.pop.hidden = true; }

function pgmRenderPop() {
  if (!pgm.pop || pgm.pop.hidden) return;
  const v = pgmVolume();
  pgm.pop.innerHTML = `
    <div class="pgm-pop-name">${pgmEsc(pgm.name || '')}</div>
    <div class="pgm-pop-sub">${pgm.playing ? (pgm.owning ? 'Playing on this page' : 'Playing in another window') : 'Paused by the DM'}</div>
    <label class="pgm-pop-row" for="pgm-vol"><span>Volume</span>
      <input type="range" id="pgm-vol" min="0" max="100" value="${v}" oninput="pgmSetVolume(this.value)" aria-label="Music volume on this device">
      <b>${v}%</b></label>
    <button type="button" class="pgm-pop-btn" onclick="pgmToggleMute()">${v === 0 ? 'Unmute' : 'Mute'}</button>
    <div class="pgm-pop-note">This device only. The DM controls what plays.</div>`;
}

function pgmStyle() {
  if (document.getElementById('pgm-style')) return;
  const st = document.createElement('style');
  st.id = 'pgm-style';
  st.textContent = [
    '.pgm-chip{display:inline-flex;align-items:center;gap:6px;max-width:200px;min-height:32px;padding:0 10px;margin-right:6px;border-radius:999px;',
    '  border:1px solid var(--rule-hi,#ffffff33);background:var(--slate-hi,#1b2740);color:var(--bone,#e6edf7);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}',
    '.pgm-chip[hidden]{display:none}',
    '.pgm-chip .lt-icon{width:16px;height:16px;flex:none;color:var(--arc,#e0a93f)}',
    '.pgm-chip .pgm-name{overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.pgm-chip .pgm-state{color:var(--ash,#8c9ab3);font-size:11px}',
    '.pgm-chip.pgm-blocked{border-color:var(--arc,#e0a93f);color:var(--arc,#e0a93f);animation:pgm-pulse 1.6s ease-in-out infinite}',
    '@keyframes pgm-pulse{50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--arc,#e0a93f) 30%,transparent)}}',
    '.pgm-chip.pgm-float{position:fixed;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:900;box-shadow:0 4px 14px #0009}',
    '.pgm-pop{position:fixed;z-index:6000;width:min(280px,calc(100vw - 16px));padding:12px 14px;border-radius:10px;',
    '  background:var(--slate,#101a2c);color:var(--bone,#e6edf7);border:1px solid var(--rule-hi,#ffffff33);box-shadow:0 12px 32px #000b;display:flex;flex-direction:column;gap:8px}',
    '.pgm-pop[hidden]{display:none}',
    '.pgm-pop-name{font-weight:700;overflow-wrap:anywhere}',
    '.pgm-pop-sub,.pgm-pop-note{font-size:12px;color:var(--ash,#8c9ab3)}',
    '.pgm-pop-row{display:flex;align-items:center;gap:8px;font-size:13px}',
    '.pgm-pop-row input{flex:1;accent-color:var(--arc,#e0a93f)}',
    '.pgm-pop-row b{min-width:38px;text-align:right;font-variant-numeric:tabular-nums}',
    '.pgm-pop-btn{align-self:flex-start;min-height:36px;padding:0 14px;border-radius:8px;border:1px solid var(--rule-hi,#ffffff33);background:var(--slate-hi,#1b2740);color:inherit;font:inherit;cursor:pointer}',
    '@media (max-width:520px){.pgm-chip{max-width:44px;padding:0;justify-content:center;width:40px}.pgm-chip .pgm-name,.pgm-chip .pgm-state{display:none}.pgm-chip.pgm-blocked{max-width:none;width:auto;padding:0 10px}.pgm-chip.pgm-blocked .pgm-name{display:inline}}',
  ].join('\n');
  document.head.appendChild(st);
}

// Beside the bell when the page has one; otherwise in the bottom-right corner.
function pgmMountChip() {
  pgmStyle();
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'pgm-chip';
  chip.hidden = true;
  chip.addEventListener('click', pgmChipClick);
  const bell = document.querySelector('[data-notif-bell]');
  if (bell && bell.parentNode) bell.parentNode.insertBefore(chip, bell);
  else { chip.classList.add('pgm-float'); document.body.appendChild(chip); }
  pgm.chip = chip;
  document.addEventListener('click', e => {
    if (pgm.pop && !pgm.pop.hidden && !pgm.pop.contains(e.target) && e.target !== chip && !chip.contains(e.target)) pgmClosePop();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pgmClosePop(); });
}

// ── Start ────────────────────────────────────────────────────────────────────
function pgmInit() {
  if (!pgmShouldRun()) return;
  const a = document.createElement('audio');
  a.id = 'page-music';
  a.preload = 'auto';
  a.volume = pgmVolume() / 100;
  a.hidden = true;
  document.body.appendChild(a);
  pgm.audio = a;
  // The DM's device reports the track's length, as the table does.
  a.addEventListener('loadedmetadata', () => {
    if (pgmIsDm() && pgm.owning && isFinite(a.duration) && a.duration > 0) pgmControl({ action: 'duration', duration: a.duration });
  });
  pgmMountChip();

  // A tap anywhere starts sound the browser held back.
  const unblock = () => { if (pgm.blocked && pgm.playing && pgm.owning) pgmResume(); };
  document.addEventListener('pointerdown', unblock, true);
  document.addEventListener('keydown', unblock, true);

  if (typeof connectRealtime === 'function') connectRealtime({ sound: pgmOnSound });

  if (typeof createAudioArbiter === 'function') {
    pgm.arb = createAudioArbiter({
      priority: typeof MUSIC_PRIO_PAGE !== 'undefined' ? MUSIC_PRIO_PAGE : 0,
      onAcquire() { pgm.owning = true; pgmApplyLoop(); pgmResume(); },
      onRelease() {
        pgm.owning = false; pgm.blocked = false;
        a.pause(); a.removeAttribute('src'); a.load();
        pgmApplyLoop(); pgmRenderChip();
      },
      onMessage(m) { if (m && m.t === 'volume') pgmSetVolume(m.v, true); },
    }).start();
  } else {
    pgm.owning = true;
  }
  pgmResume();
}

if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pgmInit);
  else pgmInit();
}
