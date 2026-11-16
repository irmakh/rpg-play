// Written by Irmak Hakman — 2026-11-16 17:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── DM navigation bar (v360) ─────────────────────────────────────────────────
// The DM works across a dozen pages, and most of them had no way back but the
// browser's Back button. Every DM page now carries the same bar, right under
// its header, with the current page marked and a Search (Ctrl+K) button
// (js/lib/palette.js). On a phone the bar scrolls sideways.
//
// It goes inside the page's own column (after its .hdr), so the full-height
// pages (Monsters, Treasury, Prepare map, Music) simply give it one row.
// Shown only to a DM session; a page opts in by loading this script.

const DM_NAV_PAGES = [
  ['/dm.html', 'DM'],
  ['/table.html', 'Table'],
  ['/index.html', 'Sheets'],
  ['/monsters.html', 'Monsters'],
  ['/spells.html', 'Spells'],
  ['/treasury.html', 'Treasury'],
  ['/handouts.html', 'Handouts'],
  ['/events.html', 'Calendar'],
  ['/prepare-map.html', 'Prepare map'],
  ['/playlists.html', 'Music'],
  ['/stories.html', 'Stories'],
  ['/waiting-screens.html', 'Waiting screens'],
];

function _dmNavIsDm() {
  try { return (JSON.parse(sessionStorage.getItem('rpgSession') || 'null') || {}).role === 'dm'; } catch { return false; }
}

function renderDmNav() {
  if (document.getElementById('dm-nav') || !_dmNavIsDm()) return;
  const here = location.pathname === '/' ? '/index.html' : location.pathname;
  const nav = document.createElement('nav');
  nav.id = 'dm-nav';
  nav.className = 'dm-nav';
  nav.setAttribute('aria-label', 'DM pages');
  nav.innerHTML = DM_NAV_PAGES.map(([href, label]) =>
    `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('')
    + `<button type="button" class="dm-nav-search" onclick="typeof openPalette==='function'&&openPalette()" title="Search everything (Ctrl+K)">`
    + `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-search"></use></svg> Search <kbd>Ctrl K</kbd></button>`;
  const hdr = document.querySelector('.app-shell > .hdr, #main-content > .hdr, #shell > .hdr, .hdr');
  if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(nav, hdr.nextSibling);
  else document.body.insertBefore(nav, document.body.firstChild);
  _dmNavStyle();
  nav.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
}

function _dmNavStyle() {
  if (document.getElementById('dm-nav-style')) return;
  const st = document.createElement('style');
  st.id = 'dm-nav-style';
  st.textContent = [
    '.dm-nav{display:flex;align-items:center;gap:2px;flex-shrink:0;overflow-x:auto;scrollbar-width:none;',
    '  padding:4px var(--s3, 12px);background:var(--slate);border-bottom:1px solid var(--rule-hi);font-size:calc(12px*var(--fs,1))}',
    '.dm-nav::-webkit-scrollbar{display:none}',
    '.dm-nav a{white-space:nowrap;padding:6px 10px;border-radius:6px;color:var(--ash);text-decoration:none;font-weight:600;min-height:32px;display:inline-flex;align-items:center}',
    '.dm-nav a:hover{background:var(--slate-hi);color:var(--bone)}',
    '.dm-nav a[aria-current="page"]{background:var(--slate-hi);color:var(--arc)}',
    '.dm-nav a:focus-visible,.dm-nav-search:focus-visible{outline:2px solid var(--arc);outline-offset:-2px}',
    '.dm-nav-search{margin-left:auto;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;',
    '  background:var(--ink);border:1px solid var(--rule-hi);border-radius:6px;color:var(--ash);font:inherit;cursor:pointer}',
    '.dm-nav-search kbd{font-size:.85em;border:1px solid var(--rule-hi);border-radius:3px;padding:0 4px}',
    '@media (max-width:760px){.dm-nav a,.dm-nav-search{min-height:40px}.dm-nav-search kbd{display:none}}',
  ].join('\n');
  document.head.appendChild(st);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', renderDmNav);
}
