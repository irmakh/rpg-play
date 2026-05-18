/**
 * Unit tests for roll history management in index-dice.js.
 *
 * pushRoll and renderRollHistory are the only near-pure functions in that file.
 * We extract them with brace-counting and load them in a vm context with:
 *   - rollHistory array (global, mutated by pushRoll)
 *   - esc() from lib/esc.js
 *   - a stub document with a capturable #rh-list element
 *   - clearTimeout / setTimeout stubs (pushRoll sets an auto-save timer)
 *   - saveCharacter stub (never actually called since setTimeout is stubbed)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC  = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'),         'utf-8');
const DICE_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-dice.js'), 'utf-8');

function extractFunctions(src, ...names) {
  return names.map(name => {
    const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(src);
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

const FN_SRC = extractFunctions(DICE_SRC, 'pushRoll', 'renderRollHistory');

/**
 * Builds a fresh vm context with the given initial rollHistory.
 * Returns { pushRoll, renderRollHistory, rollHistory (live ref), listEl }.
 */
function load(initialHistory = []) {
  const rollHistory = [...initialHistory];
  const listEl = { innerHTML: '' };

  const ctx = createContext({
    rollHistory,
    _autoSaveTimer: null,
    document: {
      getElementById(id) {
        if (id === 'rh-list') return listEl;
        return { innerHTML: '', style: {}, textContent: '' };
      },
    },
    clearTimeout: () => {},
    setTimeout: () => 0,
    saveCharacter: () => {},
    String,
  });

  runInContext(ESC_SRC, ctx);   // defines esc
  runInContext(FN_SRC,  ctx);   // defines pushRoll, renderRollHistory

  return {
    pushRoll:          ctx.pushRoll,
    renderRollHistory: ctx.renderRollHistory,
    rollHistory:       ctx.rollHistory,
    listEl,
  };
}

// ── Fixed time helper ─────────────────────────────────────────────────────────
// renderRollHistory calls e.time.getHours() / getMinutes() / getSeconds()
function makeTime(h, m, s) {
  return new Date(2024, 0, 1, h, m, s);
}

function entry(overrides = {}) {
  return {
    time:     makeTime(14, 30, 5),
    label:    'Attack',
    type:     'norm',
    detail:   'd20(15)',
    total:    18,
    isCrit:   false,
    isFail:   false,
    isDamage: false,
    ...overrides,
  };
}

// ── pushRoll — array management ───────────────────────────────────────────────
describe('pushRoll — prepend behaviour', () => {
  it('adds the first entry to an empty history', () => {
    const { pushRoll, rollHistory } = load([]);
    pushRoll(entry({ label: 'First' }));
    expect(rollHistory).toHaveLength(1);
    expect(rollHistory[0].label).toBe('First');
  });

  it('prepends new entries (most recent first)', () => {
    const { pushRoll, rollHistory } = load([]);
    pushRoll(entry({ label: 'First' }));
    pushRoll(entry({ label: 'Second' }));
    expect(rollHistory[0].label).toBe('Second');
    expect(rollHistory[1].label).toBe('First');
  });

  it('caps history at 100 entries', () => {
    const initial = Array.from({ length: 100 }, (_, i) => entry({ label: `Old ${i}` }));
    const { pushRoll, rollHistory } = load(initial);
    pushRoll(entry({ label: 'Overflow' }));
    expect(rollHistory).toHaveLength(100);
    expect(rollHistory[0].label).toBe('Overflow');
  });

  it('does not exceed 100 entries on repeated pushes', () => {
    const { pushRoll, rollHistory } = load([]);
    for (let i = 0; i < 110; i++) pushRoll(entry({ label: `Roll ${i}` }));
    expect(rollHistory).toHaveLength(100);
  });
});

