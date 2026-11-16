// Written by Irmak Hakman — 2026-11-16 18:00
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Command palette: Ctrl+K (v360) ───────────────────────────────────────────
// One search box for everything: type a few letters, arrow to a result, Enter.
//
//   DM       pages, actions (start combat, next turn, end combat), monsters,
//            spells, treasury items, handouts, characters
//   Player   pages, their own sheet's tabs, spells and items, their handouts
//
// Results only ever come from what the viewer can already reach: every list
// is fetched with the viewer's own credential, and the server answers each
// one as it always does.
//
// A result on another page opens it filtered: "/monsters.html?q=Goblin"
// fills that page's search box on load (palAutoQuery below). On the sheet,
// "/index.html?tab=spells" opens a tab and "?char=<id>" (DM) a character.

const PAL_CACHE_MS = 60000;
const PAL_MAX = 12;
let _pal = { el: null, items: [], loadedAt: 0, shown: [], sel: 0, loading: null };

function _palSession() {
  try { return JSON.parse(sessionStorage.getItem('rpgSession') || 'null') || {}; } catch { return {}; }
}
function _palRole() {
  const s = _palSession();
  return s.role === 'dm' ? 'dm' : s.role === 'character' && s.characterId ? 'player' : null;
}
function _palHeaders() {
  if (typeof notifHeaders === 'function') return notifHeaders();
  const s = _palSession();
  if (s.role === 'dm') return { 'X-Master-Password': s.masterPw || '' };
  const h = {};
  if (s.characterId) h['X-Character-Id'] = s.characterId;
  if (s.charPw) h['X-Character-Password'] = s.charPw;
  return h;
}
const _palPage = () => (location.pathname === '/' ? '/index.html' : location.pathname);
const _palGo = (href) => { location.href = href; };
const _palEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _palQ = (page, q) => `${page}?q=${encodeURIComponent(q)}`;

async function _palJson(url) {
  try {
    const r = await fetch(url, { headers: _palHeaders() });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function _palPost(url, done) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ..._palHeaders() } });
    const b = await r.json().catch(() => ({}));
    if (typeof notifToast === 'function') notifToast(r.ok ? { kind: 'info', title: done, ms: 4000 } : { kind: 'error', title: b.error || 'That did not go through' });
  } catch {}
}

// ── What can be found ────────────────────────────────────────────────────────
async function _palBuild() {
  const role = _palRole();
  const items = [];
  const add = (label, kind, run, extra = '') => items.push({ label: String(label || ''), kind, run, extra });
  const onSheet = _palPage() === '/index.html';

  if (role === 'dm') {
    const pages = typeof DM_NAV_PAGES !== 'undefined' ? DM_NAV_PAGES : [['/dm.html', 'DM'], ['/table.html', 'Table'], ['/index.html', 'Sheets']];
    for (const [href, label] of pages) add(label, 'Page', () => _palGo(href));
    add('Start combat', 'Action', () => _palPost('/api/initiative/start', 'Combat started'));
    add('Next turn', 'Action', () => _palPost('/api/initiative/next', 'Next turn'));
    add('End combat', 'Action', () => _palPost('/api/initiative/end', 'Combat ended'));
    const [mons, spells, treasure, handouts, chars] = await Promise.all([
      _palJson('/api/monsters'), _palJson('/api/spells'), _palJson('/api/treasury/all'),
      _palJson('/api/handouts'), _palJson('/api/characters'),
    ]);
    for (const m of mons || []) add(m.name, 'Monster', () => _palGo(_palQ('/monsters.html', m.name)), m.cr != null ? `CR ${m.cr}` : '');
    const seenSpell = new Set();
    for (const s of spells || []) {
      if (!s || !s.name || seenSpell.has(s.name)) continue;
      seenSpell.add(s.name);
      add(s.name, 'Spell', () => _palGo(_palQ('/spells.html', s.name)), s.level ? `Level ${s.level}` : 'Cantrip');
    }
    for (const t of (Array.isArray(treasure) ? treasure : (treasure && treasure.items) || [])) add(t.name, 'Item', () => _palGo(_palQ('/treasury.html', t.name)));
    for (const h of handouts || []) add(h.title, 'Handout', () => _palGo(_palQ('/handouts.html', h.title)));
    for (const c of chars || []) {
      add(c.name, 'Character', () => {
        if (onSheet && typeof loadCharacter === 'function') { const sel = document.getElementById('char-select'); if (sel) sel.value = c.id; loadCharacter(c.id); }
        else _palGo(`/index.html?char=${encodeURIComponent(c.id)}`);
      }, c.char_type === 'npc' ? 'NPC' : '');
    }
  } else if (role === 'player') {
    add('My character sheet', 'Page', () => _palGo('/index.html'));
    add('Table', 'Page', () => _palGo('/table.html'));
    // The sheet's tabs, its spells and its items — on the sheet itself.
    for (const t of document.querySelectorAll('.tabs [role="tab"]')) {
      if (t.style.display === 'none' || t.hidden || t.classList.contains('tab-phone')) continue;
      const name = (t.getAttribute('aria-controls') || '').replace('tab-', '');
      add(t.textContent.trim(), 'Sheet', () => showTab(name, t));
    }
    if (onSheet && typeof spells !== 'undefined' && Array.isArray(spells)) {
      for (const s of spells) if (s && s.name) add(s.name, 'Spell', () => {
        const tb = document.getElementById('tabbtn-spells'); if (tb) showTab('spells', tb);
        if (typeof toggleSpellOpen === 'function') setTimeout(() => toggleSpellOpen(s.id), 50);
      }, s.level ? `Level ${s.level}` : 'Cantrip');
    }
    if (onSheet && typeof items !== 'undefined' && Array.isArray(items)) {
      for (const it of items) if (it && it.name) add(it.name, 'Item', () => {
        const tb = document.getElementById('tabbtn-inventory'); if (tb) showTab('inventory', tb);
        if (typeof openItemDetail === 'function') openItemDetail(it.id);
      }, it.equipped ? 'Worn' : '');
    }
    if (!onSheet) {
      add('My spells', 'Sheet', () => _palGo('/index.html?tab=spells'));
      add('My items', 'Sheet', () => _palGo('/index.html?tab=inventory'));
    }
    const hs = await _palJson('/api/handouts');
    for (const h of hs || []) add(h.title, 'Handout', () => {
      if (onSheet) { const tb = document.getElementById('tab-btn-handouts'); if (tb) showTab('handouts', tb); }
      else _palGo('/index.html?tab=handouts');
    });
  }
  return items.filter(i => i.label);
}

