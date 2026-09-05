/**
 * Handouts — the redaction boundary above all.
 *
 * Wired against the REAL openCampaignDb(':memory:') rather than a hand-written
 * fake, because the thing under test is exactly what the server chooses to put
 * in a response. A stub that returned tidy objects would prove nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import { openCampaignDb } from '../../db/localdb.js';
import registerHandouts from '../../server/routes/handouts.js';

const MASTER_PW = 'test-master-pw-123';
const CHAR_PW   = 'aliyr-pw';
const OTHER_PW  = 'gaston-pw';

const SUCCESS_BODY = 'Carved spirals, faintly warm. Netherese warding script.';
const FAIL_BODY    = 'The glyphs spell a warding curse. You feel watched.';
const PROMPT       = 'A weathered stone, half-buried in ash.';

const ARCANA = 2;   // index into SKILL_NAMES

let ldb, app, broadcasts, ALIYR, GASTON;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'), 'hex'));
  } catch { return false; }
}

beforeEach(() => {
  ldb = openCampaignDb(':memory:');
  broadcasts = [];

  ALIYR  = crypto.randomUUID();
  GASTON = crypto.randomUUID();
  // sk-2 is the Arcana modifier recalcDerived() keeps on the character.
  ldb.createCharacter(ALIYR, {
    name: 'Aliyr', charType: 'pc', passwordHash: hashPassword(CHAR_PW),
    dataJson: JSON.stringify({ 'sk-2': '+11' }),
  });
  ldb.createCharacter(GASTON, {
    name: 'Gaston', charType: 'pc', passwordHash: hashPassword(OTHER_PW),
    dataJson: JSON.stringify({ 'sk-2': '-1' }),
  });

  const isMasterPassword = pw => pw === MASTER_PW;
  const getCharacter = async id => ldb.getCharacter(id);

  app = express();
  app.use(express.json({ limit: '10mb' }));
  registerHandouts(app, {
    ldb,
    DB_PROVIDER: 'localdb',
    genId: () => crypto.randomUUID(),
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    masterAuth: req => isMasterPassword(req.headers['x-master-password']),
    charAuth: async (charId, req) => {
      const c = ldb.getCharacter(charId);
      if (!c) return 404;
      if (c.passwordHash) {
        const pw = req.headers['x-character-password'];
        if (!pw || (!verifyPassword(pw, c.passwordHash) && !isMasterPassword(pw))) return 401;
      }
      return 200;
    },
    getCharacter,
    processImageSizes: async () => ({ original: '/o.png', thumb: '/t.webp', medium: '/m.webp' }),
    deleteUploadFile: () => {},
    IMAGE_MIME: new Set(['image/png']),
    MAX_MEDIA_BYTES: 25 * 1024 * 1024,
  });
});

const dm     = r => r.set('X-Master-Password', MASTER_PW);
const aliyr  = r => r.set('X-Character-Id', ALIYR).set('X-Character-Password', CHAR_PW);
const gaston = r => r.set('X-Character-Id', GASTON).set('X-Character-Password', OTHER_PW);

async function makeHandout(over = {}) {
  const res = await dm(request(app).post('/api/handouts')).send({
    title: 'Weathered Ley-Stone', tag: 'Dungeon-II', promptText: PROMPT,
    successText: SUCCESS_BODY, failText: FAIL_BODY,
    checkSkill: ARCANA, checkDc: 14, ...over,
  });
  expect(res.status).toBe(201);
  return res.body;
}
const handTo = (id, charIds) =>
  dm(request(app).post(`/api/handouts/${id}/hand-out`)).send(charIds ? { charIds } : {});

/** The whole player payload as a string — what actually crosses the wire. */
async function playerPayload(id, as = aliyr) {
  const res = await as(request(app).get('/api/handouts'));
  const row = res.body.find(h => h.id === id);
  return { row, raw: JSON.stringify(row ?? null) };
}

