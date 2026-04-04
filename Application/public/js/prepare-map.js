'use strict';

let masterPw = '';
let currentMapId = null;
let maps = [];
let prepState = { name: '', cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, fogRegions: [], hiddenItems: [] };
let drawMode = false;
let drawState = null;
let placeItemMode = false;
let _pendingClone = null; // item data waiting for user to draw its position
let saveTimer = null;
let viewScale = 1;

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
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
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
  const el = document.getElementById('map-list');
  if (!maps.length) { el.innerHTML = '<div class="no-map-msg">No maps yet.</div>'; return; }
  el.innerHTML = maps.map(m => {
    const regionCount = Array.isArray(m.fogRegions) ? m.fogRegions.length : 0;
    const itemCount = Array.isArray(m.hiddenItems) ? m.hiddenItems.length : 0;
    const sel = m.id === currentMapId ? 'selected' : '';
    return `<div class="map-list-row ${sel}" onclick="selectMap('${esc(m.id)}')">
      <div style="flex:1;overflow:hidden">
        <div class="map-list-name">${esc(m.name || 'Untitled')}</div>
        <div class="map-list-meta">${m.hasImage ? '🖼 · ' : ''}${regionCount} fog · ${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function selectMap(id) {
  const m = maps.find(x => x.id === id);
  if (!m) return;
  currentMapId = id;
  prepState = {
    name: m.name || '',
    cellSize: m.cellSize || 50,
    offsetX: m.offsetX || 0,
    offsetY: m.offsetY || 0,
    mapWidth: m.mapWidth || 0,
    mapHeight: m.mapHeight || 0,
    fogRegions: Array.isArray(m.fogRegions) ? JSON.parse(JSON.stringify(m.fogRegions)) : [],
    hiddenItems: Array.isArray(m.hiddenItems) ? JSON.parse(JSON.stringify(m.hiddenItems)) : []
  };
  drawMode = false;
  drawState = null;
  placeItemMode = false;
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
  drawCvs.style.pointerEvents = 'none';
  drawMode = false;
  drawState = null;
  placeItemMode = false;

  if (prepState.mapWidth && prepState.mapHeight) {
    prepImg.src = `/api/prepared-maps/${currentMapId}/image?t=${Date.now()}`;
    prepImg.style.display = '';
  } else {
    prepImg.style.display = 'none';
  }

  refreshCanvases();
  renderFogList();
  renderItemList();
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
}

function renderFogList() {
  const el = document.getElementById('fog-region-list');
  if (!prepState.fogRegions.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--txd);padding:4px 0">No regions yet. Enable draw mode and drag on the map.</div>';
    return;
  }
  el.innerHTML = prepState.fogRegions.map((r, i) => `
    <div class="fog-row">
      <input type="text" value="${esc(r.label)}" onchange="updateFogLabel(${i}, this.value)"
        style="flex:1;padding:2px 5px;font-size:11px;background:var(--bg3);border:1px solid var(--a55);color:var(--tx);border-radius:3px">
      <span style="font-size:10px;color:var(--txd);white-space:nowrap">${r.w}×${r.h} cells</span>
      <button class="btn danger sm" onclick="deleteFogRegion(${i})">✕</button>
    </div>`).join('');
}

function updateFogLabel(i, val) {
  prepState.fogRegions[i].label = val;
  renderPrepFog();
  debounceSave();
}

function deleteFogRegion(i) {
  prepState.fogRegions.splice(i, 1);
  renderPrepFog();
  renderFogList();
  debounceSave();
}

function renderItemList() {
  const el = document.getElementById('item-list');
  if (!el) return;
  if (!prepState.hiddenItems.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--txd);padding:4px 0">No items yet. Enable place mode and drag on the map.</div>';
    return;
  }
  el.innerHTML = prepState.hiddenItems.map((item, i) => `
    <div style="border:1px solid var(--a44);border-radius:4px;padding:5px;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
        <span style="font-size:12px">${ITEM_TYPE_ICONS[item.type] || '?'}</span>
        <input type="text" value="${esc(item.label)}" onchange="updateItemLabel(${i}, this.value)"
          style="flex:1;padding:2px 5px;font-size:11px;background:var(--bg3);border:1px solid var(--a55);color:var(--tx);border-radius:3px">
        <button class="btn sm" onclick="cloneItem(${i})" title="Clone item">⎘</button>
        <button class="btn danger sm" onclick="deleteItem(${i})">✕</button>
      </div>
      <textarea placeholder="DM description (players never see this)…" rows="2" onchange="updateItemDesc(${i}, this.value)"
        style="width:100%;box-sizing:border-box;font-size:10px;background:var(--bg3);border:1px solid var(--a44);color:var(--txd);border-radius:3px;padding:3px 5px;resize:vertical">${esc(item.description || '')}</textarea>
    </div>`).join('');
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
  _pendingClone = { type: src.type, label: src.label + ' (copy)', description: src.description || '' };
  // Enter place mode if not already active
  if (!placeItemMode) togglePlaceItemMode();
  // Update hint to indicate clone placement
  const hint = document.getElementById('place-hint');
  if (hint) hint.textContent = `drag to place copy of "${src.label}"`;
}

function deleteItem(i) {
  prepState.hiddenItems.splice(i, 1);
  renderPrepFog();
  renderItemList();
  debounceSave();
}

// ── Draw mode ──
function toggleDrawMode() {
  drawMode = !drawMode;
  const btn = document.getElementById('btn-draw-fog');
  const hint = document.getElementById('draw-hint');
  if (drawMode && placeItemMode) {
    placeItemMode = false;
    const pb = document.getElementById('btn-place-item');
    if (pb) { pb.style.background = ''; pb.style.color = ''; }
    const ph = document.getElementById('place-hint');
    if (ph) ph.style.display = 'none';
  }
  drawCvs.style.pointerEvents = (drawMode || placeItemMode) ? 'all' : 'none';
  if (drawMode) {
    btn.style.background = 'var(--ac)';
    btn.style.color = 'var(--bg)';
    hint.style.display = '';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    hint.style.display = 'none';
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
    drawState = null;
  }
}

function togglePlaceItemMode() {
  placeItemMode = !placeItemMode;
  const btn = document.getElementById('btn-place-item');
  const hint = document.getElementById('place-hint');
  if (placeItemMode && drawMode) {
    drawMode = false;
    const db2 = document.getElementById('btn-draw-fog');
    if (db2) { db2.style.background = ''; db2.style.color = ''; }
    const dh = document.getElementById('draw-hint');
    if (dh) dh.style.display = 'none';
    drawState = null;
    dCtx.clearRect(0, 0, drawCvs.width, drawCvs.height);
  }
  drawCvs.style.pointerEvents = (drawMode || placeItemMode) ? 'all' : 'none';
  if (placeItemMode) {
    btn.style.background = 'var(--ac)';
    btn.style.color = 'var(--bg)';
    hint.style.display = '';
  } else {
    btn.style.background = '';
    btn.style.color = '';
    hint.style.display = 'none';
    hint.textContent = 'drag to place';
    _pendingClone = null; // cancel any pending clone
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

// Use pointer events + setPointerCapture so the drag continues even when
// the mouse leaves the canvas boundary (fixes "restarts draw" on remote).
drawCvs.addEventListener('pointerdown', e => {
  if (!drawMode && !placeItemMode) return;
  e.preventDefault();
  drawCvs.setPointerCapture(e.pointerId);
  const { gx, gy } = pixelToGrid(e);
  drawState = { startGX: gx, startGY: gy };
});

drawCvs.addEventListener('pointermove', e => {
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
      // Place the cloned item at the drawn position
      prepState.hiddenItems.push({ id: genId(), ..._pendingClone, x: minX, y: minY, w, h, visible: false });
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
  if (e.key === 'Escape' && placeItemMode && _pendingClone) {
    _pendingClone = null;
    togglePlaceItemMode(); // exits place mode and resets hint
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
    hiddenItems: prepState.hiddenItems
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

async function loadToTable() {
  if (!currentMapId) return;
  try {
    const res = await fetch(`/api/prepared-maps/${currentMapId}/load-to-table`, {
      method: 'POST',
      headers: { 'X-Master-Password': masterPw }
    });
    if (!res.ok) { showStatus('Load to table failed', true); return; }
    showStatus('Map loaded to table!', false);
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
  const imgStatus = document.getElementById('img-status');
  imgStatus.textContent = 'Uploading…';
  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = async () => {
      try {
        const res = await fetch(`/api/prepared-maps/${currentMapId}/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ dataUrl, mapWidth: img.naturalWidth, mapHeight: img.naturalHeight })
        });
        if (!res.ok) { imgStatus.textContent = 'Upload failed'; return; }
        imgStatus.textContent = '';
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
      } catch { imgStatus.textContent = 'Upload error'; }
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(input.files[0]);
  // reset so same file can be re-uploaded
  input.value = '';
}
