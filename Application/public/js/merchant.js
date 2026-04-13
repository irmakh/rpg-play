
let masterPw = '';
let shopItems = [];
let editingShopId = null;
let shopIsOpen = true;
let selectedItems = new Set();
let tagKeysList = [];
let expandedTags = new Set(JSON.parse(localStorage.getItem('shop-expanded-tags') || '[]'));

function saveExpandedTags() { localStorage.setItem('shop-expanded-tags', JSON.stringify([...expandedTags])); }
function toggleTag(tag) {
  if (expandedTags.has(tag)) expandedTags.delete(tag); else expandedTags.add(tag);
  saveExpandedTags(); renderTable();
}
function toggleItemSelection(id) {
  if (selectedItems.has(id)) selectedItems.delete(id); else selectedItems.add(id);
  updateBulkBar(); renderTable();
}
function toggleGroupSelection(tag) {
  const group = shopItems.filter(i => (i.tag || '') === tag);
  const allSel = group.every(i => selectedItems.has(i.id));
  group.forEach(i => allSel ? selectedItems.delete(i.id) : selectedItems.add(i.id));
  updateBulkBar(); renderTable();
}
function clearSelection() { selectedItems.clear(); updateBulkBar(); renderTable(); }
function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const cnt = document.getElementById('bulk-count');
  if (!bar) return;
  bar.classList.toggle('visible', selectedItems.size > 0);
  if (cnt) cnt.textContent = `${selectedItems.size} selected`;
}
async function applyBulkTag() {
  const tag = document.getElementById('bulk-tag').value.trim();
  const ids = [...selectedItems];
  if (ids.length === 0) { showStatus('No items selected.', true); return; }
  try {
    const res = await fetch('/api/shop/bulk-update-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ ids, tag })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to apply tag.', true); return; }
    showStatus(`Tag applied to ${ids.length} item${ids.length !== 1 ? 's' : ''}.`, false);
    clearSelection();
    await loadShopItems();
  } catch { showStatus('Network error.', true); }
}
async function bulkDeleteSelected() {
  const ids = [...selectedItems];
  if (ids.length === 0) { showStatus('No items selected.', true); return; }
  if (!confirm(`Delete ${ids.length} item${ids.length !== 1 ? 's' : ''}?`)) return;
  try {
    await Promise.all(ids.map(id => fetch(`/api/shop/${id}`, { method: 'DELETE', headers: { 'X-Master-Password': masterPw } })));
    showStatus(`${ids.length} item${ids.length !== 1 ? 's' : ''} deleted.`, false);
    clearSelection();
    await loadShopItems();
  } catch { showStatus('Network error.', true); }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('merchant-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('merchant-theme') || 'dark-gold'); })();

function cpToDenominations(cp) {
  let r = cp;
  const pp = Math.floor(r / 1000); r -= pp * 1000;
  const gp = Math.floor(r / 100);  r -= gp * 100;
  const ep = Math.floor(r / 50);   r -= ep * 50;
  const sp = Math.floor(r / 10);   r -= sp * 10;
  return { pp, gp, ep, sp, cp: r };
}

function getPriceCp() {
  return (parseInt(document.getElementById('f-pp').value) || 0) * 1000
       + (parseInt(document.getElementById('f-gp').value) || 0) * 100
       + (parseInt(document.getElementById('f-ep').value) || 0) * 50
       + (parseInt(document.getElementById('f-sp').value) || 0) * 10
       + (parseInt(document.getElementById('f-cp').value) || 0);
}

function updatePricePreview() {
  const total = getPriceCp();
  const el = document.getElementById('price-preview');
  if (total === 0) { el.textContent = ''; return; }
  const parts = [];
  if (total >= 100) parts.push(`${(total / 100).toFixed(total % 100 === 0 ? 0 : 2)} gp total`);
  else if (total >= 10) parts.push(`${(total / 10).toFixed(total % 10 === 0 ? 0 : 1)} sp total`);
  else parts.push(`${total} cp total`);
  el.textContent = '≈ ' + parts[0];
}

function cpToGp(cp) {
  if (cp === 0) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}

function renderShopStatusBtn() {
  const btn = document.getElementById('shop-status-btn');
  if (!btn) return;
  if (shopIsOpen) {
    btn.textContent = '🟢 Shop Open';
    btn.style.color = 'var(--ok)';
    btn.style.borderColor = '#88ff8844';
  } else {
    btn.textContent = '🔴 Shop Closed';
    btn.style.color = 'var(--err)';
    btn.style.borderColor = '#ff888844';
  }
}

async function loadShopStatus() {
  try {
    const res = await fetch('/api/shop/status', { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) return;
    shopIsOpen = (await res.json()).isOpen;
    renderShopStatusBtn();
  } catch {}
}

async function toggleShopStatus() {
  const newState = !shopIsOpen;
  try {
    const res = await fetch('/api/shop/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ isOpen: newState })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to update shop status.', true); return; }
    shopIsOpen = newState;
    renderShopStatusBtn();
    showStatus(newState ? 'Shop is now open.' : 'Shop is now closed.', false);
  } catch { showStatus('Network error.', true); }
}

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

function showMerchantTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'logs') loadLogs();
}

