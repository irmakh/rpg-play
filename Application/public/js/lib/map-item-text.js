// Written by Irmak Hakman — 2026-11-12 16:42
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Text drawn on map objects: hidden items and DM notes ─────────────────────
// Shared by the table (table-map.js, table-notes.js) and Prepare Map
// (prepare-map.js), so an item reads the same size on both.
//
// Sizes used to be capped at 9px (label) and 12px (icon) whatever the cell
// size, so on a big grid the text was a speck in the corner of the item, and
// zoomed out it was unreadable. Now both follow the cell, like token labels,
// with a floor in SCREEN pixels so zooming out never shrinks them past reading.

/**
 * Font sizes, in canvas pixels, for one map object.
 *   cellPx  one grid cell in canvas pixels
 *   w, h    the object's size in cells
 *   zoom    how much the canvas is scaled on screen (1 = 100%)
 */
function mapItemTextPx(cellPx, w, h, zoom) {
  const cs = cellPx > 0 ? cellPx : 50;
  const z = zoom > 0 ? zoom : 1;
  const cells = Math.max(1, Math.min(w || 1, h || 1));
  return {
    label: Math.round(Math.min(40, Math.max(cs * 0.22, 11 / z))),
    icon:  Math.round(Math.min(40, Math.max(cells * cs * 0.5, 14 / z))),
  };
}

/** Text cut to fit maxW at the context's current font, ending in "…" when cut. */
function fitMapText(ctx, text, maxW) {
  const s = String(text || '');
  if (!s || maxW <= 0 || ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo ? s.slice(0, lo) + '…' : '';
}

/** Outlined text that reads over any map. Leaves the context as it found it. */
function strokeMapText(ctx, text, x, y, px, colour, align, baseline) {
  ctx.save();
  ctx.font = `bold ${px}px Segoe UI, sans-serif`;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = baseline || 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, px * 0.22);
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * A hidden item's icon (centred) and, for the DM, its label.
 *
 * The label sits along the item's bottom edge when there is room for it under
 * the icon; on an item too short for both (a one-cell door, a zoomed-out map)
 * it goes just below the item instead, so the two never overlap. It may run
 * past a narrow item onto the neighbouring cells — about ten characters, or
 * three cells, whichever is wider — before it is cut short.
 */
function drawMapItemText(ctx, o) {
  const t = mapItemTextPx(o.cellPx, o.w, o.h, o.zoom);
  const pad = Math.max(2, t.label * 0.25);
  const below = !!o.label && o.ih < t.icon + t.label + pad * 3;
  strokeMapText(ctx, o.icon, o.x + o.iw / 2, o.y + o.ih / 2, t.icon, o.iconColour, 'center', 'middle');
  if (!o.label) return;
  ctx.save();
  ctx.font = `bold ${t.label}px Segoe UI, sans-serif`;
  const text = fitMapText(ctx, o.label, Math.max(o.iw - pad * 2, o.cellPx * 3, t.label * 6));
  ctx.restore();
  if (below) strokeMapText(ctx, text, o.x, o.y + o.ih + pad, t.label, o.labelColour, 'left', 'top');
  else       strokeMapText(ctx, text, o.x + pad, o.y + o.ih - pad, t.label, o.labelColour, 'left', 'alphabetic');
}
