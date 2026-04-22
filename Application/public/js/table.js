// ── State ─────────────────────────────────────────────────────────────────────
let masterPw = '';
let tableState = { cellSize: 50, offsetX: 0, offsetY: 0, mapWidth: 0, mapHeight: 0, mapDataUrl: '' };
let tokens = [];
let initData = { entries: [], currentId: null };
let currentTool = 'move';
let dragState = null;   // { tokenId, origX, origY, origPxX, origPxY, remainingFt, ghostEl }
let _dragPendingTimer = null; // setTimeout handle — drag starts 500ms after mousedown
let rulerState = null;  // { x1, y1 }
let panState = null;    // { startX, startY, startScrollLeft, startScrollTop }
let selectedTokenId = null;
let rollPending = null; // { label, modifier, sender }
let placementState = null; // { payload } — click-to-place mode
let qrollCharName = '';
let qrollData = null;
let _sideQrollTokenId = null; // cache: skip reload if same token is still active
let _sideViewInitId = null;    // initiative entry the user clicked to preview in side panel
let drawings = [];             // committed shapes [{id,type,x1,y1,x2,y2,color,thickness}]
let drawMode = { type: 'circle', color: '#ff4444', thickness: 2 };
let drawingState = null;       // { x1, y1 } while dragging in draw mode
let _drawPreviewTimer = null;  // throttle for live preview broadcast
let _sidePrevTokenId = null;   // last token actually rendered in side panel (for section reset detection)
const _sideOpenSections = new Set(); // tracks which qroll sections the user has expanded
let chatUnread = 0;
let fogRegions = [];   // [{ id, label, x, y, w, h, visible }]
let hiddenItems = [];  // [{ id, label, type, x, y, description, visible }]
let zoomPct = 100;     // client-local zoom, not synced to server
let chatOpen = false;
let initPanelOpen = true;
let _offsetDebounce = null;
let _pendingTokenTab = 'chars';
let _pendingTokenLinkedId = null;
let _pendingTokenType = null;
let _pendingTokenData = {};
let _charList = [];
let _monsterList = [];
let _addTokenBusy = false; // true while in placement mode or while placement POST is in flight

// Serialises all token-mutating network requests so they never interleave.
// Optimistic UI updates happen immediately outside the queue; only fetch() calls go in.
const _tokQ = { _p: Promise.resolve(), run(fn) { this._p = this._p.then(() => fn(), () => fn()); } };

const CONDITIONS = [
  'Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned',
  'Prone','Restrained','Stunned','Unconscious'
];
const COND_ABBREV = {
  Blinded:'BL', Charmed:'CH', Deafened:'DF', Exhaustion:'EX', Frightened:'FR',
  Grappled:'GR', Incapacitated:'IC', Invisible:'IV', Paralyzed:'PA', Petrified:'PT',
  Poisoned:'PO', Prone:'PR', Restrained:'RS', Stunned:'ST', Unconscious:'UC'
};
function parseConditions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

const SKILL_NAMES = ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];
const SAVE_NAMES = ['STR','DEX','CON','INT','WIS','CHA'];
const SAVE_KEYS  = ['str','dex','con','int','wis','cha'];

