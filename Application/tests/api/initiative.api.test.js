/**
 * API integration tests for /api/initiative routes.
 * Each test gets a fresh in-memory Express app + SQLite DB via makeApp().
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

// Attach DM auth header to any supertest chain
const dm = (agent) => agent.set('X-Master-Password', TEST_MASTER_PW);

// Seed initiative entries directly via ldb (bypasses HTTP)
function seed(ldb, entries) {
  entries.forEach(({ id, name, roll, charId = '', monsterId = '' }) =>
    ldb.createInitEntry(id, { name, roll, charId, monsterId })
  );
}

// ── GET /api/initiative ───────────────────────────────────────────────────────
describe('GET /api/initiative', () => {
  it('returns empty entries and empty currentId on fresh db', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/initiative');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entries: [], currentId: '' });
  });

  it('returns all seeded entries', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'Aria', roll: 18 },
      { id: 'e2', name: 'Goblin', roll: 12, monsterId: 'mon-1' },
    ]);
    const res = await request(app).get('/api/initiative');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
  });

  it('returns entries sorted by roll descending', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'Low',  roll: 5 },
      { id: 'e2', name: 'High', roll: 20 },
      { id: 'e3', name: 'Mid',  roll: 12 },
    ]);
    const res = await request(app).get('/api/initiative');
    const rolls = res.body.entries.map(e => e.roll);
    expect(rolls).toEqual([20, 12, 5]);
  });

  it('returns the currentId when a turn is active', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 15 }]);
    ldb.setInitState('e1');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1');
  });
});

// ── POST /api/initiative ──────────────────────────────────────────────────────
describe('POST /api/initiative', () => {
  it('creates an entry and returns { id, ok: true }', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/initiative')
      .send({ name: 'Aria', roll: 14 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');
  });

  it('the created entry appears in GET', async () => {
    const { app } = makeApp();
    await request(app).post('/api/initiative').send({ name: 'Aria', roll: 14 });
    const res = await request(app).get('/api/initiative');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].name).toBe('Aria');
    expect(res.body.entries[0].roll).toBe(14);
  });

  it('returns 400 when name is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative').send({ roll: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when roll is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative').send({ name: 'Aria' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative').send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /api/initiative/roll ─────────────────────────────────────────────────
describe('POST /api/initiative/roll', () => {
  it('creates a new entry when charId has no existing entry', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/initiative/roll')
      .send({ name: 'Aria', roll: 16, charId: 'char-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(1);
  });

  it('upserts (updates roll + name) when charId already has an entry', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 10, charId: 'char-1' }]);

    const res = await request(app)
      .post('/api/initiative/roll')
      .send({ name: 'Aria the Swift', roll: 19, charId: 'char-1' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('e1'); // same id — was updated, not created

    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(1);
    expect(list.body.entries[0].roll).toBe(19);
    expect(list.body.entries[0].name).toBe('Aria the Swift');
  });

  it('always creates a new entry when charId is omitted', async () => {
    const { app } = makeApp();
    await request(app).post('/api/initiative/roll').send({ name: 'A', roll: 10 });
    await request(app).post('/api/initiative/roll').send({ name: 'B', roll: 12 });
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(2);
  });

  it('returns 400 when name is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/roll').send({ roll: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when roll is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/roll').send({ name: 'Aria' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/initiative/add ──────────────────────────────────────────────────
describe('POST /api/initiative/add', () => {
  it('DM can create a monster initiative entry', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/initiative/add'))
      .send({ name: 'Goblin A1', roll: 8, monsterId: 'mon-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await request(app).get('/api/initiative');
    expect(list.body.entries[0].monsterId).toBe('mon-1');
  });

  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/initiative/add')
      .send({ name: 'Goblin', roll: 8, monsterId: 'mon-1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/initiative/add'))
      .send({ roll: 8, monsterId: 'mon-1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when roll is missing', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/initiative/add'))
      .send({ name: 'Goblin', monsterId: 'mon-1' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/initiative/start ────────────────────────────────────────────────
describe('POST /api/initiative/start', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/start');
    expect(res.status).toBe(401);
  });

  it('returns 400 when there are no entries', async () => {
    const { app } = makeApp();
    const res = await dm(request(app).post('/api/initiative/start'));
    expect(res.status).toBe(400);
  });

  it('sets currentId to the highest-roll entry', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'Low',  roll: 5 },
      { id: 'e2', name: 'High', roll: 20 },
      { id: 'e3', name: 'Mid',  roll: 12 },
    ]);
    await dm(request(app).post('/api/initiative/start'));
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e2'); // roll 20
  });

  it('starts at the single entry when only one exists', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14 }]);
    await dm(request(app).post('/api/initiative/start'));
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1');
  });
});

// ── POST /api/initiative/next ─────────────────────────────────────────────────
describe('POST /api/initiative/next', () => {
  it('is a no-op when there are no entries', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/next');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('advances to the next entry in roll-sorted order', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Mid',  roll: 12 },
      { id: 'e3', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e1'); // currently on High(20)
    await request(app).post('/api/initiative/next');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e2'); // advances to Mid(12)
  });

  it('wraps from the last entry back to the first', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e2'); // currently on last
    await request(app).post('/api/initiative/next');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1'); // wraps to first
  });

  it('starts at the first entry when no turn is active', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    // currentId is '' — no active turn
    await request(app).post('/api/initiative/next');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1');
  });

  it('resets movedFt to 0 on the token linked to the new active entry', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    // Create a token linked to e2 with movedFt > 0
    ldb.createTableToken('tok-1', {
      name: 'Low', type: 'character', initiativeId: 'e2', movedFt: 30,
    });
    ldb.setInitState('e1');
    await request(app).post('/api/initiative/next');
    const tok = ldb.getTableToken('tok-1');
    expect(tok.movedFt).toBe(0);
  });
});

// ── POST /api/initiative/prev ─────────────────────────────────────────────────
describe('POST /api/initiative/prev', () => {
  it('is a no-op when there are no entries', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/prev');
    expect(res.status).toBe(200);
  });

  it('goes back to the previous entry', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Mid',  roll: 12 },
      { id: 'e3', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e2'); // currently Mid
    await request(app).post('/api/initiative/prev');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1'); // back to High
  });

  it('wraps from the first entry back to the last', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e1'); // currently first
    await request(app).post('/api/initiative/prev');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e2'); // wraps to last
  });

  it('goes to the last entry when no turn is active', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    // currentId is '' — no active turn; prev from idx=0 goes to last
    await request(app).post('/api/initiative/prev');
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e2');
  });
});

// ── POST /api/initiative/end ──────────────────────────────────────────────────
describe('POST /api/initiative/end', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/end');
    expect(res.status).toBe(401);
  });

  it('clears currentId', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14 }]);
    ldb.setInitState('e1');
    await dm(request(app).post('/api/initiative/end'));
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('');
  });

  it('leaves the entries in place (only clears the turn pointer)', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'Aria',   roll: 14 },
      { id: 'e2', name: 'Goblin', roll: 8 },
    ]);
    ldb.setInitState('e1');
    await dm(request(app).post('/api/initiative/end'));
    const res = await request(app).get('/api/initiative');
    expect(res.body.entries).toHaveLength(2);
  });
});

// ── POST /api/initiative/clear ────────────────────────────────────────────────
describe('POST /api/initiative/clear', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/clear');
    expect(res.status).toBe(401);
  });

  it('removes all entries', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'Aria',   roll: 14 },
      { id: 'e2', name: 'Goblin', roll: 8 },
    ]);
    await dm(request(app).post('/api/initiative/clear'));
    const res = await request(app).get('/api/initiative');
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.currentId).toBe('');
  });
});

// ── DELETE /api/initiative/:id ────────────────────────────────────────────────
describe('DELETE /api/initiative/:id', () => {
  it('DM can delete any entry', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14 }]);
    const res = await dm(request(app).delete('/api/initiative/e1')).send({});
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(0);
  });

  it('returns 401 when called with no auth', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14 }]);
    const res = await request(app).delete('/api/initiative/e1').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 when player tries to delete an entry that is not theirs', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14, charId: 'char-A' }]);
    ldb.createCharacter('char-B', { name: 'Bob', passwordHash: '' });
    const res = await request(app)
      .delete('/api/initiative/e1')
      .send({ charId: 'char-B' });
    expect(res.status).toBe(403);
  });

  it('player can delete their own entry', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('char-1', { name: 'Aria', passwordHash: '' });
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14, charId: 'char-1' }]);
    const res = await request(app)
      .delete('/api/initiative/e1')
      .send({ charId: 'char-1' });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(0);
  });

  it('advances turn to next entry when current entry is deleted', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Mid',  roll: 12 },
      { id: 'e3', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e1'); // currently on High (idx 0)
    await dm(request(app).delete('/api/initiative/e1')).send({});
    const res = await request(app).get('/api/initiative');
    // idx 0 deleted → remaining[0 % 2] = Mid
    expect(res.body.currentId).toBe('e2');
  });

  it('clears currentId when the last entry is deleted', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14 }]);
    ldb.setInitState('e1');
    await dm(request(app).delete('/api/initiative/e1')).send({});
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('');
    expect(res.body.entries).toHaveLength(0);
  });

  it('does not change currentId when a non-current entry is deleted', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [
      { id: 'e1', name: 'High', roll: 20 },
      { id: 'e2', name: 'Low',  roll: 5 },
    ]);
    ldb.setInitState('e1');
    await dm(request(app).delete('/api/initiative/e2')).send({});
    const res = await request(app).get('/api/initiative');
    expect(res.body.currentId).toBe('e1');
    expect(res.body.entries).toHaveLength(1);
  });
});

// ── PATCH /api/initiative/:id/roll ───────────────────────────────────────────
describe('PATCH /api/initiative/:id/roll', () => {
  it('updates the roll of a non-monster entry without auth', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 10 }]);
    const res = await request(app)
      .patch('/api/initiative/e1/roll')
      .send({ roll: 18 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const entry = ldb.getInitEntry('e1');
    expect(entry.roll).toBe(18);
  });

  it('returns 401 when updating a monster entry without DM auth', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Goblin', roll: 8, monsterId: 'mon-1' }]);
    const res = await request(app)
      .patch('/api/initiative/e1/roll')
      .send({ roll: 15 });
    expect(res.status).toBe(401);
  });

  it('DM can update a monster entry roll', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Goblin', roll: 8, monsterId: 'mon-1' }]);
    const res = await dm(request(app).patch('/api/initiative/e1/roll'))
      .send({ roll: 15 });
    expect(res.status).toBe(200);
    expect(ldb.getInitEntry('e1').roll).toBe(15);
  });

  it('returns 400 when roll is missing from body', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 10 }]);
    const res = await request(app)
      .patch('/api/initiative/e1/roll')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent entry', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .patch('/api/initiative/does-not-exist/roll')
      .send({ roll: 10 });
    expect(res.status).toBe(404);
  });
});

// ── POST /api/initiative/cleanup ──────────────────────────────────────────────
describe('POST /api/initiative/cleanup', () => {
  it('returns 401 without DM auth', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/initiative/cleanup');
    expect(res.status).toBe(401);
  });

  it('removes monster entries with no matching table token', async () => {
    const { app, ldb } = makeApp();
    // Monster entry with no token → orphan
    seed(ldb, [{ id: 'e1', name: 'Orphan Goblin', roll: 8, monsterId: 'mon-1' }]);
    const res = await dm(request(app).post('/api/initiative/cleanup'));
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(0);
  });

  it('keeps monster entries that have a matching token', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Goblin', roll: 8, monsterId: 'mon-1' }]);
    // Token linked to e1 via initiativeId
    ldb.createTableToken('tok-1', {
      name: 'Goblin', type: 'monster', initiativeId: 'e1',
    });
    const res = await dm(request(app).post('/api/initiative/cleanup'));
    expect(res.body.removed).toBe(0);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(1);
  });

  it('never removes non-monster (player) entries regardless of token', async () => {
    const { app, ldb } = makeApp();
    seed(ldb, [{ id: 'e1', name: 'Aria', roll: 14, charId: 'char-1' }]);
    const res = await dm(request(app).post('/api/initiative/cleanup'));
    expect(res.body.removed).toBe(0);
    const list = await request(app).get('/api/initiative');
    expect(list.body.entries).toHaveLength(1);
  });
});
