/**
 * API tests for logging in: the maths captcha, the lockout, the session token
 * every login now returns, the super-admin login, logout, the Stories gate and
 * the login audit.
 *
 * The character + DM cases that were here before are all kept; each one now
 * solves a captcha first, exactly as the login forms do.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_SUPER_PW } from '../helpers/test-app.js';

let app, ldb, masterPw, hashPassword, captcha, sessions, auditEvents, broadcasts;

beforeEach(() => {
  ({ app, ldb, masterPw, hashPassword, captcha, sessions, auditEvents, broadcasts } = makeApp());
  ldb.createCharacter('c1', { name: 'Aliyr', charType: 'pc', passwordHash: hashPassword('secret') });
  ldb.createCharacter('c2', { name: 'Nopass', charType: 'pc', passwordHash: '' });
  ldb.createCharacter('c3', { name: 'Gerion', charType: 'pc', passwordHash: hashPassword('other') });
});

/** Fetches a captcha and returns the two fields a form sends, correctly solved. */
async function solved() {
  const res = await request(app).get('/api/auth/captcha');
  expect(res.status).toBe(200);
  return { captchaId: res.body.id, captchaAnswer: String(captcha._answerOf(res.body.id)) };
}

const login = async (body, cap) => request(app).post('/api/auth/login').send({ ...(cap || await solved()), ...body });

const securityAlerts = () => broadcasts.filter(b => JSON.stringify(b.payload || {}).includes('"security"'));

describe('GET /api/auth/captcha', () => {
  it('returns a one-time id and a PNG of the problem, never cached', async () => {
    const res = await request(app).get('/api/auth/captcha');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(res.body.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);   // PNG signature
    expect(res.body.expiresIn).toBe(300);
    expect(res.body).not.toHaveProperty('answer');
  });
});

