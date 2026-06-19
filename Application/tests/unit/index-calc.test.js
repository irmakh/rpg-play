/**
 * Unit tests for D&D 5e calculation formulas in index-calc.js.
 *
 * index-calc.js is a browser global script that reads/writes a live DOM and
 * references SKILL_AB from dnd-data.js plus items/fmt/getMod globals.
 * We load the three scripts into a vm context with a DOM "backing store":
 * a plain JS object whose keys are data-key attribute names, so reads and
 * writes go through property accessors instead of a real DOM.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DND_SRC   = readFileSync(resolve(__dirname, '../../public/js/lib/dnd-data.js'),    'utf-8');
const UTILS_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-utils.js'),'utf-8');
const CALC_SRC  = readFileSync(resolve(__dirname, '../../public/js/index/index-calc.js'), 'utf-8');

/**
 * Builds a minimal DOM backed by plain JS objects.
 *
 * textVals    — initial { 'data-key': stringValue } for <input> elements
 * checkedVals — initial { 'data-key': bool } for <input type=checkbox> elements
 *
 * Returns { document, text, checked } where text/checked are live objects
 * you can read back after calling recalcAll().
 */
function makeDOM(textVals = {}, checkedVals = {}) {
  const text    = { ...textVals };
  const checked = { ...checkedVals };
  const cache   = {};
  const byId    = {};

  const ACTIVE_SENTINEL = { value: '__active__', style: {} };

  function inputEl(key) {
    if (!cache[key]) {
      cache[key] = {
        get value() { return text[key] !== undefined ? String(text[key]) : ''; },
        set value(v) { text[key] = v === undefined ? '' : String(v); },
        style: {},
      };
    }
    return cache[key];
  }

  function checkEl(key) {
    if (!cache[key]) {
      cache[key] = {
        get checked() { return !!checked[key]; },
        set checked(v) { checked[key] = !!v; },
        style: {},
      };
    }
    return cache[key];
  }

  const idEl = (id) => {
    if (!byId[id]) {
      byId[id] = {
        value: '', textContent: '', style: { color: '' },
        classList: { add() {}, remove() {}, toggle() {} },
      };
    }
    return byId[id];
  };

  const document = {
    querySelector(sel) {
      const m = sel.match(/\[data-key="([^"]+)"\]/);
      if (!m) return null;
      const key = m[1];
      const isCheck = key.includes('-prof-') || key.includes('-exp-');
      return isCheck ? checkEl(key) : inputEl(key);
    },
    querySelectorAll(sel) {
      if (sel.includes('#spell-tbl')) return { forEach: () => {} };
      return { forEach: () => {}, map: () => [] };
    },
    getElementById(id) { return idEl(id); },
    get activeElement() { return ACTIVE_SENTINEL; },
  };

  return { document, text, checked, byId };
}

/**
 * Loads dnd-data + index-utils + index-calc into a fresh vm context.
 * Returns the two calc functions plus live text/checked stores.
 */
function load(textVals = {}, checkedVals = {}, itemsArr = []) {
  const { document, text, checked, byId } = makeDOM(textVals, checkedVals);
  const ctx = createContext({
    document,
    items: itemsArr,
    clearTimeout: () => {},
    setTimeout: () => 0,
    console,
  });
  runInContext(DND_SRC,   ctx);
  runInContext(UTILS_SRC, ctx);
  runInContext(CALC_SRC,  ctx);
  return { recalcProfBonus: ctx.recalcProfBonus, recalcAll: ctx.recalcAll, text, checked, byId };
}

// ── recalcProfBonus ───────────────────────────────────────────────────────────
// Formula: Math.floor((level - 1) / 4) + 2
describe('recalcProfBonus', () => {
  function prof(level) {
    const { recalcProfBonus, text } = load({ level: String(level) });
    recalcProfBonus();
    return parseInt(text['profbonus']);
  }

  it('level 1  → proficiency 2', () => expect(prof(1)).toBe(2));
  it('level 4  → proficiency 2', () => expect(prof(4)).toBe(2));
  it('level 5  → proficiency 3', () => expect(prof(5)).toBe(3));
  it('level 8  → proficiency 3', () => expect(prof(8)).toBe(3));
  it('level 9  → proficiency 4', () => expect(prof(9)).toBe(4));
  it('level 13 → proficiency 5', () => expect(prof(13)).toBe(5));
  it('level 17 → proficiency 6', () => expect(prof(17)).toBe(6));
  it('level 20 → proficiency 6', () => expect(prof(20)).toBe(6));

  it('does nothing when level is 0 (blank field)', () => {
    const { recalcProfBonus, text } = load({ level: '0', profbonus: '3' });
    recalcProfBonus();
    expect(text['profbonus']).toBe('3');  // unchanged
  });
});

