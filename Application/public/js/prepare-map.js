'use strict';

let masterPw = '';
let currentMapId = null;
let maps = [];
let prepState = { name: '', cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, fogRegions: [], hiddenItems: [], preparedTokens: [] };
let drawMode = false;
let drawState = null;
let placeItemMode = false;
let _pendingClone = null;
let tokenPlacementMode = false;
let pendingTokenConfig = null;
let pmMonsterList = [];
let pmMonsterLoaded = false;
let pmSelectedMonsterId = null;
let pmCurrentTab = 'monster';
let _editTokenIndex = null;
let pmPortraitDataUrl = null;
let saveTimer = null;
let viewScale = 1;
let moveMode = false;   // explicit "Move" tool toggle (mutually exclusive with draw/place/token)
let moveState = null;   // active drag-to-move of an existing token / item / fog region
let _lastDeleted = null;  // {type:'fog'|'token'|'item', obj, index} — single-level undo for deletes
let _expandedItemId = null;  // id of the hidden item whose description is expanded inline
const _selectedTokenIds = new Set();  // multi-selected token ids for bulk recolor

// 16-colour token palette — shared by the bulk recolor popup and the add/edit modal.
const PM_TOKEN_COLORS = [
  '#c0392b', '#e67e22', '#f39c12', '#f1c40f', '#7cb342', '#27ae60', '#16a085', '#00bcd4',
  '#2980b9', '#3f51b5', '#8e44ad', '#c2185b', '#e91e63', '#795548', '#607d8b', '#2c3e50',
];

// Round swatch grid markup; each swatch calls fnName('#hex'). selected gets a ring.
function _swatchGridHTML(selected, fnName) {
  const sc = String(selected || '').toLowerCase();
  return PM_TOKEN_COLORS.map(c => {
    const sel = sc === c.toLowerCase();
    return `<div onclick="${fnName}('${c}')" title="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;box-sizing:border-box;border:2px solid ${sel ? '#fff' : 'rgba(0,0,0,.35)'};outline:${sel ? '2px solid var(--ac)' : 'none'};outline-offset:1px"></div>`;
  }).join('');
}

function genId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── DOM refs ──
const prepImg     = document.getElementById('prep-map-img');
const gridCvs     = document.getElementById('prep-grid-canvas');
const fogCvs      = document.getElementById('prep-fog-canvas');
const drawCvs     = document.getElementById('prep-draw-canvas');
const gCtx        = gridCvs.getContext('2d');
const fCtx        = fogCvs.getContext('2d');
const dCtx        = drawCvs.getContext('2d');
const editorWrap    = document.getElementById('editor-wrap');
const canvasArea    = document.getElementById('pm-canvas-area');

// ── Panel toggles ──
function togglePmSidebar() {
  const el = document.getElementById('pm-sidebar');
  const btn = document.getElementById('btn-sidebar-toggle');
  if (!el) return;
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  if (btn) btn.textContent = hidden ? '◀ Panel' : '▶ Panel';
  if (currentMapId) refreshCanvases();
}

function togglePmControls() {
  const el = document.getElementById('pm-controls');
  const btn = document.getElementById('btn-controls-toggle');
  if (!el) return;
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  if (btn) btn.textContent = hidden ? 'Grid ▲' : 'Grid ▼';
  if (currentMapId) refreshCanvases();
}

function toggleSbSection(name) {
  const el    = document.getElementById(`sb-sec-${name}`);
  const arrow = document.getElementById(`sb-sec-${name}-arrow`);
  if (!el) return;
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
  if (currentMapId) refreshCanvases();
}

// ── Theme ──
function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  localStorage.setItem('pm-theme', name);
  const sel = document.getElementById('theme-sel');
  if (sel) sel.value = name;
}
(function () { applyTheme(localStorage.getItem('pm-theme') || 'dark-gold'); })();

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escape a value for a single-quoted JS string inside an HTML attribute (see escJs note in esc.js).
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showStatus(msg, isErr) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--err)' : 'var(--ok)';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

// ── Auth ──
async function authenticate() {
  const pw = document.getElementById('gate-pw').value;
  const errEl = document.getElementById('gate-err');
  if (!pw) { errEl.textContent = 'Enter the master password.'; return; }
  errEl.textContent = '';
  try {
    const res = await fetch('/api/treasury/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { errEl.textContent = 'Wrong password.'; return; }
    if (!res.ok) { errEl.textContent = 'Server error.'; return; }
    masterPw = pw;
    sessionStorage.setItem('dmMasterPw', pw);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    await loadMaps();
  } catch { errEl.textContent = 'Connection error.'; }
}

// Auto-login from session
(function () {
  const saved = sessionStorage.getItem('dmMasterPw');
  if (saved) {
    document.getElementById('gate-pw').value = saved;
    authenticate();
  }
})();

// ── Map list ──
async function loadMaps() {
  try {
    const res = await fetch('/api/prepared-maps');
    if (!res.ok) return;
    maps = await res.json();
    renderMapList();
  } catch { showStatus('Could not load maps', true); }
}

function renderMapList() {
  const sel = document.getElementById('map-select');
  if (!sel) return;
  if (!maps.length) {
    sel.innerHTML = '<option value="">No maps yet</option>';
    sel.value = '';
  } else {
    sel.innerHTML = '<option value="">— Select a map —</option>' +
      maps.map(m => `<option value="${esc(m.id)}">${esc(m.name || 'Untitled')}</option>`).join('');
    sel.value = currentMapId || '';
  }
  renderMapMeta();
  updateSidebarSections();
}

function renderMapMeta() {
  const el = document.getElementById('map-meta');
  if (!el) return;
  const m = maps.find(x => x.id === currentMapId);
  if (!m) { el.textContent = ''; return; }
  const regionCount = Array.isArray(m.fogRegions) ? m.fogRegions.length : 0;
  const itemCount = Array.isArray(m.hiddenItems) ? m.hiddenItems.length : 0;
  const tokCount = Array.isArray(m.preparedTokens) ? m.preparedTokens.length : 0;
  el.textContent = `${m.hasImage ? '🖼 · ' : ''}${regionCount} fog · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ${tokCount} token${tokCount !== 1 ? 's' : ''}`;
}

// Show the fog/tokens/items sections only when a map is selected; otherwise
// show a prompt telling the user to pick a map.
function updateSidebarSections() {
  const has = !!currentMapId;
  ['sb-fog-section', 'sb-tokens-section', 'sb-items-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = has ? '' : 'none';
  });
  const msg = document.getElementById('pm-no-map-msg');
  if (msg) msg.style.display = has ? 'none' : '';
}

function selectMap(id) {
  const m = maps.find(x => x.id === id);
  if (!m) return;
  // Flush any pending debounced save for the current map before switching,
  // otherwise the timer fires after currentMapId changes and drops the edits.
  if (saveTimer && currentMapId && currentMapId !== id) saveMap();
  currentMapId = id;
  prepState = {
    name: m.name || '',
    cellSize: m.cellSize || 50,
    offsetX: m.offsetX || 0,
    offsetY: m.offsetY || 0,
    mapWidth: m.mapWidth || 0,
    mapHeight: m.mapHeight || 0,
    fogRegions: Array.isArray(m.fogRegions) ? JSON.parse(JSON.stringify(m.fogRegions)) : [],
    hiddenItems: Array.isArray(m.hiddenItems) ? JSON.parse(JSON.stringify(m.hiddenItems)) : [],
    preparedTokens: Array.isArray(m.preparedTokens) ? JSON.parse(JSON.stringify(m.preparedTokens)) : [],
  };
  prepState.hiddenItems.forEach(it => { if (!it.id) it.id = genId(); });  // older items may lack ids
  prepState.preparedTokens.forEach(t => { if (!t.id) t.id = genId(); });
  _lastDeleted = null;       // undo does not cross map boundaries
  _expandedItemId = null;
  _selectedTokenIds.clear();
  drawMode = false;
  drawState = null;
  placeItemMode = false;
  cancelTokenPlacement();
  renderMapList();
  renderEditor();
}

