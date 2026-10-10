// Written by Irmak Hakman — 2026-10-10 21:42
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Phase 4 of the security plan: text a user controls must never turn into
 * markup on someone else's screen.
 *
 * A player writes their own sheet (weapon names, spell levels, item ids, the
 * spell-attack bonus…) and the DM's table, console and sheet views render it; a
 * monster stat block can come from any imported JSON. Each test below feeds a
 * renderer hostile values and checks the output carries them only as text.
 *
 * The page scripts are loaded WHOLE into a vm context — the real esc/escJs,
 * parseEntry and helpers, not stubs — with a small fake DOM for what their top
 * level touches. If a renderer stops escaping, the raw payload appears in the
 * output and the test fails.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = rel => readFileSync(resolve(__dirname, '../../public/js', rel), 'utf-8');

// Tag injection, attribute break-out (either quote), and a JS-string break-out.
const TAG   = '<img src=x onerror=alert(1)>';
const DQ    = 'x" onmouseover="alert(1)';
const SQ    = "x' onmouseover='alert(1)";
const JSOUT = "x');alert(1);('";

/**
 * No payload survives as markup: no raw tag, no attribute break-out, and inside
 * every inline handler no quote that ends its JS string (escJs leaves \' there).
 * The same characters in ordinary text are harmless and allowed.
 */
function expectInert(html) {
  expect(html).not.toContain('<img src=x');
  expect(html).not.toMatch(/"\s*onmouseover=/);
  expect(html).not.toMatch(/(^|[^\\])'\s*onmouseover=/);
  for (const [, code] of html.matchAll(/\son[a-z]+="([^"]*)"/g)) {
    expect(code).not.toMatch(/(^|[^\\])'\);alert\(1\)/);
  }
}

// ── A fake DOM just big enough for the page scripts' top level ───────────────
function fakeEl() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), focus() {}, children: [],
  };
}
function browserContext(extra = {}) {
  const els = new Map();
  const document = {
    body: { dataset: {}, classList: fakeEl().classList, appendChild() {} },
    getElementById: id => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); },
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl(), addEventListener() {}, documentElement: fakeEl(),
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = createContext({
    document, window: {}, sessionStorage: storage, localStorage: storage,
    location: { pathname: '/', search: '', href: '' }, navigator: {},
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, console, JSON, Math, Date, Number, String, parseInt, parseFloat, isNaN,
    ...extra,
  });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  return { ctx, els };
}
const run = (ctx, ...files) => files.forEach(f => runInContext(src(f), ctx, { filename: f }));

// ── esc ───────────────────────────────────────────────────────────────────────
describe('esc (lib/esc.js)', () => {
  const { ctx } = browserContext();
  run(ctx, 'lib/esc.js');

  it('escapes single quotes as well, so either attribute quote is safe', () => {
    expect(ctx.esc(SQ)).not.toContain("'");
  });

  it('shows 0 as "0" (it used to vanish)', () => {
    expect(ctx.esc(0)).toBe('0');
  });

  it('still gives an empty string for null, undefined and false', () => {
    expect([ctx.esc(null), ctx.esc(undefined), ctx.esc(false)]).toEqual(['', '', '']);
  });
});

// ── Monster stat blocks (imports, shown on the table, console and monsters page)
const hostileMonster = () => ({
  name: TAG, str: TAG, dex: 14, initBonus: TAG, cr: '1',
  save: { str: DQ }, skill: { [TAG]: JSOUT, perception: DQ },
  action: [{ name: DQ + JSOUT, entries: ['{@atk mw} {@hit 4} to hit. {@h}7 ({@damage 1d8}) slashing damage.'] }],
  trait: [{ name: TAG, entries: [TAG] }],
  spellcasting: [{ name: 'Spellcasting', daily: { [TAG + 'e']: ['fireball'] } }],
});

describe('renderMonsterStatBlock (monster-stat-block.js)', () => {
  const { ctx } = browserContext();
  run(ctx, 'lib/esc.js', 'monster-stat-block.js');

  it('keeps every monster field as text', () => {
    expectInert(ctx.renderMonsterStatBlock(hostileMonster()));
  });
});

describe('renderMonsterFullStats (table-monsters.js)', () => {
  function load(theme) {
    const { ctx } = browserContext();
    run(ctx, 'lib/esc.js', 'monster-stat-block.js', 'table/table-utils.js', 'table/table-monsters.js');
    ctx.document.body.dataset.theme = theme;
    ctx._sideOpenSections = new Set();
    ctx._sideSecArrow = () => '';
    ctx._sideSecStyle = () => '';
    return ctx;
  }
  const tok = { id: 't1', linkedId: 'm1', hpCurrent: 5, hpMax: 10, label: TAG };

  it('keeps the modern HUD free of markup from the stat block', () => {
    expectInert(load('modern').renderMonsterFullStats(hostileMonster(), tok));
  });

  it('keeps the classic panel free of markup from the stat block', () => {
    expectInert(load('classic').renderMonsterFullStats(hostileMonster(), tok));
  });

  it('treats a text initiative bonus as 0', () => {
    const html = load('classic').renderMonsterFullStats({ ...hostileMonster(), dex: 10 }, tok);
    expect(html).toContain('Init +0');
  });
});

