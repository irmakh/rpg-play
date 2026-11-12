// Written by Irmak Hakman — 2026-11-12 14:39
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * public/js/lib/realtime.js _wsBase(): the WebSocket address a page dials.
 * A WS_URL naming localhost must not reach a page opened from another machine
 * (a phone on the LAN), or that page is never live.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const src = fs.readFileSync(path.resolve(__dirname, '../../public/js/lib/realtime.js'), 'utf8');
const start = src.indexOf('function _wsBase(');
let depth = 0, end = src.indexOf('{', start);
for (let i = end; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
const fnSrc = src.slice(start, end);

function wsBaseAt(href, wsUrl) {
  const u = new URL(href);
  const ctx = { location: { hostname: u.hostname, host: u.host, protocol: u.protocol } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);
  return ctx._wsBase(wsUrl);
}

describe('_wsBase', () => {
  it('uses the page\'s own address when there is no WS_URL', () => {
    expect(wsBaseAt('http://192.168.68.104:3000/index.html', null)).toBe('ws://192.168.68.104:3000/ws');
    expect(wsBaseAt('https://example.com/table.html', null)).toBe('wss://example.com/ws');
  });

  it('ignores a localhost WS_URL on a page opened by IP', () => {
    expect(wsBaseAt('http://192.168.68.104:3000/index.html', 'ws://localhost:3000/ws')).toBe('ws://192.168.68.104:3000/ws');
    expect(wsBaseAt('http://192.168.68.104:3000/index.html', 'ws://127.0.0.1:80/ws')).toBe('ws://192.168.68.104:3000/ws');
  });

  it('keeps a localhost WS_URL on the server\'s own machine, and any real address everywhere', () => {
    expect(wsBaseAt('http://localhost:3000/index.html', 'ws://localhost:3000/ws')).toBe('ws://localhost:3000/ws');
    expect(wsBaseAt('http://192.168.68.104:3000/', 'https://play.example.com/ws')).toBe('wss://play.example.com/ws');
  });
});