// ── renderRollHistory — empty state ───────────────────────────────────────────
describe('renderRollHistory — empty state', () => {
  it('shows the empty-state message when history is empty', () => {
    const { renderRollHistory, listEl } = load([]);
    renderRollHistory();
    expect(listEl.innerHTML).toContain('No rolls yet');
  });

  it('does nothing when #rh-list element is null', () => {
    // Verify it does not throw when the element is missing
    const ctx = createContext({
      rollHistory: [],
      document: { getElementById: () => null },
      clearTimeout: () => {}, setTimeout: () => 0, saveCharacter: () => {}, String,
    });
    runInContext(ESC_SRC, ctx);
    runInContext(FN_SRC,  ctx);
    expect(() => ctx.renderRollHistory()).not.toThrow();
  });
});

// ── renderRollHistory — entry rendering ───────────────────────────────────────
describe('renderRollHistory — entry content', () => {
  it('renders the label and total', () => {
    const { pushRoll, renderRollHistory, listEl } = load([]);
    pushRoll(entry({ label: 'Stealth Check', total: 22 }));
    // pushRoll already calls renderRollHistory; check the result
    expect(listEl.innerHTML).toContain('Stealth Check');
    expect(listEl.innerHTML).toContain('22');
  });

  it('renders the detail string', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ detail: 'd20(18)' }));
    expect(listEl.innerHTML).toContain('d20(18)');
  });

  it('HTML-escapes the label', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ label: '<script>alert(1)</script>' }));
    expect(listEl.innerHTML).toContain('&lt;script&gt;');
    expect(listEl.innerHTML).not.toContain('<script>alert');
  });

  it('HTML-escapes the detail', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ detail: '1d6+<b>bonus</b>' }));
    expect(listEl.innerHTML).toContain('&lt;b&gt;');
  });

  it('formats the time as HH:MM:SS with zero-padding', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ time: makeTime(9, 5, 3) }));
    expect(listEl.innerHTML).toContain('09:05:03');
  });
});

// ── renderRollHistory — badge and total CSS classes ───────────────────────────
describe('renderRollHistory — badge classes', () => {
  it('normal roll gets "norm" badge and "NRM" label', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ type: 'norm', isDamage: false }));
    expect(listEl.innerHTML).toContain('norm');
    expect(listEl.innerHTML).toContain('NRM');
  });

  it('advantage roll gets "adv" badge and "ADV" label', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ type: 'adv', isDamage: false }));
    expect(listEl.innerHTML).toContain('adv');
    expect(listEl.innerHTML).toContain('ADV');
  });

  it('disadvantage roll gets "dis" badge and "DIS" label', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ type: 'dis', isDamage: false }));
    expect(listEl.innerHTML).toContain('dis');
    expect(listEl.innerHTML).toContain('DIS');
  });

  it('damage roll gets "dmg" badge and "DMG" label', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ isDamage: true }));
    expect(listEl.innerHTML).toContain('dmg');
    expect(listEl.innerHTML).toContain('DMG');
  });
});

describe('renderRollHistory — total CSS classes', () => {
  it('adds "crit" class to total when isCrit is true', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ isCrit: true, isFail: false }));
    expect(listEl.innerHTML).toContain('crit');
  });

  it('adds "fail" class to total when isFail is true', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ isFail: true, isCrit: false }));
    expect(listEl.innerHTML).toContain('fail');
  });

  it('adds no extra class for a normal roll', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ isCrit: false, isFail: false }));
    // rh-total should not have crit or fail appended
    const totalMatch = listEl.innerHTML.match(/rh-total([^"]*)/);
    expect(totalMatch?.[1] ?? '').toBe('');
  });
});

// ── multiple entries ──────────────────────────────────────────────────────────
describe('renderRollHistory — multiple entries', () => {
  it('renders all entries in the list', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ label: 'Perception' }));
    pushRoll(entry({ label: 'Stealth' }));
    pushRoll(entry({ label: 'Attack' }));
    expect(listEl.innerHTML).toContain('Perception');
    expect(listEl.innerHTML).toContain('Stealth');
    expect(listEl.innerHTML).toContain('Attack');
  });

  it('most recent entry appears first in the HTML', () => {
    const { pushRoll, listEl } = load([]);
    pushRoll(entry({ label: 'First' }));
    pushRoll(entry({ label: 'Second' }));
    expect(listEl.innerHTML.indexOf('Second')).toBeLessThan(
      listEl.innerHTML.indexOf('First')
    );
  });
});