async function refreshAll() {
  await loadShopItems();
  const logsActive = document.getElementById('tab-logs').classList.contains('active');
  if (logsActive) await loadLogs();
  showStatus('Refreshed.', false);
}

function handleUnauth() {
  masterPw = '';
  document.getElementById('gate').style.display = '';
  document.getElementById('main-content').style.display = 'none';
}

async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  const errEl = document.getElementById('gate-err');
  if (!pw) { errEl.textContent = 'Enter the master password.'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch('/api/shop/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    shopItems = await res.json();
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    document.getElementById('shop-loading').style.display = 'none';
    renderTable();
    await loadShopStatus();
  } catch { errEl.textContent = 'Connection error.'; }
}

async function loadShopItems() {
  try {
    const res = await fetch('/api/shop/all', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to reload items.', true); return; }
    shopItems = await res.json();
    renderTable();
  } catch { showStatus('Network error.', true); }
}

async function loadLogs() {
  const loadEl = document.getElementById('logs-loading');
  const tbody = document.getElementById('logs-tbody');
  loadEl.style.display = '';
  try {
    const res = await fetch('/api/shop/logs', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to load logs.', true); return; }
    const logs = await res.json();
    loadEl.style.display = 'none';
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--txd);padding:12px;font-size:11px">No purchases yet.</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const dt = new Date(l.purchasedAt);
      const dateStr = dt.toLocaleDateString();
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td style="white-space:nowrap;color:var(--txd);font-size:11px">${dateStr} ${timeStr}</td>
        <td><strong>${esc(l.charName)}</strong></td>
        <td>${esc(l.itemName)}</td>
        <td style="text-align:center">${l.qty}</td>
        <td style="color:var(--exp);white-space:nowrap">${cpToGp(l.totalCp)}</td>
      </tr>`;
    }).join('');
  } catch { showStatus('Network error.', true); loadEl.style.display = 'none'; }
}

function bonusSummary(item) {
  if (item.itemType === 'weapon') {
    const parts = [];
    const magic = parseInt(item.weaponAtk) || 0;
    if (magic > 0) parts.push(`+${magic} magic`);
    if (item.weaponDmg) parts.push(item.weaponDmg);
    if (item.weaponProperties && item.weaponProperties.length) parts.push(item.weaponProperties.join(', '));
    return parts.join(' | ') || '—';
  }
  const parts = [];
  if (item.acBonus)    parts.push(`AC+${item.acBonus}`);
  if (item.initBonus)  parts.push(`Init+${item.initBonus}`);
  if (item.speedBonus) parts.push(`Spd+${item.speedBonus}`);
  if (item.requiresAttunement) parts.push('Attune');
  return parts.join(' ') || '—';
}

function renderTable() {
  const container = document.getElementById('shop-groups');
  const emptyMsg = document.getElementById('empty-msg');
  if (shopItems.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = '';
    return;
  }
  emptyMsg.style.display = 'none';

  // Group by tag
  const groups = {};
  for (const item of shopItems) {
    const tag = item.tag || '';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(item);
  }

  // Sort: named tags alphabetically, untagged last
  tagKeysList = Object.keys(groups).sort((a, b) => {
    if (!a && b) return 1; if (a && !b) return -1; return a.localeCompare(b);
  });

  // Populate tag autocomplete datalists
  const tagOpts = tagKeysList.filter(t => t).map(t => `<option value="${esc(t)}">`).join('');
  const dl = document.getElementById('tag-datalist');
  if (dl) dl.innerHTML = tagOpts;
  const dlBulk = document.getElementById('tag-datalist-bulk');
  if (dlBulk) dlBulk.innerHTML = tagOpts;

  container.innerHTML = tagKeysList.map(tag => {
    const items = groups[tag];
    const label = tag || 'Untagged';
    const isOpen = expandedTags.has(tag);
    const allSel = items.every(i => selectedItems.has(i.id));
    const tagAttr = esc(JSON.stringify(tag));

    const rows = items.map(item => {
      const qtyText = item.quantity === -1 ? '∞' : item.quantity;
      const qtyStyle = item.quantity === 0 ? 'color:var(--err)' : '';
      const checked = selectedItems.has(item.id) ? 'checked' : '';
      return `<tr>
        <td style="width:28px"><input type="checkbox" ${checked} onchange="toggleItemSelection('${item.id}')" style="accent-color:var(--ac)"></td>
        <td><strong>${esc(item.name)}</strong></td>
        <td style="color:var(--txd)">${esc(item.itemType)}</td>
        <td style="color:var(--exp)">${cpToGp(item.valueCp)}</td>
        <td style="${qtyStyle}">${qtyText}</td>
        <td style="color:var(--txd);font-size:11px">${esc(bonusSummary(item))}</td>
        <td style="color:var(--txd);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.notes)}">${esc(item.notes) || '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn sm" onclick="openItemModal('${item.id}')" style="margin-right:4px">Edit</button>
          <button class="btn sm danger" onclick="deleteItem('${item.id}')">Delete</button>
        </td>
      </tr>`;
    }).join('');

    return `<div class="tag-group">
      <div class="tag-hdr" onclick="toggleTag(${tagAttr})">
        <span style="margin-right:6px">${isOpen ? '▼' : '▶'}</span>
        <input type="checkbox" ${allSel ? 'checked' : ''} onclick="event.stopPropagation();toggleGroupSelection(${tagAttr})" style="accent-color:var(--ac);margin-right:8px" title="Select all in group">
        <span>${esc(label)}</span>
        <span style="margin-left:8px;font-size:11px;color:var(--txd);font-weight:normal">${items.length} item${items.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="tag-body${isOpen ? ' open' : ''}">
        <table style="width:100%">
          <thead><tr>
            <th style="width:28px"></th><th>Name</th><th>Type</th><th>Price</th>
            <th>Qty</th><th>Bonuses</th><th>Notes</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

const WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

function propId(p) { return 'prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase(); }

function initPropsGrid() {
  const grid = document.getElementById('props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = WEAPON_PROPS.map(p =>
    `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px">
      <input type="checkbox" id="${propId(p)}" value="${p}" onchange="onPropChange()" style="width:13px;height:13px;accent-color:var(--ac)">
      ${p}
    </label>`
  ).join('');
}

function getSelectedProps() {
  return WEAPON_PROPS.filter(p => { const el = document.getElementById(propId(p)); return el && el.checked; });
}

function setSelectedProps(props) {
  WEAPON_PROPS.forEach(p => {
    const el = document.getElementById(propId(p));
    if (el) el.checked = Array.isArray(props) && props.includes(p);
  });
  updatePropsLimit();
}

function onPropChange() {
  const selected = getSelectedProps();
  if (selected.length > 3) {
    // Uncheck the one just clicked by finding the newly-checked box
    const all = WEAPON_PROPS.filter(p => { const el = document.getElementById(propId(p)); return el && el.checked; });
    // Disable the overflow — find last checked and uncheck it
    document.getElementById(propId(selected[selected.length - 1])).checked = false;
  }
  updatePropsLimit();
}

function updatePropsLimit() {
  const selected = getSelectedProps();
  const atMax = selected.length >= 3;
  WEAPON_PROPS.forEach(p => {
    const el = document.getElementById(propId(p));
    if (el) el.disabled = atMax && !el.checked;
  });
  document.getElementById('f-props-err').textContent = atMax ? 'Maximum 3 properties selected.' : '';
}

function onTypeChange() {
  const type = document.getElementById('f-type').value;
  document.getElementById('armor-fields').style.display = type === 'armor' ? 'block' : 'none';
  document.getElementById('weapon-fields').style.display = type === 'weapon' ? 'block' : 'none';
  if (type === 'weapon') initPropsGrid();
}

function openItemModal(id) {
  editingShopId = id;
  document.getElementById('item-err').textContent = '';
  document.getElementById('modal-title').textContent = id ? 'Edit Item' : 'Add Item';
  if (id) {
    const item = shopItems.find(i => i.id === id);
    if (!item) return;
    const d = cpToDenominations(item.valueCp);
    document.getElementById('f-name').value = item.name;
    document.getElementById('f-type').value = item.itemType;
    document.getElementById('f-qty').value = item.quantity;
    document.getElementById('f-armor-type').value = item.armorType;
    document.getElementById('f-ac-base').value = item.acBase;
    document.getElementById('f-pp').value = d.pp;
    document.getElementById('f-gp').value = d.gp;
    document.getElementById('f-ep').value = d.ep;
    document.getElementById('f-sp').value = d.sp;
    document.getElementById('f-cp').value = d.cp;
    document.getElementById('f-attune').value = item.requiresAttunement ? '1' : '0';
    document.getElementById('f-ac-bonus').value = item.acBonus;
    document.getElementById('f-init-bonus').value = item.initBonus;
    document.getElementById('f-speed-bonus').value = item.speedBonus;
    document.getElementById('f-weapon-atk').value = item.weaponAtk || '0';
    document.getElementById('f-weapon-dmg').value = item.weaponDmg || '';
    initPropsGrid(); setSelectedProps(item.weaponProperties || []);
    document.getElementById('f-notes').value = item.notes;
    document.getElementById('f-tag').value = item.tag || '';
  } else {
    document.getElementById('f-name').value = '';
    document.getElementById('f-type').value = 'wondrous';
    document.getElementById('f-qty').value = '1';
    document.getElementById('f-armor-type').value = 'light';
    document.getElementById('f-ac-base').value = '10';
    document.getElementById('f-pp').value = '0';
    document.getElementById('f-gp').value = '0';
    document.getElementById('f-ep').value = '0';
    document.getElementById('f-sp').value = '0';
    document.getElementById('f-cp').value = '0';
    document.getElementById('f-attune').value = '0';
    document.getElementById('f-ac-bonus').value = '0';
    document.getElementById('f-init-bonus').value = '0';
    document.getElementById('f-speed-bonus').value = '0';
    document.getElementById('f-weapon-atk').value = '0';
    document.getElementById('f-weapon-dmg').value = '';
    initPropsGrid(); setSelectedProps([]);
    document.getElementById('f-notes').value = '';
    document.getElementById('f-tag').value = '';
  }
  updatePricePreview();
  onTypeChange();
  document.getElementById('item-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeItemModal() {
  document.getElementById('item-modal').style.display = 'none';
  editingShopId = null;
}

async function saveItemModal() {
  const errEl = document.getElementById('item-err');
  errEl.textContent = '';
  const name = document.getElementById('f-name').value.trim();
  if (!name) { errEl.textContent = 'Name is required.'; return; }
  const valueCp = getPriceCp();
  const payload = {
    name,
    itemType: document.getElementById('f-type').value,
    armorType: document.getElementById('f-armor-type').value,
    acBase: parseInt(document.getElementById('f-ac-base').value) || 10,
    valueCp,
    quantity: parseInt(document.getElementById('f-qty').value) || 1,
    acBonus: parseInt(document.getElementById('f-ac-bonus').value) || 0,
    initBonus: parseInt(document.getElementById('f-init-bonus').value) || 0,
    speedBonus: parseInt(document.getElementById('f-speed-bonus').value) || 0,
    requiresAttunement: document.getElementById('f-attune').value === '1',
    weaponAtk: document.getElementById('f-weapon-atk').value.trim(),
    weaponDmg: document.getElementById('f-weapon-dmg').value.trim(),
    weaponProperties: getSelectedProps(),
    notes: document.getElementById('f-notes').value.trim(),
    tag: document.getElementById('f-tag').value.trim()
  };
  try {
    const url = editingShopId ? `/api/shop/${editingShopId}` : '/api/shop';
    const method = editingShopId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(payload)
    });
    if (res.status === 401) { errEl.textContent = 'Unauthorized.'; return; }
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Save failed.'; return; }
    closeItemModal();
    showStatus(editingShopId ? 'Item updated.' : 'Item added.', false);
    await loadShopItems();
  } catch { errEl.textContent = 'Network error.'; }
}

async function deleteItem(id) {
  const item = shopItems.find(i => i.id === id);
  if (!item || !confirm(`Delete "${item.name}" from the shop?`)) return;
  try {
    const res = await fetch(`/api/shop/${id}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { showStatus('Unauthorized.', true); return; }
    if (!res.ok) { showStatus('Delete failed.', true); return; }
    showStatus('Item deleted.', false);
    await loadShopItems();
  } catch { showStatus('Network error.', true); }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('item-modal').style.display !== 'none') closeItemModal();
});

// ── Auto-auth from stored session password ────────────────────────────────────
(async function() {
  const stored = sessionStorage.getItem('dmMasterPw');
  if (!stored) return;
  document.getElementById('gate-pw').value = stored;
  await authenticate();
})();

// ── Real-time updates ────────────────────────────────────────────────────────
async function connectRealtime(handlers) {
  let provider = 'instantdb', wsUrl = null;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    provider = cfg.dbProvider;
    wsUrl = cfg.wsUrl || null;
  } catch {}
  if (provider === 'localdb') {
    function connect() {
      const ws = new WebSocket(wsUrl || `ws://${location.host}/ws`);
      ws.onmessage = e => {
        const { event, data } = JSON.parse(e.data);
        if (handlers[event]) handlers[event](data);
      };
      ws.onclose = () => setTimeout(connect, 3000);
    }
    connect();
  } else {
    const es = new EventSource('/api/events');
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, e => fn(JSON.parse(e.data)));
    }
    es.onerror = () => {};
  }
}

connectRealtime({
  shop: (data) => {
    if (!masterPw) return;
    if (data.action === 'statusChanged') {
      shopIsOpen = data.isOpen;
      renderShopStatusBtn();
    } else {
      loadShopItems();
    }
  },
  characters: () => {
    // A purchase was made — reload shop quantities and logs if open
    if (masterPw) loadShopItems();
  },
});
