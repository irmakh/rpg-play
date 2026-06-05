/**
 * Unit tests for collectData() and applyData() in index-char.js.
 *
 * Both functions read and write a DOM backed by a plain-object stub.
 * collectData() serialises the DOM → plain object.
 * applyData()   deserialises a plain object → DOM.
 *
 * Tests cover: text fields, checkbox fields, inspiration, weapon rows,
 * items, rollHistory (Date serialisation / deserialisation), claimedLoots.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC  = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');
const CHAR_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-char.js'), 'utf-8');

function extractFunctions(src, ...names) {
  return names.map(name => {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m  = re.exec(src);
    if (!m) throw new Error(`Function "${name}" not found — was it renamed?`);
    let depth = 0, i = m.index;
    while (i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    return src.slice(m.index, i + 1);
  }).join('\n');
}

const FN_SRC = extractFunctions(CHAR_SRC, 'collectData', 'applyData');

// ── DOM stub factory ──────────────────────────────────────────────────────────

/**
 * Build a fake weapon table row.
 * values — [name, atk, dmg, notes]
 * itemId — optional integer item id
 */
function makeWpnRow(values, itemId = null) {
  const inputs = values.map(v => ({ value: v }));
  return {
    dataset: itemId !== null ? { itemId: String(itemId) } : {},
    querySelectorAll(sel) {
      if (sel === 'input[type=text], input[type=number]') return inputs;
      return [];
    },
    remove() {},
  };
}

/**
 * Build a minimal document stub.
 *
 * keyValues  — { key: value } — text string or boolean for checkboxes
 * inspire    — initial inspire state
 * wpnRows    — array of makeWpnRow() objects (existing rows in the table)
 */
/**
 * Build a fake spell table row mirroring the live DOM structure read by
 * collectData (positional text inputs/checkboxes + classed sub-elements).
 */
function makeSpellRow(o = {}) {
  const txts = [
    { value: o.lvl   ?? '0' },
    { value: o.name  ?? '' },
    { value: o.time  ?? '' },
    { value: o.range ?? '' },
    { value: o.notes ?? '' },
  ];
  const chks = [
    { checked: !!o.prepared },
    { checked: !!o.conc },
    { checked: !!o.ritual },
  ];
  const map = {
    '.spell-school':   { value: o.school ?? '' },
    '.spell-v':        { checked: !!o.v },
    '.spell-s':        { checked: !!o.s },
    '.spell-m':        { checked: !!o.m },
    '.spell-mat':      { value: o.mat ?? '' },
    '.spell-action':   { value: o.action ?? '' },
    '.spell-notes':    { value: o.notes ?? '' },
    '.spell-duration': { value: o.duration ?? '' },
  };
  return {
    querySelectorAll(sel) {
      if (sel === 'input[type=text], input[type=number]') return txts;
      if (sel === 'input[type=checkbox]') return chks;
      return [];
    },
    querySelector(sel) { return map[sel] || null; },
    remove() {},
  };
}

function makeDom({ keyValues = {}, inspire = false, wpnRows = [], spellRows = [] } = {}) {
  const keyEls = Object.entries(keyValues).map(([key, val]) => {
    if (typeof val === 'boolean') {
      return { dataset: { key }, type: 'checkbox', checked: val };
    }
    return { dataset: { key }, type: 'text', value: String(val) };
  });

  const inspireClasses = new Set(inspire ? ['on'] : []);
  const inspireEl = {
    classList: {
      contains: c => inspireClasses.has(c),
      add:      c => inspireClasses.add(c),
      remove:   c => inspireClasses.delete(c),
    },
  };

  const wpnAppended = [];
  const wpnTblEl = {
    querySelectorAll(sel) {
      if (sel === 'tr:not(:first-child)') return [...wpnRows];
      return [];
    },
    appendChild(tr) { wpnAppended.push(tr); },
  };

  const spellAppended = [];
  const spellTblEl = {
    querySelectorAll(sel) {
      if (sel === 'tr:not(:first-child)') return [...spellRows];
      return [];
    },
    appendChild(tr) { spellAppended.push(tr); },
  };

  return {
    querySelectorAll(sel) {
      if (sel === '[data-key]')                          return keyEls;
      if (sel === '#wpn-tbl tr:not(:first-child)')       return [...wpnRows];
      if (sel === '#spell-tbl tr:not(:first-child)')     return [...spellRows];
      return [];
    },
    getElementById(id) {
      if (id === 'inspire')    return inspireEl;
      if (id === 'wpn-tbl')   return wpnTblEl;
      if (id === 'spell-tbl') return spellTblEl;
      // generic stub for anything else applyData touches
      return {
        innerHTML: '', textContent: '', style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        querySelectorAll() { return []; },
        appendChild() {},
      };
    },
    createElement(tag) {
      const el = {
        dataset: {},
        _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; },
        querySelectorAll() { return []; },
      };
      return el;
    },
    // inspection
    keyEls,
    inspireClasses,
    wpnAppended,
    spellAppended,
  };
}