// ── Editor ──
function renderEditor() {
  document.getElementById('editor-placeholder').style.display = 'none';
  document.getElementById('pm-toolbar').style.display = '';
  // Only show controls if they were already open (don't force-expand on map select)
  const ctrlsEl = document.getElementById('pm-controls');
  if (ctrlsEl && ctrlsEl.style.display === 'none') {
    // leave as-is; user controls visibility via Grid toggle
  }

  document.getElementById('map-name').value = prepState.name;
  document.getElementById('prep-cell-size').value = prepState.cellSize;
  document.getElementById('prep-cell-val').textContent = prepState.cellSize + ' px';
  document.getElementById('prep-offset-x').value = prepState.offsetX;
  document.getElementById('prep-offset-y').value = prepState.offsetY;

  // Reset draw mode button
  const btn = document.getElementById('btn-draw-fog');
  btn.style.background = '';
  btn.style.color = '';
  document.getElementById('draw-hint').style.display = 'none';
  const placeBtn = document.getElementById('btn-place-item');
  if (placeBtn) { placeBtn.style.background = ''; placeBtn.style.color = ''; }
  const placeHint = document.getElementById('place-hint');
  if (placeHint) placeHint.style.display = 'none';
  drawMode = false;
  drawState = null;
  placeItemMode = false;
  _resetMoveMode();
  drawCvs.style.cursor = 'default';
  _syncDrawInteractive();

  if (prepState.mapWidth && prepState.mapHeight) {
    prepImg.src = `/api/prepared-maps/${currentMapId}/image?t=${Date.now()}`;
    prepImg.style.display = '';
  } else {
    prepImg.style.display = 'none';
  }

  refreshCanvases();
  renderFogList();
  renderItemList();
  renderTokenList();
}

// Compute fit scale and resize canvases to fill the canvas area.
// Called on map select and whenever the container resizes.
function refreshCanvases() {
  const naturalW = prepState.mapWidth || 800;
  const naturalH = prepState.mapHeight || 500;
  const areaW = canvasArea.clientWidth || 800;
  const areaH = canvasArea.clientHeight || 600;
  viewScale = Math.min(areaW / naturalW, areaH / naturalH);
  const W = Math.round(naturalW * viewScale);
  const H = Math.round(naturalH * viewScale);

  prepImg.style.width = W + 'px';
  prepImg.style.height = H + 'px';
  [gridCvs, fogCvs, drawCvs].forEach(c => { c.width = W; c.height = H; });
  editorWrap.style.width = W + 'px';
  editorWrap.style.height = H + 'px';

  renderPrepGrid();
  renderPrepFog();
  if (!drawMode) dCtx.clearRect(0, 0, W, H);
}

// Re-scale when the panel is resized (e.g. window resize)
if (canvasArea) new ResizeObserver(() => { if (currentMapId) refreshCanvases(); }).observe(canvasArea);

function renderPrepGrid() {
  const W = gridCvs.width, H = gridCvs.height;
  const cs = (prepState.cellSize || 50) * viewScale;
  const ox = (prepState.offsetX || 0) * viewScale;
  const oy = (prepState.offsetY || 0) * viewScale;
  gCtx.clearRect(0, 0, W, H);
  gCtx.strokeStyle = 'rgba(200,160,74,0.75)';
  gCtx.lineWidth = 1;
  // vertical lines
  for (let x = ((ox % cs) + cs) % cs; x < W; x += cs) {
    gCtx.beginPath(); gCtx.moveTo(x + 0.5, 0); gCtx.lineTo(x + 0.5, H); gCtx.stroke();
  }
  // horizontal lines
  for (let y = ((oy % cs) + cs) % cs; y < H; y += cs) {
    gCtx.beginPath(); gCtx.moveTo(0, y + 0.5); gCtx.lineTo(W, y + 0.5); gCtx.stroke();
  }
}

const ITEM_TYPE_ICONS = { trap: '⚠', chest: '◈', door: '▭', note: '✎', other: '◉' };

// Token portrait image cache. Canvas needs a loaded Image to draw synchronously,
// so we cache by src and re-render the fog/token layer once each image loads.
const _tokImgCache = {};
function _getTokImg(src) {
  if (!src) return null;
  let entry = _tokImgCache[src];
  if (entry) return entry.loaded ? entry.img : null;
  const img = new Image();
  entry = { img, loaded: false };
  _tokImgCache[src] = entry;
  img.onload = () => { entry.loaded = true; renderPrepFog(); };
  img.onerror = () => { entry.error = true; };
  img.src = src;
  return null;
}

function renderPrepFog() {
  const W = fogCvs.width, H = fogCvs.height;
  const cs = (prepState.cellSize || 50) * viewScale;
  const ox = (prepState.offsetX || 0) * viewScale;
  const oy = (prepState.offsetY || 0) * viewScale;
  fCtx.clearRect(0, 0, W, H);
  for (const r of prepState.fogRegions) {
    const px = ox + r.x * cs, py = oy + r.y * cs, pw = r.w * cs, ph = r.h * cs;
    fCtx.fillStyle = r.visible ? 'rgba(0,200,100,0.2)' : 'rgba(0,0,0,0.65)';
    fCtx.fillRect(px, py, pw, ph);
    fCtx.strokeStyle = r.visible ? 'rgba(0,200,100,0.7)' : 'rgba(200,160,74,0.5)';
    fCtx.lineWidth = 1;
    fCtx.strokeRect(px, py, pw, ph);
    fCtx.fillStyle = 'rgba(200,160,74,0.9)';
    fCtx.font = '10px sans-serif';
    fCtx.fillText(r.label || '', px + 3, py + 12);
  }
  // Render hidden items
  for (const item of (prepState.hiddenItems || [])) {
    const iw = (item.w || 1) * cs, ih = (item.h || 1) * cs;
    const px = ox + item.x * cs, py = oy + item.y * cs;
    fCtx.fillStyle = item.visible ? 'rgba(0,200,100,0.25)' : 'rgba(220,60,60,0.25)';
    fCtx.fillRect(px, py, iw, ih);
    fCtx.strokeStyle = item.visible ? 'rgba(0,200,100,0.9)' : 'rgba(220,60,60,0.9)';
    fCtx.lineWidth = 1.5;
    fCtx.setLineDash([4, 3]);
    fCtx.strokeRect(px, py, iw, ih);
    fCtx.setLineDash([]);
    fCtx.fillStyle = 'rgba(255,255,255,0.95)';
    fCtx.font = `bold ${Math.round(Math.min(cs * 0.28, 11))}px sans-serif`;
    fCtx.textAlign = 'center';
    fCtx.textBaseline = 'middle';
    fCtx.fillText(ITEM_TYPE_ICONS[item.type] || '?', px + iw * 0.5, py + ih * 0.5);
    fCtx.textAlign = 'start';
    fCtx.textBaseline = 'alphabetic';
    if (item.label) {
      fCtx.fillStyle = 'rgba(255,200,100,0.9)';
      fCtx.font = `${Math.round(Math.min(cs * 0.2, 9))}px sans-serif`;
      fCtx.fillText(item.label, px + 2, py + ih - 3);
    }
  }
  // Render prepared tokens
  for (const tok of (prepState.preparedTokens || [])) {
    const ts = Math.max(1, tok.tokenSize || 1);
    const tx = ox + tok.x * cs + (cs * ts) / 2;
    const ty = oy + tok.y * cs + (cs * ts) / 2;
    const r = (cs * ts) / 2 * 0.72;
    const hidden = tok.visibleToPlayers === false;
    const portImg = _getTokImg(tok.portraitThumb || tok.portrait || null);
    if (portImg) {
      // Draw the portrait clipped into the token circle (cover fit).
      fCtx.save();
      fCtx.globalAlpha = hidden ? 0.5 : 1;
      fCtx.beginPath();
      fCtx.arc(tx, ty, r, 0, Math.PI * 2);
      fCtx.closePath();
      fCtx.clip();
      const iw = portImg.naturalWidth || portImg.width || 1;
      const ih = portImg.naturalHeight || portImg.height || 1;
      const scale = Math.max((r * 2) / iw, (r * 2) / ih);
      const dw = iw * scale, dh = ih * scale;
      fCtx.drawImage(portImg, tx - dw / 2, ty - dh / 2, dw, dh);
      fCtx.restore();
    } else {
      fCtx.beginPath();
      fCtx.arc(tx, ty, r, 0, Math.PI * 2);
      fCtx.fillStyle = tok.color || '#cc3333';
      fCtx.globalAlpha = hidden ? 0.45 : 0.9;
      fCtx.fill();
      fCtx.globalAlpha = 1;
    }
    // Border ring — coloured by the token's colour when a portrait is shown.
    fCtx.beginPath();
    fCtx.arc(tx, ty, r, 0, Math.PI * 2);
    if (hidden) fCtx.setLineDash([3, 2]);
    fCtx.strokeStyle = portImg ? (tok.color || 'rgba(255,255,255,.8)') : (hidden ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.8)');
    fCtx.lineWidth = portImg ? 2 : (hidden ? 1 : 1.5);
    fCtx.stroke();
    fCtx.setLineDash([]);
    if (_selectedTokenIds.has(tok.id)) {
      fCtx.beginPath();
      fCtx.arc(tx, ty, r + 3, 0, Math.PI * 2);
      fCtx.strokeStyle = 'rgba(120,200,255,0.95)';
      fCtx.lineWidth = 2;
      fCtx.stroke();
    }
    if (!portImg) {
      const lbl = (tok.label || tok.name || '?').charAt(0).toUpperCase();
      const fontSize = Math.round(Math.min(r * 0.9, 12));
      fCtx.globalAlpha = hidden ? 0.6 : 1;
      fCtx.fillStyle = '#fff';
      fCtx.font = `bold ${fontSize}px sans-serif`;
      fCtx.textAlign = 'center';
      fCtx.textBaseline = 'middle';
      fCtx.fillText(lbl, tx, ty);
      fCtx.globalAlpha = 1;
      fCtx.textAlign = 'start';
      fCtx.textBaseline = 'alphabetic';
    }
    fCtx.fillStyle = hidden ? 'rgba(200,160,74,0.55)' : 'rgba(255,200,100,0.95)';
    fCtx.font = `${Math.max(7, Math.round(cs * 0.15))}px sans-serif`;
    fCtx.fillText(tok.name.slice(0, 14), ox + tok.x * cs + 2, oy + (tok.y + ts) * cs - 3);
  }
}