// ── UI helpers ────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isErr) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = isErr ? 'var(--err)' : 'var(--a66)';
  el.style.color = isErr ? 'var(--err)' : 'var(--tx)';
  el.style.display = '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'flex';
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function done(result) {
      modal.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function isDM() { return !!masterPw; }
function initials(name) {
  return String(name||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
}
// Returns what a given user should see as the token's name.
// Players see only the identifier for monsters (e.g. "A3"), DM sees full name.
function tokDisplayName(tok) {
  if (!isDM() && tok.type === 'monster') {
    if (tok.label) return tok.label;
    // Fallback for older tokens without label: show last word (the identifier)
    const parts = String(tok.name || '').trim().split(' ');
    return parts[parts.length - 1] || tok.name;
  }
  return tok.name;
}
function tokenRingColor(type) {
  if (type === 'character') return '#c8a04a';
  if (type === 'monster') return '#ff4444';
  if (type === 'npc') return '#7ec8e3';
  return '#888888';
}
function hpBarColor(pct) {
  if (pct >= 0.5) return '#44cc44';
  if (pct >= 0.25) return '#ffcc00';
  return '#ff4444';
}
function getActiveTurnTokenId() {
  if (!initData.currentId) return null;
  return tokens.find(t => t.initiativeId === initData.currentId)?.id || null;
}
function showStatus(msg, isErr) {
  // no status bar on this page, use console
  console.log((isErr ? 'ERROR: ' : '') + msg);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function unlockDM() {
  document.getElementById('btn-dm-unlock').style.display = 'none';
  const inline = document.getElementById('dm-pw-inline');
  inline.style.display = 'flex';
  document.getElementById('dm-pw-input').value = '';
  document.getElementById('dm-pw-input').focus();
}

function cancelDMUnlock() {
  document.getElementById('dm-pw-inline').style.display = 'none';
  document.getElementById('btn-dm-unlock').style.display = '';
}

async function submitDMPassword() {
  const pw = document.getElementById('dm-pw-input').value;
  if (!pw) return;
  try {
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { showToast('Wrong password.', true); document.getElementById('dm-pw-input').select(); return; }
    masterPw = pw;
    sessionStorage.setItem('tableMasterPw', pw);
    location.reload();
  } catch { showToast('Connection error.', true); }
}

function exitDM() {
  masterPw = '';
  sessionStorage.removeItem('tableMasterPw');
  location.reload();
}

function toggleSidePanel() {
  const panel = document.getElementById('side-panel');
  const btn = document.getElementById('btn-sidepanel-toggle');
  if (!panel) return;
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? '' : 'none';
  if (btn) btn.textContent = hidden ? '▶' : '◀';
}

function applyDMControls() {
  const dmBadge = document.getElementById('dm-badge');
  const dmUnlock = document.getElementById('btn-dm-unlock');
  const dmControls = document.querySelectorAll('.dm-controls');
  if (isDM()) {
    if (dmBadge) dmBadge.style.display = '';
    if (dmUnlock) dmUnlock.style.display = 'none';
    dmControls.forEach(el => el.style.display = 'contents');
    updateInitiativeButton();
    loadPrepMaps();
    renderFogPanel();
    renderItemsPanel();
  } else {
    if (dmBadge) dmBadge.style.display = 'none';
    if (dmUnlock) dmUnlock.style.display = '';
    dmControls.forEach(el => el.style.display = 'none');
    renderFogPanel();
  }
}

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvasArea    = document.getElementById('canvas-area');
const canvasWrap    = document.getElementById('canvas-content-wrap');
const gridCanvas    = document.getElementById('grid-canvas');
const fogCanvas     = document.getElementById('fog-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const drawingCanvas = document.getElementById('drawing-canvas');
const tokenLayer      = document.getElementById('token-layer');
const tokenLayerBg    = document.getElementById('token-layer-bg');
const tokenLabelLayer = document.getElementById('token-label-layer');
const mapImg        = document.getElementById('map-img');
const gCtx = gridCanvas.getContext('2d');
const fCtx = fogCanvas.getContext('2d');
const itemsCanvas = document.getElementById('items-canvas');
const iCtx = itemsCanvas ? itemsCanvas.getContext('2d') : null;
const oCtx = overlayCanvas.getContext('2d');
const dCtx = drawingCanvas.getContext('2d');

function resizeCanvases(w, h) {
  const W = Math.max(w, 600);
  const H = Math.max(h, 400);
  gridCanvas.width = W; gridCanvas.height = H;
  fogCanvas.width = W; fogCanvas.height = H;
  if (itemsCanvas) { itemsCanvas.width = W; itemsCanvas.height = H; }
  drawingCanvas.width = W; drawingCanvas.height = H;
  overlayCanvas.width = W; overlayCanvas.height = H;
  tokenLayer.style.width = W + 'px';
  tokenLayer.style.height = H + 'px';
  tokenLayerBg.style.width = W + 'px';
  tokenLayerBg.style.height = H + 'px';
  if (mapImg) {
    mapImg.style.width = W + 'px';
    mapImg.style.height = H + 'px';
  }
}

function getCanvasSize() {
  const cs = tableState.cellSize || 50;
  const w = tableState.mapWidth || cs * 30;
  const h = tableState.mapHeight || cs * 20;
  return { w: Math.max(w, 600), h: Math.max(h, 400) };
}

// ── Grid rendering ────────────────────────────────────────────────────────────
function renderGrid(highlightCells) {
  const { w, h } = getCanvasSize();
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0;
  const oy = tableState.offsetY || 0;
  gCtx.clearRect(0, 0, w, h);

  // Highlight reachable cells
  if (highlightCells && highlightCells.size > 0) {
    gCtx.fillStyle = 'rgba(100,220,100,0.15)';
    for (const key of highlightCells) {
      const [cx, cy] = key.split(',').map(Number);
      gCtx.fillRect(ox + cx * cs, oy + cy * cs, cs, cs);
    }
    gCtx.strokeStyle = 'rgba(100,220,100,0.4)';
    gCtx.lineWidth = 1;
    for (const key of highlightCells) {
      const [cx, cy] = key.split(',').map(Number);
      gCtx.strokeRect(ox + cx * cs + 0.5, oy + cy * cs + 0.5, cs - 1, cs - 1);
    }
  }

  // Grid lines
  gCtx.strokeStyle = 'rgba(255,255,255,0.45)';
  gCtx.lineWidth = 1;
  const startX = (ox % cs + cs) % cs;
  for (let x = startX; x <= w; x += cs) {
    gCtx.beginPath(); gCtx.moveTo(x, 0); gCtx.lineTo(x, h); gCtx.stroke();
  }
  const startY = (oy % cs + cs) % cs;
  for (let y = startY; y <= h; y += cs) {
    gCtx.beginPath(); gCtx.moveTo(0, y); gCtx.lineTo(w, y); gCtx.stroke();
  }
}

// ── Token rendering ───────────────────────────────────────────────────────────
function tokenToPixel(col, row) {
  const cs = tableState.cellSize || 50;
  return {
    x: (tableState.offsetX || 0) + col * cs + cs / 2,
    y: (tableState.offsetY || 0) + row * cs + cs / 2
  };
}

function canvasToGrid(canvasX, canvasY) {
  const cs = tableState.cellSize || 50;
  return {
    x: Math.floor((canvasX - (tableState.offsetX || 0)) / cs),
    y: Math.floor((canvasY - (tableState.offsetY || 0)) / cs)
  };
}

function getCanvasPos(e) {
  const rect = canvasArea.getBoundingClientRect();
  const scale = zoomPct / 100;
  return {
    x: (e.clientX - rect.left + canvasArea.scrollLeft) / scale,
    y: (e.clientY - rect.top  + canvasArea.scrollTop)  / scale
  };
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
function applyZoom(pct) {
  zoomPct = Math.max(50, Math.min(200, pct));
  const scale = zoomPct / 100;
  if (canvasWrap) {
    canvasWrap.style.transform = `scale(${scale})`;
    canvasWrap.style.transformOrigin = 'top left';
  }
  const slider = document.getElementById('slider-zoom');
  if (slider) slider.value = zoomPct;
  const lbl = document.getElementById('zoom-val');
  if (lbl) lbl.textContent = zoomPct + '%';
}
document.getElementById('slider-zoom')?.addEventListener('input', e => applyZoom(parseInt(e.target.value) || 100));
document.getElementById('btn-zoom-in')?.addEventListener('click',  () => applyZoom(zoomPct + 10));
document.getElementById('btn-zoom-out')?.addEventListener('click', () => applyZoom(zoomPct - 10));

// ── Fog rendering ─────────────────────────────────────────────────────────────
function renderFog() {
  const { w, h } = getCanvasSize();
  fCtx.clearRect(0, 0, w, h);
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  for (const r of fogRegions) {
    const px = ox + r.x * cs, py = oy + r.y * cs, pw = r.w * cs, ph = r.h * cs;
    if (r.visible) {
      if (isDM()) {
        fCtx.fillStyle = 'rgba(0,200,100,0.1)';
        fCtx.fillRect(px, py, pw, ph);
        // Label on revealed region (DM only)
        if (r.label) {
          fCtx.font = 'bold 11px Segoe UI';
          fCtx.textAlign = 'center';
          fCtx.textBaseline = 'middle';
          fCtx.shadowColor = '#000'; fCtx.shadowBlur = 3;
          fCtx.fillStyle = 'rgba(0,200,100,0.85)';
          fCtx.fillText(r.label, px + pw / 2, py + ph / 2);
          fCtx.shadowBlur = 0; fCtx.textBaseline = 'alphabetic';
        }
      }
    } else {
      fCtx.fillStyle = isDM() ? 'rgba(0,0,0,0.45)' : '#000';
      fCtx.fillRect(px, py, pw, ph);
      // Label only for DM on hidden regions
      if (r.label && isDM()) {
        fCtx.font = 'bold 11px Segoe UI';
        fCtx.textAlign = 'center';
        fCtx.textBaseline = 'middle';
        fCtx.shadowColor = '#000'; fCtx.shadowBlur = 3;
        fCtx.fillStyle = 'rgba(200,160,74,0.9)';
        fCtx.fillText(r.label, px + pw / 2, py + ph / 2);
        fCtx.shadowBlur = 0; fCtx.textBaseline = 'alphabetic';
      }
    }
  }
}

function applyFogRegions(regions) {
  fogRegions = Array.isArray(regions) ? regions : [];
  renderFog();
  renderFogPanel();
}

function renderFogPanel() {
  const panel = document.getElementById('fog-panel');
  const list  = document.getElementById('fog-region-list');
  if (!panel || !list) return;
  const show = isDM() && fogRegions.length > 0;
  panel.style.display = show ? '' : 'none';
  if (!show) return;
  list.innerHTML = fogRegions.map(r => `
    <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--sep);cursor:default"
         onmouseenter="highlightMapRegion('${r.id}')" onmouseleave="clearMapHighlight()">
      <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${r.visible ? 'var(--ok)' : 'var(--txd)'}">${esc(r.label || 'Region')}</span>
      ${!r.visible
        ? `<button class="btn sm" onclick="revealFogRegion('${r.id}')">Reveal</button>`
        : `<button class="btn sm" onclick="hideFogRegion('${r.id}')" style="font-size:10px">Hide</button>`}
    </div>`).join('');
}

async function revealFogRegion(regionId) {
  try {
    const res = await fetch(`/api/table/fog/${regionId}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) showToast('Failed to reveal region.', true);
  } catch { showToast('Connection error.', true); }
}

async function hideFogRegion(regionId) {
  try {
    const res = await fetch(`/api/table/fog/${regionId}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) showToast('Failed to hide region.', true);
  } catch { showToast('Connection error.', true); }
}

// ── Hidden Items rendering ─────────────────────────────────────────────────────
const ITEM_ICONS = { trap: '⚠', chest: '◈', door: '▭', note: '✎', other: '◉' };

function renderItems() {
  if (!iCtx) return;
  const { w, h } = getCanvasSize();
  iCtx.clearRect(0, 0, w, h);
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  for (const item of hiddenItems) {
    if (!isDM() && !item.visible) continue;
    const iw = (item.w || 1) * cs, ih = (item.h || 1) * cs;
    const px = ox + item.x * cs, py = oy + item.y * cs;
    if (item.visible) {
      iCtx.fillStyle = isDM() ? 'rgba(0,200,100,0.2)' : 'rgba(0,200,100,0.15)';
      iCtx.strokeStyle = 'rgba(0,200,100,0.85)';
    } else {
      iCtx.fillStyle = 'rgba(220,60,60,0.2)';
      iCtx.strokeStyle = 'rgba(220,60,60,0.85)';
    }
    iCtx.fillRect(px, py, iw, ih);
    iCtx.lineWidth = 1.5;
    iCtx.setLineDash([4, 3]);
    iCtx.strokeRect(px, py, iw, ih);
    iCtx.setLineDash([]);
    iCtx.fillStyle = item.visible ? 'rgba(255,255,255,0.95)' : 'rgba(255,180,180,0.95)';
    iCtx.font = `bold ${Math.round(Math.min(cs * 0.28, 12))}px sans-serif`;
    iCtx.textAlign = 'center';
    iCtx.textBaseline = 'middle';
    iCtx.fillText(ITEM_ICONS[item.type] || '?', px + iw * 0.5, py + ih * 0.5);
    iCtx.textAlign = 'start';
    iCtx.textBaseline = 'alphabetic';
    if (isDM() && item.label) {
      iCtx.fillStyle = 'rgba(255,200,100,0.9)';
      iCtx.font = `${Math.round(Math.min(cs * 0.18, 9))}px sans-serif`;
      iCtx.fillText(item.label, px + 2, py + ih - 3);
    }
  }
}

function applyHiddenItems(items) {
  hiddenItems = Array.isArray(items) ? items : [];
  renderItems();
  renderItemsPanel();
}

function renderItemsPanel() {
  const panel = document.getElementById('items-panel');
  const list  = document.getElementById('items-list');
  if (!panel || !list) return;
  const show = isDM() && hiddenItems.length > 0;
  panel.style.display = show ? '' : 'none';
  if (!show) return;
  list.innerHTML = hiddenItems.map(item => `
    <div style="border:1px solid var(--a44);border-radius:4px;margin-bottom:4px;overflow:hidden"
         onmouseenter="highlightMapItem('${item.id}')" onmouseleave="clearMapHighlight()">
      <div style="display:flex;align-items:center;gap:6px;padding:4px 5px;cursor:pointer;user-select:none"
           onclick="const b=this.parentElement.querySelector('.item-body');if(b){const open=b.style.display==='block';b.style.display=open?'none':'block';this.querySelector('span').textContent=open?'▶':'▼'}">
        <span style="font-size:10px;color:var(--txd)">▶</span>
        <span style="font-size:13px">${ITEM_ICONS[item.type] || '?'}</span>
        <span style="flex:1;font-size:11px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${item.visible ? 'var(--ok)' : 'var(--txd)'}">${esc(item.label || 'Item')}</span>
        ${!item.visible
          ? `<button class="btn sm" onclick="event.stopPropagation();revealItem('${item.id}')">Reveal</button>`
          : `<button class="btn sm" onclick="event.stopPropagation();hideItem('${item.id}')" style="font-size:10px">Hide</button>`}
      </div>
      <div class="item-body" style="padding:4px 5px 5px;border-top:1px solid var(--sep)">
        ${item.description ? `<div style="font-size:10px;color:var(--txd);white-space:pre-wrap">${esc(item.description)}</div>` : '<div style="font-size:10px;color:var(--a44);font-style:italic">No description.</div>'}
      </div>
    </div>`).join('');
  list.querySelectorAll('.item-body').forEach(b => { b.style.display = 'none'; });
}

async function revealItem(itemId) {
  try {
    const res = await fetch(`/api/table/items/${itemId}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) showToast('Failed to reveal item.', true);
  } catch { showToast('Connection error.', true); }
}

async function hideItem(itemId) {
  try {
    const res = await fetch(`/api/table/items/${itemId}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) showToast('Failed to hide item.', true);
  } catch { showToast('Connection error.', true); }
}

// ── Panel hover highlights ─────────────────────────────────────────────────────
function _canHighlight() { return !dragState && !placementState && !rulerState; }

function _drawHighlight(px, py, pw, ph, color) {
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  // fill
  oCtx.fillStyle = color.replace(/[\d.]+\)$/, '0.35)');
  oCtx.fillRect(px, py, pw, ph);
  // outer glow stroke
  oCtx.save();
  oCtx.shadowColor = color;
  oCtx.shadowBlur = 12;
  oCtx.strokeStyle = color;
  oCtx.lineWidth = 3;
  oCtx.setLineDash([7, 4]);
  oCtx.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
  oCtx.setLineDash([]);
  oCtx.restore();
  // crisp inner stroke (no glow)
  oCtx.strokeStyle = color.replace(/[\d.]+\)$/, '0.6)');
  oCtx.lineWidth = 1;
  oCtx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
}

function highlightMapRegion(id) {
  if (!_canHighlight()) return;
  const r = fogRegions.find(x => x.id === id);
  if (!r) return;
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  _drawHighlight(ox + r.x * cs, oy + r.y * cs, r.w * cs, r.h * cs, 'rgba(200,160,74,1)');
}

function highlightMapItem(id) {
  if (!_canHighlight()) return;
  const item = hiddenItems.find(x => x.id === id);
  if (!item) return;
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  const color = item.visible ? 'rgba(0,220,100,1)' : 'rgba(220,60,60,1)';
  _drawHighlight(ox + item.x * cs, oy + item.y * cs, (item.w || 1) * cs, (item.h || 1) * cs, color);
}

function clearMapHighlight() {
  if (!_canHighlight()) return;
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// ── Prepared map selector ─────────────────────────────────────────────────────
async function loadPrepMaps() {
  try {
    const res = await fetch('/api/prepared-maps');
    if (!res.ok) return;
    const maps = await res.json();
    const sel = document.getElementById('prep-map-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Map —</option>'
      + maps.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  } catch {}
}

async function loadPrepMapToTable() {
  const sel = document.getElementById('prep-map-sel');
  if (!sel || !sel.value) { showToast('Select a map first.', true); return; }
  try {
    const res = await fetch(`/api/prepared-maps/${sel.value}/load-to-table`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) showToast('Failed to load map.', true);
  } catch { showToast('Connection error.', true); }
}

function renderTokens() {
  // Remove old token divs from both layers
  tokenLayer.querySelectorAll('.token').forEach(el => el.remove());
  tokenLayerBg.querySelectorAll('.token').forEach(el => el.remove());
  tokenLabelLayer.innerHTML = '';

  const activeTokId = getActiveTurnTokenId();
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;

  for (const tok of tokens) {
    if (!tok.visible && !isDM()) continue;
    const sizeMult = tok.tokenSize || 1;
    const size = Math.round(sizeMult * cs - 4);
    const tokLeft = ox + (tok.x || 0) * cs + 2;
    const tokTop  = oy + (tok.y || 0) * cs + 2;
    const isSelected = tok.id === selectedTokenId;
    const div = document.createElement('div');
    div.className = 'token' + (tok.id === activeTokId ? ' active-turn' : '');
    div.dataset.id = tok.id;
    div.style.cssText = [
      `width:${size}px`, `height:${size}px`,
      `left:${tokLeft}px`, `top:${tokTop}px`,
      `background:${tok.color || '#555'}`,
      (tok.portraitThumb || tok.portrait) ? `background-image:url('${tok.portraitThumb || tok.portrait}')` : '',
      (tok.portraitThumb || tok.portrait) ? `background-size:cover` : '',
      (tok.portraitThumb || tok.portrait) ? `background-position:center` : '',
      `border:3px solid ${tokenRingColor(tok.type || 'custom')}`,
      `font-size:${Math.round(Math.max(11, size * 0.28))}px`,
      isSelected ? `box-shadow:0 0 0 3px #fff,0 0 10px 4px rgba(255,255,255,0.7)` : '',
      tok.visible === false ? 'opacity:0.5' : ''
    ].filter(Boolean).join(';');
    const dn = tokDisplayName(tok);
    if (!tok.portraitThumb && !tok.portrait) div.textContent = (!isDM() && tok.type === 'monster') ? dn : initials(tok.name);
    const hpStr = (!isDM() && tok.type === 'monster') ? '' : ` | HP: ${tok.hpCurrent||0}/${tok.hpMax||0} | Speed: ${tok.speed||30}ft`;
    div.title = `${dn}${hpStr}${tok.id === activeTokId ? ' | YOUR TURN' : ''}`;

    const hpPct = (tok.hpMax || 0) > 0 ? Math.max(0, Math.min(1, (tok.hpCurrent || 0) / tok.hpMax)) : 0;
    const bar = document.createElement('div');
    bar.className = 'token-hp-bar';
    bar.innerHTML = `<div class="token-hp-fill" style="width:${hpPct*100}%;background:${hpBarColor(hpPct)}"></div>`;

    const label = document.createElement('div');
    label.className = 'token-name';
    label.textContent = dn.length > 10 ? dn.slice(0,9)+'…' : dn;

    const conds = parseConditions(tok.conditions);
    let condDiv = null;
    if (conds.length > 0) {
      condDiv = document.createElement('div');
      condDiv.className = 'token-conditions';
      condDiv.innerHTML = conds.map(c => `<span title="${c}">${COND_ABBREV[c] || c.slice(0,2).toUpperCase()}</span>`).join('');
    }

    attachTokenEvents(div, tok);
    // For players: monster tokens sit below the fog layer so fog can cover them.
    // For DM: all tokens stay above fog (DM can see everything).
    const behindFog = !isDM() && tok.type === 'monster';
    (behindFog ? tokenLayerBg : tokenLayer).appendChild(div);

    // Labels for fog-managed monster tokens stay inside the token div so fog
    // covers them correctly. All other tokens get labels in a dedicated label
    // layer (z-index 11) so they're never obscured when tokens overlap.
    if (behindFog) {
      div.appendChild(bar);
      div.appendChild(label);
      if (condDiv) div.appendChild(condDiv);
    } else {
      const labelWrap = document.createElement('div');
      labelWrap.style.cssText = `position:absolute;left:${tokLeft}px;top:${tokTop}px;width:${size}px;height:${size}px;pointer-events:none`;
      labelWrap.appendChild(bar);
      labelWrap.appendChild(label);
      if (condDiv) labelWrap.appendChild(condDiv);
      tokenLabelLayer.appendChild(labelWrap);
    }
  }
}

// ── Token selection ───────────────────────────────────────────────────────────
function selectToken(id) {
  selectedTokenId = id;
  _sideViewInitId = null; // clicking a token on the map clears initiative-row preview
  _sideQrollTokenId = null;
  renderTokens();
  renderSidePanel();
  loadSideQroll();
}

function moveSelectedToken(key) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const canMove = isDM() || (tok.type !== 'monster' && (!initData.currentId || tok.id === getActiveTurnTokenId()));
  if (!canMove) return;
  const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const dy = key === 'ArrowUp'   ? -1 : key === 'ArrowDown'  ? 1 : 0;
  const nx = (tok.x || 0) + dx, ny = (tok.y || 0) + dy;
  // Optimistic update — immediate
  patchToken(selectedTokenId, { x: nx, y: ny });
  renderTokens();
  // Network — queued
  const id = selectedTokenId;
  const origX = tok.x, origY = tok.y;
  _tokQ.run(async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (isDM()) headers['X-Master-Password'] = masterPw;
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT', headers, body: JSON.stringify({ x: nx, y: ny })
      });
    } catch {
      patchToken(id, { x: origX, y: origY });
      renderTokens();
      showToast('Network error.', true);
    }
  });
}

async function deleteSelectedToken() {
  if (!selectedTokenId || !isDM()) return;
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  if (!await showConfirm(`Remove "${tok.name}" from the map?`)) return;
  // UI cleanup — immediate
  const id = selectedTokenId;
  selectedTokenId = null;
  renderSidePanel();
  // Network — queued
  _tokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'DELETE', headers: { 'X-Master-Password': masterPw }
      });
    } catch { showToast('Failed to delete token.', true); }
  });
}

