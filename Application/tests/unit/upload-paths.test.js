/**
 * Tests for the two pieces of server.js that decide where an upload lives and
 * who is allowed to read a parked campaign's map.
 *
 * Both are security- and data-shaped:
 *   · uploadSubPath() puts a new upload under uploads/<campaignId>/, which is
 *     what stops two campaigns writing over each other's files.
 *   · TABLE_MAP_FILE decides whether a request for a table map is refused while
 *     its campaign is parked on a waiting screen. Getting it wrong either leaks
 *     the map the players are not meant to see, or blanks the map for campaigns
 *     that are not parked at all — the bug that sent us here.
 *
 * Three filename layouts exist on disk and all three must keep working:
 *   /maps/table-map.png             the original, shared by every campaign
 *   /maps/table-map-<id>.png        per-campaign filename
 *   /<id>/maps/table-map-<id>.png   per-campaign directory (what is written now)
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../server.js'), 'utf-8');

function extractFunction(src, name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`Function "${name}" not found — was it renamed?`);
  let depth = 0, i = m.index;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return src.slice(m.index, i + 1);
}

// ── uploadSubPath ─────────────────────────────────────────────────────────────
function loadUploadSubPath(campaignId) {
  const ctx = createContext({ String, currentCampaignId: () => campaignId });
  runInContext(extractFunction(SRC, 'uploadSubPath'), ctx);
  return ctx.uploadSubPath;
}

describe('uploadSubPath — new uploads are per campaign', () => {
  it('puts an upload under the campaign id', () => {
    expect(loadUploadSubPath('c0000000-0000-4000-8000-000000000001')('maps'))
      .toBe('c0000000-0000-4000-8000-000000000001/maps');
  });

  it('keeps each subdirectory beneath the campaign', () => {
    const p = loadUploadSubPath('abc123');
    expect(p('characters')).toBe('abc123/characters');
    expect(p('sounds')).toBe('abc123/sounds');
    expect(p('waiting')).toBe('abc123/waiting');
  });

  it('two campaigns never share a path for the same file', () => {
    expect(loadUploadSubPath('aaa')('maps')).not.toBe(loadUploadSubPath('bbb')('maps'));
  });

  it('falls back to the flat layout when no campaign resolves', () => {
    expect(loadUploadSubPath('')('maps')).toBe('maps');
    expect(loadUploadSubPath(null)('maps')).toBe('maps');
    expect(loadUploadSubPath(undefined)('maps')).toBe('maps');
  });

  it('strips anything that could escape the uploads directory', () => {
    // A campaign id is generated, never user input — but a path is being built.
    expect(loadUploadSubPath('../../etc')('maps')).toBe('.._.._etc/maps'.replace(/_/g, ''));
    expect(loadUploadSubPath('a/b')('maps')).toBe('ab/maps');
  });

  it('survives a throwing campaign resolver', () => {
    const ctx = createContext({
      String,
      currentCampaignId: () => { throw new Error('outside a request'); },
    });
    runInContext(extractFunction(SRC, 'uploadSubPath'), ctx);
    expect(ctx.uploadSubPath('maps')).toBe('maps');
  });
});

// ── The parked-map gate ───────────────────────────────────────────────────────
const TABLE_MAP_FILE = (() => {
  const m = /const TABLE_MAP_FILE = (\/.*\/);/.exec(SRC);
  if (!m) throw new Error('TABLE_MAP_FILE not found — was it renamed?');
  return eval(m[1]);   // the literal straight out of the source
})();

/** Mirrors the middleware's decision so the test exercises the real rule. */
function isBlocked(reqPath, parked) {
  const m = TABLE_MAP_FILE.exec(reqPath);
  if (!m) return false;
  const owner = m[1] || m[2];
  return owner ? parked.has(owner) : parked.size > 0;
}

describe('table map gate — matches only table maps', () => {
  const cases = [
    ['/maps/table-map.png', true],
    ['/maps/table-map-abc123.jpg', true],
    ['/abc123/maps/table-map-abc123.png', true],
    ['/maps/prep-map-xyz.png', false],
    ['/abc123/maps/prep-map-xyz.png', false],
    ['/characters/portrait.jpg', false],
    ['/abc123/waiting/screen.jpg', false],
    ['/maps/table-map-abc.png.txt', false],
  ];
  for (const [p, expected] of cases) {
    it(`${expected ? 'matches' : 'ignores'} ${p}`, () => {
      expect(!!TABLE_MAP_FILE.exec(p)).toBe(expected);
    });
  }
});

describe('table map gate — refuses only the parked campaign', () => {
  it('blocks a parked campaign\'s own map (per-campaign directory)', () => {
    expect(isBlocked('/aaa/maps/table-map-aaa.png', new Set(['aaa']))).toBe(true);
  });

  it('blocks a parked campaign\'s own map (per-campaign filename)', () => {
    expect(isBlocked('/maps/table-map-aaa.png', new Set(['aaa']))).toBe(true);
  });

  /**
   * The regression that started this: one campaign parked used to close the map
   * for every campaign, because the file had no owner in its name.
   */
  it('does NOT block another campaign while one is parked', () => {
    expect(isBlocked('/bbb/maps/table-map-bbb.png', new Set(['aaa']))).toBe(false);
    expect(isBlocked('/maps/table-map-bbb.png', new Set(['aaa']))).toBe(false);
  });

  it('serves a map when nothing is parked', () => {
    expect(isBlocked('/aaa/maps/table-map-aaa.png', new Set())).toBe(false);
    expect(isBlocked('/maps/table-map.png', new Set())).toBe(false);
  });

  it('blocks every campaign that is parked', () => {
    const parked = new Set(['aaa', 'bbb']);
    expect(isBlocked('/aaa/maps/table-map-aaa.png', parked)).toBe(true);
    expect(isBlocked('/bbb/maps/table-map-bbb.png', parked)).toBe(true);
    expect(isBlocked('/ccc/maps/table-map-ccc.png', parked)).toBe(false);
  });

  it('keeps the conservative rule for a legacy name with no owner in it', () => {
    // It could belong to any campaign, so any parked campaign closes it.
    expect(isBlocked('/maps/table-map.png', new Set(['aaa']))).toBe(true);
    expect(isBlocked('/maps/table-map.png', new Set())).toBe(false);
  });

  it('prefers the directory over the filename when both name a campaign', () => {
    expect(isBlocked('/aaa/maps/table-map-bbb.png', new Set(['aaa']))).toBe(true);
    expect(isBlocked('/aaa/maps/table-map-bbb.png', new Set(['bbb']))).toBe(false);
  });

  it('never blocks something that is not a table map', () => {
    expect(isBlocked('/aaa/maps/prep-map-1.png', new Set(['aaa']))).toBe(false);
    expect(isBlocked('/aaa/characters/portrait.jpg', new Set(['aaa']))).toBe(false);
  });
});
