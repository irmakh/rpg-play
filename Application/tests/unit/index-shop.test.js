/**
 * Unit tests for shop helpers in index-shop.js.
 *
 * Pure / near-pure functions extracted with brace-counting and loaded into a
 * vm context with stubbed DOM elements (cart body, totals, buy button).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC  = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');
const SHOP_SRC = readFileSync(resolve(__dirname, '../../public/js/index/index-shop.js'), 'utf-8');

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
  SHOP_SRC,
  'cpToGp', 'bonusSummary',
  'addToCart', 'removeFromCart', 'renderCart',
  'renderShopItems',
);

function makeEl() {
  return { innerHTML: '', textContent: '', disabled: false, style: {} };
}

/**
 * Load extracted functions into a fresh vm context.
 *
 * catalog  — initial shopCatalog array
 * cart     — initial shopCart array ({ shopItem, qty })
 * charId   — currentCharId string or null
 */
function load({ catalog = [], cart = [], charId = null } = {}) {
  const cartBodyEl  = makeEl();
  const totalEl     = makeEl();
  const buyBtnEl    = makeEl();
  const purchErrEl  = makeEl();
  const itemsBodyEl = makeEl();

  const ctx = createContext({
    shopCatalog:   [...catalog],
    shopCart:      cart.map(e => ({ ...e })),
    shopDetailId:  null,
    currentCharId: charId,
    document: {
      getElementById(id) {
        if (id === 'shop-cart-body')    return cartBodyEl;
        if (id === 'shop-cart-total')   return totalEl;
        if (id === 'shop-buy-btn')      return buyBtnEl;
        if (id === 'shop-purchase-err') return purchErrEl;
        if (id === 'shop-items-body')   return itemsBodyEl;
        return makeEl();
      },
    },
    Math, parseInt, String, Infinity,
  });

  runInContext(ESC_SRC, ctx);
  runInContext(FN_SRC,  ctx);

  return {
    cpToGp:          ctx.cpToGp,
    bonusSummary:    ctx.bonusSummary,
    addToCart:       ctx.addToCart,
    removeFromCart:  ctx.removeFromCart,
    renderCart:      ctx.renderCart,
    renderShopItems: ctx.renderShopItems,
    get shopCart()   { return ctx.shopCart; },
    cartBodyEl, totalEl, buyBtnEl, purchErrEl, itemsBodyEl,
  };
}

// ── sample data ───────────────────────────────────────────────────────────────
function sword(overrides = {}) {
  return {
    id: 'sw-1', name: 'Longsword', valueCp: 1500, quantity: 5,
    itemType: 'weapon', weaponAtk: '1', weaponDmg: '1d8', weaponProperties: ['Versatile'],
    acBonus: 0, initBonus: 0, speedBonus: 0, requiresAttunement: false, notes: '',
    ...overrides,
  };
}

function ring(overrides = {}) {
  return {
    id: 'ri-1', name: 'Ring of Protection', valueCp: 250000, quantity: 1,
    itemType: 'wondrous', weaponAtk: '', weaponDmg: '', weaponProperties: [],
    acBonus: 1, initBonus: 0, speedBonus: 0, requiresAttunement: true, notes: '',
    ...overrides,
  };
}

// ── cpToGp ────────────────────────────────────────────────────────────────────
describe('cpToGp', () => {
  it('returns "0 gp" for 0', () => {
    const { cpToGp } = load();
    expect(cpToGp(0)).toBe('0 gp');
  });

  it('returns whole gp when evenly divisible by 100', () => {
    const { cpToGp } = load();
    expect(cpToGp(500)).toBe('5 gp');
    expect(cpToGp(100)).toBe('1 gp');
    expect(cpToGp(10000)).toBe('100 gp');
  });

  it('returns two-decimal gp when not evenly divisible', () => {
    const { cpToGp } = load();
    expect(cpToGp(150)).toBe('1.50 gp');
    expect(cpToGp(1)).toBe('0.01 gp');
    expect(cpToGp(1550)).toBe('15.50 gp');
  });
});

