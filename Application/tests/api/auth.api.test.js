/**
 * API tests for /api/auth/login — character + DM login, including the DM
 * master password being able to log in as any character.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp } from '../helpers/test-app.js';

let app, ldb, masterPw, hashPassword;

beforeEach(() => {
  ({ app, ldb, masterPw, hashPassword } = makeApp());
  ldb.createCharacter('c1', { name: 'Aliyr', charType: 'pc', passwordHash: hashPassword('secret') });
  ldb.createCharacter('c2', { name: 'Nopass', charType: 'pc', passwordHash: '' });
});

const login = (body) => request(app).post('/api/auth/login').send(body);

describe('POST /api/auth/login — character', () => {
  it('logs in with the correct character password', async () => {
    const res = await login({ type: 'character', characterId: 'c1', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'character', characterId: 'c1', characterName: 'Aliyr' });
  });

  it('rejects a wrong character password', async () => {
    const res = await login({ type: 'character', characterId: 'c1', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('logs into any character with the DM master password', async () => {
    const res = await login({ type: 'character', characterId: 'c1', password: masterPw });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'character', characterId: 'c1' });
  });

  it('logs into a passwordless character with the DM master password (no setup step)', async () => {
    const res = await login({ type: 'character', characterId: 'c2', password: masterPw });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'character', characterId: 'c2' });
    expect(res.body.needsSetup).toBeUndefined();
  });

  it('still returns needsSetup for a passwordless character with a non-master password', async () => {
    const res = await login({ type: 'character', characterId: 'c2', password: 'whatever' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsSetup: true, characterId: 'c2' });
  });

  it('404s for an unknown character', async () => {
    const res = await login({ type: 'character', characterId: 'ghost', password: 'secret' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/login — dm', () => {
  it('logs in with the master password', async () => {
    const res = await login({ type: 'dm', password: masterPw });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'dm' });
  });

  it('rejects a wrong master password', async () => {
    const res = await login({ type: 'dm', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