/**
 * Load collectData + applyData into a fresh vm context.
 */
function load({
  keyValues    = {},
  inspire      = false,
  wpnRows      = [],
  spellRows    = [],
  rollHistory  = [],
  items        = [],
  itemIdCounter = 0,
  claimedLoots = [],
  actions      = [],
  actionIdCounter = 0,
} = {}) {
  const dom = makeDom({ keyValues, inspire, wpnRows, spellRows });

  const ctx = createContext({
    rollHistory:   [...rollHistory],
    items:         items.map(i => ({ ...i })),
    itemIdCounter,
    claimedLoots:  claimedLoots.map(l => ({ ...l })),
    actions:       actions.map(a => ({ ...a })),
    actionIdCounter,
    document:      dom,
    // side-effect stubs (called by applyData but not under test here)
    renderItems:                 () => {},
    renderRollHistory:           () => {},
    renderWeaponsSummary:        () => {},
    renderEquippedItemsSummary:  () => {},
    renderClaimedLoots:          () => {},
    renderActionsTab:            () => {},
    recalcAll:                   () => {},
    parseInt, Math, JSON, String, Date,
  });

  runInContext(ESC_SRC, ctx);
  runInContext(FN_SRC,  ctx);

  return {
    collectData: ctx.collectData,
    applyData:   ctx.applyData,
    dom,
    get rollHistory()  { return ctx.rollHistory; },
    get items()        { return ctx.items; },
    get itemIdCounter(){ return ctx.itemIdCounter; },
    get claimedLoots() { return ctx.claimedLoots; },
    get actions()      { return ctx.actions; },
    get actionIdCounter(){ return ctx.actionIdCounter; },
  };
}

// ── collectData — data-key fields ─────────────────────────────────────────────
describe('collectData — text fields', () => {
  it('reads a text field value', () => {
    const { collectData } = load({ keyValues: { name: 'Aria', level: '5' } });
    const out = collectData();
    expect(out.name).toBe('Aria');
    expect(out.level).toBe('5');
  });

  it('includes all registered data-key fields', () => {
    const { collectData } = load({ keyValues: { str: '18', dex: '14', con: '16' } });
    const out = collectData();
    expect(Object.keys(out)).toContain('str');
    expect(Object.keys(out)).toContain('dex');
    expect(Object.keys(out)).toContain('con');
  });
});

describe('collectData — checkbox fields', () => {
  it('reads true when checkbox is checked', () => {
    const { collectData } = load({ keyValues: { 'ds0': true, 'save-prof-str': false } });
    const out = collectData();
    expect(out['ds0']).toBe(true);
    expect(out['save-prof-str']).toBe(false);
  });
});

describe('collectData — inspiration', () => {
  it('_inspire is true when inspire has "on" class', () => {
    const { collectData } = load({ inspire: true });
    expect(collectData()._inspire).toBe(true);
  });

  it('_inspire is false when inspire does not have "on" class', () => {
    const { collectData } = load({ inspire: false });
    expect(collectData()._inspire).toBe(false);
  });
});

describe('collectData — weapons', () => {
  it('returns empty array JSON when no weapon rows', () => {
    const { collectData } = load({ wpnRows: [] });
    expect(collectData()._weapons).toBe('[]');
  });

  it('serialises weapon rows to JSON', () => {
    const rows = [makeWpnRow(['Longsword', '+5', '1d8+3', 'magic'])];
    const { collectData } = load({ wpnRows: rows });
    const weapons = JSON.parse(collectData()._weapons);
    expect(weapons).toHaveLength(1);
    expect(weapons[0][0]).toBe('Longsword');
    expect(weapons[0][1]).toBe('+5');
    expect(weapons[0][2]).toBe('1d8+3');
    expect(weapons[0][3]).toBe('magic');
  });

  it('captures itemId as integer when present', () => {
    const rows = [makeWpnRow(['Dagger', '+3', '1d4', ''], 7)];
    const { collectData } = load({ wpnRows: rows });
    const weapons = JSON.parse(collectData()._weapons);
    expect(weapons[0][4]).toBe(7);
  });

  it('captures null itemId when absent', () => {
    const rows = [makeWpnRow(['Dagger', '+3', '1d4', ''])];
    const { collectData } = load({ wpnRows: rows });
    const weapons = JSON.parse(collectData()._weapons);
    expect(weapons[0][4]).toBeNull();
  });

  it('skips rows with fewer than 4 inputs', () => {
    const shortRow = {
      dataset: {},
      querySelectorAll: () => [{ value: 'a' }, { value: 'b' }],
      remove() {},
    };
    const { collectData } = load({ wpnRows: [shortRow] });
    expect(JSON.parse(collectData()._weapons)).toHaveLength(0);
  });
});