describe('POST /api/auth/login — character', () => {
  it('logs in with the correct character password and returns a session', async () => {
    const res = await login({ type: 'character', characterId: 'c1', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'character', characterId: 'c1', characterName: 'Aliyr' });
    expect(res.body.token).toMatch(/^rpgs_/);
    expect(sessions.resolve(res.body.token)).toMatchObject({ role: 'character', charId: 'c1' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('rejects a wrong character password', async () => {
    const res = await login({ type: 'character', characterId: 'c1', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
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

  it('returns needsSetup and a setup ticket for a passwordless character', async () => {
    const res = await login({ type: 'character', characterId: 'c2', password: 'whatever' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsSetup: true, characterId: 'c2' });
    expect(typeof res.body.setupTicket).toBe('string');
    expect(res.body.token).toBeUndefined();
  });

  it('carries the setup ticket through to choosing the first password', async () => {
    const first = await login({ type: 'character', characterId: 'c2', password: 'x' });
    const set = await request(app).put('/api/characters/c2/password')
      .send({ new_password: 'chosen', setupTicket: first.body.setupTicket });
    expect(set.status).toBe(200);
    expect(set.body.token).toMatch(/^rpgs_/);
    const again = await login({ type: 'character', characterId: 'c2', password: 'chosen' });
    expect(again.status).toBe(200);
  });

  it('404s for an unknown character', async () => {
    const res = await login({ type: 'character', characterId: 'ghost', password: 'secret' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/login — dm', () => {
  it('logs in with the master password and returns a DM session', async () => {
    const res = await login({ type: 'dm', password: masterPw });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, role: 'dm' });
    expect(sessions.resolve(res.body.token)).toMatchObject({ role: 'dm' });
  });

  it('rejects a wrong master password', async () => {
    const res = await login({ type: 'dm', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('opens DM routes with the token it returns', async () => {
    const { body } = await login({ type: 'dm', password: masterPw });
    const res = await request(app).get('/api/treasury/all').set('X-Master-Password', body.token);
    expect(res.status).toBe(200);
  });
});

describe('the captcha gate', () => {
  it('refuses a login with no captcha — even with the right password', async () => {
    const res = await request(app).post('/api/auth/login').send({ type: 'dm', password: masterPw });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CAPTCHA_REQUIRED');
    expect(res.body.token).toBeUndefined();
  });

  it('refuses a wrong answer', async () => {
    const cap = await solved();
    const res = await login({ type: 'dm', password: masterPw }, { ...cap, captchaAnswer: String(Number(cap.captchaAnswer) + 1) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CAPTCHA_WRONG');
  });

  it('accepts each captcha once', async () => {
    const cap = await solved();
    expect((await login({ type: 'dm', password: masterPw }, cap)).status).toBe(200);
    const reused = await login({ type: 'dm', password: masterPw }, cap);
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('CAPTCHA_EXPIRED');
  });

  it('spends the captcha on a wrong answer too', async () => {
    const cap = await solved();
    await login({ type: 'dm', password: masterPw }, { ...cap, captchaAnswer: '-1' });
    const retry = await login({ type: 'dm', password: masterPw }, cap);
    expect(retry.body.code).toBe('CAPTCHA_EXPIRED');
  });

  it('refuses an unknown captcha id', async () => {
    const res = await login({ type: 'dm', password: masterPw }, { captchaId: 'made-up', captchaAnswer: '4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CAPTCHA_EXPIRED');
  });
});

describe('lockout', () => {
  it('locks an account after 5 wrong passwords — even against the right one', async () => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await login({ type: 'character', characterId: 'c1', password: 'nope' })).status);
    expect(codes).toEqual([401, 401, 401, 401, 429]);

    const right = await login({ type: 'character', characterId: 'c1', password: 'secret' });
    expect(right.status).toBe(429);
    expect(right.body.code).toBe('LOCKED');
    expect(Number(right.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('locks only that account: someone else at the same table still logs in', async () => {
    for (let i = 0; i < 5; i++) await login({ type: 'character', characterId: 'c1', password: 'nope' });
    expect((await login({ type: 'character', characterId: 'c3', password: 'other' })).status).toBe(200);
    expect((await login({ type: 'dm', password: masterPw })).status).toBe(200);
  });

  it('counts wrong captcha answers toward the lock', async () => {
    for (let i = 0; i < 4; i++) {
      const cap = await solved();
      await login({ type: 'dm', password: masterPw }, { ...cap, captchaAnswer: '-1' });
    }
    const fifth = await login({ type: 'dm', password: 'wrong' });
    expect(fifth.status).toBe(429);
  });

  it('tells the DM once an account collects 5 wrong passwords', async () => {
    for (let i = 0; i < 4; i++) await login({ type: 'character', characterId: 'c1', password: 'nope' });
    expect(securityAlerts()).toHaveLength(0);
    await login({ type: 'character', characterId: 'c1', password: 'nope' });
    expect(securityAlerts()).toHaveLength(1);
    expect(JSON.stringify(securityAlerts()[0].payload)).toContain('Aliyr');
  });

  it('does not alert the DM over wrong captcha answers alone', async () => {
    for (let i = 0; i < 5; i++) {
      const cap = await solved();
      await login({ type: 'dm', password: masterPw }, { ...cap, captchaAnswer: '-1' });
    }
    expect(securityAlerts()).toHaveLength(0);
  });
});

describe('POST /api/auth/admin-login', () => {
  it('returns an admin session for the super-admin password', async () => {
    const res = await request(app).post('/api/auth/admin-login').send({ password: TEST_SUPER_PW, ...(await solved()) });
    expect(res.status).toBe(200);
    expect(sessions.resolve(res.body.token)).toMatchObject({ role: 'admin' });
  });

  it('refuses a campaign DM password', async () => {
    const res = await request(app).post('/api/auth/admin-login').send({ password: masterPw, ...(await solved()) });
    expect(res.status).toBe(401);
  });

  it('needs the captcha like every other login', async () => {
    const res = await request(app).post('/api/auth/admin-login').send({ password: TEST_SUPER_PW });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session on the server, so a copied token stops working', async () => {
    const { body } = await login({ type: 'dm', password: masterPw });
    expect((await request(app).post('/api/auth/logout').send({ token: body.token })).status).toBe(200);
    expect(sessions.resolve(body.token)).toBeNull();
    const after = await request(app).get('/api/treasury/all').set('X-Master-Password', body.token);
    expect(after.status).toBe(401);
  });

  it("records a character's logout with the character's name, not a bare id", async () => {
    const { body } = await login({ type: 'character', characterId: 'c1', password: 'secret' });
    await request(app).post('/api/auth/logout').send({ token: body.token });
    const out = auditEvents.filter(e => e.kind === 'logout').pop();
    expect(out).toMatchObject({ role: 'character', charId: 'c1', charName: 'Aliyr' });
  });

  it('is harmless for an unknown token', async () => {
    const res = await request(app).post('/api/auth/logout').send({ token: 'rpgs_nothing' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/verify-any (Stories gate)', () => {
  const verify = async (password, cap) =>
    request(app).post('/api/auth/verify-any').send({ password, ...(cap || await solved()) });

  it("accepts any character's password", async () => {
    expect((await verify('other')).status).toBe(200);
  });

  it('accepts the DM password', async () => {
    expect((await verify(masterPw)).status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    expect((await verify('nobody')).status).toBe(401);
  });

  it('needs the captcha', async () => {
    const res = await request(app).post('/api/auth/verify-any').send({ password: 'other' });
    expect(res.status).toBe(400);
  });
});

describe('login audit', () => {
  it('records successes, wrong passwords and wrong captcha answers', async () => {
    await login({ type: 'character', characterId: 'c1', password: 'secret' });
    await login({ type: 'character', characterId: 'c1', password: 'nope' });
    const cap = await solved();
    await login({ type: 'dm', password: masterPw }, { ...cap, captchaAnswer: '-1' });
    const kinds = auditEvents.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['login', 'login-fail', 'captcha-fail']));
    const ok = auditEvents.find(e => e.kind === 'login');
    expect(ok).toMatchObject({ role: 'character', charId: 'c1', charName: 'Aliyr' });
    expect(ok).toHaveProperty('ip');
  });
});
