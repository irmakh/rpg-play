/**
 * Unit tests for the pure logic in index-actions.js:
 *   _actAttackRange — derives an attack's range from its item's weapon properties
 *   setActionFilter — sets the active filter + toggles chip classes
 *   toggleActionBox — limited-use consume/restore (+ auto-roll on consume)
 *   actionRest      — short/long rest recharge reset
 *
 * Functions are extracted by brace-matching and run in a fresh vm context with
 * stubbed globals, mirroring the pattern in index-char-data.test.js.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-actions.js'), 'utf-8');

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

const FN_SRC = extractFunctions(SRC, '_actAttackRange', 'setActionFilter', 'toggleActionBox', 'actionRest');

function load({ actions = [], items = [], filter = 'all', chips = [] } = {}) {
  const rollCalls = [];
  const ctx = createContext({
    actions:        actions.map(a => ({ ...a })),
    items:          items.map(i => ({ ...i })),
    _actionFilter:  filter,
    rollDamage:     (label, expr) => rollCalls.push({ label, expr }),
    renderActionsTab: () => {},
    scheduleAutoSave: () => {},
    document: {
      querySelectorAll(sel) {
        if (sel === '#act-filters .act-chip') return chips;
        return [];
      },
    },
    parseInt, Math,
  });
  runInContext(FN_SRC, ctx);
  return {
    ctx,
    rollCalls,
    _actAttackRange: ctx._actAttackRange,
    setActionFilter: ctx.setActionFilter,
    toggleActionBox: ctx.toggleActionBox,
    actionRest:      ctx.actionRest,
    get actions()      { return ctx.actions; },
    get actionFilter() { return ctx._actionFilter; },
  };
}

// ── _actAttackRange ───────────────────────────────────────────────────────────
describe('_actAttackRange', () => {
  it('returns 10 ft. for a weapon with the Reach property', () => {
    const r = load({ items: [{ id: 1, weaponProperties: ['Reach'] }] });
    expect(r._actAttackRange(1)).toBe('10 ft.');
  });

  it('returns "ranged" for Ammunition or Thrown weapons', () => {
    const r = load({ items: [{ id: 1, weaponProperties: ['Ammunition'] }, { id: 2, weaponProperties: ['Thrown'] }] });
    expect(r._actAttackRange(1)).toBe('ranged');
    expect(r._actAttackRange(2)).toBe('ranged');
  });

  it('defaults to 5 ft. for a plain melee weapon', () => {
    const r = load({ items: [{ id: 1, weaponProperties: [] }] });
    expect(r._actAttackRange(1)).toBe('5 ft.');
  });

  it('defaults to 5 ft. when no itemId / item is given', () => {
    const r = load();
    expect(r._actAttackRange(null)).toBe('5 ft.');
    expect(r._actAttackRange(999)).toBe('5 ft.');
  });
});

// ── setActionFilter ───────────────────────────────────────────────────────────
describe('setActionFilter', () => {
  it('updates the active filter value', () => {
    const r = load({ filter: 'all' });
    r.setActionFilter('bonus', null);
    expect(r.actionFilter).toBe('bonus');
  });

  it('toggles the active class onto the clicked chip and off the others', () => {
    const mk = () => {
      const cls = new Set(['active']);
      return { classList: { add: c => cls.add(c), remove: c => cls.delete(c), has: c => cls.has(c) }, _cls: cls };
    };
    const a = mk(), b = mk();
    const r = load({ chips: [a, b] });
    r.setActionFilter('attack', b);
    expect(a._cls.has('active')).toBe(false);
    expect(b._cls.has('active')).toBe(true);
  });
});

// ── toggleActionBox ───────────────────────────────────────────────────────────
describe('toggleActionBox', () => {
  it('consumes a use by clicking the first empty box', () => {
    const r = load({ actions: [{ id: 1, uses: 3, used: 0 }] });
    r.toggleActionBox(1, 0);     // click box index 0 → used = 1
    expect(r.actions[0].used).toBe(1);
  });

  it('consumes up to the clicked box index', () => {
    const r = load({ actions: [{ id: 1, uses: 3, used: 0 }] });
    r.toggleActionBox(1, 2);     // click box index 2 → used = 3
    expect(r.actions[0].used).toBe(3);
  });

  it('restores by clicking a filled box', () => {
    const r = load({ actions: [{ id: 1, uses: 3, used: 3 }] });
    r.toggleActionBox(1, 1);     // click filled box index 1 → used = 1
    expect(r.actions[0].used).toBe(1);
  });

  it('auto-rolls the dice when consuming a use', () => {
    const r = load({ actions: [{ id: 1, name: 'Second Wind', uses: 3, used: 0, dice: '1d10+8' }] });
    r.toggleActionBox(1, 0);
    expect(r.rollCalls).toHaveLength(1);
    expect(r.rollCalls[0].expr).toBe('1d10+8');
  });

  it('does NOT roll dice when restoring a use', () => {
    const r = load({ actions: [{ id: 1, name: 'Second Wind', uses: 3, used: 3, dice: '1d10+8' }] });
    r.toggleActionBox(1, 1);     // restore
    expect(r.rollCalls).toHaveLength(0);
  });

  it('does nothing for an unknown action id', () => {
    const r = load({ actions: [{ id: 1, uses: 3, used: 0 }] });
    expect(() => r.toggleActionBox(99, 0)).not.toThrow();
    expect(r.actions[0].used).toBe(0);
  });
});

// ── actionRest ────────────────────────────────────────────────────────────────
describe('actionRest', () => {
  const seed = () => [
    { id: 1, recharge: 'short', uses: 2, used: 2 },
    { id: 2, recharge: 'long',  uses: 1, used: 1 },
    { id: 3, recharge: '',      uses: 2, used: 1 },
  ];

  it('short rest resets only short-recharge actions', () => {
    const r = load({ actions: seed() });
    r.actionRest('short');
    expect(r.actions.find(a => a.id === 1).used).toBe(0);
    expect(r.actions.find(a => a.id === 2).used).toBe(1);
    expect(r.actions.find(a => a.id === 3).used).toBe(1);
  });

  it('long rest resets both short- and long-recharge actions', () => {
    const r = load({ actions: seed() });
    r.actionRest('long');
    expect(r.actions.find(a => a.id === 1).used).toBe(0);
    expect(r.actions.find(a => a.id === 2).used).toBe(0);
    expect(r.actions.find(a => a.id === 3).used).toBe(1);
  });
});
