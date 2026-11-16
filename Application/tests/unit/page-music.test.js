// Written by Irmak Hakman — 2026-11-17 14:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The DM's music on every page (v365): js/lib/page-music.js.
 *
 * Run against a small stand-in for a page: which pages play, that only the
 * window holding the sound touches its audio, that a refused start becomes
 * "Tap to resume music", and that the pages load the files they need.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public', p), 'utf-8');
const JS = read('js/lib/page-music.js');

function fakeAudio() {
  return {
    src: '', currentTime: 0, volume: 1, loop: false, onended: null, paused: true, hidden: false, id: '',
    played: 0, refuse: false,
    play() { this.played++; if (this.refuse) { const e = new Error('no'); e.name = 'NotAllowedError'; return Promise.reject(e); } this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }, load() {}, removeAttribute(k) { if (k === 'src') this.src = ''; },
    addEventListener() {},
  };
}

function load({ path = '/index.html', session = { role: 'character', charPw: 't' }, table = false, state } = {}) {
  const audio = fakeAudio();
  const store = {};
  const ctx = createContext({
    console, URL, Promise,
    location: { pathname: path, origin: 'https://x' },
    sessionStorage: { getItem: k => (k === 'rpgSession' && session ? JSON.stringify(session) : null) },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(state || { url: null }) }),
    window: { innerWidth: 400 },
    document: {
      readyState: 'complete',
      getElementById: id => (id === 'bg-music' && table ? {} : null),
      createElement: tag => (tag === 'audio' ? audio : {
        classList: { add() {}, toggle() {}, contains: () => false }, setAttribute() {}, addEventListener() {},
        style: {}, hidden: false, innerHTML: '',
      }),
      querySelector: () => null,
      head: { appendChild() {} },
      body: { appendChild() {} },
      addEventListener() {},
    },
  });
  runInContext(JS, ctx);
  runInContext('globalThis.__pgm = pgm;', ctx);
  return { ctx, audio, pgm: ctx.__pgm, store };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe('which pages play the music', () => {
  it('a logged-in page does', () => {
    expect(load().ctx.pgmShouldRun()).toBe(true);
  });
  it('the table and the music window do not (they have their own player)', () => {
    expect(load({ table: true }).ctx.pgmShouldRun()).toBe(false);
    expect(load({ path: '/music.html' }).ctx.pgmShouldRun()).toBe(false);
  });
  it('a page nobody is logged in to does not', () => {
    expect(load({ session: null }).ctx.pgmShouldRun()).toBe(false);
  });
});

describe('playing', () => {
  const ST = { url: '/sounds/a.mp3', name: 'Tavern', isPlaying: true, currentPosition: 42, loopMode: 'none' };

  it('picks the track up where the server says it is', async () => {
    const { ctx, pgm, audio } = load({ state: ST });
    await tick();                     // the page's own resume on load
    pgm.owning = true;
    audio.src = ''; audio.played = 0;
    await ctx.pgmResume();
    expect(audio.src).toBe('/sounds/a.mp3');
    expect(audio.played).toBe(1);
    expect(pgm.name).toBe('Tavern');
    expect(pgm.playing).toBe(true);
  });

  it('a window that does not hold the sound never touches its audio', () => {
    const { ctx, pgm, audio } = load();
    pgm.owning = false;
    ctx.pgmOnSound({ action: 'play', url: '/sounds/a.mp3', name: 'Tavern', position: 0 });
    expect(audio.src).toBe('');
    expect(audio.played).toBe(0);
    expect(pgm.name).toBe('Tavern');   // the chip still shows it
  });

  it('pause and stop follow the DM', () => {
    const { ctx, pgm, audio } = load();
    pgm.owning = true;
    ctx.pgmOnSound({ action: 'play', url: '/sounds/a.mp3', name: 'Tavern', position: 0 });
    ctx.pgmOnSound({ action: 'pause' });
    expect(audio.paused).toBe(true);
    expect(pgm.playing).toBe(false);
    ctx.pgmOnSound({ action: 'stop' });
    expect(pgm.name).toBe(null);
    expect(audio.src).toBe('');
  });

  it('a start the browser refuses becomes "Tap to resume music"', async () => {
    const { ctx, pgm, audio } = load();
    pgm.owning = true;
    audio.refuse = true;
    ctx.pgmOnSound({ action: 'play', url: '/sounds/a.mp3', name: 'Tavern', position: 0 });
    await tick();
    expect(pgm.blocked).toBe(true);
  });

  it('only the DM moves the playlist on when a track ends', () => {
    const dm = load({ session: { role: 'dm', masterPw: 't' } });
    dm.pgm.owning = true; dm.pgm.loopMode = 'playlist'; dm.ctx.pgmApplyLoop();
    expect(typeof dm.audio.onended).toBe('function');
    const player = load();
    player.pgm.owning = true; player.pgm.loopMode = 'playlist'; player.ctx.pgmApplyLoop();
    expect(player.audio.onended).toBe(null);
  });
});

describe('volume', () => {
  it('mute remembers the volume and unmute brings it back', () => {
    const { ctx, store } = load();
    ctx.pgmSetVolume(60);
    ctx.pgmToggleMute();
    expect(store.localVolume).toBe('0');
    ctx.pgmToggleMute();
    expect(store.localVolume).toBe('60');
  });
});

describe('the pages load it', () => {
  const PAGES = ['dm', 'events', 'handouts', 'index', 'monsters', 'playlists', 'prepare-map', 'spells',
    'stories', 'treasury', 'waiting-screens', 'loot', 'merchant'];
  for (const p of PAGES) {
    it(`${p}.html loads music-sync.js, then page-music.js, after realtime.js`, () => {
      const html = read(`${p}.html`);
      const rt = html.indexOf('/js/lib/realtime.js'), ms = html.indexOf('/js/lib/music-sync.js'), pg = html.indexOf('/js/lib/page-music.js');
      expect(rt).toBeGreaterThan(-1);
      expect(ms).toBeGreaterThan(rt);
      expect(pg).toBeGreaterThan(ms);
    });
  }
  it('the table and the music window keep their own player instead', () => {
    expect(read('table.html')).not.toContain('page-music.js');
    expect(read('music.html')).not.toContain('page-music.js');
  });
});
