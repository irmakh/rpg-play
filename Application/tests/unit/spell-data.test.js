// Written by Irmak Hakman — 2026-11-11 17:46
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
  it('an always-prepared spell is ready, uses slots, and does not count as prepared', () => {
    const ap = sp({ alwaysPrepared: true, prepared: false });
    expect(S.spellIsReady(ap, true)).toBe(true);
    expect(S.spellPreparedCount([ap, sp({ prepared: true, alwaysPrepared: true }), sp({ prepared: true })])).toBe(1);
    const how = S.spellCastOptions(ap, { 'slot-1-total': '2' });
    expect(how.options.map(o => o.mode)).toEqual(['slot']);
    expect(S.normalizeSpell({ alwaysPrepared: 'true' }).alwaysPrepared).toBe(true);
    expect(S.normalizeSpell(['1', 'Old row']).alwaysPrepared).toBe(false);
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

describe('class rules (v325): rituals, Warlock, Sorcerer', () => {
  const sp = o => S.normalizeSpell({ name: 'x', level: 1, ...o });

  it('an unprepared ritual can be cast only as a ritual', () => {
    const r = S.spellCastOptions(sp({ ritual: true, prepared: false }), { 'slot-1-total': '4' });
    expect(r).toMatchObject({ castable: true, ritualOnly: true });
    expect(r.options.map(o => o.mode)).toEqual(['ritual']);
    expect(S.spellCastOptions(sp({ prepared: false }), {}).castable).toBe(false);
  });

  it('reads Warlock and Sorcerer from the class fields, multiclass included', () => {
    expect(S.spellCasterFlags({ class: 'Warlock' })).toEqual({ warlock: true, sorcerer: false });
    expect(S.spellCasterFlags({ class: 'Fighter / Sorcerer' })).toEqual({ warlock: false, sorcerer: true });
    expect(S.spellCasterFlags({ class: 'Wizard' })).toEqual({ warlock: false, sorcerer: false });
  });

  it('Warlocks and Sorcerers do not prepare: every spell is ready', () => {
    expect(S.spellPrepares({ class: 'Warlock' })).toBe(false);
    expect(S.spellPrepares({ class: 'sorcerer' })).toBe(false);
    expect(S.spellPrepares({ class: 'Cleric' })).toBe(true);
    expect(S.spellIsReady(sp({ prepared: false }), S.spellPrepares({ class: 'Warlock' }))).toBe(true);
  });

  const WARLOCK = { class: 'Warlock', 'pact-slots': '2', 'pact-level': '3', 'pact-used': '0' };

  it('Pact Magic: a pact slot casts at the pact level, and is offered first', () => {
    const r = S.spellCastOptions(sp({ name: 'Hex' }), { ...WARLOCK, 'slot-1-total': '1' });
    expect(r.options.map(o => o.mode)).toEqual(['pact', 'slot']);
    expect(r.best).toMatchObject({ mode: 'pact', level: 3, left: 2 });
    expect(S.spellPactFrom({ ...WARLOCK, 'pact-used': '2' }).left).toBe(0);
    expect(S.spellPactFrom({ class: 'Wizard', 'pact-slots': '2', 'pact-level': '3' })).toBe(null);
  });

  it('a spell above the pact level cannot use a pact slot', () => {
    const r = S.spellCastOptions(sp({ level: 4 }), WARLOCK);
    expect(r).toMatchObject({ castable: false, reason: 'No spell slots left' });
  });

  it('Mystic Arcanum: a Warlock spell of level 6-9, once, no slot', () => {
    const fresh = S.spellCastOptions(sp({ name: 'Eyebite', level: 6 }), WARLOCK);
    expect(fresh.options).toEqual([expect.objectContaining({ mode: 'free', left: 1 })]);
    const used = S.spellCastOptions(sp({ name: 'Eyebite', level: 6, used: 1 }), WARLOCK);
    expect(used).toMatchObject({ castable: false });
    expect(used.reason).toMatch(/long rest/);
    // a multiclass Wizard's 6th-level spell is not an Arcanum
    expect(S.spellIsArcanum(sp({ level: 6, source: { kind: 'class', detail: 'Wizard' } }), WARLOCK)).toBe(false);
  });

  it('Sorcerer: points and the Metamagic it knows', () => {
    const d = { class: 'Sorcerer', 'sorc-points': '5', 'sorc-used': '2', 'mm-quickened': true, 'mm-twinned': 'true' };
    expect(S.spellSorcFrom(d)).toEqual({ max: 5, used: 2, left: 3 });
    expect(S.spellKnownMetamagic(d)).toEqual([
      { key: 'quickened', name: 'Quickened Spell', cost: 2 }, { key: 'twinned', name: 'Twinned Spell', cost: 1 }]);
    expect(S.spellKnownMetamagic({ ...d, class: 'Wizard' })).toEqual([]);
    expect(S.spellMetamagicList()).toHaveLength(10);
  });
});

describe('slots from level (v326)', () => {
  const auto = d => { const r = S.spellAutoSlots(d); return { known: r.known, slots: r.slots.join(''), pact: r.pact, sorc: r.sorc }; };

  it('reads class levels from the Class field, or the Level field for one class', () => {
    expect(S.spellClassLevels({ class: 'Wizard 5 / Cleric 3' })).toEqual([{ name: 'wizard', level: 5 }, { name: 'cleric', level: 3 }]);
    expect(S.spellClassLevels({ class: 'Warlock 3, Sorcerer 5' }).map(c => c.name)).toEqual(['warlock', 'sorcerer']);
    expect(S.spellClassLevels({ class: 'Druid', level: '7' })).toEqual([{ name: 'druid', level: 7 }]);
    expect(S.spellClassLevels({ class: 'Druid' })).toEqual([]);
  });

  it('full, half and third casters use their own tables', () => {
    expect(auto({ class: 'Wizard', level: '5' }).slots).toBe('432000000');
    expect(auto({ class: 'Cleric', level: '20' }).slots).toBe('433332211');
    expect(auto({ class: 'Paladin', level: '1' }).slots).toBe('200000000');      // 2024: from level 1
    expect(auto({ class: 'Ranger', level: '5' }).slots).toBe('420000000');
    expect(auto({ class: 'Fighter', subclass: 'Eldritch Knight', level: '7' }).slots).toBe('420000000');
    expect(auto({ class: 'Rogue', subclass: 'Arcane Trickster', level: '2' }).slots).toBe('000000000');
  });

  it('a Fighter or Rogue without a casting subclass, and a non-caster, change nothing', () => {
    expect(auto({ class: 'Fighter', level: '7' }).known).toBe(false);
    expect(auto({ class: 'Barbarian', level: '7' }).known).toBe(false);
  });

  it('multiclass casters add up their levels', () => {
    expect(auto({ class: 'Wizard 5 / Cleric 3' }).slots).toBe('433200000');       // caster level 8
    expect(auto({ class: 'Paladin 6 / Sorcerer 4' })).toMatchObject({ slots: '433100000', sorc: 4 });   // 4 + 3
  });

  it('Warlock levels give pact slots, Sorcerer levels sorcery points', () => {
    expect(auto({ class: 'Warlock', level: '5' })).toMatchObject({ known: true, slots: '000000000', pact: { slots: 2, level: 3 } });
    expect(auto({ class: 'Warlock', level: '17' }).pact).toEqual({ slots: 4, level: 5 });
    expect(auto({ class: 'Sorcerer', level: '1' }).sorc).toBe(0);
    expect(auto({ class: 'Warlock 3, Sorcerer 5' })).toMatchObject({ slots: '432000000', pact: { slots: 2, level: 2 }, sorc: 5 });
  });
});

describe('monster spellcasting (v329)', () => {
  // A 2024 stat block (the demo campaign's Malgrith) and a 2014 one (a Mage).
  const MALGRITH = { cr: '6', spellcasting: [{ name: 'Spellcasting', headerEntries: ['… (spell save {@dc 15}):'],
    will: ['{@spell Chill Touch|XPHB}', '{@spell Mage Hand|XPHB}'],
    daily: { '2e': ['{@spell Blight|XPHB}', '{@spell Fear|XPHB}'], '1': ['{@spell Animate Dead|XPHB}', '{@spell Darkness|XPHB}'] } }] };
  const MAGE = { cr: '6', spellcasting: [{ headerEntries: ['The mage is a 9th-level spellcaster (spell save {@dc 14}, {@hit 6} to hit with spell attacks).'],
    spells: { 0: { spells: ['{@spell fire bolt}'] }, 1: { slots: 4, spells: ['{@spell magic missile}', '{@spell shield}'] },
              3: { slots: 3, spells: ['{@spell fireball}'] }, 5: { slots: 1, spells: ['{@spell cone of cold}'] } } }] };
  const byId = (rows) => Object.fromEntries(rows.map(r => [r.s.id, r]));

  it('reads the header: save DC, spell attack, caster level', () => {
    expect(S.monsterSpellcasting(MAGE)).toMatchObject({ dc: '14', hit: '+6', casterLevel: 9 });
    expect(S.monsterSpellcasting(MALGRITH)).toMatchObject({ dc: '15', hit: '', casterLevel: 0 });
    expect(S.monsterSpellcasting({}).groups).toEqual([]);
  });

  it('at will always casts; "each" counts per spell; a shared X/day counts together', () => {
    const rows = byId(S.monsterSpellRows(MALGRITH, { '0:daily:2e|blight': 2, '0:daily:1': 1 }, () => null));
    expect(rows['0:will|Chill Touch'].how).toMatchObject({ castable: true, best: { mode: 'will' } });
    expect(rows['0:daily:2e|Blight'].how).toMatchObject({ castable: false, reason: 'No uses left' });
    expect(rows['0:daily:2e|Fear'].how.best).toMatchObject({ mode: 'daily', left: 2, useKey: '0:daily:2e|fear' });
    expect(rows['0:daily:1|Darkness'].how.castable).toBe(false);   // Animate Dead used the shared 1/day
  });

  it('a slotted spell may use its level or higher, from the token\'s own slots', () => {
    const rows = byId(S.monsterSpellRows(MAGE, { '0:s3': 3 }, () => null));
    expect(rows['0:s1|magic missile'].how.options.map(o => [o.level, o.available])).toEqual([[1, true], [3, false], [5, true]]);
    expect(rows['0:s3|fireball'].how.best).toMatchObject({ mode: 'slot', level: 5, useKey: '0:s5' });
    expect(rows['0:s0|fire bolt'].how.best.mode).toBe('cantrip');
    expect(byId(S.monsterSpellRows(MAGE, { '0:s3': 3, '0:s5': 1 }, () => null))['0:s3|fireball'].how.castable).toBe(false);
  });

  it('takes a spell\'s text from the library when it has it', () => {
    const lib = { id: 'L1', data: { name: 'Fireball', level: 3, school: 'V', entries: ['{@damage 8d6} Fire damage.'] } };
    const rows = byId(S.monsterSpellRows(MAGE, '', (name) => (name === 'fireball' ? lib : null)));
    expect(rows['0:s3|fireball'].s).toMatchObject({ name: 'Fireball', libId: 'L1', school: 'Evoc' });
    expect(rows['0:s1|shield'].s.libId).toBe('');
  });

  it('reads spellUses in either form and lists what is left', () => {
    expect(S.parseSpellUses('{"a":1}')).toEqual({ a: 1 });
    expect(S.parseSpellUses('junk')).toEqual({});
    expect(S.parseSpellUses(null)).toEqual({});
    expect(S.monsterSpellUsage(MAGE, { '0:s1': 1 })).toEqual([
      { label: 'Level 1 slots', left: 3, max: 4 }, { label: 'Level 3 slots', left: 3, max: 3 }, { label: 'Level 5 slots', left: 1, max: 1 }]);
    expect(S.monsterSpellUsage(MALGRITH, '').map(u => u.label)).toEqual(['Blight (2/day each)', 'Fear (2/day each)', 'Animate Dead, Darkness (1/day)']);
  });
});

describe('monster spellcasting written only as text', () => {
  // A homebrew 2024-layout stat block: spells live in an action's text.
  const ECE = { name: 'Denizlerin Ecesi', action: [
    { name: 'Multiattack', entries: ['She can replace one of his attacks with Spellcasting.'] },
    { name: 'Spellcasting', entries: ['Denizlerin Ecesi casts one of the following spells, requiring no Material components and using Wisdom as the spellcasting ability (spell save {@dc 15}):\n\nAt will: {@spell Ray of Frost|XPHB} (3d8), {@spell Cure Wounds|XPHB}, {@spell Guidance|XPHB}\n\n1/day each: {@spell Control Water|XPHB}, {@spell Sleet Storm|XPHB}, {@spell Cone of Cold|XPHB}'] }],
    bonus: [{ name: 'Create Water', entries: ['Casts {@spell Create or Destroy Water|XPHB}.'] }] };

  it('reads at will and each/day lists, the DC, and the spell sources', () => {
    const sc = S.monsterSpellcasting(ECE);
    expect(sc.dc).toBe('15');
    expect(sc.groups.map(g => [g.label, g.spells.map(r => r.name)])).toEqual([
      ['At will', ['Ray of Frost', 'Cure Wounds', 'Guidance']],
      ['1/day each', ['Control Water', 'Sleet Storm', 'Cone of Cold']]]);
    expect(sc.groups[0].spells[0].source).toBe('XPHB');
    const rows = S.monsterSpellRows(ECE, { '0:daily:1e|sleet storm': 1 }, () => null);
    expect(rows.find(r => r.s.name === 'Sleet Storm').how.castable).toBe(false);
    expect(rows.find(r => r.s.name === 'Cone of Cold').how.castable).toBe(true);
  });

  it('reads what the monster editor writes back (slots, cantrips, plain names)', () => {
    const SAVED = { trait: [{ name: 'Spellcasting', entries: [
      'The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks).\n'
      + 'Cantrips (at will): fire bolt, light\n1st-level (4 slots): magic missile, shield\n3rd-level (2 slots): fireball\n2/day: misty step'] }] };
    const sc = S.monsterSpellcasting(SAVED);
    expect(sc).toMatchObject({ dc: '14', hit: '+6', casterLevel: 9 });
    expect(sc.groups.map(g => [g.kind, g.label, g.max, g.spells.map(r => r.name)])).toEqual([
      ['daily', '2/day', 2, ['misty step']],
      ['cantrip', 'Cantrips', null, ['fire bolt', 'light']],
      ['slot', 'Level 1', 4, ['magic missile', 'shield']],
      ['slot', 'Level 3', 2, ['fireball']]]);
  });

  it('ignores monsters with no spellcasting entry, and prefers the structured list', () => {
    expect(S.monsterSpellcasting({ action: [{ name: 'Bite', entries: ['At will: chomp'] }] }).groups).toEqual([]);
    const both = { spellcasting: [{ will: ['{@spell light}'] }], action: ECE.action };
    expect(S.monsterSpellcasting(both).groups.map(g => g.label)).toEqual(['At will']);
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
