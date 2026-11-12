// Written by Irmak Hakman — 2026-11-12 16:56
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Table minimap ─────────────────────────────────────────────────────────────
// The whole map in the bottom-left corner of the map area, for the DM and the
// players alike. Click or drag on it to move the view there (js/lib/minimap.js).
//
// It is painted from this viewer's own layers: the map picture, the fog as
// this page drew it (solid for a player), the revealed items, the drawings, and
// the tokens this page shows. A player's minimap therefore holds nothing their
// map does not. The DM's also shows hidden tokens (faded) and their notes.

(function () {
  const host = document.getElementById('minimap');
  const area = document.getElementById('canvas-area');
  const wrap = document.getElementById('table-wrap');
  if (!host || !area || !wrap || typeof createMiniMap !== 'function') return;

  const GAP = 12;
  const small = () => window.matchMedia('(max-width:700px)').matches;

  function draw(ctx, s) {
    const W = overlayCanvas.width * s, H = overlayCanvas.height * s;
    if (mapImg && mapImg.style.display !== 'none' && mapImg.complete && mapImg.naturalWidth) {
      ctx.drawImage(mapImg, 0, 0, W, H);
    }
    for (const c of [fogCanvas, itemsCanvas, drawingCanvas]) {
      if (c && c.width) ctx.drawImage(c, 0, 0, W, H);
    }
    // Tokens as dots in their colours; the DM's hidden ones faded.
    const cs = tableState.cellSize || 50;
    const ox = tableState.offsetX || 0, oy = tableState.offsetY || 0;
    for (const tok of tokens) {
      if (!tok.visible && !isMyToken(tok)) continue;
      const size = tok.tokenSize || 1;
      const x = (ox + ((tok.x || 0) + size / 2) * cs) * s;
      const y = (oy + ((tok.y || 0) + size / 2) * cs) * s;
      const r = Math.max(2.5, size * cs * 0.38 * s);
      ctx.globalAlpha = tok.visible ? 1 : 0.45;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = tok.color || '#888';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const mm = createMiniMap({
    host, scroller: area, content: overlayCanvas,
    size: () => ({ w: overlayCanvas.width, h: overlayCanvas.height }),
    draw,
    isEmpty: () => !tableState.hasMap && !tokens.length,
    storageKey: 'tableMinimapFolded',
    maxW: () => (small() ? 130 : 200),
    maxH: () => (small() ? 100 : 150),
  });

  // Redraw the picture whenever the map does. Each of these is a page-wide
  // function, so replacing it here also catches the calls made inside other
  // scripts.
  for (const name of ['renderGrid', 'renderFog', 'renderItems', 'renderTokens', 'renderDrawings', 'resizeCanvases']) {
    const fn = window[name];
    if (typeof fn !== 'function') continue;
    window[name] = function () { const r = fn.apply(this, arguments); mm.invalidate(); return r; };
  }
  if (mapImg) mapImg.addEventListener('load', () => mm.invalidate());

  // Pinned to the map area's bottom-left corner from outside the scrolling
  // element, like the zoom control (table-main.js), so panels opening or the
  // chat growing never push it about.
  function place() {
    const w = wrap.getBoundingClientRect(), a = area.getBoundingClientRect();
    host.style.left = Math.max(GAP, a.left + area.clientLeft - w.left + GAP) + 'px';
    host.style.bottom = Math.max(GAP, w.bottom - (a.top + area.clientTop + area.clientHeight) + GAP) + 'px';
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(place);
    ro.observe(area); ro.observe(wrap);
  }
  window.addEventListener('resize', place);
  place();
})();