// ── Token drag & move ─────────────────────────────────────────────────────────
function attachTokenEvents(div, tok) {
  div.addEventListener('mousedown', e => {
    if (currentTool !== 'move') return;
    const canMove = isDM() || (tok.type !== 'monster' && (!initData.currentId || tok.id === getActiveTurnTokenId()));
    if (!canMove) return;
    e.preventDefault();
    e.stopPropagation();
    _dragPendingTimer = setTimeout(() => { _dragPendingTimer = null; startDrag(tok, e); }, 500);
  });

  div.addEventListener('click', e => {
    if (dragState && dragState.didMove) return;
    if (currentTool === 'select' || currentTool === 'move') {
      selectToken(tok.id);
      const canEditHp = isDM() || tok.type === 'character' || tok.type === 'npc';
      if (canEditHp) openHpPanel(tok);
    }
  });
}

function startDrag(tok, e) {
  const freeMove = !initData.currentId;
  const remainingFt = freeMove ? Infinity : (tok.speed || 30) - (tok.movedFt || 0);
  dragState = { tokenId: tok.id, origX: tok.x || 0, origY: tok.y || 0, origMovedFt: tok.movedFt || 0, remainingFt, freeMove, didMove: false };
  renderGrid(); // no highlight — movement is unlimited
}

function finishDrag(e) {
  if (!dragState) return;
  const { tokenId, origX, origY, origMovedFt, freeMove, didMove } = dragState;
  dragState = null;

  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // No actual drag to a new cell — treat as a plain click, don't move anything
  if (!didMove) { renderGrid(); renderTokens(); return; }

  const pos = getCanvasPos(e);
  const grid = canvasToGrid(pos.x, pos.y);
  const tok = tokens.find(t => t.id === tokenId);

  if (!tok || (grid.x === origX && grid.y === origY)) {
    renderGrid(); renderTokens(); return;
  }

  // Optimistic update — immediate
  const dx = Math.abs(grid.x - origX), dy = Math.abs(grid.y - origY);
  const dist = Math.max(dx, dy) * 5;
  const optimisticMovedFt = freeMove ? origMovedFt : origMovedFt + dist;
  patchToken(tokenId, { x: grid.x, y: grid.y, movedFt: optimisticMovedFt });
  renderGrid(); renderTokens(); renderSidePanel(); renderHpTable();

  // Network — queued
  _tokQ.run(async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (isDM()) headers['X-Master-Password'] = masterPw;
      await fetch(`/api/table/tokens/${tokenId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ x: grid.x, y: grid.y })
      });
    } catch {
      patchToken(tokenId, { x: origX, y: origY, movedFt: origMovedFt });
      renderGrid(); renderTokens(); renderSidePanel();
      showToast('Network error.', true);
    }
  });
}

function showOutOfRange() {
  oCtx.fillStyle = 'rgba(255,68,68,0.7)';
  oCtx.font = 'bold 16px Segoe UI';
  oCtx.textAlign = 'center';
  oCtx.fillText('Out of range!', overlayCanvas.width / 2, overlayCanvas.height / 2);
  setTimeout(() => { oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); }, 1000);
}

// ── Placement mode ────────────────────────────────────────────────────────────
function _setAddTokenBusy(val) {
  _addTokenBusy = val;
  const btn = document.getElementById('btn-add-token');
  if (btn) btn.disabled = val;
}

function enterPlacementMode(payload) {
  _setAddTokenBusy(true);
  placementState = { payload };
  overlayCanvas.style.pointerEvents = 'all';
  overlayCanvas.style.cursor = 'cell';
  document.getElementById('placement-hint').style.display = '';
}

function exitPlacementMode() {
  _setAddTokenBusy(false);
  placementState = null;
  document.getElementById('placement-hint').style.display = 'none';
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  // restore the active tool's pointer-events and cursor
  setTool(currentTool);
}

function commitPlacement(gridX, gridY) {
  const payload = { ...placementState.payload, x: gridX, y: gridY };
  exitPlacementMode();
  _setAddTokenBusy(true);
  _tokQ.run(async () => {
    try {
      await fetch('/api/table/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify(payload)
      });
    } catch { showToast('Failed to add token.', true); }
    finally { _setAddTokenBusy(false); }
  });
}

// ── Tool system ───────────────────────────────────────────────────────────────
function setTool(name) {
  currentTool = name;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-tool-' + name);
  if (btn) btn.classList.add('active');
  overlayCanvas.style.cursor = name === 'ruler' || name === 'draw' ? 'crosshair' : name === 'ping' ? 'cell' : name === 'pan' ? 'grab' : 'default';
  // Select and move modes: overlay transparent so token divs receive pointer events
  overlayCanvas.style.pointerEvents = (name === 'select' || name === 'move') ? 'none' : 'all';
  if (name !== 'ruler') { rulerState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); }
  if (name !== 'pan') { panState = null; }
  if (name !== 'draw') { drawingState = null; }
  document.getElementById('draw-toolbar').style.display = name === 'draw' ? 'flex' : 'none';
}

// ── Draw tool ─────────────────────────────────────────────────────────────────
function setDrawShape(type) {
  drawMode.type = type;
  document.querySelectorAll('.draw-shape-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('draw-shape-' + type);
  if (btn) btn.classList.add('active');
}

function setDrawColor(color) {
  drawMode.color = color;
}

function setDrawThickness(n) {
  drawMode.thickness = n;
  document.querySelectorAll('.draw-thick-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('draw-thick-' + n);
  if (btn) btn.classList.add('active');
}

function renderShape(ctx, s, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = s.color || '#ff4444';
  ctx.lineWidth = s.thickness || 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  } else if (s.type === 'circle') {
    const r = Math.sqrt((s.x2 - s.x1) ** 2 + (s.y2 - s.y1) ** 2);
    ctx.beginPath();
    ctx.arc(s.x1, s.y1, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color || '#ff4444';
    ctx.globalAlpha = alpha * 0.18;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.stroke();
  } else if (s.type === 'rect') {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    ctx.fillStyle = s.color || '#ff4444';
    ctx.globalAlpha = alpha * 0.18;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = alpha;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function renderDrawings() {
  dCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  for (const s of drawings) renderShape(dCtx, s);
}

function renderDrawPreview(shape) {
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (shape) renderShape(oCtx, shape, 0.7);
}

async function saveDrawing(shape) {
  drawings.push(shape);
  renderDrawings();
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  try {
    await fetch('/api/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shape)
    });
  } catch {}
}

async function clearDrawings() {
  drawings = [];
  renderDrawings();
  try { await fetch('/api/drawings', { method: 'DELETE' }); } catch {}
}

async function fetchDrawings() {
  try {
    const r = await fetch('/api/drawings');
    if (r.ok) { drawings = await r.json(); renderDrawings(); }
  } catch {}
}

// ── Ruler tool ────────────────────────────────────────────────────────────────
function renderRuler(x1, y1, x2, y2) {
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  oCtx.strokeStyle = '#ffcc00'; oCtx.lineWidth = 2;
  oCtx.setLineDash([6, 3]);
  oCtx.beginPath(); oCtx.moveTo(x1, y1); oCtx.lineTo(x2, y2); oCtx.stroke();
  oCtx.setLineDash([]);

  const cs = tableState.cellSize || 50;
  const dist = Math.round(Math.sqrt(((x2-x1)/cs)**2 + ((y2-y1)/cs)**2) * 5);
  oCtx.fillStyle = '#ffcc00';
  oCtx.font = 'bold 13px Segoe UI';
  oCtx.textAlign = 'left';
  oCtx.shadowColor = '#000'; oCtx.shadowBlur = 4;
  oCtx.fillText(`${dist} ft`, x2 + 8, y2 - 6);
  oCtx.shadowBlur = 0;
}

// ── Ping tool ─────────────────────────────────────────────────────────────────
function renderPing(gridX, gridY, color) {
  const px = tokenToPixel(gridX, gridY);
  const cs = tableState.cellSize || 50;
  const size = cs * 1.4;
  const el = document.createElement('div');
  el.className = 'ping-ring';
  el.style.cssText = `left:${px.x}px;top:${px.y}px;width:${size}px;height:${size}px;border:3px solid ${color||'#ffff00'}`;
  tokenLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function renderTurnPing(gridX, gridY) {
  const px = tokenToPixel(gridX, gridY);
  const cs = tableState.cellSize || 50;
  const size = cs * 2;
  const el = document.createElement('div');
  el.className = 'ping-ring';
  el.style.cssText = `left:${px.x}px;top:${px.y}px;width:${size}px;height:${size}px;border:4px solid #ffffff;animation-duration:3s`;
  tokenLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

async function sendPing(gridX, gridY) {
  try {
    await fetch('/api/table/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: gridX, y: gridY, color: '#ffdd00' })
    });
  } catch {}
}

// ── Overlay canvas events ─────────────────────────────────────────────────────
overlayCanvas.addEventListener('mousedown', e => {
  if (placementState) {
    const pos = getCanvasPos(e);
    const grid = canvasToGrid(pos.x, pos.y);
    commitPlacement(grid.x, grid.y);
    return;
  }
  if (dragState) return;
  if (currentTool === 'pan') {
    panState = { startX: e.clientX, startY: e.clientY,
                 startScrollLeft: canvasArea.scrollLeft, startScrollTop: canvasArea.scrollTop };
    overlayCanvas.style.cursor = 'grabbing';
    return;
  }
  const pos = getCanvasPos(e);
  if (currentTool === 'ruler') {
    rulerState = { x1: pos.x, y1: pos.y };
  } else if (currentTool === 'ping') {
    const grid = canvasToGrid(pos.x, pos.y);
    sendPing(grid.x, grid.y);
  } else if (currentTool === 'draw') {
    drawingState = { x1: pos.x, y1: pos.y };
  }
});

overlayCanvas.addEventListener('mousemove', e => {
  const pos = getCanvasPos(e);
  if (placementState) {
    const grid = canvasToGrid(pos.x, pos.y);
    const cs = tableState.cellSize || 50;
    const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
    const sizeMult = placementState.payload.tokenSize || 1;
    const size = Math.round(sizeMult * cs - 4);
    const cx = ox + grid.x * cs + sizeMult * cs / 2;
    const cy = oy + grid.y * cs + sizeMult * cs / 2;
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    oCtx.beginPath();
    oCtx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    oCtx.fillStyle = `${placementState.payload.color || '#888'}88`;
    oCtx.fill();
    oCtx.strokeStyle = placementState.payload.color || '#888';
    oCtx.lineWidth = 3;
    oCtx.stroke();
    oCtx.fillStyle = '#fff';
    oCtx.font = `bold ${Math.round(size * 0.28)}px Segoe UI`;
    oCtx.textAlign = 'center';
    oCtx.textBaseline = 'middle';
    oCtx.fillText(initials(placementState.payload.name), cx, cy);
    oCtx.textBaseline = 'alphabetic';
    return;
  }
  if (currentTool === 'ruler' && rulerState) {
    renderRuler(rulerState.x1, rulerState.y1, pos.x, pos.y);
  } else if (currentTool === 'draw' && drawingState) {
    const preview = { ...drawMode, x1: drawingState.x1, y1: drawingState.y1, x2: pos.x, y2: pos.y };
    renderDrawPreview(preview);
    // Throttled live broadcast to other clients
    if (!_drawPreviewTimer) {
      _drawPreviewTimer = setTimeout(() => {
        _drawPreviewTimer = null;
        fetch('/api/drawings/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shape: preview })
        }).catch(() => {});
      }, 50);
    }
  }
});

// Drag ghost follows the mouse anywhere on the document
document.addEventListener('mousemove', e => {
  if (panState) {
    canvasArea.scrollLeft = panState.startScrollLeft - (e.clientX - panState.startX);
    canvasArea.scrollTop  = panState.startScrollTop  - (e.clientY - panState.startY);
    return;
  }
  if (!dragState) return;
  const pos = getCanvasPos(e);
  const grid = canvasToGrid(pos.x, pos.y);
  if (grid.x !== dragState.origX || grid.y !== dragState.origY) dragState.didMove = true;
  const cs = tableState.cellSize || 50;
  const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
  const dragTok = tokens.find(t => t.id === dragState.tokenId);
  const sizeMult = dragTok?.tokenSize || 1;
  const size = Math.round(sizeMult * cs - 4);
  const cx = ox + grid.x * cs + sizeMult * cs / 2;
  const cy = oy + grid.y * cs + sizeMult * cs / 2;
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  oCtx.beginPath();
  oCtx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  oCtx.fillStyle = 'rgba(200,160,74,0.3)';
  oCtx.fill();
  oCtx.strokeStyle = 'rgba(200,160,74,0.8)';
  oCtx.lineWidth = 2;
  oCtx.stroke();
  if (!dragState.freeMove) {
    const dx = Math.abs(grid.x - dragState.origX), dy = Math.abs(grid.y - dragState.origY);
    const dist = Math.max(dx, dy) * 5;
    const remaining = dragState.remainingFt - dist;
    oCtx.font = 'bold 12px Segoe UI';
    oCtx.textAlign = 'center';
    oCtx.shadowColor = '#000'; oCtx.shadowBlur = 3;
    oCtx.fillStyle = remaining >= 0 ? '#88ff88' : '#ff8888';
    oCtx.fillText(`${dist}ft  (${remaining >= 0 ? remaining + 'ft left' : Math.abs(remaining) + 'ft over'})`, cx, cy - size / 2 - 8);
    oCtx.shadowBlur = 0;
  }
});

overlayCanvas.addEventListener('mouseup', e => {
  if (currentTool === 'ruler') {
    rulerState = null;
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  } else if (currentTool === 'draw' && drawingState) {
    const pos = getCanvasPos(e);
    const dx = pos.x - drawingState.x1, dy = pos.y - drawingState.y1;
    // Ignore tiny accidental clicks (< 4px)
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      const shape = { id: Math.random().toString(36).slice(2), ...drawMode, x1: drawingState.x1, y1: drawingState.y1, x2: pos.x, y2: pos.y };
      saveDrawing(shape);
    } else {
      oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    drawingState = null;
  }
});

document.addEventListener('mouseup', e => {
  if (_dragPendingTimer) { clearTimeout(_dragPendingTimer); _dragPendingTimer = null; }
  if (panState) {
    panState = null;
    overlayCanvas.style.cursor = 'grab';
    return;
  }
  if (dragState) finishDrag(e);
});

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

function startSSE() {
  connectRealtime({
    table: (d) => {
      switch (d.action) {
        case 'map-updated':
        case 'state-updated':
          fetchAll(); break;
        case 'token-added':
          if (!tokens.find(t => t.id === d.token.id)) tokens.push(d.token);
          renderTokens(); renderHpTable(); break;
        case 'token-moved':
          patchToken(d.id, { x: d.x, y: d.y, movedFt: d.movedFt });
          renderTokens(); renderSidePanel(); renderHpTable(); break;
        case 'token-updated':
          replaceToken(d.token); renderTokens(); renderSidePanel(); renderHpTable();
          if (selectedTokenId === d.token.id) updateHpPanel(d.token);
          // Refresh side qroll if it was the active token (HP changed)
          if (d.token.id === getActiveTurnTokenId()) { _sideQrollTokenId = null; loadSideQroll(); }
          break;
        case 'token-removed':
          if (_dragPendingTimer && dragState?.tokenId === d.id) {
            clearTimeout(_dragPendingTimer); _dragPendingTimer = null;
          }
          if (dragState?.tokenId === d.id) {
            dragState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          if (selectedTokenId === d.id) { selectedTokenId = null; closeHpPanel(); renderSidePanel(); }
          tokens = tokens.filter(t => t.id !== d.id); renderTokens(); renderHpTable(); break;
        case 'tokens-cleared':
          if (_dragPendingTimer) { clearTimeout(_dragPendingTimer); _dragPendingTimer = null; }
          dragState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          selectedTokenId = null; closeHpPanel(); renderSidePanel();
          tokens = []; renderTokens(); renderHpTable(); break;
        case 'fog-updated':
          applyFogRegions(d.fogRegions); break;
        case 'items-updated':
          applyHiddenItems(d.hiddenItems); break;
        case 'ping':
          renderPing(d.x, d.y, d.color); break;
      }
    },
    initiative: async (d) => {
      const prevCurrentId = initData.currentId;
      await fetchInitiative();
      // On turn advance or initiative start/end/clear, release manual view selection
      if (d?.action === 'next' || d?.action === 'start' || d?.action === 'end' || d?.action === 'clear') {
        _sideViewInitId = null;
      }
      // Only invalidate the side panel cache if the active turn actually changed
      if (initData.currentId !== prevCurrentId) _sideQrollTokenId = null;
      renderInitiativeTracker();
      updateInitiativeButton();
      renderTokens();
      renderSidePanel();
      renderHpTable();
      loadSideQroll();
      // Ping the newly active token's map position
      const activeTokId = getActiveTurnTokenId();
      const activeTok = activeTokId ? tokens.find(t => t.id === activeTokId) : null;
      if (activeTok) renderTurnPing(activeTok.x || 0, activeTok.y || 0);
    },
    characters: async (d) => {
      if (d.action !== 'updated') return;
      // If the changed character is linked to the active token, reload side panel data
      const activeTok = tokens.find(t => t.id === getActiveTurnTokenId());
      if (activeTok?.linkedId === d.id) {
        _sideQrollTokenId = null;
        loadSideQroll();
      }
    },
    chat: (entry) => {
      appendChatEntry(entry);
      scrollChatLog();
      if (!chatOpen) {
        chatUnread++;
        updateChatBadge();
      }
    },
    'chat-clear': () => {
      document.getElementById('chat-log').innerHTML = '';
    },
    drawing: (d) => {
      if (d.action === 'add') {
        if (!drawings.find(s => s.id === d.shape.id)) drawings.push(d.shape);
        renderDrawings();
      } else if (d.action === 'preview') {
        // Show another client's in-progress shape on the overlay canvas
        if (currentTool !== 'draw') renderDrawPreview(d.shape);
      } else if (d.action === 'remove') {
        drawings = drawings.filter(s => s.id !== d.id);
        renderDrawings();
      } else if (d.action === 'clear') {
        drawings = [];
        renderDrawings();
      }
    },
    'dice-roll': (d) => {
      if (_selfRollIds.has(d.rollId)) { _selfRollIds.delete(d.rollId); return; }
      showDiceAnimation(d.sides, d.dieResults || [d.dieResult], d.modifier, d.total, d.label, d.duration, d.usedIdx ?? -1);
    },
    monsters: (d) => {
      if (d.action === 'portrait-updated') {
        // Update local cache so the modal thumbnail is correct immediately
        const mon = _monsterList.find(m => m.id === d.id);
        if (mon) { if (!mon.data) mon.data = {}; mon.data.portrait = d.portrait; mon.data.portraitThumb = d.portraitThumb || null; }
        // If the add-token modal is open, refresh its monster tab
        const modal = document.getElementById('add-token-modal');
        if (modal && modal.style.display !== 'none') populateAddTokenModal(_charList);
      }
    },
  });
}

function patchToken(id, fields) {
  const tok = tokens.find(t => t.id === id);
  if (tok) Object.assign(tok, fields);
}
function replaceToken(newTok) {
  const idx = tokens.findIndex(t => t.id === newTok.id);
  if (idx >= 0) tokens[idx] = newTok;
  else tokens.push(newTok);
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchAll() {
  try {
    const res = await fetch('/api/table');
    if (!res.ok) return;
    const { state, tokens: tok } = await res.json();
    tableState = state;
    tokens = tok;
    const { w, h } = getCanvasSize();
    resizeCanvases(w, h);
    if (tableState.hasMap) {
      mapImg.src = '/api/table/map?' + Date.now();
      mapImg.style.display = '';
    } else {
      mapImg.src = '';
      mapImg.style.display = 'none';
    }
    applyFogRegions(state.fogRegions || []);
    applyHiddenItems(state.hiddenItems || []);
    renderGrid();
    renderFog();
    renderItems();
    renderDrawings();
    renderTokens();
    renderSidePanel();
    renderHpTable();
  } catch (err) { console.error(err); }
}

async function fetchInitiative() {
  try {
    const res = await fetch('/api/initiative');
    if (!res.ok) return;
    initData = await res.json();
  } catch {}
}

// ── Initiative panel ──────────────────────────────────────────────────────────
function renderInitiativeTracker(showBadge) {
  const list = document.getElementById('init-tracker-list');
  if (!list) return;
  const allEntries = initData.entries || [];
  const visibleEntries = isDM() ? allEntries : allEntries.filter(e => !e.monsterId || !!initData.currentId);
  const sorted = [...visibleEntries].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">No combatants yet.</div>';
    return;
  }
  list.innerHTML = sorted.map(e => {
    const isCur = e.id === initData.currentId;
    const isViewing = e.id === _sideViewInitId;
    const canView = isDM() || !e.monsterId; // players can't click monsters
    // Resolve the display name: DM sees full name, players see identifier only
    const eTok = e.monsterId ? tokens.find(t => t.initiativeId === e.id) : null;
    const eDisplayName = (!isDM() && e.monsterId)
      ? (eTok ? tokDisplayName(eTok) : (() => { const p = e.name.trim().split(' '); return p[p.length-1]; })())
      : e.name;
    const nameHtml = (e.monsterId && isDM())
      ? `<a href="/monsters.html" target="_blank" style="color:inherit;text-decoration:underline dotted;cursor:pointer" title="Open monsters page" onclick="event.stopPropagation()">${esc(e.name)}</a>`
      : esc(eDisplayName);
    const canEdit = isDM() || !e.monsterId; // DM edits all; players edit non-monster entries
    const rollHtml = canEdit
      ? `<input type="number" class="init-roll-input" value="${e.roll}" data-id="${e.id}" data-monster="${e.monsterId ? '1' : ''}"
           style="width:36px;background:var(--bg3);border:1px solid var(--a55);color:var(--ac);border-radius:3px;padding:2px 3px;font-size:11px;font-weight:bold;text-align:center"
           onchange="updateInitRoll(this)" onclick="event.stopPropagation()">`
      : `<span class="init-row-roll">${e.roll}</span>`;
    const delHtml = isDM()
      ? `<button class="btn sm danger" style="padding:1px 5px;font-size:11px;line-height:1.2;margin-left:4px" onclick="event.stopPropagation();removeInitEntry('${e.id}')" title="Remove from initiative">✕</button>`
      : '';
    const clickAttr = canView ? `onclick="viewInitEntry('${e.id}')"` : '';
    return `<div class="init-row${isCur ? ' init-cur' : ''}${isViewing ? ' init-viewing' : ''}" ${clickAttr}>
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      <span class="init-row-name">${nameHtml}</span>
      ${rollHtml}
      ${delHtml}
    </div>`;
  }).join('');
  if (showBadge && !initPanelOpen) {
    const badge = document.getElementById('init-badge');
    if (badge) badge.style.display = '';
  }
}

function initTogglePanel() {
  const body = document.getElementById('init-body-wrap');
  const chev = document.getElementById('init-chevron');
  if (!body) return;
  initPanelOpen = !initPanelOpen;
  body.classList.toggle('open', initPanelOpen);
  if (chev) chev.textContent = initPanelOpen ? '▼' : '▲';
  if (initPanelOpen) {
    const badge = document.getElementById('init-badge');
    if (badge) badge.style.display = 'none';
  }
}

async function rollMyInitiative() {
  const name = prompt('Your name (for initiative):');
  if (!name) return;
  const bonus = parseInt(prompt('Initiative bonus (e.g. +2 → enter 2):', '0')) || 0;
  const roll = Math.ceil(Math.random() * 20) + bonus;
  try {
    await fetch('/api/initiative/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), roll })
    });
  } catch { showToast('Failed to roll initiative.', true); }
}

async function initSkipTurn() {
  try {
    const headers = {};
    if (isDM()) headers['X-Master-Password'] = masterPw;
    await fetch('/api/initiative/next', { method: 'POST', headers });
  } catch {}
}

async function dmNextTurn() {
  await initSkipTurn();
}

async function dmPrevTurn() {
  try {
    const headers = {};
    if (isDM()) headers['X-Master-Password'] = masterPw;
    await fetch('/api/initiative/prev', { method: 'POST', headers });
  } catch {}
}

async function toggleInitiative() {
  if (!isDM()) return;
  const running = !!initData.currentId;
  try {
    await fetch(running ? '/api/initiative/end' : '/api/initiative/start', {
      method: 'POST', headers: { 'X-Master-Password': masterPw }
    });
  } catch { showToast('Failed to toggle initiative.', true); }
}

function updateInitiativeButton() {
  const btn = document.getElementById('btn-init-toggle');
  if (!btn) return;
  btn.textContent = initData.currentId ? '⏹ End Initiative' : '▶ Start Initiative';
}

async function updateInitRoll(input) {
  const id = input.dataset.id;
  const isMonster = !!input.dataset.monster;
  const roll = parseInt(input.value);
  if (isNaN(roll)) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (isMonster) headers['X-Master-Password'] = masterPw;
    const res = await fetch(`/api/initiative/${id}/roll`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ roll })
    });
    if (!res.ok) { showToast('Failed to update initiative.', true); input.value = input.defaultValue; }
  } catch { showToast('Connection error.', true); }
}

