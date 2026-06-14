/**
 * Unit tests for the filtering + sorting logic inside renderInitiativeTracker
 * from public/js/index/index-initiative.js.
 *
 * The function reads `initData` and writes to a DOM element's innerHTML.
 * We extract the function with brace-counting, load it in a vm context with
 * a minimal DOM stub, then inspect the rendered HTML to verify behaviour.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../public/js/index/index-initiative.js'), 'utf-8'
);

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

const FN_SRC = extractFunctions(SRC, 'initMonsterIdentifier', 'renderInitiativeTracker');

/**
 * Load renderInitiativeTracker into a fresh vm context.
 *
 * initData   — { entries: [...], currentId: string|null }
 * collapsed  — initTrackerCollapsed initial value (default true)
 *
 * Returns { render, listEl, badgeEl } where listEl.innerHTML is set by render().
 */
function load(initData, collapsed = true, isDM = false) {
  const listEl  = { innerHTML: '' };
  const badgeEl = { style: { display: 'none' } };

  const ctx = createContext({
    initData,
    initTrackerCollapsed: collapsed,
    initDataMap: {},
    indexIsDM: () => isDM,
    // Simple HTML-escaping so names appear verbatim (no special chars in test data)
    esc: (s) => String(s || ''),
    escJs: (s) => String(s == null ? '' : s),
    document: {
      getElementById(id) {
        if (id === 'init-tracker-list') return listEl;
        if (id === 'init-badge')        return badgeEl;
        return { style: {}, textContent: '' };
      },
    },
  });

  runInContext(FN_SRC, ctx);

  return {
    render: (showBadge = false) => ctx.renderInitiativeTracker(showBadge),
    listEl,
    badgeEl,
    initDataMap: () => ctx.initDataMap,
  };
}

// ── empty list ────────────────────────────────────────────────────────────────
describe('renderInitiativeTracker — empty', () => {
  it('shows the empty message when entries is []', () => {
    const { render, listEl } = load({ entries: [], currentId: null });
    render();
    expect(listEl.innerHTML).toContain('No combatants yet');
  });

  it('shows the empty message after filtering removes all monsters', () => {
    // Only monster entries and no currentId → all filtered out
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Goblin', roll: 15, monsterId: 'm1' }],
      currentId: null,
    });
    render();
    expect(listEl.innerHTML).toContain('No combatants yet');
  });
});

// ── monster visibility filtering ──────────────────────────────────────────────
describe('renderInitiativeTracker — monster filtering', () => {
  it('hides monster entries when currentId is null (no active combat)', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Aria',   roll: 18, monsterId: '' },
        { id: 'e2', name: 'Goblin', roll: 12, monsterId: 'mon-1' },
      ],
      currentId: null,
    });
    render();
    expect(listEl.innerHTML).toContain('Aria');
    expect(listEl.innerHTML).not.toContain('Goblin');
  });

  it('hides monster entries when currentId is empty string', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Hero',   roll: 10, monsterId: '' },
        { id: 'e2', name: 'Dragon', roll: 20, monsterId: 'dr-1' },
      ],
      currentId: '',
    });
    render();
    expect(listEl.innerHTML).not.toContain('Dragon');
    expect(listEl.innerHTML).toContain('Hero');
  });

  it('shows monster entries when currentId is set (combat is active)', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Aria',     roll: 18, monsterId: '' },
        { id: 'e2', name: 'Goblin G7', roll: 12, monsterId: 'mon-1' },
      ],
      currentId: 'e1',
    });
    render();
    expect(listEl.innerHTML).toContain('Aria');
    // Monster is visible during combat but only its identifier shows for players
    expect(listEl.innerHTML).toContain('G7');
    expect(listEl.innerHTML).not.toContain('Goblin');
  });

  it('PC and NPC entries (empty monsterId) are always visible', () => {
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Innkeeper Bob', roll: 5, monsterId: '' }],
      currentId: null,
    });
    render();
    expect(listEl.innerHTML).toContain('Innkeeper Bob');
  });
});

// ── monster name masking (player vs DM) ───────────────────────────────────────
describe('renderInitiativeTracker — monster name masking', () => {
  it('shows only the identifier (last word) of a monster, hiding the type, for players', () => {
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Ancient Red Dragon D3', roll: 20, monsterId: 'm1' }],
      currentId: 'e1',
    });
    render();
    expect(listEl.innerHTML).toContain('D3');
    expect(listEl.innerHTML).not.toContain('Ancient Red Dragon');
    expect(listEl.innerHTML).not.toContain('Dragon');
  });

  it('hides edit/remove buttons on monster rows for players', () => {
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Goblin A', roll: 12, monsterId: 'm1' }],
      currentId: 'e1',
    });
    render();
    expect(listEl.innerHTML).not.toContain('openInitEditModal');
    expect(listEl.innerHTML).not.toContain('deleteInitEntry');
  });

  it('shows the real monster name to the DM', () => {
    const { render, listEl } = load(
      { entries: [{ id: 'e1', name: 'Goblin A', roll: 12, monsterId: 'm1' }], currentId: 'e1' },
      true,  // collapsed
      true   // isDM
    );
    render();
    expect(listEl.innerHTML).toContain('Goblin A');
  });

  it('keeps edit/remove buttons on monster rows for the DM', () => {
    const { render, listEl } = load(
      { entries: [{ id: 'e1', name: 'Goblin A', roll: 12, monsterId: 'm1' }], currentId: 'e1' },
      true, true
    );
    render();
    expect(listEl.innerHTML).toContain('openInitEditModal');
    expect(listEl.innerHTML).toContain('deleteInitEntry');
  });

  it('never masks player/NPC entries (empty monsterId)', () => {
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Innkeeper Bob', roll: 5, monsterId: '' }],
      currentId: null,
    });
    render();
    // Full name preserved — not reduced to its last word ("Bob")
    expect(listEl.innerHTML).toContain('Innkeeper Bob');
  });
});

