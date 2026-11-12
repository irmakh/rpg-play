// Written by Irmak Hakman — 2026-11-12 16:42
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── DM map notes ──────────────────────────────────────────────────────────────
// Pins the DM drops on the map with a title and some text. Only the DM ever has
// them: the server leaves them out of every player response and broadcast, so
// a player's page never holds a note to draw (see server/routes/table.js).
//
// A note's x, y are grid cells and may be fractional, so a pin sits exactly
// where it was dropped and follows the map when the cell size changes.
//
//   Notes tool (T):  click the map to add a note there, click a pin to edit
//                    it, drag a pin to move it.
//   Move tool:       click a pin and it is listed in the map menu with the fog
//                    and items under it, with Edit and Delete.

const NOTE_DRAG_SLOP = 4;   // px a press must travel before it is a drag, not a click
let _noteDrag = null;       // { id, startX, startY, origX, origY, moved }
let _noteEditing = null;    // id of the note open in the editor, or null for a new one
let _noteNewAt = null;      // { x, y } for a new note

function applyMapNotes(list) {
  mapNotes = Array.isArray(list) ? list : [];
  renderItems();   // pins are drawn on the items canvas, above the fog
  if (_noteEditing && !mapNotes.some(n => n.id === _noteEditing)) closeMapNoteEditor();
}

/** Pin radius in canvas pixels for a cell size: readable at any zoom, never larger than a cell. */
function noteRadius(cs) { return Math.max(8, Math.min(cs * 0.28, 14)); }

function notePos(n) {
  const cs = tableState.cellSize || 50;
  return { x: (tableState.offsetX || 0) + n.x * cs, y: (tableState.offsetY || 0) + n.y * cs };
}

/** Grid cells (fractional, two decimals) for a canvas point. */
function noteCellAt(px, py) {
  const cs = tableState.cellSize || 50;
  const r2 = v => Math.max(0, Math.round(v * 100) / 100);
  return { x: r2((px - (tableState.offsetX || 0)) / cs), y: r2((py - (tableState.offsetY || 0)) / cs) };
}

/** The topmost note whose pin covers a canvas point, or null. */
function noteAtPoint(px, py) {
  if (!isDM()) return null;
  const hitR = noteRadius(tableState.cellSize || 50) + 3;
  for (let i = mapNotes.length - 1; i >= 0; i--) {
    const p = notePos(mapNotes[i]);
    if (Math.hypot(px - p.x, py - p.y) <= hitR) return mapNotes[i];
  }
  return null;
}

/** Draw every pin. Called from renderItems() with the items canvas context. */
function drawMapNotes(ctx) {
  if (!ctx || !isDM() || !mapNotes.length) return;
  const cs = tableState.cellSize || 50;
  const r = noteRadius(cs);
  ctx.save();
  for (const n of mapNotes) {
    const p = notePos(n);
    const dragging = _noteDrag && _noteDrag.id === n.id && _noteDrag.moved;
    // Parchment disc with a dark rim and a folded-page glyph.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = dragging ? 'rgba(255,236,170,0.75)' : 'rgba(240,222,160,0.96)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(70,45,10,0.9)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(70,45,10,0.95)';
    ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✎', p.x, p.y + 1);
    // Title beside the pin, on a dark band so it reads over any map.
    // Title beside the pin, the same size as hidden-item labels.
    const title = String(n.title || '').trim();
    if (title) {
      const px = mapItemTextPx(cs, 1, 1, zoomPct / 100).label;
      ctx.font = `bold ${px}px Segoe UI, sans-serif`;
      const label = fitMapText(ctx, title, cs * 5);
      strokeMapText(ctx, label, p.x + r + 4, p.y, px, 'rgba(255,226,150,0.98)', 'left', 'middle');
    }
  }
  ctx.restore();
}

// ── Notes tool ────────────────────────────────────────────────────────────────
function onNoteToolDown(e, pos) {
  if (!isDM()) return;
  const hit = noteAtPoint(pos.x, pos.y);
  if (!hit) { openMapNoteEditor(null, noteCellAt(pos.x, pos.y)); return; }
  _noteDrag = { id: hit.id, startX: pos.x, startY: pos.y, origX: hit.x, origY: hit.y, moved: false };
  window.addEventListener('mousemove', _onNoteDragMove);
  window.addEventListener('mouseup', _onNoteDragEnd, { once: true });
}

