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

import registerInitiative from '../../server/routes/initiative.js';
import registerTable      from '../../server/routes/table.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const TEST_MASTER_PW = 'test-master-pw-123';

// Minimal stub for the shared_media DB used by table map endpoints.
// Token / state tests never hit map endpoints — this prevents the table
// route module from crashing during registration.
function makeMediaDbStub() {
  return {
    prepare: () => ({ run: () => {}, get: () => null }),
  };
}

export function makeApp() {
  const ldb = makeLdb();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const broadcast = () => {};

  function masterAuth(req) {
    const pw = req.headers['x-master-password'];
    return pw === TEST_MASTER_PW;
  }

  async function charAuth(charId, req) {
    const char = ldb.getCharacter(charId);
    if (!char) return 404;
    // In tests characters have no password unless explicitly set
    if (char.passwordHash) {
      const pw = req.headers['x-character-password'];
      if (!pw) return 401;
    }
    return 200;
  }

  const mediaDbStub = makeMediaDbStub();
  const _mediaGetStub = { get: () => null };
  const _mapUpsertStub = { run: () => {} };

  const ctx = {
    ldb,
    idb: null,
    DB_PROVIDER: 'localdb',
    genId: () => crypto.randomUUID(),
    masterAuth,
    charAuth,
    getCharacter: (id) => ldb.getCharacter(id),
    saveUploadFile: () => '/uploads/test/stub.jpg',
    deleteUploadFile: () => {},
    mediaDb: mediaDbStub,
    _mediaGet: _mediaGetStub,
    _mapUpsert: _mapUpsertStub,
    broadcast,
    crypto,
    path,
    fs,
    __dirname: path.resolve(__dirname, '../..'),
    chatLog: [],
    CHAT_MAX: 100,
  };

  registerInitiative(app, ctx);
  registerTable(app, ctx);

  return { app, ldb, masterPw: TEST_MASTER_PW };
}
