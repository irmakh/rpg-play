// Written by Irmak Hakman — 2026-11-12 10:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Gzip / brotli for every response the browser can take compressed.
 *
 * Until v328 nothing was compressed: the character sheet alone loaded about
 * 600 KB of scripts and styles plus an 89 KB page, sent as they are, and all of
 * it again after every release (a new version is a new URL). Text like this
 * shrinks to a quarter or less.
 *
 * The live streams are left alone. Compression holds a response back until it
 * has enough to compress, which would sit on every chat line and token move a
 * server-sent-event stream is meant to deliver at once.
 */
import compression from 'compression';

const STREAMS = new Set(['/api/events', '/api/console/events']);

/** Whether this response may be compressed. */
export function compressFilter(req, res) {
  if (STREAMS.has(req.path)) return false;
  const type = String(res.getHeader('Content-Type') || '');
  if (type.startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
}

export function compress() {
  return compression({ filter: compressFilter, threshold: 1024 });
}
