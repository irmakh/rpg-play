/**
 * Unit tests for loot helpers in index-loot.js.
 *
 * Functions extracted: addToLootCart, removeFromLootCart, renderLootItems,
 * renderLootCart, renderClaimedLoots, removeLoot.
 *
 * DOM elements are stub objects; esc() is loaded from lib/esc.js.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC  = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');
const LOOT_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-loot.js'), 'utf-8');

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

const FN_SRC = extractFunctions(
  LOOT_SRC,
  'addToLootCart', 'removeFromLootCart',
  'renderLootItems', 'renderLootCart',
  'renderClaimedLoots', 'removeLoot',
);

function makeEl() {
  return { innerHTML: '', textContent: '', disabled: false, style: {} };
}

/**
 * Load extracted functions into a fresh vm context.
 *
 * catalog       — initial lootCatalog
 * cart          — initial lootCart
 * claimedLoots  — initial claimedLoots
 * charId        — currentCharId
 */
function load({
  catalog      = [],
  cart         = [],
  claimedLoots = [],
  charId       = null,
} = {}) {
  const loadingEl     = makeEl();
  const itemsBodyEl   = makeEl();
  const cartBodyEl    = makeEl();
  const claimBtnEl    = makeEl();
  const claimErrEl    = makeEl();
  const claimedBodyEl = makeEl();

  const ctx = createContext({
    lootCatalog:   [...catalog],
    lootCart:      [...cart],
    claimedLoots:  claimedLoots.map(l => ({ ...l })),
    currentCharId: charId,
    document: {
      getElementById(id) {
        if (id === 'loot-loading')      return loadingEl;
        if (id === 'loot-items-body')   return itemsBodyEl;
        if (id === 'loot-cart-body')    return cartBodyEl;
        if (id === 'loot-claim-btn')    return claimBtnEl;
        if (id === 'loot-claim-err')    return claimErrEl;
        if (id === 'claimed-loots-body') return claimedBodyEl;
        return makeEl();
      },
    },
    // removeLoot() triggers an autosave; stub it so the unit test stays isolated.
    scheduleAutoSave: () => {},
    String,
  });

  runInContext(ESC_SRC, ctx);
  runInContext(FN_SRC,  ctx);

  return {
    addToLootCart:      ctx.addToLootCart,
    removeFromLootCart: ctx.removeFromLootCart,
    renderLootItems:    ctx.renderLootItems,
    renderLootCart:     ctx.renderLootCart,
    renderClaimedLoots: ctx.renderClaimedLoots,
    removeLoot:         ctx.removeLoot,
    get lootCart()      { return ctx.lootCart; },
    get claimedLoots()  { return ctx.claimedLoots; },
    itemsBodyEl, cartBodyEl, claimBtnEl, claimErrEl, claimedBodyEl,
  };
}

// ── sample data ───────────────────────────────────────────────────────────────
function lootItem(overrides = {}) {
  return { id: 'loot-1', name: 'Healing Potion', description: 'Restores 2d4+2 HP', ...overrides };
}

// ── addToLootCart ─────────────────────────────────────────────────────────────
describe('addToLootCart', () => {
  it('adds a catalog item to the cart', () => {
    const { addToLootCart, lootCart } = load({ catalog: [lootItem()] });
    addToLootCart('loot-1');
    expect(lootCart).toHaveLength(1);
    expect(lootCart[0].id).toBe('loot-1');
  });

  it('does not add a duplicate (same id)', () => {
    const { addToLootCart, lootCart } = load({ catalog: [lootItem()] });
    addToLootCart('loot-1');
    addToLootCart('loot-1');
    expect(lootCart).toHaveLength(1);
  });

  it('does nothing for an id not in catalog', () => {
    const { addToLootCart, lootCart } = load({ catalog: [lootItem()] });
    addToLootCart('no-such-id');
    expect(lootCart).toHaveLength(0);
  });

  it('can add multiple different items', () => {
    const gem = lootItem({ id: 'loot-2', name: 'Ruby' });
    const { addToLootCart, lootCart } = load({ catalog: [lootItem(), gem] });
    addToLootCart('loot-1');
    addToLootCart('loot-2');
    expect(lootCart).toHaveLength(2);
  });
});

// ── removeFromLootCart ────────────────────────────────────────────────────────
describe('removeFromLootCart', () => {
  it('removes the item from the cart', () => {
    // Use result object — lootCart getter reads ctx.lootCart after reassignment
    const r = load({ catalog: [lootItem()] });
    r.addToLootCart('loot-1');
    r.removeFromLootCart('loot-1');
    expect(r.lootCart).toHaveLength(0);
  });

  it('leaves other cart items intact', () => {
    const gem = lootItem({ id: 'loot-2', name: 'Ruby' });
    const r = load({ catalog: [lootItem(), gem] });
    r.addToLootCart('loot-1');
    r.addToLootCart('loot-2');
    r.removeFromLootCart('loot-1');
    expect(r.lootCart).toHaveLength(1);
    expect(r.lootCart[0].id).toBe('loot-2');
  });

  it('is a no-op for an id not in cart', () => {
    const r = load({ catalog: [lootItem()] });
    r.addToLootCart('loot-1');
    r.removeFromLootCart('no-such-id');
    expect(r.lootCart).toHaveLength(1);
  });
});

// ── renderLootItems ───────────────────────────────────────────────────────────
describe('renderLootItems — empty catalog', () => {
  it('shows no-loot message when catalog is empty', () => {
    const { renderLootItems, itemsBodyEl } = load({ catalog: [] });
    renderLootItems();
    expect(itemsBodyEl.innerHTML).toContain('No loot available yet');
  });
});