// Undo affordance shown in place of a just-deleted row (fog / token / item).
function _undoRowHTML(name) {
  return `<div style="display:flex;align-items:center;gap:6px;padding:5px 7px;margin-bottom:4px;border:1px dashed var(--a55);border-radius:4px;background:var(--a22)">
    <span style="flex:1;font-size:11px;color:var(--txd);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🗑 Deleted "${esc(name)}"</span>
    <button class="btn sm" onclick="undoDelete()" style="flex-shrink:0;font-size:10px;padding:2px 8px">↶ Undo</button>
  </div>`;
}

function _renderListFor(type) {
  if (type === 'fog') renderFogList();
  else if (type === 'token') renderTokenList();
  else if (type === 'item') renderItemList();
}

// Record a deletion as the single pending undo, replacing any previous one.
function _recordDelete(type, obj, index) {
  const prev = _lastDeleted;
  _lastDeleted = { type, obj, index };
  _renderListFor(type);
  if (prev && prev.type !== type) _renderListFor(prev.type);  // clear the stale undo row from its old list
}

function undoDelete() {
  if (!_lastDeleted) return;
  const { type, obj, index } = _lastDeleted;
  _lastDeleted = null;
  if (type === 'fog') prepState.fogRegions.splice(Math.min(index, prepState.fogRegions.length), 0, obj);
  else if (type === 'token') prepState.preparedTokens.splice(Math.min(index, prepState.preparedTokens.length), 0, obj);
  else if (type === 'item') prepState.hiddenItems.splice(Math.min(index, prepState.hiddenItems.length), 0, obj);
  _renderListFor(type);
  renderPrepFog();
  debounceSave();
}

function renderFogList() {
  const el = document.getElementById('fog-region-list');
  const rows = prepState.fogRegions.map((r, i) => `
    <div class="fog-row">
      <input type="text" value="${esc(r.label)}" onchange="updateFogLabel(${i}, this.value)"
        style="flex:1;padding:2px 5px;font-size:11px;background:var(--bg3);border:1px solid var(--a55);color:var(--tx);border-radius:3px">
      <span style="font-size:10px;color:var(--txd);white-space:nowrap">${r.w}×${r.h} cells</span>
      <button class="btn danger sm" onclick="deleteFogRegion(${i})">✕</button>
    </div>`);
  if (_lastDeleted && _lastDeleted.type === 'fog') {
    rows.splice(Math.min(_lastDeleted.index, rows.length), 0, _undoRowHTML(_lastDeleted.obj.label || 'region'));
  }
  el.innerHTML = rows.length
    ? rows.join('')
    : '<div style="font-size:11px;color:var(--txd);padding:4px 0">No regions yet. Enable draw mode and drag on the map.</div>';
}

function updateFogLabel(i, val) {
  prepState.fogRegions[i].label = val;
  renderPrepFog();
  debounceSave();
}

function deleteFogRegion(i) {
  const obj = prepState.fogRegions[i];
  prepState.fogRegions.splice(i, 1);
  renderPrepFog();
  _recordDelete('fog', obj, i);
  debounceSave();
}

function toggleItemExpand(id) {
  _expandedItemId = (_expandedItemId === id) ? null : id;
  renderItemList();
}

function renderItemList() {
  const el = document.getElementById('item-list');
  if (!el) return;
  const rows = prepState.hiddenItems.map((item, i) => {
    const expanded = _expandedItemId === item.id;
    const hasDesc = !!(item.description && item.description.trim());
    return `
    <div style="border:1px solid var(--a44);border-radius:4px;margin-bottom:4px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:4px;padding:4px 5px">
        <span style="font-size:12px;flex-shrink:0">${ITEM_TYPE_ICONS[item.type] || '?'}</span>
        <input type="text" value="${esc(item.label)}" onchange="updateItemLabel(${i}, this.value)"
          style="flex:1;min-width:0;padding:2px 5px;font-size:11px;background:var(--bg3);border:1px solid var(--a55);color:var(--tx);border-radius:3px">
        <button class="btn sm" onclick="toggleItemExpand('${escJs(item.id)}')" title="${expanded ? 'Collapse' : 'Edit description'}"
          style="padding:1px 6px;font-size:10px;flex-shrink:0;${hasDesc && !expanded ? 'color:var(--ac)' : ''}">${expanded ? '▴' : '▾'}</button>
        <button class="btn sm" onclick="cloneItem(${i})" title="Clone item" style="flex-shrink:0">⎘</button>
        <button class="btn danger sm" onclick="deleteItem(${i})" style="flex-shrink:0">✕</button>
      </div>
      ${expanded ? `<div style="padding:0 5px 5px">
        <textarea placeholder="DM description (players never see this)…" rows="2" onchange="updateItemDesc(${i}, this.value)"
          style="width:100%;box-sizing:border-box;font-size:10px;background:var(--bg3);border:1px solid var(--a44);color:var(--txd);border-radius:3px;padding:3px 5px;resize:vertical">${esc(item.description || '')}</textarea>
      </div>` : ''}
    </div>`;
  });
  if (_lastDeleted && _lastDeleted.type === 'item') {
    rows.splice(Math.min(_lastDeleted.index, rows.length), 0, _undoRowHTML(_lastDeleted.obj.label || 'item'));
  }
  el.innerHTML = rows.length
    ? rows.join('')
    : '<div style="font-size:11px;color:var(--txd);padding:4px 0">No items yet. Enable place mode and drag on the map.</div>';
}

function updateItemLabel(i, val) {
  prepState.hiddenItems[i].label = val;
  renderPrepFog();
  debounceSave();
}

function updateItemDesc(i, val) {
  prepState.hiddenItems[i].description = val;
  debounceSave();
}

