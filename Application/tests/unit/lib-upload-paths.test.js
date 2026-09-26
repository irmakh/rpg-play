// Written by Irmak Hakman — 2026-09-26 16:30

/**
 * lib/upload-paths.js — the single rule for where an uploaded file may live.
 *
 * Until v235 every read, write and delete of an upload checked only that a URL
 * STARTED with '/uploads/'. A restored backup carries those URLs, plus ids that
 * become filenames and MIME types that become extensions, so a crafted backup
 * could write over server.js or plant an .html page on this origin. These tests
 * pin each way out shut, and each legitimate layout still open.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveUploadPath, mimeToExt, safeFileId } from '../../lib/upload-paths.js';

const ROOT = path.resolve('/srv/app/public/uploads');
const CAMP = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER = 'deadbeef-0000-4000-8000-000000000002';
const at = (url, opts = {}) => resolveUploadPath(ROOT, url, { campaignId: CAMP, ...opts });

describe('resolveUploadPath — paths that stay put', () => {
  it("accepts a file in this campaign's own folder", () => {
    expect(at(`/uploads/${CAMP}/maps/a.png`)).toBe(path.join(ROOT, CAMP, 'maps', 'a.png'));
  });

  it('accepts a file in a legacy shared folder, written before campaigns had folders', () => {
    expect(at('/uploads/characters/a.jpg')).toBe(path.join(ROOT, 'characters', 'a.jpg'));
  });

  it('ignores a ?v= cache-buster the way a browser request would', () => {
    expect(at(`/uploads/${CAMP}/maps/a.png?v=123`)).toBe(path.join(ROOT, CAMP, 'maps', 'a.png'));
  });
});

describe('resolveUploadPath — the ways out', () => {
  it('refuses climbing out of uploads — the server.js overwrite', () => {
    expect(at('/uploads/../../server.js')).toBeNull();
    expect(at(`/uploads/${CAMP}/../../../server.js`)).toBeNull();
  });

  it('refuses an encoded climb, decoded exactly as express.static would', () => {
    expect(at('/uploads/%2e%2e/%2e%2e/server.js')).toBeNull();
    expect(at('/uploads/characters/%2e%2e%2f%2e%2e%2f.env')).toBeNull();
  });

  it("refuses another campaign's folder", () => {
    expect(at(`/uploads/${OTHER}/maps/a.png`)).toBeNull();
  });

  it('refuses anything not under /uploads/, and non-strings', () => {
    expect(at('/etc/passwd')).toBeNull();
    expect(at('uploads/characters/a.jpg')).toBeNull();
    expect(at(null)).toBeNull();
    expect(at({ toString: () => '/uploads/characters/a.jpg' })).toBeNull();
  });

  it('refuses the uploads folder itself and a loose file at its top', () => {
    expect(at('/uploads/')).toBeNull();
    expect(at('/uploads/loose.png')).toBeNull();
  });

  it('refuses a NUL byte and malformed encoding', () => {
    expect(at('/uploads/characters/a.jpg%00.html')).toBeNull();
    expect(at('/uploads/characters/%E0%A4%A.jpg')).toBeNull();
  });

  it('with no campaign, allows only the legacy shared folders', () => {
    expect(resolveUploadPath(ROOT, `/uploads/${CAMP}/maps/a.png`, {})).toBeNull();
    expect(resolveUploadPath(ROOT, '/uploads/maps/a.png', {})).toBe(path.join(ROOT, 'maps', 'a.png'));
  });
});

describe('resolveUploadPath — writing', () => {
  it('writes only media extensions', () => {
    expect(at(`/uploads/${CAMP}/media/a.webp`, { forWrite: true })).not.toBeNull();
    expect(at(`/uploads/${CAMP}/sounds/a.mp3`, { forWrite: true })).not.toBeNull();
  });

  it('refuses to write anything a browser would run', () => {
    for (const ext of ['html', 'htm', 'svg', 'js', 'mjs', 'xml', 'php', '']) {
      expect(at(`/uploads/${CAMP}/media/a${ext ? '.' + ext : ''}`, { forWrite: true })).toBeNull();
    }
  });

  it('still lets an existing file of any kind be READ or deleted', () => {
    // A legacy .bin written long ago must stay reachable for export/cleanup.
    expect(at(`/uploads/${CAMP}/media/a.bin`)).not.toBeNull();
  });
});

describe('mimeToExt', () => {
  it('maps every accepted media type', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('audio/x-wav')).toBe('wav');
    expect(mimeToExt('video/webm')).toBe('webm');
  });

  it("never lifts an extension out of the MIME type — 'text/html' used to give .html", () => {
    expect(mimeToExt('text/html')).toBe('bin');
    expect(mimeToExt('image/svg+xml')).toBe('bin');
    expect(mimeToExt('x/../../js')).toBe('bin');
    expect(mimeToExt(undefined)).toBe('bin');
  });
});

describe('safeFileId', () => {
  it('keeps ordinary ids unchanged', () => {
    expect(safeFileId('prep-map-3f2a_9')).toBe('prep-map-3f2a_9');
  });

  it("strips a '../' id down to harmless characters", () => {
    expect(safeFileId('../../../../server')).toBe('server');
    expect(safeFileId('a/b\\c.d')).toBe('abcd');
    expect(safeFileId('../..')).toBe('');
  });
});