// ── bonusSummary ──────────────────────────────────────────────────────────────
describe('bonusSummary — weapon', () => {
  it('shows magic bonus for weapon', () => {
    const { bonusSummary } = load();
    expect(bonusSummary(sword({ weaponAtk: '2' }))).toContain('+2');
  });

  it('shows damage dice for weapon', () => {
    const { bonusSummary } = load();
    expect(bonusSummary(sword())).toContain('1d8');
  });

  it('shows weapon properties', () => {
    const { bonusSummary } = load();
    expect(bonusSummary(sword({ weaponProperties: ['Finesse', 'Light'] }))).toContain('Finesse, Light');
  });

  it('returns empty string for weapon with no bonuses or properties', () => {
    const { bonusSummary } = load();
    const plain = sword({ weaponAtk: '0', weaponDmg: '', weaponProperties: [] });
    expect(bonusSummary(plain)).toBe('');
  });
});

describe('bonusSummary — non-weapon', () => {
  it('shows AC bonus', () => {
    const { bonusSummary } = load();
    expect(bonusSummary(ring())).toContain('AC+1');
  });

  it('shows initiative bonus', () => {
    const { bonusSummary } = load();
    const item = ring({ acBonus: 0, initBonus: 2, requiresAttunement: false });
    expect(bonusSummary(item)).toContain('Init+2');
  });

  it('shows speed bonus', () => {
    const { bonusSummary } = load();
    const item = ring({ acBonus: 0, speedBonus: 10, requiresAttunement: false });
    expect(bonusSummary(item)).toContain('Spd+10');
  });

  it('shows Attune when requiresAttunement is true', () => {
    const { bonusSummary } = load();
    expect(bonusSummary(ring())).toContain('Attune');
  });

  it('returns empty string when non-weapon has no bonuses', () => {
    const { bonusSummary } = load();
    const plain = { itemType: 'wondrous', acBonus: 0, initBonus: 0, speedBonus: 0, requiresAttunement: false };
    expect(bonusSummary(plain)).toBe('');
  });
});

// ── addToCart ─────────────────────────────────────────────────────────────────
describe('addToCart', () => {
  it('adds a new item with qty 1', () => {
    const { addToCart, shopCart } = load({ catalog: [sword()] });
    addToCart('sw-1');
    expect(shopCart).toHaveLength(1);
    expect(shopCart[0].qty).toBe(1);
    expect(shopCart[0].shopItem.id).toBe('sw-1');
  });

  it('increments qty when item is already in cart', () => {
    const { addToCart, shopCart } = load({ catalog: [sword()] });
    addToCart('sw-1');
    addToCart('sw-1');
    expect(shopCart).toHaveLength(1);
    expect(shopCart[0].qty).toBe(2);
  });

  it('does not exceed finite stock quantity', () => {
    const { addToCart, shopCart } = load({ catalog: [sword({ quantity: 2 })] });
    addToCart('sw-1');
    addToCart('sw-1');
    addToCart('sw-1'); // third push — should be blocked
    expect(shopCart[0].qty).toBe(2);
  });

  it('allows unlimited qty for quantity -1 (infinite)', () => {
    const { addToCart, shopCart } = load({ catalog: [sword({ quantity: -1 })] });
    for (let i = 0; i < 10; i++) addToCart('sw-1');
    expect(shopCart[0].qty).toBe(10);
  });

  it('does nothing for an unknown item id', () => {
    const { addToCart, shopCart } = load({ catalog: [sword()] });
    addToCart('no-such-id');
    expect(shopCart).toHaveLength(0);
  });
});

// ── removeFromCart ────────────────────────────────────────────────────────────
describe('removeFromCart', () => {
  it('removes the matching item', () => {
    // Use result object — shopCart getter reads ctx.shopCart after reassignment
    const r = load({ catalog: [sword()] });
    r.addToCart('sw-1');
    r.removeFromCart('sw-1');
    expect(r.shopCart).toHaveLength(0);
  });

  it('leaves other items intact', () => {
    const bow = sword({ id: 'bow-1', name: 'Shortbow' });
    const r = load({ catalog: [sword(), bow] });
    r.addToCart('sw-1');
    r.addToCart('bow-1');
    r.removeFromCart('sw-1');
    expect(r.shopCart).toHaveLength(1);
    expect(r.shopCart[0].shopItem.id).toBe('bow-1');
  });

  it('is a no-op for an id not in cart', () => {
    const r = load({ catalog: [sword()] });
    r.addToCart('sw-1');
    r.removeFromCart('no-such-id');
    expect(r.shopCart).toHaveLength(1);
  });
});

