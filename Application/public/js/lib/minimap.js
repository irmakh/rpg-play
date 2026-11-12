// Written by Irmak Hakman — 2026-11-12 16:56
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Minimap ───────────────────────────────────────────────────────────────────
// A small picture of the whole map with a frame for the part on screen. Click
// or drag on it and the map scrolls there. Used by the table (table-minimap.js)
// and Map Prep (prepare-map-view.js).
//
// It draws only what the page already drew for this viewer — their own map,
// fog and token layers — so a player's minimap shows no more than their map.
//
//   const mm = createMiniMap({
//     host,          element the minimap is built in (positioned by the page)
//     scroller,      the scrolling element that holds the map
//     content,       the element the map is drawn in; its on-screen box is the
//                    map at the current zoom
//     size(),        the map's size in content pixels: { w, h }
//     draw(ctx, s),  paints the map into ctx at scale s (content px → minimap px)
//     isEmpty(),     true when there is no map to show
//     storageKey,    remembers whether it is folded away (per browser)
//     maxW, maxH,    largest size in CSS pixels
//   });
//   mm.invalidate();   // the map changed: redraw the picture
//   mm.update();       // only the view moved: redraw the frame

function createMiniMap(o) {
  const host = o.host, scroller = o.scroller, content = o.content;
  const maxW = () => (typeof o.maxW === 'function' ? o.maxW() : o.maxW) || 200;
  const maxH = () => (typeof o.maxH === 'function' ? o.maxH() : o.maxH) || 150;
  const BASE_MS = 120;   // the picture redraws at most this often while things move

  host.classList.add('mm');
  host.innerHTML =
      `<div class="mm-box">`
    +   `<canvas class="mm-base" aria-hidden="true"></canvas>`
    +   `<canvas class="mm-view" role="img" aria-label="Minimap: click or drag to move the map there"></canvas>`
    +   `<button type="button" class="mm-fold" title="Hide the minimap" aria-label="Hide the minimap">`
    +     `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-minus"></use></svg></button>`
    + `</div>`
    + `<button type="button" class="mm-open" title="Show the minimap" aria-label="Show the minimap">`
    +   `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-map"></use></svg></button>`;
  const base = host.querySelector('.mm-base'), view = host.querySelector('.mm-view');
  const bCtx = base.getContext('2d'), vCtx = view.getContext('2d');

  let scale = 1, mmW = 0, mmH = 0;
  let folded = false;
  try { folded = localStorage.getItem(o.storageKey) === '1'; } catch {}
  let baseTimer = null, lastBase = 0, viewQueued = false;

  function setFolded(f) {
    folded = f;
    host.classList.toggle('mm-folded', f);
    try { localStorage.setItem(o.storageKey, f ? '1' : '0'); } catch {}
    if (!f) invalidate();
  }
  host.querySelector('.mm-fold').addEventListener('click', e => { e.stopPropagation(); setFolded(true); });
  host.querySelector('.mm-open').addEventListener('click', () => setFolded(false));
  host.classList.toggle('mm-folded', folded);

  function visible() { return !folded && !host.hidden && host.offsetParent !== null; }

  function drawBase() {
    baseTimer = null;
    lastBase = Date.now();
    const empty = o.isEmpty && o.isEmpty();
    host.hidden = !!empty;
    if (empty || folded) return;
    const { w, h } = o.size();
    if (!(w > 0 && h > 0)) return;
    scale = Math.min(maxW() / w, maxH() / h);
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [base, view]) {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      }
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    mmW = W; mmH = H;
    bCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bCtx.clearRect(0, 0, W, H);
    bCtx.fillStyle = '#0b0f19';
    bCtx.fillRect(0, 0, W, H);
    try { o.draw(bCtx, scale); } catch (err) { console.error(err); }
    drawView();
  }

  /** The part of the map on screen, in content pixels. */
  function viewRect() {
    const { w } = o.size();
    const cr = content.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    const k = cr.width / (w || 1);   // screen px per content px (the zoom)
    if (!(k > 0)) return null;
    return {
      x: (sr.left + scroller.clientLeft - cr.left) / k,
      y: (sr.top + scroller.clientTop - cr.top) / k,
      w: scroller.clientWidth / k,
      h: scroller.clientHeight / k,
    };
  }

  function drawView() {
    viewQueued = false;
    if (!visible() || !mmW) return;
    const dpr = view.width / mmW;
    vCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vCtx.clearRect(0, 0, mmW, mmH);
    const r = viewRect();
    if (!r) return;
    const x = Math.max(0, r.x * scale), y = Math.max(0, r.y * scale);
    const x2 = Math.min(mmW, (r.x + r.w) * scale), y2 = Math.min(mmH, (r.y + r.h) * scale);
    if (x2 <= x || y2 <= y) return;
    // Dim what is off screen, outline what is on it.
    vCtx.fillStyle = 'rgba(0,0,0,0.35)';
    vCtx.fillRect(0, 0, mmW, mmH);
    vCtx.clearRect(x, y, x2 - x, y2 - y);
    vCtx.lineWidth = 2;
    vCtx.strokeStyle = 'rgba(255,214,120,0.95)';
    vCtx.strokeRect(x + 1, y + 1, Math.max(0, x2 - x - 2), Math.max(0, y2 - y - 2));
  }

  function update() {
    if (viewQueued) return;
    viewQueued = true;
    requestAnimationFrame(drawView);
  }

  function invalidate() {
    if (baseTimer) return;
    const wait = Math.max(0, BASE_MS - (Date.now() - lastBase));
    baseTimer = setTimeout(() => requestAnimationFrame(drawBase), wait);
  }

  /** Scroll the map so the minimap point (mx, my) is in the middle of the view. */
  function goTo(mx, my) {
    const { w } = o.size();
    const cr = content.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    const k = cr.width / (w || 1);
    const cx = (mx / scale) * k + cr.left, cy = (my / scale) * k + cr.top;
    scroller.scrollLeft += cx - (sr.left + scroller.clientLeft + scroller.clientWidth / 2);
    scroller.scrollTop  += cy - (sr.top + scroller.clientTop + scroller.clientHeight / 2);
    update();
  }

  let dragging = false;
  const at = e => { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  view.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    view.setPointerCapture(e.pointerId);
    goTo(...at(e));
  });
  view.addEventListener('pointermove', e => { if (dragging) goTo(...at(e)); });
  const stop = () => { dragging = false; };
  view.addEventListener('pointerup', stop);
  view.addEventListener('pointercancel', stop);

  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', invalidate);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { invalidate(); update(); });
    ro.observe(scroller); ro.observe(content);
  }
  invalidate();
  return { invalidate, update, goTo, setFolded };
}