async function removeInitEntry(id) {
  const entry = initData.entries?.find(e => e.id === id);
  if (!entry || !isDM()) return;
  if (!confirm(`Remove "${entry.name}" from initiative?`)) return;
  if (_sideViewInitId === id) { _sideViewInitId = null; }
  try {
    const res = await fetch(`/api/initiative/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({})
    });
    if (!res.ok) showToast('Failed to remove entry.', true);
  } catch { showToast('Connection error.', true); }
}

function viewInitEntry(id) {
  const entry = initData.entries?.find(e => e.id === id);
  if (!entry) return;
  // Players cannot view monster entries
  if (!isDM() && entry.monsterId) return;
  // Toggle: clicking the same entry again returns to active-turn view
  _sideViewInitId = (_sideViewInitId === id) ? null : id;
  _sideQrollTokenId = null; // force reload
  loadSideQroll();
  renderInitiativeTracker(); // refresh highlight
}

// ── Chat panel ────────────────────────────────────────────────────────────────
function chatToggle() {
  const body = document.getElementById('chat-body-wrap');
  const chev = document.getElementById('chat-chevron');
  if (!body) return;
  chatOpen = !chatOpen;
  body.classList.toggle('open', chatOpen);
  if (chev) chev.textContent = chatOpen ? '▼' : '▲';
  if (chatOpen) {
    chatUnread = 0;
    updateChatBadge();
    scrollChatLog();
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (chatUnread > 0) {
    badge.style.display = '';
    badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
  } else {
    badge.style.display = 'none';
  }
}

function appendChatEntry(e) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const rawTs = e.timestamp || '';
  const dt = rawTs ? new Date(rawTs + (rawTs.endsWith('Z') ? '' : 'Z')) : new Date();
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');

  if (e.type === 'text') {
    div.className = 'chat-entry chat-text';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
      <span class="ce-sender">${esc(e.sender || '?')}</span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>
    <div style="word-break:break-word">${esc(e.message || '')}</div>`;
    log.appendChild(div);
    return;
  }

  if (e.type === 'media') {
    const url = `/api/shared-media/${e.mediaId}`;
    let mediaEl = '';
    if (e.mimeType && e.mimeType.startsWith('image/')) {
      mediaEl = `<img loading="lazy" src="${url}" style="max-width:100%;max-height:200px;width:auto;object-fit:contain;border-radius:4px;margin-top:4px;display:block">`;
    } else if (e.mimeType && e.mimeType.startsWith('video/')) {
      mediaEl = `<video src="${url}" controls style="max-width:100%;max-height:200px;border-radius:4px;margin-top:4px;display:block"></video>`;
    } else {
      mediaEl = `<a href="${url}" target="_blank" style="display:inline-block;margin-top:6px;padding:4px 8px;background:var(--bg3);border-radius:4px;color:var(--ac);font-size:11px">📎 Open file</a>`;
    }
    const cap = e.caption ? `<div style="font-size:10px;color:var(--txd);margin-top:4px">${esc(e.caption)}</div>` : '';
    div.className = 'chat-entry';
    div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span class="ce-sender">${esc(e.sender || 'DM')} <span style="font-size:10px;color:var(--txd);font-weight:normal">media</span></span>
      <span style="color:var(--txd);font-size:10px">${time}</span>
    </div>${mediaEl}${cap}`;
    log.appendChild(div);
    return;
  }

  const isNat20 = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 20;
  const isNat1  = e.dice && e.dice.match(/d20$/) && e.results && e.results.length === 1 && e.results[0] === 1;
  const cls = isNat20 ? ' nat20' : isNat1 ? ' nat1' : '';
  const modStr = e.modifier ? (e.modifier > 0 ? `+${e.modifier}` : `${e.modifier}`) : '';
  const multiStr = e.results && e.results.length > 1
    ? ` <span style="font-size:10px;color:var(--txd)">[${e.results.join(', ')}]</span>` : '';
  const labelStr = e.label ? ` — ${esc(e.label)}` : '';
  const natStr = isNat20 ? ' <span style="color:var(--ok)">✨ NAT 20!</span>'
               : isNat1  ? ' <span style="color:var(--err)">💀 NAT 1</span>' : '';
  div.className = `chat-entry${cls}`;
  div.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:2px">
    <span class="ce-sender">${esc(e.sender || '?')}</span>
    <span style="color:var(--txd);font-size:10px">${time}</span>
  </div>
  <span style="color:var(--txd);font-size:11px">${esc(e.dice || '')}${modStr}${labelStr}</span>${multiStr}
  <div class="ce-total" style="color:${isNat20 ? 'var(--ok)' : isNat1 ? 'var(--err)' : 'var(--tx)'}">${e.total}${natStr}</div>`;
  log.appendChild(div);
}

function scrollChatLog() {
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

// ── 3D Dice Animation ─────────────────────────────────────────────────────────
// Polygon shapes (SVG points, 100×100 viewBox)
const DICE_POLY_POINTS = {
  4:   '50,8 93,83 7,83',                                   // triangle
  8:   '50,5 90,50 50,95 10,50',                            // diamond
  10:  '50,5 90,30 80,85 20,85 10,30',                      // pentagon
  12:  '50,6 81,19 94,50 81,81 50,94 19,81 6,50 19,19',    // octagon
  20:  '50,5 90,27 90,73 50,95 10,73 10,27',               // hexagon
  100: '50,6 76,14 92,36 92,64 76,86 50,94 24,86 8,64 8,36 24,14', // decagon
};
// Vertical text anchor per shape (centroid y in 0-100 space)
const DICE_TEXT_Y = { 4: 62, 8: 52, 10: 55, 12: 52, 20: 52, 100: 52 };

let _diceResolveFn   = null;
let _diceAutoClose   = null;
let _polyIntervals   = [];    // one per polygon die
const _selfRollIds   = new Set();
const MAX_DICE_SHOW  = 8;

// Build one die DOM element; returns { container, animEl, textEl, isCube }
function _makeDieEl(sides, value, size, dur) {
  const isD6 = sides === 6;
  if (isD6) {
    const tz = size / 2;
    const faceTransforms = [
      `translateZ(${tz}px)`, `rotateY(180deg) translateZ(${tz}px)`,
      `rotateY(90deg) translateZ(${tz}px)`, `rotateY(-90deg) translateZ(${tz}px)`,
      `rotateX(90deg) translateZ(${tz}px)`, `rotateX(-90deg) translateZ(${tz}px)`,
    ];
    const faceVals = [value, ...Array.from({length:5}, () => Math.ceil(Math.random() * 6))];
    const fs = Math.round(size * 0.25);
    const br = Math.round(size * 0.12);

    const scene = document.createElement('div');
    scene.style.cssText = `perspective:700px;width:${size}px;height:${size}px;flex-shrink:0`;
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    cube.style.cssText = `width:${size}px;height:${size}px`;
    cube.style.setProperty('--roll-dur', `${dur}ms`);
    faceTransforms.forEach((t, i) => {
      const face = document.createElement('div');
      face.className = 'dice-face';
      face.style.cssText = `width:${size}px;height:${size}px;transform:${t};font-size:${fs}px;border-radius:${br}px`;
      face.textContent = faceVals[i];
      cube.appendChild(face);
    });
    scene.appendChild(cube);
    return { container: scene, animEl: cube, textEl: cube.children[0], isCube: true };
  } else {
    const pts  = DICE_POLY_POINTS[sides] || DICE_POLY_POINTS[20];
    const ty   = DICE_TEXT_Y[sides] || 52;
    const fid  = `dg${Math.random().toString(36).slice(2,7)}`;
    const rnd  = Math.ceil(Math.random() * sides);

    const wrap  = document.createElement('div');
    wrap.style.cssText = `perspective:700px;flex-shrink:0`;
    const inner = document.createElement('div');
    inner.className = 'dice-poly-inner';
    inner.style.setProperty('--roll-dur', `${dur}ms`);
    inner.innerHTML =
      `<svg width="${size}" height="${size}" viewBox="-5 -5 110 110">` +
      `<defs><filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="3" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
      `<polygon points="${pts}" fill="#0f3460" stroke="#c8a04a" stroke-width="2.5" filter="url(#${fid})"/>` +
      `<text x="50" y="${ty}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-size="26" font-weight="bold" fill="#c8a04a" font-family="Segoe UI,sans-serif">${rnd}</text></svg>`;
    wrap.appendChild(inner);
    return { container: wrap, animEl: inner, textEl: inner.querySelector('text'), isCube: false };
  }
}

// dieResults is an array of individual die face values; usedIdx = index of kept die for adv/dis (-1 = no dim)
function showDiceAnimation(sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
  const arr = Array.isArray(dieResults) ? dieResults : [dieResults];
  return new Promise(resolve => {
    if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
    _polyIntervals.forEach(clearInterval); _polyIntervals = [];
    if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
    _diceResolveFn = resolve;

    const dur   = duration ?? (1000 + Math.random() * 2000);
    const shown = Math.min(arr.length, MAX_DICE_SHOW);
    const size  = shown === 1 ? 120 : shown === 2 ? 100 : shown <= 4 ? 80 : 60;

    // Die-type label
    const diceLabel = arr.length > 1 ? `${arr.length}d${sides}` : `d${sides}`;
    document.getElementById('dice-type-lbl').textContent = diceLabel;

    // Result display (hidden until reveal)
    const bigEl = document.getElementById('dice-result-big');
    const subEl = document.getElementById('dice-result-sub');
    bigEl.textContent = total;
    bigEl.className   = 'dice-result-big';
    const usedVal = usedIdx >= 0 ? arr[usedIdx] : arr[0];
    if (sides === 20 && usedVal === 20) bigEl.classList.add('nat20');
    else if (sides === 20 && usedVal === 1) bigEl.classList.add('nat1');
    subEl.className = 'dice-result-sub';
    let sub = label || diceLabel;
    if (modifier !== 0) sub += (modifier > 0 ? ` + ${modifier}` : ` \u2212 ${Math.abs(modifier)}`) + ` = ${total}`;
    subEl.textContent = sub;

    // Build dice row
    const row = document.getElementById('dice-row');
    row.innerHTML = '';
    const reveals = []; // { textEl, val, isCube, container, isDimmed }

    for (let i = 0; i < shown; i++) {
      const { container, animEl, textEl, isCube } = _makeDieEl(sides, arr[i], size, dur);
      row.appendChild(container);
      void animEl.offsetWidth; // reflow → restart animation
      animEl.classList.add('rolling');
      const isDimmed = shown > 1 && usedIdx >= 0 && i !== usedIdx;
      reveals.push({ textEl, val: arr[i], isCube, container, isDimmed });

      if (!isCube) {
        const el = textEl;
        const id = setInterval(() => { el.textContent = Math.ceil(Math.random() * sides); }, 100);
        _polyIntervals.push(id);
      }
    }

    document.getElementById('dice-overlay').classList.add('active');

    setTimeout(() => {
      _polyIntervals.forEach(clearInterval); _polyIntervals = [];
      reveals.forEach(({ textEl, val, container, isDimmed }) => {
        textEl.textContent = val;
        if (isDimmed) container.style.cssText += ';opacity:0.35;filter:blur(1.5px);transition:opacity .4s,filter .4s';
      });
      bigEl.classList.add('show');
      subEl.classList.add('show');
      if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
      _diceAutoClose = setTimeout(dismissDiceOverlay, 2500);
    }, dur);
  });
}

function dismissDiceOverlay() {
  if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
  _polyIntervals.forEach(clearInterval); _polyIntervals = [];
  document.getElementById('dice-overlay').classList.remove('active');
  document.getElementById('dice-row').innerHTML = '';
  if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
}

function getActiveCharLinkedId() {
  const activeTokId = getActiveTurnTokenId() || selectedTokenId;
  const tok = tokens.find(t => t.id === activeTokId);
  if (!tok || tok.type === 'monster') return null;
  return tok.linkedId || null;
}

function _pushRollToChar(charId, entry) {
  if (!charId) return;
  fetch(`/api/characters/${charId}/roll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }).catch(() => {});
}

function _broadcastDiceRoll(rollId, sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
  fetch('/api/dice/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollId, sides, dieResults: Array.isArray(dieResults) ? dieResults : [dieResults], modifier, total, label, duration, usedIdx, sender: getChatSender() })
  }).catch(() => {});
}

async function postToChat(payload) {
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'roll' })
    });
  } catch {}
}

function getChatSender() {
  return qrollCharName || 'Table';
}

function parseDiceCommand(text) {
  const m = text.match(/^\/r(?:oll)?\s+(\d+)?d(\d+)\s*([+-]\d+)?\s*(.*)?$/i);
  if (!m) return null;
  return {
    count: Math.max(1, Math.min(20, parseInt(m[1] || '1'))),
    sides: parseInt(m[2]),
    modifier: parseInt(m[3] || '0'),
    label: (m[4] || '').trim() || null
  };
}

async function sendChatInput() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  const roll = parseDiceCommand(text);
  if (roll) {
    const { count, sides, modifier, label } = roll;
    const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
    const total = results.reduce((s, r) => s + r, 0) + modifier;
    const duration = 1000 + Math.random() * 2000;
    const rollId = Math.random().toString(36).slice(2);
    const lbl = label || `${count}d${sides}`;
    _selfRollIds.add(rollId);
    _broadcastDiceRoll(rollId, sides, results, modifier, total, lbl, duration);
    await showDiceAnimation(sides, results, modifier, total, lbl, duration);
    await postToChat({ sender: getChatSender(), dice: `${count}d${sides}`, results, modifier, total, label: lbl });
    _pushRollToChar(getActiveCharLinkedId(), { label: lbl, type: 'norm', detail: `${count}d${sides}(${results.join(',')})${modifier !== 0 ? (modifier > 0 ? '+' : '') + modifier : ''}`, total, isCrit: false, isFail: false, isDamage: false, time: new Date().toISOString() });
    return;
  }
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: getChatSender(), type: 'text', message: text })
    });
  } catch {}
}

async function quickRoll(sides) {
  const result   = Math.ceil(Math.random() * sides);
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, [result], 0, result, `d${sides}`, duration);
  await showDiceAnimation(sides, [result], 0, result, `d${sides}`, duration);
  await postToChat({ sender: getChatSender(), dice: `1d${sides}`, results: [result], modifier: 0, total: result, label: `d${sides}` });
  _pushRollToChar(getActiveCharLinkedId(), { label: `d${sides}`, type: 'norm', detail: `d${sides}(${result})`, total: result, isCrit: sides === 20 && result === 20, isFail: sides === 20 && result === 1, isDamage: false, time: new Date().toISOString() });
}

async function sendCustomRoll() {
  const count   = Math.max(1, Math.min(20, parseInt(document.getElementById('chat-count')?.value) || 1));
  const sides   = parseInt(document.getElementById('chat-sides')?.value) || 20;
  const mod     = parseInt(document.getElementById('chat-mod')?.value) || 0;
  const label   = document.getElementById('chat-label')?.value?.trim() || `${count}d${sides}`;
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total   = results.reduce((s, r) => s + r, 0) + mod;
  const duration = 1000 + Math.random() * 2000;
  const rollId   = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, results, mod, total, label, duration);
  await showDiceAnimation(sides, results, mod, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: `${count}d${sides}`, results, modifier: mod, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'norm', detail: `${count}d${sides}(${results.join(',')})${mod !== 0 ? (mod > 0 ? '+' : '') + mod : ''}`, total, isCrit: false, isFail: false, isDamage: false, time: new Date().toISOString() });
}

// ── Monster stat rendering (same logic as monsters.js) ───────────────────────
function parseEntry(s) {
  const escaped = String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return escaped.replace(/\{@(\w+)\s([^}]*)\}/g, (_,tag,content) => {
    const p = content.split('|');
    switch(tag) {
      case 'spell': case 'item': case 'creature': case 'condition': case 'status': case 'sense': return '<em>'+p[0]+'</em>';
      case 'hit': return (parseInt(p[0])>=0?'+':'')+p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc': return 'DC '+p[0];
      case 'h': case 'atk': case 'atkr': return '';
      case 'recharge': return '(Recharge '+p[0]+'–6)';
      default: return p[0]||content;
    }
  }).replace(/\{@\w+\}/g,'');
}

function renderMonsterFullStats(data, tok) {
  const SZ={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
  const AL={L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  const size=(data.size||[]).map(s=>SZ[s]||s).join('/');
  const typeStr=typeof data.type==='string'?data.type:data.type?(data.type.type||'')+(data.type.tags&&data.type.tags.length?' ('+data.type.tags.join(', ')+')':''):'';
  const align=(data.alignment||[]).map(a=>AL[a]||a).join(' ');
  const cr=(data.cr&&typeof data.cr==='object')?data.cr.cr:(data.cr||'—');
  const acStr=!data.ac?'—':[].concat(data.ac).map(a=>typeof a==='number'?a:typeof a==='object'?String(a.ac||'')+([].concat(a.from||[]).length?' ('+[].concat(a.from).join(', ')+')':''):a).join(', ');
  const hpStr=!data.hp?'—':data.hp.average!==undefined?String(data.hp.average)+(data.hp.formula?' ('+data.hp.formula+')':''):String(data.hp);
  const speedParts=[];
  if(data.speed){if(data.speed.walk)speedParts.push(data.speed.walk+' ft.');if(data.speed.fly)speedParts.push('fly '+data.speed.fly+' ft.');if(data.speed.swim)speedParts.push('swim '+data.speed.swim+' ft.');if(data.speed.climb)speedParts.push('climb '+data.speed.climb+' ft.');}
  const speedStr=speedParts.join(', ')||'—';
  const scores=['str','dex','con','int','wis','cha'],snames=['STR','DEX','CON','INT','WIS','CHA'];
  const saveStr=data.save?Object.entries(data.save).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const skillStr=data.skill?Object.entries(data.skill).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+' '+v).join(', '):'';
  const immuneStr=[].concat(data.immune||[]).map(i=>typeof i==='string'?i:[].concat(i.immune||[]).join('/')).join(', ');
  const resistStr=[].concat(data.resist||[]).map(i=>typeof i==='string'?i:[].concat(i.resist||[]).join('/')).join(', ');
  const condImmStr=[].concat(data.conditionImmune||[]).map(i=>typeof i==='string'?i:[].concat(i.conditionImmune||[]).join('/')).join(', ');
  const sensesStr=[...(data.senses||[])].join(', ')+(data.passive?((data.senses||[]).length?', ':'')+'Passive Perception '+data.passive:'');
  const langStr=(data.languages||[]).join(', ')||'—';
  const HR='<hr style="border:none;border-top:1px solid var(--a44);margin:6px 0">';
  function rEntries(entries){return(entries||[]).map(e=>{if(typeof e==='string')return'<p style="margin:2px 0 3px">'+parseEntry(e)+'</p>';if(e&&e.type==='list'&&Array.isArray(e.items))return'<ul style="margin:2px 0 3px;padding-left:14px">'+e.items.map(i=>'<li>'+parseEntry(typeof i==='string'?i:(i.name||''))+'</li>').join('')+'</ul>';return'';}).join('');}
  function rSection(items,title){if(!items||!items.length)return'';return HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>'+items.map(item=>'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>').join('');}
  function rSectionRollable(items,title){if(!items||!items.length)return'';const HR2=HR+'<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">'+title+'</div>';return HR2+items.map(item=>{const entryText=[].concat(item.entries||[]).join(' ');const atkMatch=entryText.match(/\{@hit\s([+-]?\d+)\}|([+-]\d+)\s+to\s+hit/i);const dmgMatch=entryText.match(/\d+d\d+(?:[+-]\d+)?(?:\s+\w+)?/i);if(atkMatch){const bonus=parseInt(atkMatch[1]||atkMatch[2]);const dmgStr=dmgMatch?dmgMatch[0]:'';return'<div class="qroll-row" onclick="qroll(\''+item.name.replace(/'/g,"\\'")+'\ atk\',\''+bonus+'\')" title="'+esc(entryText.slice(0,120))+'">'+'<span>'+parseEntry(item.name||'')+'</span>'+'<span style="display:flex;align-items:center;gap:4px">'+'<span class="qroll-dmg">'+esc(dmgStr)+'</span>'+'<span class="qroll-val">'+(bonus>=0?'+':'')+bonus+'</span>'+'</span></div>';}return'<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">'+parseEntry(item.name||'')+'</span> '+rEntries(item.entries)+'</div>';}).join('');}

  const hpFrac=(tok.hpMax>0)?(tok.hpCurrent||0)/tok.hpMax:0;
  let html='<div style="font-size:11px;line-height:1.5">';
  if(size||typeStr||align)html+='<div style="font-size:10px;font-style:italic;color:var(--txd);margin-bottom:4px">'+esc([size,typeStr,align].filter(Boolean).join(', '))+'</div>';
  html+=HR;
  html+='<div><span style="color:var(--ac);font-weight:bold">HP</span> <span style="color:'+hpBarColor(hpFrac)+'">'+tok.hpCurrent+'/'+tok.hpMax+'</span> <span style="color:var(--txd);font-size:10px">('+esc(hpStr)+')</span></div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">AC</span> '+esc(acStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">Speed</span> '+esc(speedStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">CR</span> '+esc(String(cr))+'</div>';
  html+=HR+'<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2px;text-align:center;margin:4px 0">';
  for(let i=0;i<6;i++){const sc=scores[i];const val=data[sc]||10;const m=Math.floor((val-10)/2);html+='<div style="background:var(--bg3);border-radius:3px;padding:3px 1px"><div style="font-size:8px;color:var(--ac);font-weight:bold">'+snames[i]+'</div><div style="font-size:12px;font-weight:bold">'+val+'</div><div style="font-size:9px;color:var(--txd)">'+(m>=0?'+':'')+m+'</div></div>';}
  html+='</div>'+HR;
  if(saveStr)html+='<div><span style="color:var(--ac);font-weight:bold">Saves</span> '+esc(saveStr)+'</div>';
  if(skillStr)html+='<div><span style="color:var(--ac);font-weight:bold">Skills</span> '+esc(skillStr)+'</div>';
  if(immuneStr)html+='<div><span style="color:var(--ac);font-weight:bold">Immune</span> '+esc(immuneStr)+'</div>';
  if(resistStr)html+='<div><span style="color:var(--ac);font-weight:bold">Resist</span> '+esc(resistStr)+'</div>';
  if(condImmStr)html+='<div><span style="color:var(--ac);font-weight:bold">Cond. Immune</span> '+esc(condImmStr)+'</div>';
  if(sensesStr)html+='<div><span style="color:var(--ac);font-weight:bold">Senses</span> '+esc(sensesStr)+'</div>';
  html+='<div><span style="color:var(--ac);font-weight:bold">Languages</span> '+esc(langStr)+'</div>';
  html+=rSection(data.trait,'Traits');
  html+=rSectionRollable(data.action,'Actions');
  html+=rSectionRollable(data.bonus,'Bonus Actions');
  html+=rSectionRollable(data.reaction,'Reactions');
  html+=rSectionRollable(data.legendary,'Legendary Actions');
  html+='<div style="margin-top:8px"><a href="/monsters.html" target="_blank" style="color:var(--ac);font-size:10px">📖 Full view →</a></div>';
  html+='</div>';
  return `<div class="qroll-section">
    <div class="qroll-section-hdr" onclick="toggleSideSection('monster')">
      <span style="color:#ff9999">${esc(data.name||'Monster')}</span>
      <span id="side-sec-monster-arrow">${_sideSecArrow('monster')}</span>
    </div>
    <div id="side-sec-monster" class="qroll-rows" style="${_sideSecStyle('monster')}">${html}</div>
  </div>`;
}

// ── Side panel Quick Roll (auto-populated from active initiative turn) ─────────

function toggleSideSection(name) {
  const el    = document.getElementById(`side-sec-${name}`);
  const arrow = document.getElementById(`side-sec-${name}-arrow`);
  if (el) {
    const hidden = el.style.display === 'none';
    el.style.display = hidden ? '' : 'none';
    if (arrow) arrow.textContent = hidden ? '▼' : '▶';
    if (hidden) _sideOpenSections.add(name); else _sideOpenSections.delete(name);
  }
}

function _sideSecStyle(name) {
  return _sideOpenSections.has(name) ? '' : 'display:none';
}
function _sideSecArrow(name) {
  return _sideOpenSections.has(name) ? '▼' : '▶';
}

function renderSideCharacter() {
  const d = qrollData || {};
  const spAtk = d['sp-atk'] !== undefined ? d['sp-atk'] : null;
  // 'init' is the total initiative modifier (dex mod + item bonuses + manual), same field index.js uses
  const initMod = parseInt(d['init']) || 0;
  const initBonusStr = initMod >= 0 ? '+' + initMod : '' + initMod;

  const skillRows = SKILL_NAMES.map((name, i) => {
    const val = d[`sk-${i}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)}','${esc(val)}')" title="${esc(name)}">
      <span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  const saveRows = SAVE_NAMES.map((name, i) => {
    const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)} Save','${esc(val)}')" title="${esc(name)} Save">
      <span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  let weapons = [];
  try { weapons = JSON.parse(d['_weapons'] || '[]'); } catch {}
  const atkRows = weapons.filter(r => r[0]).map(r => {
    const [wName, wAtk, wDmg] = [r[0]||'', r[1]||'+0', r[2]||''];
    const dmgRow = wDmg
      ? `<div class="qroll-row" onclick="rollDamageStr('${esc(wName)} Dmg','${esc(wDmg)}')" style="padding-left:20px;background:rgba(0,0,0,.15)">
          <span style="font-size:11px;color:var(--txd)">↳ Damage</span>
          <span class="qroll-val" style="color:#ff9966;font-size:13px">${esc(wDmg)}</span>
        </div>`
      : '';
    return `<div class="qroll-row" onclick="qroll('${esc(wName)} Atk','${esc(wAtk)}')" title="Attack roll">
      <span>${esc(wName)}</span><span class="qroll-val">${esc(wAtk)}</span>
    </div>${dmgRow}`;
  }).join('');
  const spAtkRow = spAtk !== null
    ? `<div class="qroll-row" onclick="qroll('Spell Attack','${esc(String(spAtk))}')" title="Spell Attack">
        <span>Spell Atk</span><span class="qroll-val">${parseInt(spAtk) >= 0 ? '+' : ''}${esc(String(spAtk))}</span></div>`
    : '';
  const atkSection = (atkRows + spAtkRow) || '<div style="padding:4px 0;font-size:11px;color:var(--txd)">No weapons.</div>';

  return `<div style="padding:2px 0 4px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:12px;color:var(--ac);font-weight:bold">${esc(qrollCharName)}</span>
    <button class="btn sm" onclick="rollInitiativeFromPanel()" title="Roll Initiative (d20${initBonusStr})" style="font-size:10px;padding:2px 6px">🎲 Init ${esc(initBonusStr)}</button>
  </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('skills')">Skills <span id="side-sec-skills-arrow">${_sideSecArrow('skills')}</span></div>
      <div id="side-sec-skills" class="qroll-rows" style="${_sideSecStyle('skills')}">${skillRows}</div>
    </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('saves')">Saves <span id="side-sec-saves-arrow">${_sideSecArrow('saves')}</span></div>
      <div id="side-sec-saves" class="qroll-rows" style="${_sideSecStyle('saves')}">${saveRows}</div>
    </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('attacks')">Attacks <span id="side-sec-attacks-arrow">${_sideSecArrow('attacks')}</span></div>
      <div id="side-sec-attacks" class="qroll-rows" style="${_sideSecStyle('attacks')}">${atkSection}</div>
    </div>`;
}


async function loadSideQroll() {
  const content = document.getElementById('side-qroll-content');
  if (!content) return;

  // Priority: selected token on map → initiative row click → active turn token
  let targetId = selectedTokenId || null;
  if (!targetId && _sideViewInitId) {
    const viewEntry = initData.entries?.find(e => e.id === _sideViewInitId);
    if (viewEntry) {
      const viewTok = tokens.find(t => t.initiativeId === _sideViewInitId);
      targetId = viewTok?.id || null;
    } else {
      _sideViewInitId = null; // entry no longer exists
    }
  }
  if (!targetId) {
    targetId = getActiveTurnTokenId() || null;
  }

  if (targetId === _sideQrollTokenId) return; // already rendered (data unchanged)
  // Only reset section state when switching to a genuinely different token
  if (targetId !== _sidePrevTokenId) _sideOpenSections.clear();
  _sidePrevTokenId = targetId;
  _sideQrollTokenId = targetId;

  const activeTok = targetId ? tokens.find(t => t.id === targetId) : null;
  if (!activeTok) { content.innerHTML = ''; qrollCharName = ''; qrollData = null; return; }

  if (activeTok.type === 'monster') {
    qrollCharName = tokDisplayName(activeTok);
    qrollData = null;
    if (isDM() && activeTok.linkedId) {
      // DM: load and show full stat block
      if (_monsterList.length === 0) {
        try {
          const r = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
          if (r.ok) _monsterList = await r.json();
        } catch {}
      }
      const mon = _monsterList.find(m => m.id === activeTok.linkedId);
      if (mon) {
        content.innerHTML = renderMonsterFullStats(mon.data || {}, activeTok);
        // section open/collapsed state is preserved via _sideOpenSections
        return;
      }
    }
    // Players (or monster with no linkedId): show identifier only — no HP, no real name
    content.innerHTML = `<div style="font-size:13px;color:#ff9999;font-weight:bold;margin-bottom:6px">${esc(tokDisplayName(activeTok))}</div>`;
    return;
  }

  // Character / NPC / custom
  if (activeTok.linkedId) {
    try {
      // Use public qroll endpoint so all players can see skills/saves/attacks
      // DM uses full endpoint (has access to all data anyway)
      const url = isDM()
        ? `/api/characters/${activeTok.linkedId}`
        : `/api/characters/${activeTok.linkedId}/qroll`;
      const headers = isDM() ? { 'X-Character-Password': masterPw } : {};
      const r = await fetch(url, { headers });
      if (r.ok) {
        const char = await r.json();
        qrollCharName = char.name || activeTok.name;
        qrollData = char.data || {};
        content.innerHTML = renderSideCharacter();
        // section open/collapsed state is preserved via _sideOpenSections
        return;
      }
    } catch {}
  }
  qrollCharName = activeTok.name;
  qrollData = null;
  content.innerHTML = `<div style="font-size:12px;color:var(--ac);font-weight:bold;padding:2px 0">${esc(activeTok.name)}</div>
    <div style="font-size:11px;color:var(--txd)">HP: ${activeTok.hpCurrent||0}/${activeTok.hpMax||0}</div>`;
}

function qroll(label, modifier) {
  rollPending = { label, modifier: parseInt(String(modifier).replace(/[^0-9\-+]/g,'')) || 0 };
  const lbl = document.getElementById('adv-label');
  if (lbl) lbl.textContent = 'Roll: ' + label;
  document.getElementById('adv-modal').style.display = 'flex';
}

function parseDice(expr) {
  if (!expr) return null;
  const cleaned = String(expr).trim().replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)((?:[+\-]\d+)*)/);
  if (!m) {
    const flat = parseInt(cleaned);
    if (!isNaN(flat)) return { total: flat, detail: String(flat) };
    return null;
  }
  const num = parseInt(m[1]), die = parseInt(m[2]);
  let mod = 0;
  (m[3] || '').match(/[+\-]\d+/g)?.forEach(s => { mod += parseInt(s); });
  const rolls = Array.from({ length: num }, () => Math.ceil(Math.random() * die));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  let detail = `${num}d${die}(${rolls.join(',')})`;
  if (mod !== 0) detail += (mod > 0 ? '+' : '') + mod;
  return { total, detail, rolls, die, num, mod, diceExpr: `${num}d${die}` };
}

