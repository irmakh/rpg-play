// Written by Irmak Hakman — 2026-09-27 12:35

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
describe('console character stats (console/secondary.js)', () => {
  it('escapes the spell attack bonus inside its onclick', () => {
    const { ctx, els } = browserContext();
    run(ctx, 'lib/esc.js', 'lib/dnd-data.js', 'console/secondary.js');
    // secondary.js keeps these in `let` bindings, which only code run inside the
    // context can reassign (a property set on ctx would be a different variable).
    ctx.__data = { 'sp-atk': JSOUT + TAG, _weapons: JSON.stringify([[TAG, DQ, SQ, JSOUT]]) };
    ctx.__name = TAG;
    runInContext('sessionRole = "dm"; masterPw = "t"; sQrollData = __data; sQrollCharName = __name;', ctx);
    ctx.sRenderCharStats({ id: 't1', linkedId: 'c1', type: 'character' });
    const html = els.get('s-char-stats').innerHTML;
    expect(html.length).toBeGreaterThan(0);
    expectInert(html);
  });
});