// ── renderCart ────────────────────────────────────────────────────────────────
describe('renderCart — empty cart', () => {
  it('shows empty message', () => {
    const { renderCart, cartBodyEl } = load();
    renderCart();
    expect(cartBodyEl.innerHTML).toContain('Cart is empty');
  });

  it('disables the buy button', () => {
    const { renderCart, buyBtnEl } = load();
    renderCart();
    expect(buyBtnEl.disabled).toBe(true);
  });

  it('clears the total', () => {
    const { renderCart, totalEl } = load();
    renderCart();
    expect(totalEl.textContent).toBe('');
  });
});

describe('renderCart — with items', () => {
  it('shows item name and qty', () => {
    const { addToCart, cartBodyEl } = load({ catalog: [sword()] });
    addToCart('sw-1');
    expect(cartBodyEl.innerHTML).toContain('Longsword');
    expect(cartBodyEl.innerHTML).toContain('×1');
  });

  it('shows the subtotal for each item', () => {
    const { addToCart, cartBodyEl } = load({ catalog: [sword({ valueCp: 1500 })] });
    addToCart('sw-1');
    addToCart('sw-1');
    // 2 × 15 gp = 30 gp
    expect(cartBodyEl.innerHTML).toContain('30 gp');
  });

  it('shows total across all items', () => {
    const bow = sword({ id: 'bow-1', name: 'Shortbow', valueCp: 2500 });
    const { addToCart, totalEl } = load({ catalog: [sword({ valueCp: 1500 }), bow] });
    addToCart('sw-1');
    addToCart('bow-1');
    // 15 + 25 = 40 gp
    expect(totalEl.textContent).toContain('40 gp');
  });

  it('disables buy button when no character is loaded', () => {
    const { addToCart, buyBtnEl } = load({ catalog: [sword()], charId: null });
    addToCart('sw-1');
    expect(buyBtnEl.disabled).toBe(true);
  });

  it('enables buy button when a character is loaded', () => {
    const { addToCart, buyBtnEl } = load({ catalog: [sword()], charId: 'char-1' });
    addToCart('sw-1');
    expect(buyBtnEl.disabled).toBe(false);
  });
});

// ── renderShopItems ───────────────────────────────────────────────────────────
describe('renderShopItems', () => {
  it('shows empty message when catalog is empty', () => {
    const { renderShopItems, itemsBodyEl } = load({ catalog: [] });
    renderShopItems();
    expect(itemsBodyEl.innerHTML).toContain('The shop is empty');
  });

  it('renders item name and price', () => {
    const { renderShopItems, itemsBodyEl } = load({ catalog: [sword({ valueCp: 1500 })] });
    renderShopItems();
    expect(itemsBodyEl.innerHTML).toContain('Longsword');
    expect(itemsBodyEl.innerHTML).toContain('15 gp');
  });

  it('shows infinite stock as ∞', () => {
    const { renderShopItems, itemsBodyEl } = load({ catalog: [sword({ quantity: -1 })] });
    renderShopItems();
    expect(itemsBodyEl.innerHTML).toContain('∞');
  });

  it('shows finite stock count', () => {
    const { renderShopItems, itemsBodyEl } = load({ catalog: [sword({ quantity: 3 })] });
    renderShopItems();
    expect(itemsBodyEl.innerHTML).toContain('×3');
  });

  it('HTML-escapes item names', () => {
    const { renderShopItems, itemsBodyEl } = load({
      catalog: [sword({ name: '<script>xss</script>' })],
    });
    renderShopItems();
    expect(itemsBodyEl.innerHTML).not.toContain('<script>');
    expect(itemsBodyEl.innerHTML).toContain('&lt;script&gt;');
  });
});
