// ── Shop ──────────────────────────────────────────────────────────────────────
let shopCatalog  = [];
let shopCart     = [];
let shopDetailId = null;

function cpToGp(cp) {
  if (cp === 0) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}

function renderShopWallet() {
  const el = document.getElementById('shop-wallet');
  if (!el) return;
  if (!currentCharId) { el.textContent = 'Load a character to see wallet.'; return; }
  const cp  = parseInt(document.querySelector('[data-key="cp"]')?.value)  || 0;
  const sp  = parseInt(document.querySelector('[data-key="sp"]')?.value)  || 0;
  const ep  = parseInt(document.querySelector('[data-key="ep"]')?.value)  || 0;
  const gp  = parseInt(document.querySelector('[data-key="gp"]')?.value)  || 0;
  const pp  = parseInt(document.querySelector('[data-key="pp2"]')?.value) || 0;
  const totalCp = cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000;
  el.textContent = `PP: ${pp}  GP: ${gp}  EP: ${ep}  SP: ${sp}  CP: ${cp}  (≈ ${cpToGp(totalCp)} total)`;
}

async function loadShopTab() {
  document.getElementById('shop-loading').style.display = '';
  document.getElementById('shop-loading').textContent = 'Loading…';
  document.getElementById('shop-items-body').innerHTML = '';
  renderShopWallet();
  try {
    const res = await fetch('/api/shop');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.isOpen) {
      document.getElementById('shop-loading').style.display = 'none';
      document.getElementById('shop-items-body').innerHTML =
        '<div style="text-align:center;padding:32px 0;color:var(--txd);font-size:13px">🔒 The shop is currently closed.</div>';
      shopCatalog = [];
      shopCart = [];
      renderCart();
      return;
    }
    shopCatalog = data.items;
  } catch {
    document.getElementById('shop-loading').textContent = 'Failed to load shop.';
    return;
  }
  document.getElementById('shop-loading').style.display = 'none';
  renderShopItems();
}

function bonusSummary(item) {
  if (item.itemType === 'weapon') {
    const parts = [];
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic > 0) parts.push(`+${magic}`);
    if (item.weaponDmg) parts.push(item.weaponDmg);
    if (item.weaponProperties && item.weaponProperties.length) parts.push(item.weaponProperties.join(', '));
    return parts.join(' | ');
  }
  const parts = [];
  if (item.acBonus)    parts.push(`AC+${item.acBonus}`);
  if (item.initBonus)  parts.push(`Init+${item.initBonus}`);
  if (item.speedBonus) parts.push(`Spd+${item.speedBonus}`);
  if (item.requiresAttunement) parts.push('Attune');
  return parts.join(' ');
}

function renderShopItems() {
  const body = document.getElementById('shop-items-body');
  if (shopCatalog.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">The shop is empty.</div>';
    return;
  }
  body.innerHTML = shopCatalog.map(item => {
    const bonuses = bonusSummary(item);
    const qtyText = item.quantity === -1 ? '∞' : `×${item.quantity}`;
    return `<div class="shop-item-row">
      <span class="shop-item-name" style="cursor:pointer;text-decoration:underline dotted" onclick="openShopDetail('${item.id}')" title="View details">${esc(item.name)}</span>
      <span class="shop-item-price">${cpToGp(item.valueCp)}</span>
      <span class="shop-item-qty">Stock: ${qtyText}</span>
      ${bonuses ? `<span class="shop-item-bonuses">${esc(bonuses)}</span>` : ''}
      ${item.notes ? `<span class="shop-item-bonuses" style="flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.notes)}">${esc(item.notes)}</span>` : ''}
      <button class="add-btn" style="width:auto;padding:3px 10px;margin:0" onclick="addToCart('${item.id}')">+ Cart</button>
    </div>`;
  }).join('');
}

