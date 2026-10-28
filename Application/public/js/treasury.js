// Written by Irmak Hakman — 2026-10-28 16:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Treasury — the DM's catalogue of everything players can find, ask for or buy.
 *
 * Items lie in piles: a chest, a hoard, a merchant's stock. A pile is an
 * item's tag. The screen opens on every pile at a glance; each one says where
 * its items are (hidden, free loot, in the shop) and moves them all with one
 * click. Open a pile for its items, and an item for everything about it in the
 * editor on the right. There is no Save button: a change is saved as it is
 * made, and the last one can be undone.
 *
 * The helpers down to the "Page state" marker are pure and are what
 * tests/unit/treasury-ui.test.js runs.
 */

// ── Pure helpers ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Escape for a single-quoted JS string inside an HTML attribute (see esc.js).
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MODES = ['hidden', 'loot', 'shop'];
const MODE_LABEL = { hidden: 'Hidden', loot: 'Free loot', shop: 'Shop' };
const MODE_HELP  = {
  hidden: 'Only you see it.',
  loot:   'Players see it, ask for it, and you decide who gets it.',
  shop:   'Players can buy it while the shop is open.',
};
const WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

// Kinds of item. Picking one decides which groups of fields the editor shows.
const KINDS = [
  { key: 'weapon',   label: 'Weapon',   sections: ['weapon', 'bonuses', 'charges'] },
  { key: 'armor',    label: 'Armour',   sections: ['armor', 'bonuses'] },
  { key: 'shield',   label: 'Shield',   sections: ['bonuses'] },
  { key: 'potion',   label: 'Potion',   sections: ['charges'] },
  { key: 'wondrous', label: 'Wondrous', sections: ['bonuses', 'charges'] },
  { key: 'other',    label: 'Other',    sections: ['bonuses', 'charges'] },
];
function kindOf(key) { return KINDS.find(k => k.key === key) || KINDS[KINDS.length - 1]; }

// A group of fields is shown when the kind uses it — or when the item already
// holds something in it, so changing an item's kind never hides data.
function sectionHasValues(it, sect) {
  if (sect === 'weapon')  return !!(parseInt(it.weaponAtk) || it.weaponDmg || (it.weaponProperties || []).length);
  if (sect === 'armor')   return it.itemType === 'armor';
  if (sect === 'bonuses') return !!(it.acBonus || it.initBonus || it.speedBonus || it.spellAtkBonus || it.spellDcBonus || it.requiresAttunement);
  if (sect === 'charges') return !!it.charges;
  return false;
}
function sectionShown(it, sect) {
  return kindOf(it.itemType).sections.includes(sect) || sectionHasValues(it, sect);
}

// The line under an item's name: what it is, at a glance.
function kindSummary(it) {
  const parts = [kindOf(it.itemType).label];
  if (it.itemType === 'weapon') {
    const magic = parseInt(it.weaponAtk) || 0;
    if (magic) parts.push((magic > 0 ? '+' : '') + magic);
    if (it.weaponDmg) parts.push(it.weaponDmg);
  }
  if (it.itemType === 'armor') parts.push(`AC ${it.acBase ?? 10}`);
  if (it.acBonus) parts.push(`AC ${it.acBonus > 0 ? '+' : ''}${it.acBonus}`);
  if (it.charges) parts.push(`${it.charges} charge${it.charges === 1 ? '' : 's'}`);
  if (it.requiresAttunement) parts.push('attunement');
  return parts.join(' · ');
}

// ── Money and stock ──────────────────────────────────────────────────────────
function cpToGp(cp) {
  if (!cp) return '0 gp';
  if (cp % 100 === 0) return `${cp / 100} gp`;
  return `${(cp / 100).toFixed(2)} gp`;
}
const COIN_CP = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

// A typed price: "50", "50 gp", "7sp", "2 pp 5 gp", "12.5". A bare number is
// gold. Returns copper, or null when it is not a price.
function parsePrice(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase().replace(/,/g, '');
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 100);
  const re = /(\d+(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)/g;
  let total = 0, m, used = '';
  while ((m = re.exec(s))) { total += parseFloat(m[1]) * COIN_CP[m[2]]; used += m[0]; }
  if (!used || s.replace(re, '').trim()) return null;
  return Math.round(total);
}

function stockText(q) { return q === -1 ? '∞' : String(q ?? 0); }
// Typed stock: a whole number, or ∞ / "unlimited" / -1 for no limit.
function parseStock(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase();
  if (s === '∞' || s === 'inf' || s === 'unlimited' || s === '-1') return -1;
  if (!/^\d+$/.test(s)) return null;
  return Math.min(99999, parseInt(s));
}

// ── Piles ────────────────────────────────────────────────────────────────────
// Where a pile's items are: one place when they agree, 'mixed' when they do
// not, 'empty' with nothing in it.
function pileState(list) {
  const counts = { hidden: 0, loot: 0, shop: 0 };
  for (const i of list || []) if (counts[i.mode] !== undefined) counts[i.mode]++;
  const used = MODES.filter(m => counts[m] > 0);
  return { state: used.length === 0 ? 'empty' : used.length === 1 ? used[0] : 'mixed', counts };
}

// Every pile: each tag in use plus each pile row (a pile can be empty), by
// name, with Unsorted ('' — items with no pile) last and only when it holds
// something. `asks` counts the requests waiting on its items.
function pileEntries(items, pileRows, requests) {
  const map = new Map();
  const get = tag => {
    if (!map.has(tag)) map.set(tag, { tag, items: [], note: '', asks: 0 });
    return map.get(tag);
  };
  for (const r of pileRows || []) if (r.tag) get(r.tag).note = r.note || '';
  for (const i of items || []) get(i.tag || '').items.push(i);
  const pileOf = new Map((items || []).map(i => [i.id, i.tag || '']));
  for (const r of requests || []) if (pileOf.has(r.itemId)) get(pileOf.get(r.itemId)).asks++;
  return [...map.values()]
    .filter(p => p.tag || p.items.length)
    .map(p => ({ ...p, ...pileState(p.items) }))
    .sort((a, b) => (!a.tag && b.tag ? 1 : a.tag && !b.tag ? -1 : a.tag.localeCompare(b.tag)));
}

// Items whose name, player-facing name, description or pile matches.
function searchItems(items, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [...(items || [])];
  return (items || []).filter(i =>
    [i.name, i.unidName, i.description, i.tag].some(v => String(v || '').toLowerCase().includes(needle)));
}

function byName(list) {
  return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
}

// How many of an item "Give pile" hands over: all of a counted stock, one of
// an endless one, none of a spent one. The server caps a grant at 100.
function giveQty(it) {
  if (it.quantity === -1) return 1;
  return Math.max(0, Math.min(100, it.quantity ?? 0));
}

// ── Page state ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

let masterPw   = '';
let items      = [];
let pileRows   = [];          // pile notes, and piles with nothing in them yet
let requests   = [];          // pending free-loot requests
let chars      = [];          // characters, for "Give to"
let ledgerRows = null;        // claim + purchase history, loaded when first needed
let shopIsOpen = true;

let curPile    = null;        // the pile open, '' for Unsorted, null for every pile
let curId      = null;        // the item in the editor
let drawerOpen = false;
let showAllAsks = false;

const NEW_TAG = '__new_tag__';
const UNSORTED = 'Unsorted';

try { const p = JSON.parse(localStorage.getItem('treasury-pile') || 'null'); curPile = typeof p === 'string' ? p : null; } catch {}

