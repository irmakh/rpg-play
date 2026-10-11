// Written by Irmak Hakman — 2026-10-11 22:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Parsing helpers ───────────────────────────────────────────────────────────
function parseConditions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isErr) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = isErr ? 'var(--blood)' : 'var(--rule-hi)';
  el.style.color = isErr ? 'var(--blood)' : 'var(--bone)';
  el.style.display = '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'flex';
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function done(result) {
      modal.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isDM() { return !!masterPw; }
function initials(name) {
  const words = String(name||'?').trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 4) || '?';
  // Multi-word: show first 3 chars of first word, keeps it readable without overflow
  return words[0].slice(0, 3) || '?';
}
// Returns the display name for a token. Monsters always show identifier only;
// full type/name is only visible in the right panel character sheet.
function tokDisplayName(tok) {
  if (tok.type === 'monster') {
    if (tok.label) return tok.label;
    // Fallback for older tokens without label: use last word (the auto-generated identifier)
    const parts = String(tok.name || '').trim().split(' ');
    return parts[parts.length - 1] || tok.name;
  }
  return tok.name;
}
// Token and HP colours are drawn to a canvas, so they must be literals - a CSS
// var() cannot reach ctx.fillStyle. These mirror the design tokens by hand.
// A character is deliberately NEUTRAL: the ring carries state (whose turn it
// is, how hurt they are), so the token itself does not need to shout.
function tokenRingColor(type) {
  if (type === 'character') return '#E6EDF7';   // --bone
  if (type === 'monster')   return '#E4666B';   // --blood
  if (type === 'npc')       return '#E0A93F';   // --arc
  return '#637189';                             // --ash-dim
}
function hpBarColor(pct) {
  if (pct >= 0.5)  return '#3DD68C';            // --verdigris
  if (pct >= 0.25) return '#E0A93F';            // --arc: hurt, not yet critical
  return '#E4666B';                             // --blood
}
// Text and HP-bar sizes for the label under a token, in map pixels. The token
// itself grows with the grid (cell size) and with the creature (1-4 cells), so
// a fixed 9px name ended up unreadably small beside a big token. The name grows
// in step with the cell, and only by the square root of the creature size - a
// 4-cell dragon gets a name twice as tall as a 1-cell goblin's, not four times.
// A default 50px grid gives exactly the old 9px / 4px, so nothing moves there.
function tokenLabelMetrics(cellSize, sizeMult) {
  const cs = cellSize > 0 ? cellSize : 50;
  const mult = Math.max(1, sizeMult || 1);
  const font = Math.max(9, Math.min(40, Math.round(cs * 0.18 * Math.sqrt(mult))));
  return { font, bar: Math.max(4, Math.round(font * 0.45)) };
}
// What to write beside a token while it is being dragged. In a fight the token
// has a movement budget for the turn, so the label counts it down and turns red
// once it is overspent. Outside a fight nothing is spent, but the distance is
// still worth seeing - it goes amber past the creature's speed, as a hint and
// not a limit. `tone` is 'ok' | 'warn' | 'over'; the caller picks the colour.
function dragDistanceLabel(dist, speed, remainingFt, freeMove) {
  if (freeMove) return { text: `${dist} ft`, tone: dist > (speed || 30) ? 'warn' : 'ok' };
  const left = remainingFt - dist;
  return {
    text: `${dist}ft  (${left >= 0 ? left + 'ft left' : Math.abs(left) + 'ft over'})`,
    tone: left >= 0 ? 'ok' : 'over',
  };
}
function getActiveTurnTokenId() {
  if (!initData.currentId) return null;
  const entry = initData.entries?.find(e => e.id === initData.currentId);
  if (!entry) return null;
  return _findInitToken(entry)?.id || null;
}
function showStatus(msg, isErr) {
  // no status bar on this page, use console
  console.log((isErr ? 'ERROR: ' : '') + msg);
}

// ── Draggable modal utility ───────────────────────────────────────────────────
function makeDraggable(box, handle) {
  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button,input,select,textarea,a')) return;
    e.preventDefault();
    if (!box.style.left) {
      const r = box.getBoundingClientRect();
      box.style.position = 'fixed';
      box.style.margin   = '0';
      box.style.left     = r.left + 'px';
      box.style.top      = r.top  + 'px';
    }
    const ox = e.clientX - parseFloat(box.style.left);
    const oy = e.clientY - parseFloat(box.style.top);
    handle.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    // The music modal embeds an iframe, and a frame can swallow the mousemove /
    // mouseup this drag listens for once the pointer crosses it — which happens
    // whenever the modal stops following the cursor at a window edge. Chromium
    // was measured to route the events to the parent anyway, so this is a guard
    // for the engines that do not, not a fix for an observed freeze here.
    const frames = [...document.querySelectorAll('iframe')];
    for (const f of frames) f.style.pointerEvents = 'none';
    function onMove(e) {
      box.style.left = Math.max(0, Math.min(window.innerWidth  - box.offsetWidth,  e.clientX - ox)) + 'px';
      box.style.top  = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - oy)) + 'px';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      document.body.style.userSelect = '';
      for (const f of frames) f.style.pointerEvents = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Spells in the character panel ─────────────────────────────────────────────
// Pure builders for the Spells tab of the right panel (table-panel.js) and its
// pop-out. A spell is the sheet's own row: [0] level, [1] name, [4]
// concentration, [5] ritual, [7] prepared.