describe('authoring', () => {
  it('requires the DM password to create, edit and delete', async () => {
    const h = await makeHandout();
    expect((await aliyr(request(app).post('/api/handouts')).send({ title: 'x' })).status).toBe(401);
    expect((await aliyr(request(app).put(`/api/handouts/${h.id}`)).send({ title: 'x' })).status).toBe(401);
    expect((await aliyr(request(app).delete(`/api/handouts/${h.id}`))).status).toBe(401);
  });

  it('requires a title', async () => {
    const res = await dm(request(app).post('/api/handouts')).send({ successText: 'orphan' });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range skill and a nonsense DC', async () => {
    const h = await makeHandout({ checkSkill: 99, checkDc: -5 });
    expect(h.checkSkill).toBe(-1);
    expect(h.checkDc).toBe(0);
  });

  it('names the skill for the DM', async () => {
    const h = await makeHandout();
    expect(h.checkSkillName).toBe('Arcana');
  });
});

describe('redaction — what reaches a player', () => {
  it('sends neither body while the check is pending', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    const { row, raw } = await playerPayload(h.id);
    expect(row.outcome).toBe('pending');
    expect(row.canRoll).toBe(true);
    expect(row.promptText).toBe(PROMPT);
    expect(raw).not.toContain(SUCCESS_BODY);
    expect(raw).not.toContain(FAIL_BODY);
  });

  it('never leaks the skill name, the DC or the roll total', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const { raw } = await playerPayload(h.id);
    expect(raw).not.toContain('Arcana');
    expect(raw).not.toContain('checkDc');
    expect(raw).not.toContain('rollTotal');
    expect(raw).not.toContain('checkSkill');
  });

  it('still sends neither body after rolling, before the DM confirms', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const { row, raw } = await playerPayload(h.id);
    expect(row.outcome).toBe('rolled');
    expect(row.awaitingDm).toBe(true);
    expect(raw).not.toContain(SUCCESS_BODY);
    expect(raw).not.toContain(FAIL_BODY);
  });

  it('sends the success body ONLY on success', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'success' });
    const { row, raw } = await playerPayload(h.id);
    expect(row.text).toBe(SUCCESS_BODY);
    expect(raw).not.toContain(FAIL_BODY);
  });

  it('sends the fail body ONLY on failure', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'fail' });
    const { row, raw } = await playerPayload(h.id);
    expect(row.text).toBe(FAIL_BODY);
    expect(raw).not.toContain(SUCCESS_BODY);
  });

  it('swaps the body cleanly when the DM re-tags', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'success' });
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'fail' });
    const { row, raw } = await playerPayload(h.id);
    expect(row.text).toBe(FAIL_BODY);
    expect(raw).not.toContain(SUCCESS_BODY);
  });

  it('hides a handout entirely from a character it was not given to', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    const { row } = await playerPayload(h.id, gaston);
    expect(row).toBeUndefined();
    expect((await gaston(request(app).get(`/api/handouts/${h.id}`))).status).toBe(404);
  });

  it('carries both bodies for the DM', async () => {
    const h = await makeHandout();
    const res = await dm(request(app).get(`/api/handouts/${h.id}`));
    expect(res.body.successText).toBe(SUCCESS_BODY);
    expect(res.body.failText).toBe(FAIL_BODY);
  });
});

