/**
 * The login audit's paging (db/campaignsdb.js listAuthEvents / countAuthEvents),
 * on a real registry database in a temp file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let cdb, tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-auth-events-'));
  process.env.CAMPAIGNS_DB = path.join(tmpDir, 'campaigns.db');
  // Imported AFTER the env var is set — the module opens the registry at load.
  cdb = await import('../../db/campaignsdb.js');
  const now = Date.now();
  for (let i = 1; i <= 23; i++) cdb.recordAuthEvent({ kind: 'login', charName: `#${i}`, ts: now + i });
});

afterAll(() => {
  try { cdb._db.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

const names = rows => rows.map(r => r.charName);

describe('listAuthEvents paging', () => {
  it('counts every event', () => {
    expect(cdb.countAuthEvents()).toBe(23);
  });

  it('pages back from the newest, one slice after another', () => {
    expect(names(cdb.listAuthEvents({ limit: 10, offset: 0 }))).toEqual(
      ['#23', '#22', '#21', '#20', '#19', '#18', '#17', '#16', '#15', '#14']);
    expect(names(cdb.listAuthEvents({ limit: 10, offset: 10 }))).toEqual(
      ['#13', '#12', '#11', '#10', '#9', '#8', '#7', '#6', '#5', '#4']);
    expect(names(cdb.listAuthEvents({ limit: 10, offset: 20 }))).toEqual(['#3', '#2', '#1']);
  });

  it('never repeats or skips an event across pages', () => {
    const seen = [0, 10, 20].flatMap(offset => names(cdb.listAuthEvents({ limit: 10, offset })));
    expect(new Set(seen).size).toBe(23);
  });

  it('keeps working without an offset, and past the end', () => {
    expect(cdb.listAuthEvents({ limit: 5 })).toHaveLength(5);
    expect(cdb.listAuthEvents({ limit: 10, offset: 500 })).toEqual([]);
    expect(cdb.listAuthEvents({ limit: 10, offset: -3 })[0].charName).toBe('#23');
  });
});
