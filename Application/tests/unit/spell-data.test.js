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

describe('spellCastOptions — what the pop-up greys out and the server allows', () => {
  const sp = o => S.normalizeSpell({ name: 'x', level: 3, prepared: true, ...o });
  const slots = (o) => ({ 'slot-1-total': '4', 'slot-1-used': '0', 'slot-3-total': '2', 'slot-3-used': '2', 'slot-5-total': '1', 'slot-5-used': '0', ...o });

  it('offers the spell\'s level and higher, greys the spent ones, and starts on the lowest open one', () => {
    const r = S.spellCastOptions(sp({}), slots());
    expect(r.options.map(o => [o.level, o.available])).toEqual([[3, false], [5, true]]);
    expect(r.castable).toBe(true);
    expect(r.best).toMatchObject({ mode: 'slot', level: 5 });
  });

  it('cannot be cast when every slot of its level or higher is spent', () => {
    const r = S.spellCastOptions(sp({}), slots({ 'slot-5-used': '1' }));
    expect(r.castable).toBe(false);
    expect(r.reason).toBe('No spell slots left');
  });

  it('never offers a lower slot than the spell needs', () => {
    expect(S.spellCastOptions(sp({}), slots()).options.some(o => o.level === 1)).toBe(false);
  });

  it('a cantrip always casts', () => {
    const r = S.spellCastOptions(sp({ level: 0 }), {});
    expect(r).toMatchObject({ castable: true, best: { mode: 'cantrip' } });
  });

  it('a no-slot spell uses itself first, then slots once its uses are gone', () => {
    const fresh = S.spellCastOptions(sp({ noSlot: true, uses: 1, used: 0, prepared: false }), slots());
    expect(fresh.best).toMatchObject({ mode: 'free', left: 1 });
    const spent = S.spellCastOptions(sp({ noSlot: true, uses: 1, used: 1 }), slots());
    expect(spent.options[0]).toMatchObject({ mode: 'free', available: false });
    expect(spent.best).toMatchObject({ mode: 'slot', level: 5 });
    const atWill = S.spellCastOptions(sp({ noSlot: true }), {});
    expect(atWill.best).toMatchObject({ mode: 'free', available: true, left: null });
  });

  it('says "No uses left" for a no-slot spell with nothing else to fall back on', () => {
    const r = S.spellCastOptions(sp({ noSlot: true, uses: 1, used: 1 }), {});
    expect(r).toMatchObject({ castable: false, reason: 'No uses left' });
  });

  it('a ritual can always be cast as one', () => {
    const r = S.spellCastOptions(sp({ ritual: true }), slots({ 'slot-5-used': '1' }));
    expect(r.castable).toBe(true);
    expect(r.best.mode).toBe('ritual');
  });

  it('refuses a spell that is not prepared, unless the character does not prepare', () => {
    expect(S.spellCastOptions(sp({ prepared: false }), slots()).reason).toBe('Not prepared');
    expect(S.spellCastOptions(sp({ prepared: false }), slots({ 'sp-no-prep': true })).castable).toBe(true);
  });
});

describe('spellCastInfo — the card\'s attack, save and damage', () => {
  const FIREBALL = S.normalizeSpell({ name: 'Fireball', level: 3,
    entries: ['Each creature in a 20-foot-radius Sphere makes a Dexterity saving throw, taking {@damage 8d6} Fire damage on a failed save.'],
    higher: [{ type: 'entries', name: 'Using a Higher-Level Spell Slot', entries: ['The damage increases by {@scaledamage 8d6|3-9|1d6} for each spell slot level above 3.'] }] });

  it('reads the save and damage from the text, and scales with the slot', () => {
    expect(S.spellCastInfo(FIREBALL, null, 3, 5)).toMatchObject({ save: 'Dexterity', damage: '8d6', damageType: 'fire', attack: null });
    expect(S.spellCastInfo(FIREBALL, null, 5, 9).damage).toBe('10d6');
  });

  it('takes attack, save and damage type from the library\'s 5etools object when it has one', () => {
    const bolt = S.normalizeSpell({ name: 'Fire Bolt', level: 0, entries: ['Make a ranged spell attack. {@damage 1d10} Fire damage.'] });
    const raw = { spellAttack: ['R'], damageInflict: ['fire'], scalingLevelDice: { label: 'fire damage', scaling: { 1: '1d10', 5: '2d10', 11: '3d10', 17: '4d10' } } };
    expect(S.spellCastInfo(bolt, raw, 0, 4)).toMatchObject({ attack: 'ranged', damage: '1d10', damageType: 'fire' });
    expect(S.spellCastInfo(bolt, raw, 0, 11).damage).toBe('3d10');
  });

  it('finds healing', () => {
    const cure = S.normalizeSpell({ name: 'Cure Wounds', level: 1, entries: ['A creature you touch regains a number of Hit Points equal to {@dice 2d8} plus your modifier.'],
      higher: [{ type: 'entries', entries: ['{@scaledice 2d8|1-9|2d8}'] }] });
    expect(S.spellCastInfo(cure, null, 2, 3)).toMatchObject({ healing: true, damage: '4d8', damageType: 'healing' });
  });

  it('keeps a modifier and adds a different die on', () => {
    const mm = S.normalizeSpell({ name: 'x', level: 1, entries: ['{@damage 1d4 + 1}'], higher: [{ type: 'entries', entries: ['{@scaledamage 1d4|1-9|1d8}'] }] });
    expect(S.spellCastInfo(mm, null, 1, 1).damage).toBe('1d4+1');
    expect(S.spellCastInfo(mm, null, 3, 1).damage).toBe('1d4+1+2d8');
  });

  it('reads dice from a typed spell\'s notes', () => {
    const typed = S.normalizeSpell({ name: 'Zap', level: 1, notes: 'Deals 3d6 lightning' });
    expect(S.spellCastInfo(typed, null, 1, 1).damage).toBe('3d6');
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
