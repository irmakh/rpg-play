// Written by Irmak Hakman — 2026-11-11 19:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * scripts/import_spells.mjs — the 5etools spell import, without the network.
 *
 * The registry and campaign folders point at a temp directory BEFORE the script
 * is imported (both modules read the env at load), so no real campaign is
 * touched. The spell files are small hand-made ones in the 5etools shape.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let S, cdb, store, localdb, camp;

const XPHB_MM = { name: 'Magic Missile', source: 'XPHB', page: 295, level: 1, school: 'V',
  time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 120 } },
  components: { v: true, s: true }, duration: [{ type: 'instant' }], entries: ['Darts: {@damage 1d4 + 1}.'] };
const PHB_MM = { ...XPHB_MM, source: 'PHB', page: 257, entries: ['Old darts.'] };
const XGE_ONLY = { name: 'Tidal Wave', source: 'XGE', page: 168, level: 3, school: 'C',
  time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 120 } },
  components: { s: true, m: 'a drop of water' }, duration: [{ type: 'instant' }], entries: ['Water.'] };
const LAUGHTER = { name: "Tasha's Hideous Laughter", srd: 'Hideous Laughter', source: 'PHB', page: 280, level: 1, school: 'E',
  time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 30 } },
  components: { v: true, m: 'a feather' },
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }], entries: ['Laughs.'] };
const HUNTERS = { name: "Hunter's Mark", source: 'XPHB', page: 288, level: 1, school: 'D',
  time: [{ number: 1, unit: 'bonus' }], range: { type: 'point', distance: { type: 'feet', amount: 90 } },
  components: { v: true }, duration: [{ type: 'timed', duration: { type: 'hour', amount: 1 }, concentration: true }], entries: ['Marked.'] };

const FILES = [
  { name: 'spells-xphb.json', text: JSON.stringify({ spell: [XPHB_MM, HUNTERS] }) },
  { name: 'spells-phb.json', text: JSON.stringify({ spell: [PHB_MM, LAUGHTER] }) },
  { name: 'spells-xge.json', text: JSON.stringify({ spell: [XGE_ONLY, { name: 'Stub', source: 'XGE', _copy: { name: 'X' } }] }) },
];
const SOURCES = { XPHB: { 'Magic Missile': { class: [{ name: 'Wizard', source: 'XPHB' }, { name: 'Sorcerer', source: 'XPHB' }] } } };

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-spell-import-'));
  process.env.CAMPAIGNS_DB = path.join(tmp, 'campaigns.db');
  process.env.CAMPAIGN_DATA_DIR = path.join(tmp, 'campaigns');
  cdb = await import('../../db/campaignsdb.js');
  store = await import('../../db/campaign-store.js');
  localdb = await import('../../db/localdb.js');
  S = await import('../../scripts/import_spells.mjs');
  camp = cdb.createCampaign({ name: 'Spell Test', dmPassword: 'pw-123' });
});

const spells = () => S.collectSpells(FILES.map(f => ({ ...f })), SOURCES);

function seedCharacter(id, data) {
  const { ldb } = store.getCampaignData(camp.id);
  ldb.createCharacter(id, { name: id, dataJson: JSON.stringify(data), createdAt: new Date().toISOString() });
}
function sheetSpells(id) {
  const { ldb } = store.getCampaignData(camp.id);
  return JSON.parse(JSON.parse(ldb.getCharacter(id).dataJson)._spells);
}

describe('reading the 5etools files', () => {
  it('reads every book and attaches the class lists', () => {
    const list = spells();
    expect(list.map(s => s.source + ':' + s.name)).toContain('XGE:Tidal Wave');
    expect(list.find(s => s.source === 'XPHB' && s.name === 'Magic Missile').classes.fromClassList.map(c => c.name))
      .toEqual(['Wizard', 'Sorcerer']);
  });
  it('refuses a file that is not JSON', () => {
    expect(() => S.collectSpells([{ name: 'bad.json', text: '{oops' }], null)).toThrow(/not valid JSON/);
  });
});

describe('matching names', () => {
  const rows = [
    { id: 'p', name: 'Magic Missile', source: 'PHB', data: PHB_MM },
    { id: 'x', name: 'Magic Missile', source: 'XPHB', data: XPHB_MM },
    { id: 'g', name: 'Tidal Wave', source: 'XGE', data: XGE_ONLY },
    { id: 't', name: "Tasha's Hideous Laughter", source: 'PHB', data: LAUGHTER },
    { id: 'h', name: "Hunter's Mark", source: 'XPHB', data: HUNTERS },
  ];
  // Built on first use: the script is only imported in beforeAll.
  let idx = null;
  const byId = new Map(rows.map(r => [r.id, r]));
  const match = (name, libId = '') => S.findMatch({ name, libId }, idx ||= S.buildIndex(rows), byId)?.id || null;

  it('prefers XPHB, then PHB, then any other book', () => {
    expect(match('Magic Missile')).toBe('x');
    expect(match('Tidal Wave')).toBe('g');
  });
  it('ignores case, spacing, apostrophes and punctuation', () => {
    expect(match('  magic   MISSILE ')).toBe('x');
    expect(match('Hunters Mark')).toBe('h');
    expect(match('Hunter’s Mark')).toBe('h');
    expect(match('MagicMissile')).toBe('x');
  });
  it('finds a spell by its SRD name, or without the wizard\'s name', () => {
    expect(match('Hideous Laughter')).toBe('t');
  });
  it('keeps a spell linked to the row it already has', () => {
    expect(match('Magic Missile', 'p')).toBe('p');
  });
  it('does not guess at typos', () => {
    expect(match('Magic Misile')).toBe(null);
  });
});