// Does a spell belong in the list, for this filter ('prepared' | 'unprepared' |
// 'all') and this search text?
function spellShown(s, filter, query) {
  if (!s) return false;
  if (filter === 'prepared' && !s[7]) return false;
  if (filter === 'unprepared' && s[7]) return false;
  const q = String(query || '').trim().toLowerCase();
  return !q || String(s[1] || '').toLowerCase().includes(q);
}

function spellCounts(spells) {
  const all = (spells || []).filter(Boolean);
  const prepared = all.filter(s => s[7]).length;
  return { prepared, unprepared: all.length - prepared, all: all.length };
}

/**
 * Spell slots, one row per level: a marker for every slot — solid while it can
 * still be spent, hollow and struck through once it is gone — and the count in
 * words beside them, so the state reads without counting dots.
 * slots: [{ level, total, used }]
 */
function spellSlotsHTML(slots, canEdit) {
  if (!slots || !slots.length) return '';
  const rows = slots.map(s => {
    const used = Math.max(0, Math.min(s.total, s.used));
    const left = s.total - used;
    const pips = Array.from({ length: s.total }, (_, j) => {
      const open = j < left;
      const tip = open ? 'Available' + (canEdit ? ' — click to use' : '') : 'Used' + (canEdit ? ' — click to restore' : '');
      return `<span class="rp-slot-pip${open ? '' : ' used'}" title="${tip}"`
        + (canEdit ? ` onclick="clickSpellSlotPip(${s.level},${j})"` : '') + `></span>`;
    }).join('');
    return `<div class="rp-slot-row${left ? '' : ' spent'}${canEdit ? ' can-edit' : ''}">`
      + `<span class="rp-slot-lvl">Level ${s.level}</span>`
      + `<span class="rp-slot-pips">${pips}</span>`
      + `<span class="rp-slot-count"><b>${left}</b> of ${s.total} left</span></div>`;
  }).join('');
  return `<div class="rp-flat-hdr">Spell Slots${canEdit ? ' <span class="rp-hdr-hint">(click a slot to use or restore it)</span>' : ''}</div>`
    + `<div class="rp-slot-list">${rows}</div>`;
}

const SPELL_FILTERS = [
  { key: 'prepared',   label: 'Prepared' },
  { key: 'unprepared', label: 'Not prepared' },
  { key: 'all',        label: 'All' },
];

/**
 * The whole spellbook, grouped by level. Every spell is in the markup; the
 * ones the filter and search leave out are only hidden, so changing either
 * never has to rebuild the panel (which would take the cursor out of the
 * search box).
 * o: { filter, query, spAtk }   spAtk null = no spell attack button
 */
function spellbookHTML(spells, o) {
  const list = (spells || []).map((s, idx) => ({ s, idx })).filter(x => x.s);
  if (!list.length) return '';
  const filter = o.filter || 'prepared';
  const counts = spellCounts(spells);
  const byLevel = new Map();
  for (const x of list) {
    const lvl = String(x.s[0] || 0);
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(x);
  }
  let anyShown = false;
  const groups = [...byLevel.keys()].sort((a, b) => Number(a) - Number(b)).map(lvl => {
    let shown = 0;
    const rows = byLevel.get(lvl).map(({ s, idx }) => {
      const show = spellShown(s, filter, o.query);
      if (show) shown++;
      const name = s[1] || '?';
      return `<div class="rp-sb-row${s[7] ? '' : ' unprep'}" data-idx="${idx}"${show ? '' : ' style="display:none"'}>`
        + `<span class="rp-sb-mark" title="${s[7] ? 'Prepared' : 'Not prepared'}"></span>`
        + `<span class="rp-spell-name rp-sb-name" onclick="postSpellInfoFromAll(${idx})" title="Send to chat">${esc(name)}</span>`
        + (s[4] ? '<span class="rp-sb-flag conc" title="Concentration">C</span>' : '')
        + (s[5] ? '<span class="rp-sb-flag rit" title="Ritual">R</span>' : '')
        + (o.spAtk != null
          ? `<span class="qroll-val rp-sb-atk" onclick="qroll('${escJs(name)}','${escJs(String(o.spAtk))}')" title="Spell attack"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-bolt"></use></svg></span>`
          : '')
        + `</div>`;
    }).join('');
    if (shown) anyShown = true;
    // The level is whatever the sheet's spell row holds, so it is escaped.
    return `<div class="rp-sb-group"${shown ? '' : ' style="display:none"'}>`
      + `<div class="rp-sb-lvl">${lvl === '0' ? 'Cantrips' : 'Level ' + esc(lvl)} <span class="rp-sb-n">${shown}</span></div>`
      + rows + `</div>`;
  }).join('');
  const seg = SPELL_FILTERS.map(f =>
    `<button type="button" class="rp-sb-f${f.key === filter ? ' on' : ''}" data-f="${f.key}" onclick="setSideSpellFilter('${f.key}')">`
    + `${f.label} <span class="rp-sb-fc">${counts[f.key]}</span></button>`).join('');
  return `<div id="rp-sb"><div class="rp-flat-hdr">Spellbook</div>`
    + `<div class="rp-sb-tools"><div class="rp-sb-seg" role="group" aria-label="Which spells to show">${seg}</div>`
    + `<input type="search" class="rp-sb-search" placeholder="Find a spell…" aria-label="Find a spell" value="${esc(o.query || '')}" oninput="setSideSpellQuery(this.value)"></div>`
    + groups
    + `<div class="rp-tab-empty rp-sb-none"${anyShown ? ' style="display:none"' : ''}>No spells match.</div></div>`;
}
