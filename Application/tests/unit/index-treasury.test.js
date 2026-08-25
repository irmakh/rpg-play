/**
 * Unit tests for the merged treasury helpers in index-treasury.js.
 *
 * Supersedes index-shop.test.js and index-loot.test.js — every assertion from
 * both is carried over, retargeted at the merged functions. The shop cases run
 * with treasurySeg='shop' and the loot cases with treasurySeg='loot'.
 *
 * Functions are extracted with brace counting and loaded into a vm context with
 * stubbed DOM elements; esc()/escJs() come from lib/esc.js.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESC_SRC = readFileSync(resolve(__dirname, '../../public/js/lib/esc.js'), 'utf-8');
const TR_SRC  = readFileSync(resolve(__dirname, '../../public/js/index/index-treasury.js'), 'utf-8');

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
  TR_SRC,
  'cpToGp', 'bonusSummary', 'treasuryTypeLabel', 'isUnidentified',
  'treasuryDisplayName', 'unidentifiedHTML', 'treasuryThumb', 'findTreasuryItem',
  'addToLootCart', 'removeFromLootCart',
  'addToCart', 'removeFromCart',
  'renderTreasuryItems', 'renderTreasuryCart',
  'renderClaimedLoots', 'removeLoot',
);

function makeEl() {
  return { innerHTML: '', textContent: '', disabled: false, style: {} };
}

/**
 * seg          — 'loot' | 'shop'
 * loot / shop  — catalogue arrays served by GET /api/treasury
 * shopOpen     — whether the shop segment is trading
 * claimedIds   — ids this character has already claimed
 * claimedLoots — legacy _loots list behind the Main-tab card
 * charId       — currentCharId
 */
function load({
  seg = 'loot', loot = [], shop = [], shopOpen = true,
  claimedIds = [], claimedLoots = [], lootCart = [], shopCart = [], charId = null,
} = {}) {
  const loadingEl  = makeEl();
  const itemsBodyEl = makeEl();
  const cartBodyEl = makeEl();
  const totalEl    = makeEl();
  const actionBtnEl = makeEl();
  const errEl      = makeEl();
  const claimedBodyEl = makeEl();

  const ctx = createContext({
    treasuryData: { shopOpen, activeTag: '', loot: [...loot], shop: [...shop], claimedIds: [...claimedIds] },
    treasurySeg:  seg,
    lootCart:     [...lootCart],
    shopCart:     shopCart.map(e => ({ ...e })),
    claimedLoots: claimedLoots.map(l => ({ ...l })),
    currentCharId: charId,
    document: {
      getElementById(id) {
        if (id === 'treasury-loading')    return loadingEl;
        if (id === 'treasury-items-body') return itemsBodyEl;
        if (id === 'treasury-cart-body')  return cartBodyEl;
        if (id === 'treasury-cart-total') return totalEl;
        if (id === 'treasury-action-btn') return actionBtnEl;
        if (id === 'treasury-err')        return errEl;
        if (id === 'claimed-loots-body')  return claimedBodyEl;
        return makeEl();
      },
    },
    // removeLoot() triggers an autosave; stub it so the unit test stays isolated.
    scheduleAutoSave: () => {},
    Math, parseInt, String, Infinity,
  });

  runInContext(ESC_SRC, ctx);
  runInContext(FN_SRC,  ctx);

  return {
    cpToGp:              ctx.cpToGp,
    bonusSummary:        ctx.bonusSummary,
    treasuryTypeLabel:   ctx.treasuryTypeLabel,
    findTreasuryItem:    ctx.findTreasuryItem,
    addToLootCart:       ctx.addToLootCart,
    removeFromLootCart:  ctx.removeFromLootCart,
    addToCart:           ctx.addToCart,
    removeFromCart:      ctx.removeFromCart,
    renderTreasuryItems: ctx.renderTreasuryItems,
    renderTreasuryCart:  ctx.renderTreasuryCart,
    renderClaimedLoots:  ctx.renderClaimedLoots,
    removeLoot:          ctx.removeLoot,
    // Getters — these globals are reassigned by the tested code.
    get lootCart()     { return ctx.lootCart; },
    get shopCart()     { return ctx.shopCart; },
    get claimedLoots() { return ctx.claimedLoots; },
    itemsBodyEl, cartBodyEl, totalEl, actionBtnEl, errEl, claimedBodyEl,
  };
}