describe('linking a sheet spell', () => {
  const row = { id: 'x', name: 'Magic Missile', source: 'XPHB', data: { ...XPHB_MM, classes: { fromClassList: [{ name: 'Wizard' }] } } };

  it('takes the library\'s facts and keeps the player\'s choices', () => {
    const sp = { id: 'sp-1', name: 'magic missile', level: 2, castText: 'Action', range: '120 ft', school: 'Abj',
                 prepared: true, notes: 'my note', noSlot: true, uses: 2, used: 1, recharge: 'long',
                 source: { kind: 'feat', detail: 'Magic Initiate' } };
    const norm = S.linkSpell(normalizeLike(sp), row, 'Wizard');
    expect(norm.spell).toMatchObject({
      id: 'sp-1', libId: 'x', book: 'XPHB p295', name: 'Magic Missile', level: 1, school: 'Evoc',
      castText: '1 Action', range: '120 feet', duration: 'Instantaneous',
      prepared: true, notes: 'my note', noSlot: true, uses: 2, used: 1, recharge: 'long',
      source: { kind: 'feat', detail: 'Magic Initiate' },
    });
    expect(norm.spell.entries).toEqual(XPHB_MM.entries);
    expect(norm.changes.map(c => c[0])).toEqual(expect.arrayContaining(['name', 'level', 'school', 'range', 'library', 'description']));
  });

  it('fills an empty source with the character\'s class when the spell is on its list', () => {
    const r = S.linkSpell(normalizeLike({ name: 'Magic Missile', level: 1 }), row, 'wizard');
    expect(r.spell.source).toEqual({ kind: 'class', detail: 'Wizard' });
    const r2 = S.linkSpell(normalizeLike({ name: 'Magic Missile', level: 1 }), row, 'Fighter');
    expect(r2.spell.source).toEqual({ kind: '', detail: '' });
  });
});

describe('running on a campaign', () => {
  const OLD_ROWS = [
    ['1', 'Magic Missile', 'Action', '120 ft', false, false, 'pew', true],
    ['3', 'Tidal wave', '1 Action', '', false, false, '', false],
    ['1', 'Hideous Laughter', 'Action', '30 ft', true, false, '', true],
    ['2', 'Homebrew Zap', 'Action', '', false, false, 'mine', true],
  ];

  it('a dry run changes nothing', () => {
    seedCharacter('dry', { class: 'Wizard', _spells: JSON.stringify(OLD_ROWS) });
    const before = store.getCampaignData(camp.id).ldb.getCharacter('dry').dataJson;
    const out = S.runCampaign(camp, spells(), { apply: false, log: () => {} });
    expect(out.lib.added).toBe(5);
    expect(out.sheets.linked).toBeGreaterThanOrEqual(3);
    expect(store.getCampaignData(camp.id).ldb.getCharacter('dry').dataJson).toBe(before);
    const lib = localdb.openCampaignDb(path.join(store.campaignDir(camp.id), store.DB_FILES.local));
    expect(lib.listSpells()).toEqual([]);
    lib.close();
  });

  it('--apply fills the library and links the sheets, leaving unknown spells alone', () => {
    seedCharacter('wiz', { class: 'Wizard', _spells: JSON.stringify(OLD_ROWS) });
    const lines = [];
    S.runCampaign(camp, spells(), { apply: true, log: l => lines.push(l) });
    const list = sheetSpells('wiz');
    const byName = Object.fromEntries(list.map(s => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(['Homebrew Zap', 'Magic Missile', "Tasha's Hideous Laughter", 'Tidal Wave']);
    expect(byName['Magic Missile']).toMatchObject({ book: 'XPHB p295', prepared: true, notes: 'pew', source: { kind: 'class', detail: 'Wizard' } });
    expect(byName['Tidal Wave'].book).toBe('XGE p168');
    expect(byName['Homebrew Zap']).toMatchObject({ libId: '', notes: 'mine', level: 2 });
    expect(lines.join('\n')).toMatch(/\? Homebrew Zap/);
    const { ldb } = store.getCampaignData(camp.id);
    expect(ldb.listSpells().map(s => s.source + ':' + s.name).sort())
      .toEqual(['PHB:Magic Missile', "PHB:Tasha's Hideous Laughter", "XGE:Tidal Wave", "XPHB:Hunter's Mark", 'XPHB:Magic Missile']);
  });

  it('a second run finds nothing left to do', () => {
    const out = S.runCampaign(camp, spells(), { apply: true, log: () => {} });
    expect(out.lib).toMatchObject({ added: 0, updated: 0, same: 5 });
    expect(out.sheets.linked).toBe(0);
    expect(out.sheets.changedChars).toBe(0);
  });
});

// The script normalises through the browser code; tests build the same shape.
function normalizeLike(o) {
  return {
    id: o.id || 'sp-t', libId: '', book: '', name: o.name, level: o.level ?? 0, school: o.school || '',
    cast: 'action', castText: o.castText || '', ritual: false, conc: false, range: o.range || '', duration: '',
    v: false, s: false, m: false, material: '', prepared: !!o.prepared, noSlot: !!o.noSlot,
    uses: o.uses || 0, used: o.used || 0, recharge: o.recharge || '',
    source: o.source || { kind: '', detail: '' }, notes: o.notes || '', entries: [], higher: [],
  };
}