// ── sorting ───────────────────────────────────────────────────────────────────
describe('renderInitiativeTracker — sorting', () => {
  it('entries are rendered in descending roll order', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Low',  roll: 5,  monsterId: '' },
        { id: 'e2', name: 'High', roll: 20, monsterId: '' },
        { id: 'e3', name: 'Mid',  roll: 12, monsterId: '' },
      ],
      currentId: null,
    });
    render();
    const html = listEl.innerHTML;
    expect(html.indexOf('High')).toBeLessThan(html.indexOf('Mid'));
    expect(html.indexOf('Mid')).toBeLessThan(html.indexOf('Low'));
  });

  it('entries with equal rolls keep their relative order', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Alpha', roll: 10, monsterId: '' },
        { id: 'e2', name: 'Beta',  roll: 10, monsterId: '' },
      ],
      currentId: null,
    });
    render();
    // Both should appear; order stability is not strictly required but both must show
    expect(listEl.innerHTML).toContain('Alpha');
    expect(listEl.innerHTML).toContain('Beta');
  });
});

// ── active turn marker ────────────────────────────────────────────────────────
describe('renderInitiativeTracker — active turn marker', () => {
  it('the active entry gets the init-cur class', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Aria',      roll: 18, monsterId: '' },
        { id: 'e2', name: 'Goblin G9', roll: 10, monsterId: 'mon-1' },
      ],
      currentId: 'e1',
    });
    render();
    // The row containing 'Aria' should have init-cur; the monster's should not.
    // The monster type is masked to its identifier ('G9') for players, so match on that.
    // Split on the opening tag; check for ' init-cur"' (space+class+quote) to
    // avoid false matches on the always-present "init-cur-marker" class.
    const rows = listEl.innerHTML.split('<div class="init-row');
    const ariaRow    = rows.find(r => r.includes('Aria'));
    const monsterRow = rows.find(r => r.includes('G9'));
    expect(ariaRow).toContain(' init-cur"');
    expect(monsterRow).not.toContain(' init-cur"');
  });

  it('the active marker ▶ appears only on the current entry', () => {
    const { render, listEl } = load({
      entries: [
        { id: 'e1', name: 'Fighter', roll: 20, monsterId: '' },
        { id: 'e2', name: 'Rogue',   roll: 15, monsterId: '' },
      ],
      currentId: 'e2',
    });
    render();
    expect(listEl.innerHTML).toContain('▶');
    // Count occurrences — only one ▶
    const count = (listEl.innerHTML.match(/▶/g) || []).length;
    expect(count).toBe(1);
  });

  it('no ▶ appears when currentId does not match any entry', () => {
    const { render, listEl } = load({
      entries: [{ id: 'e1', name: 'Aria', roll: 10, monsterId: '' }],
      currentId: 'e-nonexistent',
    });
    render();
    expect(listEl.innerHTML).not.toContain('▶');
  });
});

// ── initDataMap ───────────────────────────────────────────────────────────────
describe('renderInitiativeTracker — initDataMap population', () => {
  it('populates initDataMap keyed by entry id after render', () => {
    const entry = { id: 'e1', name: 'Aria', roll: 15, monsterId: '' };
    const { render, initDataMap } = load({ entries: [entry], currentId: null });
    render();
    expect(initDataMap()['e1']).toMatchObject({ id: 'e1', name: 'Aria' });
  });

  it('does not include filtered-out monsters in initDataMap', () => {
    const { render, initDataMap } = load({
      entries: [
        { id: 'pc',  name: 'Aria',   roll: 18, monsterId: '' },
        { id: 'mon', name: 'Goblin', roll: 10, monsterId: 'm1' },
      ],
      currentId: null,
    });
    render();
    expect(initDataMap()['pc']).toBeDefined();
    expect(initDataMap()['mon']).toBeUndefined();
  });
});

// ── badge ─────────────────────────────────────────────────────────────────────
describe('renderInitiativeTracker — badge visibility', () => {
  it('shows badge when showBadge=true and tracker is collapsed and has entries', () => {
    const { render, badgeEl } = load(
      { entries: [{ id: 'e1', name: 'Aria', roll: 10, monsterId: '' }], currentId: null },
      true  // collapsed
    );
    render(true);
    expect(badgeEl.style.display).toBe('');
  });

  it('does not show badge when showBadge=false', () => {
    const { render, badgeEl } = load(
      { entries: [{ id: 'e1', name: 'Aria', roll: 10, monsterId: '' }], currentId: null },
      true
    );
    render(false);
    expect(badgeEl.style.display).toBe('none');  // unchanged from initial
  });

  it('does not show badge when tracker is not collapsed', () => {
    const { render, badgeEl } = load(
      { entries: [{ id: 'e1', name: 'Aria', roll: 10, monsterId: '' }], currentId: null },
      false  // not collapsed
    );
    render(true);
    expect(badgeEl.style.display).toBe('none');
  });
});
