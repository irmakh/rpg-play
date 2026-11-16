// Written by Irmak Hakman — 2026-11-17 12:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The table screen's phone layout (v363): css/table-phone.css and
 * js/table/table-phone.js.
 *
 * The promise is that computers look and work exactly as before. Two halves:
 *   - the stylesheet: every rule sits inside a phone-width media query and
 *     needs body.tbl-phone, except the one that hides the phone-only elements;
 *   - the script: on a wide screen it never adds .tbl-phone and every function
 *     it wraps just calls the original. On a phone it picks the sheet.
 * The script runs here against a small stand-in for the page.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public', p), 'utf-8');
const CSS = read('css/table-phone.css');
const JS = read('js/table/table-phone.js');
const HTML = read('table.html');

// ── The stylesheet ───────────────────────────────────────────────────────────
// Top-level blocks: [{ prelude, body }], comments removed.
function blocks(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
    out.push({ prelude: s.slice(i, open).trim(), body: s.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
const selectorsOf = prelude => prelude.split(',').map(x => x.trim()).filter(Boolean);

describe('table-phone.css cannot reach a computer screen', () => {
  const top = blocks(CSS);

  it('has rules at all (the parser found the file)', () => {
    expect(top.length).toBeGreaterThan(1);
  });

  it('outside a media query, only hides the phone-only elements', () => {
    const plain = top.filter(b => !b.prelude.startsWith('@media'));
    expect(plain.length).toBe(1);
    for (const sel of selectorsOf(plain[0].prelude)) expect(sel).toMatch(/^(#ph-|\.ph-)/);
    expect(plain[0].body.replace(/\s/g, '')).toBe('display:none');
  });

  it('every media query is phone-sized: 760px wide or a short touch screen', () => {
    for (const b of top.filter(x => x.prelude.startsWith('@media'))) {
      const q = b.prelude.replace(/\s/g, '');
      for (const part of q.replace('@media', '').split(',')) {
        expect(part.includes('max-width:760px') || (part.includes('pointer:coarse') && part.includes('max-height:500px'))).toBe(true);
      }
    }
  });

  it('every rule inside them needs body.tbl-phone', () => {
    for (const b of top.filter(x => x.prelude.startsWith('@media'))) {
      for (const rule of blocks(b.body)) {
        for (const sel of selectorsOf(rule.prelude)) expect(sel, sel).toMatch(/^body\.tbl-phone($|[.#\s:])/);
      }
    }
  });

  it('the script and the stylesheet use the same phone query', () => {
    const q = JS.match(/const PHONE_TABLE_QUERY = '([^']+)'/)[1].replace(/\s/g, '');
    const firstMedia = top.find(b => b.prelude.startsWith('@media')).prelude.replace(/\s/g, '').replace('@media', '');
    expect(firstMedia).toBe(q);
  });

  it('table.html loads both files, the stylesheet after the other table styles', () => {
    expect(HTML).toContain('<script src="/js/table/table-phone.js" defer></script>');
    expect(HTML.indexOf('/css/table-phone.css')).toBeGreaterThan(HTML.indexOf('/css/table-ux.css'));
    expect(HTML.indexOf('/css/table-phone.css')).toBeGreaterThan(HTML.indexOf('/css/table-theme-modern.css'));
  });
});

// ── The script, against a stand-in page ──────────────────────────────────────
function fakeEl(id) {
  const cls = new Set();
  const attrs = {};
  return {
    id, hidden: false, innerHTML: '', textContent: '', offsetHeight: 0, scrollTop: 0, dataset: {},
    style: { display: '', props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle(c, on) { if (on === undefined) on = !cls.has(c); on ? cls.add(c) : cls.delete(c); return on; },
      get list() { return [...cls]; },
    },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null,
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 50, left: 0, width: 400, height: 600, bottom: 650 }),
    insertBefore() {}, firstChild: null,
  };
}

function load({ phone, withBar = true }) {
  const els = {};
  for (const id of ['side-panel', 'table-wrap', 'canvas-area', 'ph-peek', 'chat-badge', 'init-badge', 'btn-undo-move', 'lp-bulk-section'])
    els[id] = fakeEl(id);
  if (withBar) els['ph-tabs'] = fakeEl('ph-tabs');
  els['lp-bulk-section'].style.display = 'none';
  const body = fakeEl('body');
  const calls = [];
  const ctx = createContext({
    console,
    document: {
      readyState: 'complete', body,
      getElementById: id => els[id] || null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {},
    },
    matchMedia: () => ({ matches: phone, addEventListener() {} }),
    addEventListener() {},
    Event: class { constructor(t) { this.type = t; } },
    dispatchEvent() {},
  });
  ctx.window = ctx;
  // The desktop functions the script wraps, recording each call.
  runInContext(`
    var tokens = [{ id: 'a', name: 'Goblin', hpCurrent: 4, hpMax: 7, ac: 15, conditions: '[]' }];
    var selectedTokenId = null, chatOpen = true, currentTool = 'move', diceMode = 'ask';
    var initData = { entries: [], currentId: null };
    function esc(s) { return String(s); }
    function rightPanelFold(fold, auto) { __calls.push(['rightPanelFold', fold, !!auto]); }
    function rightPanelOpen() { __calls.push(['rightPanelOpen']); }
    function leftPanelCollapse(c, auto) { __calls.push(['leftPanelCollapse', c, !!auto]); }
    function chatToggle() { chatOpen = !chatOpen; __calls.push(['chatToggle', chatOpen]); }
    function renderTokens() { __calls.push(['renderTokens']); }
    function setTool(n) { currentTool = n; __calls.push(['setTool', n]); }
    function renderInitiativeTracker() { __calls.push(['renderInitiativeTracker']); }
    function isDM() { return true; }
  `, Object.assign(ctx, { __calls: calls }));
  runInContext(JS, ctx);
  const tabClasses = () => body.classList.list.filter(c => c.startsWith('ph-'));
  return { ctx, body, calls, tabClasses };
}

describe('table-phone.js on a computer', () => {
  it('never marks the page as a phone', () => {
    const { body } = load({ phone: false });
    expect(body.classList.contains('tbl-phone')).toBe(false);
  });

  it('every wrapped function calls the original exactly as before', () => {
    const { ctx, calls, tabClasses } = load({ phone: false });
    ctx.rightPanelFold(false, true);
    ctx.rightPanelFold(true);
    ctx.leftPanelCollapse(true);
    ctx.chatToggle();
    ctx.setTool('ruler');
    ctx.rightPanelOpen();
    expect(calls).toEqual([
      ['rightPanelFold', false, true], ['rightPanelFold', true, false], ['leftPanelCollapse', true, false],
      ['chatToggle', false], ['setTool', 'ruler'], ['rightPanelOpen'],
    ]);
    expect(tabClasses()).toEqual([]);
  });

  it('does nothing at all on a page without the tab bar (the console)', () => {
    const { ctx, calls } = load({ phone: true, withBar: false });
    ctx.rightPanelFold(false, true);
    expect(calls).toEqual([['rightPanelFold', false, true]]);
    expect(ctx.document.body.classList.contains('tbl-phone')).toBe(false);
  });
});

describe('table-phone.js on a phone', () => {
  it('marks the page and closes the chat so unread messages count', () => {
    const { ctx, body } = load({ phone: true });
    expect(body.classList.contains('tbl-phone')).toBe(true);
    expect(ctx.chatOpen).toBe(false);
    expect(ctx.phoneTab).toBe('map');
  });

  it('selecting a token opens Details as the peek card', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.selectedTokenId = 'a';
    ctx.rightPanelFold(false, true);          // what openHpPanel does
    expect(ctx.phoneTab).toBe('details');
    expect(tabClasses().sort()).toEqual(['ph-peek', 'ph-tab-details']);
    expect(ctx.document.getElementById('ph-peek').innerHTML).toContain('Goblin');
  });

  it('the card expands to the full panel, and its header goes back to the card', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.selectedTokenId = 'a';
    ctx.rightPanelFold(false, true);
    ctx.phoneDetailsExpand();
    expect(tabClasses()).toEqual(['ph-tab-details']);
    ctx.rightPanelFold(true);                 // the panel header, by hand
    expect(tabClasses().sort()).toEqual(['ph-peek', 'ph-tab-details']);
  });

  it('clearing the selection closes Details', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.selectedTokenId = 'a';
    ctx.rightPanelFold(false, true);
    ctx.selectedTokenId = null;
    ctx.rightPanelFold(true, true);           // what closeHpPanel does
    expect(ctx.phoneTab).toBe('map');
    expect(tabClasses()).toEqual([]);
  });

  it('with nothing selected, the Details tab opens the full panel', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.phoneTabClick('details');
    expect(tabClasses()).toEqual(['ph-tab-details']);
  });

  it("a player's own sheet loads once (it unfolds the panel itself)", () => {
    const { ctx, calls } = load({ phone: true });
    // As in table-panel.js: loading the sheet ends by unfolding the panel.
    runInContext(`
      var loads = 0;
      function isCharSession() { return true; }
      function loadOwnCharacterSheet() { loads++; if (loads < 50) rightPanelFold(false, true); }
    `, ctx);
    ctx.phoneTabClick('details');
    expect(ctx.loads).toBe(1);
    expect(ctx.phoneTab).toBe('details');
  });

  it('only one sheet at a time; the open tab closes it again', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.phoneTabClick('turn');
    expect(tabClasses()).toEqual(['ph-tab-turn']);
    ctx.phoneTabClick('chat');
    expect(tabClasses()).toEqual(['ph-tab-chat']);
    expect(ctx.chatOpen).toBe(true);
    ctx.phoneTabClick('chat');
    expect(tabClasses()).toEqual([]);
    expect(ctx.chatOpen).toBe(false);
  });

  it('the chat header and the initiative header close their sheets', () => {
    const { ctx } = load({ phone: true });
    ctx.phoneTabClick('chat');
    ctx.chatToggle();
    expect(ctx.phoneTab).toBe('map');
    ctx.phoneTabClick('turn');
    ctx.leftPanelCollapse(true);
    expect(ctx.phoneTab).toBe('map');
  });

  it('the initiative panel folding by itself leaves the sheets alone', () => {
    const { ctx, calls } = load({ phone: true });
    ctx.phoneTabClick('turn');
    ctx.leftPanelCollapse(true, true);
    expect(ctx.phoneTab).toBe('turn');
    expect(calls).toContainEqual(['leftPanelCollapse', true, true]);
  });

  it('several tokens selected: Details shows bulk edit, not Turn', () => {
    const { ctx, tabClasses } = load({ phone: true });
    ctx.document.getElementById('lp-bulk-section').style.display = '';
    ctx.phoneSyncBulk();                      // what the bulk panel's observer does
    expect(tabClasses().sort()).toEqual(['ph-bulk', 'ph-tab-details']);
    ctx.leftPanelCollapse(false);             // the initiative column asking to open
    expect(ctx.phoneTab).toBe('details');
    ctx.rightPanelFold(true, true);           // closeHpPanel while selecting several
    expect(ctx.phoneTab).toBe('details');
    ctx.document.getElementById('lp-bulk-section').style.display = 'none';
    ctx.phoneSyncBulk();                      // selection cleared
    expect(tabClasses()).toEqual([]);
  });

  it('turning off phone layout (a wider window) leaves no phone classes behind', () => {
    const { ctx, body, tabClasses } = load({ phone: true });
    ctx.phoneTabClick('more');
    ctx.matchMedia = () => ({ matches: false });
    ctx.phoneApply();
    expect(body.classList.contains('tbl-phone')).toBe(false);
    expect(tabClasses()).toEqual([]);
  });
});
