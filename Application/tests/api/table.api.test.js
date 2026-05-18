/**
 * API integration tests for /api/table routes.
 * Covers: table state, token CRUD, move tracking, HP sync, clear.
 * Each test gets a fresh in-memory Express app + SQLite DB via makeApp().
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

const dm = (agent) => agent.set('X-Master-Password', TEST_MASTER_PW);

// POST a token via HTTP as DM and return the created id
async function createToken(app, fields = {}) {
  const res = await dm(request(app).post('/api/table/tokens')).send({
    name: 'Test Token',
    type: 'character',
    ...fields,
  });
  return res.body.id;
}

// ── GET /api/table ────────────────────────────────────────────────────────────
describe('GET /api/table', () => {
  it('returns default state and empty token list', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/table');
    expect(res.status).toBe(200);
    expect(res.body.tokens).toEqual([]);
    expect(res.body.state).toMatchObject({
      cellSize: 50,
      offsetX: 0,
      offsetY: 0,
      mapWidth: 0,
      mapHeight: 0,
    });
  });

  it('returns tokens after they are created', async () => {
    const { app } = makeApp();
    await createToken(app, { name: 'Aria', type: 'character' });
    await createToken(app, { name: 'Goblin', type: 'monster' });
    const res = await request(app).get('/api/table');
    expect(res.body.tokens).toHaveLength(2);
  });

  it('returns state with updated cellSize after a PUT', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ cellSize: 80 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.cellSize).toBe(80);
  });
});

// ── PUT /api/table/state ──────────────────────────────────────────────────────
describe('PUT /api/table/state', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/table/state').send({ cellSize: 60 });
    expect(res.status).toBe(401);
  });

  it('updates cellSize', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ cellSize: 75 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.cellSize).toBe(75);
  });

  it('clamps cellSize below 30 to 30', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ cellSize: 10 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.cellSize).toBe(30);
  });

  it('clamps cellSize above 150 to 150', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ cellSize: 300 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.cellSize).toBe(150);
  });

  it('updates offsetX and offsetY', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ offsetX: 20, offsetY: 40 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.offsetX).toBe(20);
    expect(res.body.state.offsetY).toBe(40);
  });

  it('updates mapWidth and mapHeight', async () => {
    const { app } = makeApp();
    await dm(request(app).put('/api/table/state')).send({ mapWidth: 1200, mapHeight: 800 });
    const res = await request(app).get('/api/table');
    expect(res.body.state.mapWidth).toBe(1200);
    expect(res.body.state.mapHeight).toBe(800);
  });
});

// ── POST /api/table/tokens ────────────────────────────────────────────────────
describe('POST /api/table/tokens', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/table/tokens').send({ name: 'Aria', type: 'character' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/table/tokens')).send({ type: 'character' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/table/tokens')).send({ name: '  ', type: 'character' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid type', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/table/tokens')).send({ name: 'Aria', type: 'dragon' });
    expect(res.status).toBe(400);
  });

  it('creates a character token and returns an id', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/table/tokens')).send({
      name: 'Aria', type: 'character', hpCurrent: 30, hpMax: 40,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');
  });

  it('creates a monster token', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Goblin A1', type: 'monster' });
    const list = await request(app).get('/api/table');
    const tok = list.body.tokens.find(t => t.id === id);
    expect(tok.type).toBe('monster');
    expect(tok.name).toBe('Goblin A1');
  });

  it('stores correct HP values', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Aria', type: 'character', hpCurrent: 25, hpMax: 40 });
    const list = await request(app).get('/api/table');
    const tok = list.body.tokens.find(t => t.id === id);
    expect(tok.hpCurrent).toBe(25);
    expect(tok.hpMax).toBe(40);
  });

  it('clamps tokenSize to range 1–4', async () => {
    const { app } = makeApp();
    const tooSmall = await createToken(app, { name: 'Tiny', tokenSize: 0 });
    const tooBig   = await createToken(app, { name: 'Huge', tokenSize: 99 });
    const list = await request(app).get('/api/table');
    const small = list.body.tokens.find(t => t.id === tooSmall);
    const big   = list.body.tokens.find(t => t.id === tooBig);
    expect(small.tokenSize).toBe(1);
    expect(big.tokenSize).toBe(4);
  });

  it('newly created token appears in GET /api/table', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Aria' });
    const res = await request(app).get('/api/table');
    expect(res.body.tokens.some(t => t.id === id)).toBe(true);
  });

  it('accepts all four valid types', async () => {
    const { app } = makeApp();
    for (const type of ['character', 'monster', 'npc', 'custom']) {
      const res = await dm(request(app).post('/api/table/tokens')).send({ name: 'X', type });
      expect(res.status).toBe(200);
    }
  });
});

// ── PUT /api/table/tokens/:id — DM ───────────────────────────────────────────
describe('PUT /api/table/tokens/:id (DM)', () => {
  it('returns 404 for a non-existent token', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).put('/api/table/tokens/does-not-exist')).send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('DM can update name and HP fields', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Aria', hpCurrent: 20, hpMax: 30 });
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ name: 'Aria Swift', hpCurrent: 15, hpMax: 35 });
    const tok = ldb.getTableToken(id);
    expect(tok.name).toBe('Aria Swift');
    expect(tok.hpCurrent).toBe(15);
    expect(tok.hpMax).toBe(35);
  });

  it('DM can toggle token visibility', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Ghost' });
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ visible: false });
    expect(ldb.getTableToken(id).visible).toBe(false);
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ visible: true });
    expect(ldb.getTableToken(id).visible).toBe(true);
  });

  it('DM position-only move (x+y, no initiative) does not accumulate movedFt', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Aria' });
    // Exactly 2 keys → fast-path, no initiative active → no movedFt change
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ x: 3, y: 4 });
    const tok = ldb.getTableToken(id);
    expect(tok.x).toBe(3);
    expect(tok.y).toBe(4);
    expect(tok.movedFt).toBe(0);
  });

  it('DM position-only move accumulates movedFt when initiative is active', async () => {
    const { app, ldb } = makeApp();
    // Create initiative entry and set it as current
    ldb.createInitEntry('e1', { name: 'Aria', roll: 15 });
    ldb.setInitState('e1');
    const id = await createToken(app, { name: 'Aria', x: 0, y: 0 });
    // Move 2 cells right → Chebyshev dist = max(2,0) = 2 → 10 ft
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ x: 2, y: 0 });
    expect(ldb.getTableToken(id).movedFt).toBe(10);
    // Move 1 more cell → 5 ft more
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ x: 3, y: 0 });
    expect(ldb.getTableToken(id).movedFt).toBe(15);
  });

  it('DM HP update syncs hpcur to linked character dataJson', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('char-1', { name: 'Aria', dataJson: '{"hpcur":"30","hpmax":"40"}' });
    const id = await createToken(app, { name: 'Aria', type: 'character', linkedId: 'char-1', hpMax: 40 });
    await dm(request(app).put(`/api/table/tokens/${id}`)).send({ hpCurrent: 18 });
    const char = ldb.getCharacter('char-1');
    const data = JSON.parse(char.dataJson);
    expect(data.hpcur).toBe('18');
  });
});

// ── PUT /api/table/tokens/:id — Player ───────────────────────────────────────
describe('PUT /api/table/tokens/:id (Player)', () => {
  it('player can update conditions (single-field body)', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Aria', type: 'character' });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ conditions: ['poisoned', 'stunned'] });
    expect(res.status).toBe(200);
    const tok = ldb.getTableToken(id);
    expect(JSON.parse(tok.conditions)).toEqual(['poisoned', 'stunned']);
  });

  it('player can update hpCurrent on a character token', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Aria', type: 'character', hpMax: 40 });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ hpCurrent: 22 });
    expect(res.status).toBe(200);
    expect(ldb.getTableToken(id).hpCurrent).toBe(22);
  });

  it('player can update hpCurrent on an npc token', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Bob', type: 'npc', hpMax: 20 });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ hpCurrent: 5 });
    expect(res.status).toBe(200);
    expect(ldb.getTableToken(id).hpCurrent).toBe(5);
  });

  it('player cannot move a monster token → 403', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Goblin', type: 'monster' });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ x: 5, y: 5 });
    expect(res.status).toBe(403);
  });

  it('player can move a character token when no initiative is active', async () => {
    const { app, ldb } = makeApp();
    const id = await createToken(app, { name: 'Aria', type: 'character', x: 0, y: 0 });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ x: 3, y: 4 });
    expect(res.status).toBe(200);
    expect(ldb.getTableToken(id).x).toBe(3);
    expect(ldb.getTableToken(id).y).toBe(4);
  });

  it('player moving out of turn during initiative → 403', async () => {
    const { app, ldb } = makeApp();
    // Two initiative entries; e1 is active, token is linked to e2
    ldb.createInitEntry('e1', { name: 'Other', roll: 20 });
    ldb.createInitEntry('e2', { name: 'Aria',  roll: 10 });
    ldb.setInitState('e1'); // e1's turn
    const id = await createToken(app, { name: 'Aria', type: 'character', initiativeId: 'e2' });
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ x: 2, y: 2 });
    expect(res.status).toBe(403);
  });

  it('player moving on their turn accumulates movedFt', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'Aria', roll: 15 });
    ldb.setInitState('e1');
    const id = await createToken(app, { name: 'Aria', type: 'character', x: 0, y: 0, initiativeId: 'e1' });
    await request(app).put(`/api/table/tokens/${id}`).send({ x: 0, y: 3 });
    // Chebyshev: max(0,3)=3 cells → 15 ft
    expect(ldb.getTableToken(id).movedFt).toBe(15);
  });

  it('player body with x+y missing returns 400', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Aria', type: 'character' });
    // Not conditions, not hpCurrent/hpTemp, not x+y → falls to x/y check
    const res = await request(app)
      .put(`/api/table/tokens/${id}`)
      .send({ speed: 40 });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/table/tokens/:id ─────────────────────────────────────────────
describe('DELETE /api/table/tokens/:id', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Aria' });
    const res = await request(app).delete(`/api/table/tokens/${id}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent token', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).delete('/api/table/tokens/no-such-token'));
    expect(res.status).toBe(404);
  });

  it('DM removes a token', async () => {
    const { app } = makeApp();
    const id = await createToken(app, { name: 'Aria' });
    await dm(request(app).delete(`/api/table/tokens/${id}`));
    const list = await request(app).get('/api/table');
    expect(list.body.tokens).toHaveLength(0);
  });

  it('deleting a token with an initiativeId also removes its initiative entry', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'Goblin', roll: 8, monsterId: 'mon-1' });
    const id = await createToken(app, { name: 'Goblin', type: 'monster', initiativeId: 'e1' });
    await dm(request(app).delete(`/api/table/tokens/${id}`));
    expect(ldb.getInitEntry('e1')).toBeNull();
  });

  it('deleting the current-turn token advances initiative to the next entry', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'High', roll: 20, monsterId: 'mon-1' });
    ldb.createInitEntry('e2', { name: 'Low',  roll: 5,  monsterId: 'mon-2' });
    ldb.setInitState('e1'); // e1 is active turn
    const tok1 = await createToken(app, { name: 'High', type: 'monster', initiativeId: 'e1' });
    await dm(request(app).delete(`/api/table/tokens/${tok1}`));
    // e1 deleted → initiative should advance to e2
    const state = ldb.getInitState();
    expect(state.currentId).toBe('e2');
  });

  it('deleting the only token clears initiative currentId', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'Aria', roll: 14 });
    ldb.setInitState('e1');
    const id = await createToken(app, { name: 'Aria', type: 'character', initiativeId: 'e1' });
    await dm(request(app).delete(`/api/table/tokens/${id}`));
    expect(ldb.getInitState().currentId).toBe('');
  });

  it('deleting a non-current-turn token does not change currentId', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'High', roll: 20 });
    ldb.createInitEntry('e2', { name: 'Low',  roll: 5  });
    ldb.setInitState('e1');
    const tok2 = await createToken(app, { name: 'Low', type: 'character', initiativeId: 'e2' });
    await dm(request(app).delete(`/api/table/tokens/${tok2}`));
    expect(ldb.getInitState().currentId).toBe('e1');
  });
});

// ── POST /api/table/clear ─────────────────────────────────────────────────────
describe('POST /api/table/clear', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/table/clear');
    expect(res.status).toBe(401);
  });

  it('removes all tokens', async () => {
    const { app } = makeApp();
    await createToken(app, { name: 'Aria' });
    await createToken(app, { name: 'Goblin', type: 'monster' });
    await dm(request(app).post('/api/table/clear'));
    const list = await request(app).get('/api/table');
    expect(list.body.tokens).toHaveLength(0);
  });

  it('clears all initiative entries and currentId', async () => {
    const { app, ldb } = makeApp();
    ldb.createInitEntry('e1', { name: 'Aria', roll: 14 });
    ldb.createInitEntry('e2', { name: 'Goblin', roll: 8, monsterId: 'mon-1' });
    ldb.setInitState('e1');
    await dm(request(app).post('/api/table/clear'));
    const init = await request(app).get('/api/initiative');
    expect(init.body.entries).toHaveLength(0);
    expect(init.body.currentId).toBe('');
  });
});