describe('renderLootItems — catalog with items', () => {
  it('renders item name', () => {
    const { renderLootItems, itemsBodyEl } = load({ catalog: [lootItem()] });
    renderLootItems();
    expect(itemsBodyEl.innerHTML).toContain('Healing Potion');
  });

  it('renders item description', () => {
    const { renderLootItems, itemsBodyEl } = load({ catalog: [lootItem()] });
    renderLootItems();
    expect(itemsBodyEl.innerHTML).toContain('Restores 2d4+2 HP');
  });

  it('shows "✓ Claimed" for already-claimed items', () => {
    const claimed = [{ id: 'loot-1', name: 'Healing Potion', description: '' }];
    const { renderLootItems, itemsBodyEl } = load({ catalog: [lootItem()], claimedLoots: claimed });
    renderLootItems();
    expect(itemsBodyEl.innerHTML).toContain('Claimed');
  });

  it('disables the cart button for items already in cart', () => {
    const { addToLootCart, itemsBodyEl } = load({ catalog: [lootItem()] });
    addToLootCart('loot-1');
    expect(itemsBodyEl.innerHTML).toContain('disabled');
    expect(itemsBodyEl.innerHTML).toContain('In Cart');
  });

  it('HTML-escapes item names', () => {
    const evil = lootItem({ name: '<script>xss</script>' });
    const { renderLootItems, itemsBodyEl } = load({ catalog: [evil] });
    renderLootItems();
    expect(itemsBodyEl.innerHTML).not.toContain('<script>');
    expect(itemsBodyEl.innerHTML).toContain('&lt;script&gt;');
  });
});

// ── renderLootCart ────────────────────────────────────────────────────────────
describe('renderLootCart — empty cart', () => {
  it('shows empty message', () => {
    const { renderLootCart, cartBodyEl } = load();
    renderLootCart();
    expect(cartBodyEl.innerHTML).toContain('Cart is empty');
  });

  it('disables the claim button', () => {
    const { renderLootCart, claimBtnEl } = load();
    renderLootCart();
    expect(claimBtnEl.disabled).toBe(true);
  });
});

describe('renderLootCart — with items', () => {
  it('shows item name in cart', () => {
    const { addToLootCart, cartBodyEl } = load({ catalog: [lootItem()] });
    addToLootCart('loot-1');
    expect(cartBodyEl.innerHTML).toContain('Healing Potion');
  });

  it('disables claim button when no character is loaded', () => {
    const { addToLootCart, claimBtnEl } = load({ catalog: [lootItem()], charId: null });
    addToLootCart('loot-1');
    expect(claimBtnEl.disabled).toBe(true);
  });

  it('enables claim button when a character is loaded', () => {
    const { addToLootCart, claimBtnEl } = load({ catalog: [lootItem()], charId: 'char-1' });
    addToLootCart('loot-1');
    expect(claimBtnEl.disabled).toBe(false);
  });

  it('clears the claim error on each render', () => {
    const { addToLootCart, claimErrEl } = load({ catalog: [lootItem()] });
    claimErrEl.textContent = 'old error';
    addToLootCart('loot-1');
    expect(claimErrEl.textContent).toBe('');
  });
});

// ── renderClaimedLoots ────────────────────────────────────────────────────────
describe('renderClaimedLoots — empty', () => {
  it('shows no-loots message when list is empty', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({ claimedLoots: [] });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).toContain('No loots claimed yet');
  });
});

describe('renderClaimedLoots — with items', () => {
  it('renders the claimed item name', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [{ id: 'loot-1', name: 'Healing Potion', description: '' }],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).toContain('Healing Potion');
  });

  it('shows description when descVisible is not false', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [{ id: 'loot-1', name: 'Potion', description: 'Heals 2d4', descVisible: true }],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).toContain('Heals 2d4');
  });

  it('hides description when descVisible is false', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [{ id: 'loot-1', name: 'Potion', description: 'Secret', descVisible: false }],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).not.toContain('Secret');
  });

  it('HTML-escapes the item name', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [{ id: 'l1', name: '<b>bold</b>', description: '' }],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).not.toContain('<b>bold</b>');
    expect(claimedBodyEl.innerHTML).toContain('&lt;b&gt;');
  });

  it('renders multiple claimed items', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [
        { id: 'l1', name: 'Potion', description: '' },
        { id: 'l2', name: 'Scroll', description: '' },
      ],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).toContain('Potion');
    expect(claimedBodyEl.innerHTML).toContain('Scroll');
  });
});

// ── removeLoot ────────────────────────────────────────────────────────────────
describe('removeLoot', () => {
  it('removes the loot at the given index', () => {
    const { removeLoot, claimedLoots } = load({
      claimedLoots: [
        { id: 'l1', name: 'Potion', description: '' },
        { id: 'l2', name: 'Scroll', description: '' },
      ],
    });
    removeLoot(0);
    expect(claimedLoots).toHaveLength(1);
    expect(claimedLoots[0].id).toBe('l2');
  });

  it('removes the last item', () => {
    const { removeLoot, claimedLoots } = load({
      claimedLoots: [{ id: 'l1', name: 'Potion', description: '' }],
    });
    removeLoot(0);
    expect(claimedLoots).toHaveLength(0);
  });

  it('splices by index, not by id', () => {
    const { removeLoot, claimedLoots } = load({
      claimedLoots: [
        { id: 'l1', name: 'A', description: '' },
        { id: 'l2', name: 'B', description: '' },
        { id: 'l3', name: 'C', description: '' },
      ],
    });
    removeLoot(1); // remove B
    expect(claimedLoots.map(l => l.id)).toEqual(['l1', 'l3']);
  });
});