// ── The table's character panel: items and custom actions from a player's sheet
describe('table side panel (table-panel.js)', () => {
  const { ctx } = browserContext();
  run(ctx, 'lib/esc.js', 'table/table-panel.js');

  it('passes an item id to its onclick as a quoted value, never as code', () => {
    const d = { _items: JSON.stringify([{ id: '1);alert(1);(' + DQ, name: TAG, equipped: false }]) };
    const html = ctx._buildSidePanelItems(d, true);
    expectInert(html);
    expect(html).not.toContain('clickEquipItem(1);alert(1)');
  });

  it('keeps a numeric item id numeric', () => {
    const html = ctx._buildSidePanelItems({ _items: JSON.stringify([{ id: 7, name: 'Rope' }]) }, true);
    expect(html).toContain('clickEquipItem(7)');
  });

  it('passes a custom action id to its onclick as a quoted value', () => {
    const html = ctx._renderSidePanelCustom({ id: '2);alert(1);(', name: TAG, uses: 2, used: 0, description: TAG }, true);
    expectInert(html);
    expect(html).not.toContain('clickActionBox(2);alert(1)');
  });
});

// ── The character sheet's Actions tab (the DM opens players' sheets too) ─────
describe('custom actions on the sheet (index-actions.js)', () => {
  const { ctx } = browserContext();
  run(ctx, 'lib/esc.js', 'index/index-actions.js');

  it('passes the action id to its handlers as a quoted value', () => {
    const html = ctx._actRenderCustom({ id: '3);alert(1);(', name: TAG, uses: 1, used: 0, dice: DQ, description: TAG });
    expectInert(html);
    expect(html).not.toContain('openActionModal(3);alert(1)');
  });
});

// ── The sheet's inventory ─────────────────────────────────────────────────────
describe('inventory list (index-items.js)', () => {
  it('keeps item fields and ids out of the markup', () => {
    const { ctx, els } = browserContext();
    run(ctx, 'lib/esc.js', 'index/index-items.js');
    ctx.items = [{
      id: '4);alert(1);(', name: TAG, itemType: 'armor', armorType: TAG, acBase: TAG,
      acBonus: DQ, value: TAG, notes: TAG, equipped: true, bonuses: [{ target: 'str', value: TAG }],
    }];
    ctx.itemBonusTargetLabel = () => 'STR';
    ctx.renderItems();
    const html = els.get('items-body').innerHTML;
    expect(html.length).toBeGreaterThan(0);
    expectInert(html);
    expect(html).not.toContain('deleteItem(4);alert(1)');
  });
});