function cloneItem(i) {
  const src = prepState.hiddenItems[i];
  _pendingClone = { type: src.type, label: src.label + ' (copy)', description: src.description || '', w: src.w || 1, h: src.h || 1 };
  // Enter place mode if not already active
  if (!placeItemMode) togglePlaceItemMode();
  // Update hint to indicate clone placement (the copy keeps the source size)
  const hint = document.getElementById('place-hint');
  if (hint) hint.textContent = `click to place copy of "${src.label}" (${_pendingClone.w}×${_pendingClone.h})`;
}

function deleteItem(i) {
  const obj = prepState.hiddenItems[i];
  if (_expandedItemId === obj.id) _expandedItemId = null;
  prepState.hiddenItems.splice(i, 1);
  renderPrepFog();
  _recordDelete('item', obj, i);
  debounceSave();
}

// ── Move mode ──
function _resetMoveMode() {
  moveMode = false;
  moveState = null;
  const btn = document.getElementById('btn-move');
  if (btn) { btn.style.background = ''; btn.style.color = ''; }
  const hint = document.getElementById('move-hint');
  if (hint) hint.style.display = 'none';
}

function toggleMoveMode() {
  if (!currentMapId) { showStatus('Select a map first', true); return; }
  moveMode = !moveMode;
  const btn = document.getElementById('btn-move');
  const hint = document.getElementById('move-hint');
  if (moveMode) {
    if (drawMode) toggleDrawMode();
    if (placeItemMode) togglePlaceItemMode();
    if (tokenPlacementMode) cancelTokenPlacement();
    if (btn) { btn.style.background = 'var(--ac)'; btn.style.color = 'var(--bg)'; }
    if (hint) hint.style.display = '';
    drawCvs.style.cursor = 'grab';
  } else {
    if (btn) { btn.style.background = ''; btn.style.color = ''; }
    if (hint) hint.style.display = 'none';
    moveState = null;
    drawCvs.style.cursor = 'default';
  }
  _syncDrawInteractive();
}

// ── Draw mode ──
function toggleDrawMode() {
  drawMode = !drawMode;
  const btn = document.getElementById('btn-draw-fog');
  const hint = document.getElementById('draw-hint');
  if (drawMode) _resetMoveMode();
  if (drawMode && tokenPlacementMode) cancelTokenPlacement();
  if (drawMode && placeItemMode) {
    placeItemMode = false;
    const pb = document.getElementById('btn-place-item');
    if (pb) { pb.style.background = ''; pb.style.color = ''; }
    const ph = document.getElementById('place-hint');
    if (ph) ph.style.display = 'none';
  }
  _syncDrawInteractive();
  if (drawMode) {
    btn.style.background = 'var(--ac)';
    btn.style.color = 'var(--bg)';
    hint.style.display = '';
    drawCvs.style.cursor = 'crosshair';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    hint.style.display = 'none';
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
    drawState = null;
    drawCvs.style.cursor = 'default';
  }
}

function togglePlaceItemMode() {
  placeItemMode = !placeItemMode;
  const btn = document.getElementById('btn-place-item');
  const hint = document.getElementById('place-hint');
  if (placeItemMode) _resetMoveMode();
  if (placeItemMode && tokenPlacementMode) cancelTokenPlacement();
  if (placeItemMode && drawMode) {
    drawMode = false;
    const db2 = document.getElementById('btn-draw-fog');
    if (db2) { db2.style.background = ''; db2.style.color = ''; }
    const dh = document.getElementById('draw-hint');
    if (dh) dh.style.display = 'none';
    drawState = null;
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
  }
  _syncDrawInteractive();
  if (placeItemMode) {
    btn.style.background = 'var(--ac)';
    btn.style.color = 'var(--bg)';
    hint.style.display = '';
    drawCvs.style.cursor = 'crosshair';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    hint.style.display = 'none';
    hint.textContent = 'drag to place';
    _pendingClone = null; // cancel any pending clone
    drawCvs.style.cursor = 'default';
  }
}

function pixelToGrid(e) {
  const rect = editorWrap.getBoundingClientRect();
  // Convert screen pixels to canvas pixels by dividing out viewScale
  const px = (e.clientX - rect.left) / viewScale;
  const py = (e.clientY - rect.top) / viewScale;
  const cs = prepState.cellSize || 50;
  const ox = prepState.offsetX || 0, oy = prepState.offsetY || 0;
  return {
    gx: Math.max(0, Math.floor((px - ox) / cs)),
    gy: Math.max(0, Math.floor((py - oy) / cs))
  };
}

// Draw canvas captures pointer whenever a map is loaded so draw/place/token
// placement AND the default drag-to-move tool all work.
function _syncDrawInteractive() {
  drawCvs.style.pointerEvents = currentMapId ? 'all' : 'none';
}

// Hit-test grid cell (gx,gy) against placed objects, top-most first.
// Priority: tokens > hidden items > fog regions (matches visual stacking).
function _hitTestObject(gx, gy) {
  for (let i = prepState.preparedTokens.length - 1; i >= 0; i--) {
    const t = prepState.preparedTokens[i];
    const ts = Math.max(1, t.tokenSize || 1);
    if (gx >= t.x && gx < t.x + ts && gy >= t.y && gy < t.y + ts) return { type: 'token', index: i };
  }
  for (let i = (prepState.hiddenItems || []).length - 1; i >= 0; i--) {
    const it = prepState.hiddenItems[i];
    const w = it.w || 1, h = it.h || 1;
    if (gx >= it.x && gx < it.x + w && gy >= it.y && gy < it.y + h) return { type: 'item', index: i };
  }
  for (let i = prepState.fogRegions.length - 1; i >= 0; i--) {
    const r = prepState.fogRegions[i];
    if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) return { type: 'fog', index: i };
  }
  return null;
}

function _objForHit(hit) {
  if (hit.type === 'token') return prepState.preparedTokens[hit.index];
  if (hit.type === 'item') return prepState.hiddenItems[hit.index];
  return prepState.fogRegions[hit.index];
}

// Dashed outline on the draw canvas marking the object currently being dragged.
function _drawMoveHighlight(obj, type) {
  const cs = (prepState.cellSize || 50) * viewScale;
  const ox = (prepState.offsetX || 0) * viewScale;
  const oy = (prepState.offsetY || 0) * viewScale;
  let w, h;
  if (type === 'token') { const ts = Math.max(1, obj.tokenSize || 1); w = ts; h = ts; }
  else { w = obj.w || 1; h = obj.h || 1; }
  dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
  dCtx.setLineDash([5, 4]);
  dCtx.strokeStyle = 'rgba(120,200,255,0.95)';
  dCtx.lineWidth = 2;
  dCtx.strokeRect(ox + obj.x * cs, oy + obj.y * cs, w * cs, h * cs);
  dCtx.setLineDash([]);
}

// Use pointer events + setPointerCapture so the drag continues even when
// the mouse leaves the canvas boundary (fixes "restarts draw" on remote).
drawCvs.addEventListener('pointerdown', e => {
  // Ctrl/Shift-click toggles token selection (for bulk recolor). Works in move/idle,
  // not while actively drawing fog / placing items / placing a token.
  if ((e.ctrlKey || e.metaKey || e.shiftKey) && !drawMode && !placeItemMode && !tokenPlacementMode) {
    if (!currentMapId) return;
    const g = pixelToGrid(e);
    const hit = _hitTestObject(g.gx, g.gy);
    if (hit && hit.type === 'token') {
      e.preventDefault();
      const id = prepState.preparedTokens[hit.index].id;
      if (_selectedTokenIds.has(id)) _selectedTokenIds.delete(id); else _selectedTokenIds.add(id);
      renderTokenList();
      renderPrepFog();
    }
    return;
  }
  if (moveMode) {
    // Move tool: drag an existing token / item / fog region to reposition it.
    if (!currentMapId) return;
    const g = pixelToGrid(e);
    const hit = _hitTestObject(g.gx, g.gy);
    if (!hit) return;
    e.preventDefault();
    drawCvs.setPointerCapture(e.pointerId);
    const obj = _objForHit(hit);
    moveState = { type: hit.type, index: hit.index, startGX: g.gx, startGY: g.gy, origX: obj.x, origY: obj.y, moved: false };
    drawCvs.style.cursor = 'grabbing';
    return;
  }
  if (!drawMode && !placeItemMode && !tokenPlacementMode) return;
  e.preventDefault();
  drawCvs.setPointerCapture(e.pointerId);
  const { gx, gy } = pixelToGrid(e);
  drawState = { startGX: gx, startGY: gy };
});

