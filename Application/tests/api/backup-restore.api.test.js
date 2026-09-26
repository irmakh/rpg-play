// Written by Irmak Hakman — 2026-09-26 16:30

/**
 * Restoring a backup must never write outside this campaign's uploads.
 *
 * Until v235 a restore wrote each record's file to whatever '/uploads/...' URL
 * the record named, joined onto the public folder after a startsWith check — so
 * { dataUrl: '/uploads/../../server.js' } replaced the server's code. The images
 * archive checked the folder but not the extension or the campaign, so it could
 * plant an .html page or overwrite another campaign's files.
 *
 * These drive the real routes against a temporary folder and then look at what
 * actually landed on disk, rather than trusting a status code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { makeLdb } from '../helpers/make-ldb.js';
import { resolveUploadPath } from '../../lib/upload-paths.js';

// backup.js imports campaign-store.js, which opens the real campaign registry on
// import. Only campaignDir() is used, for the temporary export files.
let TMP;
vi.mock('../../db/campaign-store.js', () => ({ campaignDir: () => TMP }));

const { default: registerBackup } = await import('../../server/routes/backup.js');

const CAMP = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER = 'deadbeef-0000-4000-8000-000000000002';
const B64 = Buffer.from('bytes').toString('base64');

function makeBackupApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const publicDir = path.join(TMP, 'public');
  const uploadsDir = path.join(publicDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  // The in-memory test ldb has no bulk importers; these tests assert on what
  // reaches the DISK, so recording the call is all the database part needs.
  const ldb = Object.assign(makeLdb(), { importCharacters: () => {}, importMonsters: () => {} });
  const ctx = {
    ldb,
    masterAuth: () => true,
    processImageSizes: async () => { throw new Error('not an image'); },
    saveUploadFile: () => '/uploads/unused',
    readUploadAsBase64: () => null,
    uploadPath: (url, forWrite = false) => resolveUploadPath(uploadsDir, url, { campaignId: CAMP, forWrite }),
    IMAGE_MIME: new Set(['image/png']),
    extToMime: () => 'image/png',
    mediaDb: { prepare: () => ({ run: () => {}, get: () => null, all: () => [] }) },
    broadcast: () => {},
    currentCampaignId: () => CAMP,
    currentCampaign: () => ({ id: CAMP, slug: 'test' }),
    path, fs, __dirname: TMP,
  };
  registerBackup(app, ctx);
  return app;
}

/** A one-file ustar archive, gzipped — the shape restore-archive reads. */
function tarGz(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return zlib.gzipSync(Buffer.concat([h, body, pad, Buffer.alloc(1024)]));
}

beforeEach(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-restore-')); });
afterEach(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('POST /api/admin/restore — record files', () => {
  it('refuses a record that climbs out of uploads — the server.js overwrite', async () => {
    const app = makeBackupApp();
    const res = await request(app).post('/api/admin/restore').send({
      version: 2, type: 'characters', characters: [],
      media: [{ id: 'm1', charId: 'c1', mimeType: 'image/png', dataUrl: '/uploads/../../server.js', dataB64: B64 }],
    });
    expect(res.status).toBe(200);                                  // the rest of the restore carries on
    expect(fs.existsSync(path.join(TMP, 'server.js'))).toBe(false);
  });

  it('refuses an .html file even inside uploads', async () => {
    const app = makeBackupApp();
    await request(app).post('/api/admin/restore').send({
      version: 2, type: 'characters', characters: [],
      media: [{ id: 'm1', charId: 'c1', mimeType: 'image/png', dataUrl: `/uploads/${CAMP}/characters/x.html`, dataB64: B64 }],
    });
    expect(fs.existsSync(path.join(TMP, 'public', 'uploads', CAMP, 'characters', 'x.html'))).toBe(false);
  });

  it("still restores an ordinary file into this campaign's folder", async () => {
    const app = makeBackupApp();
    await request(app).post('/api/admin/restore').send({
      version: 2, type: 'characters', characters: [],
      media: [{ id: 'm1', charId: 'c1', mimeType: 'image/png', dataUrl: `/uploads/${CAMP}/characters/ok.png`, dataB64: B64 }],
    });
    expect(fs.readFileSync(path.join(TMP, 'public', 'uploads', CAMP, 'characters', 'ok.png'), 'utf8')).toBe('bytes');
  });

  it('restores a single-monster export — it used to throw "monster is not defined"', async () => {
    const app = makeBackupApp();
    const res = await request(app).post('/api/admin/restore').send({
      version: '1.0', type: 'monster', monsters: [{ id: crypto.randomUUID(), name: 'Goblin', cr: '1/4', dataJson: '{}' }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, type: 'monster' });
  });
});

describe('POST /api/admin/restore-archive — images archive', () => {
  const send = (app, buf) => request(app).post('/api/admin/restore-archive')
    .set('Content-Type', 'application/gzip').send(buf);

  it('writes an image into this campaign', async () => {
    const res = await send(makeBackupApp(), tarGz(`uploads/${CAMP}/media/a.png`, Buffer.from('img')));
    expect(res.body).toMatchObject({ ok: true, images: 1, skipped: 0 });
    expect(fs.existsSync(path.join(TMP, 'public', 'uploads', CAMP, 'media', 'a.png'))).toBe(true);
  });

  it('skips an .html page', async () => {
    const res = await send(makeBackupApp(), tarGz(`uploads/${CAMP}/media/evil.html`, Buffer.from('<script>')));
    expect(res.status).toBe(400);                                  // nothing restorable
    expect(fs.existsSync(path.join(TMP, 'public', 'uploads', CAMP, 'media', 'evil.html'))).toBe(false);
  });

  it("skips another campaign's folder", async () => {
    await send(makeBackupApp(), tarGz(`uploads/${OTHER}/media/a.png`, Buffer.from('img')));
    expect(fs.existsSync(path.join(TMP, 'public', 'uploads', OTHER))).toBe(false);
  });

  it('skips a climb out of uploads', async () => {
    await send(makeBackupApp(), tarGz('uploads/../../server.js', Buffer.from('pwned')));
    expect(fs.existsSync(path.join(TMP, 'server.js'))).toBe(false);
  });
});