// ── Console: a player's own spell-attack bonus, rendered on the DM's console ─
describe('console info panel (console/panel-*.js)', () => {
  // The panel keeps its state in `let` bindings, which only code run inside the
  // context can reassign (a property set on ctx would be a different variable).
  function panel() {
    const { ctx, els } = browserContext();
    run(ctx, 'lib/esc.js', 'lib/dnd-data.js', 'console/panel-core.js', 'console/panel-nav.js',
      'console/panel-turn.js', 'console/panel-token.js', 'console/panel-sheet.js', 'console/panel-table.js', 'console/panel-handouts.js');
    runInContext('sessionRole = "dm"; masterPw = "t";', ctx);
    return { ctx, els };
  }

  it('escapes every part of a character sheet: skills, combat, spells, items', () => {
    const { ctx, els } = panel();
    // A spell row is positional: 0 level, 1 name, 4 concentration, 5 ritual,
    // 7 prepared, 13 the action kind it is filed under.
    const spell = (lvl, name, kind) => { const s = []; s[0] = lvl; s[1] = name; s[4] = true; s[7] = true; s[13] = kind; return s; };
    ctx.__data = {
      str: '16', dex: TAG, 'sp-atk': JSOUT + TAG, 'sp-dc': TAG, pb: DQ, pp: SQ,
      'sk-0': JSOUT, 'save-str': SQ, init: TAG,
      'slot-1-total': '3', 'slot-1-used': '1',
      _weapons: JSON.stringify([[TAG, DQ, SQ, JSOUT], [JSOUT, JSOUT, JSOUT]]),
      _spells: JSON.stringify([spell(TAG, TAG + JSOUT, 'action'), spell('0', SQ, 'bonus'), spell(DQ, DQ, '')]),
      _actions: JSON.stringify([{ id: JSOUT, name: TAG, category: 'action', description: TAG + DQ, dice: JSOUT, uses: 3, used: 1, recharge: 'short' },
                                { id: 7, name: SQ, category: 'other', dice: TAG }]),
      _items: JSON.stringify([{ id: JSOUT, name: TAG + SQ, equipped: true, itemType: 'armor', acBase: TAG }, { id: 3, name: DQ, acBonus: 1 }]),
    };
    runInContext('sQrollData = __data; sSelectedToken = { id: "t1", linkedId: "c1", type: "character" };', ctx);
    for (const part of ['skills', 'combat', 'spells', 'items']) {
      ctx.sRenderSheetPane(part);
      const html = els.get('s-pane-' + part).innerHTML;
      expect([part, html.length > 0]).toEqual([part, true]);
      expectInert(html);
    }
    expect(els.get('s-pane-combat').innerHTML).toContain('2 of 3 left');
    expect(els.get('s-pane-spells').innerHTML).toContain('2 of 3 left');
    expect(els.get('s-pane-items').innerHTML).toContain('Worn');
  });

  it('escapes an imported monster in its rolls and its stat block', () => {
    const { ctx, els } = panel();
    ctx.__mon = {
      name: TAG, source: TAG, dex: 14,
      skill: { [JSOUT]: JSOUT, stealth: SQ },
      save: { dex: JSOUT },
      senses: [TAG], languages: [DQ],
      action: [{ name: TAG + JSOUT, entries: ['{@hit 5} ' + TAG + ' {@damage 1d6+2}', { type: 'list', items: [TAG] }] }],
      trait: [{ name: SQ, entries: [DQ] }],
    };
    runInContext('sMonsterData = __mon;', ctx);
    const tok = { id: 't1', linkedId: 'm1', type: 'monster', label: TAG, name: TAG };
    ctx.sRenderMonsterRolls(tok);
    const rolls = els.get('s-pane-rolls').innerHTML;
    expect(rolls.length).toBeGreaterThan(0);
    expectInert(rolls);
    const block = ctx.sRenderMonsterStatBlock(ctx.__mon, tok);
    expect(block.length).toBeGreaterThan(0);
    expectInert(block);
  });

  it('escapes a handout for the player who reads it and the DM who judges it', () => {
    const { ctx, els } = panel();
    // DM shape: recipients with a roll; the character's name is a player's text.
    ctx.__chars = [{ id: JSOUT, name: TAG + SQ, char_type: 'pc' }, { id: 'c2', name: DQ, char_type: 'pc' }];
    ctx.__dm = [{ id: JSOUT, title: TAG + DQ, checkSkill: 3, checkSkillName: TAG, checkDc: 12,
      recipients: [{ charId: JSOUT, outcome: 'rolled', rollTotal: 14, rollDetail: TAG + SQ, suggested: 'success' }] }];
    runInContext('sCharList = __chars; sHandouts = __dm; sHoPick = null;', ctx);
    ctx.sRenderHandouts();
    expectInert(els.get('s-handouts').innerHTML);
    ctx.__pick = JSOUT;
    runInContext('sHoPick = __pick;', ctx);
    ctx.sRenderHandouts();
    const detail = els.get('s-handouts').innerHTML;
    expect(detail).toContain('Roll again');
    expectInert(detail);

    // Player shape: every stage, each unfolded.
    ctx.__mine = [
      { id: JSOUT, title: TAG, canRoll: true, promptText: TAG + DQ, outcome: 'pending' },
      { id: 'h2', title: SQ, awaitingDm: true, promptText: TAG, outcome: 'rolled' },
      { id: 'h3', title: DQ, outcome: 'success', text: TAG + SQ, imageUrl: JSOUT, imageMedium: DQ },
    ];
    runInContext('sessionRole = "character"; masterPw = ""; sessionCharId = "c2"; sHandouts = __mine; sHoOpen.add(__pick); sHoOpen.add("h2"); sHoOpen.add("h3");', ctx);
    ctx.sRenderHandouts();
    const mine = els.get('s-handouts').innerHTML;
    expect(mine).toContain('Examine it');
    expectInert(mine);
  });

  it('escapes names and ids in the initiative order and the token list', () => {
    const { ctx, els } = panel();
    ctx.__toks = [{ id: JSOUT, name: TAG, type: 'character', linkedId: 'c1', initiativeId: 'i1', hpCurrent: 3, hpMax: 9, conditions: JSON.stringify([TAG, DQ]) }];
    ctx.__init = { currentId: 'i1', entries: [{ id: 'i1', name: TAG + SQ, roll: 12, charId: 'c1' }, { id: JSOUT, name: DQ, roll: 3, monsterId: 'm' }] };
    runInContext('sTokens = __toks; sInitData = __init;', ctx);
    ctx.sRenderInitiative();
    ctx.sRenderDmHpList();
    for (const id of ['s-you', 's-init-list', 's-dm-hp-list']) {
      const html = els.get(id).innerHTML;
      expect(html.length).toBeGreaterThan(0);
      expectInert(html);
    }
  });
});