drawCvs.addEventListener('pointermove', e => {
  if (moveState) {
    const { gx, gy } = pixelToGrid(e);
    const dx = gx - moveState.startGX, dy = gy - moveState.startGY;
    if (dx || dy) moveState.moved = true;
    const obj = _objForHit(moveState);
    if (obj) {
      obj.x = Math.max(0, moveState.origX + dx);
      obj.y = Math.max(0, moveState.origY + dy);
      renderPrepFog();
      _drawMoveHighlight(obj, moveState.type);
    }
    return;
  }
  if (moveMode) {
    // Hover feedback: grab cursor over a draggable object.
    const g = pixelToGrid(e);
    drawCvs.style.cursor = _hitTestObject(g.gx, g.gy) ? 'grab' : 'default';
    return;
  }
  if (tokenPlacementMode) return; // no drag preview for token placement
  if ((!drawMode && !placeItemMode) || !drawState) return;
  const { gx, gy } = pixelToGrid(e);
  const minX = Math.min(drawState.startGX, gx);
  const minY = Math.min(drawState.startGY, gy);
  const w = Math.abs(gx - drawState.startGX) + 1;
  const h = Math.abs(gy - drawState.startGY) + 1;
  const cs = (prepState.cellSize || 50) * viewScale;
  const ox = (prepState.offsetX || 0) * viewScale;
  const oy = (prepState.offsetY || 0) * viewScale;
  dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
  dCtx.setLineDash([4, 3]);
  dCtx.strokeStyle = placeItemMode ? 'rgba(220,60,60,0.9)' : 'rgba(200,160,74,0.9)';
  dCtx.lineWidth = 2;
  dCtx.strokeRect(ox + minX * cs, oy + minY * cs, w * cs, h * cs);
  dCtx.fillStyle = placeItemMode ? 'rgba(220,60,60,0.15)' : 'rgba(200,160,74,0.15)';
  dCtx.fillRect(ox + minX * cs, oy + minY * cs, w * cs, h * cs);
  dCtx.setLineDash([]);
});

drawCvs.addEventListener('pointerup', e => {
  if (moveState) {
    const moved = moveState.moved;
    moveState = null;
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
    drawCvs.style.cursor = 'grab';
    if (moved) { renderPrepFog(); renderFogList(); renderItemList(); renderTokenList(); debounceSave(); }
    return;
  }
  if (tokenPlacementMode && drawState) {
    const { gx, gy } = pixelToGrid(e);
    drawState = null;
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
    _placePrepToken(gx, gy);
    return;
  }
  if ((!drawMode && !placeItemMode) || !drawState) return;
  const { gx, gy } = pixelToGrid(e);
  const minX = Math.min(drawState.startGX, gx);
  const minY = Math.min(drawState.startGY, gy);
  const w = Math.abs(gx - drawState.startGX) + 1;
  const h = Math.abs(gy - drawState.startGY) + 1;
  drawState = null;
  dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
  if (placeItemMode) {
    if (_pendingClone) {
      // Place the cloned item at the drop position, keeping the source's size
      // (w/h carried on _pendingClone, NOT the dragged rectangle).
      prepState.hiddenItems.push({ id: genId(), ..._pendingClone, x: minX, y: minY, visible: false });
      _pendingClone = null;
      togglePlaceItemMode(); // exit place mode after placing clone
    } else {
      const type = document.getElementById('item-type-sel')?.value || 'other';
      const typeLabels = { trap: 'Trap', chest: 'Chest', door: 'Door', note: 'Note', other: 'Item' };
      prepState.hiddenItems.push({
        id: genId(),
        label: (typeLabels[type] || 'Item') + ' ' + (prepState.hiddenItems.length + 1),
        type, x: minX, y: minY, w, h, description: '', visible: false
      });
    }
    renderPrepFog();
    renderItemList();
  } else {
    prepState.fogRegions.push({
      id: genId(),
      label: 'Region ' + (prepState.fogRegions.length + 1),
      x: minX, y: minY, w, h, visible: false
    });
    renderPrepFog();
    renderFogList();
  }
  debounceSave();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (moveState) {
      const obj = _objForHit(moveState);
      if (obj) { obj.x = moveState.origX; obj.y = moveState.origY; }
      moveState = null;
      dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
      drawCvs.style.cursor = 'default';
      renderPrepFog();
      return;
    }
    if (tokenPlacementMode) { cancelTokenPlacement(); }
    if (placeItemMode && _pendingClone) { _pendingClone = null; togglePlaceItemMode(); }
  }
});

// ── Grid controls ──
function onGridChange() {
  prepState.cellSize = parseInt(document.getElementById('prep-cell-size').value) || 50;
  document.getElementById('prep-cell-val').textContent = prepState.cellSize + ' px';
  prepState.offsetX = parseInt(document.getElementById('prep-offset-x').value) || 0;
  prepState.offsetY = parseInt(document.getElementById('prep-offset-y').value) || 0;
  renderPrepGrid();
  renderPrepFog();
  debounceSave();
}

// ── Save / CRUD ──
function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMap, 600);
}

async function saveMap() {
  if (!currentMapId) return;
  clearTimeout(saveTimer);
  prepState.name = document.getElementById('map-name').value;
  const body = {
    name: prepState.name,
    cellSize: prepState.cellSize,
    offsetX: prepState.offsetX,
    offsetY: prepState.offsetY,
    fogRegions: prepState.fogRegions,
    hiddenItems: prepState.hiddenItems,
    preparedTokens: prepState.preparedTokens,
  };
  try {
    const res = await fetch(`/api/prepared-maps/${currentMapId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify(body)
    });
    if (!res.ok) { showStatus('Save failed', true); return; }
    showStatus('Saved', false);
    const idx = maps.findIndex(m => m.id === currentMapId);
    if (idx >= 0) {
      maps[idx].name = prepState.name;
      maps[idx].fogRegions = prepState.fogRegions;
      maps[idx].hiddenItems = prepState.hiddenItems;
      maps[idx].preparedTokens = prepState.preparedTokens;
      renderMapList();
    }
  } catch { showStatus('Save error', true); }
}

async function newMap() {
  try {
    const res = await fetch('/api/prepared-maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name: 'New Map' })
    });
    if (!res.ok) { showStatus('Could not create map', true); return; }
    const data = await res.json();
    await loadMaps();
    selectMap(data.id);
  } catch { showStatus('Error creating map', true); }
}

async function deleteMap() {
  if (!currentMapId) return;
  if (!confirm('Delete this map? This cannot be undone.')) return;
  try {
    await fetch(`/api/prepared-maps/${currentMapId}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    currentMapId = null;
    prepState = { name: '', cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, fogRegions: [], hiddenItems: [] };
    await loadMaps();
    document.getElementById('editor-placeholder').style.display = '';
    document.getElementById('pm-toolbar').style.display = 'none';
    document.getElementById('pm-controls').style.display = 'none';
  } catch { showStatus('Error deleting map', true); }
}

function loadToTable() {
  if (!currentMapId) return;
  const count = prepState.preparedTokens.length;
  const note = document.getElementById('load-confirm-tok-note');
  if (note) {
    note.textContent = count > 0
      ? `${count} prepared token${count !== 1 ? 's' : ''} from this map will be placed.`
      : 'This map has no prepared tokens — the table will be empty after loading.';
  }
  document.getElementById('load-confirm-modal').style.display = 'flex';
}

function closeLoadConfirmModal() {
  document.getElementById('load-confirm-modal').style.display = 'none';
}

async function confirmLoadToTable() {
  closeLoadConfirmModal();
  try {
    const res = await fetch(`/api/prepared-maps/${currentMapId}/load-to-table`, {
      method: 'POST',
      headers: { 'X-Master-Password': masterPw }
    });
    if (!res.ok) { showStatus('Load to table failed', true); return; }
    const data = await res.json();
    showStatus(`Map loaded! ${data.tokensPlaced || 0} token(s) placed.`, false);
  } catch { showStatus('Error loading to table', true); }
}

// ── Export / Import ──
async function exportMap() {
  if (!currentMapId) return;
  await saveMap();
  showStatus('Exporting…', false);
  let imageDataUrl = null;
  try {
    const imgRes = await fetch(`/api/prepared-maps/${currentMapId}/image`);
    if (imgRes.ok) {
      const blob = await imgRes.blob();
      imageDataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(blob);
      });
    }
  } catch {}
  const payload = {
    version: 1,
    name: prepState.name,
    cellSize: prepState.cellSize,
    offsetX: prepState.offsetX,
    offsetY: prepState.offsetY,
    mapWidth: prepState.mapWidth,
    mapHeight: prepState.mapHeight,
    fogRegions: prepState.fogRegions,
    hiddenItems: prepState.hiddenItems,
    image: imageDataUrl
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (prepState.name || 'map').replace(/[^a-zA-Z0-9_\-]/g, '_') + '.map.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Exported!', false);
}