function _onNoteDragMove(e) {
  if (!_noteDrag) return;
  const pos = getCanvasPos(e);
  if (!_noteDrag.moved && Math.hypot(pos.x - _noteDrag.startX, pos.y - _noteDrag.startY) < NOTE_DRAG_SLOP) return;
  _noteDrag.moved = true;
  const n = mapNotes.find(m => m.id === _noteDrag.id);
  if (!n) return;
  const cs = tableState.cellSize || 50;
  n.x = Math.max(0, Math.round((_noteDrag.origX + (pos.x - _noteDrag.startX) / cs) * 100) / 100);
  n.y = Math.max(0, Math.round((_noteDrag.origY + (pos.y - _noteDrag.startY) / cs) * 100) / 100);
  renderItems();
}

async function _onNoteDragEnd() {
  window.removeEventListener('mousemove', _onNoteDragMove);
  const d = _noteDrag;
  _noteDrag = null;
  if (!d) return;
  const n = mapNotes.find(m => m.id === d.id);
  if (!n) return;
  if (!d.moved) { openMapNoteEditor(n.id); return; }
  renderItems();
  const ok = await _noteRequest('PUT', '/api/table/notes/' + encodeURIComponent(n.id), { x: n.x, y: n.y });
  if (!ok) { n.x = d.origX; n.y = d.origY; renderItems(); }
}

/** Escape while dragging puts the pin back. Returns true when it did something. */
function cancelNoteDrag() {
  if (!_noteDrag) return false;
  const n = mapNotes.find(m => m.id === _noteDrag.id);
  if (n) { n.x = _noteDrag.origX; n.y = _noteDrag.origY; }
  window.removeEventListener('mousemove', _onNoteDragMove);
  window.removeEventListener('mouseup', _onNoteDragEnd);
  _noteDrag = null;
  renderItems();
  return true;
}

// ── Map menu (Move tool) ──────────────────────────────────────────────────────
function _mctxNoteBody(n) {
  return `<div class="mctx-kind"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-document"></use></svg> DM Note</div>`
    + `<div class="mctx-name">${esc(n.title || 'Note')}</div>`
    + (n.text ? `<div class="mctx-desc mctx-note-text">${esc(n.text)}</div>` : '')
    + `<div class="mctx-state" style="color:var(--ash)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-lock"></use></svg> Only you see this</div>`
    + `<div class="mctx-note-acts">`
    +   `<button class="btn sm mctx-go" onclick="_dismissMapCtxMenu();openMapNoteEditor('${escJs(n.id)}')"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-pencil"></use></svg> Edit</button>`
    +   `<button class="btn sm danger mctx-go" onclick="_dismissMapCtxMenu();deleteMapNote('${escJs(n.id)}')"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-trash"></use></svg> Delete</button>`
    + `</div>`;
}

/** Map-menu layers for the notes under a canvas point, topmost first. */
function noteLayersAt(px, py) {
  if (!isDM()) return [];
  const hitR = noteRadius(tableState.cellSize || 50) + 3;
  const out = [];
  for (let i = mapNotes.length - 1; i >= 0; i--) {
    const n = mapNotes[i], p = notePos(n);
    if (Math.hypot(px - p.x, py - p.y) <= hitR) out.push({ kind: 'note', body: () => _mctxNoteBody(n) });
  }
  return out;
}

