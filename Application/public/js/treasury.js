/**
 * Treasury — DM manager for the unified loot + shop catalogue.
 * Master-detail: tag-grouped list on the left, inline editor on the right.
 */

let masterPw   = '';
let items      = [];
let currentId  = null;
let dirty      = false;
let modeFilter = 'all';
let selected   = new Set();
let expandedTags = new Set();
let shopIsOpen = true;
let shopActiveTags = [];   // empty = the whole shop is open
let ledgerOpen = false;
let tagKeys    = [];

const MODE_LABEL = { hidden: 'Hidden', loot: 'Free Loot', shop: 'Shop' };
const MODE_HELP  = {
  hidden: 'DM only. Players cannot see this item anywhere.',
  loot:   'Free to claim, one per character. Stock sets how many can be taken — 1 vanishes after the first claim, −1 is an open offer to the whole party.',
  shop:   'For sale. Visible while the shop is open and its tag matches the open filter.',
};
const WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

// ── Tag pickers ──────────────────────────────────────────────────────────────
// Dropdowns rather than text inputs with a datalist: typing into a datalist
// filters the suggestions as you type, which got in the way of simply picking
// an existing tag. Choosing "+ New tag…" reveals a text box for a fresh one.
const NEW_TAG = '__new_tag__';
const TAG_PICKERS = ['f-tag', 'bulk-tag', 'import-tag'];

function tagOptionsHTML(selected) {
  const known = tagKeys.filter(Boolean);
  const opts = ['<option value="">— No tag —</option>'];
  for (const t of known) opts.push(`<option value="${esc(t)}">${esc(t)}</option>`);
  // A tag carried by the open item but not yet present anywhere else.
  if (selected && !known.includes(selected)) opts.push(`<option value="${esc(selected)}">${esc(selected)}</option>`);
  opts.push(`<option value="${NEW_TAG}">+ New tag…</option>`);
  return opts.join('');
}

// Reads the effective tag: either the chosen option or the typed new name.
function tagPickValue(prefix) {
  const sel = $(prefix + '-sel');
  if (!sel) return '';
  if (sel.value !== NEW_TAG) return sel.value;
  return ($(prefix + '-new')?.value || '').trim();
}

function onTagPick(prefix) {
  const sel = $(prefix + '-sel');
  const inp = $(prefix + '-new');
  if (!sel || !inp) return;
  const isNew = sel.value === NEW_TAG;
  inp.style.display = isNew ? '' : 'none';
  if (isNew) { inp.value = ''; setTimeout(() => inp.focus(), 0); }
}

function setTagPick(prefix, tag) {
  const sel = $(prefix + '-sel');
  const inp = $(prefix + '-new');
  if (!sel) return;
  sel.innerHTML = tagOptionsHTML(tag || '');
  sel.value = tag || '';
  if (inp) { inp.style.display = 'none'; inp.value = ''; }
}

// Rebuild every picker's options after the catalogue changes, keeping the
// current choice. A picker mid-way through typing a new tag is left untouched.
function refreshTagPickers() {
  for (const p of TAG_PICKERS) {
    const sel = $(p + '-sel');
    if (!sel || sel.value === NEW_TAG) continue;
    const cur = sel.value;
    sel.innerHTML = tagOptionsHTML(cur);
    sel.value = cur;
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Escape for a single-quoted JS string inside an HTML attribute (see esc.js).
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const $ = id => document.getElementById(id);

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('dm-theme', name);
  const sel = $('theme-sel');
  if (sel) sel.value = name;
}
(function () { applyTheme(localStorage.getItem('dm-theme') || 'dark-gold'); })();

try { expandedTags = new Set(JSON.parse(localStorage.getItem('treasury-expanded-tags') || '[]')); } catch {}
function saveExpanded() { localStorage.setItem('treasury-expanded-tags', JSON.stringify([...expandedTags])); }

function showStatus(msg, isError) {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

function handleUnauth() {
  masterPw = '';
  $('gate').style.display = '';
  $('shell').style.display = 'none';
}

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), 'X-Master-Password': masterPw };
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers });
}