function importMap() {
  document.getElementById('map-import-input').click();
}

async function handleImportFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  showStatus('Importing…', false);
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.version !== 1) { showStatus('Invalid map file', true); return; }

    // 1. Create the map record
    const createRes = await fetch('/api/prepared-maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name: data.name || 'Imported Map' })
    });
    if (!createRes.ok) { showStatus('Import failed', true); return; }
    const { id } = await createRes.json();

    // 2. Upload image if present
    if (data.image && data.image.startsWith('data:image/')) {
      await fetch(`/api/prepared-maps/${id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ dataUrl: data.image, mapWidth: data.mapWidth || 0, mapHeight: data.mapHeight || 0 })
      });
    }

    // 3. Save grid settings, fog regions, hidden items
    await fetch(`/api/prepared-maps/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({
        name: data.name || 'Imported Map',
        cellSize: data.cellSize || 50,
        offsetX: data.offsetX || 0,
        offsetY: data.offsetY || 0,
        fogRegions: data.fogRegions || [],
        hiddenItems: data.hiddenItems || []
      })
    });

    await loadMaps();
    selectMap(id);
    // Ensure sidebar is open so user can see the new map
    const sidebar = document.getElementById('pm-sidebar');
    if (sidebar && sidebar.style.display === 'none') togglePmSidebar();
    showStatus('Imported!', false);
  } catch (e) {
    showStatus('Import error: ' + e.message, true);
  }
}