describe('collectData — rollHistory', () => {
  it('serialises Date objects to ISO strings', () => {
    const d = new Date(2024, 0, 15, 10, 30, 0);
    const { collectData } = load({ rollHistory: [{ time: d, label: 'Attack', total: 18 }] });
    const hist = JSON.parse(collectData()._rollHistory);
    expect(hist).toHaveLength(1);
    expect(hist[0].label).toBe('Attack');
    expect(hist[0].time).toBe(d.toISOString());
  });

  it('returns empty array JSON when rollHistory is empty', () => {
    const { collectData } = load({ rollHistory: [] });
    expect(collectData()._rollHistory).toBe('[]');
  });
});

describe('collectData — items and loots', () => {
  it('serialises items array to JSON', () => {
    const { collectData } = load({
      items: [{ id: 1, name: 'Shield', itemType: 'armor' }],
    });
    const parsed = JSON.parse(collectData()._items);
    expect(parsed[0].name).toBe('Shield');
  });

  it('captures itemIdCounter', () => {
    const { collectData } = load({ itemIdCounter: 5 });
    expect(collectData()._itemIdCounter).toBe(5);
  });

  it('serialises claimedLoots to JSON', () => {
    const { collectData } = load({
      claimedLoots: [{ id: 'l1', name: 'Potion', description: '' }],
    });
    const parsed = JSON.parse(collectData()._loots);
    expect(parsed[0].id).toBe('l1');
  });
});

// ── applyData — data-key fields ───────────────────────────────────────────────
describe('applyData — text fields', () => {
  it('writes values back to text elements', () => {
    const { applyData, dom } = load({ keyValues: { name: '', level: '' } });
    applyData({ name: 'Aria', level: '5' });
    const nameEl  = dom.keyEls.find(e => e.dataset.key === 'name');
    const levelEl = dom.keyEls.find(e => e.dataset.key === 'level');
    expect(nameEl.value).toBe('Aria');
    expect(levelEl.value).toBe('5');
  });

  it('leaves elements unchanged when key is not in the data object', () => {
    const { applyData, dom } = load({ keyValues: { name: 'Original' } });
    applyData({ level: '3' }); // name not provided
    const nameEl = dom.keyEls.find(e => e.dataset.key === 'name');
    expect(nameEl.value).toBe('Original');
  });
});

describe('applyData — checkboxes', () => {
  it('sets checked to true', () => {
    const { applyData, dom } = load({ keyValues: { 'ds0': false } });
    applyData({ 'ds0': true });
    const el = dom.keyEls.find(e => e.dataset.key === 'ds0');
    expect(el.checked).toBe(true);
  });

  it('sets checked to false', () => {
    const { applyData, dom } = load({ keyValues: { 'ds0': true } });
    applyData({ 'ds0': false });
    const el = dom.keyEls.find(e => e.dataset.key === 'ds0');
    expect(el.checked).toBe(false);
  });
});

describe('applyData — inspiration', () => {
  it('adds "on" class when _inspire is true', () => {
    const { applyData, dom } = load({ inspire: false });
    applyData({ _inspire: true });
    expect(dom.inspireClasses.has('on')).toBe(true);
  });

  it('removes "on" class when _inspire is false', () => {
    const { applyData, dom } = load({ inspire: true });
    applyData({ _inspire: false });
    expect(dom.inspireClasses.has('on')).toBe(false);
  });
});