// ── Editor ────────────────────────────────────────────────────────────────────
function _noteEditorEl() {
  let el = document.getElementById('map-note-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'map-note-modal';
  el.className = 'modal-overlay';
  el.style.display = 'none';
  el.innerHTML = `<div class="modal-box map-note-box" role="dialog" aria-modal="true" aria-labelledby="map-note-heading">`
    + `<div class="ct ct-row"><span id="map-note-heading">DM Note</span>`
    +   `<button type="button" class="btn sm" onclick="closeMapNoteEditor()" aria-label="Close"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button></div>`
    + `<div class="map-note-body">`
    +   `<div class="map-note-private"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-lock"></use></svg> Only you see notes. Players never receive them.</div>`
    +   `<label class="lbl" for="map-note-title">Title</label>`
    +   `<input type="text" id="map-note-title" maxlength="80" placeholder="e.g. Pit trap" autocomplete="off">`
    +   `<label class="lbl" for="map-note-text">Note</label>`
    +   `<textarea id="map-note-text" rows="7" maxlength="4000" placeholder="What you want to remember here…"></textarea>`
    + `</div>`
    + `<div class="map-note-foot">`
    +   `<button type="button" class="btn danger" id="map-note-del" onclick="deleteMapNote(_noteEditing)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-trash"></use></svg> Delete</button>`
    +   `<span style="flex:1"></span>`
    +   `<button type="button" class="btn" onclick="closeMapNoteEditor()">Cancel</button>`
    +   `<button type="button" class="btn primary" id="map-note-save" onclick="saveMapNote()"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-save"></use></svg> Save</button>`
    + `</div></div>`;
  el.addEventListener('mousedown', e => { if (e.target === el) closeMapNoteEditor(); });
  // Capture phase, so Escape closes the editor and not the tool behind it, and
  // Ctrl/Cmd+Enter saves from either field.
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMapNoteEditor(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveMapNote(); }
    else if (e.key === 'Enter' && e.target.id === 'map-note-title') { e.preventDefault(); document.getElementById('map-note-text').focus(); }
  }, true);
  document.body.appendChild(el);
  return el;
}

/** Open the editor for an existing note (id) or a new one at cell `at`. */
function openMapNoteEditor(id, at) {
  if (!isDM()) return;
  const n = id ? mapNotes.find(m => m.id === id) : null;
  if (id && !n) return;
  const el = _noteEditorEl();
  _noteEditing = n ? n.id : null;
  _noteNewAt = n ? null : (at || { x: 0, y: 0 });
  document.getElementById('map-note-heading').textContent = n ? 'Edit DM Note' : 'New DM Note';
  document.getElementById('map-note-title').value = n ? (n.title || '') : '';
  document.getElementById('map-note-text').value = n ? (n.text || '') : '';
  document.getElementById('map-note-del').style.display = n ? '' : 'none';
  el.style.display = 'flex';
  setTimeout(() => document.getElementById(n && n.title ? 'map-note-text' : 'map-note-title')?.focus(), 0);
}

function closeMapNoteEditor() {
  const el = document.getElementById('map-note-modal');
  if (el) el.style.display = 'none';
  _noteEditing = null;
  _noteNewAt = null;
}

async function saveMapNote() {
  const title = document.getElementById('map-note-title').value.trim();
  const text = document.getElementById('map-note-text').value;
  if (!title && !text.trim()) { showToast('Write a title or a note first.', true); return; }
  const btn = document.getElementById('map-note-save');
  btn.disabled = true;
  try {
    const ok = _noteEditing
      ? await _noteRequest('PUT', '/api/table/notes/' + encodeURIComponent(_noteEditing), { title, text })
      : await _noteRequest('POST', '/api/table/notes', { x: _noteNewAt.x, y: _noteNewAt.y, title, text });
    if (ok) closeMapNoteEditor();
  } finally { btn.disabled = false; }
}

async function deleteMapNote(id) {
  const n = mapNotes.find(m => m.id === id);
  if (!n) return;
  const ok = typeof confirmDialog === 'function'
    ? await confirmDialog({ title: 'Delete note?', message: `"${n.title || 'Note'}" will be removed from the map.`, confirmText: 'Delete', danger: true })
    : confirm(`Delete "${n.title || 'Note'}"?`);
  if (!ok) return;
  if (await _noteRequest('DELETE', '/api/table/notes/' + encodeURIComponent(id))) {
    applyMapNotes(mapNotes.filter(m => m.id !== id));
    if (_noteEditing === id) closeMapNoteEditor();
  }
}

/** One notes request as the DM. The page is updated by the 'notes-updated' broadcast. */
async function _noteRequest(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      showToast((await res.json().catch(() => ({}))).error || 'Could not save the note.', true);
      return false;
    }
    // Apply our own change at once rather than waiting for the broadcast.
    const data = await res.json().catch(() => ({}));
    if (method === 'POST' && data.note) applyMapNotes([...mapNotes.filter(m => m.id !== data.note.id), data.note]);
    else if (method === 'PUT' && data.note) applyMapNotes(mapNotes.map(m => m.id === data.note.id ? data.note : m));
    return true;
  } catch {
    showToast('Connection error.', true);
    return false;
  }
}