// ── sample data ───────────────────────────────────────────────────────────────
function sword(overrides = {}) {
  return {
    id: 'sw-1', name: 'Longsword', mode: 'shop', valueCp: 1500, quantity: 5,
    itemType: 'weapon', weaponAtk: '1', weaponDmg: '1d8', weaponProperties: ['Versatile'],
    acBonus: 0, initBonus: 0, speedBonus: 0, requiresAttunement: false, description: '',
    imageThumb: '', imageUrl: '',
    ...overrides,
  };
}

function ring(overrides = {}) {
  return {
    id: 'ri-1', name: 'Ring of Protection', mode: 'shop', valueCp: 250000, quantity: 1,
    itemType: 'wondrous', weaponAtk: '', weaponDmg: '', weaponProperties: [],
    acBonus: 1, initBonus: 0, speedBonus: 0, requiresAttunement: true, description: '',
    ...overrides,
  };
}

function lootItem(overrides = {}) {
  return {
    id: 'loot-1', name: 'Healing Potion', mode: 'loot',
    description: 'Restores 2d4+2 HP', descVisible: true,
    itemType: 'other', valueCp: 0, quantity: 1,
    acBonus: 0, initBonus: 0, speedBonus: 0, requiresAttunement: false,
    weaponProperties: [], imageThumb: '', imageUrl: '',
    ...overrides,
  };
}

// ── cpToGp ────────────────────────────────────────────────────────────────────
describe('cpToGp', () => {
  it('returns "0 gp" for 0', () => {
    expect(load().cpToGp(0)).toBe('0 gp');
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
    expect(load().bonusSummary(sword({ weaponAtk: '2' }))).toContain('+2');
  });

  it('shows damage dice for weapon', () => {
    expect(load().bonusSummary(sword())).toContain('1d8');
  });

  it('shows weapon properties', () => {
    expect(load().bonusSummary(sword({ weaponProperties: ['Finesse', 'Light'] }))).toContain('Finesse, Light');
  });

  it('returns empty string for weapon with no bonuses or properties', () => {
    const plain = sword({ weaponAtk: '0', weaponDmg: '', weaponProperties: [] });
    expect(load().bonusSummary(plain)).toBe('');
  });
});

describe('bonusSummary — non-weapon', () => {
  it('shows AC bonus', () => {
    expect(load().bonusSummary(ring())).toContain('AC+1');
  });

  it('shows initiative bonus', () => {
    expect(load().bonusSummary(ring({ acBonus: 0, initBonus: 2, requiresAttunement: false }))).toContain('Init+2');
  });

  it('shows speed bonus', () => {
    expect(load().bonusSummary(ring({ acBonus: 0, speedBonus: 10, requiresAttunement: false }))).toContain('Spd+10');
  });

  it('shows Attune when requiresAttunement is true', () => {
    expect(load().bonusSummary(ring())).toContain('Attune');
  });

  it('returns empty string when non-weapon has no bonuses', () => {
    const plain = { itemType: 'wondrous', acBonus: 0, initBonus: 0, speedBonus: 0, requiresAttunement: false };
    expect(load().bonusSummary(plain)).toBe('');
  });
});