// ── Currency helpers ─────────────────────────────────────────────────────────
function cpToGp(cp) {
  if (!cp) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}
function cpToDenoms(cp) {
  let r = cp;
  const pp = Math.floor(r / 1000); r -= pp * 1000;
  const gp = Math.floor(r / 100);  r -= gp * 100;
  const ep = Math.floor(r / 50);   r -= ep * 50;
  const sp = Math.floor(r / 10);   r -= sp * 10;
  return { pp, gp, ep, sp, cp: r };
}
function getPriceCp() {
  return (parseInt($('f-pp').value) || 0) * 1000
       + (parseInt($('f-gp').value) || 0) * 100
       + (parseInt($('f-ep').value) || 0) * 50
       + (parseInt($('f-sp').value) || 0) * 10
       + (parseInt($('f-cp').value) || 0);
}
function updatePricePreview() {
  const total = getPriceCp();
  $('price-preview').textContent = total === 0 ? '' : '≈ ' + cpToGp(total) + ' total';
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate() {
  const pw = $('gate-pw').value;
  const errEl = $('gate-err');
  if (!pw) { errEl.textContent = 'Enter the master password.'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch('/api/treasury/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    items = await res.json();
    $('gate').style.display = 'none';
    $('shell').style.display = '';
    initPropsGrid();
    renderList();
    await loadShopStatus();
  } catch { errEl.textContent = 'Connection error.'; }
}

async function loadItems() {
  try {
    const res = await api('/api/treasury/all');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to reload items.', true); return; }
    items = await res.json();
    renderList();
    // Keep the open editor in sync unless the DM has unsaved edits.
    if (currentId && !dirty) {
      const it = items.find(i => i.id === currentId);
      if (it) fillForm(it); else clearDetail();
    }
  } catch { showStatus('Network error.', true); }
}

async function refreshAll() {
  await loadItems();
  await loadShopStatus();
  if (ledgerOpen) await loadLedger();
  showStatus('Refreshed.', false);
}

// ── Shop status ──────────────────────────────────────────────────────────────
function openTagsLabel() {
  const n = shopActiveTags.length;
  if (n === 0) return 'all tags';
  if (n === 1) return `“${shopActiveTags[0]}”`;
  return `${n} tags`;
}

function renderShopStatusBtn() {
  const btn = $('shop-status-btn');
  if (shopIsOpen) {
    btn.textContent = `🟢 Shop Open (${openTagsLabel()})`;
    btn.style.color = 'var(--ok)';
  } else {
    btn.textContent = '🔴 Shop Closed';
    btn.style.color = 'var(--err)';
  }
  const tagBtn = $('open-tags-btn');
  if (tagBtn) tagBtn.textContent = shopActiveTags.length ? `🏷 ${shopActiveTags.length} ▾` : '🏷 Tags ▾';
}

async function loadShopStatus() {
  try {
    const res = await api('/api/treasury/status');
    if (!res.ok) return;
    const d = await res.json();
    shopIsOpen = d.isOpen;
    shopActiveTags = d.activeTags || (d.activeTag ? [d.activeTag] : []);
    renderShopStatusBtn();
  } catch {}
}

async function setShopStatus(isOpen, activeTags) {
  try {
    const res = await api('/api/treasury/status', {
      method: 'PUT',
      body: JSON.stringify({ isOpen, activeTags: activeTags || [] }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Failed to update shop status.', true); return; }
    const d = await res.json();
    shopIsOpen = d.isOpen;
    shopActiveTags = d.activeTags || [];
    renderShopStatusBtn();
    showStatus(shopIsOpen ? `Shop open for ${openTagsLabel()}.` : 'Shop closed.', false);
  } catch { showStatus('Network error.', true); }
}

// Closing clears the tag selection; reopening from the button opens everything.
function toggleShopStatus() { setShopStatus(!shopIsOpen, []); }

// ── Multi-tag picker ─────────────────────────────────────────────────────────
function renderTagsPopup() {
  const list = $('tags-popup-list');
  const counts = {};
  for (const i of items) if (i.mode === 'shop') counts[i.tag || ''] = (counts[i.tag || ''] || 0) + 1;
  const names = tagKeys.filter(Boolean);
  if (names.length === 0) {
    list.innerHTML = '<div class="pop-note" style="border:none">No tags yet.</div>';
    return;
  }
  list.innerHTML = names.map(t => `
    <label class="tag-chk">
      <input type="checkbox" value="${esc(t)}" ${shopActiveTags.includes(t) ? 'checked' : ''}>
      <span>${esc(t)}</span>
      <span class="tc-count">${counts[t] || 0} for sale</span>
    </label>`).join('');
}

function toggleTagsPopup() {
  const pop = $('tags-popup');
  const opening = !pop.classList.contains('open');
  if (opening) renderTagsPopup();
  pop.classList.toggle('open', opening);
}
function closeTagsPopup() { $('tags-popup').classList.remove('open'); }

function setAllOpenTags(on) {
  document.querySelectorAll('#tags-popup-list input[type=checkbox]').forEach(c => { c.checked = on; });
}

function applyOpenTags() {
  const picked = [...document.querySelectorAll('#tags-popup-list input[type=checkbox]')]
    .filter(c => c.checked).map(c => c.value);
  closeTagsPopup();
  setShopStatus(true, picked);
}

// Clicking elsewhere dismisses the popup.
document.addEventListener('click', e => {
  const pop = $('tags-popup');
  if (!pop || !pop.classList.contains('open')) return;
  if (e.target.closest('#tags-popup') || e.target.closest('#open-tags-btn')) return;
  closeTagsPopup();
});

// ── Sidebar list ─────────────────────────────────────────────────────────────
function visibleItems() {
  const q = $('search').value.trim().toLowerCase();
  return items.filter(i => {
    if (modeFilter !== 'all' && i.mode !== modeFilter) return false;
    if (!q) return true;
    return (i.name || '').toLowerCase().includes(q)
        || (i.tag || '').toLowerCase().includes(q)
        || (i.description || '').toLowerCase().includes(q);
  });
}

function setModeFilter(mode, el) {
  modeFilter = mode;
  document.querySelectorAll('#mode-filter .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderList();
}

function toggleTag(tag) {
  if (expandedTags.has(tag)) expandedTags.delete(tag); else expandedTags.add(tag);
  saveExpanded();
  renderList();
}

function itemMeta(i) {
  if (i.mode === 'shop') {
    const stock = i.quantity === -1 ? '∞' : i.quantity;
    return `${cpToGp(i.valueCp)} · ×${stock}`;
  }
  return MODE_LABEL[i.mode] || '';
}

function renderList() {
  const list = $('item-list');
  const shown = visibleItems();

  // Tag options come from the whole catalogue, not the filtered view.
  tagKeys = [...new Set(items.map(i => i.tag || ''))].sort((a, b) => {
    if (!a && b) return 1; if (a && !b) return -1; return a.localeCompare(b);
  });
  refreshTagPickers();
  // Keep the open-for-tags popup in step while it is on screen.
  if ($('tags-popup')?.classList.contains('open')) renderTagsPopup();

  updateBulkBar();

  if (shown.length === 0) {
    list.innerHTML = `<div class="sb-empty">${items.length === 0 ? 'No items yet. Click “+ Add Item”.' : 'Nothing matches this filter.'}</div>`;
    return;
  }

  const groups = {};
  for (const i of shown) (groups[i.tag || ''] ||= []).push(i);
  const keys = Object.keys(groups).sort((a, b) => {
    if (!a && b) return 1; if (a && !b) return -1; return a.localeCompare(b);
  });

  list.innerHTML = keys.map(tag => {
    const g = groups[tag];
    const open = expandedTags.has(tag);
    const rows = g.map(i => {
      const thumb = i.imageThumb
        ? `<img class="it-thumb" src="${esc(i.imageThumb)}" alt="">`
        : `<span class="it-thumb ph">◻</span>`;
      return `<div class="it-row${i.id === currentId ? ' sel' : ''}${selected.has(i.id) ? ' checked' : ''}"
                   onclick="selectItem('${escJs(i.id)}')">
        <input type="checkbox" ${selected.has(i.id) ? 'checked' : ''} style="accent-color:var(--ac)"
               onclick="event.stopPropagation();toggleSelect('${escJs(i.id)}')">
        <span class="mode-dot ${i.mode}" title="${MODE_LABEL[i.mode]}"></span>
        ${thumb}
        <span class="it-name">${esc(i.name) || '<em>Untitled</em>'}</span>
        <span class="it-meta">${esc(itemMeta(i))}</span>
      </div>`;
    }).join('');
    return `<div class="tag-group">
      <div class="tag-hdr" onclick="toggleTag('${escJs(tag)}')">
        <span>${open ? '▾' : '▸'}</span>
        <span>${esc(tag || 'Untagged')}</span>
        <span class="tag-count">${g.length}</span>
      </div>
      <div class="tag-body${open ? ' open' : ''}">${rows}</div>
    </div>`;
  }).join('');
}

// ── Selection / bulk ─────────────────────────────────────────────────────────
function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  renderList();
}
function clearSelection() { selected.clear(); renderList(); }
function updateBulkBar() {
  const bar = $('bulk-bar');
  bar.classList.toggle('on', selected.size > 0);
  $('bulk-count').textContent = `${selected.size} selected`;
}
async function bulkPost(path, body, okMsg) {
  const ids = [...selected];
  if (ids.length === 0) { showStatus('Nothing selected.', true); return; }
  try {
    const res = await api(path, { method: 'POST', body: JSON.stringify({ ids, ...body }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Bulk action failed.', true); return; }
    const d = await res.json();
    showStatus(okMsg(d.count), false);
    clearSelection();
    await loadItems();
  } catch { showStatus('Network error.', true); }
}
function applyBulkTag() {
  const tag = tagPickValue('bulk-tag');
  bulkPost('/api/treasury/bulk-update-tag', { tag }, n => `Tagged ${n} item${n !== 1 ? 's' : ''}.`);
  setTagPick('bulk-tag', '');
}
function applyBulkMode() {
  const mode = $('bulk-mode').value;
  if (!mode) { showStatus('Pick a mode first.', true); return; }
  bulkPost('/api/treasury/bulk-mode', { mode }, n => `Moved ${n} item${n !== 1 ? 's' : ''} to ${MODE_LABEL[mode]}.`);
}
function bulkDelete() {
  const n = selected.size;
  if (n === 0) { showStatus('Nothing selected.', true); return; }
  if (!confirm(`Delete ${n} item${n !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  bulkPost('/api/treasury/bulk-delete', {}, c => `Deleted ${c} item${c !== 1 ? 's' : ''}.`);
}

// ── Weapon properties ────────────────────────────────────────────────────────
function propId(p) { return 'prop-' + p.replace(/[^a-zA-Z]/g, '').toLowerCase(); }
function initPropsGrid() {
  const grid = $('props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = WEAPON_PROPS.map(p =>
    `<label><input type="checkbox" id="${propId(p)}" value="${p}" onchange="onPropChange()">${p}</label>`
  ).join('');
}
function getSelectedProps() {
  return WEAPON_PROPS.filter(p => $(propId(p))?.checked);
}
function setSelectedProps(props) {
  WEAPON_PROPS.forEach(p => {
    const el = $(propId(p));
    if (el) el.checked = Array.isArray(props) && props.includes(p);
  });
  updatePropsLimit();
}
function onPropChange() {
  const sel = getSelectedProps();
  if (sel.length > 3) $(propId(sel[sel.length - 1])).checked = false;
  updatePropsLimit();
  markDirty();
}
function updatePropsLimit() {
  const atMax = getSelectedProps().length >= 3;
  WEAPON_PROPS.forEach(p => {
    const el = $(propId(p));
    if (el) el.disabled = atMax && !el.checked;
  });
  $('props-err').textContent = atMax ? 'Maximum 3 properties selected.' : '';
}

// ── Detail form ──────────────────────────────────────────────────────────────
function markDirty() {
  dirty = true;
  $('save-hint').textContent = 'Unsaved changes';
}
function clearDirty() {
  dirty = false;
  $('save-hint').textContent = '';
}

function clearDetail() {
  currentId = null;
  clearDirty();
  $('detail-form').style.display = 'none';
  $('detail-empty').style.display = '';
  renderList();
}

function setMode(mode) {
  $('mode-seg').dataset.mode = mode;
  document.querySelectorAll('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('mode-help').textContent = MODE_HELP[mode] || '';
  // Stock matters for loot too (it caps how many characters can claim), so this
  // only fades for hidden items. Everything stays editable either way — an item
  // can carry a price long before it goes on sale.
  $('sect-price').classList.toggle('dim', mode === 'hidden');
  markDirty();
}

function onTypeChange() {
  const t = $('f-type').value;
  $('sect-armor').style.display  = t === 'armor'  ? '' : 'none';
  $('sect-weapon').style.display = t === 'weapon' ? '' : 'none';
}

function fillForm(it) {
  currentId = it.id;
  $('detail-empty').style.display = 'none';
  $('detail-form').style.display = '';

  $('f-name').value = it.name || '';
  setTagPick('f-tag', it.tag || '');
  $('f-type').value = it.itemType || 'other';
  $('f-desc').value = it.description || '';
  $('f-desc-visible').checked = !!it.descVisible;
  $('f-armor-type').value = it.armorType || 'light';
  $('f-ac-base').value = it.acBase ?? 10;

  const d = cpToDenoms(it.valueCp || 0);
  $('f-pp').value = d.pp; $('f-gp').value = d.gp; $('f-ep').value = d.ep;
  $('f-sp').value = d.sp; $('f-cp').value = d.cp;
  $('f-qty').value = it.quantity ?? 1;

  $('f-ac-bonus').value = it.acBonus ?? 0;
  $('f-init-bonus').value = it.initBonus ?? 0;
  $('f-speed-bonus').value = it.speedBonus ?? 0;
  $('f-sp-atk-bonus').value = it.spellAtkBonus ?? 0;
  $('f-sp-dc-bonus').value = it.spellDcBonus ?? 0;
  $('f-attune').checked = !!it.requiresAttunement;

  $('f-weapon-atk').value = it.weaponAtk || '0';
  $('f-weapon-dmg').value = it.weaponDmg || '';
  initPropsGrid();
  setSelectedProps(it.weaponProperties || []);

  setImagePreview(it.imageMedium || it.imageUrl, it.imageUrl, it.imageThumb, it.imageMedium);

  setMode(it.mode || 'hidden');
  onTypeChange();
  updatePricePreview();
  clearDirty();          // setMode()/onPropChange() flag dirty; this is a fresh load
  renderList();
}

function selectItem(id) {
  if (dirty && currentId && id !== currentId && !confirm('Discard unsaved changes?')) return;
  const it = items.find(i => i.id === id);
  if (it) fillForm(it);
}

async function createItem() {
  try {
    const res = await api('/api/treasury', { method: 'POST', body: JSON.stringify({ name: 'New Item', mode: 'hidden' }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not create item.', true); return; }
    const { id } = await res.json();
    await loadItems();
    const it = items.find(i => i.id === id);
    if (it) {
      // Reveal the new item's group so it is visible in the list.
      expandedTags.add(it.tag || ''); saveExpanded();
      fillForm(it);
      renderList();
      $('f-name').focus();
      $('f-name').select();
    }
  } catch { showStatus('Network error.', true); }
}

function formPayload() {
  return {
    name: $('f-name').value.trim(),
    tag: tagPickValue('f-tag'),
    mode: $('mode-seg').dataset.mode || 'hidden',
    description: $('f-desc').value,
    descVisible: $('f-desc-visible').checked,
    itemType: $('f-type').value,
    armorType: $('f-armor-type').value,
    acBase: parseInt($('f-ac-base').value) || 10,
    valueCp: getPriceCp(),
    quantity: parseInt($('f-qty').value) || 0,
    acBonus: parseInt($('f-ac-bonus').value) || 0,
    initBonus: parseInt($('f-init-bonus').value) || 0,
    speedBonus: parseInt($('f-speed-bonus').value) || 0,
    spellAtkBonus: parseInt($('f-sp-atk-bonus').value) || 0,
    spellDcBonus: parseInt($('f-sp-dc-bonus').value) || 0,
    requiresAttunement: $('f-attune').checked,
    weaponAtk: $('f-weapon-atk').value.trim(),
    weaponDmg: $('f-weapon-dmg').value.trim(),
    weaponProperties: getSelectedProps(),
  };
}

async function saveCurrent() {
  if (!currentId) return;
  const payload = formPayload();
  if (!payload.name) { showStatus('Name is required.', true); return; }
  try {
    const res = await api(`/api/treasury/${currentId}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Save failed.', true); return; }
    clearDirty();
    showStatus('Saved.', false);
    await loadItems();
  } catch { showStatus('Network error.', true); }
}

async function deleteCurrent() {
  if (!currentId) return;
  const it = items.find(i => i.id === currentId);
  if (!confirm(`Delete “${it ? it.name : 'this item'}”? This cannot be undone.`)) return;
  try {
    const res = await api(`/api/treasury/${currentId}`, { method: 'DELETE' });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Delete failed.', true); return; }
    showStatus('Item deleted.', false);
    clearDetail();
    await loadItems();
  } catch { showStatus('Network error.', true); }
}

// ── Image upload ─────────────────────────────────────────────────────────────
const MAX_IMG_BYTES = 25 * 1024 * 1024;
const OK_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function setImagePreview(displaySrc, url, thumb, medium) {
  const img = $('img-preview');
  const zone = $('img-zone');
  const acts = $('img-actions');
  if (displaySrc) {
    img.src = displaySrc;
    img.style.display = '';
    zone.style.display = 'none';
    acts.style.display = '';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    zone.style.display = '';
    acts.style.display = 'none';
  }
  img.dataset.url = url || '';
  img.dataset.thumb = thumb || '';
  img.dataset.medium = medium || '';
}

function handleImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag');
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadImage(file);
}
function handleImgPick(input) {
  const file = input.files?.[0];
  input.value = '';           // let the same file be picked again after a remove
  if (file) uploadImage(file);
}

async function uploadImage(file) {
  const errEl = $('img-err');
  errEl.textContent = '';
  if (!currentId) { errEl.textContent = 'Select or create an item first.'; return; }
  // Check locally so the user gets an instant answer instead of a 400/413.
  if (!OK_IMG.includes(file.type)) { errEl.textContent = 'Images only (JPEG, PNG, GIF, WebP).'; return; }
  if (file.size > MAX_IMG_BYTES) { errEl.textContent = 'Image is larger than 25 MB.'; return; }

  errEl.innerHTML = '<span class="img-progress">Uploading…</span>';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });
    const res = await api('/api/treasury/media', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { errEl.textContent = data.error || 'Upload failed.'; return; }

    // Persist immediately — an image the DM can see but has not saved would be
    // lost on the next selection, and the uploaded file would be orphaned.
    const save = await api(`/api/treasury/${currentId}`, {
      method: 'PUT',
      body: JSON.stringify({ imageUrl: data.url, imageThumb: data.thumb, imageMedium: data.medium }),
    });
    if (!save.ok) { errEl.textContent = 'Image uploaded but could not be saved.'; return; }
    setImagePreview(data.medium || data.url, data.url, data.thumb, data.medium);
    errEl.textContent = '';
    showStatus('Image saved.', false);
    await loadItems();
  } catch { errEl.textContent = 'Network error.'; }
}

async function removeImage() {
  if (!currentId) return;
  try {
    const res = await api(`/api/treasury/${currentId}`, {
      method: 'PUT',
      body: JSON.stringify({ imageUrl: '', imageThumb: '', imageMedium: '' }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not remove image.', true); return; }
    setImagePreview('', '', '', '');
    showStatus('Image removed.', false);
    await loadItems();
  } catch { showStatus('Network error.', true); }
}

// ── Bulk import ──────────────────────────────────────────────────────────────
function openImportModal() {
  $('import-text').value = '';
  $('import-status').textContent = '';
  setTagPick('import-tag', '');
  $('import-modal').style.display = 'flex';
  setTimeout(() => $('import-text').focus(), 50);
}
function closeImportModal() { $('import-modal').style.display = 'none'; }

async function runImport() {
  const text = $('import-text').value.trim();
  const statusEl = $('import-status');
  if (!text) { statusEl.textContent = 'Paste some items first.'; statusEl.style.color = 'var(--err)'; return; }
  try {
    const res = await api('/api/treasury/import', {
      method: 'POST',
      body: JSON.stringify({ text, tag: tagPickValue('import-tag'), mode: $('import-mode').value }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { statusEl.textContent = data.error || 'Import failed.'; statusEl.style.color = 'var(--err)'; return; }
    closeImportModal();
    showStatus(`Imported ${data.count} item${data.count !== 1 ? 's' : ''}.`, false);
    await loadItems();
  } catch { statusEl.textContent = 'Network error.'; statusEl.style.color = 'var(--err)'; }
}

// ── Ledger ───────────────────────────────────────────────────────────────────
function toggleLedger() {
  ledgerOpen = !ledgerOpen;
  $('ledger').classList.toggle('on', ledgerOpen);
  $('detail').style.display = ledgerOpen ? 'none' : '';
  $('btn-ledger').classList.toggle('primary', ledgerOpen);
  if (ledgerOpen) loadLedger();
}

async function loadLedger() {
  const body = $('ledger-body');
  try {
    const res = await api('/api/treasury/logs');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { body.innerHTML = '<tr><td colspan="6" style="color:var(--err)">Failed to load.</td></tr>'; return; }
    const rows = await res.json();
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="6" style="color:var(--txd)">Nothing claimed or bought yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => {
      const raw = String(r.at || '');
      const dt = new Date(raw + (raw && !raw.endsWith('Z') && raw.includes('T') ? 'Z' : ''));
      const when = isNaN(dt) ? esc(raw) : `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return `<tr>
        <td style="white-space:nowrap;color:var(--txd);font-size:11px">${when}</td>
        <td><span class="badge ${r.type}">${r.type === 'claim' ? 'Claim' : 'Buy'}</span></td>
        <td><strong>${esc(r.charName)}</strong></td>
        <td>${esc(r.itemName)}</td>
        <td style="text-align:center">${r.qty}</td>
        <td style="color:var(--exp);white-space:nowrap">${r.type === 'claim' ? '—' : cpToGp(r.totalCp)}</td>
      </tr>`;
    }).join('');
  } catch { body.innerHTML = '<tr><td colspan="6" style="color:var(--err)">Network error.</td></tr>'; }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('import-modal').style.display !== 'none') closeImportModal();
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentId) { e.preventDefault(); saveCurrent(); }
});
window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── Auto-auth from the stored session password ───────────────────────────────
(async function () {
  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem('rpgSession') || 'null')?.masterPw; } catch {}
  if (!stored) stored = sessionStorage.getItem('dmMasterPw');
  if (!stored) return;
  $('gate-pw').value = stored;
  await authenticate();
})();

// ── Real-time ────────────────────────────────────────────────────────────────
// connectRealtime() comes from the shared /js/lib/realtime.js (loaded first).
connectRealtime({
  treasury: (data) => {
    if (!masterPw) return;
    if (data.action === 'statusChanged') {
      shopIsOpen = data.isOpen;
      shopActiveTags = data.activeTags || (data.activeTag ? [data.activeTag] : []);
      renderShopStatusBtn();
      return;
    }
    loadItems();
    if (ledgerOpen && (data.action === 'claimed' || data.action === 'purchase')) loadLedger();
  },
  characters: () => { if (masterPw) loadItems(); },
});
