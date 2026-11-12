// Written by Irmak Hakman — 2026-11-12 21:00
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Measured areas (draw tool → Area) ─────────────────────────────────────────
// A spell's or effect's area drawn to size: a square (side), a circle (radius),
// a cone (length) or a line (length × width), in feet. Choose it in the draw
// toolbar, click the map to place it, then move it by hand in Select; it snaps
// to the grid (Shift: freely), and a cone or a line turns by the handle at its
// tip. Everyone at the table sees it, like any drawing.
//
// An area is a drawing of type 'area' (map_drawings): x1,y1 is its anchor —
// the centre of a square or circle, the point a cone or line starts from —
// and kind, sizeFt, widthFt, angle (degrees, 0 = east) and label say the rest.
// Its pixels come from the grid (5 ft a cell), so it keeps its size in feet.

const AREA_KINDS = [['square', 'Square'], ['circle', 'Circle'], ['cone', 'Cone'], ['line', 'Line']];
const AREA_FT_PER_CELL = 5;
const AREA_ANGLE_STEP = 15;      // a cone or line turns in these steps; Shift turns it freely
const AREA_MAX_FT = 1000;

let areaMode = { kind: 'circle', sizeFt: 20, widthFt: 5, label: '' };

/**
 * A colour a canvas can paint: the draw tool's default is a CSS variable
 * ("var(--blood)"), which a canvas cannot read and drew black, so it is
 * looked up in the page's styles. The colour picker shows it too.
 */
function areaColor(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(c || '').trim());
  if (!m || typeof getComputedStyle !== 'function') return c || '#E4666B';
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#E4666B';
}
if (typeof document !== 'undefined' && typeof drawMode === 'object' && /^var\(/.test(String(drawMode.color))) {
  drawMode.color = areaColor(drawMode.color);
  const picker = document.getElementById('draw-color');
  if (picker) picker.value = drawMode.color;
}

function isArea(s) { return !!s && s.type === 'area'; }

/** Feet → map pixels at this grid. */
function areaPx(ft, cs) { return (Math.max(0, +ft || 0) / AREA_FT_PER_CELL) * (cs || 50); }

/**
 * The outline of an area as a polygon in map pixels (for everything but a
 * circle), or { circle: [cx, cy, r] }.
 */
function areaGeometry(s, cs) {
  const L = areaPx(s.sizeFt, cs);
  const x = +s.x1 || 0, y = +s.y1 || 0;
  const a = ((+s.angle || 0) * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);       // along the aim
  const vx = -uy, vy = ux;                          // across it
  if (s.kind === 'circle') return { circle: [x, y, L] };
  if (s.kind === 'square') {
    const h = L / 2;
    return { poly: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] };
  }
  if (s.kind === 'cone') {
    // As wide at its end as it is long (the rules' cone).
    const h = L / 2;
    return { poly: [[x, y], [x + ux * L + vx * h, y + uy * L + vy * h], [x + ux * L - vx * h, y + uy * L - vy * h]] };
  }
  // line: starts at the anchor, `widthFt` wide
  const w = areaPx(s.widthFt || AREA_FT_PER_CELL, cs) / 2;
  return { poly: [[x + vx * w, y + vy * w], [x + ux * L + vx * w, y + uy * L + vy * w],
                  [x + ux * L - vx * w, y + uy * L - vy * w], [x - vx * w, y - vy * w]] };
}

/** Where the turning handle of a cone or line sits: the middle of its far end. */
function areaTip(s, cs) {
  const L = areaPx(s.sizeFt, cs), a = ((+s.angle || 0) * Math.PI) / 180;
  return [(+s.x1 || 0) + Math.cos(a) * L, (+s.y1 || 0) + Math.sin(a) * L];
}
function areaTurns(s) { return s.kind === 'cone' || s.kind === 'line'; }

function _areaInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is the map point inside the area (with a little slack around its edge)? */
function areaHit(s, px, py, cs, slack = 6) {
  const g = areaGeometry(s, cs);
  if (g.circle) return Math.hypot(px - g.circle[0], py - g.circle[1]) <= g.circle[2] + slack;
  if (_areaInPoly(px, py, g.poly)) return true;
  for (let i = 0; i < g.poly.length; i++) {
    const [x1, y1] = g.poly[i], [x2, y2] = g.poly[(i + 1) % g.poly.length];
    if (_ptSegDist(px, py, x1, y1, x2, y2) <= slack) return true;
  }
  return false;
}