// Prefix beats contains beats letters-in-order ("gbn" finds Goblin).
function palScore(q, s) {
  q = String(q || '').toLowerCase().trim();
  s = String(s || '').toLowerCase();
  if (!q) return 1;
  if (s.startsWith(q)) return 4;
  if (s.split(/\s+/).some(w => w.startsWith(q))) return 3;
  if (s.includes(q)) return 2;
  let j = 0;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) j++;
  return j === q.length ? 1 : 0;
}

// ── The box ──────────────────────────────────────────────────────────────────
function _palEl() {
  if (_pal.el) return _pal.el;
  const wrap = document.createElement('div');
  wrap.id = 'palette';
  wrap.hidden = true;
  wrap.innerHTML = `<div class="pal-bg"></div>
    <div class="pal-box" role="dialog" aria-modal="true" aria-label="Search">
      <input id="pal-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search pages, monsters, spells, items…"
        role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list">
      <ul id="pal-list" role="listbox"></ul>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
  document.body.appendChild(wrap);
  _palStyle();
  wrap.querySelector('.pal-bg').onclick = closePalette;
  const q = wrap.querySelector('#pal-q');
  q.addEventListener('input', () => { _pal.sel = 0; _palRender(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _pal.sel = Math.min(_pal.sel + 1, _pal.shown.length - 1); _palRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _pal.sel = Math.max(_pal.sel - 1, 0); _palRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); _palRun(_pal.sel); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  wrap.querySelector('#pal-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) _palRun(parseInt(li.dataset.i, 10));
  });
  _pal.el = wrap;
  return wrap;
}

function _palRender() {
  const q = document.getElementById('pal-q').value;
  const list = document.getElementById('pal-list');
  if (_pal.loading && !_pal.items.length) { list.innerHTML = '<li class="pal-empty">Loading…</li>'; return; }
  _pal.shown = _pal.items.map(it => ({ it, s: palScore(q, it.label) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.it.label.localeCompare(b.it.label))
    .slice(0, PAL_MAX).map(x => x.it);
  if (!_pal.shown.length) {
    list.innerHTML = `<li class="pal-empty">Nothing matches “${_palEsc(q)}”. Try a page, monster, spell or item name.</li>`;
    return;
  }
  list.innerHTML = _pal.shown.map((it, i) =>
    `<li role="option" data-i="${i}" id="pal-o${i}"${i === _pal.sel ? ' class="sel" aria-selected="true"' : ' aria-selected="false"'}>
      <span class="pal-label">${_palEsc(it.label)}</span>${it.extra ? `<span class="pal-extra">${_palEsc(it.extra)}</span>` : ''}<span class="pal-kind">${_palEsc(it.kind)}</span></li>`).join('');
  document.getElementById('pal-q').setAttribute('aria-activedescendant', `pal-o${_pal.sel}`);
  document.getElementById(`pal-o${_pal.sel}`)?.scrollIntoView({ block: 'nearest' });
}

function _palRun(i) {
  const it = _pal.shown[i];
  if (!it) return;
  closePalette();
  try { it.run(); } catch (e) { console.error(e); }
}

async function openPalette() {
  if (!_palRole()) return;
  const el = _palEl();
  el.hidden = false;
  const q = document.getElementById('pal-q');
  q.value = '';
  _pal.sel = 0;
  q.focus();
  if (Date.now() - _pal.loadedAt > PAL_CACHE_MS || !_pal.items.length) {
    _pal.loading = _palBuild();
    _palRender();
    _pal.items = await _pal.loading;
    _pal.loading = null;
    _pal.loadedAt = Date.now();
  }
  if (!el.hidden) _palRender();
}

function closePalette() {
  if (_pal.el) _pal.el.hidden = true;
}

function _palStyle() {
  if (document.getElementById('pal-style')) return;
  const st = document.createElement('style');
  st.id = 'pal-style';
  st.textContent = [
    '#palette{position:fixed;inset:0;z-index:6000}',
    '#palette[hidden]{display:none}',
    '#palette .pal-bg{position:absolute;inset:0;background:#000a}',
    '#palette .pal-box{position:absolute;left:50%;top:12vh;transform:translateX(-50%);width:min(560px,calc(100vw - 24px));',
    '  background:var(--slate,#101a2c);color:var(--bone,#e6edf7);border:1px solid var(--rule-hi,#ffffff33);border-radius:10px;box-shadow:0 18px 48px #000c;overflow:hidden}',
    '#pal-q{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--rule-hi,#ffffff33);background:transparent;color:inherit;',
    '  font:inherit;font-size:16px;padding:14px 16px;outline:none}',
    '#pal-list{list-style:none;margin:0;padding:6px;max-height:min(52vh,420px);overflow-y:auto}',
    '#pal-list li{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;min-height:24px}',
    '#pal-list li.sel{background:var(--slate-hi,#1a2740)}',
    '#pal-list .pal-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#pal-list .pal-extra{color:var(--ash,#8c9ab3);font-size:12px;white-space:nowrap}',
    '#pal-list .pal-kind{font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:var(--arc,#e0a93f);white-space:nowrap}',
    '#pal-list .pal-empty{color:var(--ash,#8c9ab3);cursor:default}',
    '#palette .pal-foot{display:flex;gap:14px;padding:8px 14px;border-top:1px solid var(--rule-hi,#ffffff33);color:var(--ash,#8c9ab3);font-size:11px}',
    '#palette kbd{border:1px solid var(--rule-hi,#ffffff33);border-bottom-width:2px;border-radius:3px;padding:0 4px;margin-right:3px;font-size:10px}',
    '@media (max-width:760px){#palette .pal-box{top:8px}#palette .pal-foot{display:none}#pal-list li{min-height:36px}}',
    '.pal-open-btn{display:inline-flex;align-items:center;justify-content:center;margin-right:6px}',
  ].join('\n');
  document.head.appendChild(st);
}

// ── Arriving from a result: fill the page's own search ──────────────────────
const PAL_SEARCH_INPUT = {
  '/monsters.html': 'search-input', '/spells.html': 'sl-search',
  '/treasury.html': 'search', '/handouts.html': 'search',
};

function palAutoQuery() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const id = PAL_SEARCH_INPUT[_palPage()];
  if (q && id) {
    const fill = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.value = q;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    // Again once the page's own list has loaded, which redraws from the box.
    fill(); setTimeout(fill, 800); setTimeout(fill, 2500);
  }
  if (_palPage() === '/index.html') {
    const tab = params.get('tab');
    if (tab) setTimeout(() => {
      const tb = document.getElementById(`tabbtn-${tab}`) || document.getElementById(`tab-btn-${tab}`);
      if (tb && typeof showTab === 'function') showTab(tab, tb);
    }, 600);
    const char = params.get('char');
    if (char && _palRole() === 'dm') {
      let tries = 0;
      const pick = () => {
        const sel = document.getElementById('char-select');
        if (sel && [...sel.options].some(o => o.value === char)) {
          sel.value = char;
          if (typeof loadCharacter === 'function') loadCharacter(char);
        } else if (++tries < 20) setTimeout(pick, 250);
      };
      pick();
    }
  }
}

// ── Opening it ───────────────────────────────────────────────────────────────
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (!_palRole()) return;
      e.preventDefault();
      if (_pal.el && !_pal.el.hidden) closePalette(); else openPalette();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    palAutoQuery();
    // Pages without the DM bar (the sheet, the table) get a search button
    // beside the notification bell.
    setTimeout(() => {
      if (!_palRole() || document.getElementById('dm-nav') || document.querySelector('.pal-open-btn')) return;
      const bell = document.querySelector('[data-notif-bell]');
      if (!bell || !bell.parentNode) return;
      _palStyle();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = (bell.className || 'btn') + ' pal-open-btn';
      b.title = 'Search (Ctrl+K)';
      b.setAttribute('aria-label', 'Search (Ctrl+K)');
      b.innerHTML = '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-search"></use></svg>';
      b.onclick = (e) => { e.preventDefault(); openPalette(); };
      bell.parentNode.insertBefore(b, bell);
    }, 0);
  });
}
