// ── Loot tab ──────────────────────────────────────────────────────────────────
let lootCatalog = [];
let lootCart    = [];
// claimedLoots is in index-state.js (also used by index-char.js)

async function loadLootTab() {
  document.getElementById('loot-loading').style.display = '';
  document.getElementById('loot-loading').textContent = 'Loading…';
  document.getElementById('loot-items-body').innerHTML = '';
  try {
    const res = await fetch('/api/loot');
    if (!res.ok) throw new Error();
    lootCatalog = await res.json();
  } catch {
    document.getElementById('loot-loading').textContent = 'Failed to load loot.';
    return;
  }
  document.getElementById('loot-loading').style.display = 'none';
  renderLootItems();
}

function renderLootItems() {
  const body = document.getElementById('loot-items-body');
  if (lootCatalog.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No loot available yet.</div>';
    return;
  }
  body.innerHTML = lootCatalog.map(item => {
    const alreadyClaimed = claimedLoots.some(l => l.id === item.id);
    const inCart = lootCart.some(l => l.id === item.id);
    return `<div class="shop-item-row" style="align-items:flex-start;flex-wrap:nowrap;gap:8px">
      <div style="flex:1;min-width:0">
        <div class="shop-item-name">${esc(item.name)}</div>
        ${item.description ? `<div style="font-size:10px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(item.description)}</div>` : ''}
      </div>
      ${alreadyClaimed ? `<span style="font-size:10px;color:var(--ok);flex-shrink:0;padding-top:2px">✓ Claimed</span>` : ''}
      <button class="add-btn" style="width:auto;padding:3px 10px;margin:0;flex-shrink:0" onclick="addToLootCart('${item.id}')" ${inCart ? 'disabled' : ''}>${inCart ? 'In Cart' : '+ Cart'}</button>
    </div>`;
  }).join('');
}

function addToLootCart(id) {
  const item = lootCatalog.find(i => i.id === id);
  if (!item || lootCart.some(l => l.id === id)) return;
  lootCart.push(item);
  renderLootItems();
  renderLootCart();
}

function removeFromLootCart(id) {
  lootCart = lootCart.filter(l => l.id !== id);
  renderLootItems();
  renderLootCart();
}

function renderLootCart() {
  const body = document.getElementById('loot-cart-body');
  const claimBtn = document.getElementById('loot-claim-btn');
  document.getElementById('loot-claim-err').textContent = '';
  if (lootCart.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">Cart is empty — click "+ Cart" on items above.</div>';
    claimBtn.disabled = true;
    return;
  }
  body.innerHTML = lootCart.map(item => `<div class="shop-cart-row">
    <span class="shop-cart-name">${esc(item.name)}</span>
    <button class="del-btn" onclick="removeFromLootCart('${item.id}')">✕</button>
  </div>`).join('');
  claimBtn.disabled = !currentCharId;
}

async function claimLoot() {
  if (!currentCharId || lootCart.length === 0) return;
  const errEl = document.getElementById('loot-claim-err');
  errEl.textContent = '';
  const headers = { 'Content-Type': 'application/json' };
  if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
  try {
    const res = await fetch('/api/loot/claim', {
      method: 'POST', headers,
      body: JSON.stringify({ charId: currentCharId, items: lootCart.map(i => ({ id: i.id, name: i.name, description: i.description })) })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Claim failed.'; return; }
    lootCart = [];
    renderLootCart();
    await loadCharacter(currentCharId);
    setStatus('Loot claimed!', false);
  } catch { errEl.textContent = 'Network error.'; }
}

function renderClaimedLoots() {
  const body = document.getElementById('claimed-loots-body');
  if (!body) return;
  if (!claimedLoots || claimedLoots.length === 0) {
    body.innerHTML = '<div style="color:var(--txd);font-size:11px">No loots claimed yet.</div>';
    return;
  }
  body.innerHTML = claimedLoots.map((l, i) => `<div style="padding:6px 0;display:flex;align-items:flex-start;gap:8px;${i < claimedLoots.length - 1 ? 'border-bottom:1px solid var(--sep)' : ''}">
    <div style="flex:1;min-width:0">
      <div style="font-weight:bold;font-size:12px">${esc(l.name)}</div>
      ${l.descVisible !== false && l.description ? `<div style="font-size:11px;color:var(--txd);margin-top:2px;white-space:pre-wrap">${esc(l.description)}</div>` : ''}
    </div>
    <button class="del-btn" onclick="removeLoot(${i})" title="Remove loot">✕</button>
  </div>`).join('');
}

async function syncLootDescVisibility() {
  if (!claimedLoots || claimedLoots.length === 0) return;
  try {
    const res = await fetch('/api/loot/visibility');
    if (!res.ok) return;
    const map = await res.json();
    let changed = false;
    for (const l of claimedLoots) {
      if (map[l.id] !== undefined) {
        const newDescVisible = map[l.id].descVisible;
        const newDesc = map[l.id].description;
        if (l.descVisible !== newDescVisible || (newDescVisible && l.description !== newDesc)) {
          l.descVisible = newDescVisible;
          if (newDescVisible) l.description = newDesc;
          changed = true;
        }
      }
    }
    if (changed) renderClaimedLoots();
  } catch {}
}

function removeLoot(index) {
  claimedLoots.splice(index, 1);
  renderClaimedLoots();
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
}