/**
 * The anchor snapped to the grid, as areas sit in play: a square's edges on
 * grid lines, a circle's centre on a grid corner, a cone's or line's start on
 * a corner, an edge's middle or a cell's centre.
 */
function areaSnap(s, x, y, cs, ox, oy) {
  cs = cs || 50; ox = ox || 0; oy = oy || 0;
  if (s.kind === 'square') {
    const h = areaPx(s.sizeFt, cs) / 2;
    return [Math.round((x - h - ox) / cs) * cs + ox + h, Math.round((y - h - oy) / cs) * cs + oy + h];
  }
  const step = s.kind === 'circle' ? cs : cs / 2;
  return [Math.round((x - ox) / step) * step + ox, Math.round((y - oy) / step) * step + oy];
}

/** The angle from the anchor to (x, y), in AREA_ANGLE_STEP steps unless free. */
function areaAngleTo(s, x, y, free) {
  let deg = (Math.atan2(y - (+s.y1 || 0), x - (+s.x1 || 0)) * 180) / Math.PI;
  if (!free) deg = Math.round(deg / AREA_ANGLE_STEP) * AREA_ANGLE_STEP;
  return ((deg % 360) + 360) % 360;
}

/** "Fireball · 20 ft radius". */
function areaText(s) {
  const n = Math.round((+s.sizeFt || 0) * 10) / 10;
  const size = s.kind === 'circle' ? `${n} ft radius` : s.kind === 'square' ? `${n} ft square`
    : s.kind === 'cone' ? `${n} ft cone` : `${n} × ${Math.round((+s.widthFt || AREA_FT_PER_CELL) * 10) / 10} ft line`;
  const name = String(s.label || '').trim();
  return name ? `${name} · ${size}` : size;
}

