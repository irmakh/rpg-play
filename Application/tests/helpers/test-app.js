/**
 * Builds a fresh Express app wired to an in-memory SQLite database.
 * Returns { app, ldb, masterPw } — use masterPw as X-Master-Password header in tests.
 *
 * Usage:
 *   import { makeApp } from '../helpers/test-app.js';
 *   const { app, ldb, masterPw } = makeApp();
 *   const res = await request(app).get('/api/initiative');
 */
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { makeLdb } from './make-ldb.js';

import registerInitiative  from '../../server/routes/initiative.js';
import registerTable       from '../../server/routes/table.js';
import registerCharacters  from '../../server/routes/characters.js';
import registerAuth        from '../../server/routes/auth.js';
import registerEvents      from '../../server/routes/events.js';
import registerTreasury    from '../../server/routes/treasury.js';
import registerSound       from '../../server/routes/sound.js';
import registerChat        from '../../server/routes/chat.js';
import registerNotifs      from '../../server/routes/notifications.js';
import registerMonsters    from '../../server/routes/monsters.js';
import registerLoot        from '../../server/routes/loot.js';
import makeNotify          from '../../server/notify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const TEST_MASTER_PW = 'test-master-pw-123';
const SHOP_CONFIG_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// ── Shop/treasury helpers (mirror server.js implementations) ──────────────────
function deductCurrency(wallet, amountCp) {
  let remaining = wallet.cp + wallet.sp * 10 + wallet.ep * 50 + wallet.gp * 100 + wallet.pp * 1000 - amountCp;
  const pp = Math.floor(remaining / 1000); remaining -= pp * 1000;
  const gp = Math.floor(remaining / 100);  remaining -= gp * 100;
  const ep = Math.floor(remaining / 50);   remaining -= ep * 50;
  const sp = Math.floor(remaining / 10);   remaining -= sp * 10;
  return { pp, gp, ep, sp, cp: remaining };
}
function cpToGpString(valueCp) {
  if (valueCp === 0) return '0 gp';
  if (valueCp % 100 === 0) return `${valueCp / 100} gp`;
  return `${(valueCp / 100).toFixed(2)} gp`;
}

// ── Auth helpers (mirror server.js implementations) ───────────────────────────
function isMasterPassword(pw) {
  if (!TEST_MASTER_PW || !pw || pw.length !== TEST_MASTER_PW.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(TEST_MASTER_PW)); } catch { return false; }
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
  } catch { return false; }
}

// ── Media constants ───────────────────────────────────────────────────────────
const IMAGE_MIME   = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']);
const SHARED_MEDIA_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav']);
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

async function processImageSizes(_mimeType, _buffer, folder, id) {
  return {
    original: `/uploads/${folder}/${id}.jpg`,
    thumb:    `/uploads/${folder}/${id}_thumb.jpg`,
    medium:   `/uploads/${folder}/${id}_medium.jpg`,
  };
}

// ── Minimal stub for shared_media DB (table map endpoints) ────────────────────
function makeMediaDbStub() {
  return {
    prepare: () => ({ run: () => {}, get: () => null }),
  };
}

