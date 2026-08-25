// ── Treasury tab (free loot + shop, one screen) ───────────────────────────────
// Replaces the old separate Shop and Loot tabs. A single GET /api/treasury
// feeds both segments; each keeps its own cart because one is free and the
// other charges.
// claimedLoots lives in index-state.js (shared with index-char.js) and still
// backs the "Loots" card on the Main tab — manual entries plus anything claimed
// before the treasury merge.

let treasuryData = { shopOpen: false, activeTag: '', loot: [], shop: [], claimedIds: [] };
let treasurySeg  = localStorage.getItem('treasury-seg') === 'shop' ? 'shop' : 'loot';
let lootCart     = [];
let shopCart     = [];
let treasuryDetailId = null;

function cpToGp(cp) {
  if (!cp) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}

function treasuryHeaders() {
  const h = {};
  if (currentCharId) {
    h['X-Character-Id'] = currentCharId;
    if (charPasswords[currentCharId]) h['X-Character-Password'] = charPasswords[currentCharId];
  }
  return h;
}

function findTreasuryItem(id) {
  return treasuryData.loot.find(i => i.id === id) || treasuryData.shop.find(i => i.id === id) || null;
}

// ── Wallet ───────────────────────────────────────────────────────────────────
// Name kept from the old shop module: index-char.js and index-realtime.js call it.
function renderShopWallet() {
  const el = document.getElementById('shop-wallet');
  if (!el) return;
  if (!currentCharId) { el.textContent = 'Load a character to see wallet.'; return; }
  const cp = parseInt(document.querySelector('[data-key="cp"]')?.value)  || 0;
  const sp = parseInt(document.querySelector('[data-key="sp"]')?.value)  || 0;
  const ep = parseInt(document.querySelector('[data-key="ep"]')?.value)  || 0;
  const gp = parseInt(document.querySelector('[data-key="gp"]')?.value)  || 0;
  const pp = parseInt(document.querySelector('[data-key="pp2"]')?.value) || 0;
  const totalCp = cp + sp * 10 + ep * 50 + gp * 100 + pp * 1000;
  el.textContent = `PP: ${pp}  GP: ${gp}  EP: ${ep}  SP: ${sp}  CP: ${cp}  (≈ ${cpToGp(totalCp)} total)`;
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function loadTreasuryTab() {
  const loading = document.getElementById('treasury-loading');
  if (loading) { loading.style.display = ''; loading.textContent = 'Loading…'; }
  renderShopWallet();
  try {
    const res = await fetch('/api/treasury', { headers: treasuryHeaders() });
    if (!res.ok) throw new Error();
    treasuryData = await res.json();
  } catch {
    if (loading) loading.textContent = 'Failed to load treasury.';
    return;
  }
  if (loading) loading.style.display = 'none';
  // Drop anything that has left the catalogue since the cart was filled.
  lootCart = lootCart.filter(i => treasuryData.loot.some(l => l.id === i.id));
  shopCart = shopCart.filter(e => treasuryData.shop.some(s => s.id === e.item.id));
  renderTreasury();
}
// ── Segment switching ────────────────────────────────────────────────────────
function setTreasurySeg(seg) {
  treasurySeg = seg === 'shop' ? 'shop' : 'loot';
  localStorage.setItem('treasury-seg', treasurySeg);
  renderTreasury();
}

function renderTreasury() {
  document.querySelectorAll('#treasury-seg .seg-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.seg === treasurySeg));
  const walletCard = document.getElementById('treasury-wallet-card');
  if (walletCard) walletCard.style.display = treasurySeg === 'shop' ? '' : 'none';
  const title = document.getElementById('treasury-list-title');
  if (title) title.textContent = treasurySeg === 'shop' ? 'Shop Inventory' : 'Available Loot';
  renderTreasuryItems();
  renderTreasuryCart();
}

// ── Item list ────────────────────────────────────────────────────────────────
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

// An item the DM has not identified arrives already redacted: the server sends
// the real name but no description and neutral zeros for every stat, so there
// is nothing here to hide — only the "(unidentified)" marker to add.
function isUnidentified(item) {
  return item.unidentified === true || item.descVisible === false;
}

function treasuryDisplayName(item) {
  return isUnidentified(item) ? `${item.name || ''} - (unidentified)` : (item.name || '');
}

function treasuryTypeLabel(item) {
  if (item.itemType === 'armor') return `${item.armorType || 'light'} armor`;
  return { weapon: 'Weapon', shield: 'Shield', wondrous: 'Wondrous / Magic Item', other: 'Other' }[item.itemType]
    || 'Other';
}
function unidentifiedHTML() {
  return '<div class="tr-unid">Properties unknown until identified.</div>';
}

function treasuryThumb(item) {
  if (!item.imageThumb) return '';
  return `<img class="tr-thumb" src="${esc(item.imageThumb)}" alt=""
               onclick="event.stopPropagation();openTreasuryImage('${escJs(item.id)}')" title="View image">`;
}

function renderTreasuryItems() {
  const body = document.getElementById('treasury-items-body');
  if (!body) return;

  if (treasurySeg === 'shop' && !treasuryData.shopOpen) {
    body.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--txd);font-size:13px">🔒 The shop is currently closed.</div>';
    return;
  }

  const list = treasurySeg === 'shop' ? treasuryData.shop : treasuryData.loot;
  if (list.length === 0) {
    body.innerHTML = `<div style="color:var(--txd);font-size:11px;padding:4px 0">${
      treasurySeg === 'shop' ? 'The shop is empty.' : 'No loot available yet.'}</div>`;
    return;
  }

  body.innerHTML = list.map(item => {
    const inCart = treasurySeg === 'shop'
      ? shopCart.some(e => e.item.id === item.id)
      : lootCart.some(l => l.id === item.id);
    const claimed = treasuryData.claimedIds.includes(item.id);
    const bonuses = bonusSummary(item);

    if (treasurySeg === 'shop') {
      const qtyText = item.quantity === -1 ? '∞' : `×${item.quantity}`;
      return `<div class="shop-item-row">
        ${treasuryThumb(item)}
        <span class="shop-item-name" style="cursor:pointer;text-decoration:underline dotted"
              onclick="openTreasuryDetail('${escJs(item.id)}')" title="View details">${esc(treasuryDisplayName(item))}</span>
        <span class="shop-item-price">${cpToGp(item.valueCp)}</span>
        <span class="shop-item-qty">Stock: ${qtyText}</span>
        ${bonuses ? `<span class="shop-item-bonuses">${esc(bonuses)}</span>` : ''}
        <button class="add-btn" style="width:auto;padding:3px 10px;margin:0"
                onclick="addToCart('${escJs(item.id)}')">+ Cart</button>
      </div>`;
    }

    return `<div class="shop-item-row" style="align-items:flex-start;flex-wrap:nowrap;gap:8px">
      ${treasuryThumb(item)}
      <div style="flex:1;min-width:0">
        <div class="shop-item-name" style="cursor:pointer;text-decoration:underline dotted"
             onclick="openTreasuryDetail('${escJs(item.id)}')" title="View details">${esc(treasuryDisplayName(item))}</div>
        ${isUnidentified(item)
          ? unidentifiedHTML()
          : item.description
            ? `<div style="font-size:10px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(item.description)}</div>`
            : ''}
        ${bonuses ? `<div class="shop-item-bonuses" style="margin-top:2px">${esc(bonuses)}</div>` : ''}
      </div>
      ${claimed ? '<span style="font-size:10px;color:var(--ok);flex-shrink:0;padding-top:2px">✓ Claimed</span>' : ''}
      <button class="add-btn" style="width:auto;padding:3px 10px;margin:0;flex-shrink:0"
              onclick="addToLootCart('${escJs(item.id)}')" ${inCart ? 'disabled' : ''}>${inCart ? 'In Cart' : '+ Cart'}</button>
    </div>`;
  }).join('');
}

// ── Detail modal (used by both segments) ─────────────────────────────────────
function openTreasuryDetail(id) {
  const item = findTreasuryItem(id);
  if (!item) return;
  treasuryDetailId = id;
  document.getElementById('shop-detail-title').textContent = treasuryDisplayName(item);

  const typeLabel = treasuryTypeLabel(item);
  const forSale = item.mode === 'shop';
  const rows = [['Type', typeLabel]];
  if (forSale) {
    rows.push(['Price', cpToGp(item.valueCp)]);
    rows.push(['Stock', item.quantity === -1 ? '∞' : item.quantity]);
  } else {
    rows.push(['Price', 'Free']);
  }
  // Kind, price and stock are all an unidentified item gives up; every other
  // row would describe properties the player has not learned yet.
  const unknown = isUnidentified(item);
  if (!unknown && item.itemType === 'weapon') {
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic) rows.push(['Magic Bonus', `+${magic}`]);
    if (item.weaponDmg) rows.push(['Damage Dice', item.weaponDmg]);
    if (item.weaponProperties && item.weaponProperties.length) rows.push(['Properties', item.weaponProperties.join(', ')]);
    const atkNote = item.weaponProperties?.includes('Finesse')    ? 'STR or DEX (highest) + Prof + magic bonus'
                  : item.weaponProperties?.includes('Ammunition') ? 'DEX + Prof + magic bonus'
                  : 'STR + Prof + magic bonus';
    rows.push(['ATK Calc', atkNote]);
  }
  if (!unknown && item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',         (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus', (item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',      (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  if (item.requiresAttunement) rows.push(['Attunement', 'Required']);

  let html = '';
  if (item.imageMedium || item.imageUrl) {
    html += `<img src="${esc(item.imageMedium || item.imageUrl)}" alt=""
                  style="width:100%;max-height:260px;object-fit:contain;border-radius:5px;margin-bottom:10px;cursor:zoom-in"
                  onclick="openTreasuryImage('${escJs(item.id)}')">`;
  }
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    rows.map(([k, v]) =>
      `<tr><td style="padding:4px 6px;color:var(--txd);width:42%">${k}</td><td style="padding:4px 6px;font-weight:bold">${esc(String(v))}</td></tr>`
    ).join('') + '</table>';
  if (unknown) {
    html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Description</div>
      <div class="tr-unid">This ${esc(typeLabel.toLowerCase())} has not been identified — its properties are unknown.</div></div>`;
  } else if (item.description) {
    html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Description</div>
      <div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(item.description)}</div></div>`;
  }
  document.getElementById('shop-detail-body').innerHTML = html;

  const cartBtn = document.getElementById('shop-detail-cart-btn');
  const claimed = treasuryData.claimedIds.includes(item.id);
  const outOfStock = forSale && item.quantity === 0;
  cartBtn.disabled = outOfStock || (!forSale && claimed);
  cartBtn.textContent = outOfStock ? 'Out of Stock'
                      : (!forSale && claimed) ? 'Already Claimed'
                      : '+ Add to Cart';
  document.getElementById('shop-detail-modal').style.display = 'flex';
}

function closeShopDetail() {
  document.getElementById('shop-detail-modal').style.display = 'none';
  treasuryDetailId = null;
}

function addToCartFromDetail() {
  const item = treasuryDetailId && findTreasuryItem(treasuryDetailId);
  if (item) (item.mode === 'shop' ? addToCart : addToLootCart)(item.id);
  closeShopDetail();
}

// Full-size image via the shared lightbox (js/lib/lightbox.js).
function openTreasuryImage(id) {
  const item = findTreasuryItem(id);
  if (item && (item.imageUrl || item.imageMedium)) lightboxOpen(item.imageUrl || item.imageMedium, 'image/*');
}

// ── Carts ────────────────────────────────────────────────────────────────────
function addToLootCart(id) {
  const item = treasuryData.loot.find(i => i.id === id);
  if (!item || lootCart.some(l => l.id === id)) return;
  lootCart.push(item);
  renderTreasuryItems();
  renderTreasuryCart();
}
function removeFromLootCart(id) {
  lootCart = lootCart.filter(l => l.id !== id);
  renderTreasuryItems();
  renderTreasuryCart();
}
function addToCart(id) {
  const item = treasuryData.shop.find(i => i.id === id);
  if (!item) return;
  const existing = shopCart.find(e => e.item.id === id);
  const maxQty = item.quantity === -1 ? Infinity : item.quantity;
  if (existing) { if (existing.qty < maxQty) existing.qty++; }
  else shopCart.push({ item, qty: 1 });
  renderTreasuryItems();
  renderTreasuryCart();
}
function removeFromCart(id) {
  shopCart = shopCart.filter(e => e.item.id !== id);
  renderTreasuryItems();
  renderTreasuryCart();
}

function renderTreasuryCart() {
  const body    = document.getElementById('treasury-cart-body');
  const totalEl = document.getElementById('treasury-cart-total');
  const btn     = document.getElementById('treasury-action-btn');
  const errEl   = document.getElementById('treasury-err');
  if (!body) return;
  if (errEl) errEl.textContent = '';

  if (treasurySeg === 'shop') {
    btn.textContent = 'Purchase All';
    if (shopCart.length === 0) {
      body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "+ Cart" on items above.</div>';
      totalEl.textContent = '';
      btn.disabled = true;
      return;
    }
    let totalCp = 0;
    body.innerHTML = shopCart.map(e => {
      const subtotal = e.item.valueCp * e.qty;
      totalCp += subtotal;
      return `<div class="shop-cart-row">
        <span class="shop-cart-name">${esc(e.item.name)} ×${e.qty}</span>
        <span class="shop-cart-subtotal">${cpToGp(subtotal)}</span>
        <button class="del-btn" onclick="removeFromCart('${escJs(e.item.id)}')">✕</button>
      </div>`;
    }).join('');
    totalEl.textContent = `Total: ${cpToGp(totalCp)}`;
    btn.disabled = !currentCharId;
    return;
  }

  btn.textContent = 'Claim All';
  totalEl.textContent = '';
  if (lootCart.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "+ Cart" on items above.</div>';
    btn.disabled = true;
    return;
  }
  body.innerHTML = lootCart.map(item => `<div class="shop-cart-row">
    <span class="shop-cart-name">${esc(item.name)}</span>
    <button class="del-btn" onclick="removeFromLootCart('${escJs(item.id)}')">✕</button>
  </div>`).join('');
  btn.disabled = !currentCharId;
}

function treasuryAction() {
  return treasurySeg === 'shop' ? purchaseCart() : claimLoot();
}

async function claimLoot() {
  if (!currentCharId || lootCart.length === 0) return;
  const errEl = document.getElementById('treasury-err');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/treasury/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...treasuryHeaders() },
      body: JSON.stringify({ charId: currentCharId, items: lootCart.map(i => ({ id: i.id })) }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Claim failed.'; return; }
    lootCart = [];
    await loadCharacter(currentCharId);
    await loadTreasuryTab();
    setStatus('Loot claimed!', false);
  } catch { errEl.textContent = 'Network error.'; }
}

async function purchaseCart() {
  if (!currentCharId || shopCart.length === 0) return;
  const errEl = document.getElementById('treasury-err');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/treasury/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...treasuryHeaders() },
      body: JSON.stringify({ charId: currentCharId, items: shopCart.map(e => ({ itemId: e.item.id, qty: e.qty })) }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Purchase failed.'; return; }
    shopCart = [];
    await loadCharacter(currentCharId);
    await loadTreasuryTab();
    setStatus('Purchase complete!', false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Claimed loots card (Main tab) ────────────────────────────────────────────
// Still backed by the character's _loots list: manual entries the player types
// in, plus anything claimed before the treasury merge. Treasury claims now land
// in the Items tab instead.
function renderClaimedLoots() {
  const body = document.getElementById('claimed-loots-body');
  if (!body) return;
  if (!claimedLoots || claimedLoots.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">No loots claimed yet.</div>';
    return;
  }
  body.innerHTML = claimedLoots.map((l, i) => `<div style="padding:6px 0;display:flex;align-items:flex-start;gap:8px;${i < claimedLoots.length - 1 ? 'border-bottom:1px solid var(--sep)' : ''}">
    <div style="flex:1;min-width:0">
      <div style="font-weight:bold;font-size:12px">${esc(treasuryDisplayName(l))}</div>
      ${l.descVisible === false
        ? unidentifiedHTML()
        : l.description
          ? `<div style="font-size:11px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(l.description)}</div>`
          : ''}
    </div>
    <button class="del-btn" onclick="removeLoot(${i})" title="Remove loot">✕</button>
  </div>`).join('');
}

// A description the DM reveals after the fact has to reach items the player
// already holds — both legacy _loots entries and real inventory items, which
// are matched back to their catalogue entry through srcId.
async function syncLootDescVisibility() {
  // `items` is the shared inventory array from index-state.js.
  const sourced = (items || []).filter(i => i && i.srcId);
  const hasLoots = claimedLoots && claimedLoots.length > 0;
  if (!hasLoots && sourced.length === 0) return;

  try {
    const res = await fetch('/api/treasury/visibility');
    if (!res.ok) return;
    const map = await res.json();

    let lootsChanged = false;
    for (const l of (claimedLoots || [])) {
      const m = map[l.id];
      if (!m) continue;
      if (l.descVisible !== m.descVisible || (m.descVisible && l.description !== m.description)) {
        l.descVisible = m.descVisible;
        if (m.descVisible) l.description = m.description;
        lootsChanged = true;
      }
    }
    if (lootsChanged) renderClaimedLoots();

    let itemsChanged = false;
    for (const it of sourced) {
      const m = map[it.srcId];
      if (!m) continue;
      const want = m.descVisible ? m.description : '';
      // Only touch notes the treasury itself wrote — an empty field, or text
      // still matching the catalogue. Anything the player typed is left alone.
      const untouched = !it.notes || it.notes === m.description;
      if (it.notes !== want && untouched) { it.notes = want; itemsChanged = true; }
    }
    if (itemsChanged) {
      if (typeof renderItems === 'function') renderItems();
      scheduleAutoSave();
    }
  } catch {}
}

function removeLoot(index) {
  claimedLoots.splice(index, 1);
  renderClaimedLoots();
  scheduleAutoSave();
}

function openLootAddModal() {
  document.getElementById('loot-add-name').value = '';
  document.getElementById('loot-add-desc').value = '';
  document.getElementById('loot-add-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('loot-add-name').focus(), 50);
}
function closeLootAddModal() {
  document.getElementById('loot-add-modal').style.display = 'none';
}
function confirmLootAdd() {
  const name = document.getElementById('loot-add-name').value.trim();
  if (!name) return;
  const description = document.getElementById('loot-add-desc').value.trim();
  claimedLoots.push({ id: 'manual-' + Date.now(), name, description });
  renderClaimedLoots();
  closeLootAddModal();
  scheduleAutoSave();
}