// ── treasuryTypeLabel ─────────────────────────────────────────────────────────
describe('treasuryTypeLabel', () => {
  it('spells out each item type', () => {
    const { treasuryTypeLabel } = load();
    expect(treasuryTypeLabel({ itemType: 'weapon' })).toBe('Weapon');
    expect(treasuryTypeLabel({ itemType: 'shield' })).toBe('Shield');
    expect(treasuryTypeLabel({ itemType: 'wondrous' })).toBe('Wondrous / Magic Item');
    expect(treasuryTypeLabel({ itemType: 'other' })).toBe('Other');
  });

  it('includes the armor category for armor', () => {
    const { treasuryTypeLabel } = load();
    expect(treasuryTypeLabel({ itemType: 'armor', armorType: 'heavy' })).toBe('heavy armor');
  });

  it('falls back to Other for an unknown type', () => {
    expect(load().treasuryTypeLabel({ itemType: 'nonsense' })).toBe('Other');
  });
});

// ── findTreasuryItem ──────────────────────────────────────────────────────────
describe('findTreasuryItem', () => {
  it('finds an item in either segment', () => {
    const { findTreasuryItem } = load({ loot: [lootItem()], shop: [sword()] });
    expect(findTreasuryItem('loot-1').name).toBe('Healing Potion');
    expect(findTreasuryItem('sw-1').name).toBe('Longsword');
  });

  it('returns null for an unknown id', () => {
    expect(load({ loot: [lootItem()] }).findTreasuryItem('nope')).toBeNull();
  });
});

// ── addToCart (shop) ──────────────────────────────────────────────────────────
describe('addToCart', () => {
  const shopCtx = (over = {}) => load({ seg: 'shop', shop: [sword()], ...over });

  it('adds a new item with qty 1', () => {
    const { addToCart, shopCart } = shopCtx();
    addToCart('sw-1');
    expect(shopCart).toHaveLength(1);
    expect(shopCart[0].qty).toBe(1);
    expect(shopCart[0].item.id).toBe('sw-1');
  });

  it('increments qty when item is already in cart', () => {
    const { addToCart, shopCart } = shopCtx();
    addToCart('sw-1');
    addToCart('sw-1');
    expect(shopCart).toHaveLength(1);
    expect(shopCart[0].qty).toBe(2);
  });

  it('does not exceed finite stock quantity', () => {
    const { addToCart, shopCart } = load({ seg: 'shop', shop: [sword({ quantity: 2 })] });
    addToCart('sw-1');
    addToCart('sw-1');
    addToCart('sw-1'); // third push — should be blocked
    expect(shopCart[0].qty).toBe(2);
  });

  it('allows unlimited qty for quantity -1 (infinite)', () => {
    const { addToCart, shopCart } = load({ seg: 'shop', shop: [sword({ quantity: -1 })] });
    for (let i = 0; i < 10; i++) addToCart('sw-1');
    expect(shopCart[0].qty).toBe(10);
  });

  it('does nothing for an unknown item id', () => {
    const { addToCart, shopCart } = shopCtx();
    addToCart('no-such-id');
    expect(shopCart).toHaveLength(0);
  });

  it('does not add a loot item through the shop cart', () => {
    const { addToCart, shopCart } = load({ seg: 'shop', loot: [lootItem()], shop: [] });
    addToCart('loot-1');
    expect(shopCart).toHaveLength(0);
  });
});

// ── removeFromCart ────────────────────────────────────────────────────────────
describe('removeFromCart', () => {
  it('removes the matching item', () => {
    // Use the result object — the shopCart getter reads ctx.shopCart after reassignment
    const r = load({ seg: 'shop', shop: [sword()] });
    r.addToCart('sw-1');
    r.removeFromCart('sw-1');
    expect(r.shopCart).toHaveLength(0);
  });

  it('leaves other items intact', () => {
    const bow = sword({ id: 'bow-1', name: 'Shortbow' });
    const r = load({ seg: 'shop', shop: [sword(), bow] });
    r.addToCart('sw-1');
    r.addToCart('bow-1');
    r.removeFromCart('sw-1');
    expect(r.shopCart).toHaveLength(1);
    expect(r.shopCart[0].item.id).toBe('bow-1');
  });

  it('is a no-op for an id not in cart', () => {
    const r = load({ seg: 'shop', shop: [sword()] });
    r.addToCart('sw-1');
    r.removeFromCart('no-such-id');
    expect(r.shopCart).toHaveLength(1);
  });
});

