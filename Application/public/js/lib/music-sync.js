// Written by Irmak Hakman — 2026-11-17 14:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Music audio ownership ─────────────────────────────────────────────────────
// Every client plays the DM's music through its own <audio> element. That is
// fine across machines, but on ONE machine several windows of the app can be
// open at once (a table on the projector, the music window on the laptop, a
// popped-out panel) and each would play the same track a fraction of a second
// apart — a flanging echo.
//
// So the windows on a machine elect exactly one audio owner over a
// BroadcastChannel. The window already playing always keeps the audio (v365):
// opening a table, a music window or any other page never takes it away, so the
// music does not jump between windows. Only when the owner closes, navigates
// away or goes silent (its heartbeat goes stale, e.g. it crashed) does another
// window take over, resuming from the server's playback state. Who takes over,
// highest first:
//   1. higher priority wins   — a music window, then a table, then other pages
//   2. older window wins      — whoever joined first
//   3. lower id wins          — deterministic tie-break, never happens in practice
// Two windows that claim at the same moment settle it by the same order.
// A passive window (the table modal's iframe) never plays and never counts.
//
// This replaces the old 'music-popup' handshake, which had the table screen
// broadcast 'dismiss' on load to CLOSE the pop-out player. That made a
// standalone player window (the desktop client's Now Playing window) impossible:
// opening any table page killed it.

const MUSIC_CHANNEL  = 'rpg-music-audio';
const MUSIC_PING_MS  = 2000;   // heartbeat interval
const MUSIC_STALE_MS = 6000;   // a peer unheard for this long is gone
const MUSIC_GRACE_MS = 700;    // listen before claiming, so we don't double-play

// Priorities — a dedicated player window outranks a table screen.
const MUSIC_PRIO_PAGE   = 0;   // any other page (js/lib/page-music.js): plays only when nothing else does
const MUSIC_PRIO_TABLE  = 1;
const MUSIC_PRIO_PLAYER = 2;

/**
 * Joins the election and reports when this window gains or loses the audio.
 *
 * @param {object}   opts
 * @param {number}   opts.priority   MUSIC_PRIO_* — how badly this window wants the audio
 * @param {function} opts.onAcquire  called when this window becomes the audio owner
 * @param {function} opts.onRelease  called when it stops being the owner
 * @param {function} [opts.onMessage] called with any custom message from a peer
 * @param {number}   [opts.graceMs]  override the listen-before-claiming delay
 * @param {boolean}  [opts.passive]  join to listen only, never claim the audio
 *                                   (the table modal's iframe — its parent page
 *                                   is already playing the track)
 * @returns {object} arbiter — call start() to join
 */
function createAudioArbiter(opts) {
  const priority   = opts.priority || 0;
  const passive    = !!opts.passive;
  const graceMs    = opts.graceMs != null ? opts.graceMs : MUSIC_GRACE_MS;
  const onAcquire  = opts.onAcquire  || (() => {});
  const onRelease  = opts.onRelease  || (() => {});
  const onMessage  = opts.onMessage  || (() => {});

  const me = {
    id:       Math.random().toString(36).slice(2) + Date.now().toString(36),
    priority,
    joinedAt: Date.now(),
  };

  const peers  = new Map();   // id -> { id, priority, joinedAt, seenAt }
  let bc       = null;
  let timer    = null;
  let owning   = false;
  let settled  = false;       // grace period over — safe to claim

  // Does peer `a` outrank peer `b` as the next owner?
  function outranks(a, b) {
    if (a.priority !== b.priority) return a.priority > b.priority;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
    return a.id < b.id;
  }

  function dropStale() {
    const cutoff = Date.now() - MUSIC_STALE_MS;
    for (const [id, p] of peers) if (p.seenAt < cutoff) peers.delete(id);
  }

  function evaluate() {
    if (passive || !settled) return;
    dropStale();
    const others = [...peers.values()].filter(p => !p.passive);
    const owners = others.filter(p => p.owning);
    let shouldOwn;
    if (owning) shouldOwn = !owners.some(p => outranks(p, me));   // keep it, unless a same-moment claim outranks us
    else if (owners.length) shouldOwn = false;                     // someone is already playing: leave it to them
    else shouldOwn = !others.some(p => outranks(p, me));           // nobody is: the best candidate takes it
    if (shouldOwn === owning) return;
    owning = shouldOwn;
    ping(false);   // tell the others at once, so nobody else claims meanwhile
    (owning ? onAcquire : onRelease)();
  }

  function send(msg) {
    if (!bc) return;
    try { bc.postMessage(msg); } catch {}
  }

  function ping(hello) {
    send({ k: 'ping', id: me.id, priority: me.priority, joinedAt: me.joinedAt, hello: !!hello, owning, passive });
  }

  function handle(msg) {
    if (!msg || msg.id === me.id) return;
    if (msg.k === 'ping') {
      peers.set(msg.id, {
        id: msg.id, priority: msg.priority || 0,
        joinedAt: msg.joinedAt || Date.now(), seenAt: Date.now(),
        owning: !!msg.owning, passive: !!msg.passive,
      });
      // Answer a newcomer at once so it learns about us inside its grace period
      // instead of claiming the audio and then handing it straight back.
      if (msg.hello) ping(false);
      evaluate();
    } else if (msg.k === 'bye') {
      peers.delete(msg.id);
      evaluate();
    } else if (msg.k === 'msg') {
      onMessage(msg.data);
    }
  }

  function start() {
    if (bc) return arbiter;
    try {
      bc = new BroadcastChannel(MUSIC_CHANNEL);
    } catch {
      // No BroadcastChannel (very old browser): assume we are alone and play.
      settled = true;
      if (!passive) { owning = true; onAcquire(); }
      return arbiter;
    }
    bc.onmessage = (e) => handle(e.data);
    ping(true);
    timer = setInterval(() => { ping(false); evaluate(); }, MUSIC_PING_MS);
    setTimeout(() => { settled = true; evaluate(); }, graceMs);
    // pagehide fires for real closes AND navigations; either way we are done.
    if (typeof addEventListener === 'function') addEventListener('pagehide', stop);
    return arbiter;
  }

  function stop() {
    if (!bc) return;
    send({ k: 'bye', id: me.id });
    clearInterval(timer);
    timer = null;
    try { bc.close(); } catch {}
    bc = null;
    if (owning) { owning = false; onRelease(); }
  }

  const arbiter = {
    start,
    stop,
    isOwner:  () => owning,
    /** Broadcast a custom payload to every other window (position, volume, …). */
    post:     (data) => send({ k: 'msg', id: me.id, data }),
    // Exposed for tests — the election is the part worth testing.
    _me:      me,
    _peers:   peers,
    _handle:  handle,
    _outranks: outranks,
    _settle:  () => { settled = true; evaluate(); },
  };
  return arbiter;
}

// Shared formatting so every music surface renders 1:07 the same way.
function musicFmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