export function makeApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Which campaign the in-flight request belongs to. Production resolves this
  // from a header, query param or cookie and stashes it in an AsyncLocalStorage
  // context; a test just names it with the same X-Campaign-Id header. Requests
  // that send no header behave like a single-campaign install.
  let activeCampaignId = '';
  app.use((req, _res, next) => {
    activeCampaignId = String(req.headers['x-campaign-id'] || '');
    next();
  });

  // One database per campaign, exactly as production keeps one SQLite file per
  // campaign (db/campaign-store.js). A shared store would have let a test pass
  // while a route leaked another campaign's rows.
  //
  // `ldb` is a proxy that resolves at property-access time, mirroring the
  // scopedProxy in lib/request-context.js: route modules destructure their
  // dependencies once at register() time, so a plain object would freeze one
  // campaign's handle into the closure forever.
  const stores = new Map();
  const ldbFor = (campaignId = '') => {
    let store = stores.get(campaignId);
    if (!store) { store = makeLdb(); stores.set(campaignId, store); }
    return store;
  };
  const ldb = new Proxy(Object.create(null), {
    get(_t, prop) {
      const target = ldbFor(activeCampaignId);
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_t, prop) { return prop in ldbFor(activeCampaignId); },
    ownKeys()     { return Reflect.ownKeys(ldbFor(activeCampaignId)); },
    getOwnPropertyDescriptor(_t, prop) {
      const d = Reflect.getOwnPropertyDescriptor(ldbFor(activeCampaignId), prop);
      return d ? { ...d, configurable: true } : undefined;
    },
  });

  const broadcasts = [];
  // Records the campaign each event was sent to, so tests can prove an event
  // never leaked into another campaign's stream, and whether it was addressed
  // to DM clients only (waiting screens gate the table channel that way).
  const broadcast = (channel, payload, _campaignId, opts) =>
    { broadcasts.push({ channel, payload, campaignId: activeCampaignId, dmOnly: !!(opts && opts.dmOnly) }); };
  // Records every deleteUploadFile() call so image-cleanup can be asserted.
  const deletedFiles = [];

  function masterAuth(req) {
    const pw = req.headers['x-master-password'];
    return pw === TEST_MASTER_PW;
  }

  async function charAuth(charId, req) {
    const char = ldb.getCharacter(charId);
    if (!char) return 404;
    if (char.passwordHash) {
      const pw = req.headers['x-character-password'];
      if (!pw || (!verifyPassword(pw, char.passwordHash) && !isMasterPassword(pw))) return 401;
    }
    return 200;
  }

  // Mirrors the Set in server.js that gates the static map URL.
  const parkedCampaigns = new Set();

  const mediaDbStub = makeMediaDbStub();
  const _mediaGetStub = { get: () => null };
  const _mapUpsertStub = { run: () => {} };

  const ctx = {
    ldb,
    genId: () => crypto.randomUUID(),
    masterAuth,
    charAuth,
    getCharacter: (id) => ldb.getCharacter(id),
    hashPassword,
    verifyPassword,
    isMasterPassword,
    IMAGE_MIME,
    ALLOWED_MIME,
    SHARED_MEDIA_MIME,
    MAX_MEDIA_BYTES,
    processImageSizes,
    saveUploadFile: () => '/uploads/test/stub.jpg',
    deleteUploadFile: (url) => { deletedFiles.push(url); },
    // Shop/treasury helpers
    getShopConfig: async () => {
      const cfg = ldb.getShopConfig();
      return { isOpen: !!cfg.isOpen, activeTag: cfg.activeTag || '', activeTags: cfg.activeTags || [] };
    },
    deductCurrency,
    cpToGpString,
    SHOP_CONFIG_ID,
    mediaDb: mediaDbStub,
    _mediaGet: _mediaGetStub,
    _mapUpsert: _mapUpsertStub,
    broadcast,
    crypto,
    path,
    fs,
    __dirname: path.resolve(__dirname, '../..'),
    readUploadAsBase64: () => null,
    extToMime: (p) => (String(p).endsWith('.png') ? 'image/png' : 'image/jpeg'),
    currentCampaignId: () => activeCampaignId,
    parkedCampaigns,
  };

  // notify() needs the finished ctx, and is attached before any route module —
  // exactly as in server.js.
  ctx.notify = makeNotify(ctx);

  registerInitiative(app, ctx);
  registerTable(app, ctx);
  registerCharacters(app, ctx);
  registerAuth(app, ctx);
  registerEvents(app, ctx);
  registerTreasury(app, ctx);
  registerSound(app, ctx);
  registerChat(app, ctx);
  registerNotifs(app, ctx);
  registerMonsters(app, ctx);
  registerLoot(app, ctx);

  return { app, ldb, ldbFor, masterPw: TEST_MASTER_PW, hashPassword, broadcasts, deletedFiles, parkedCampaigns };
}