function openShopDetail(shopItemId) {
  const item = shopCatalog.find(i => i.id === shopItemId);
  if (!item) return;
  shopDetailId = shopItemId;
  document.getElementById('shop-detail-title').textContent = item.name;
  const typeLabel = item.itemType === 'armor'    ? `${item.armorType} armor`
                  : item.itemType === 'shield'   ? 'Shield'
                  : item.itemType === 'weapon'   ? 'Weapon'
                  : item.itemType === 'wondrous' ? 'Wondrous / Magic Item'
                  : 'Other';
  const qtyText = item.quantity === -1 ? '∞' : item.quantity;
  const rows = [['Type', typeLabel], ['Price', cpToGp(item.valueCp)], ['Stock', qtyText]];
  if (item.itemType === 'weapon') {
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic) rows.push(['Magic Bonus', `+${magic}`]);
    if (item.weaponDmg) rows.push(['Damage Dice', item.weaponDmg]);
    if (item.weaponProperties && item.weaponProperties.length)
      rows.push(['Properties', item.weaponProperties.join(', ')]);
    const atkNote = item.weaponProperties && item.weaponProperties.includes('Finesse')
      ? 'STR or DEX (highest) + Prof + magic bonus'
      : item.weaponProperties && item.weaponProperties.includes('Ammunition')
      ? 'DEX + Prof + magic bonus'
      : 'STR + Prof + magic bonus';
    rows.push(['ATK Calc', atkNote]);
  }
  if (item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',         (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus', (item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',      (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  if (item.requiresAttunement) rows.push(['Attunement', 'Required']);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">` +
    rows.map(([k, v]) =>
      `<tr><td style="padding:4px 6px;color:var(--txd);width:42%">${k}</td><td style="padding:4px 6px;font-weight:bold">${esc(String(v))}</td></tr>`
    ).join('') + `</table>`;
  if (item.notes) html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Description</div><div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(item.notes)}</div></div>`;
  document.getElementById('shop-detail-body').innerHTML = html;
  const cartBtn = document.getElementById('shop-detail-cart-btn');
  const outOfStock = item.quantity === 0;
  cartBtn.disabled = outOfStock;
  cartBtn.textContent = outOfStock ? 'Out of Stock' : '+ Add to Cart';
  document.getElementById('shop-detail-modal').style.display = 'flex';
}

function closeShopDetail() {
  document.getElementById('shop-detail-modal').style.display = 'none';
  shopDetailId = null;
}

function addToCartFromDetail() {
  if (shopDetailId !== null) addToCart(shopDetailId);
  closeShopDetail();
}

function addToCart(shopItemId) {
  const item = shopCatalog.find(i => i.id === shopItemId);
  if (!item) return;
  const existing = shopCart.find(e => e.shopItem.id === shopItemId);
  const maxQty = item.quantity === -1 ? Infinity : item.quantity;
  if (existing) {
    if (existing.qty < maxQty) existing.qty++;
  } else {
    shopCart.push({ shopItem: item, qty: 1 });
  }
  renderCart();
}

function removeFromCart(shopItemId) {
  shopCart = shopCart.filter(e => e.shopItem.id !== shopItemId);
  renderCart();
}

function renderCart() {
  const body = document.getElementById('shop-cart-body');
  const totalEl = document.getElementById('shop-cart-total');
  const buyBtn = document.getElementById('shop-buy-btn');
  document.getElementById('shop-purchase-err').textContent = '';
  if (shopCart.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "Add to Cart" on items above.</div>';
    totalEl.textContent = '';
    buyBtn.disabled = true;
    return;
  }
  let totalCp = 0;
  body.innerHTML = shopCart.map(e => {
    const subtotal = e.shopItem.valueCp * e.qty;
    totalCp += subtotal;
    return `<div class="shop-cart-row">
      <span class="shop-cart-name">${esc(e.shopItem.name)} ×${e.qty}</span>
      <span class="shop-cart-subtotal">${cpToGp(subtotal)}</span>
      <button class="del-btn" onclick="removeFromCart('${e.shopItem.id}')">✕</button>
    </div>`;
  }).join('');
  totalEl.textContent = `Total: ${cpToGp(totalCp)}`;
  buyBtn.disabled = !currentCharId;
}

async function purchaseCart() {
  if (!currentCharId || shopCart.length === 0) return;
  const errEl = document.getElementById('shop-purchase-err');
  errEl.textContent = '';
  const headers = { 'Content-Type': 'application/json' };
  if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
  try {
    const res = await fetch('/api/shop/purchase', {
      method: 'POST', headers,
      body: JSON.stringify({
        charId: currentCharId,
        items: shopCart.map(e => ({ shopItemId: e.shopItem.id, qty: e.qty }))
      })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Purchase failed.'; return; }
    shopCart = [];
    renderCart();
    await loadCharacter(currentCharId);
    await loadShopTab();
    setStatus('Purchase complete!', false);
  } catch {
    errEl.textContent = 'Network error.';
  }
}
