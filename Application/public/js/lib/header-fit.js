// Written by Irmak Hakman — 2026-10-15 15:08
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Keeps page headers on ONE row, whatever the UI size (js/lib/template.js).
 *
 * On a phone-width screen (<= 760px) a header that does not fit gets a ☰ button,
 * and the buttons that no longer fit, taken from the right-hand end, are hidden
 * in place and offered in its menu instead. The menu entries click the real
 * buttons, so ids, handlers and page styles are untouched. Selects, sliders,
 * and anything that opens its own pop-up (View, the dice mode, alerts,
 * the template button) never move: a pop-up anchored to a hidden button would
 * open in the wrong place.
 *
 * The character sheet's bar uses the menu at every width, since it also holds
 * what used to be its "More" menu.
 *
 * The map toolbar and the character sheet's bar, which hold the most, may take
 * a SECOND row on a phone first; only what does not fit on two rows goes into
 * the menu.
 *
 * The map screen's toolbar also frees space in steps first, at every width
 * (icon-only buttons, then the weather text and badges),
 * and on a wider screen, instead of a menu, scales itself down to at most 60%.
 *
 * The console has its own headers and does not load this file.
 */
(function () {
  const MOBILE = window.matchMedia('(max-width: 760px)');

  // Never moved into the menu (see above).
  const PINNED = 'select, input, label, [aria-haspopup], [data-notif-bell], .ux-anchor, .tpl-btn, ' +
                 '.hf-burger, #btn-toolbar-hide';
  // Not header items at all: inside a menu or pop-up.
  const INSIDE_POPUP = '[role="menu"], .ux-pop, .hf-menu, .tpl-pop';

  const HEADERS = [
    // These two hold the most, so on a phone they may take a second row
    // before anything goes into the menu.
    { sel: '#toolbar', only: () => !!document.getElementById('toolbar-strip'),
      burgerBefore: '#btn-toolbar-hide', steps: ['tb-fit-1', 'tb-fit-2'], shrink: true,
      rows: 2, prepare: wrapToolbarLabels },
    // The sheet's bar holds the old More menu's items too, so it uses the menu
    // at every width, not only on a phone.
    { sel: '.char-bar', rows: 2, menuAlways: true },
    { sel: '.hdr', burgerIn: '.hdr-right' },
    { sel: '.stories-hdr', burgerIn: '.hdr-right' },
    { sel: 'body > .top' },          // not the maintenance page's card headings
    { sel: '#hdr' },
  ];

  // Map toolbar: wrap the word of icon+word buttons so step 1 can hide it.
  // The dice-mode button and View keep theirs: the words are the information.
  function wrapToolbarLabels() {
    const sel = '#toolbar > a.btn, #btn-dm-unlock, #btn-tool-move, #btn-undo-move, #btn-tool-multi, #btn-my-sheet';
    for (const b of document.querySelectorAll(sel)) {
      if (!b.querySelector('svg')) continue;
      for (const n of [...b.childNodes]) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const s = document.createElement('span');
          s.className = 'tb-lbl';
          s.textContent = n.textContent;
          n.replaceWith(s);
        }
      }
    }
  }

  const BURGER_ICON = '<svg class="lt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const visible = el => el.getClientRects().length > 0;
  // A header fits when neither it nor any group inside it spills over. Checking
  // the groups matters: a group allowed to shrink (min-width:0) lets its
  // buttons spill onto the next group's, while the header itself looks fine.
  const GROUPS = '.cb-group, .hdr-left, .hdr-right, .dm-controls';
  const spills = g => g.scrollWidth > g.clientWidth + 1;
  const fits = el => !spills(el) && ![...el.querySelectorAll(GROUPS)].some(g => visible(g) && g.clientWidth > 0 && spills(g));

  /** How many rows the header's controls sit on. */
  function rowCount(el) {
    const items = [...el.querySelectorAll('button, a, select, input, label, span[id]')]
      .filter(b => !b.closest(INSIDE_POPUP) && visible(b))
      .map(b => b.getBoundingClientRect()).filter(r => r.height > 0)
      .sort((a, b) => a.top - b.top);
    let rows = 0, lineTop = -Infinity;
    for (const r of items) {
      // A new row starts below the middle of the current one; items in one row
      // are centred, so their tops differ by a few pixels only.
      if (r.top > lineTop + r.height * 0.6) { rows++; lineTop = r.top; }
    }
    return rows;
  }

  function setup(cfg, el) {
    cfg.prepare?.();
    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'tpl-btn hf-burger';
    burger.hidden = true;
    burger.title = 'More buttons';
    burger.setAttribute('aria-label', 'More buttons');
    burger.setAttribute('aria-haspopup', 'menu');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = BURGER_ICON;
    const before = cfg.burgerBefore && el.querySelector(cfg.burgerBefore);
    const into = cfg.burgerIn && el.querySelector(cfg.burgerIn);
    if (before) before.before(burger); else (into || el).append(burger);
    const h = { cfg, el, burger, hidden: [] };
    burger.addEventListener('click', () => (menu && menu.h === h ? closeMenu() : openMenu(h)));
    return h;
  }

  /** The header's buttons that may go into the menu, in page order. */
  function candidates(h) {
    // .char-btn: the sheet's campaign badge is a span whose click handler is set
    // from script, so it has no onclick attribute to find it by.
    return [...h.el.querySelectorAll('button, a[href], [onclick], .char-btn')].filter(b =>
      !b.closest(PINNED) && !b.closest(INSIDE_POPUP) && !b.matches(PINNED) && visible(b));
  }

  let busy = false, queued = false;

  function fit(h) {
    const { cfg, el, burger } = h;
    // Start from the full header each time.
    if (menu?.h === h) closeMenu();
    for (const b of h.hidden) b.classList.remove('hf-hidden');
    h.hidden = [];
    burger.hidden = true;
    if (cfg.steps) el.classList.remove(...cfg.steps);
    el.classList.remove('hf-wrap');
    el.style.removeProperty('--fs');
    const mobile = MOBILE.matches;
    const useMenu = mobile || cfg.menuAlways;
    el.classList.toggle('hf-row', useMenu);
    if (!visible(el) || fits(el)) return;

    // On a phone, a two-row header first tries everything on two rows, then
    // its space-saving steps on two rows, and only then the menu.
    let ok = () => fits(el);
    if (mobile && cfg.rows === 2) {
      el.classList.remove('hf-row');
      el.classList.add('hf-wrap');
      ok = () => fits(el) && rowCount(el) <= 2;
      if (ok()) return;
    }

    for (const step of cfg.steps || []) {
      el.classList.add(step);
      if (ok()) return;
    }

    if (useMenu) {
      burger.hidden = false;
      const list = candidates(h);
      while (!ok() && list.length) {
        const b = list.pop();
        b.classList.add('hf-hidden');
        h.hidden.unshift(b);
      }
      if (!h.hidden.length) burger.hidden = true;
    } else if (cfg.shrink) {
      const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1;
      for (let k = 0.95; k >= 0.6 && !fits(el); k -= 0.05) el.style.setProperty('--fs', (base * k).toFixed(3));
    }
  }

  let headers = [];
  function fitAll() {
    queued = false;
    busy = true;
    for (const h of headers) fit(h);
    // Let the observers' records from these changes go by before listening again.
    requestAnimationFrame(() => { busy = false; });
  }
  function schedule() {
    if (busy || queued) return;
    queued = true;
    requestAnimationFrame(fitAll);
  }

  // ── The ☰ menu ──────────────────────────────────────────────────────────────
  let menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.box.remove();
    menu.h.burger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    menu = null;
  }
  function onOutside(e) { if (menu && !menu.box.contains(e.target) && !menu.h.burger.contains(e.target)) closeMenu(); }
  function onKey(e) { if (e.key === 'Escape') { const b = menu?.h.burger; closeMenu(); b?.focus(); } }

  function labelOf(b) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    return t || b.getAttribute('aria-label') || b.title || 'Button';
  }

  function openMenu(h) {
    closeMenu();
    const box = document.createElement('div');
    box.className = 'tpl-pop hf-menu';
    box.setAttribute('role', 'menu');
    box.setAttribute('aria-label', 'More buttons');
    for (const b of h.hidden) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'tpl-item';
      it.setAttribute('role', 'menuitem');
      if (b.disabled) it.disabled = true;
      if (b.classList.contains('active')) it.setAttribute('aria-current', 'true');
      const icon = b.querySelector('svg');
      if (icon) it.append(icon.cloneNode(true));
      const name = document.createElement('span');
      name.className = 'tpl-name';
      name.textContent = labelOf(b);
      it.append(name);
      it.addEventListener('click', () => { closeMenu(); b.click(); });
      box.append(it);
    }
    document.body.append(box);
    const r = h.burger.getBoundingClientRect(), w = box.offsetWidth, ht = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    box.style.top = (r.bottom + 6 + ht > window.innerHeight - 8 ? Math.max(8, r.top - ht - 6) : r.bottom + 6) + 'px';
    menu = { box, h };
    h.burger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    box.querySelector('button:not(:disabled)')?.focus();
  }

  // ── Start ───────────────────────────────────────────────────────────────────
  function start() {
    for (const cfg of HEADERS) {
      if (cfg.only && !cfg.only()) continue;
      for (const el of document.querySelectorAll(cfg.sel)) {
        if (el.closest(INSIDE_POPUP) || headers.some(h => h.el.contains(el) || el.contains(h.el))) continue;
        headers.push(setup(cfg, el));
      }
    }
    if (!headers.length) return;

    window.addEventListener('resize', schedule);
    MOBILE.addEventListener?.('change', schedule);
    // UI size and template live on <html>; the map toolbar's hiding on <body>.
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-template'] });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // A header's own contents appearing, vanishing or changing text.
    const mo = new MutationObserver(schedule);
    for (const h of headers) mo.observe(h.el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden'] });
    document.fonts?.ready.then(schedule);
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