async function rollDamageStr(label, dmgStr) {
  const result = parseDice(dmgStr);
  if (!result) return;
  const sides    = result.die || 6;
  const rolls    = result.rolls || [result.total];
  const modifier = result.mod || 0;
  const { total } = result;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, rolls, modifier, total, label, duration);
  await showDiceAnimation(sides, rolls, modifier, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: result.diceExpr || String(total), results: rolls, modifier, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'dmg', detail: result.detail, total, isCrit: false, isFail: false, isDamage: true, time: new Date().toISOString() });
}

function rollInitiativeFromPanel() {
  const d = qrollData || {};
  // Use the total initiative field (dex mod + items + manual), same as index.js rollMyInitiative()
  const modifier = parseInt(d['init']) || 0;
  const activeTokId = getActiveTurnTokenId();
  const targetId = activeTokId || (!initData.currentId ? selectedTokenId : null);
  const tok = targetId ? tokens.find(t => t.id === targetId) : null;
  rollPending = {
    label: 'Initiative',
    modifier,
    afterRoll: tok?.linkedId ? async (total) => {
      try {
        await fetch('/api/initiative/roll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId: tok.linkedId, name: qrollCharName || tok.name, roll: total })
        });
      } catch {}
    } : null
  };
  const lbl = document.getElementById('adv-label');
  if (lbl) lbl.textContent = 'Roll: Initiative';
  document.getElementById('adv-modal').style.display = 'flex';
}