// ── Image upload ──
async function handleImageUpload(input) {
  if (!currentMapId || !input.files[0]) return;
  const file = input.files[0];
  input.value = '';
  const overlay = document.getElementById('pm-upload-overlay');
  const imgBtn  = document.getElementById('pm-img-btn');
  const imgStatus = document.getElementById('img-status');
  if (overlay) overlay.style.display = 'flex';
  if (imgBtn)  imgBtn.disabled = true;
  imgStatus.textContent = '';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const res = await fetch(`/api/prepared-maps/${currentMapId}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ dataUrl, mapWidth: img.naturalWidth, mapHeight: img.naturalHeight })
    });
    if (!res.ok) { imgStatus.textContent = 'Upload failed'; showStatus('Image upload failed', true); return; }
    prepState.mapWidth = img.naturalWidth;
    prepState.mapHeight = img.naturalHeight;
    const idx = maps.findIndex(m => m.id === currentMapId);
    if (idx >= 0) {
      maps[idx].hasImage = true;
      maps[idx].mapWidth = prepState.mapWidth;
      maps[idx].mapHeight = prepState.mapHeight;
      renderMapList();
    }
    renderEditor();
    showStatus('Map image uploaded', false);
  } catch { imgStatus.textContent = 'Upload error'; showStatus('Upload error', true); }
  finally {
    if (overlay) overlay.style.display = 'none';
    if (imgBtn)  imgBtn.disabled = false;
  }
}

// ── Prepared Tokens ──────────────────────────────────────────────────────────
async function loadPmMonsters() {
  if (pmMonsterLoaded) return;
  const listEl = document.getElementById('pm-mon-list');
  try {
    const res = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
    if (res.ok) pmMonsterList = await res.json();
    pmMonsterLoaded = true;
  } catch {}
  pmRenderMonsterList('');
}

function pmRenderMonsterList(query) {
  const el = document.getElementById('pm-mon-list');
  if (!el) return;
  const q = (query || '').toLowerCase().trim();
  const list = q ? pmMonsterList.filter(m => m.name.toLowerCase().includes(q)) : pmMonsterList;
  if (!pmMonsterLoaded) { el.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--txd)">Loading…</div>'; return; }
  if (!list.length) { el.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--txd)">No monsters found.</div>'; return; }
  el.innerHTML = list.slice(0, 60).map(m =>
    `<div onclick="pmSelectMonster('${escJs(m.id)}')" data-mid="${esc(m.id)}"
      style="padding:5px 8px;border-bottom:1px solid var(--sep);font-size:11px;cursor:pointer;display:flex;align-items:center;gap:6px">
      <span style="flex:1">${esc(m.name)}</span>
      <span style="font-size:10px;color:var(--txd)">CR ${esc(String(m.cr||'?'))}</span>
    </div>`
  ).join('');
  if (pmSelectedMonsterId) {
    const row = el.querySelector(`[data-mid="${CSS.escape(pmSelectedMonsterId)}"]`);
    if (row) row.style.background = 'var(--a22)';
    const mon = pmMonsterList.find(m => m.id === pmSelectedMonsterId);
    if (mon) {
      const sel = document.getElementById('pm-mon-selected');
      if (sel && sel.textContent !== `✓ ${mon.name}`) { sel.textContent = `✓ ${mon.name}`; sel.style.color = 'var(--ok)'; }
    }
  }
}

function pmFilterMonsters(query) { pmRenderMonsterList(query); }

function pmSelectMonster(id) {
  pmSelectedMonsterId = id;
  const mon = pmMonsterList.find(m => m.id === id);
  if (!mon) return;
  document.querySelectorAll('#pm-mon-list [data-mid]').forEach(r => r.style.background = '');
  const row = document.querySelector(`#pm-mon-list [data-mid="${CSS.escape(id)}"]`);
  if (row) row.style.background = 'var(--a22)';
  const sel = document.getElementById('pm-mon-selected');
  if (sel) { sel.textContent = `✓ ${mon.name}`; sel.style.color = 'var(--ok)'; }
  const d = mon.data || {};
  const hp = (d.hp?.average) ?? (typeof d.hp === 'number' ? d.hp : 10);
  const spd = d.speed?.walk || (typeof d.speed === 'string' ? parseInt(d.speed) : null) || 30;
  const rawAc = [].concat(d.ac || [])[0];
  const monAc = typeof rawAc === 'number' ? rawAc : (rawAc?.ac ?? null);
  const hpEl = document.getElementById('pm-tok-hp');
  const spdEl = document.getElementById('pm-tok-speed');
  const acEl  = document.getElementById('pm-tok-ac');
  if (hpEl) hpEl.value = hp;
  if (spdEl) spdEl.value = spd;
  if (acEl)  acEl.value = monAc != null ? monAc : '';
}

function pmSwitchTab(tab) {
  pmCurrentTab = tab;
  document.getElementById('pm-tab-monster').style.display = tab === 'monster' ? '' : 'none';
  document.getElementById('pm-tab-custom').style.display  = tab === 'custom'  ? '' : 'none';
  const colorEl = document.getElementById('pm-tok-color');
  if (colorEl) colorEl.value = tab === 'monster' ? '#c0392b' : '#607d8b';
  pmRenderColorSwatches();
}

// Render the 16-swatch picker inside the add/edit token modal, highlighting the current pick.
function pmRenderColorSwatches() {
  const grid = document.getElementById('pm-tok-color-swatches');
  if (!grid) return;
  const cur = document.getElementById('pm-tok-color')?.value || '';
  grid.innerHTML = _swatchGridHTML(cur, 'pmSetTokColor');
}

function pmSetTokColor(c) {
  const inp = document.getElementById('pm-tok-color');
  if (inp) inp.value = c;
  pmRenderColorSwatches();
}

function openPmTokModal(editIdx) {
  if (!currentMapId) { showStatus('Select a map first', true); return; }
  _editTokenIndex = (typeof editIdx === 'number') ? editIdx : null;
  const isEdit = _editTokenIndex !== null;
  const tok = isEdit ? prepState.preparedTokens[_editTokenIndex] : null;

  const titleEl = document.getElementById('pm-tok-modal-title');
  if (titleEl) titleEl.textContent = isEdit ? 'Edit Token' : 'Add Prepared Token';
  const confirmBtn = document.getElementById('pm-tok-confirm-btn');
  if (confirmBtn) confirmBtn.textContent = isEdit ? '💾 Save Changes' : '📍 Place on Map';

  pmPortraitDataUrl = null;

  if (isEdit && tok) {
    pmCurrentTab = tok.type === 'monster' ? 'monster' : 'custom';
    pmSelectedMonsterId = tok.type === 'monster' ? (tok.linkedId || null) : null;
    document.getElementById('pm-tab-monster').style.display = pmCurrentTab === 'monster' ? '' : 'none';
    document.getElementById('pm-tab-custom').style.display  = pmCurrentTab === 'custom'  ? '' : 'none';
    if (pmCurrentTab === 'monster') {
      const iEl = document.getElementById('pm-tok-identifier'); if (iEl) iEl.value = tok.label || '';
      const hpEl = document.getElementById('pm-tok-hp'); if (hpEl) hpEl.value = tok.hpMax || 10;
      const spdEl = document.getElementById('pm-tok-speed'); if (spdEl) spdEl.value = tok.speed || 30;
      const acEl = document.getElementById('pm-tok-ac'); if (acEl) acEl.value = tok.ac != null ? tok.ac : '';
      const sel = document.getElementById('pm-mon-selected');
      if (sel) { sel.textContent = 'Loading…'; sel.style.color = 'var(--txd)'; }
      const search = document.getElementById('pm-mon-search'); if (search) search.value = '';
    } else {
      const nameEl = document.getElementById('pm-tok-custom-name'); if (nameEl) nameEl.value = tok.name || '';
      const hpEl = document.getElementById('pm-tok-custom-hp'); if (hpEl) hpEl.value = tok.hpMax || 10;
      const spdEl = document.getElementById('pm-tok-custom-speed'); if (spdEl) spdEl.value = tok.speed || 30;
    }
    const colorEl = document.getElementById('pm-tok-color'); if (colorEl) colorEl.value = tok.color || '#c0392b';
    const sizeEl  = document.getElementById('pm-tok-size');  if (sizeEl)  sizeEl.value  = String(tok.tokenSize || 1);
    const visEl   = document.getElementById('pm-tok-visible');
    if (visEl) { visEl.checked = tok.visibleToPlayers !== false; }
    _updateVisibleLbl();
    if (tok.portrait) { pmPortraitDataUrl = tok.portrait; _setPmPortraitPreview(tok.portrait); }
    else { _clearPmPortraitPreview(); }
  } else {
    pmSelectedMonsterId = null;
    pmCurrentTab = 'monster';
    document.getElementById('pm-tab-monster').style.display = '';
    document.getElementById('pm-tab-custom').style.display  = 'none';
    const sel = document.getElementById('pm-mon-selected');
    if (sel) { sel.textContent = 'No monster selected'; sel.style.color = 'var(--txd)'; }
    const search = document.getElementById('pm-mon-search'); if (search) search.value = '';
    ['pm-tok-identifier','pm-tok-custom-name'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const hpEl = document.getElementById('pm-tok-hp'); if (hpEl) hpEl.value = 10;
    const spdEl = document.getElementById('pm-tok-speed'); if (spdEl) spdEl.value = 30;
    const acEl = document.getElementById('pm-tok-ac'); if (acEl) acEl.value = '';
    const colorEl = document.getElementById('pm-tok-color'); if (colorEl) colorEl.value = '#c0392b';
    const sizeEl  = document.getElementById('pm-tok-size');  if (sizeEl)  sizeEl.value  = '1';
    const visEl   = document.getElementById('pm-tok-visible'); if (visEl) visEl.checked = true;
    _updateVisibleLbl();
    _clearPmPortraitPreview();
  }
  pmRenderColorSwatches();
  document.getElementById('pm-tok-modal').style.display = 'flex';
  loadPmMonsters();
}

function closePmTokModal() {
  document.getElementById('pm-tok-modal').style.display = 'none';
  _editTokenIndex = null;
  pmPortraitDataUrl = null;
}

function _updateVisibleLbl() {
  const cb  = document.getElementById('pm-tok-visible');
  const lbl = document.getElementById('pm-tok-visible-lbl');
  if (!lbl) return;
  const on = cb ? cb.checked : true;
  lbl.textContent = on ? '👁 Visible' : '🚫 Hidden';
  lbl.style.color = on ? 'var(--ok)' : 'var(--txd)';
}

function _setPmPortraitPreview(src) {
  const img   = document.getElementById('pm-portrait-img');
  const empty = document.getElementById('pm-portrait-empty');
  const clrBtn = document.getElementById('pm-portrait-clear-btn');
  if (img)   { img.src = src; img.style.display = 'block'; }
  if (empty) empty.style.display = 'none';
  if (clrBtn) clrBtn.style.display = '';
}

function _clearPmPortraitPreview() {
  const img   = document.getElementById('pm-portrait-img');
  const empty = document.getElementById('pm-portrait-empty');
  const clrBtn = document.getElementById('pm-portrait-clear-btn');
  if (img)   { img.src = ''; img.style.display = 'none'; }
  if (empty) empty.style.display = '';
  if (clrBtn) clrBtn.style.display = 'none';
}

function clearPmPortrait() {
  pmPortraitDataUrl = null;
  _clearPmPortraitPreview();
}

async function handlePmPortraitUpload(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    pmPortraitDataUrl = await _resizePmPortrait(dataUrl, 128);
    _setPmPortraitPreview(pmPortraitDataUrl);
  } catch { showStatus('Portrait upload failed', true); }
}

function _resizePmPortrait(dataUrl, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
      const nw = Math.round(img.naturalWidth * ratio);
      const nh = Math.round(img.naturalHeight * ratio);
      const cvs = document.createElement('canvas');
      cvs.width = nw; cvs.height = nh;
      cvs.getContext('2d').drawImage(img, 0, 0, nw, nh);
      resolve(cvs.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function pmConfirmToken() {
  const visibleToPlayers = document.getElementById('pm-tok-visible')?.checked !== false;
  let config;
  if (pmCurrentTab === 'monster') {
    const mon = pmMonsterList.find(m => m.id === pmSelectedMonsterId);
    if (!mon) { showStatus('Select a monster first', true); return; }
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let identifier = (document.getElementById('pm-tok-identifier')?.value || '').trim();
    if (!identifier) identifier = letters[Math.floor(Math.random() * letters.length)] + (Math.floor(Math.random() * 9) + 1);
    const hp  = parseInt(document.getElementById('pm-tok-hp')?.value) || 10;
    const spd = parseInt(document.getElementById('pm-tok-speed')?.value) || 30;
    const acRaw = (document.getElementById('pm-tok-ac')?.value || '').trim();
    const ac = acRaw !== '' ? (parseInt(acRaw) || null) : null;
    const portrait = pmPortraitDataUrl || mon.data?.portrait || null;
    const portraitThumb = pmPortraitDataUrl ? null : (mon.data?.portraitThumb || null);
    config = {
      id: genId(), name: `${mon.name} ${identifier}`, label: identifier,
      type: 'monster', linkedId: mon.id,
      hpCurrent: hp, hpMax: hp, speed: spd, ac, visibleToPlayers,
      color: document.getElementById('pm-tok-color')?.value || '#cc3333',
      tokenSize: parseInt(document.getElementById('pm-tok-size')?.value) || 1,
      portrait, portraitThumb,
    };
  } else {
    const name = (document.getElementById('pm-tok-custom-name')?.value || '').trim();
    if (!name) { showStatus('Name is required', true); return; }
    const hp  = parseInt(document.getElementById('pm-tok-custom-hp')?.value) || 10;
    const spd = parseInt(document.getElementById('pm-tok-custom-speed')?.value) || 30;
    config = {
      id: genId(), name, label: '', type: 'custom', linkedId: '',
      hpCurrent: hp, hpMax: hp, speed: spd, ac: null, visibleToPlayers,
      color: document.getElementById('pm-tok-color')?.value || '#888888',
      tokenSize: parseInt(document.getElementById('pm-tok-size')?.value) || 1,
      portrait: pmPortraitDataUrl || null, portraitThumb: null,
    };
  }
  if (_editTokenIndex !== null) {
    const existing = prepState.preparedTokens[_editTokenIndex];
    prepState.preparedTokens[_editTokenIndex] = { ...config, id: existing.id, x: existing.x, y: existing.y };
    closePmTokModal();
    renderPrepFog();
    renderTokenList();
    debounceSave();
  } else {
    closePmTokModal();
    enterTokenPlacementMode(config);
  }
}

function enterTokenPlacementMode(config) {
  if (drawMode) toggleDrawMode();
  if (placeItemMode) togglePlaceItemMode();
  _resetMoveMode();
  tokenPlacementMode = true;
  pendingTokenConfig = config;
  drawCvs.style.pointerEvents = 'all';
  drawCvs.style.cursor = 'crosshair';
  const hint = document.getElementById('pm-tok-place-hint');
  if (hint) hint.style.display = '';
  const cancelBtn = document.getElementById('pm-cancel-place-btn');
  if (cancelBtn) cancelBtn.style.display = '';
  showStatus(`Click on map to place ${config.name}`, false);
}

function cancelTokenPlacement() {
  tokenPlacementMode = false;
  pendingTokenConfig = null;
  _syncDrawInteractive();
  drawCvs.style.cursor = 'default';
  const hint = document.getElementById('pm-tok-place-hint');
  if (hint) hint.style.display = 'none';
  const cancelBtn = document.getElementById('pm-cancel-place-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function _placePrepToken(gx, gy) {
  if (!pendingTokenConfig) return;
  prepState.preparedTokens.push({ ...pendingTokenConfig, x: gx, y: gy });
  cancelTokenPlacement();
  renderPrepFog();
  renderTokenList();
  debounceSave();
}

function deleteToken(i) {
  const obj = prepState.preparedTokens[i];
  _selectedTokenIds.delete(obj.id);
  prepState.preparedTokens.splice(i, 1);
  renderPrepFog();
  _recordDelete('token', obj, i);
  debounceSave();
}

function _randomTokenIdentifier() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return letters[Math.floor(Math.random() * letters.length)] + (Math.floor(Math.random() * 9) + 1);
}

function cloneToken(i) {
  const src = prepState.preparedTokens[i];
  if (!src) return;
  const config = JSON.parse(JSON.stringify(src));
  config.id = genId();
  delete config.x; delete config.y;  // position is chosen by clicking the map
  // Give the copy a fresh identifier so it doesn't collide with the original.
  if (config.label) {
    const oldLabel = config.label;
    const base = config.name && config.name.endsWith(' ' + oldLabel)
      ? config.name.slice(0, -(oldLabel.length + 1))
      : config.name;
    config.label = _randomTokenIdentifier();
    config.name = (base ? base + ' ' : '') + config.label;
  }
  enterTokenPlacementMode(config);
}

// ── Token multi-select + bulk recolor ──
function _selectedTokenCount() {
  return prepState.preparedTokens.filter(t => _selectedTokenIds.has(t.id)).length;
}

function toggleTokenSelect(id, checked) {
  if (checked) _selectedTokenIds.add(id); else _selectedTokenIds.delete(id);
  renderTokenList();
  renderPrepFog();
}

function toggleSelectAllTokens(checked) {
  _selectedTokenIds.clear();
  if (checked) prepState.preparedTokens.forEach(t => _selectedTokenIds.add(t.id));
  renderTokenList();
  renderPrepFog();
}

function openRecolorPopup() {
  if (!_selectedTokenCount()) { showStatus('Select tokens first', true); return; }
  const grid = document.getElementById('pm-recolor-swatches');
  if (grid) grid.innerHTML = _swatchGridHTML(null, 'applyBulkColor');
  const cnt = document.getElementById('pm-recolor-count');
  if (cnt) cnt.textContent = _selectedTokenCount();
  const pop = document.getElementById('pm-recolor-popup');
  if (pop) pop.style.display = 'flex';
}

function closeRecolorPopup() {
  const pop = document.getElementById('pm-recolor-popup');
  if (pop) pop.style.display = 'none';
}

function applyBulkColor(c) {
  prepState.preparedTokens.forEach(t => { if (_selectedTokenIds.has(t.id)) t.color = c; });
  closeRecolorPopup();
  renderPrepFog();
  renderTokenList();
  debounceSave();
}

function renderTokenList() {
  const el = document.getElementById('pm-token-list');
  if (!el) return;
  const countEl = document.getElementById('pm-tok-count');
  const count = prepState.preparedTokens.length;
  if (countEl) countEl.textContent = count > 0 ? `(${count})` : '';
  const rows = prepState.preparedTokens.map((tok, i) => {
    const hidden = tok.visibleToPlayers === false;
    const sel = _selectedTokenIds.has(tok.id);
    return `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--sep)${sel ? ';background:var(--a22)' : ''}">
      <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleTokenSelect('${escJs(tok.id)}', this.checked)" title="Select for recolor" style="cursor:pointer;flex-shrink:0;width:13px;height:13px">
      <div style="width:11px;height:11px;border-radius:50%;background:${esc(tok.color)};flex-shrink:0;border:1px solid rgba(255,255,255,.3);${hidden ? 'opacity:0.4' : ''}"></div>
      <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(tok.name)}">${esc(tok.name)}</span>
      <span title="${hidden ? 'Hidden from players' : 'Visible to players'}" style="font-size:10px;flex-shrink:0;${hidden ? 'color:var(--txd)' : 'color:var(--ok)'}">${hidden ? '🚫' : '👁'}</span>
      <button class="btn sm" onclick="cloneToken(${i})" title="Duplicate token" style="padding:1px 5px;font-size:10px;flex-shrink:0">⎘</button>
      <button class="btn sm" onclick="openPmTokModal(${i})" style="padding:1px 5px;font-size:10px;flex-shrink:0" title="Edit">✏</button>
      <button class="btn danger sm" onclick="deleteToken(${i})" style="padding:1px 5px;font-size:10px;flex-shrink:0">✕</button>
    </div>`;
  });
  if (_lastDeleted && _lastDeleted.type === 'token') {
    rows.splice(Math.min(_lastDeleted.index, rows.length), 0, _undoRowHTML(_lastDeleted.obj.name || 'token'));
  }
  if (!count) {
    el.innerHTML = rows.length
      ? rows.join('')
      : '<div style="font-size:11px;color:var(--txd);padding:4px 0">No tokens yet. Click + Add Token above.</div>';
    return;
  }
  const selCount = _selectedTokenCount();
  const allChecked = selCount > 0 && selCount === count;
  const controls = `<div style="display:flex;align-items:center;gap:6px;padding:2px 0 5px;border-bottom:1px solid var(--sep);margin-bottom:3px">
    <label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--txd);cursor:pointer">
      <input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleSelectAllTokens(this.checked)" style="cursor:pointer;width:13px;height:13px"> all
    </label>
    <span style="flex:1"></span>
    <button class="btn sm" onclick="openRecolorPopup()" ${selCount ? '' : 'disabled'} title="Recolor selected tokens"
      style="font-size:10px;padding:2px 8px;flex-shrink:0;${selCount ? '' : 'opacity:.45'}">🎨 Recolor${selCount ? ` (${selCount})` : ''}</button>
  </div>`;
  el.innerHTML = controls + rows.join('');
}
