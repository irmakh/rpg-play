// Written by Irmak Hakman — 2026-10-15 15:13
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Display templates — the default look plus twenty large-text colour templates
 * (css/templates.css, built by scripts/build_templates.py).
 *
 * Loaded as a plain, blocking script in <head>, straight after the stylesheets,
 * so the chosen template is on <html> before the first paint and the page never
 * flashes the default colours first. The choice lives in sessionStorage, next to
 * the login session: it lasts while the tab is open, and a window this tab opens
 * (a sheet pop-out) starts with a copy of it.
 *
 * Once the page is parsed, a small button goes into the page's own header; it
 * opens a pop-up list of the templates. A page that should not show one (a small pop-out player) sets data-no-template-select
 * on <html>. The console has its own design system and does not load this file.
 */
(function () {
  const KEY = 'rpgTemplate';
  // Ids must match scripts/build_templates.py, which checks this list.
  const TEMPLATES = [
    ['', 'Default'],
    ['metallic', 'Metallic Chic'],
    ['vintage', 'Deep Vintage Mood'],
    ['cool', 'Cool and Collected'],
    ['earthy', 'Earthy and Serene'],
    ['texture', 'Texture and Contrast'],
    ['mechanical', 'Mechanical and Floaty'],
    ['pixel', 'Pixel Intensity'],
    ['gradient', 'Gradient Pop'],
    ['cosmic', 'Cosmic Artistry'],
    ['vibrant', 'Vibrant but Calm'],
    ['lively', 'Lively and Inviting'],
    ['striking', 'Striking and Simple'],
    ['redlively', 'Red and Lively'],
    ['artsy', 'Artsy and Creative'],
    ['elegant', 'Elegant Yet Approachable'],
    ['sleek', 'Sleek and Futuristic'],
    ['audacious', 'Innovative and Audacious'],
    ['texturized', 'Texturized and Dynamic'],
    ['minimal', 'Minimal Yet Warm'],
    ['vivid', 'Vivid and Sharp'],
  ];
  const known = new Set(TEMPLATES.map(t => t[0]));

  // UI size (text, spacing and sizes), chosen separately and kept the same way. It sets --fs inline on
  // <html>, which beats the template's own --fs; with none chosen, each
  // template keeps its own (1 for the default, 1.2 for the others).
  const SIZE_KEY = 'rpgTextSize';
  const SIZES = [0.5, 0.75, 1, 1.1, 1.2, 1.35];
  const TEMPLATE_FS = 1.2;   // must match FS in scripts/build_templates.py

  function read() {
    try { const v = sessionStorage.getItem(KEY) || ''; return known.has(v) ? v : ''; } catch { return ''; }
  }
  function readSize() {
    try { const v = Number(sessionStorage.getItem(SIZE_KEY)); return SIZES.includes(v) ? v : 0; } catch { return 0; }
  }
  /** The size in effect: the chosen one, or the template's own. */
  function currentSize() { return readSize() || (read() ? TEMPLATE_FS : 1); }

  function apply() {
    const root = document.documentElement, id = read(), size = readSize();
    if (id) root.dataset.template = id; else delete root.dataset.template;
    if (size) root.style.setProperty('--fs', String(size)); else root.style.removeProperty('--fs');
    // Marks a page whose text is larger than the default, for layout rules
    // that only matter then (the character sheet's top bar, index.css).
    if (currentSize() > 1) root.dataset.textSize = String(currentSize()); else delete root.dataset.textSize;
    for (const b of document.querySelectorAll('.tpl-item')) b.setAttribute('aria-checked', String(b.dataset.id === id));
    const cur = currentSize();
    for (const b of document.querySelectorAll('.tpl-size')) b.setAttribute('aria-checked', String(Number(b.dataset.size) === cur));
  }

  function store(key, val) {
    try { if (val) sessionStorage.setItem(key, String(val)); else sessionStorage.removeItem(key); } catch {}
    apply();
  }
  const choose = id => store(KEY, id);
  const chooseSize = n => store(SIZE_KEY, n);

  apply();

  // A same-origin frame on this page (the music player) shares this
  // sessionStorage, so it follows a change made in the page around it.
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === SIZE_KEY || e.key === null) apply(); });

  // Where the button goes, first match wins. Each page's header is
  // different; anything without one gets a small button in the corner.
  const SLOTS = ['.hdr-right', '.hdr', '.char-bar', '#toolbar', '.top', '#hdr', '.stories-hdr', '.login-box'];
  const ICON = '<svg class="lt-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.8-.3-.9.3-2.2 1.6-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/>' +
    '<circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>';

  let pop = null, btn = null;

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    btn?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onOutside(e) { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') { close(); btn.focus(); } }

  // Below the button, kept inside the window.
  function place() {
    if (!pop || !btn) return;
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function open() {
    pop = document.createElement('div');
    pop.className = 'tpl-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'Display template');
    const cur = read();
    for (const [id, label] of TEMPLATES) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'tpl-item';
      it.dataset.id = id;
      it.setAttribute('role', 'menuitemradio');
      it.setAttribute('aria-checked', String(id === cur));
      // The swatch carries the template's own attribute, so its colours come
      // straight from templates.css; the default's are the tokens.css ones.
      it.innerHTML = '<span class="tpl-sw"' + (id ? ' data-template="' + id + '"' : ' data-tpl-default') +
        '><i></i><i></i><i></i></span><span class="tpl-name"></span>';
      it.querySelector('.tpl-name').textContent = label;
      it.addEventListener('click', () => { choose(id); close(); btn.focus(); });
      pop.append(it);
    }

    // UI size: like a template, choosing one closes the pop-up.
    const row = document.createElement('div');
    row.className = 'tpl-sizes';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'UI size');
    row.innerHTML = '<span class="tpl-sizes-lbl">UI size</span>';
    const now = currentSize();
    for (const n of SIZES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl-size';
      b.dataset.size = String(n);
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(n === now));
      b.textContent = Math.round(n * 100) + '%';
      b.addEventListener('click', () => { chooseSize(n); close(); btn.focus(); });
      row.append(b);
    }
    pop.append(row);
    document.body.append(pop);
    place();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    (pop.querySelector('[aria-checked="true"]') || pop.firstChild).focus();
  }

  function mount() {
    const root = document.documentElement;
    if (root.hasAttribute('data-no-template-select') || window.top !== window) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tpl-btn';
    btn.title = 'Display template';
    btn.setAttribute('aria-label', 'Display template');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = ICON;
    btn.addEventListener('click', () => (pop ? close() : open()));
    window.addEventListener('resize', close);

    const slot = SLOTS.map(q => document.querySelector(q)).find(Boolean);
    if (slot) slot.append(btn);
    else { btn.classList.add('tpl-btn-float'); document.body.append(btn); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