describe('applyData — weapons', () => {
  it('appends one row per weapon entry', () => {
    const { applyData, dom } = load();
    applyData({ _weapons: JSON.stringify([['Longsword', '+5', '1d8', 'magic']]) });
    expect(dom.wpnAppended).toHaveLength(1);
  });

  it('appends correct number of rows for multiple weapons', () => {
    const { applyData, dom } = load();
    applyData({
      _weapons: JSON.stringify([
        ['Sword', '+3', '1d8', ''],
        ['Dagger', '+3', '1d4', ''],
      ]),
    });
    expect(dom.wpnAppended).toHaveLength(2);
  });

  it('sets dataset.itemId on the tr when itemId is present', () => {
    const { applyData, dom } = load();
    applyData({ _weapons: JSON.stringify([['Sword', '+3', '1d8', '', 7]]) });
    expect(dom.wpnAppended[0].dataset.itemId).toBe(7);
  });

  it('handles malformed _weapons JSON gracefully (no throw)', () => {
    const { applyData } = load();
    expect(() => applyData({ _weapons: 'not json' })).not.toThrow();
  });

  it('does nothing when _weapons is missing', () => {
    const { applyData, dom } = load();
    applyData({});
    expect(dom.wpnAppended).toHaveLength(0);
  });
});

describe('applyData — items', () => {
  it('restores items from _items JSON', () => {
    // Use result object — items getter reads ctx.items after vm reassignment
    const r = load();
    r.applyData({ _items: JSON.stringify([{ id: 1, name: 'Shield', itemType: 'armor' }]) });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe('Shield');
  });

  it('migrates legacy "item" type to "wondrous"', () => {
    const r = load();
    r.applyData({ _items: JSON.stringify([{ id: 1, name: 'Orb', itemType: 'item' }]) });
    expect(r.items[0].itemType).toBe('wondrous');
  });

  it('resets items to empty array when _items is absent', () => {
    const r = load({ items: [{ id: 1, name: 'Old Item', itemType: 'armor' }] });
    r.applyData({});
    expect(r.items).toHaveLength(0);
  });

  it('restores itemIdCounter from _itemIdCounter', () => {
    const r = load({ itemIdCounter: 0 });
    r.applyData({ _items: JSON.stringify([]), _itemIdCounter: 9 });
    expect(r.itemIdCounter).toBe(9);
  });
});

describe('applyData — rollHistory', () => {
  it('restores rollHistory entries with Date objects', () => {
    const iso = new Date(2024, 0, 15, 10, 30, 0).toISOString();
    const { applyData, rollHistory } = load();
    applyData({ _rollHistory: JSON.stringify([{ time: iso, label: 'Attack', total: 18 }]) });
    expect(rollHistory).toHaveLength(1);
    expect(rollHistory[0].time).toBeInstanceOf(Date);
    expect(rollHistory[0].label).toBe('Attack');
  });

  it('clears existing rollHistory before applying', () => {
    const { applyData, rollHistory } = load({
      rollHistory: [{ time: new Date(), label: 'Old', total: 5 }],
    });
    applyData({ _rollHistory: '[]' });
    expect(rollHistory).toHaveLength(0);
  });

  it('handles malformed _rollHistory JSON gracefully', () => {
    const { applyData } = load();
    expect(() => applyData({ _rollHistory: '{bad json' })).not.toThrow();
  });
});

describe('applyData — null / missing input', () => {
  it('returns immediately without throwing when called with null', () => {
    const { applyData } = load();
    expect(() => applyData(null)).not.toThrow();
  });

  it('returns immediately without throwing when called with undefined', () => {
    const { applyData } = load();
    expect(() => applyData(undefined)).not.toThrow();
  });
});

// ── collectData — custom actions ──────────────────────────────────────────────
describe('collectData — custom actions', () => {
  it('serialises the actions array to _actions JSON', () => {
    const { collectData } = load({
      actions: [{ id: 1, name: 'Second Wind', category: 'bonus', uses: 3, used: 1, recharge: 'short', dice: '1d10+8', description: 'heal' }],
    });
    const parsed = JSON.parse(collectData()._actions);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Second Wind');
    expect(parsed[0].category).toBe('bonus');
    expect(parsed[0].used).toBe(1);
  });

  it('captures actionIdCounter', () => {
    const { collectData } = load({ actionIdCounter: 7 });
    expect(collectData()._actionIdCounter).toBe(7);
  });

  it('serialises an empty actions array', () => {
    const { collectData } = load({ actions: [] });
    expect(collectData()._actions).toBe('[]');
  });
});

