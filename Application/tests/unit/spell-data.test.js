// Written by Irmak Hakman — 2026-11-11 17:20
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * js/lib/spell-data.js — the one spell shape every page uses.
 *
 * Loaded as the real browser script in a vm. Covers reading the old
 * 15-element rows, turning a 5etools spell into a sheet spell, rendering
 * 5etools text without letting markup through, and the readiness rules the
 * spellbook filters and (next release) the Cast pop-up depend on.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx = createContext({ JSON, Math, Date, String, Number, Array, Object, Set });
runInContext(readFileSync(resolve(__dirname, '../../public/js/lib/spell-data.js'), 'utf-8'), ctx);
const S = ctx;

// The example the feature was asked for with (trimmed of the class/feat lists).
const MAGIC_MISSILE = {
  name: 'Magic Missile', source: 'XPHB', page: 295, level: 1, school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'point', distance: { type: 'feet', amount: 120 } },
  components: { v: true, s: true },
  duration: [{ type: 'instant' }],
  entries: ['You create three glowing darts of magical force. Each dart strikes a creature of your choice that you can see within range. A dart deals {@damage 1d4 + 1} Force damage to its target.'],
  entriesHigherLevel: [{ type: 'entries', name: 'Using a Higher-Level Spell Slot', entries: ['The spell creates one more dart for each spell slot level above 1.'] }],
  damageInflict: ['force'],
  classes: { fromClassList: [{ name: 'Sorcerer', source: 'XPHB' }, { name: 'Wizard', source: 'XPHB' }] },
};

describe('normalizeSpell — the old array rows', () => {
  const OLD = ['2', 'Hold Person', '1 Action', '60 feet', true, false, 'Paralyzed!', true,
               'Ench', true, true, true, 'a small piece of iron', 'action', 'Up to 1 minute'];

  it('reads every position', () => {
    const s = S.normalizeSpell(OLD);
    expect(s).toMatchObject({
      level: 2, name: 'Hold Person', castText: '1 Action', cast: 'action', range: '60 feet',
      conc: true, ritual: false, notes: 'Paralyzed!', prepared: true, school: 'Ench',
      v: true, s: true, m: true, material: 'a small piece of iron', duration: 'Up to 1 minute',
      noSlot: false, uses: 0, used: 0, recharge: '',
    });
  });

  it('reads a short row from very old sheets', () => {
    const s = S.normalizeSpell(['0', 'Fire Bolt', 'Action', '', false, false, '', false]);
    expect(s).toMatchObject({ level: 0, name: 'Fire Bolt', cast: 'action', school: '', duration: '' });
  });

  it('works the casting type out of the text, and falls back to the old Actions choice', () => {
    expect(S.normalizeSpell(['1', 'x', '1 bonus action']).cast).toBe('bonus');
    expect(S.normalizeSpell(['1', 'x', '1 Reaction']).cast).toBe('reaction');
    expect(S.normalizeSpell(['1', 'x', '10 minutes']).cast).toBe('minute');
    expect(S.normalizeSpell(['1', 'x', '1 hour']).cast).toBe('hour');
    const r = ['1', 'x', 'special']; r[13] = 'reaction';
    expect(S.normalizeSpell(r).cast).toBe('reaction');
  });

  it('turns odd values into safe ones', () => {
    const s = S.normalizeSpell({ name: 'x'.repeat(500), level: 42, uses: 3, used: 9, recharge: 'sometimes',
                                 source: { kind: 'nonsense', detail: 'y' }, cast: 'teleport' });
    expect(s.name).toHaveLength(120);
    expect(s.level).toBe(9);
    expect(s.used).toBe(3);
    expect(s.recharge).toBe('');
    expect(s.source).toEqual({ kind: '', detail: 'y' });
    expect(s.cast).toBe('action');
  });

  it('never throws, and gives every spell an id', () => {
    for (const v of [null, undefined, 7, 'text', [], {}]) {
      const s = S.normalizeSpell(v);
      expect(s.id).toMatch(/^sp-/);
    }
    expect(S.normalizeSpell({ id: 'keep-me' }).id).toBe('keep-me');
  });
});

describe('parseSpellList', () => {
  it('reads a JSON string, an array, mixed shapes, and junk', () => {
    expect(S.parseSpellList(JSON.stringify([['1', 'A'], { name: 'B' }, null])).map(s => s.name)).toEqual(['A', 'B']);
    expect(S.parseSpellList([{ name: 'C' }]).map(s => s.name)).toEqual(['C']);
    expect(S.parseSpellList('not json')).toEqual([]);
    expect(S.parseSpellList(undefined)).toEqual([]);
    expect(S.parseSpellList('{"a":1}')).toEqual([]);
  });
});