function renderAreaShape(ctx, s, alpha) {
  const cs = tableState.cellSize || 50;
  const g = areaGeometry(s, cs);
  const color = areaColor(s.color);
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = s.thickness || 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (g.circle) ctx.arc(g.circle[0], g.circle[1], g.circle[2], 0, Math.PI * 2);
  else { ctx.moveTo(g.poly[0][0], g.poly[0][1]); for (const p of g.poly.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); }
  ctx.globalAlpha = alpha * 0.2; ctx.fill();
  ctx.globalAlpha = alpha; ctx.stroke();
  // Where it starts from: the anchor of a cone or line.
  if (areaTurns(s)) {
    ctx.beginPath(); ctx.arc(+s.x1 || 0, +s.y1 || 0, Math.max(3, cs * 0.08), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // The size (and name) in its middle.
  const c = g.circle ? [g.circle[0], g.circle[1]]
    : g.poly.reduce((m, p) => [m[0] + p[0] / g.poly.length, m[1] + p[1] / g.poly.length], [0, 0]);
  // A quarter of a cell, and never under 12 screen pixels however far out.
  const scale = Math.max(0.1, (zoomPct > 0 ? zoomPct : 100) / 100);
  const px = Math.round(Math.min(40, Math.max(cs * 0.24, 12 / scale)));
  ctx.save();
  ctx.globalAlpha = alpha;
  if (typeof drawMapLabel === 'function') drawMapLabel(ctx, areaText(s), c[0], c[1], px, color, 'center');
  ctx.restore();
}

function renderAreaSelection(ctx, s) {
  const cs = tableState.cellSize || 50;
  const g = areaGeometry(s, cs);
  ctx.save();
  ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
  ctx.beginPath();
  if (g.circle) ctx.arc(g.circle[0], g.circle[1], g.circle[2] + 4, 0, Math.PI * 2);
  else { ctx.moveTo(g.poly[0][0], g.poly[0][1]); for (const p of g.poly.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); }
  ctx.stroke();
  ctx.setLineDash([]);
  if (areaTurns(s)) {
    const [hx, hy] = areaTip(s, cs);
    ctx.fillStyle = '#00e5ff'; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** The handle under the point: 'rot' for a cone's or line's tip. */
function areaHandleAt(s, px, py) {
  if (!areaTurns(s)) return null;
  const [hx, hy] = areaTip(s, tableState.cellSize || 50);
  return Math.hypot(px - hx, py - hy) <= 12 ? 'rot' : null;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function _areaNum(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.min(AREA_MAX_FT, n) : def;
}

/** The area being edited: the selected one in Select, else the next to place. */
function _areaTarget() {
  if (drawSubMode === 'select' && selectedShapeId) {
    const s = drawings.find(d => d.id === selectedShapeId);
    if (isArea(s)) return s;
  }
  return null;
}

/** A field of the Area row changed: the next area, or the selected one. */
function setAreaField(field, value) {
  const t = _areaTarget();
  const obj = t || areaMode;
  if (field === 'kind') obj.kind = AREA_KINDS.some(([k]) => k === value) ? value : 'circle';
  else if (field === 'sizeFt') obj.sizeFt = _areaNum(value, obj.sizeFt || 20);
  else if (field === 'widthFt') obj.widthFt = _areaNum(value, obj.widthFt || AREA_FT_PER_CELL);
  else if (field === 'label') obj.label = String(value || '').slice(0, 40);
  if (field === 'kind' || field === 'sizeFt') {
    // A square re-snaps to its new size so its edges stay on grid lines.
    if (t && t.kind === 'square') {
      [t.x1, t.y1] = areaSnap(t, t.x1, t.y1, tableState.cellSize || 50, tableState.offsetX, tableState.offsetY);
    }
  }
  syncAreaToolbar();
  if (t) { t.x2 = t.x1; t.y2 = t.y1; renderDrawings(); renderShapeSelection(); patchDrawing(t); }
}

/** Shows the Area fields (in Area mode, or with an area selected) and fills them in. */
function syncAreaToolbar() {
  const row = document.getElementById('draw-area-fields');
  if (!row) return;
  const t = _areaTarget();
  const show = drawSubMode === 'area' || !!t;
  row.style.display = show ? 'contents' : 'none';
  document.querySelectorAll('.draw-shape-only').forEach(el => { el.style.display = drawSubMode === 'draw' ? '' : 'none'; });
  if (!show) return;
  const src = t || areaMode;
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  set('area-kind', src.kind);
  set('area-size', String(src.sizeFt));
  set('area-width', String(src.widthFt || AREA_FT_PER_CELL));
  set('area-label', src.label || '');
  const w = document.getElementById('area-width-wrap');
  if (w) w.style.display = src.kind === 'line' ? '' : 'none';
  const lbl = document.getElementById('area-size-lbl');
  if (lbl) lbl.textContent = src.kind === 'circle' ? 'Radius' : src.kind === 'square' ? 'Side' : 'Length';
  const hint = document.getElementById('area-hint');
  if (hint) hint.textContent = t ? (areaTurns(t) ? 'Drag to move · tip turns it · Shift: free' : 'Drag to move · Shift: free')
                                 : 'Click the map to place it';
}

/** Area mode: a click on the map places the area there, then Select picks it up. */
function placeAreaAt(pos, free) {
  const s = {
    id: Math.random().toString(36).slice(2), type: 'area',
    kind: areaMode.kind, sizeFt: areaMode.sizeFt, widthFt: areaMode.widthFt, label: areaMode.label, angle: 0,
    color: drawMode.color, thickness: drawMode.thickness, x1: pos.x, y1: pos.y,
  };
  if (!free) [s.x1, s.y1] = areaSnap(s, pos.x, pos.y, tableState.cellSize || 50, tableState.offsetX, tableState.offsetY);
  s.x2 = s.x1; s.y2 = s.y1;
  saveDrawing(s);
  setDrawSubMode('select');
  selectedShapeId = s.id;
  updateDrawSelectionUI();
  renderShapeSelection();
}

/** Area mode: the outline follows the pointer before the click. */
function previewAreaAt(pos, free) {
  const s = { type: 'area', ...areaMode, angle: 0, color: drawMode.color, thickness: drawMode.thickness, x1: pos.x, y1: pos.y };
  if (!free) [s.x1, s.y1] = areaSnap(s, pos.x, pos.y, tableState.cellSize || 50, tableState.offsetX, tableState.offsetY);
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  renderAreaShape(oCtx, s, 0.6);
}

/** Select: dragging an area moves it (snapped unless free); its tip turns it. */
function dragArea(s, os, mode, pos, dx, dy, free) {
  if (mode === 'rot') {
    s.angle = areaAngleTo(os, pos.x, pos.y, free);
  } else {
    let x = os.x1 + dx, y = os.y1 + dy;
    if (!free) [x, y] = areaSnap(s, x, y, tableState.cellSize || 50, tableState.offsetX, tableState.offsetY);
    s.x1 = x; s.y1 = y;
  }
  s.x2 = s.x1; s.y2 = s.y1;
}
