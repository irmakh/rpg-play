// Written by Irmak Hakman — 2026-11-12 16:56
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Map Prep: zoom, pan and the minimap ───────────────────────────────────────
// On every screen size:
//   - + / − / Fit zoom the map (up to 6× the fitted size); the mouse wheel
//     zooms at the pointer (Shift + wheel still scrolls sideways);
//   - zoomed in, the map scrolls; with no tool on, dragging an empty spot with
//     the mouse pans it (a finger drag scrolls natively);
//   - the minimap in the bottom-left corner shows the whole map and the part
//     on screen; click or drag on it to move there (js/lib/minimap.js).

const PM_ZOOM_MAX = 6;
let _pmPan = null;   // { x, y, left, top } while a mouse drag pans the map

/**
 * Set the zoom. The point under (clientX, clientY) stays put — the middle of
 * the view when no point is given.
 */
function pmSetZoom(z, clientX, clientY) {
  const area = canvasArea;
  const next = Math.max(1, Math.min(PM_ZOOM_MAX, z || 1));
  if (!currentMapId || !area) { pmZoom = next; return; }
  if (Math.abs(next - pmZoom) < 0.001) return;
  const ar = area.getBoundingClientRect();
  const ax = clientX ?? (ar.left + area.clientLeft + area.clientWidth / 2);
  const ay = clientY ?? (ar.top + area.clientTop + area.clientHeight / 2);
  const before = editorWrap.getBoundingClientRect();
  const fx = (ax - before.left) / (before.width || 1);
  const fy = (ay - before.top) / (before.height || 1);
  pmZoom = next;
  refreshCanvases();
  const after = editorWrap.getBoundingClientRect();
  area.scrollLeft += (after.left + fx * after.width) - ax;
  area.scrollTop  += (after.top + fy * after.height) - ay;
  _pmZoomButtons();
  if (typeof pmMinimap !== 'undefined' && pmMinimap) pmMinimap.update();
}

function _pmZoomButtons() {
  const fit = document.getElementById('pm-zoom-fit');
  if (fit) fit.disabled = pmZoom <= 1;
  const zin = document.getElementById('pm-zoom-in');
  if (zin) zin.disabled = pmZoom >= PM_ZOOM_MAX;
}

/** True when the map is bigger than its area, so there is somewhere to pan to. */
function pmCanPan() {
  return canvasArea.scrollWidth > canvasArea.clientWidth + 1 || canvasArea.scrollHeight > canvasArea.clientHeight + 1;
}

/** Start a mouse-drag pan (prepare-map.js calls this when no tool is on). */
function pmStartPan(e) {
  if (!pmCanPan()) return false;
  _pmPan = { x: e.clientX, y: e.clientY, left: canvasArea.scrollLeft, top: canvasArea.scrollTop };
  drawCvs.style.cursor = 'grabbing';
  return true;
}
window.addEventListener('pointermove', e => {
  if (!_pmPan) return;
  canvasArea.scrollLeft = _pmPan.left - (e.clientX - _pmPan.x);
  canvasArea.scrollTop  = _pmPan.top  - (e.clientY - _pmPan.y);
});
window.addEventListener('pointerup', () => {
  if (!_pmPan) return;
  _pmPan = null;
  drawCvs.style.cursor = pmCanPan() ? 'grab' : 'default';
});

canvasArea.addEventListener('wheel', e => {
  if (!currentMapId || e.shiftKey) return;
  e.preventDefault();
  // A trackpad sends many small steps, a mouse wheel a few big ones.
  const step = Math.min(0.5, Math.abs(e.deltaY) / 400) || 0.1;
  pmSetZoom(pmZoom * (e.deltaY < 0 ? 1 + step : 1 / (1 + step)), e.clientX, e.clientY);
}, { passive: false });

// ── Minimap ──
let pmMinimap = null;
(function () {
  const host = document.getElementById('pm-minimap');
  if (!host || typeof createMiniMap !== 'function') return;
  const phone = () => window.matchMedia('(max-width:860px)').matches;
  pmMinimap = createMiniMap({
    host, scroller: canvasArea, content: editorWrap,
    size: () => ({ w: fogCvs.width, h: fogCvs.height }),
    draw(ctx, s) {
      const W = fogCvs.width * s, H = fogCvs.height * s;
      if (prepImg.style.display !== 'none' && prepImg.complete && prepImg.naturalWidth) ctx.drawImage(prepImg, 0, 0, W, H);
      ctx.drawImage(fogCvs, 0, 0, W, H);   // fog, items, tokens and notes are all on this canvas
    },
    isEmpty: () => !currentMapId,
    storageKey: 'prepMinimapFolded',
    maxW: () => (phone() ? 120 : 200),
    maxH: () => (phone() ? 90 : 150),
  });
  // Redraw the picture whenever the editor does.
  for (const name of ['renderPrepFog', 'refreshCanvases']) {
    const fn = window[name];
    if (typeof fn !== 'function') continue;
    window[name] = function () { const r = fn.apply(this, arguments); pmMinimap.invalidate(); return r; };
  }
  prepImg.addEventListener('load', () => pmMinimap.invalidate());
  // A map always opens fitted to the screen.
  const _select = window.selectMap;
  window.selectMap = function (id) { pmZoom = 1; _select(id); _pmZoomButtons(); pmMinimap.invalidate(); };
})();

document.addEventListener('DOMContentLoaded', _pmZoomButtons);