describe('the blind check', () => {
  it('returns no number to the roller', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    const res = await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rolls d20 + the character's own skill modifier", async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const rec = ldb.getHandoutRecipient(h.id, ALIYR);
    // sk-2 is +11, so the total must land in 12..31.
    expect(rec.rollTotal).toBeGreaterThanOrEqual(12);
    expect(rec.rollTotal).toBeLessThanOrEqual(31);
    expect(rec.rollDetail).toMatch(/^d20\(\d+\) \+ 11$/);
  });

  it('handles a negative modifier', async () => {
    const h = await makeHandout();
    await handTo(h.id, [GASTON]);
    await gaston(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const rec = ldb.getHandoutRecipient(h.id, GASTON);
    expect(rec.rollTotal).toBeGreaterThanOrEqual(0);
    expect(rec.rollTotal).toBeLessThanOrEqual(19);
    expect(rec.rollDetail).toMatch(/− 1$/);
  });

  it('logs the roll to chat as dmOnly', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const entries = ldb.listChatLog().filter(e => e.label && e.label.includes('Ley-Stone'));
    expect(entries).toHaveLength(1);
    expect(entries[0].dmOnly).toBe(true);
  });

  it('refuses a second roll', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    expect((await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({})).status).toBe(409);
  });

  it('refuses a roll with the wrong character password', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    const res = await request(app).post(`/api/handouts/${h.id}/roll`)
      .set('X-Character-Id', ALIYR).set('X-Character-Password', 'wrong').send({});
    expect(res.status).toBe(401);
  });

  it('refuses a roll on a handout the character does not hold', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    expect((await gaston(request(app).post(`/api/handouts/${h.id}/roll`)).send({})).status).toBe(404);
  });

  it('refuses a roll when the handout needs no check', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id, [ALIYR]);
    expect((await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({})).status).toBe(400);
  });
});

describe('DC guidance and confirmation', () => {
  it('suggests an outcome but does not apply it', async () => {
    const h = await makeHandout();               // Arcana, DC 14
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const res = await dm(request(app).get(`/api/handouts/${h.id}`));
    const rec = res.body.recipients.find(r => r.charId === ALIYR);
    // The suggestion must track the actual total. Aliyr's +11 spans 12..31, so a
    // natural 1 or 2 genuinely misses DC 14 — asserting a fixed 'success' here
    // would be a once-in-ten flake.
    expect(rec.suggested).toBe(rec.rollTotal >= 14 ? 'success' : 'fail');
    expect(rec.outcome).toBe('rolled');       // suggested, NOT applied
    const { raw } = await playerPayload(h.id);
    expect(raw).not.toContain(SUCCESS_BODY);  // nothing reached the player
    expect(raw).not.toContain(FAIL_BODY);
  });

  it('suggests success when the modifier cannot miss', async () => {
    // +11 against DC 12: the floor is 1 + 11 = 12, so this is deterministic.
    const h = await makeHandout({ checkDc: 12 });
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const res = await dm(request(app).get(`/api/handouts/${h.id}`));
    expect(res.body.recipients.find(r => r.charId === ALIYR).suggested).toBe('success');
  });

  it('suggests failure when the modifier cannot reach the DC', async () => {
    // Gaston is -1, so his ceiling is 20 - 1 = 19 against DC 30.
    const h = await makeHandout({ checkDc: 30 });
    await handTo(h.id, [GASTON]);
    await gaston(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const res = await dm(request(app).get(`/api/handouts/${h.id}`));
    expect(res.body.recipients.find(r => r.charId === GASTON).suggested).toBe('fail');
  });

  it('offers no suggestion when no DC was set', async () => {
    const h = await makeHandout({ checkDc: 0 });
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const res = await dm(request(app).get(`/api/handouts/${h.id}`));
    expect(res.body.recipients.find(r => r.charId === ALIYR).suggested).toBeNull();
  });

  it('rejects an unknown outcome', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    const res = await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('clears the roll when sent back to pending, allowing a re-roll', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'pending' });
    expect(ldb.getHandoutRecipient(h.id, ALIYR).rollTotal).toBeNull();
    expect((await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({})).status).toBe(200);
  });
});

