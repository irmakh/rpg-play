/**
 * Response headers, body limits and the session gate
 * (lib/security-middleware.js), each on a tiny express app.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeaders, jsonBody, bodyErrors, sessionGate } from '../../lib/security-middleware.js';

function echoApp(...middleware) {
  const app = express();
  for (const m of middleware) app.use(m);
  app.all('*', (req, res) => res.json({ ok: true, size: JSON.stringify(req.body || {}).length }));
  return app;
}

describe('securityHeaders', () => {
  it('sets the hardening headers on every response', async () => {
    const res = await request(echoApp(securityHeaders())).get('/anything');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
  });

  it('leaves script-src alone — the pages rely on inline handlers', async () => {
    const res = await request(echoApp(securityHeaders())).get('/');
    expect(res.headers['content-security-policy']).not.toContain('script-src');
  });

  it('sends HSTS only when serving HTTPS', async () => {
    expect((await request(echoApp(securityHeaders())).get('/')).headers['strict-transport-security']).toBeUndefined();
    expect((await request(echoApp(securityHeaders({ hsts: true }))).get('/')).headers['strict-transport-security'])
      .toContain('max-age=');
  });
});

describe('jsonBody', () => {
  const big = { data: 'x'.repeat(5000) };
  const limits = { smallLimit: '1kb', bigLimit: '100kb' };

  it('refuses a large anonymous body with a JSON 413', async () => {
    const app = echoApp(jsonBody({ ...limits }), bodyErrors());
    const res = await request(app).post('/api/thing').send(big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('TOO_LARGE');
  });

  it('lets a request with a live session send a large body', async () => {
    const app = echoApp(jsonBody({ ...limits, hasSession: req => req.headers['x-master-password'] === 'rpgs_ok' }), bodyErrors());
    const res = await request(app).post('/api/thing').set('X-Master-Password', 'rpgs_ok').send(big);
    expect(res.status).toBe(200);
    expect(res.body.size).toBeGreaterThan(5000);
  });

  it('lets the listed open upload routes through without a session', async () => {
    const app = echoApp(jsonBody({ ...limits, bigPaths: [/^\/api\/chat\/image$/] }), bodyErrors());
    expect((await request(app).post('/api/chat/image').send(big)).status).toBe(200);
    expect((await request(app).post('/api/chat').send(big)).status).toBe(413);
  });

  it('answers malformed JSON with a JSON 400', async () => {
    const app = echoApp(jsonBody(), bodyErrors());
    const res = await request(app).post('/api/thing').set('Content-Type', 'application/json').send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid JSON/);
  });
});

describe('sessionGate', () => {
  const auth = { credentialsValid: req => req.headers['x-master-password'] === 'rpgs_good' };
  const gated = () => echoApp(sessionGate({ auth, exempt: [/^\/api\/auth\//] }));

  it('lets a request with no credential header through', async () => {
    expect((await request(gated()).get('/api/characters')).status).toBe(200);
  });

  it('lets a live session through', async () => {
    expect((await request(gated()).get('/api/x').set('X-Master-Password', 'rpgs_good')).status).toBe(200);
  });

  it('turns a stale credential into 401 SESSION_EXPIRED', async () => {
    const res = await request(gated()).get('/api/x').set('X-Master-Password', '15243');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    const res2 = await request(gated()).get('/api/x').set('X-Character-Password', 'old-password');
    expect(res2.status).toBe(401);
  });

  it('ignores the login routes and anything outside /api', async () => {
    expect((await request(gated()).post('/api/auth/login').set('X-Master-Password', '15243')).status).toBe(200);
    expect((await request(gated()).get('/table.html').set('X-Master-Password', '15243')).status).toBe(200);
  });
});