// ── Advantage modal ───────────────────────────────────────────────────────────
function advClose() {
  document.getElementById('adv-modal').style.display = 'none';
  rollPending = null;
}

async function confirmRoll(type) {
  if (!rollPending) return;
  document.getElementById('adv-modal').style.display = 'none';
  const { label, modifier, afterRoll } = rollPending;
  rollPending = null;
  const charId = getActiveCharLinkedId();
  const r1 = Math.ceil(Math.random() * 20);
  const r2 = Math.ceil(Math.random() * 20);
  const used = type === 'adv' ? Math.max(r1, r2) : type === 'dis' ? Math.min(r1, r2) : r1;
  const total = used + modifier;
  const chatLabel = type === 'adv' ? `${label} (Adv)` : type === 'dis' ? `${label} (Dis)` : label;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  // For adv/dis show both dice; usedIdx identifies the kept die
  const dieResults = type !== 'norm' ? [r1, r2] : [r1];
  const usedIdx    = type === 'adv' ? (r2 > r1 ? 1 : 0) : type === 'dis' ? (r2 < r1 ? 1 : 0) : 0;
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, 20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  await showDiceAnimation(20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  await postToChat({ sender: getChatSender(), dice: '1d20', results: [used], modifier, total, label: chatLabel });
  const detail = type !== 'norm' ? `d20(${r1}, ${r2} → ${used})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' \u2212 ') + Math.abs(modifier) : ''}` : `d20(${r1})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' \u2212 ') + Math.abs(modifier) : ''}`;
  _pushRollToChar(charId, { label: chatLabel, type, detail, total, isCrit: used === 20, isFail: used === 1, isDamage: false, time: new Date().toISOString() });
  if (afterRoll) afterRoll(total);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && placementState) { exitPlacementMode(); return; }
  if (e.key === 'Escape' && currentTool === 'draw') { drawingState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); setTool('select'); return; }
  if (document.getElementById('adv-modal').style.display === 'flex') {
    if      (e.key === 'a' || e.key === 'A') { e.preventDefault(); confirmRoll('adv'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); confirmRoll('norm'); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); confirmRoll('dis'); }
    else if (e.key === 'Escape') advClose();
    return;
  }
  // Don't intercept keys while typing in an input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape' && selectedTokenId) {
    selectedTokenId = null;
    renderTokens();
    _sideQrollTokenId = null;
    renderSidePanel();
    if (!initData.currentId) loadSideQroll();
    return;
  }
  if (selectedTokenId) {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveSelectedToken(e.key);
    } else if (e.key === 'Delete' && isDM()) {
      e.preventDefault();
      deleteSelectedToken();
    }
  }
});

