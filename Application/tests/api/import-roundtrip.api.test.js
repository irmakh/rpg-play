/**
 * Regression tests for two import paths that silently lost data.
 *
 * 1. GET /api/monsters/:id/export wraps the stored row as
 *      { id, name, cr, dataJson, portraitB64, createdAt }
 *    while POST /api/monsters/import had always treated each array element as a
 *    RAW 5etools stat block. Feeding an export back in therefore stored the
 *    WRAPPER as the stat block: the monster kept its name and CR but lost every
 *    action, and the real stat block ended up stranded inside a nested dataJson
 *    string. Import now recognises both shapes.
 *
 * 2. POST /api/loot/import wrote to the retired loot_items table. That table is
 *    only ever read by migrateTreasury(), which runs once and only while
 *    treasury_items is still empty — so in any campaign that has ever held
 *    treasury data, imported loot was stranded: invisible on the Treasury screen
 *    and absent from every backup (BACKUP_PARTS has no 'loot'). It now writes to
 *    treasury_items.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp } from '../helpers/test-app.js';

let app, ldb, masterPw;

beforeEach(() => {
  ({ app, ldb, masterPw } = makeApp());
});

const RAW_GOBLIN = {
  name: 'Goblin',
  cr: '1/4',
  hp: { average: 7 },
  marker: 'RAW',
  action: [{
    name: 'Scimitar',
    entries: ['{@atk mw} {@hit 4} to hit. {@h}5 ({@damage 1d6 + 2}) slashing damage.'],
  }],
};

async function importRaw(body) {
  return request(app).post('/api/monsters/import')
    .set('X-Master-Password', masterPw).send(body);
}

// ── Monsters ──────────────────────────────────────────────────────────────────
describe('POST /api/monsters/import — raw stat blocks (the 5etools paste path)', () => {
  it('imports a raw stat block and stores it whole', async () => {
    const res = await importRaw({ monsters: [RAW_GOBLIN] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: 1 });

    const [row] = ldb.listMonsters();
    const data = JSON.parse(row.dataJson);
    expect(row.name).toBe('Goblin');
    expect(row.cr).toBe('1/4');
    expect(data.action).toHaveLength(1);
    expect(data.marker).toBe('RAW');
  });

  it('reads a cr given as an object', async () => {
    await importRaw({ monsters: [{ ...RAW_GOBLIN, cr: { cr: '5', lair: '6' } }] });
    expect(ldb.listMonsters()[0].cr).toBe('5');
  });

  it('falls back to ? when cr is missing', async () => {
    const { cr, ...noCr } = RAW_GOBLIN;
    await importRaw({ monsters: [noCr] });
    expect(ldb.listMonsters()[0].cr).toBe('?');
  });

  it('imports several monsters at once', async () => {
    await importRaw({ monsters: [RAW_GOBLIN, { ...RAW_GOBLIN, name: 'Hobgoblin' }] });
    expect(ldb.listMonsters().map(m => m.name).sort()).toEqual(['Goblin', 'Hobgoblin']);
  });

  it('skips entries with no name', async () => {
    const res = await importRaw({ monsters: [RAW_GOBLIN, { cr: '1' }] });
    expect(res.body.count).toBe(1);
  });

  it('rejects a non-array payload', async () => {
    expect((await importRaw({ monsters: 'nope' })).status).toBe(400);
  });

  it('rejects an empty array', async () => {
    expect((await importRaw({ monsters: [] })).status).toBe(400);
  });

  it('rejects an array with nothing valid in it', async () => {
    expect((await importRaw({ monsters: [{ cr: '1' }] })).status).toBe(400);
  });

  it('requires the master password', async () => {
    const res = await request(app).post('/api/monsters/import').send({ monsters: [RAW_GOBLIN] });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/monsters/import — re-importing an exported monster', () => {
  async function exportFirstMonster() {
    const id = ldb.listMonsters()[0].id;
    const res = await request(app).get(`/api/monsters/${id}/export`).set('X-Master-Password', masterPw);
    expect(res.status).toBe(200);
    return res.body;
  }

  it('keeps the stat block instead of storing the export wrapper', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    const exported = await exportFirstMonster();
    await importRaw(exported);

    expect(ldb.listMonsters()).toHaveLength(2);
    const copy = ldb.listMonsters().find(m => m.id !== ldb.listMonsters()[0].id) || ldb.listMonsters()[1];
    const data = JSON.parse(copy.dataJson);
    expect(data.action).toHaveLength(1);          // used to be undefined
    expect(data.marker).toBe('RAW');
  });

  it('does not leak wrapper keys into the stat block', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    await importRaw(await exportFirstMonster());
    for (const row of ldb.listMonsters()) {
      const data = JSON.parse(row.dataJson);
      expect(data).not.toHaveProperty('dataJson');
      expect(data).not.toHaveProperty('portraitB64');
      expect(data).not.toHaveProperty('createdAt');
    }
  });

  it('carries name and cr across the round trip', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    await importRaw(await exportFirstMonster());
    for (const row of ldb.listMonsters()) {
      expect(row.name).toBe('Goblin');
      expect(row.cr).toBe('1/4');
    }
  });

  it('gives the imported copy its own id', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    const original = ldb.listMonsters()[0].id;
    await importRaw(await exportFirstMonster());
    const ids = ldb.listMonsters().map(m => m.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(original);
  });

  it('survives repeated export/import cycles without degrading', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    for (let i = 0; i < 3; i++) await importRaw(await exportFirstMonster());
    expect(ldb.listMonsters()).toHaveLength(4);
    for (const row of ldb.listMonsters()) {
      expect(JSON.parse(row.dataJson).action).toHaveLength(1);
    }
  });

  it('tolerates a wrapper whose dataJson is malformed', async () => {
    const res = await importRaw({ monsters: [{ name: 'Broken', cr: '1', dataJson: '{not json' }] });
    expect(res.status).toBe(200);
    const row = ldb.listMonsters()[0];
    expect(row.name).toBe('Broken');
    expect(JSON.parse(row.dataJson).name).toBe('Broken');   // name backfilled
  });

  it('treats a stat block with no dataJson key as raw, not as a wrapper', async () => {
    await importRaw({ monsters: [RAW_GOBLIN] });
    expect(JSON.parse(ldb.listMonsters()[0].dataJson).action).toHaveLength(1);
  });
});

// ── Loot ──────────────────────────────────────────────────────────────────────
describe('POST /api/loot/import — writes to treasury, not the retired table', () => {
  const send = (body) => request(app).post('/api/loot/import')
    .set('X-Master-Password', masterPw).send(body);

  it('creates treasury items', async () => {
    const res = await send({ text: 'Ring\nA plain band.\n\nCoin\nWorn smooth.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: 2 });
    expect(ldb.listTreasuryItems().map(i => i.name).sort()).toEqual(['Coin', 'Ring']);
  });

  it('leaves the retired loot_items table completely untouched', async () => {
    await send({ text: 'Ring\nA plain band.' });
    expect(ldb.listLootItems()).toHaveLength(0);
  });

  it('keeps a multi-line description', async () => {
    await send({ text: 'Ring\nA plain band.\nSecond line' });
    expect(ldb.listTreasuryItems()[0].description).toBe('A plain band.\nSecond line');
  });

  it('applies the tag to every imported row', async () => {
    await send({ text: 'Ring\nband\n\nCoin\nsmooth', tag: 'hoard' });
    for (const i of ldb.listTreasuryItems()) expect(i.tag).toBe('hoard');
  });

  it('imports hidden, matching what the old loot rows migrated to', async () => {
    await send({ text: 'Ring\nA plain band.' });
    expect(ldb.listTreasuryItems()[0].mode).toBe('hidden');
  });

  it('handles a name-only block with no description', async () => {
    await send({ text: 'Ring' });
    expect(ldb.listTreasuryItems()[0]).toMatchObject({ name: 'Ring', description: '' });
  });

  it('rejects empty text', async () => {
    expect((await send({ text: '' })).status).toBe(400);
  });

  it('rejects whitespace-only text', async () => {
    expect((await send({ text: '   \n\n   ' })).status).toBe(400);
  });

  it('requires the master password', async () => {
    const res = await request(app).post('/api/loot/import').send({ text: 'Ring' });
    expect(res.status).toBe(401);
  });

  it('imported loot is picked up by the treasury listing that backup reads', async () => {
    await send({ text: 'Ring\nA plain band.' });
    // buildBackupPart('treasury') exports exactly this list — the old loot_items
    // rows never appeared in it.
    expect(ldb.listTreasuryItems().map(i => i.name)).toContain('Ring');
  });
});
