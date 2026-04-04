
let masterPw = '';
let lootItems = [];
let editingId = null;
let expandedTags = new Set();
let tagKeysList = [];
let selectedItems = new Set();

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('loot-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function(){ applyTheme(localStorage.getItem('loot-theme') || 'dark-gold'); })();

function saveExpandedTags() {
  localStorage.setItem('loot-expanded-tags', JSON.stringify([...expandedTags]));
}
function loadExpandedTags() {
  try { expandedTags = new Set(JSON.parse(localStorage.getItem('loot-expanded-tags') || '[]')); } catch { expandedTags = new Set(); }
}
loadExpandedTags();

function toggleTag(idx) {
  const tag = tagKeysList[idx];
  if (expandedTags.has(tag)) expandedTags.delete(tag);
  else expandedTags.add(tag);
  saveExpandedTags();
  renderTable();
}

function showLootTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'logs') loadLogs();
}

async function loadLogs() {
  const loadEl = document.getElementById('logs-loading');
  const tbody = document.getElementById('logs-tbody');
  loadEl.style.display = '';
  try {
    const res = await fetch('/api/loot/logs', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to load logs.', true); return; }
    const logs = await res.json();
    loadEl.style.display = 'none';
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--txd);padding:12px;font-size:11px">No claims yet.</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const dt = new Date(l.claimedAt + (l.claimedAt.endsWith('Z') ? '' : 'Z'));
      const dateStr = dt.toLocaleDateString();
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td style="white-space:nowrap;color:var(--txd);font-size:11px">${dateStr} ${timeStr}</td>
        <td><strong>${esc(l.charName)}</strong></td>
        <td>${esc(l.itemName)}</td>
      </tr>`;
    }).join('');
  } catch { showStatus('Network error.', true); loadEl.style.display = 'none'; }
}

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
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
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    lootItems = await res.json();
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    document.getElementById('loot-loading').style.display = 'none';
    renderTable();
  } catch { errEl.textContent = 'Connection error.'; }
}

async function loadLootItems() {
  try {
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to reload items.', true); return; }
    lootItems = await res.json();
    renderTable();
  } catch { showStatus('Network error.', true); }
}

async function refreshAll() {
  await loadLootItems();
  if (document.getElementById('tab-logs').classList.contains('active')) await loadLogs();
  showStatus('Refreshed.', false);
}

function renderItemRow(item) {
  const visBadge = item.visible
    ? `<span class="vis-badge visible">Visible</span>`
    : `<span class="vis-badge hidden">Hidden</span>`;
  const visBtn = item.visible
    ? `<button class="btn sm danger" onclick="toggleVisible('${item.id}', false)">Hide</button>`
    : `<button class="btn sm success" onclick="toggleVisible('${item.id}', true)">Show</button>`;
  const descBadge = item.descVisible
    ? `<span class="vis-badge visible" style="font-size:9px">Desc Visible</span>`
    : `<span class="vis-badge hidden" style="font-size:9px">Desc Hidden</span>`;
  const descBtn = item.descVisible
    ? `<button class="btn sm danger" onclick="toggleDescVisible('${item.id}', false)" style="margin-left:4px">Hide Desc</button>`
    : `<button class="btn sm success" onclick="toggleDescVisible('${item.id}', true)" style="margin-left:4px">Show Desc</button>`;
  const descPreview = item.description
    ? `<span style="color:var(--txd);font-size:11px">${esc(item.description.length > 80 ? item.description.slice(0,80)+'…' : item.description)}</span>`
    : '<span style="color:var(--sep)">—</span>';
  const checked = selectedItems.has(item.id) ? 'checked' : '';
  return `<tr>
    <td style="text-align:center;width:30px"><input type="checkbox" ${checked} onchange="toggleItemSelection('${item.id}')"></td>
    <td><strong>${esc(item.name)}</strong></td>
    <td style="max-width:220px">${descPreview}</td>
    <td style="white-space:nowrap">${visBadge}<br>${descBadge}</td>
    <td style="white-space:nowrap">
      ${visBtn}${descBtn}
      <button class="btn sm" onclick="openItemModal('${item.id}')" style="margin-left:4px">Edit</button>
      <button class="btn sm danger" onclick="deleteItem('${item.id}')" style="margin-left:4px">Delete</button>
    </td>
  </tr>`;
}

function renderTable() {
  const wrap = document.getElementById('table-wrap');
  const emptyMsg = document.getElementById('empty-msg');
  if (lootItems.length === 0) {
    wrap.style.display = 'none';
    emptyMsg.style.display = '';
    return;
  }
  wrap.style.display = '';
  emptyMsg.style.display = 'none';

  // Group by tag
  const groups = {};
  lootItems.forEach(item => {
    const tag = item.tag || '';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(item);
  });

  // Named tags alphabetically, untagged last
  tagKeysList = Object.keys(groups).sort((a, b) => {
    if (!a && b) return 1;
    if (a && !b) return -1;
    return a.localeCompare(b);
  });

  // Update tag datalist for modal autocomplete
  const dl = document.getElementById('tag-datalist');
  if (dl) dl.innerHTML = tagKeysList.filter(t => t).map(t => `<option value="${esc(t)}">`).join('');
  const dlBulk = document.getElementById('tag-datalist-bulk');
  if (dlBulk) dlBulk.innerHTML = tagKeysList.filter(t => t).map(t => `<option value="${esc(t)}">`).join('');

  // Update bulk action bar
  updateBulkBar();

  wrap.innerHTML = tagKeysList.map((tag, idx) => {
    const items = groups[tag];
    const label = tag || 'Untagged';
    const isCollapsed = !expandedTags.has(tag);
    const itemIds = items.map(i => i.id);
    const allSelected = itemIds.length > 0 && itemIds.every(id => selectedItems.has(id));
    const someSelected = itemIds.some(id => selectedItems.has(id));
    const selectAllChecked = allSelected ? 'checked' : '';
    const selectAllRow = `<tr class="select-all-row">
      <td style="text-align:center"><input type="checkbox" ${selectAllChecked} ${someSelected && !allSelected ? 'style="opacity:0.5"' : ''} onchange="toggleGroupSelection('${tag}')"></td>
      <td colspan="4">Select all in this group</td>
    </tr>`;
    const rows = items.map(item => renderItemRow(item)).join('');
    return `<div class="tag-group">
      <div class="tag-hdr" onclick="toggleTag(${idx})">
        <span class="tag-chevron">${isCollapsed ? '▶' : '▼'}</span>
        <span class="tag-label">${esc(label)}</span>
        <span class="tag-count">${items.length}</span>
      </div>
      <div class="tag-body${isCollapsed ? '' : ' open'}">
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th style="width:30px"></th><th>Name</th><th>Description</th><th>Visibility</th><th></th></tr></thead>
            <tbody>${selectAllRow}${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function toggleVisible(id, visible) {
  try {
    const res = await fetch(`/api/loot/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ visible })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to update visibility.', true); return; }
    const item = lootItems.find(i => i.id === id);
    if (item) item.visible = visible;
    renderTable();
    showStatus(visible ? 'Item is now visible to players.' : 'Item hidden from players.', false);
  } catch { showStatus('Network error.', true); }
}

async function toggleDescVisible(id, descVisible) {
  try {
    const res = await fetch(`/api/loot/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ descVisible })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to update description visibility.', true); return; }
    const item = lootItems.find(i => i.id === id);
    if (item) item.descVisible = descVisible;
    renderTable();
    showStatus(descVisible ? 'Description now visible to players.' : 'Description hidden from players.', false);
  } catch { showStatus('Network error.', true); }
}

async function importItems() {
  const text = document.getElementById('import-text').value.trim();
  const tag = document.getElementById('import-tag').value.trim();
  const statusEl = document.getElementById('import-status');
  if (!text) { statusEl.textContent = 'Paste some items first.'; statusEl.style.color = 'var(--err)'; return; }
  try {
    const res = await fetch('/api/loot/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ text, tag })
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Import failed.'; statusEl.style.color = 'var(--err)'; return; }
    document.getElementById('import-text').value = '';
    statusEl.textContent = `Imported ${data.count} item${data.count !== 1 ? 's' : ''}.`;
    statusEl.style.color = 'var(--ok)';
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
    await loadLootItems();
  } catch { statusEl.textContent = 'Network error.'; statusEl.style.color = 'var(--err)'; }
}

function openItemModal(id) {
  editingId = id;
  document.getElementById('item-err').textContent = '';
  document.getElementById('modal-title').textContent = id ? 'Edit Loot Item' : 'Add Loot Item';
  if (id) {
    const item = lootItems.find(i => i.id === id);
    if (!item) return;
    document.getElementById('f-name').value = item.name;
    document.getElementById('f-tag').value = item.tag || '';
    document.getElementById('f-desc').value = item.description;
    document.getElementById('f-visible').value = item.visible ? '1' : '0';
    document.getElementById('f-desc-visible').value = item.descVisible ? '1' : '0';
  } else {
    document.getElementById('f-name').value = '';
    document.getElementById('f-tag').value = '';
    document.getElementById('f-desc').value = '';
    document.getElementById('f-visible').value = '0';
    document.getElementById('f-desc-visible').value = '0';
  }
  document.getElementById('item-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeItemModal() {
  document.getElementById('item-modal').style.display = 'none';
  editingId = null;
}

async function saveItemModal() {
  const errEl = document.getElementById('item-err');
  errEl.textContent = '';
  const name = document.getElementById('f-name').value.trim();
  if (!name) { errEl.textContent = 'Name is required.'; return; }
  const payload = {
    name,
    tag: document.getElementById('f-tag').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    visible: document.getElementById('f-visible').value === '1',
    descVisible: document.getElementById('f-desc-visible').value === '1'
  };
  try {
    const url = editingId ? `/api/loot/${editingId}` : '/api/loot';
    const method = editingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(payload)
    });
    if (res.status === 401) { errEl.textContent = 'Unauthorized.'; return; }
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Save failed.'; return; }
    closeItemModal();
    showStatus(editingId ? 'Item updated.' : 'Item added.', false);
    await loadLootItems();
  } catch { errEl.textContent = 'Network error.'; }
}

async function deleteItem(id) {
  const item = lootItems.find(i => i.id === id);
  if (!item || !confirm(`Delete "${item.name}" from the loot list?`)) return;
  try {
    const res = await fetch(`/api/loot/${id}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { showStatus('Unauthorized.', true); return; }
    if (!res.ok) { showStatus('Delete failed.', true); return; }
    showStatus('Item deleted.', false);
    await loadLootItems();
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

// ── Selection management ──────────────────────────────────────────────────────
function toggleItemSelection(id) {
  if (selectedItems.has(id)) selectedItems.delete(id);
  else selectedItems.add(id);
  renderTable();
}

function toggleGroupSelection(tag) {
  const items = lootItems.filter(item => (item.tag || '') === tag);
  const itemIds = items.map(i => i.id);
  const allSelected = itemIds.every(id => selectedItems.has(id));
  if (allSelected) itemIds.forEach(id => selectedItems.delete(id));
  else itemIds.forEach(id => selectedItems.add(id));
  renderTable();
}

function clearSelection() {
  selectedItems.clear();
  renderTable();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (selectedItems.size > 0) {
    bar.classList.add('active');
    countEl.textContent = `${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''} selected`;
  } else {
    bar.classList.remove('active');
  }
}

async function applyBulkTag() {
  const tag = document.getElementById('bulk-tag').value.trim();
  const ids = [...selectedItems];
  if (ids.length === 0) { showStatus('No items selected.', true); return; }
  try {
    const res = await fetch('/api/loot/bulk-update-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ ids, tag })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to update tags.', true); return; }
    const data = await res.json();
    document.getElementById('bulk-tag').value = '';
    showStatus(`Applied tag to ${data.count} item${data.count !== 1 ? 's' : ''}.`, false);
    clearSelection();
    await loadLootItems();
  } catch { showStatus('Network error.', true); }
}

async function bulkDeleteSelected() {
  const ids = [...selectedItems];
  if (ids.length === 0) { showStatus('No items selected.', true); return; }
  if (!confirm(`Delete ${ids.length} item${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  try {
    const res = await fetch('/api/loot/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ ids })
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to delete items.', true); return; }
    const data = await res.json();
    showStatus(`Deleted ${data.count} item${data.count !== 1 ? 's' : ''}.`, false);
    clearSelection();
    await loadLootItems();
  } catch { showStatus('Network error.', true); }
}

// ── Real-time updates ──────────────────────────────────────────────────────────
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
  loot: (data) => {
    if (!masterPw) return;
    loadLootItems();
    if (data.action === 'claimed' && document.getElementById('tab-logs').classList.contains('active')) {
      loadLogs();
    }
  },
});