// ── HP Panel ──────────────────────────────────────────────────────────────────
function openHpPanel(tok) {
  selectedTokenId = tok.id;
  _refreshHpPanel(tok);
  document.getElementById('hp-panel').style.display = '';
}
function closeHpPanel() {
  document.getElementById('hp-panel').style.display = 'none';
  // Keep selectedTokenId — token stays selected after closing HP panel
}
function _refreshHpPanel(tok) {
  const hpPct = (tok.hpMax || 0) > 0 ? Math.max(0, Math.min(1, (tok.hpCurrent || 0) / tok.hpMax)) : 0;
  document.getElementById('hp-panel-name').textContent = tokDisplayName(tok);
  const delBtn = document.getElementById('hp-del-btn');
  if (delBtn) delBtn.style.display = isDM() ? '' : 'none';
  const curEl = document.getElementById('hp-cur-display');
  curEl.textContent = tok.hpCurrent || 0;
  curEl.style.color = hpBarColor(hpPct);
  document.getElementById('hp-max-display').textContent = tok.hpMax || 0;
  const temp = tok.hpTemp || 0;
  const tempWrap = document.getElementById('hp-temp-display-wrap');
  tempWrap.style.display = temp > 0 ? '' : 'none';
  document.getElementById('hp-temp-display').textContent = temp;
  document.getElementById('hp-temp-input').value = temp;
  // Visibility toggle — DM only
  const visRow = document.getElementById('hp-vis-row');
  const visBtn = document.getElementById('hp-vis-btn');
  if (visRow && visBtn) {
    if (isDM()) {
      visRow.style.display = '';
      const isVisible = tok.visible !== false;
      visBtn.textContent = isVisible ? '👁 Visible to players' : '🚫 Hidden from players';
      visBtn.style.background = isVisible ? 'var(--ok)' : 'var(--err)';
      visBtn.style.color = '#fff';
      visBtn.style.border = 'none';
    } else {
      visRow.style.display = 'none';
    }
  }
  // Conditions grid — all editors
  const condGrid = document.getElementById('hp-conditions-grid');
  if (condGrid) {
    const active = parseConditions(tok.conditions);
    condGrid.innerHTML = '';
    for (const c of CONDITIONS) {
      const btn = document.createElement('button');
      btn.className = 'cond-btn' + (active.includes(c) ? ' active' : '');
      btn.textContent = COND_ABBREV[c];
      btn.title = c;
      btn.onclick = () => toggleCondition(c);
      condGrid.appendChild(btn);
    }
  }
  // Roll Initiative — DM only, all token types
  const initRow = document.getElementById('hp-init-row');
  const initBtn = document.getElementById('hp-init-btn');
  if (initRow && initBtn) {
    if (isDM()) {
      initRow.style.display = '';
      const hasEntry = !!initData.entries.find(e => e.id === tok.initiativeId);
      initBtn.textContent = hasEntry ? '🎲 Reroll Initiative' : '🎲 Roll Initiative';
    } else {
      initRow.style.display = 'none';
    }
  }
}

async function toggleTokenVisibility() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  await _putHp({ visible: tok.visible === false });
}

async function rollTokenInitiative() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  // DEX modifier from monster data (works for any token type; defaults to 0)
  let dexMod = 0;
  if (tok.linkedId) {
    const mon = _monsterList.find(m => m.id === tok.linkedId);
    if (mon?.data?.dex) dexMod = Math.floor((parseInt(mon.data.dex) - 10) / 2);
  }
  const d20 = Math.ceil(Math.random() * 20);
  const roll = d20 + dexMod;
  const modStr = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;
  const existingEntry = initData.entries.find(e => e.id === tok.initiativeId);
  try {
    if (existingEntry) {
      const res = await fetch(`/api/initiative/${tok.initiativeId}/roll`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ roll })
      });
      if (!res.ok) return showToast('Failed to update initiative.', true);
    } else {
      const res = await fetch('/api/initiative/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ name: tok.name, roll, monsterId: tok.linkedId || '' })
      });
      if (!res.ok) return showToast('Failed to add initiative entry.', true);
      const data = await res.json();
      if (data.id) {
        await fetch(`/api/table/tokens/${tok.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ initiativeId: data.id })
        });
        patchToken(tok.id, { initiativeId: data.id });
      }
    }
    showToast(`${tok.name}: d20(${d20})${dexMod !== 0 ? modStr : ''} = ${roll}`);
    _refreshHpPanel({ ...tok, initiativeId: tok.initiativeId || '' });
  } catch { showToast('Connection error.', true); }
}
function updateHpPanel(tok) {
  if (selectedTokenId !== tok.id) return;
  _refreshHpPanel(tok);
}

function _putHp(fields) {
  // Optimistic update — immediate
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (tok) {
    patchToken(selectedTokenId, fields);
    _refreshHpPanel({ ...tok, ...fields });
    renderHpTable();
    renderSidePanel();
  }
  // Network — queued (capture id now; selectedTokenId may change before queue runs)
  const id = selectedTokenId;
  _tokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify(fields)
      });
    } catch {}
  });
}

function toggleCondition(name) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const active = parseConditions(tok.conditions);
  const next = active.includes(name) ? active.filter(c => c !== name) : [...active, name];
  const condStr = JSON.stringify(next);
  // Optimistic update — immediate
  patchToken(selectedTokenId, { conditions: condStr });
  _refreshHpPanel({ ...tok, conditions: condStr });
  renderTokens();
  // Network — queued
  const id = selectedTokenId;
  _tokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: condStr })
      });
    } catch {}
  });
}

function applyHpChange(mode) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const amount = Math.max(0, parseInt(document.getElementById('hp-amount').value) || 0);
  if (amount === 0) return;
  if (mode === 'dmg') {
    // Damage absorbs temp HP first
    let remaining = amount;
    const newTemp = Math.max(0, (tok.hpTemp || 0) - remaining);
    remaining = Math.max(0, remaining - (tok.hpTemp || 0));
    const newHp = Math.max(0, (tok.hpCurrent || 0) - remaining);
    _putHp({ hpCurrent: newHp, hpTemp: newTemp });
  } else {
    const newHp = Math.min(tok.hpMax || 0, (tok.hpCurrent || 0) + amount);
    _putHp({ hpCurrent: newHp });
  }
}
function quickDmg(n) {
  document.getElementById('hp-amount').value = n;
  applyHpChange('dmg');
}
function quickHeal(n) {
  document.getElementById('hp-amount').value = n;
  applyHpChange('heal');
}
async function applyTempHp() {
  const val = Math.max(0, parseInt(document.getElementById('hp-temp-input').value) || 0);
  _putHp({ hpTemp: val });
}

// Enter key on amount field triggers damage by default
document.getElementById('hp-amount')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') applyHpChange('dmg');
});

// ── HP tracker ────────────────────────────────────────────────────────────────
function renderHpTable() {
  const list = document.getElementById('hp-tracker-list');
  if (!list) return;
  const visible = tokens.filter(t => {
    if (t.visible === false && !isDM()) return false;
    // Hide monsters from non-DM players until initiative is running
    if (!isDM() && t.type === 'monster' && !initData.currentId) return false;
    return true;
  });
  if (visible.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:var(--txd)">No tokens on map.</div>';
    return;
  }
  const activeTokId = getActiveTurnTokenId();
  list.innerHTML = visible.map(tok => {
    const cur = tok.hpCurrent || 0;
    const max = tok.hpMax || 0;
    const temp = tok.hpTemp || 0;
    const hpPct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    const col = hpBarColor(hpPct);
    const isMonster = tok.type === 'monster';
    const showNums = !isMonster || isDM();
    const isCur = tok.id === activeTokId;
    const canEdit = isDM() || tok.type === 'character' || tok.type === 'npc';
    const rowStyle = `display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--sep)${isCur ? ';background:var(--a22);margin:0 -10px;padding-left:10px;padding-right:10px' : ''}${canEdit ? ';cursor:pointer' : ''}`;
    const hpNumStr = showNums
      ? `<span style="font-weight:bold;color:${col}">${cur}</span><span style="color:var(--txd)">/${max}</span>${temp > 0 ? `<span style="color:#aaddff;font-size:10px"> +${temp}</span>` : ''}`
      : '';
    const clickAttr = canEdit ? `onclick="openHpPanel(tokens.find(t=>t.id==='${tok.id}'))"` : '';
    const activeConds = parseConditions(tok.conditions);
    const condsHtml = activeConds.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px" onclick="event.stopPropagation()">
          ${activeConds.map(c => `<a href="https://5e.tools/conditionsdiseases.html#${encodeURIComponent(c.toLowerCase())}_xphb" target="_blank" rel="noopener"
              style="font-size:9px;font-weight:bold;background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.6);color:#ffa500;border-radius:2px;padding:0 3px;line-height:13px;text-decoration:none;white-space:nowrap"
              title="${esc(c)}">${esc(COND_ABBREV[c] || c.slice(0,2).toUpperCase())}</a>`).join('')}
        </div>`
      : '';
    return `<div style="${rowStyle}" ${clickAttr}>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${isCur ? ';color:var(--ac);font-weight:bold' : ''}">${isCur ? '▶ ' : ''}${esc(tokDisplayName(tok))}</div>
        ${condsHtml}
        <div style="display:flex;align-items:center;gap:3px;margin-top:2px">
          <div style="flex:1;background:var(--bg3);border-radius:2px;overflow:hidden;height:4px">
            <div style="width:${hpPct*100}%;height:100%;background:${col};transition:width .3s"></div>
          </div>
          ${temp > 0 ? `<div style="width:${Math.min(30,temp/max*100)}%;max-width:20%;height:4px;background:#aaddff;border-radius:2px;flex-shrink:0"></div>` : ''}
        </div>
      </div>
      <div style="font-size:11px;min-width:44px;text-align:right;flex-shrink:0;line-height:1.3">${hpNumStr}</div>
    </div>`;
  }).join('');
}

