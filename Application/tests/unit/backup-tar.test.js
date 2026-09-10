/**
 * Unit tests for the tar format used by the backup archives in
 * server/routes/backup.js — tarHeader() writes it, extractTar() reads it back.
 *
 * These two must agree exactly: the archive a DM downloads is the archive the
 * restore endpoint has to parse. The format is a minimal POSIX ustar written by
 * hand (no dependency), so a round-trip test is the thing that keeps the writer
 * and the reader from drifting apart.
 *
 * tarHeader is module-level; extractTar lives inside register(). Both are pulled
 * out by brace-counting — neither body contains a brace inside a regex, which
 * that technique cannot survive.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../server/routes/backup.js'), 'utf-8');

function extractFunction(src, name) {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`);
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

function load() {
  const ctx = createContext({ Buffer, Math, parseInt, String, Number });
  runInContext(extractFunction(SRC, 'tarHeader'), ctx);
  runInContext(extractFunction(SRC, 'extractTar'), ctx);
  return { tarHeader: ctx.tarHeader, extractTar: ctx.extractTar };
}

const { tarHeader, extractTar } = load();

// Builds a complete tar from [{ name, body }] using the production header writer.
function buildTar(files) {
  const parts = [];
  for (const f of files) {
    const body = Buffer.from(f.body);
    parts.push(tarHeader(f.name, body.length, Date.now()));
    parts.push(body);
    const rem = body.length % 512;
    if (rem) parts.push(Buffer.alloc(512 - rem));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

// Reads a tar back through extractTar, collecting each entry.
async function readTar(buf, { chunkSize = 0 } = {}) {
  const entries = [];
  const source = chunkSize
    ? Readable.from((function* () {
        for (let i = 0; i < buf.length; i += chunkSize) yield buf.subarray(i, i + chunkSize);
      })())
    : Readable.from([buf]);
  await extractTar(source, async (name, size) => {
    const chunks = [];
    entries.push({ name, size, get body() { return Buffer.concat(chunks).toString('utf8'); } });
    return { write: async (c) => { chunks.push(Buffer.from(c)); }, end: async () => {} };
  });
  return entries;
}

describe('tar round-trip — writer and reader agree', () => {
  it('round-trips a single file', async () => {
    const entries = await readTar(buildTar([{ name: 'maps.json', body: '{"type":"maps"}' }]));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('maps.json');
    expect(entries[0].body).toBe('{"type":"maps"}');
  });

  it('round-trips several files in order', async () => {
    const files = [
      { name: 'characters.json', body: '{"a":1}' },
      { name: 'monsters.json',   body: '{"b":2}' },
      { name: 'treasury.json',   body: '{"c":3}' },
    ];
    const entries = await readTar(buildTar(files));
    expect(entries.map(e => e.name)).toEqual(files.map(f => f.name));
    expect(entries.map(e => e.body)).toEqual(files.map(f => f.body));
  });

  it('reports the declared size', async () => {
    const body = 'x'.repeat(1000);
    const [e] = await readTar(buildTar([{ name: 'a.json', body }]));
    expect(e.size).toBe(1000);
    expect(e.body).toHaveLength(1000);
  });

  it('handles a body that exactly fills a 512-byte block', async () => {
    const body = 'y'.repeat(512);
    const [e] = await readTar(buildTar([{ name: 'block.json', body }]));
    expect(e.size).toBe(512);
    expect(e.body).toBe(body);
  });

  it('handles a body spanning many blocks', async () => {
    const body = 'z'.repeat(512 * 7 + 13);
    const [e] = await readTar(buildTar([{ name: 'big.json', body }]));
    expect(e.body).toBe(body);
  });

  it('handles an empty file', async () => {
    const entries = await readTar(buildTar([{ name: 'empty.json', body: '' }, { name: 'after.json', body: 'ok' }]));
    expect(entries.map(e => e.name)).toEqual(['empty.json', 'after.json']);
    expect(entries[1].body).toBe('ok');
  });

  it('preserves a nested path', async () => {
    const [e] = await readTar(buildTar([{ name: 'uploads/maps/prep-map-abc.png', body: 'PNG' }]));
    expect(e.name).toBe('uploads/maps/prep-map-abc.png');
  });

  it('preserves UTF-8 content', async () => {
    const body = JSON.stringify({ name: 'Gerion — The Maimed', note: 'café ✦' });
    const [e] = await readTar(buildTar([{ name: 'u.json', body }]));
    expect(JSON.parse(e.body).name).toBe('Gerion — The Maimed');
  });

  it('stops at the end-of-archive blocks', async () => {
    const tar = Buffer.concat([buildTar([{ name: 'one.json', body: 'a' }]), Buffer.alloc(4096)]);
    expect(await readTar(tar)).toHaveLength(1);
  });

  it('reassembles entries split across arbitrary chunk boundaries', async () => {
    // The reader sees network-sized chunks, not whole files — a header or a body
    // can land split in half.
    const files = [
      { name: 'characters.json', body: JSON.stringify({ v: 'a'.repeat(2000) }) },
      { name: 'uploads/media/x.jpg', body: 'b'.repeat(1500) },
    ];
    const tar = buildTar(files);
    for (const chunkSize of [1, 7, 100, 511, 512, 513, 1024]) {
      const entries = await readTar(tar, { chunkSize });
      expect(entries.map(e => e.name), `chunkSize ${chunkSize}`).toEqual(files.map(f => f.name));
      expect(entries.map(e => e.body), `chunkSize ${chunkSize}`).toEqual(files.map(f => f.body));
    }
  });

  it('reads a gzipped archive, the form actually downloaded', async () => {
    const files = [{ name: 'maps.json', body: '{"type":"maps"}' }, { name: 'uploads/maps/m.png', body: 'IMG' }];
    const gz = zlib.gzipSync(buildTar(files));
    const entries = await readTar(zlib.gunzipSync(gz));
    expect(entries.map(e => e.name)).toEqual(files.map(f => f.name));
  });
});

describe('tarHeader — the bytes GNU tar relies on', () => {
  it('writes the name at offset 0', () => {
    expect(tarHeader('maps.json', 10, Date.now()).subarray(0, 9).toString()).toBe('maps.json');
  });

  it('writes the size as NUL-terminated octal', () => {
    const h = tarHeader('a', 1000, Date.now());
    expect(h.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()).toBe('00000001750');
    expect(parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8)).toBe(1000);
  });

  it('marks the entry as a regular file', () => {
    expect(tarHeader('a', 1, Date.now())[156]).toBe('0'.charCodeAt(0));
  });

  it('writes the ustar magic', () => {
    expect(tarHeader('a', 1, Date.now()).subarray(257, 262).toString()).toBe('ustar');
  });

  it('writes a checksum matching the rest of the header', () => {
    const h = tarHeader('checksum.json', 42, Date.now());
    const stored = parseInt(h.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    // Recompute the way tar does: checksum field read as spaces.
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    expect(stored).toBe(sum);
  });

  it('produces exactly one 512-byte block', () => {
    expect(tarHeader('a', 1, Date.now())).toHaveLength(512);
  });
});