// ── recalcAll — saving throws ─────────────────────────────────────────────────
describe('recalcAll — saving throws', () => {
  function runSaves(textIn, checkedIn) {
    const defaults = { 'speed-base': '30', 'sp-ability': '' };
    const { recalcAll, text } = load({ ...defaults, ...textIn }, checkedIn || {});
    recalcAll();
    return text;
  }

  it('non-proficient save = ability modifier only', () => {
    // STR 18 → mod +4; no proficiency
    const text = runSaves({ profbonus: '2', str: '18' }, { 'save-prof-str': false });
    expect(text['save-str']).toBe('+4');
  });

  it('proficient save = ability modifier + proficiency bonus', () => {
    const text = runSaves({ profbonus: '3', str: '18' }, { 'save-prof-str': true });
    expect(text['save-str']).toBe('+7');  // +4 + 3
  });

  it('saves with negative mod (low ability score)', () => {
    // CON 8 → mod -1; proficient prof 2 → -1+2 = +1
    const text = runSaves({ profbonus: '2', con: '8' }, { 'save-prof-con': true });
    expect(text['save-con']).toBe('+1');
  });

  it('DEX save: non-proficient with DEX 14 (mod +2)', () => {
    const text = runSaves({ profbonus: '4', dex: '14' }, { 'save-prof-dex': false });
    expect(text['save-dex']).toBe('+2');
  });

  it('DEX save: proficient with DEX 14 and prof 4', () => {
    const text = runSaves({ profbonus: '4', dex: '14' }, { 'save-prof-dex': true });
    expect(text['save-dex']).toBe('+6');  // +2 + 4
  });
});

// ── recalcAll — skills ────────────────────────────────────────────────────────
describe('recalcAll — skills', () => {
  // Skill 0 is Acrobatics (DEX), skill 3 is Athletics (STR)
  function runSkills(textIn, checkedIn) {
    const defaults = { 'speed-base': '30', 'sp-ability': '' };
    const { recalcAll, text } = load({ ...defaults, ...textIn }, checkedIn || {});
    recalcAll();
    return text;
  }

  it('Acrobatics (sk-0, DEX) — not proficient: just DEX mod', () => {
    const text = runSkills({ profbonus: '2', dex: '16' }, {});
    expect(text['sk-0']).toBe('+3');  // DEX mod +3
  });

  it('Acrobatics (sk-0, DEX) — proficient: DEX mod + prof', () => {
    const text = runSkills({ profbonus: '3', dex: '16' }, { 'sk-prof-0': true });
    expect(text['sk-0']).toBe('+6');  // +3 + 3
  });

  it('Acrobatics (sk-0, DEX) — expertise: DEX mod + prof*2', () => {
    const text = runSkills({ profbonus: '3', dex: '16' }, { 'sk-prof-0': true, 'sk-exp-0': true });
    expect(text['sk-0']).toBe('+9');  // +3 + 6
  });

  it('Athletics (sk-3, STR) — proficient', () => {
    const text = runSkills({ profbonus: '2', str: '20' }, { 'sk-prof-3': true });
    expect(text['sk-3']).toBe('+7');  // STR mod +5 + 2
  });

  it('Perception (sk-11, WIS) — drives passive perception', () => {
    // WIS 14 → mod +2; proficient prof 2 → PP = 10 + 2 + 2 = 14
    const text = runSkills(
      { profbonus: '2', wis: '14' },
      { 'sk-prof-11': true }
    );
    expect(text['sk-11']).toBe('+4');  // +2 + 2
    expect(text['pp']).toBe('14');     // 10 + 2 + 2
  });

  it('passive perception without Perception prof = 10 + WIS mod', () => {
    const text = runSkills({ profbonus: '3', wis: '10' }, {});
    expect(text['pp']).toBe('10');  // 10 + 0
  });
});