// ── Side panel ────────────────────────────────────────────────────────────────
function renderSidePanel() {
  const activeTokId = getActiveTurnTokenId();
  const activeTok = tokens.find(t => t.id === activeTokId);
  const movEl = document.getElementById('movement-display');
  const infoEl = document.getElementById('active-token-info');
  if (!initData.currentId) {
    if (movEl) movEl.textContent = '∞ (free)';
    const selTok = selectedTokenId ? tokens.find(t => t.id === selectedTokenId) : null;
    if (infoEl) infoEl.innerHTML = selTok ? `<strong>${esc(tokDisplayName(selTok))}</strong>` : 'No initiative';
  } else if (activeTok) {
    const remaining = (activeTok.speed || 30) - (activeTok.movedFt || 0);
    if (movEl) movEl.textContent = `${remaining} / ${activeTok.speed || 30} ft`;
    if (infoEl) infoEl.innerHTML = `<strong>${esc(tokDisplayName(activeTok))}</strong>`;
  } else {
    if (movEl) movEl.textContent = '— ft';
    if (infoEl) infoEl.textContent = 'None';
  }
}

// ── Add Token Modal ───────────────────────────────────────────────────────────
function openAddTokenModal() {
  if (_addTokenBusy) return;
  _pendingTokenLinkedId = null;
  _pendingTokenType = null;
  switchTokenTab('chars');
  document.getElementById('add-token-modal').style.display = 'flex';
}
function closeAddTokenModal() {
  document.getElementById('add-token-modal').style.display = 'none';
}

function switchTokenTab(tab) {
  _pendingTokenTab = tab;
  ['chars','monsters','custom'].forEach(t => {
    document.getElementById(`tok-tab-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tabBtn-${t}`)?.classList.toggle('active', t === tab);
  });
  const idRow = document.getElementById('tok-identifier-row');
  if (idRow) {
    idRow.style.display = tab === 'monsters' ? 'flex' : 'none';
    if (tab !== 'monsters') document.getElementById('tok-identifier').value = '';
  }
}

async function populateAddTokenModal(chars) {
  // Characters tab
  const charTab = document.getElementById('tok-tab-chars');
  if (charTab && chars.length > 0) {
    charTab.innerHTML = chars.map(c => `
      <div class="qroll-row" onclick="selectTokenChar('${esc(c.id)}','${esc(c.name)}','${c.char_type||'character'}')"
           style="padding:6px 10px;border-bottom:1px solid var(--sep)">
        <span>${esc(c.name)}</span>
        <span style="font-size:10px;color:var(--txd)">${c.char_type === 'npc' ? 'NPC' : 'PC'}</span>
      </div>`).join('');
  } else if (charTab) {
    charTab.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--txd)">No characters found.</div>';
  }

  // Monsters tab (load on demand)
  const monTab = document.getElementById('tok-tab-monsters');
  if (monTab && isDM()) {
    try {
      const mRes = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
      if (mRes.ok) {
        _monsterList = await mRes.json();
        monTab.innerHTML = _monsterList.length > 0
          ? _monsterList.map(m => {
              const portrait = m.data?.portraitThumb || m.data?.portrait;
              const thumb = portrait
                ? `<img loading="lazy" src="${portrait}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid var(--a55);flex-shrink:0">`
                : `<div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);border:1px solid var(--a55);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--txd)">?</div>`;
              return `<div class="qroll-row" onclick="selectTokenMonster('${esc(m.id)}','${esc(m.name)}')"
                   style="padding:5px 10px;border-bottom:1px solid var(--sep);display:flex;align-items:center;gap:8px">
                ${thumb}
                <span style="flex:1">${esc(m.name)}</span>
                <span style="font-size:10px;color:var(--txd)">CR ${esc(m.cr||'?')}</span>
                <button onclick="event.stopPropagation();uploadMonsterPortrait('${esc(m.id)}')"
                        style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;opacity:.6"
                        title="Upload portrait">📷</button>
              </div>`;
            }).join('')
          : '<div style="padding:10px;font-size:11px;color:var(--txd)">No monsters found.</div>';
      }
    } catch {}
  }
}

async function uploadMonsterPortrait(monsterId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const res = await fetch(`/api/monsters/${monsterId}/portrait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ dataUrl: e.target.result })
        });
        if (!res.ok) { showToast('Upload failed.', true); return; }
        // Update local cache so the thumbnail updates immediately
        const mon = _monsterList.find(m => m.id === monsterId);
        if (mon) { if (!mon.data) mon.data = {}; mon.data.portrait = e.target.result; }
        // Rebuild monster tab HTML
        await populateAddTokenModal(_charList);
        showToast('Portrait saved.');
      } catch { showToast('Upload failed.', true); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function selectTokenChar(charId, charName, charType) {
  _pendingTokenLinkedId = charId;
  _pendingTokenType = charType === 'npc' ? 'npc' : 'character';
  // highlight selected
  document.querySelectorAll('#tok-tab-chars .qroll-row').forEach(r => r.style.background = '');
  event.currentTarget.style.background = 'var(--a22)';
}

function selectTokenMonster(monsterId, monsterName) {
  _pendingTokenLinkedId = monsterId;
  _pendingTokenType = 'monster';
  document.querySelectorAll('#tok-tab-monsters .qroll-row').forEach(r => r.style.background = '');
  event.currentTarget.style.background = 'var(--a22)';
}

async function submitAddToken() {
  const tab = _pendingTokenTab;
  let payload;
  const cs = tableState.cellSize || 50;
  const { w, h } = getCanvasSize();
  const centerX = Math.floor((w / 2 - (tableState.offsetX||0)) / cs);
  const centerY = Math.floor((h / 2 - (tableState.offsetY||0)) / cs);

  const tokenSize = parseInt(document.getElementById('tok-size-sel')?.value) || 1;

  if (tab === 'custom') {
    const name = document.getElementById('custom-tok-name')?.value?.trim();
    if (!name) { showToast('Name is required.', true); return; }
    payload = {
      name, type: 'custom',
      hpCurrent: parseInt(document.getElementById('custom-tok-hp')?.value) || 10,
      hpMax: parseInt(document.getElementById('custom-tok-hp')?.value) || 10,
      speed: parseInt(document.getElementById('custom-tok-speed')?.value) || 30,
      color: document.getElementById('custom-tok-color')?.value || '#888888',
      tokenSize, x: centerX, y: centerY
    };
  } else if (tab === 'chars' && _pendingTokenLinkedId) {
    // Fetch char data for HP/speed
    const char = _charList.find(c => c.id === _pendingTokenLinkedId);
    const name = char?.name || 'Character';
    let hpMax = 10, hpCur = 10, hpTemp = 0, speed = 30;
    try {
      const res = await fetch(`/api/characters/${_pendingTokenLinkedId}`, {
        headers: masterPw ? { 'X-Character-Password': masterPw } : {}
      });
      if (res.ok) {
        const cdata = await res.json();
        hpMax = parseInt(cdata.data?.hpmax) || 10;
        hpCur = parseInt(cdata.data?.hpcur) || hpMax;
        hpTemp = Math.max(0, parseInt(cdata.data?.hptemp) || 0);
        if (cdata.data?.['speed-base'] !== undefined) {
          // speed-base is raw; add equipped item bonuses
          let charItems = [];
          try { charItems = JSON.parse(cdata.data?.['_items'] || '[]'); } catch {}
          const itemSpeedBonus = charItems.filter(i => i.equipped)
            .reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
          speed = (parseInt(String(cdata.data['speed-base']).replace(/[^0-9]/g,'')) || 30) + itemSpeedBonus;
        } else {
          // Older character — data.speed already includes bonuses
          speed = parseInt(String(cdata.data?.speed || '30').replace(/[^0-9]/g,'')) || 30;
        }
      }
    } catch {}
    // Fetch portrait (DM only — non-DMs won't have masterPw but portrait is stored on token anyway)
    let portrait = null, portraitThumb = null;
    if (masterPw) {
      try {
        const pRes = await fetch(`/api/characters/${_pendingTokenLinkedId}/portrait`, {
          headers: { 'X-Master-Password': masterPw }
        });
        if (pRes.ok) { const pd = await pRes.json(); portrait = pd.portrait || null; portraitThumb = pd.portraitThumb || null; }
      } catch {}
    }
    const initEntry = initData.entries.find(e => e.charId === _pendingTokenLinkedId);
    payload = {
      name, type: _pendingTokenType || 'character', linkedId: _pendingTokenLinkedId,
      hpCurrent: hpCur, hpMax, hpTemp, speed,
      color: _pendingTokenType === 'npc' ? '#7ec8e3' : '#c8a04a',
      initiativeId: initEntry?.id || '',
      portrait, portraitThumb,
      tokenSize, x: centerX, y: centerY
    };
  } else if (tab === 'monsters' && _pendingTokenLinkedId) {
    const mon = _monsterList.find(m => m.id === _pendingTokenLinkedId);
    const baseName = mon?.name || 'Monster';
    let identifier = document.getElementById('tok-identifier')?.value?.trim();
    if (!identifier) {
      // Generate a random letter + digit, e.g. "A3", "K7"
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      identifier = letters[Math.floor(Math.random() * letters.length)]
                 + (Math.floor(Math.random() * 9) + 1);
    }
    const name = `${baseName} ${identifier}`;
    const mData = mon?.data || {};
    const hp = mData.hp?.average || mData.hp || 10;
    const spd = mData.speed?.walk || (typeof mData.speed === 'string' ? parseInt(mData.speed) : null) || 30;
    payload = {
      name, type: 'monster', linkedId: _pendingTokenLinkedId,
      hpCurrent: hp, hpMax: hp, speed: spd,
      color: '#cc3333',
      initiativeId: '', // always empty → server creates a new entry per monster using the identifier name
      portrait: mon?.data?.portrait || null,
      portraitThumb: mon?.data?.portraitThumb || null,
      label: identifier, // shown to players instead of the full monster name
      tokenSize, x: centerX, y: centerY
    };
  } else {
    showToast('Select a character or monster first, or fill in custom fields.', true);
    return;
  }

  closeAddTokenModal();
  enterPlacementMode(payload);
}

async function clearAllTokens() {
  if (!await showConfirm('Remove all tokens and clear initiative?')) return;
  try {
    await fetch('/api/table/clear', { method: 'POST', headers: { 'X-Master-Password': masterPw } });
  } catch { showToast('Failed to clear tokens.', true); }
}


// ── Page init ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  masterPw = sessionStorage.getItem('tableMasterPw') || '';
  applyDMControls();
  setTool('select'); // initialize pointer-events on overlay canvas

  // Open init panel by default
  const initBody = document.getElementById('init-body-wrap');
  if (initBody) { initBody.classList.add('open'); initPanelOpen = true; }
  const initChev = document.getElementById('init-chevron');
  if (initChev) initChev.textContent = '▼';

  try {
    const [tableRes, initRes, charsRes] = await Promise.all([
      fetch('/api/table'),
      fetch('/api/initiative'),
      fetch('/api/characters')
    ]);

    if (tableRes.ok) {
      const { state, tokens: tok } = await tableRes.json();
      tableState = state; tokens = tok;
    }
    if (initRes.ok) initData = await initRes.json();
    if (charsRes.ok) {
      _charList = await charsRes.json();
    }

    await populateAddTokenModal(_charList);
  } catch (err) { console.error('Init error:', err); }

  const { w, h } = getCanvasSize();
  resizeCanvases(w, h);

  if (tableState.hasMap) {
    mapImg.src = '/api/table/map?' + Date.now();
    mapImg.style.display = '';
  }

  applyFogRegions(tableState.fogRegions || []);
  applyHiddenItems(tableState.hiddenItems || []);
  renderGrid();
  renderFog();
  renderItems();
  renderTokens();
  renderHpTable();
  renderInitiativeTracker();
  updateInitiativeButton();
  renderSidePanel();
  loadSideQroll();

  fetchDrawings();
  startSSE();

  // Load chat history in background — non-blocking so map and SSE start immediately
  fetch('/api/chat')
    .then(r => r.ok ? r.json() : [])
    .then(entries => { entries.forEach(appendChatEntry); scrollChatLog(); })
    .catch(() => {});
});
