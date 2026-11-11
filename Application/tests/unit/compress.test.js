// Written by Irmak Hakman — 2026-11-12 10:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/compress.js — pages and scripts go out compressed; the live event
 * streams never do (compression would hold their events back).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { compress, compressFilter } from '../../lib/compress.js';

function app() {
  const a = express();
  a.use(compress());
  const big = '<p>' + 'spell text '.repeat(2000) + '</p>';
  a.get('/index.html', (req, res) => res.type('html').send(big));
  a.get('/js/x.js', (req, res) => res.type('application/javascript').send('const a = 1;'.repeat(500)));
  a.get('/tiny', (req, res) => res.type('text').send('ok'));
  for (const path of ['/api/events', '/api/console/events', '/api/other-stream']) {
    a.get(path, (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(': connected\n\n');
      res.end('data: ' + 'x'.repeat(3000) + '\n\n');
    });
  }
  return a;
}

describe('compression', () => {
  it('compresses pages and scripts for a browser that accepts it', async () => {
    const page = await request(app()).get('/index.html').set('Accept-Encoding', 'gzip');
    expect(page.headers['content-encoding']).toBe('gzip');
    expect(page.text).toContain('spell text');          // supertest unzips it
    const js = await request(app()).get('/js/x.js').set('Accept-Encoding', 'gzip');
    expect(js.headers['content-encoding']).toBe('gzip');
  });

  it('leaves tiny responses and browsers that ask for nothing alone', async () => {
    expect((await request(app()).get('/tiny').set('Accept-Encoding', 'gzip')).headers['content-encoding']).toBeUndefined();
    expect((await request(app()).get('/index.html').set('Accept-Encoding', 'identity')).headers['content-encoding']).toBeUndefined();
  });

  it('never compresses the live event streams, by path or by type', async () => {
    for (const path of ['/api/events', '/api/console/events', '/api/other-stream']) {
      const r = await request(app()).get(path).set('Accept-Encoding', 'gzip');
      expect([path, r.headers['content-encoding']]).toEqual([path, undefined]);
    }
  });

  it('the filter answers the same without a request in flight', () => {
    const res = { getHeader: () => 'text/event-stream' };
    expect(compressFilter({ path: '/anything', headers: {} }, res)).toBe(false);
    expect(compressFilter({ path: '/api/events', headers: {} }, { getHeader: () => 'text/html' })).toBe(false);
  });
});