// ── recalcAll — equipped-item save/skill/check bonuses ────────────────────────
describe('recalcAll — item bonuses to saves / skills / checks', () => {
  function run(textIn, checkedIn, itemsArr) {
    const defaults = { 'speed-base': '30', 'sp-ability': '' };
    const { recalcAll, text, byId } = load({ ...defaults, ...textIn }, checkedIn || {}, itemsArr || []);
    recalcAll();
    return { text, byId };
  }

  it('equipped item adds to a specific save', () => {
    // DEX 14 (+2), proficient (prof 2) → +4, plus +2 cloak = +6
    const cloak = { equipped: true, bonuses: [{ target: 'save-dex', value: 2 }] };
    const { text } = run({ profbonus: '2', dex: '14' }, { 'save-prof-dex': true }, [cloak]);
    expect(text['save-dex']).toBe('+6');
  });

  it('"All Saves" bonus applies to every save', () => {
    const ring = { equipped: true, bonuses: [{ target: 'save-all', value: 1 }] };
    const { text } = run({ profbonus: '2', str: '10', cha: '10' }, {}, [ring]);
    expect(text['save-str']).toBe('+1');  // 0 + 1
    expect(text['save-cha']).toBe('+1');
  });

  it('equipped item adds to a specific skill', () => {
    // sk-0 Acrobatics (DEX 16 → +3), +2 item = +5
    const boots = { equipped: true, bonuses: [{ target: 'skill-0', value: 2 }] };
    const { text } = run({ profbonus: '2', dex: '16' }, {}, [boots]);
    expect(text['sk-0']).toBe('+5');
  });

  it('"All Skills" bonus applies to every skill and passive perception', () => {
    // WIS 10 (+0); skill-all +1; Perception sk-11 → +1, PP = 10 + 0 + 1 = 11
    const item = { equipped: true, bonuses: [{ target: 'skill-all', value: 1 }] };
    const { text } = run({ profbonus: '2', wis: '10', dex: '10' }, {}, [item]);
    expect(text['sk-0']).toBe('+1');
    expect(text['sk-11']).toBe('+1');
    expect(text['pp']).toBe('11');
  });

  it('ability-check bonus is baked into the ability mod circle', () => {
    // WIS 14 (+2) + check-wis +1 → circle shows +3
    const item = { equipped: true, bonuses: [{ target: 'check-wis', value: 1 }] };
    const { byId } = run({ profbonus: '2', wis: '14' }, {}, [item]);
    expect(byId['mod-wis'].value).toBe('+3');
  });

  it('check bonus does NOT leak into saves or skills', () => {
    // check-wis +5 must not change WIS save or Perception skill
    const item = { equipped: true, bonuses: [{ target: 'check-wis', value: 5 }] };
    const { text } = run({ profbonus: '2', wis: '14' }, { 'save-prof-wis': true }, [item]);
    expect(text['save-wis']).toBe('+4');  // +2 + 2, no check bonus
    expect(text['sk-11']).toBe('+2');     // +2, no check bonus
  });

  it('unequipped item bonuses are ignored', () => {
    const item = { equipped: false, bonuses: [{ target: 'save-str', value: 5 }] };
    const { text } = run({ profbonus: '2', str: '10' }, {}, [item]);
    expect(text['save-str']).toBe('+0');
  });

  it('bonuses from multiple equipped items stack', () => {
    const a = { equipped: true, bonuses: [{ target: 'save-str', value: 1 }] };
    const b = { equipped: true, bonuses: [{ target: 'save-all', value: 2 }] };
    const { text } = run({ profbonus: '2', str: '10' }, {}, [a, b]);
    expect(text['save-str']).toBe('+3');  // 0 + 1 + 2
  });
});

