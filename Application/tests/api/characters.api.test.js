/**
 * HTTP integration tests for /api/characters endpoints.
 * Uses supertest + the real Express app wired to an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, TEST_MASTER_PW } from '../helpers/test-app.js';

// Attach the DM master-password header.
const dm = (agent) => agent.set('X-Master-Password', TEST_MASTER_PW);

// ── helpers ───────────────────────────────────────────────────────────────────
function seedChar(ldb, hashPassword, overrides = {}) {
  const id = `char-${Math.random().toString(36).slice(2)}`;
  const passwordHash = overrides.password ? hashPassword(overrides.password) : '';
  ldb.createCharacter(id, {
    name:         overrides.name     ?? 'Test Hero',
    dataJson:     overrides.dataJson ?? '{}',
    charType:     overrides.charType ?? 'pc',
    passwordHash,
    createdAt:    new Date().toISOString(),
  });
  return { id, password: overrides.password || null };
}

// ── GET /api/characters ───────────────────────────────────────────────────────
describe('GET /api/characters', () => {
  it('returns 200 and an empty array when no characters exist', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/characters');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all characters sorted by name', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Zara',  charType: 'pc', createdAt: new Date().toISOString() });
    ldb.createCharacter('c2', { name: 'Aria',  charType: 'pc', createdAt: new Date().toISOString() });
    ldb.createCharacter('c3', { name: 'Mira',  charType: 'npc', createdAt: new Date().toISOString() });

    const res = await request(app).get('/api/characters');
    expect(res.status).toBe(200);
    expect(res.body.map(c => c.name)).toEqual(['Aria', 'Mira', 'Zara']);
  });

  it('returns has_password: true for password-protected characters', async () => {
    const { app, ldb } = makeApp();
    // Directly seed with a non-empty hash to mark as password-protected
    ldb.createCharacter('c1', { name: 'Locked', passwordHash: 'fakehash', createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters');
    expect(res.body[0].has_password).toBe(true);
  });

  it('includes char_type in response', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Bob', charType: 'npc', createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters');
    expect(res.body[0].char_type).toBe('npc');
  });
});

// ── POST /api/characters ──────────────────────────────────────────────────────
describe('POST /api/characters', () => {
  it('creates a PC character and returns its id and name', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters').send({ name: 'Aria' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Aria');
    expect(res.body.id).toBeDefined();
    expect(res.body.char_type).toBe('pc');
    expect(res.body.has_password).toBe(false);
  });

  it('creates an NPC character when char_type is npc', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters').send({ name: 'Innkeeper', char_type: 'npc' });
    expect(res.status).toBe(200);
    expect(res.body.char_type).toBe('npc');
  });

  it('returns 400 when name is missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is only whitespace', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('creates a password-protected character when password is supplied', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters').send({ name: 'Rogue', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.has_password).toBe(true);
  });

  it('persists the character in the database', async () => {
    const { app, ldb } = makeApp();
    const res = await request(app).post('/api/characters').send({ name: 'Druid' });
    expect(ldb.getCharacter(res.body.id)).not.toBeNull();
  });
});

// ── GET /api/characters/:id ───────────────────────────────────────────────────
describe('GET /api/characters/:id', () => {
  it('returns 200 and character data for an open character', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Aria', dataJson: '{"str":"16"}', createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters/c1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Aria');
    expect(res.body.data.str).toBe('16');
  });

  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/characters/no-such-id');
    expect(res.status).toBe(404);
  });

  it('returns 401 for a locked character without a password header', async () => {
    const { app, ldb } = makeApp();
    const { hashPassword } = (await import('../helpers/test-app.js'));
    ldb.createCharacter('c1', { name: 'Rogue', passwordHash: 'x:y', createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters/c1');
    expect(res.status).toBe(401);
    expect(res.body.locked).toBe(true);
  });

  it('returns 200 when the correct character password is supplied', async () => {
    const { app, ldb } = makeApp();
    // Create via API so password is properly hashed
    const createRes = await request(app).post('/api/characters').send({ name: 'Rogue', password: 'mypassword' });
    const id = createRes.body.id;
    const res = await request(app)
      .get(`/api/characters/${id}`)
      .set('X-Character-Password', 'mypassword');
    expect(res.status).toBe(200);
  });

  it('returns 200 when the master password is used instead of the character password', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Wizard', password: 'charpass' });
    const id = createRes.body.id;
    const res = await request(app)
      .get(`/api/characters/${id}`)
      .set('X-Character-Password', TEST_MASTER_PW);
    expect(res.status).toBe(200);
  });

  it('returns 401 when the wrong password is supplied', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Bard', password: 'correct' });
    const id = createRes.body.id;
    const res = await request(app)
      .get(`/api/characters/${id}`)
      .set('X-Character-Password', 'wrong');
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/characters/:id ───────────────────────────────────────────────────
describe('PUT /api/characters/:id', () => {
  it('updates name and data for an open character', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Old Name', dataJson: '{}', createdAt: new Date().toISOString() });
    const res = await request(app).put('/api/characters/c1').send({ data: { name: 'New Name', str: '18' } });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    const stored = JSON.parse(ldb.getCharacter('c1').dataJson);
    expect(stored.str).toBe('18');
  });

  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/characters/ghost').send({ data: { name: 'X' } });
    expect(res.status).toBe(404);
  });

  it('returns 400 when data field is missing', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Hero', createdAt: new Date().toISOString() });
    const res = await request(app).put('/api/characters/c1').send({});
    expect(res.status).toBe(400);
  });

  it('syncs HP, speed and AC to linked table tokens on update', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Fighter', dataJson: '{}', createdAt: new Date().toISOString() });
    ldb.createTableToken('tok-1', { name: 'Fighter', linkedId: 'c1', hpCurrent: 10, hpMax: 10, ac: 12 });

    await request(app).put('/api/characters/c1').send({
      data: { name: 'Fighter', hpcur: '25', hpmax: '30', hptemp: '0', 'speed-base': '40', ac: '18' }
    });

    const tok = ldb.getTableToken('tok-1');
    expect(tok.hpCurrent).toBe(25);
    expect(tok.hpMax).toBe(30);
    expect(tok.speed).toBe(40);
    expect(tok.ac).toBe(18);
  });

  it('leaves token AC untouched when the character has no AC value', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Rogue', dataJson: '{}', createdAt: new Date().toISOString() });
    ldb.createTableToken('tok-1', { name: 'Rogue', linkedId: 'c1', hpCurrent: 8, hpMax: 8, ac: 15 });

    await request(app).put('/api/characters/c1').send({
      data: { name: 'Rogue', hpcur: '8', hpmax: '8', hptemp: '0', 'speed-base': '30' }
    });

    const tok = ldb.getTableToken('tok-1');
    expect(tok.ac).toBe(15); // unchanged — no AC in the payload
  });

  it('requires correct password for a locked character', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Paladin', password: 'holy' });
    const id = createRes.body.id;

    // Without password
    const res1 = await request(app).put(`/api/characters/${id}`).send({ data: { name: 'Paladin' } });
    expect(res1.status).toBe(401);

    // With correct password
    const res2 = await request(app)
      .put(`/api/characters/${id}`)
      .set('X-Character-Password', 'holy')
      .send({ data: { name: 'Paladin Renamed' } });
    expect(res2.status).toBe(200);
  });
});

// ── PUT /api/characters/:id/password ─────────────────────────────────────────
describe('PUT /api/characters/:id/password', () => {
  it('sets a password on a character that had none', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Monk', createdAt: new Date().toISOString() });
    const res = await request(app).put('/api/characters/c1/password')
      .send({ new_password: 'newpass' });
    expect(res.status).toBe(200);
    expect(res.body.has_password).toBe(true);
    expect(ldb.getCharacter('c1').passwordHash).not.toBe('');
  });

  it('clears a password when new_password is empty', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Sorcerer', password: 'old' });
    const id = createRes.body.id;
    const res = await request(app).put(`/api/characters/${id}/password`)
      .set('X-Character-Password', 'old')
      .send({ current_password: 'old', new_password: '' });
    expect(res.status).toBe(200);
    expect(res.body.has_password).toBe(false);
  });

  it('returns 401 when current_password is wrong', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Ranger', password: 'correct' });
    const id = createRes.body.id;
    const res = await request(app).put(`/api/characters/${id}/password`)
      .send({ current_password: 'wrong', new_password: 'new' });
    expect(res.status).toBe(401);
  });

  it('master password bypasses current_password check', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Cleric', password: 'old' });
    const id = createRes.body.id;
    const res = await request(app).put(`/api/characters/${id}/password`)
      .set('X-Character-Password', TEST_MASTER_PW)
      .send({ current_password: TEST_MASTER_PW, new_password: 'changed' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/characters/ghost/password').send({ new_password: 'x' });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/characters/:id ────────────────────────────────────────────────
describe('DELETE /api/characters/:id', () => {
  it('deletes an open character', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Goblin NPC', createdAt: new Date().toISOString() });
    const res = await request(app).delete('/api/characters/c1');
    expect(res.status).toBe(200);
    expect(ldb.getCharacter('c1')).toBeNull();
  });

  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).delete('/api/characters/ghost');
    expect(res.status).toBe(404);
  });

  it('returns 401 when deleting a locked character without a password', async () => {
    const { app } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Warlock', password: 'dark' });
    const res = await request(app).delete(`/api/characters/${createRes.body.id}`);
    expect(res.status).toBe(401);
  });

  it('deletes a locked character when the correct password is supplied', async () => {
    const { app, ldb } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Warlock', password: 'dark' });
    const id = createRes.body.id;
    const res = await request(app)
      .delete(`/api/characters/${id}`)
      .set('X-Character-Password', 'dark');
    expect(res.status).toBe(200);
    expect(ldb.getCharacter(id)).toBeNull();
  });

  it('deletes a locked character when master password is supplied', async () => {
    const { app, ldb } = makeApp();
    const createRes = await request(app).post('/api/characters').send({ name: 'Necromancer', password: 'bones' });
    const id = createRes.body.id;
    const res = await request(app)
      .delete(`/api/characters/${id}`)
      .set('X-Character-Password', TEST_MASTER_PW);
    expect(res.status).toBe(200);
    expect(ldb.getCharacter(id)).toBeNull();
  });
});

// ── GET /api/characters/:id/qroll ────────────────────────────────────────────
describe('GET /api/characters/:id/qroll', () => {
  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/characters/ghost/qroll');
    expect(res.status).toBe(404);
  });

  it('returns only whitelisted keys from dataJson', async () => {
    const { app, ldb } = makeApp();
    const data = {
      'sk-0': '+3',         // skill — included
      'sk-17': '+1',        // skill — included
      'save-str': '+2',     // save — included
      'init': '+4',         // extra — included
      'ac': '15',           // extra — included
      'secretField': 'yes', // not whitelisted — excluded
    };
    ldb.createCharacter('c1', { name: 'Aria', dataJson: JSON.stringify(data), createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters/c1/qroll');
    expect(res.status).toBe(200);
    expect(res.body.data['sk-0']).toBe('+3');
    expect(res.body.data['save-str']).toBe('+2');
    expect(res.body.data['init']).toBe('+4');
    expect(res.body.data['ac']).toBe('15');
    expect(res.body.data['secretField']).toBeUndefined();
  });

  it('includes all 18 skill keys when present', async () => {
    const { app, ldb } = makeApp();
    const data = {};
    for (let i = 0; i < 18; i++) data[`sk-${i}`] = `+${i}`;
    ldb.createCharacter('c1', { name: 'Hero', dataJson: JSON.stringify(data), createdAt: new Date().toISOString() });
    const res = await request(app).get('/api/characters/c1/qroll');
    for (let i = 0; i < 18; i++) {
      expect(res.body.data[`sk-${i}`]).toBe(`+${i}`);
    }
  });

  it('includes _weapons when present', async () => {
    const { app, ldb } = makeApp();
    const weapons = [{ name: 'Longsword', atk: '+5' }];
    ldb.createCharacter('c1', {
      name: 'Fighter',
      dataJson: JSON.stringify({ _weapons: weapons }),
      createdAt: new Date().toISOString(),
    });
    const res = await request(app).get('/api/characters/c1/qroll');
    expect(res.body.data._weapons).toEqual(weapons);
  });
});

// ── POST /api/characters/:id/roll ─────────────────────────────────────────────
describe('POST /api/characters/:id/roll', () => {
  it('returns 404 for a non-existent character', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/characters/ghost/roll').send({ total: 15 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when total is missing', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Aria', createdAt: new Date().toISOString() });
    const res = await request(app).post('/api/characters/c1/roll').send({ label: 'Attack' });
    expect(res.status).toBe(400);
  });

  it('saves a roll entry to the character roll history', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Aria', createdAt: new Date().toISOString() });
    const res = await request(app).post('/api/characters/c1/roll').send({
      label: 'Sneak Attack', type: 'norm', detail: '2d6(4,3)', total: 22
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse(ldb.getCharacter('c1').dataJson);
    const hist = JSON.parse(stored._rollHistory);
    expect(hist[0].total).toBe(22);
    expect(hist[0].label).toBe('Sneak Attack');
  });

  it('prepends new rolls (most recent first)', async () => {
    const { app, ldb } = makeApp();
    ldb.createCharacter('c1', { name: 'Archer', createdAt: new Date().toISOString() });
    await request(app).post('/api/characters/c1/roll').send({ total: 10, label: 'First' });
    await request(app).post('/api/characters/c1/roll').send({ total: 20, label: 'Second' });
    const stored = JSON.parse(ldb.getCharacter('c1').dataJson);
    const hist = JSON.parse(stored._rollHistory);
    expect(hist[0].label).toBe('Second');
    expect(hist[1].label).toBe('First');
  });

  it('caps roll history at 100 entries', async () => {
    const { app, ldb } = makeApp();
    // Seed 100 existing rolls
    const existing = Array.from({ length: 100 }, (_, i) => ({ total: i, label: `Roll ${i}` }));
    ldb.createCharacter('c1', {
      name: 'Warrior',
      dataJson: JSON.stringify({ _rollHistory: JSON.stringify(existing) }),
      createdAt: new Date().toISOString(),
    });
    await request(app).post('/api/characters/c1/roll').send({ total: 99, label: 'Overflow' });
    const stored = JSON.parse(ldb.getCharacter('c1').dataJson);
    const hist = JSON.parse(stored._rollHistory);
    expect(hist.length).toBe(100);
    expect(hist[0].label).toBe('Overflow');
  });
});