function applyTheme(name) {
  document.body.className = name === 'dark-gold' ? '' : 'theme-' + name;
  try { localStorage.setItem('dm-theme', name); } catch {}
}
(function () { let t = 'dark-gold'; try { t = localStorage.getItem('dm-theme') || t; } catch {} applyTheme(t); })();

function showStatus(msg, isError) {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

function handleUnauth() {
  masterPw = '';
  $('gate').style.display = '';
  $('shell').style.display = 'none';
}

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), 'X-Master-Password': masterPw };
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers });
}

const byId = id => items.find(i => i.id === id) || null;
const asksFor = itemId => requests.filter(r => r.itemId === itemId);
const idLit = id => `'${escJs(id)}'`;
const pileLabel = tag => tag || UNSORTED;
const inPile = tag => items.filter(i => (i.tag || '') === tag);
const piles = () => pileEntries(items, pileRows, requests);
const ico = name => `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

// ── Auth ─────────────────────────────────────────────────────────────────────
// The shared DM gate (js/lib/auth-ui.js): maths captcha, lockout, and a session
// token kept in masterPw where the typed password used to go.
const _gate = AuthUI.dmGate({
  capEl:   document.getElementById('gate-cap'),
  pwInput: document.getElementById('gate-pw'),
  errEl:   document.getElementById('gate-err'),
  onUnlock: async (token) => {
    masterPw = token;
    const res = await api('/api/treasury/all');
    if (!res.ok) { document.getElementById('gate-err').textContent = 'Server error.'; return; }
    items = await res.json();
    $('gate').style.display = 'none';
    $('shell').style.display = '';
    initPropsGrid();
    await Promise.all([loadPiles(), loadShopStatus(), loadRequests(), loadChars()]);
    fixPile();
    renderAll();
  },
});
function authenticate() { return _gate.submit(); }

// ── Loading ──────────────────────────────────────────────────────────────────
async function loadItems() {
  try {
    const res = await api('/api/treasury/all');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not reload the items.', true); return; }
    const fresh = await res.json();
    // A change still on its way to the server wins over what the server said
    // a moment ago, or the field would jump back while it is being typed.
    for (const it of fresh) {
      const p = pending.get(it.id);
      if (p) Object.assign(it, p.patch);
    }
    items = fresh;
    if (curId && !byId(curId)) { curId = null; drawerOpen = false; }
    fixPile();
    renderAll();
  } catch { showStatus('Network error.', true); }
}

async function loadPiles() {
  try {
    const res = await api('/api/treasury/piles');
    if (res.ok) pileRows = await res.json();
  } catch {}
}

async function loadChars() {
  try {
    const res = await api('/api/characters');
    if (res.ok) chars = (await res.json()).map(c => ({ id: c.id, name: c.name || 'Unnamed' }));
  } catch {}
  renderGive();
}

async function refreshAll() {
  await Promise.all([loadPiles(), loadShopStatus(), loadRequests(), loadChars()]);
  await loadItems();
  ledgerRows = null;
  if (drawerOpen && $('sect-history').open) renderHistory();
  showStatus('Refreshed.', false);
}

// A remembered pile can vanish (renamed, emptied, deleted); fall back to the
// overview rather than an empty page.
function fixPile() {
  if (curPile === null) return;
  if (!piles().some(p => p.tag === curPile)) curPile = null;
}

function renderAll() {
  renderShopSwitch();
  renderAsks();
  renderMain();
  renderDrawer();
}

// ── Saving: as you go, with one step of undo ─────────────────────────────────
// A change is applied to the page at once and sent a moment later, so a burst
// of typing is one save. `before` remembers what the fields held, which is what
// Undo puts back.
const pending = new Map();    // itemId -> { patch, before, timer, label }
let lastUndo = null;          // { id, before, label } or { modes: {id: mode}, label }

function queueSave(id, patch, { now = false, label = '' } = {}) {
  const it = byId(id);
  if (!it) return;
  const p = pending.get(id) || { patch: {}, before: {} };
  for (const k of Object.keys(patch)) {
    if (!(k in p.before)) p.before[k] = it[k];
    p.patch[k] = patch[k];
    it[k] = patch[k];
  }
  if (label) p.label = label;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => flushSave(id), now ? 0 : 700);
  pending.set(id, p);
  setSaveState('Saving…');
}

async function flushSave(id) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  // An item must keep a name; an emptied name box is simply not sent.
  const patch = { ...p.patch };
  if (patch.name !== undefined && !String(patch.name).trim()) { delete patch.name; delete p.before.name; }
  if (Object.keys(patch).length === 0) { setSaveState(''); return; }
  try {
    const res = await api(`/api/treasury/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('refused');
    // Identifying reaches the players' own sheets and cannot be taken back, so
    // it is never offered as an undo.
    lastUndo = patch.descVisible === true ? null : { id, before: p.before, label: p.label || 'last change' };
    setSaveState('Saved');
  } catch {
    const it = byId(id);
    if (it) Object.assign(it, p.before);
    setSaveState('');
    showStatus('That change could not be saved.', true);
    await loadItems();
  }
  renderUndo();
}

async function undoLast() {
  if (!lastUndo) return;
  const u = lastUndo;
  lastUndo = null;
  renderUndo();
  try {
    if (u.modes) {
      // A whole pile moved: put each item back where it was, one call per place.
      const groups = {};
      for (const [id, m] of Object.entries(u.modes)) (groups[m] ||= []).push(id);
      for (const [mode, ids] of Object.entries(groups)) {
        const res = await api('/api/treasury/bulk-mode', { method: 'POST', body: JSON.stringify({ ids, mode }) });
        if (!res.ok) throw new Error('refused');
      }
    } else {
      const it = byId(u.id);
      if (!it) return;
      Object.assign(it, u.before);
      const res = await api(`/api/treasury/${u.id}`, { method: 'PUT', body: JSON.stringify(u.before) });
      if (!res.ok) throw new Error('refused');
    }
    showStatus('Undone.', false);
  } catch { showStatus('Could not undo that.', true); }
  await loadItems();
}

function setSaveState(text) {
  const el = $('save-state');
  if (el) el.textContent = text;
  if (text === 'Saved') setTimeout(() => { if (el && el.textContent === 'Saved') el.textContent = ''; }, 2500);
}
function renderUndo() {
  const b = $('btn-undo');
  if (!b) return;
  b.style.display = lastUndo ? '' : 'none';
  if (lastUndo) b.title = 'Undo: ' + lastUndo.label;
}

// ── The shop switch ──────────────────────────────────────────────────────────
// One switch for the whole shop. Which items are for sale is simply which are
// in the shop; there is no second list of tags on sale any more.
async function loadShopStatus() {
  try {
    const res = await api('/api/treasury/status');
    if (!res.ok) return;
    shopIsOpen = (await res.json()).isOpen;
    renderShopSwitch();
  } catch {}
}

function renderShopSwitch() {
  const b = $('shop-switch');
  if (!b) return;
  b.classList.toggle('open', !!shopIsOpen);
  b.innerHTML = `<span class="dot"></span>${shopIsOpen ? 'Shop open' : 'Shop closed'}`;
  b.title = shopIsOpen ? 'Players can buy what is in the shop. Click to close it.' : 'Players cannot buy anything. Click to open the shop.';
}

