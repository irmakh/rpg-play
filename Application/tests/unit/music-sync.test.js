/**
 * Unit tests for js/lib/music-sync.js — the audio-ownership election.
 *
 * music-sync.js is a classic browser script (no ESM exports, defines globals),
 * so it is loaded into a Node vm context and exercised as the real production
 * code, with a fake BroadcastChannel wired between the contexts. Two "windows"
 * in one test therefore talk to each other exactly as two real windows would.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/lib/music-sync.js'), 'utf-8');

// ── A shared in-process BroadcastChannel bus ─────────────────────────────────
// Mirrors the real API's one rule that matters here: a channel never receives
// its own posts, only those of other channel objects with the same name.
function makeBus() {
  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      channels.push(this);
    }
    postMessage(data) {
      for (const c of channels) {
        if (c === this || c.closed || c.name !== this.name) continue;
        if (c.onmessage) c.onmessage({ data });
      }
    }
    close() { this.closed = true; }
  }
  return { FakeBroadcastChannel, channels };
}

// One vm context = one browser window running music-sync.js.
function makeWindow(bus, { now } = {}) {
  const ctx = createContext({
    BroadcastChannel: bus.FakeBroadcastChannel,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { ctx.__pendingGrace = fn; return 0; },
    addEventListener: () => {},
    Date: now ? { now: () => now } : Date,
    console,
  });
  runInContext(SRC, ctx);
  // Top-level const in a classic script lands in the global LEXICAL scope, not
  // on the global object — the same place a browser puts it, where the other
  // music scripts read it from. So the constants are read by evaluating them.
  ctx.read = (name) => runInContext(name, ctx);
  return ctx;
}

// Builds an arbiter inside a window and records acquire/release transitions.
function spawn(ctx, priority, opts = {}) {
  const log = [];
  const arb = ctx.createAudioArbiter({
    priority,
    onAcquire: () => log.push('acquire'),
    onRelease: () => log.push('release'),
    onMessage: (m) => log.push(m),
    ...opts,
  });
  arb.start();
  return { arb, log, settle: () => arb._settle() };
}

describe('music-sync — audio ownership election', () => {
  let bus;
  beforeEach(() => { bus = makeBus(); });

  it('a lone window takes the audio once the grace period ends', () => {
    const w = makeWindow(bus);
    const table = spawn(w, w.read('MUSIC_PRIO_TABLE'));

    // Nothing before the grace period: claiming immediately is what caused the
    // double-play this whole mechanism exists to prevent.
    expect(table.log).toEqual([]);
    table.settle();
    expect(table.log).toEqual(['acquire']);
    expect(table.arb.isOwner()).toBe(true);
  });

  it('a player window outranks a table window that already owns the audio', () => {
    const w1 = makeWindow(bus);
    const w2 = makeWindow(bus);

    const table = spawn(w1, w1.read('MUSIC_PRIO_TABLE'));
    table.settle();
    expect(table.arb.isOwner()).toBe(true);

    // Opening the dedicated music player hands the sound over…
    const player = spawn(w2, w2.read('MUSIC_PRIO_PLAYER'));
    expect(table.log).toEqual(['acquire', 'release']);
    expect(table.arb.isOwner()).toBe(false);

    // …and the player knows it can play even before its own grace ends,
    // because the table answered its hello.
    player.settle();
    expect(player.arb.isOwner()).toBe(true);
  });

  it('the table takes the audio back when the player window closes', () => {
    const w1 = makeWindow(bus);
    const w2 = makeWindow(bus);

    const table = spawn(w1, w1.read('MUSIC_PRIO_TABLE'));
    table.settle();
    const player = spawn(w2, w2.read('MUSIC_PRIO_PLAYER'));
    player.settle();
    expect(table.arb.isOwner()).toBe(false);

    player.arb.stop();                       // window closed → 'bye'
    expect(table.arb.isOwner()).toBe(true);
    expect(table.log).toEqual(['acquire', 'release', 'acquire']);
  });

  it('between two equal windows the older one keeps the audio', () => {
    const older = makeWindow(bus, { now: 1000 });
    const newer = makeWindow(bus, { now: 2000 });

    const a = spawn(older, older.read('MUSIC_PRIO_TABLE'));
    a.settle();
    const b = spawn(newer, newer.read('MUSIC_PRIO_TABLE'));
    b.settle();

    expect(a.arb.isOwner()).toBe(true);
    expect(b.arb.isOwner()).toBe(false);
    expect(b.log).toEqual([]);               // never played, so never had to stop
  });

  it('a passive window never claims the audio, whoever else is around', () => {
    const w1 = makeWindow(bus);
    const w2 = makeWindow(bus);

    const frame = spawn(w1, 0, { passive: true });   // the table modal's iframe
    frame.settle();
    expect(frame.arb.isOwner()).toBe(false);
    expect(frame.log).toEqual([]);

    // And it does not stop the real table window from owning the audio.
    const table = spawn(w2, w2.read('MUSIC_PRIO_TABLE'));
    table.settle();
    expect(table.arb.isOwner()).toBe(true);
  });

  it('custom messages reach other windows but never the sender', () => {
    const w1 = makeWindow(bus);
    const w2 = makeWindow(bus);

    const owner = spawn(w1, w1.read('MUSIC_PRIO_PLAYER'));
    const frame = spawn(w2, 0, { passive: true });
    owner.log.length = 0;
    frame.log.length = 0;

    owner.arb.post({ t: 'pos', position: 12.5, duration: 200 });
    expect(frame.log).toEqual([{ t: 'pos', position: 12.5, duration: 200 }]);
    expect(owner.log).toEqual([]);
  });

  it('drops a peer whose heartbeat went stale and takes over', () => {
    const w = makeWindow(bus);
    const table = spawn(w, w.read('MUSIC_PRIO_TABLE'));

    // A higher-priority window announces itself, then dies without a 'bye' —
    // a crashed or force-killed player window.
    table.arb._handle({ k: 'ping', id: 'ghost', priority: w.read('MUSIC_PRIO_PLAYER'), joinedAt: Date.now() });
    table.settle();
    expect(table.arb.isOwner()).toBe(false);

    // Age its last-seen past the stale cutoff; the next evaluation evicts it.
    table.arb._peers.get('ghost').seenAt = Date.now() - (w.read('MUSIC_STALE_MS') + 1000);
    table.arb._settle();
    expect(table.arb.isOwner()).toBe(true);
  });
});

describe('music-sync — musicFmtTime', () => {
  const w = makeWindow(makeBus());

  it('formats seconds as m:ss', () => {
    expect(w.musicFmtTime(0)).toBe('0:00');
    expect(w.musicFmtTime(7)).toBe('0:07');
    expect(w.musicFmtTime(67)).toBe('1:07');
    expect(w.musicFmtTime(3599)).toBe('59:59');
  });

  it('survives the values a not-yet-loaded <audio> element reports', () => {
    expect(w.musicFmtTime(NaN)).toBe('0:00');
    expect(w.musicFmtTime(Infinity)).toBe('0:00');
    expect(w.musicFmtTime(-5)).toBe('0:00');
  });
});