// ── recalcAll — AC ────────────────────────────────────────────────────────────
describe('recalcAll — AC', () => {
  function runAC(textIn, itemsArr = []) {
    const defaults = { 'speed-base': '30', 'sp-ability': '' };
    const { recalcAll, text } = load({ ...defaults, ...textIn }, {}, itemsArr);
    recalcAll();
    return parseInt(text['ac']);
  }

  it('no armor: AC = 10 + DEX mod', () => {
    expect(runAC({ dex: '14' })).toBe(12);  // 10 + 2
  });

  it('no armor with negative DEX: AC = 10 + DEX mod', () => {
    expect(runAC({ dex: '8' })).toBe(9);   // 10 - 1
  });

  it('light armor: AC = acBase + DEX mod (full)', () => {
    const armor = { equipped: true, itemType: 'armor', armorType: 'light', acBase: 11, acBonus: 0 };
    expect(runAC({ dex: '16' }, [armor])).toBe(14);  // 11 + 3
  });

  it('medium armor: AC = acBase + min(2, DEX mod)', () => {
    const armor = { equipped: true, itemType: 'armor', armorType: 'medium', acBase: 14, acBonus: 0 };
    // DEX 20 → mod +5, capped to +2 → 14+2 = 16
    expect(runAC({ dex: '20' }, [armor])).toBe(16);
  });

  it('medium armor: cap applies at DEX mod > 2', () => {
    const armor = { equipped: true, itemType: 'armor', armorType: 'medium', acBase: 13, acBonus: 0 };
    // DEX 14 → mod +2 (at cap) → 13+2 = 15
    expect(runAC({ dex: '14' }, [armor])).toBe(15);
  });

  it('medium armor with low DEX uses actual DEX mod (below cap)', () => {
    const armor = { equipped: true, itemType: 'armor', armorType: 'medium', acBase: 13, acBonus: 0 };
    // DEX 10 → mod 0 → 13+0 = 13
    expect(runAC({ dex: '10' }, [armor])).toBe(13);
  });

  it('heavy armor: AC = acBase only (ignores DEX)', () => {
    const armor = { equipped: true, itemType: 'armor', armorType: 'heavy', acBase: 18, acBonus: 0 };
    expect(runAC({ dex: '20' }, [armor])).toBe(18);
  });

  it('flat acBonus from equipped items is added', () => {
    const shield = { equipped: true, itemType: 'other', acBonus: 2 };
    expect(runAC({ dex: '10' }, [shield])).toBe(12);  // 10 + 0 + 2
  });

  it('unequipped armor is ignored', () => {
    const armor = { equipped: false, itemType: 'armor', armorType: 'heavy', acBase: 18, acBonus: 0 };
    expect(runAC({ dex: '10' }, [armor])).toBe(10);  // falls through to no-armor path
  });
});

// ── recalcAll — initiative ────────────────────────────────────────────────────
describe('recalcAll — initiative', () => {
  function runInit(textIn, itemsArr = []) {
    const defaults = { 'speed-base': '30', 'sp-ability': '' };
    const { recalcAll, text } = load({ ...defaults, ...textIn }, {}, itemsArr);
    recalcAll();
    return text['init'];
  }

  it('base initiative = DEX mod', () => {
    expect(runInit({ dex: '14' })).toBe('+2');
  });

  it('adds equipped item initBonus', () => {
    const ring = { equipped: true, initBonus: 3 };
    expect(runInit({ dex: '14' }, [ring])).toBe('+5');  // +2 + 3
  });

  it('negative DEX mod gives negative initiative', () => {
    expect(runInit({ dex: '8' })).toBe('-1');
  });
});

// ── recalcAll — speed ─────────────────────────────────────────────────────────
describe('recalcAll — speed', () => {
  function runSpeed(textIn, itemsArr = []) {
    const defaults = { 'sp-ability': '' };
    const { recalcAll, text } = load({ ...defaults, ...textIn }, {}, itemsArr);
    recalcAll();
    return text['speed'];
  }

  it('speed = base speed + 0 (no items)', () => {
    expect(runSpeed({ 'speed-base': '30' })).toBe('30 ft');
  });

  it('speed adds equipped item speedBonus', () => {
    const boots = { equipped: true, speedBonus: 10 };
    expect(runSpeed({ 'speed-base': '30' }, [boots])).toBe('40 ft');
  });

  it('defaults base speed to 30 when field is blank', () => {
    expect(runSpeed({ 'speed-base': '' })).toBe('30 ft');
  });

  it('unequipped item speedBonus is ignored', () => {
    const boots = { equipped: false, speedBonus: 10 };
    expect(runSpeed({ 'speed-base': '30' }, [boots])).toBe('30 ft');
  });
});
