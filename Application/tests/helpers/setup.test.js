/**
 * Smoke test — verifies the test infrastructure wires up correctly.
 * If this passes, all subsequent suites can rely on makeApp() + makeLdb().
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp } from './test-app.js';

describe('Test infrastructure smoke test', () => {
  it('GET /api/initiative returns 200 with empty state', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/initiative');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entries: [], currentId: '' });
  });

  it('GET /api/table returns 200 with default state and no tokens', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/table');
    expect(res.status).toBe(200);
    expect(res.body.tokens).toEqual([]);
    expect(res.body.state).toMatchObject({ cellSize: 50, offsetX: 0, offsetY: 0 });
  });

  it('DM auth is accepted with correct password', async () => {
    const { app, masterPw } = makeApp();
    const res = await request(app)
      .post('/api/initiative/start')
      .set('X-Master-Password', masterPw);
    // No entries → 400, but not 401 — auth passed
    expect(res.status).toBe(400);
  });

  it('DM auth is rejected without password', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/start');
    expect(res.status).toBe(401);
  });
});