describe('spellFrom5e', () => {
  it('turns the Magic Missile example into a sheet spell', () => {
    const s = S.spellFrom5e(MAGIC_MISSILE, 'lib-1');
    expect(s).toMatchObject({
      libId: 'lib-1', book: 'XPHB p295', name: 'Magic Missile', level: 1, school: 'Evoc',
      cast: 'action', castText: '1 Action', range: '120 feet', duration: 'Instantaneous',
      conc: false, ritual: false, v: true, s: true, m: false, prepared: false,
    });
    expect(s.entries).toHaveLength(1);
    expect(s.higher).toHaveLength(1);
  });

  it('reads concentration, rituals, materials, reactions and areas', () => {
    const s = S.spellFrom5e({
      name: 'Detect Magic', level: 1, school: 'D', meta: { ritual: true },
      time: [{ number: 1, unit: 'reaction', condition: 'which you take when you see {@spell fireball}' }],
      range: { type: 'cone', distance: { type: 'feet', amount: 15 } },
      components: { v: true, m: { text: 'a pinch of sulfur', cost: 0 } },
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 10, upTo: true }, concentration: true }],
    });
    expect(s).toMatchObject({
      cast: 'reaction', ritual: true, conc: true, m: true, material: 'a pinch of sulfur',
      range: 'Self (15-foot cone)', duration: 'Up to 10 minutes', school: 'Div',
    });
    expect(s.castText).toBe('1 Reaction, which you take when you see fireball');
  });

  it('copes with a spell that has almost nothing', () => {
    const s = S.spellFrom5e({ name: 'Mystery' });
    expect(s).toMatchObject({ name: 'Mystery', level: 0, cast: 'action', range: '', duration: '' });
  });
});

describe('spellTextHTML / spellInlineHTML', () => {
  it('renders 5etools tags as plain emphasis', () => {
    const html = S.spellDescHTML(S.spellFrom5e(MAGIC_MISSILE));
    expect(html).toContain('<b>1d4 + 1</b> Force damage');
    expect(html).toContain('<b><i>Using a Higher-Level Spell Slot.</i></b> The spell creates');
  });

  it('escapes every bit of markup that came in the JSON', () => {
    const html = S.spellTextHTML([
      '<img src=x onerror=alert(1)>',
      { type: 'list', items: ['<script>alert(1)</script>', { name: '<b onmouseover=x>', entries: ['"quoted"'] }] },
      { type: 'entries', name: '<svg onload=alert(1)>', entries: ['{@spell <i onclick=x>|PHB}'] },
      { type: 'table', colLabels: ['<u>'], rows: [['<a href=javascript:x>']] },
    ]);
    expect(html).not.toMatch(/<(img|script|svg|a|u)\b/i);
    // No real tag carries an event handler (the escaped text may still spell one out).
    expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
    expect(html).toContain('&lt;img');
  });

  it('shows a scaled die by its per-level step and drops unknown empty tags', () => {
    expect(S.spellInlineHTML('{@scaledamage 8d6|3-9|1d6} more {@note}')).toBe('<b>1d6</b> more ');
    expect(S.spellInlineHTML('{@dc 15} and {@hit 5}')).toBe('DC 15 and +5');
  });

  it('stays bounded on deeply nested text', () => {
    let e = ['bottom'];
    for (let i = 0; i < 50; i++) e = [{ type: 'entries', entries: e }];
    expect(() => S.spellTextHTML(e)).not.toThrow();
  });
});

describe('readiness', () => {
  const sp = o => S.normalizeSpell({ name: 'x', level: 1, ...o });
  it('cantrips and spells that need no slot are always ready', () => {
    expect(S.spellIsReady(sp({ level: 0 }), true)).toBe(true);
    expect(S.spellIsReady(sp({ noSlot: true }), true)).toBe(true);
  });
  it('a levelled spell needs preparing, unless the character does not prepare', () => {
    expect(S.spellIsReady(sp({ prepared: false }), true)).toBe(false);
    expect(S.spellIsReady(sp({ prepared: true }), true)).toBe(true);
    expect(S.spellIsReady(sp({ prepared: false }), false)).toBe(true);
  });
  it('reads the sheet\'s "no preparing" box, which defaults to off', () => {
    expect(S.spellPrepares({})).toBe(true);
    expect(S.spellPrepares(null)).toBe(true);
    expect(S.spellPrepares({ 'sp-no-prep': true })).toBe(false);
    expect(S.spellPrepares({ 'sp-no-prep': 'false' })).toBe(true);
  });
  it('counts prepared levelled spells only', () => {
    const list = [sp({ level: 0, prepared: true }), sp({ prepared: true }), sp({ prepared: true, noSlot: true }), sp({})];
    expect(S.spellPreparedCount(list)).toBe(1);
  });
  it('puts action, bonus and reaction spells in the Actions tab, and nothing else', () => {
    expect(['action', 'bonus', 'reaction', 'minute', 'other'].map(c => S.spellActionCategory(sp({ cast: c }))))
      .toEqual(['action', 'bonus', 'reaction', '', '']);
  });
});

describe('labels', () => {
  it('names a source as kind and detail', () => {
    expect(S.spellSourceLabel({ kind: 'feat', detail: 'Magic Initiate' })).toBe('Feat: Magic Initiate');
    expect(S.spellSourceLabel({ kind: 'feature', detail: '' })).toBe('Class feature');
    expect(S.spellSourceLabel({ kind: '', detail: 'Ring of Spell Storing' })).toBe('Ring of Spell Storing');
    expect(S.spellSourceLabel(null)).toBe('');
  });
  it('lists the classes a library spell is on', () => {
    expect(S.spellClasses(MAGIC_MISSILE)).toEqual(['Sorcerer', 'Wizard']);
    expect(S.spellClasses({})).toEqual([]);
  });
  it('maps school names and 5etools letters to the sheet\'s codes', () => {
    expect(['V', 'Abjuration', 'necro', 'Trans', ''].map(S.spellSchoolCode)).toEqual(['Evoc', 'Abj', 'Necro', 'Trans', '']);
  });
});