// ── collectData — spell action category ([13]) ────────────────────────────────
describe('collectData — spell action category', () => {
  it('captures the .spell-action value at index 13', () => {
    const { collectData } = load({
      spellRows: [makeSpellRow({ lvl: '1', name: 'Entangle', action: 'action' })],
    });
    const rows = JSON.parse(collectData()._spells);
    expect(rows[0][1]).toBe('Entangle');
    expect(rows[0][13]).toBe('action');
  });

  it('defaults to empty string when no action category is set', () => {
    const { collectData } = load({
      spellRows: [makeSpellRow({ lvl: '0', name: 'Fire Bolt' })],
    });
    const rows = JSON.parse(collectData()._spells);
    expect(rows[0][13]).toBe('');
  });
});

// ── collectData — spell duration ([14]) ───────────────────────────────────────
describe('collectData — spell duration', () => {
  it('captures the .spell-duration value at index 14', () => {
    const { collectData } = load({
      spellRows: [makeSpellRow({ lvl: '1', name: 'Entangle', duration: 'Concentration, up to 1 minute' })],
    });
    const rows = JSON.parse(collectData()._spells);
    expect(rows[0][14]).toBe('Concentration, up to 1 minute');
  });

  it('reads notes by class independently of duration', () => {
    const { collectData } = load({
      spellRows: [makeSpellRow({ name: 'Bless', notes: '2d6 radiant', duration: 'Instantaneous' })],
    });
    const rows = JSON.parse(collectData()._spells);
    expect(rows[0][6]).toBe('2d6 radiant');   // notes
    expect(rows[0][14]).toBe('Instantaneous'); // duration
  });

  it('defaults to empty string when duration is absent', () => {
    const { collectData } = load({ spellRows: [makeSpellRow({ name: 'Fire Bolt' })] });
    const rows = JSON.parse(collectData()._spells);
    expect(rows[0][14]).toBe('');
  });
});

// ── applyData — custom actions ────────────────────────────────────────────────
describe('applyData — custom actions', () => {
  it('restores actions from _actions JSON', () => {
    const r = load();
    r.applyData({ _actions: JSON.stringify([{ id: 2, name: 'Action Surge', category: 'other', uses: 1, used: 0, recharge: 'short' }]) });
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].name).toBe('Action Surge');
  });

  it('resets actions to empty array when _actions is absent', () => {
    const r = load({ actions: [{ id: 1, name: 'Old', category: 'action' }] });
    r.applyData({});
    expect(r.actions).toHaveLength(0);
  });

  it('restores actionIdCounter from _actionIdCounter', () => {
    const r = load({ actionIdCounter: 0 });
    r.applyData({ _actions: '[]', _actionIdCounter: 12 });
    expect(r.actionIdCounter).toBe(12);
  });

  it('derives actionIdCounter from max id when counter is absent', () => {
    const r = load({ actionIdCounter: 0 });
    r.applyData({ _actions: JSON.stringify([{ id: 3, name: 'A' }, { id: 8, name: 'B' }]) });
    expect(r.actionIdCounter).toBe(8);
  });

  it('handles malformed _actions JSON gracefully (no throw)', () => {
    const r = load();
    expect(() => r.applyData({ _actions: 'not json' })).not.toThrow();
    expect(r.actions).toHaveLength(0);
  });
});

// ── applyData — spell action category renders into the row ────────────────────
describe('applyData — spell action category', () => {
  it('marks the matching action option as selected in the appended row', () => {
    const { applyData, dom } = load();
    applyData({ _spells: JSON.stringify([['1', 'Entangle', 'Action', '90 ft', false, false, '', true, 'Conj', false, false, false, '', 'action']]) });
    expect(dom.spellAppended).toHaveLength(1);
    expect(dom.spellAppended[0].innerHTML).toContain('value="action" selected');
  });

  it('defaults to the "not an action" option when [13] is absent', () => {
    const { applyData, dom } = load();
    applyData({ _spells: JSON.stringify([['0', 'Fire Bolt', 'Action', '120 ft', false, false, '', false, 'Evoc']]) });
    expect(dom.spellAppended[0].innerHTML).toContain('value="" selected');
  });

  it('renders the duration value ([14]) into the appended row', () => {
    const { applyData, dom } = load();
    applyData({ _spells: JSON.stringify([['1', 'Entangle', 'Action', '90 ft', true, false, '', true, 'Conj', false, false, false, '', 'action', '1 minute']]) });
    expect(dom.spellAppended[0].innerHTML).toContain('class="spell-duration"');
    expect(dom.spellAppended[0].innerHTML).toContain('value="1 minute"');
  });
});
