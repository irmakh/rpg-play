// Written by Irmak Hakman — 2026-09-26 16:50

/**
 * Unit tests for js/lib/realtime.js — one page, one connection.
 *
 * realtime.js is a classic browser script (no ESM exports, defines globals), so
 * it is loaded into a Node vm context and exercised as the real production code
 * with fake WebSocket/EventSource/fetch.
 *
 * The bug these guard: connectRealtime() is called more than once on some pages
 * (the page's own handlers, plus a notification bell marked
 * data-notif-bell="connect"), and every extra call used to open a second
 * WebSocket — so the maintenance page listed the same person on the same page
 * twice, and every event was handled twice over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/lib/realtime.js'), 'utf-8');

/** A page with the given transport available, and the sockets it opens. */
// A logged-in character by default: since v237 the page only opens the live
// stream with a session to present. Pass session: null for a signed-out tab.
const CHAR_SESSION = { role: 'character', characterId: 'c1', charPw: 'rpgs_testtoken' };

function load({ dbProvider = 'localdb', session = CHAR_SESSION } = {}) {
  const store = new Map(session ? [['rpgSession', JSON.stringify(session)]] : []);
  const replaced = [];
  const sockets = [];
  const sources = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      this.onclose = null;
      sockets.push(this);
    }
    /** Deliver one server message, the way the real onmessage receives it. */
    deliver(event, data) { this.onmessage({ data: JSON.stringify({ event, data }) }); }
  }

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      sources.push(this);
    }
    addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }
    deliver(event, data) {
      for (const fn of this.listeners[event] || []) fn({ data: JSON.stringify(data) });
    }
  }

  const ctx = createContext({
    console,
    URLSearchParams,
    URL,
    JSON,
    setTimeout() { /* never reconnect during a test */ },
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    fetch: async () => ({ json: async () => ({ dbProvider, wsUrl: null }) }),
    location: { pathname: '/table.html', host: 'table.test', search: '', replace(u) { replaced.push(u); }, reload() {} },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, removeItem: (k) => { store.delete(k); } },
    document: {
      cookie: 'campaign=camp-1',
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => null,
    },
  });
  ctx.window = ctx;
  runInContext(SRC, ctx);
  return { ctx, sockets, sources, store, replaced };
}

describe('connectRealtime — one connection per page', () => {
  it('opens a single WebSocket however many times it is called', async () => {
    const { ctx, sockets } = load();
    await ctx.connectRealtime({ 'token-moved': () => {} });
    await ctx.connectRealtime({ notification: () => {} });
    await ctx.connectRealtime({});
    expect(sockets).toHaveLength(1);
  });

  it('opens one socket even when the calls overlap', async () => {
    const { ctx, sockets } = load();
    await Promise.all([
      ctx.connectRealtime({ a: () => {} }),
      ctx.connectRealtime({ b: () => {} }),
    ]);
    expect(sockets).toHaveLength(1);
  });

  it('delivers an event to every handler registered for it', async () => {
    const { ctx, sockets } = load();
    const seen = [];
    await ctx.connectRealtime({ notification: d => seen.push(['page', d]) });
    await ctx.connectRealtime({ notification: d => seen.push(['bell', d]) });

    sockets[0].deliver('notification', { id: 7 });
    expect(seen).toEqual([['page', { id: 7 }], ['bell', { id: 7 }]]);
  });

  it('still tells the other handlers when one of them throws', async () => {
    const { ctx, sockets } = load();
    const seen = [];
    await ctx.connectRealtime({ ping: () => { throw new Error('handler blew up'); } });
    await ctx.connectRealtime({ ping: () => seen.push('second still ran') });

    expect(() => sockets[0].deliver('ping', {})).not.toThrow();
    expect(seen).toEqual(['second still ran']);
  });

  it('ignores an event nobody registered for', async () => {
    const { ctx, sockets } = load();
    await ctx.connectRealtime({ 'token-moved': () => {} });
    expect(() => sockets[0].deliver('something-else', {})).not.toThrow();
  });

  it('carries the page and campaign into the connection URL', async () => {
    const { ctx, sockets } = load();
    await ctx.connectRealtime({});
    const url = new URL(sockets[0].url.replace(/^ws:/, 'http:'));
    expect(url.searchParams.get('page')).toBe('/table.html');
    expect(url.searchParams.get('campaign')).toBe('camp-1');
  });

  // v237 — the live stream needs a login.
  it('presents the session token, and no longer claims a role of its own', async () => {
    const { ctx, sockets } = load();
    await ctx.connectRealtime({});
    const url = new URL(sockets[0].url.replace(/^ws:/, 'http:'));
    expect(url.searchParams.get('token')).toBe('rpgs_testtoken');
    expect(url.searchParams.has('role')).toBe(false);
    expect(url.searchParams.has('charId')).toBe(false);
  });

  it('does not connect at all from a tab that is not logged in', async () => {
    const { ctx, sockets } = load({ session: null });
    await ctx.connectRealtime({ a: () => {} });
    expect(sockets).toHaveLength(0);
  });

  it('goes to the login page when the server ends the session (close code 4401)', async () => {
    const { ctx, sockets, store, replaced } = load();
    await ctx.connectRealtime({});
    sockets[0].onclose({ code: 4401 });
    expect(store.has('rpgSession')).toBe(false);
    expect(replaced[0]).toMatch(/^\/login\.html\?next=/);
  });
});

describe('connectRealtime — the SSE transport', () => {
  it('also opens only one stream', async () => {
    const { ctx, sources } = load({ dbProvider: 'instantdb' });
    await ctx.connectRealtime({ a: () => {} });
    await ctx.connectRealtime({ b: () => {} });
    expect(sources).toHaveLength(1);
  });

  it('subscribes to an event name first seen after the stream is open', async () => {
    const { ctx, sources } = load({ dbProvider: 'instantdb' });
    const seen = [];
    await ctx.connectRealtime({ a: () => {} });
    await ctx.connectRealtime({ notification: d => seen.push(d) });

    sources[0].deliver('notification', { id: 9 });
    expect(seen).toEqual([{ id: 9 }]);
  });
});