// ── addToLootCart ─────────────────────────────────────────────────────────────
describe('addToLootCart', () => {
  it('adds a catalog item to the cart', () => {
    const { addToLootCart, lootCart } = load({ loot: [lootItem()] });
    addToLootCart('loot-1');
    expect(lootCart).toHaveLength(1);
    expect(lootCart[0].id).toBe('loot-1');
  });

  it('does not add a duplicate (same id)', () => {
    const { addToLootCart, lootCart } = load({ loot: [lootItem()] });
    addToLootCart('loot-1');
    addToLootCart('loot-1');
    expect(lootCart).toHaveLength(1);
  });

  it('does nothing for an id not in catalog', () => {
    const { addToLootCart, lootCart } = load({ loot: [lootItem()] });
    addToLootCart('no-such-id');
    expect(lootCart).toHaveLength(0);
  });

  it('can add multiple different items', () => {
    const gem = lootItem({ id: 'loot-2', name: 'Ruby' });
    const { addToLootCart, lootCart } = load({ loot: [lootItem(), gem] });
    addToLootCart('loot-1');
    addToLootCart('loot-2');
    expect(lootCart).toHaveLength(2);
  });

  it('does not pull a shop item into the free-loot cart', () => {
    const { addToLootCart, lootCart } = load({ loot: [], shop: [sword()] });
    addToLootCart('sw-1');
    expect(lootCart).toHaveLength(0);
  });
});

// ── removeFromLootCart ────────────────────────────────────────────────────────
describe('removeFromLootCart', () => {
  it('removes the item from the cart', () => {
    const r = load({ loot: [lootItem()] });
    r.addToLootCart('loot-1');
    r.removeFromLootCart('loot-1');
    expect(r.lootCart).toHaveLength(0);
  });

  it('leaves other cart items intact', () => {
    const gem = lootItem({ id: 'loot-2', name: 'Ruby' });
    const r = load({ loot: [lootItem(), gem] });
    r.addToLootCart('loot-1');
    r.addToLootCart('loot-2');
    r.removeFromLootCart('loot-1');
    expect(r.lootCart).toHaveLength(1);
    expect(r.lootCart[0].id).toBe('loot-2');
  });

  it('is a no-op for an id not in cart', () => {
    const r = load({ loot: [lootItem()] });
    r.addToLootCart('loot-1');
    r.removeFromLootCart('no-such-id');
    expect(r.lootCart).toHaveLength(1);
  });
});

// ── renderTreasuryItems — loot segment ────────────────────────────────────────
describe('renderTreasuryItems — loot segment', () => {
  it('shows no-loot message when the catalogue is empty', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('No loot available yet');
  });

  it('renders item name', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Healing Potion');
  });

  it('renders item description', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Restores 2d4+2 HP');
  });

  it('omits the description the DM has not revealed (server sends it blank)', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({
      loot: [lootItem({ description: '', descVisible: false })],
    });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('Restores');
  });

  it('keeps the name and appends the unidentified marker', () => {
    // Shape as the server sends it: real name, no description, zeroed stats.
    const { renderTreasuryItems, itemsBodyEl } = load({
      loot: [lootItem({
        name: 'Healing Potion', unidentified: true, descVisible: false,
        description: '', itemType: 'wondrous', acBonus: 0,
      })],
    });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Healing Potion - (unidentified)');
    expect(itemsBodyEl.innerHTML).toContain('Properties unknown until identified');
  });

  it('does not mark an item unidentified once the description is revealed', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('unidentified');
  });

  it('an identified item with no description shows neither', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({
      loot: [lootItem({ description: '', descVisible: true })],
    });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('unidentified');
    expect(itemsBodyEl.innerHTML).not.toContain('Restores');
  });

  it('shows "✓ Claimed" for already-claimed items', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()], claimedIds: ['loot-1'] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Claimed');
  });

  it('does not show "Claimed" for an unclaimed item', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()], claimedIds: [] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('✓ Claimed');
  });

  it('disables the cart button for items already in cart', () => {
    const { addToLootCart, itemsBodyEl } = load({ loot: [lootItem()] });
    addToLootCart('loot-1');
    expect(itemsBodyEl.innerHTML).toContain('disabled');
    expect(itemsBodyEl.innerHTML).toContain('In Cart');
  });

  it('shows bonuses for a loot item that carries stats', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem({ acBonus: 2 })] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('AC+2');
  });

  it('renders a thumbnail when the item has an image', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({
      loot: [lootItem({ imageThumb: '/uploads/treasury/a_thumb.webp' })],
    });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('tr-thumb');
    expect(itemsBodyEl.innerHTML).toContain('a_thumb.webp');
  });

  it('renders no thumbnail element when there is no image', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem()] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('tr-thumb');
  });

  it('HTML-escapes item names', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ loot: [lootItem({ name: '<script>xss</script>' })] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('<script>');
    expect(itemsBodyEl.innerHTML).toContain('&lt;script&gt;');
  });
});