async function toggleShop() {
  try {
    const res = await api('/api/treasury/status', { method: 'PUT', body: JSON.stringify({ isOpen: !shopIsOpen, activeTags: [] }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not change the shop.', true); return; }
    shopIsOpen = (await res.json()).isOpen;
    renderAll();
  } catch { showStatus('Network error.', true); }
}

// ── Requests ─────────────────────────────────────────────────────────────────
async function loadRequests() {
  if (!masterPw) return;
  try {
    const res = await api('/api/treasury/requests');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) return;
    requests = await res.json();
  } catch { return; }
  renderAsks();
  renderMain();
  if (drawerOpen) fillDrawer(byId(curId));
}

function whenText(raw) {
  const s = String(raw || '');
  const dt = new Date(s + (s && !s.endsWith('Z') && s.includes('T') ? 'Z' : ''));
  return isNaN(dt) ? esc(s) : dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The banner over everything: who is waiting for what, with the answer buttons
// right there. Three at a time unless unfolded.
function renderAsks() {
  const bar = $('asks-bar');
  if (!bar) return;
  bar.hidden = requests.length === 0;
  if (!requests.length) { bar.innerHTML = ''; return; }
  const shown = showAllAsks ? requests : requests.slice(0, 3);
  bar.innerHTML = `<div class="asks-h">${ico('hand')} ${requests.length} waiting for loot</div>`
    + shown.map(r => {
      const it = byId(r.itemId);
      return `<div class="ask">
        <span class="who">${esc(r.charName) || 'Unknown'}</span> asks for
        <button type="button" class="link" onclick="openItem(${idLit(r.itemId)})">${esc(r.itemName)}</button>
        ${it ? `<span class="muted">in ${esc(pileLabel(it.tag))}</span>` : ''}
        <span class="ask-when">${whenText(r.requestedAt)}</span>
        <span class="sp"></span>
        <button type="button" class="btn sm ok" onclick="decideRequest(${idLit(r.id)},'approve')" title="Give it to this character">Give</button>
        <button type="button" class="btn sm" onclick="decideRequest(${idLit(r.id)},'decline')" title="Turn this request down">Decline</button>
      </div>`;
    }).join('')
    + (requests.length > 3
      ? `<button type="button" class="link" onclick="showAllAsks=!showAllAsks;renderAsks()">${showAllAsks ? 'Show fewer' : `Show all ${requests.length}`}</button>`
      : '');
}

function askRowsHTML(it) {
  return asksFor(it.id).map(r => `<div class="ask">
      <span class="who">${esc(r.charName) || 'Unknown'}</span><span class="ask-when">${whenText(r.requestedAt)}</span>
      <span class="sp"></span>
      <button type="button" class="btn sm ok" onclick="decideRequest(${idLit(r.id)},'approve')" title="Give it to this character">Give</button>
      <button type="button" class="btn sm" onclick="decideRequest(${idLit(r.id)},'decline')" title="Turn this request down">Decline</button>
    </div>`).join('');
}

async function decideRequest(id, action) {
  try {
    const res = await api(`/api/treasury/requests/${id}/${action}`, { method: 'POST' });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showStatus(data.error || 'That did not work.', true); return; }
    if (action === 'approve') {
      showStatus(data.exhausted
        ? `Handed over. That was the last one${data.declined ? ` — ${data.declined} other request${data.declined === 1 ? '' : 's'} declined` : ''}.`
        : 'Handed over.');
    } else {
      showStatus('Declined.');
    }
    ledgerRows = null;
    await loadItems();
    await loadRequests();
  } catch { showStatus('Network error.', true); }
}

// ── Main area: every pile, or one ────────────────────────────────────────────
function openPile(tag) {
  curPile = tag;
  try { localStorage.setItem('treasury-pile', JSON.stringify(tag)); } catch {}
  closeMenu();
  $('p-search').value = '';
  if (tag !== null) { $('p-name').value = tag; $('p-note').value = (pileRows.find(r => r.tag === tag) || {}).note || ''; }
  renderMain();
  $('main').scrollTop = 0;
}

function renderMain() {
  const onePile = curPile !== null;
  $('home').hidden = onePile;
  $('pile').hidden = !onePile;
  $('body').classList.toggle('in-pile', onePile);
  if (onePile) { renderPile(); renderRail(); }
  else renderHome();
}

const STATE_LABEL = { hidden: 'Hidden', loot: 'Free loot', shop: 'On sale', mixed: 'Mixed', empty: 'Empty' };
function stateText(p) {
  if (p.state === 'shop' && !shopIsOpen) return 'In shop · closed';
  if (p.state !== 'mixed') return STATE_LABEL[p.state];
  return MODES.filter(m => p.counts[m]).map(m => `${p.counts[m]} ${MODE_LABEL[m].toLowerCase()}`).join(' · ');
}

// The three-way switch for a whole pile. Nothing is lit when it is mixed.
function pileSegHTML(p) {
  const lbl = { hidden: 'Hidden', loot: 'Free loot', shop: 'Shop' };
  return MODES.map(m => `<button type="button" class="${p.state === m ? 'on ' + m : ''}"
      title="${esc(m === 'hidden' ? 'Hide every item in this pile' : m === 'loot' ? 'Reveal every item as free loot' : 'Put every item on sale')}"
      ${p.items.length ? '' : 'disabled'}
      onclick="event.stopPropagation();setPileMode(${p.tag === '' ? "''" : idLit(p.tag)},'${m}')">${lbl[m]}</button>`).join('');
}

function renderHome() {
  const q = $('search').value.trim();
  const grid = $('piles'), found = $('found');
  grid.hidden = !!q;
  found.hidden = !q;
  if (q) {
    const hits = byName(searchItems(items, q));
    found.innerHTML = hits.length
      ? hits.map(i => itemRowHTML(i, true)).join('')
      : '<div class="empty">No item matches.</div>';
    return;
  }
  const list = piles();
  if (!list.length) {
    grid.innerHTML = `<div class="empty wide">No piles yet. A pile is a chest, a hoard or a merchant's stock.
      <br><br><button class="btn primary" onclick="openPileModal()">${ico('plus')} Make the first pile</button></div>`;
    return;
  }
  grid.innerHTML = list.map(p => {
    const thumbs = p.items.filter(i => i.imageThumb).slice(0, 4)
      .map(i => `<img src="${esc(i.imageThumb)}" alt="">`).join('');
    const names = byName(p.items).slice(0, 3).map(i => esc(i.name)).join(', ') + (p.items.length > 3 ? '…' : '');
    return `<div class="pcard st-${p.state}" role="button" tabindex="0" data-pile="${esc(p.tag)}"
        onclick="openPile(${p.tag === '' ? "''" : idLit(p.tag)})" onkeydown="if(event.key==='Enter')this.click()"
        ondragover="pileDragOver(event)" ondragleave="this.classList.remove('drop')" ondrop="pileDrop(event, ${p.tag === '' ? "''" : idLit(p.tag)})">
      <div class="pc-top">
        <b class="pc-name">${esc(pileLabel(p.tag))}</b>
        ${p.asks ? `<span class="chip asked" title="Players waiting on items in this pile">${p.asks} asking</span>` : ''}
      </div>
      <div class="pc-state"><i class="dot"></i>${esc(stateText(p))} <span class="muted">· ${p.items.length} item${p.items.length === 1 ? '' : 's'}</span></div>
      ${p.note ? `<div class="pc-note">${esc(p.note)}</div>` : ''}
      <div class="pc-items">${thumbs ? `<span class="pc-thumbs">${thumbs}</span>` : ''}<span class="muted">${names || 'Nothing in it yet'}</span></div>
      <div class="seg pc-seg">${pileSegHTML(p)}</div>
    </div>`;
  }).join('');
}

function renderPile() {
  const p = piles().find(x => x.tag === curPile) || { tag: curPile, items: [], note: '', asks: 0, ...pileState([]) };
  const unsorted = curPile === '';
  $('p-name').hidden = unsorted;
  $('p-unsorted').hidden = !unsorted;
  $('p-note').hidden = unsorted;
  if (document.activeElement !== $('p-name')) $('p-name').value = curPile || '';
  if (document.activeElement !== $('p-note') && !noteTimer) $('p-note').value = p.note || '';
  autoGrow($('p-note'));
  $('p-state').innerHTML = pileSegHTML(p);
  $('p-help').textContent = unsorted
    ? 'Items that are in no pile. Drag them onto a pile, or pick one in the editor.'
    : `${p.items.length} item${p.items.length === 1 ? '' : 's'} · ${stateText(p)}`;
  const shown = byName(searchItems(p.items, $('p-search').value));
  $('items').innerHTML = shown.length
    ? shown.map(i => itemRowHTML(i, false)).join('')
    : `<div class="empty">${p.items.length ? 'Nothing here matches.' : 'Nothing in this pile yet. <strong>Add item</strong>, Import, or drag items onto it.'}</div>`;
}

// The other piles beside an open one, as places to go and to drop items on.
function renderRail() {
  $('rail').innerHTML = `<div class="rail-h">Piles</div>` + piles().map(p =>
    `<button type="button" class="rail-p st-${p.state}${p.tag === curPile ? ' on' : ''}"
        onclick="openPile(${p.tag === '' ? "''" : idLit(p.tag)})"
        ondragover="pileDragOver(event)" ondragleave="this.classList.remove('drop')" ondrop="pileDrop(event, ${p.tag === '' ? "''" : idLit(p.tag)})">
      <i class="dot"></i><span>${esc(pileLabel(p.tag))}</span><small>${p.items.length}</small></button>`).join('')
    + `<button type="button" class="rail-p add" onclick="openPileModal()">${ico('plus')}<span>New pile</span></button>`;
}

// One item in a list. `withPile` names its pile too (search results).
function itemRowHTML(it, withPile) {
  const asks = asksFor(it.id);
  const thumb = it.imageThumb
    ? `<img class="thumb" src="${esc(it.imageThumb)}" alt="">`
    : `<span class="thumb ph">${ico('square')}</span>`;
  const price = it.valueCp ? cpToGp(it.valueCp) : (it.mode === 'shop' ? 'Free' : '');
  const sub = [kindSummary(it)];
  if (!it.descVisible && it.unidName) sub.push(`players see “${esc(it.unidName)}”`);
  return `<div class="irow${it.id === curId && drawerOpen ? ' cur' : ''}${it.quantity === 0 ? ' gone' : ''}" draggable="true"
      data-id="${esc(it.id)}" onclick="openItem(${idLit(it.id)})" ondragstart="itemDragStart(event, ${idLit(it.id)})" ondragend="itemDragEnd()">
    ${thumb}
    <div class="nm"><b>${esc(it.name) || '<em>Untitled</em>'}${it.descVisible ? '' : ' <span class="chip unid" title="Players do not know what it is yet">Unidentified</span>'}</b>
      <small>${withPile ? `<span class="pile-name">${esc(pileLabel(it.tag))}</span> · ` : ''}${sub.join(' · ')}</small></div>
    ${asks.length ? `<span class="chip asked" title="${esc(asks.map(r => r.charName).join(', '))}">${asks.length} asking</span>` : ''}
    <span class="mode-pill ${it.mode}" title="${esc(MODE_HELP[it.mode])}">${MODE_LABEL[it.mode]}</span>
    <span class="c-num gold">${price}</span>
    <span class="c-num stock" title="Stock">${it.quantity === -1 ? '∞' : '×' + (it.quantity ?? 0)}</span>
    <button type="button" class="btn sm icon" title="More" aria-label="More for ${esc(it.name)}"
      onclick="event.stopPropagation();openItemMenu(this, ${idLit(it.id)})">${ico('more')}</button>
  </div>`;
}

// ── Moving a whole pile ──────────────────────────────────────────────────────
async function setPileMode(tag, mode) {
  const list = inPile(tag);
  const moving = list.filter(i => i.mode !== mode);
  if (!moving.length) return;
  const losing = mode !== 'loot' ? moving.reduce((n, i) => n + asksFor(i.id).length, 0) : 0;
  if (losing && !confirm(`${losing} request${losing === 1 ? ' is' : 's are'} waiting on this pile's free loot. Moving it turns ${losing === 1 ? 'it' : 'them'} down. Go ahead?`)) return;
  const before = Object.fromEntries(moving.map(i => [i.id, i.mode]));
  for (const i of moving) i.mode = mode;
  renderAll();
  try {
    const res = await api('/api/treasury/bulk-mode', { method: 'POST', body: JSON.stringify({ ids: moving.map(i => i.id), mode }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('refused');
    lastUndo = { modes: before, label: `${pileLabel(tag)} → ${MODE_LABEL[mode]}` };
    renderUndo();
    const verb = { hidden: 'Hidden', loot: 'Revealed as free loot', shop: shopIsOpen ? 'On sale' : 'In the shop (the shop is closed)' }[mode];
    showStatus(`${verb}: ${pileLabel(tag)}.`, false);
  } catch { showStatus('That did not work.', true); }
  await loadItems();
  if (losing) await loadRequests();
}

// ── Piles: make, rename, note, delete ────────────────────────────────────────
function openPileModal() {
  closeMenu();
  $('np-name').value = '';
  $('np-note').value = '';
  $('np-err').textContent = '';
  $('pile-modal').style.display = 'flex';
  setTimeout(() => $('np-name').focus(), 30);
}
function closePileModal() { $('pile-modal').style.display = 'none'; }

async function createPile() {
  const tag = $('np-name').value.trim();
  if (!tag) { $('np-err').textContent = 'Give the pile a name.'; return; }
  if (piles().some(p => p.tag === tag)) { closePileModal(); openPile(tag); return; }
  try {
    const res = await api('/api/treasury/piles', { method: 'POST', body: JSON.stringify({ tag, note: $('np-note').value }) });
    if (res.status === 401) { handleUnauth(); return; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { $('np-err').textContent = d.error || 'Could not make it.'; return; }
    closePileModal();
    await loadPiles();
    openPile(d.tag);
  } catch { $('np-err').textContent = 'Network error.'; }
}

async function renamePile(name) {
  const from = curPile;
  const to = String(name || '').trim();
  if (!from || to === from) return;
  if (!to) { $('p-name').value = from; return; }
  if (piles().some(p => p.tag === to) && !confirm(`There is already a pile called “${to}”. Put the two together?`)) { $('p-name').value = from; return; }
  try {
    const res = await api('/api/treasury/piles', { method: 'POST', body: JSON.stringify({ tag: from, newTag: to }) });
    if (res.status === 401) { handleUnauth(); return; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { showStatus(d.error || 'Could not rename it.', true); $('p-name').value = from; return; }
    curPile = d.tag;
    try { localStorage.setItem('treasury-pile', JSON.stringify(curPile)); } catch {}
    showStatus('Renamed.', false);
    await loadPiles();
    await loadItems();
  } catch { showStatus('Network error.', true); }
}

let noteTimer = null;
function onPileNote(el) {
  autoGrow(el);
  const tag = curPile;
  if (!tag) return;
  clearTimeout(noteTimer);
  setSaveState('Saving…');
  noteTimer = setTimeout(async () => {
    noteTimer = null;
    const row = pileRows.find(r => r.tag === tag);
    if (row) row.note = el.value; else pileRows.push({ tag, note: el.value });
    try {
      const res = await api('/api/treasury/piles', { method: 'POST', body: JSON.stringify({ tag, note: el.value }) });
      setSaveState(res.ok ? 'Saved' : '');
      if (!res.ok) showStatus('The note could not be saved.', true);
    } catch { setSaveState(''); showStatus('Network error.', true); }
  }, 700);
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 200) + 'px';
}

function openPileMenu(btn) {
  const tag = curPile;
  if (tag === null) return;
  const n = inPile(tag).length;
  const t = tag === '' ? "''" : idLit(tag);
  openMenu(btn, (tag ? `<button type="button" onclick="closeMenu();$('p-name').focus();$('p-name').select()">${ico('pencil')} Rename</button>` : '')
    + `<button type="button" onclick="closeMenu();openImportModal()">${ico('arrow-down')} Import items here</button>`
    + (tag ? `<hr><button type="button" onclick="deletePile(${t}, false)">Delete pile, keep items <small>to Unsorted</small></button>` : '')
    + (n ? `<button type="button" class="bad" onclick="deletePile(${t}, true)">${ico('trash')} Delete pile and its ${n} item${n === 1 ? '' : 's'}</button>` : ''));
}

async function deletePile(tag, withItems) {
  closeMenu();
  const n = inPile(tag).length;
  const what = withItems
    ? `Delete “${pileLabel(tag)}” and the ${n} item${n === 1 ? '' : 's'} in it? This cannot be undone.`
    : `Delete the pile “${pileLabel(tag)}”? ${n ? `Its ${n} item${n === 1 ? '' : 's'} move to Unsorted.` : ''}`;
  if (!confirm(what)) return;
  try {
    const res = await api('/api/treasury/piles/delete', { method: 'POST', body: JSON.stringify({ tag, deleteItems: !!withItems }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not delete it.', true); return; }
    showStatus('Deleted.', false);
    if (curId && withItems && (byId(curId)?.tag || '') === tag) { curId = null; drawerOpen = false; }
    openPile(null);
    await loadPiles();
    await loadItems();
    await loadRequests();
  } catch { showStatus('Network error.', true); }
}

// ── The menu ─────────────────────────────────────────────────────────────────
function openMenu(anchor, html) {
  const m = $('menu');
  m.innerHTML = html;
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  m.querySelector('button')?.focus();
}
function closeMenu() { const m = $('menu'); if (m) { m.hidden = true; m.innerHTML = ''; } }
document.addEventListener('click', e => {
  if (!e.target.closest('#menu') && !e.target.closest('[aria-label^="More"]') && !e.target.closest('#p-more')) closeMenu();
});
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', e => { if (!e.target.closest?.('#menu')) closeMenu(); }, true);

function openItemMenu(btn, id) {
  const it = byId(id);
  if (!it) return;
  const I = idLit(id);
  const where = MODES.map(m => `<button type="button" class="${m === it.mode ? 'on' : ''}" onclick="closeMenu();setItemMode(${I},'${m}')">
      <i class="dot ${m}"></i>${MODE_LABEL[m]}${m === it.mode ? ' <small>now</small>' : ''}</button>`).join('');
  const others = piles().filter(p => p.tag !== (it.tag || '') && p.tag !== '');
  const move = others.map(p => `<button type="button" onclick="closeMenu();moveItems([${I}], ${idLit(p.tag)})">${esc(p.tag)}</button>`).join('')
    + ((it.tag || '') !== '' ? `<button type="button" onclick="closeMenu();moveItems([${I}], '')">${UNSORTED}</button>` : '');
  const give = chars.map(c => `<button type="button" onclick="closeMenu();giveItem(${I}, ${idLit(c.id)})">${esc(c.name)}</button>`).join('');
  openMenu(btn, `<div class="menu-h">Where it is</div>${where}`
    + (give ? `<div class="menu-h">Give one to</div><div class="menu-scroll">${give}</div>` : '')
    + (move ? `<div class="menu-h">Move to pile</div><div class="menu-scroll">${move}</div>` : '')
    + '<hr>'
    + (it.descVisible ? '' : `<button type="button" onclick="closeMenu();identifyItem(${I})">${ico('eye')} Identify</button>`)
    + `<button type="button" onclick="closeMenu();duplicateItem(${I})">Duplicate</button>`
    + `<button type="button" class="bad" onclick="closeMenu();deleteItem(${I})">${ico('trash')} Delete</button>`);
}

// ── Drag an item onto a pile ─────────────────────────────────────────────────
let dragId = null;
function itemDragStart(e, id) {
  dragId = id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', id); } catch {}
  document.body.classList.add('dragging');
}
function itemDragEnd() {
  dragId = null;
  document.body.classList.remove('dragging');
  document.querySelectorAll('.drop').forEach(el => el.classList.remove('drop'));
}
function pileDragOver(e) {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drop');
}
function pileDrop(e, tag) {
  e.preventDefault();
  e.stopPropagation();
  const id = dragId;
  itemDragEnd();
  if (id) moveItems([id], tag);
}

async function moveItems(ids, tag) {
  const list = ids.map(byId).filter(i => i && (i.tag || '') !== tag);
  if (!list.length) return;
  const before = list[0].tag || '';
  for (const i of list) i.tag = tag;
  renderAll();
  try {
    const res = await api('/api/treasury/bulk-update-tag', { method: 'POST', body: JSON.stringify({ ids: list.map(i => i.id), tag }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) throw new Error('refused');
    if (list.length === 1) lastUndo = { id: list[0].id, before: { tag: before }, label: `${list[0].name} to ${pileLabel(tag)}` };
    renderUndo();
    showStatus(`Moved to ${pileLabel(tag)}.`, false);
  } catch { showStatus('Could not move it.', true); }
  await loadItems();
}

// ── Give a whole pile ────────────────────────────────────────────────────────
function charOptions(blank) {
  return `<option value="">${blank}</option>` + chars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

function openGiveModal() {
  if (curPile === null) return;
  const list = byName(inPile(curPile)).filter(i => giveQty(i) > 0);
  if (!list.length) { showStatus('There is nothing left in this pile to give.', true); return; }
  if (!chars.length) { showStatus('There are no characters to give it to.', true); return; }
  $('gm-title').textContent = `Give ${pileLabel(curPile)}`;
  $('gm-all').innerHTML = charOptions('Choose a character…');
  $('gm-err').textContent = '';
  $('gm-rows').innerHTML = list.map(i => `<tr data-id="${esc(i.id)}">
      <td><b>${esc(i.name)}</b>${i.descVisible ? '' : ' <span class="chip unid">Unidentified</span>'}</td>
      <td class="c-num"><input type="number" class="gm-qty" min="1" max="${i.quantity === -1 ? 100 : giveQty(i)}" value="${giveQty(i)}" aria-label="How many"></td>
      <td><select class="gm-to" aria-label="Give to">${charOptions('Nobody')}</select></td>
    </tr>`).join('');
  $('give-modal').style.display = 'flex';
}
function closeGiveModal() { $('give-modal').style.display = 'none'; }
function giveAllTo(charId) {
  document.querySelectorAll('#gm-rows .gm-to').forEach(s => { s.value = charId; });
}

async function runGivePile() {
  const grants = [];
  for (const tr of document.querySelectorAll('#gm-rows tr')) {
    const charId = tr.querySelector('.gm-to').value;
    if (!charId) continue;
    const q = parseInt(tr.querySelector('.gm-qty').value);
    if (!Number.isInteger(q) || q < 1 || q > 100) { $('gm-err').textContent = 'How many is a whole number from 1 to 100.'; return; }
    grants.push({ itemId: tr.dataset.id, charId, quantity: q });
  }
  if (!grants.length) { $('gm-err').textContent = 'Choose who gets what first.'; return; }
  for (const g of grants) await flushSave(g.itemId);
  $('gm-go').disabled = true;
  try {
    const res = await api('/api/treasury/give-many', { method: 'POST', body: JSON.stringify({ grants }) });
    if (res.status === 401) { handleUnauth(); return; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { $('gm-err').textContent = d.error || 'Could not hand it over.'; return; }
    closeGiveModal();
    const who = new Set(grants.map(g => g.charId)).size;
    showStatus(`Gave ${grants.length} item${grants.length === 1 ? '' : 's'} to ${who === 1 ? chars.find(c => c.id === grants[0].charId)?.name || 'them' : who + ' characters'}.`, false);
    ledgerRows = null;
    await loadItems();
    await loadRequests();
  } catch { $('gm-err').textContent = 'Network error.'; }
  finally { $('gm-go').disabled = false; }
}

// ── Pile selects (editor, import) ────────────────────────────────────────────
// A select rather than free text; "+ New pile…" reveals a box for a fresh one.
function fillTagSelect(prefix, current) {
  const sel = $(prefix + '-sel');
  if (!sel || sel.value === NEW_TAG) return;
  const cur = current !== undefined ? current : sel.value;
  const known = piles().map(p => p.tag).filter(Boolean);
  if (cur && !known.includes(cur)) known.push(cur);
  sel.innerHTML = `<option value="">— ${UNSORTED} —</option>`
    + known.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
    + `<option value="${NEW_TAG}">+ New pile…</option>`;
  sel.value = cur || '';
  const inp = $(prefix + '-new');
  if (inp && current !== undefined) { inp.style.display = 'none'; inp.value = ''; }
}
function tagPickValue(prefix) {
  const sel = $(prefix + '-sel');
  if (!sel) return '';
  if (sel.value !== NEW_TAG) return sel.value;
  return ($(prefix + '-new')?.value || '').trim();
}
function onTagPick(prefix) {
  const sel = $(prefix + '-sel'), inp = $(prefix + '-new');
  if (!sel || !inp) return;
  const isNew = sel.value === NEW_TAG;
  inp.style.display = isNew ? '' : 'none';
  if (isNew) { inp.value = ''; setTimeout(() => inp.focus(), 0); }
}

// ── The editor ───────────────────────────────────────────────────────────────
function openItem(id, focusName) {
  const it = byId(id);
  if (!it) return;
  closeMenu();
  curId = id;
  drawerOpen = true;
  // Opening an item from the banner or a search shows its pile behind it.
  if (curPile !== (it.tag || '')) openPile(it.tag || '');
  else renderMain();
  $('sect-history').open = false;
  renderDrawer(true);
  if (focusName) setTimeout(() => { $('d-name').focus(); $('d-name').select(); }, 0);
}

function closeDrawer() {
  drawerOpen = false;
  renderDrawer();
  renderMain();
}

// `force` refills every field (a different item was opened). Otherwise a field
// the DM is typing in is left alone, so a refresh from the server never fights
// the keyboard.
function renderDrawer(force) {
  const el = $('drawer');
  if (!el) return;
  const it = drawerOpen ? byId(curId) : null;
  el.classList.toggle('open', !!it);
  if (!it) return;
  fillDrawer(it, force);
  renderUndo();
}

function fillDrawer(it, force) {
  if (!it) return;
  const set = (id, value, prop = 'value') => {
    const f = $(id);
    if (!f || (!force && document.activeElement === f)) return;
    f[prop] = value;
  };
  set('d-name', it.name || '');
  set('f-unid-name', it.unidName || '');
  set('f-desc', it.description || '');
  if (force || document.activeElement !== $('f-tag-new')) fillTagSelect('f-tag', it.tag || '');
  set('f-price', it.valueCp ? cpToGp(it.valueCp) : '');
  set('f-qty', stockText(it.quantity ?? 1));
  if (force) { $('price-help').textContent = ''; $('qty-help').textContent = ''; }
  set('f-armor-type', it.armorType || 'light');
  set('f-ac-base', it.acBase ?? 10);
  set('f-weapon-atk', it.weaponAtk || '0');
  set('f-weapon-dmg', it.weaponDmg || '');
  set('f-ac-bonus', it.acBonus ?? 0);
  set('f-init-bonus', it.initBonus ?? 0);
  set('f-speed-bonus', it.speedBonus ?? 0);
  set('f-sp-atk-bonus', it.spellAtkBonus ?? 0);
  set('f-sp-dc-bonus', it.spellDcBonus ?? 0);
  set('f-attune', !!it.requiresAttunement, 'checked');
  set('f-charges', it.charges || 0);
  set('f-charges-long', it.chargesRecharge === 'long', 'checked');
  setSelectedProps(it.weaponProperties || []);

  $('d-kinds').innerHTML = KINDS.map(k =>
    `<button type="button" class="${k.key === it.itemType ? 'on' : ''}" onclick="setKind('${k.key}')">${k.label}</button>`).join('');
  $('d-mode').innerHTML = MODES.map(m =>
    `<button type="button" class="${m === it.mode ? 'on ' + m : ''}" onclick="setItemMode(${idLit(it.id)},'${m}')">${MODE_LABEL[m]}</button>`).join('');
  $('d-mode-help').textContent = (MODE_HELP[it.mode] || '') + (it.mode === 'shop' && !shopIsOpen ? ' The shop is closed right now.' : '');
  for (const s of ['weapon', 'armor', 'bonuses', 'charges']) {
    const d = $('sect-' + s);
    const shown = sectionShown(it, s);
    d.hidden = !shown;
    if (force) d.open = shown;
  }
  $('d-identify').style.display = it.descVisible ? 'none' : '';
  $('d-unid').hidden = !!it.descVisible;
  $('d-idd').hidden = !it.descVisible;

  const asks = asksFor(it.id);
  $('d-asks-wrap').hidden = asks.length === 0;
  $('d-asks').innerHTML = askRowsHTML(it);
  setImagePreview(it.imageMedium || it.imageUrl);
  renderGive();
  if (force && $('sect-history').open) renderHistory();
}

// One handler for every plain field in the editor: the field names the item
// property it edits in data-f.
function onField(el) {
  if (!curId) return;
  const key = el.dataset.f;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number') value = parseInt(el.value) || 0;
  else value = el.value;
  if (key === 'chargesRecharge') value = el.checked ? 'long' : '';
  if (key === 'charges') value = Math.max(0, Math.min(999, value));
  const it = byId(curId);
  queueSave(curId, { [key]: value }, { now: el.type === 'checkbox' || el.tagName === 'SELECT', label: `${it ? it.name : 'item'} ${el.dataset.label || key}` });
  if (key === 'name' || key === 'unidName' || key === 'charges' || key === 'acBase' || key === 'acBonus') renderMain();
}

// The weapon's magic bonus is stored as text ("1"), so its number box is saved
// as it is typed rather than as a number.
function onFieldText(el) {
  if (!curId) return;
  queueSave(curId, { [el.dataset.f]: String(el.value).trim() }, { label: el.dataset.label });
  renderMain();
}

function onPrice(el) {
  if (!curId) return;
  const cp = parsePrice(el.value);
  const help = $('price-help');
  if (cp === null) { help.textContent = 'Try “50”, “7 sp” or “2 pp 5 gp”.'; help.classList.add('bad'); return; }
  help.classList.remove('bad');
  help.textContent = cp && !/^\s*\d+\s*(gp)?\s*$/i.test(el.value) ? '= ' + cpToGp(cp) : '';
  if (cp === (byId(curId)?.valueCp || 0)) return;
  queueSave(curId, { valueCp: cp }, { label: 'price' });
  renderMain();
}

function onStock(el) {
  if (!curId) return;
  const q = parseStock(el.value);
  const help = $('qty-help');
  if (q === null) { help.textContent = 'A whole number, or ∞.'; help.classList.add('bad'); return; }
  help.classList.remove('bad');
  help.textContent = q === 0 ? 'None left: players no longer see it.' : '';
  if (q === byId(curId)?.quantity) return;
  queueSave(curId, { quantity: q }, { label: 'stock' });
  renderMain();
}

function onDrawerTag() {
  onTagPick('f-tag');
  if ($('f-tag-sel').value === NEW_TAG) return;      // wait for the new name to be typed
  commitDrawerTag();
}
function commitDrawerTag() {
  if (!curId) return;
  const tag = tagPickValue('f-tag');
  const it = byId(curId);
  if (!it || (it.tag || '') === tag) return;
  queueSave(curId, { tag }, { now: true, label: `${it.name} pile` });
  // Follow the item, or it would vanish from the list the moment it moves.
  openPile(tag);
  renderAll();
}

function setItemMode(id, mode) {
  const it = byId(id);
  if (!it || it.mode === mode) return;
  const losing = mode !== 'loot' ? asksFor(id).length : 0;
  if (losing && !confirm(`${losing} player${losing === 1 ? ' is' : 's are'} asking for “${it.name}”. Moving it turns ${losing === 1 ? 'them' : 'them all'} down. Go ahead?`)) return;
  queueSave(id, { mode }, { now: true, label: `${it.name} → ${MODE_LABEL[mode]}` });
  renderAll();
  if (losing) setTimeout(loadRequests, 600);
}

async function identifyItem(id) {
  const it = byId(id);
  if (!it || it.descVisible) return;
  if (!confirm(`Identify "${it.name}"?\n\nPlayers will see its real name, description and properties, on every copy they hold. This cannot be undone.`)) return;
  queueSave(id, { descVisible: true }, { now: true });
  renderAll();
}

// Picking a kind shows that kind's fields. A potion is something you use up,
// so it starts with one charge.
function setKind(kind) {
  const it = byId(curId);
  if (!it || it.itemType === kind) return;
  const patch = { itemType: kind };
  if (kind === 'potion' && !it.charges) patch.charges = 1;
  queueSave(curId, patch, { now: true, label: `${it.name} kind` });
  fillDrawer(it, true);
  renderMain();
}

// ── Weapon properties ────────────────────────────────────────────────────────
function propId(p) { return 'prop-' + p.replace(/[^a-zA-Z]/g, '').toLowerCase(); }
function initPropsGrid() {
  const grid = $('props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = WEAPON_PROPS.map(p =>
    `<label><input type="checkbox" id="${propId(p)}" value="${p}" onchange="onPropChange()">${p}</label>`).join('');
}
function getSelectedProps() { return WEAPON_PROPS.filter(p => $(propId(p))?.checked); }
function setSelectedProps(props) {
  WEAPON_PROPS.forEach(p => { const el = $(propId(p)); if (el) el.checked = Array.isArray(props) && props.includes(p); });
  updatePropsLimit();
}
function onPropChange() {
  const sel = getSelectedProps();
  if (sel.length > 3) $(propId(sel[sel.length - 1])).checked = false;
  updatePropsLimit();
  if (curId) queueSave(curId, { weaponProperties: getSelectedProps() }, { now: true, label: 'weapon properties' });
}
function updatePropsLimit() {
  const atMax = getSelectedProps().length >= 3;
  WEAPON_PROPS.forEach(p => { const el = $(propId(p)); if (el) el.disabled = atMax && !el.checked; });
}

// ── Add, duplicate, delete, give ─────────────────────────────────────────────
async function createItem() {
  // A new item lands in the pile on show, hidden until the DM decides.
  const tag = curPile || '';
  try {
    const res = await api('/api/treasury', { method: 'POST', body: JSON.stringify({ name: 'New item', mode: 'hidden', tag }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not add an item.', true); return; }
    const { id } = await res.json();
    $('p-search').value = '';
    await loadItems();
    if (byId(id)) openItem(id, true);
  } catch { showStatus('Network error.', true); }
}

async function duplicateItem(id) {
  const it = byId(id || curId);
  if (!it) return;
  await flushSave(it.id);
  try {
    const res = await api(`/api/treasury/${it.id}/duplicate`, { method: 'POST' });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not duplicate it.', true); return; }
    const d = await res.json();
    await loadItems();
    showStatus('Copied. The copy is hidden until you move it.', false);
    if (byId(d.id)) openItem(d.id, true);
  } catch { showStatus('Network error.', true); }
}

async function deleteItem(id) {
  const it = byId(id || curId);
  if (!it) return;
  if (!confirm(`Delete “${it.name}”? This cannot be undone.`)) return;
  pending.delete(it.id);
  try {
    const res = await api(`/api/treasury/${it.id}`, { method: 'DELETE' });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not delete it.', true); return; }
    if (lastUndo && lastUndo.id === it.id) lastUndo = null;
    showStatus('Deleted.', false);
    if (curId === it.id) { curId = null; drawerOpen = false; }
    await loadItems();
    await loadRequests();
  } catch { showStatus('Network error.', true); }
}

function renderGive() {
  const sel = $('d-give-char');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = charOptions('Give to…');
  sel.value = chars.some(c => c.id === cur) ? cur : '';
}

// From the editor (who comes from its select) or the item menu (who is given).
async function giveItem(id, charIdArg) {
  const it = byId(id || curId);
  const charId = charIdArg || $('d-give-char').value;
  if (!it) return;
  if (!charId) { showStatus('Choose who gets it first.', true); $('d-give-char').focus(); return; }
  await flushSave(it.id);
  try {
    const res = await api(`/api/treasury/${it.id}/give`, { method: 'POST', body: JSON.stringify({ charId, quantity: 1 }) });
    if (res.status === 401) { handleUnauth(); return; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { showStatus(d.error || 'Could not hand it over.', true); return; }
    const who = chars.find(c => c.id === charId)?.name || 'them';
    showStatus(`Gave ${it.name} to ${who}.`, false);
    ledgerRows = null;
    await loadItems();
    await loadRequests();
    if (drawerOpen && $('sect-history').open) renderHistory();
  } catch { showStatus('Network error.', true); }
}

// ── Picture ──────────────────────────────────────────────────────────────────
const MAX_IMG_BYTES = 25 * 1024 * 1024;
const OK_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function setImagePreview(src) {
  const img = $('img-preview'), zone = $('img-zone'), acts = $('img-actions');
  if (!img) return;
  if (src) { if (img.getAttribute('src') !== src) img.src = src; img.style.display = ''; zone.style.display = 'none'; acts.style.display = ''; }
  else { img.removeAttribute('src'); img.style.display = 'none'; zone.style.display = ''; acts.style.display = 'none'; }
}
function handleImgDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag');
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadImage(file);
}
function handleImgPick(input) {
  const file = input.files?.[0];
  input.value = '';           // let the same file be picked again after a remove
  if (file) uploadImage(file);
}

async function uploadImage(file) {
  const errEl = $('img-err');
  errEl.textContent = '';
  const id = curId;
  if (!id) return;
  // Check locally so the answer is instant instead of a refusal from the server.
  if (!OK_IMG.includes(file.type)) { errEl.textContent = 'Pictures only (JPEG, PNG, GIF, WebP).'; return; }
  if (file.size > MAX_IMG_BYTES) { errEl.textContent = 'That picture is larger than 25 MB.'; return; }
  errEl.textContent = 'Uploading…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });
    const res = await api('/api/treasury/media', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { errEl.textContent = data.error || 'Upload failed.'; return; }
    // Saved straight away: a picture that is shown but not stored would be lost,
    // and its file left behind.
    const save = await api(`/api/treasury/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ imageUrl: data.url, imageThumb: data.thumb, imageMedium: data.medium }),
    });
    if (!save.ok) { errEl.textContent = 'The picture uploaded but could not be saved.'; return; }
    errEl.textContent = '';
    await loadItems();
  } catch { errEl.textContent = 'Network error.'; }
}

async function removeImage() {
  if (!curId) return;
  try {
    const res = await api(`/api/treasury/${curId}`, { method: 'PUT', body: JSON.stringify({ imageUrl: '', imageThumb: '', imageMedium: '' }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not remove the picture.', true); return; }
    await loadItems();
  } catch { showStatus('Network error.', true); }
}

// ── History ──────────────────────────────────────────────────────────────────
async function loadLedger() {
  try {
    const res = await api('/api/treasury/logs');
    if (res.status === 401) { handleUnauth(); return null; }
    if (!res.ok) return null;
    ledgerRows = await res.json();
    return ledgerRows;
  } catch { return null; }
}

function ledgerRowHTML(r, withItem) {
  const raw = String(r.at || '');
  const dt = new Date(raw + (raw && !raw.endsWith('Z') && raw.includes('T') ? 'Z' : ''));
  const when = isNaN(dt) ? esc(raw) : `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `<tr>
    <td class="muted nowrap">${when}</td>
    <td><span class="badge ${r.type}">${r.type === 'claim' ? 'Given' : 'Bought'}</span></td>
    <td><strong>${esc(r.charName)}</strong></td>
    ${withItem ? `<td>${esc(r.itemName)}</td>` : ''}
    <td class="c-num">${esc(r.qty)}</td>
    <td class="c-num gold">${r.type === 'claim' ? '—' : cpToGp(r.totalCp)}</td>
  </tr>`;
}

async function renderHistory() {
  const el = $('d-history');
  if (!el || !curId) return;
  if (!ledgerRows) { el.innerHTML = '<div class="muted">Loading…</div>'; await loadLedger(); }
  const rows = (ledgerRows || []).filter(r => r.itemId === curId);
  el.innerHTML = rows.length
    ? `<table class="mini"><tbody>${rows.map(r => ledgerRowHTML(r, false)).join('')}</tbody></table>`
    : '<div class="muted">Nobody has been given or has bought this item yet.</div>';
}

async function openLedger() {
  $('ledger-modal').style.display = 'flex';
  const body = $('ledger-body');
  body.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
  const rows = await loadLedger();
  if (!rows) { body.innerHTML = '<tr><td colspan="6" class="bad">Could not load the ledger.</td></tr>'; return; }
  body.innerHTML = rows.length
    ? rows.map(r => ledgerRowHTML(r, true)).join('')
    : '<tr><td colspan="6" class="muted">Nothing given or bought yet.</td></tr>';
}
function closeLedger() { $('ledger-modal').style.display = 'none'; }

// ── Import ───────────────────────────────────────────────────────────────────
function openImportModal() {
  $('import-text').value = '';
  $('import-status').textContent = '';
  fillTagSelect('import-tag', curPile || '');
  $('import-modal').style.display = 'flex';
  setTimeout(() => $('import-text').focus(), 50);
}
function closeImportModal() { $('import-modal').style.display = 'none'; }

async function runImport() {
  const text = $('import-text').value.trim();
  const statusEl = $('import-status');
  statusEl.className = 'bad';
  if (!text) { statusEl.textContent = 'Paste some items first.'; return; }
  const tag = tagPickValue('import-tag');
  try {
    const res = await api('/api/treasury/import', {
      method: 'POST',
      body: JSON.stringify({ text, tag, mode: $('import-mode').value }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { statusEl.textContent = data.error || 'Import failed.'; return; }
    closeImportModal();
    showStatus(`Imported ${data.count} item${data.count !== 1 ? 's' : ''}.`, false);
    await loadItems();
    openPile(tag);
  } catch { statusEl.textContent = 'Network error.'; }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
// Esc steps back one level: menu, dialog, editor, pile. / finds, N adds.
document.addEventListener('keydown', e => {
  if (!masterPw) return;
  const modalOpen = ['import-modal', 'ledger-modal', 'pile-modal', 'give-modal'].find(id => $(id).style.display !== 'none');
  if (e.key === 'Escape') {
    if (!$('menu').hidden) return closeMenu();
    if (modalOpen) return { 'import-modal': closeImportModal, 'ledger-modal': closeLedger, 'pile-modal': closePileModal, 'give-modal': closeGiveModal }[modalOpen]();
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.closest('#drawer, .tools, #pile')) return document.activeElement.blur();
    if (drawerOpen) return closeDrawer();
    if (curPile !== null) return openPile(null);
    return;
  }
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && lastUndo) { e.preventDefault(); undoLast(); }
    return;
  }
  if (modalOpen) return;
  if (e.key === '/') { e.preventDefault(); const s = curPile === null ? $('search') : $('p-search'); s.focus(); s.select(); }
  else if (e.key.toLowerCase() === 'n' && curPile !== null) { e.preventDefault(); createItem(); }
});

// A change still waiting to be sent would be lost by leaving the page.
window.addEventListener('beforeunload', e => {
  if (pending.size || noteTimer) { e.preventDefault(); e.returnValue = ''; }
});

// ── Auto-auth from the stored session ────────────────────────────────────────
// A tab already logged in as DM unlocks without asking again, once the server
// confirms the session is still live.
_gate.start();

// ── Real-time ────────────────────────────────────────────────────────────────
// connectRealtime() comes from the shared /js/lib/realtime.js (loaded first).
connectRealtime({
  notification: (p) => { typeof handleNotification === 'function' && handleNotification(p); },
  treasury: async (data) => {
    if (!masterPw) return;
    if (data.action === 'statusChanged') { shopIsOpen = data.isOpen; renderAll(); return; }
    if (data.action === 'piles' || data.action === 'bulk-updated' || data.action === 'reload') await loadPiles();
    loadItems();
    if (['requested', 'approved', 'declined', 'deleted', 'updated', 'bulk-updated', 'reload'].includes(data.action)) loadRequests();
    if (['approved', 'claimed', 'purchase'].includes(data.action)) {
      ledgerRows = null;
      if (drawerOpen && $('sect-history').open) renderHistory();
    }
  },
  characters: () => { if (masterPw) loadChars(); },
});
