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

// ── Token rendering ───────────────────────────────────────────────────────────
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