describe('handing out and recalling', () => {
  it('defaults to every player character', async () => {
    const h = await makeHandout();
    const res = await handTo(h.id);
    expect(res.body.recipients.map(r => r.charId).sort()).toEqual([ALIYR, GASTON].sort());
  });

  it('starts a checkless handout readable straight away', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id, [ALIYR]);
    const { row } = await playerPayload(h.id);
    expect(row.outcome).toBe('success');
    expect(row.requiresCheck).toBe(false);
    expect(row.text).toBe(SUCCESS_BODY);
  });

  it('is idempotent — handing out twice does not duplicate or reset', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    const res = await handTo(h.id, [ALIYR]);
    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].outcome).toBe('rolled');   // roll survived
  });

  it('recalls from one character, and from everyone', async () => {
    const h = await makeHandout();
    await handTo(h.id);
    await dm(request(app).post(`/api/handouts/${h.id}/recall`)).send({ charId: ALIYR });
    expect((await playerPayload(h.id)).row).toBeUndefined();
    expect((await playerPayload(h.id, gaston)).row).toBeDefined();

    await dm(request(app).post(`/api/handouts/${h.id}/recall`)).send({});
    expect((await playerPayload(h.id, gaston)).row).toBeUndefined();
  });

  it('drops recipients when the handout is deleted', async () => {
    const h = await makeHandout();
    await handTo(h.id);
    await dm(request(app).delete(`/api/handouts/${h.id}`));
    expect(ldb.listHandoutRecipients(h.id)).toHaveLength(0);
    expect((await aliyr(request(app).get('/api/handouts'))).body).toEqual([]);
  });

  it('broadcasts the events other clients listen for', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'fail' });
    const actions = broadcasts.filter(b => b.event === 'handouts').map(b => b.payload.action);
    expect(actions).toEqual(['created', 'handed-out', 'rolled', 'outcome']);
  });
});

describe('seen / unread', () => {
  it('stamps seenAt for the character that read it', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id, [ALIYR]);
    expect((await playerPayload(h.id)).row.seenAt).toBe('');
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    expect((await playerPayload(h.id)).row.seenAt).not.toBe('');
  });

  it('will not mark a handout the character does not hold', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id, [ALIYR]);
    expect((await gaston(request(app).post(`/api/handouts/${h.id}/seen`)).send({})).status).toBe(404);
  });
});

// seenAt is what stops the table screen replaying a handout on every reload, so
// it has to be the server that decides when there is something new to show. A
// client-side "already shown" list cannot: it dies with the page.
describe('seenAt drives re-showing', () => {
  const seenAt = (id, charId = ALIYR) => ldb.getHandoutRecipient(id, charId).seenAt;

  it('stays marked across repeated reads', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    const first = seenAt(h.id);
    expect(first).not.toBe('');
    // Re-fetching must not clear it — that is what would replay the handout.
    await aliyr(request(app).get('/api/handouts'));
    expect(seenAt(h.id)).toBe(first);
  });

  it('clears when the DM confirms an outcome, so the body surfaces', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    expect(seenAt(h.id)).not.toBe('');

    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'success' });
    expect(seenAt(h.id)).toBe('');
    const { row } = await playerPayload(h.id);
    expect(row.seenAt).toBe('');
    expect(row.text).toBe(SUCCESS_BODY);
  });

  it('clears again when the DM re-tags', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'success' });
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    await dm(request(app).patch(`/api/handouts/${h.id}/recipients/${ALIYR}`)).send({ outcome: 'fail' });
    expect(seenAt(h.id)).toBe('');
  });

  it('clears when the DM re-sends it, without disturbing the roll', async () => {
    const h = await makeHandout();
    await handTo(h.id, [ALIYR]);
    await aliyr(request(app).post(`/api/handouts/${h.id}/roll`)).send({});
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    const rolled = ldb.getHandoutRecipient(h.id, ALIYR).rollTotal;

    await handTo(h.id, [ALIYR]);          // the DM re-sends it
    const rec = ldb.getHandoutRecipient(h.id, ALIYR);
    expect(rec.seenAt).toBe('');          // shows again
    expect(rec.outcome).toBe('rolled');   // but the roll survives
    expect(rec.rollTotal).toBe(rolled);
  });

  it('leaves other recipients alone when re-sending to one', async () => {
    const h = await makeHandout({ checkSkill: -1 });
    await handTo(h.id);                                   // both characters
    await aliyr(request(app).post(`/api/handouts/${h.id}/seen`)).send({});
    await gaston(request(app).post(`/api/handouts/${h.id}/seen`)).send({});

    await handTo(h.id, [ALIYR]);                          // re-send to Aliyr only
    expect(seenAt(h.id, ALIYR)).toBe('');
    expect(seenAt(h.id, GASTON)).not.toBe('');
  });
});