// ── renderTreasuryItems — shop segment ────────────────────────────────────────
describe('renderTreasuryItems — shop segment', () => {
  it('shows the closed notice when the shop is shut', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'shop', shop: [sword()], shopOpen: false });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('shop is currently closed');
  });

  it('shows empty message when the shop is open but has no stock', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'shop', shop: [] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('The shop is empty');
  });

  it('renders item name and price', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'shop', shop: [sword({ valueCp: 1500 })] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Longsword');
    expect(itemsBodyEl.innerHTML).toContain('15 gp');
  });

  it('shows infinite stock as ∞', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'shop', shop: [sword({ quantity: -1 })] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('∞');
  });

  it('shows finite stock count', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'shop', shop: [sword({ quantity: 3 })] });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('×3');
  });

  it('HTML-escapes item names', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({
      seg: 'shop', shop: [sword({ name: '<script>xss</script>' })],
    });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).not.toContain('<script>');
    expect(itemsBodyEl.innerHTML).toContain('&lt;script&gt;');
  });

  it('free loot stays available while the shop is closed', () => {
    const { renderTreasuryItems, itemsBodyEl } = load({ seg: 'loot', loot: [lootItem()], shopOpen: false });
    renderTreasuryItems();
    expect(itemsBodyEl.innerHTML).toContain('Healing Potion');
    expect(itemsBodyEl.innerHTML).not.toContain('shop is currently closed');
  });
});

// ── renderTreasuryCart — shop segment ─────────────────────────────────────────
describe('renderTreasuryCart — shop, empty cart', () => {
  it('shows empty message', () => {
    const { renderTreasuryCart, cartBodyEl } = load({ seg: 'shop' });
    renderTreasuryCart();
    expect(cartBodyEl.innerHTML).toContain('Cart is empty');
  });

  it('disables the action button', () => {
    const { renderTreasuryCart, actionBtnEl } = load({ seg: 'shop' });
    renderTreasuryCart();
    expect(actionBtnEl.disabled).toBe(true);
  });

  it('clears the total', () => {
    const { renderTreasuryCart, totalEl } = load({ seg: 'shop' });
    renderTreasuryCart();
    expect(totalEl.textContent).toBe('');
  });

  it('labels the button "Purchase All"', () => {
    const { renderTreasuryCart, actionBtnEl } = load({ seg: 'shop' });
    renderTreasuryCart();
    expect(actionBtnEl.textContent).toBe('Purchase All');
  });
});

describe('renderTreasuryCart — shop, with items', () => {
  it('shows item name and qty', () => {
    const { addToCart, cartBodyEl } = load({ seg: 'shop', shop: [sword()] });
    addToCart('sw-1');
    expect(cartBodyEl.innerHTML).toContain('Longsword');
    expect(cartBodyEl.innerHTML).toContain('×1');
  });

  it('shows the subtotal for each item', () => {
    const { addToCart, cartBodyEl } = load({ seg: 'shop', shop: [sword({ valueCp: 1500 })] });
    addToCart('sw-1');
    addToCart('sw-1');
    // 2 × 15 gp = 30 gp
    expect(cartBodyEl.innerHTML).toContain('30 gp');
  });

  it('shows total across all items', () => {
    const bow = sword({ id: 'bow-1', name: 'Shortbow', valueCp: 2500 });
    const { addToCart, totalEl } = load({ seg: 'shop', shop: [sword({ valueCp: 1500 }), bow] });
    addToCart('sw-1');
    addToCart('bow-1');
    // 15 + 25 = 40 gp
    expect(totalEl.textContent).toContain('40 gp');
  });

  it('disables the action button when no character is loaded', () => {
    const { addToCart, actionBtnEl } = load({ seg: 'shop', shop: [sword()], charId: null });
    addToCart('sw-1');
    expect(actionBtnEl.disabled).toBe(true);
  });

  it('enables the action button when a character is loaded', () => {
    const { addToCart, actionBtnEl } = load({ seg: 'shop', shop: [sword()], charId: 'char-1' });
    addToCart('sw-1');
    expect(actionBtnEl.disabled).toBe(false);
  });
});

// ── renderTreasuryCart — loot segment ─────────────────────────────────────────
describe('renderTreasuryCart — loot, empty cart', () => {
  it('shows empty message', () => {
    const { renderTreasuryCart, cartBodyEl } = load();
    renderTreasuryCart();
    expect(cartBodyEl.innerHTML).toContain('Cart is empty');
  });

  it('disables the action button', () => {
    const { renderTreasuryCart, actionBtnEl } = load();
    renderTreasuryCart();
    expect(actionBtnEl.disabled).toBe(true);
  });

  it('labels the button "Claim All"', () => {
    const { renderTreasuryCart, actionBtnEl } = load();
    renderTreasuryCart();
    expect(actionBtnEl.textContent).toBe('Claim All');
  });
});

describe('renderTreasuryCart — loot, with items', () => {
  it('shows item name in cart', () => {
    const { addToLootCart, cartBodyEl } = load({ loot: [lootItem()] });
    addToLootCart('loot-1');
    expect(cartBodyEl.innerHTML).toContain('Healing Potion');
  });

  it('shows no price total for free loot', () => {
    const { addToLootCart, totalEl } = load({ loot: [lootItem()] });
    addToLootCart('loot-1');
    expect(totalEl.textContent).toBe('');
  });

  it('disables the action button when no character is loaded', () => {
    const { addToLootCart, actionBtnEl } = load({ loot: [lootItem()], charId: null });
    addToLootCart('loot-1');
    expect(actionBtnEl.disabled).toBe(true);
  });

  it('enables the action button when a character is loaded', () => {
    const { addToLootCart, actionBtnEl } = load({ loot: [lootItem()], charId: 'char-1' });
    addToLootCart('loot-1');
    expect(actionBtnEl.disabled).toBe(false);
  });

  it('clears the error on each render', () => {
    const { addToLootCart, errEl } = load({ loot: [lootItem()] });
    errEl.textContent = 'old error';
    addToLootCart('loot-1');
    expect(errEl.textContent).toBe('');
  });
});

// ── renderClaimedLoots (Main-tab card) ────────────────────────────────────────
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

  it('marks a held-but-unrevealed loot as unidentified', () => {
    const { renderClaimedLoots, claimedBodyEl } = load({
      claimedLoots: [{ id: 'loot-1', name: 'Potion', description: 'Secret', descVisible: false }],
    });
    renderClaimedLoots();
    expect(claimedBodyEl.innerHTML).toContain('Potion - (unidentified)');
    expect(claimedBodyEl.innerHTML).toContain('Properties unknown until identified');
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
