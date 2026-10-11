// Written by Irmak Hakman — 2026-10-11 23:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Treasury — the DM's catalogue of everything players can find, ask for or buy.
 *
 * One table, one tag at a time. A row shows where an item is (hidden, free
 * loot, shop), its price, its stock, whether it is identified and who is asking
 * for it — and all of those change in the row. Everything else about an item
 * lives in the drawer on the right. There is no Save button: a change is saved
 * as it is made, and the last one can be undone.
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
  loot:   'Players ask for it and you decide who gets it.',
  shop:   'For sale while the shop is open and its tag is on sale.',
};
const WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

// The views of the tag picker that are not a tag. A real tag is its own name;
// '' is "no tag".
const VIEW_ALL = '\u0001all';
const VIEW_ASKED = '\u0001asked';

// Kinds of item. Picking one decides which groups of fields the drawer shows.
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
function cpToDenoms(cp) {
  let r = cp;
  const pp = Math.floor(r / 1000); r -= pp * 1000;
  const gp = Math.floor(r / 100);  r -= gp * 100;
  const ep = Math.floor(r / 50);   r -= ep * 50;
  const sp = Math.floor(r / 10);   r -= sp * 10;
  return { pp, gp, ep, sp, cp: r };
}
const COIN_CP = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

// A price typed in a table cell: "50", "50 gp", "7sp", "2 pp 5 gp", "12.5".
// A bare number is gold. Returns copper, or null when it is not a price.
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
// Stock typed in a cell: a whole number, or ∞ / "unlimited" / -1 for no limit.
function parseStock(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase();
  if (s === '∞' || s === 'inf' || s === 'unlimited' || s === '-1') return -1;
  if (!/^\d+$/.test(s)) return null;
  return Math.min(99999, parseInt(s));
}

// ── What is on show ──────────────────────────────────────────────────────────
// view: a tag name, '' (no tag), VIEW_ALL or VIEW_ASKED.
function itemsInView(items, { view, mode, q, askedIds }) {
  const needle = String(q || '').trim().toLowerCase();
  return (items || []).filter(i => {
    if (view === VIEW_ASKED) { if (!askedIds || !askedIds.has(i.id)) return false; }
    else if (view !== VIEW_ALL && (i.tag || '') !== view) return false;
    if (mode && mode !== 'all' && i.mode !== mode) return false;
    if (!needle) return true;
    return [i.name, i.unidName, i.description, i.tag].some(v => String(v || '').toLowerCase().includes(needle));
  });
}

function sortItems(list, key, dir, askCount) {
  const val = {
    name:  i => String(i.name || '').toLowerCase(),
    mode:  i => MODES.indexOf(i.mode),
    price: i => i.valueCp || 0,
    stock: i => (i.quantity === -1 ? Infinity : (i.quantity ?? 0)),
    state: i => (i.descVisible ? 1 : 0),
    asked: i => (askCount ? askCount(i.id) : 0),
  }[key] || (i => String(i.name || '').toLowerCase());
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (dir === 'desc' ? -c : c) || byName(a, b);
  });
}

// The tag picker's entries: every tag in use, with how many items it holds and
// whether any of them can be bought right now.
function tagEntries(items, shopOpen, activeTags) {
  const map = new Map();
  for (const i of items || []) {
    const t = i.tag || '';
    if (!map.has(t)) map.set(t, { tag: t, count: 0, forSale: 0 });
    const e = map.get(t);
    e.count++;
    if (i.mode === 'shop') e.forSale++;
  }
  const open = t => !!shopOpen && (!activeTags || activeTags.length === 0 || activeTags.includes(t));
  return [...map.values()]
    .map(e => ({ ...e, onSale: e.forSale > 0 && open(e.tag) }))
    .sort((a, b) => (!a.tag && b.tag ? 1 : a.tag && !b.tag ? -1 : a.tag.localeCompare(b.tag)));
}

// Clicking a tag in the shop strip. An empty list means the whole shop is on
// sale; taking the last tag off goes back to that rather than to "nothing".
function shopTagsAfterToggle(active, tag) {
  const cur = Array.isArray(active) ? active : [];
  return cur.includes(tag) ? cur.filter(t => t !== tag) : [...cur, tag];
}

// ── Page state ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

let masterPw   = '';
let items      = [];
let requests   = [];          // pending free-loot requests
let chars      = [];          // characters, for "Give to"
let ledgerRows = null;        // claim + purchase history, loaded when first needed
let shopIsOpen = true;
let shopActiveTags = [];      // empty = the whole shop is on sale

let view       = VIEW_ALL;    // the tag on show
let modeFilter = 'all';
let sortKey    = 'name', sortDir = 'asc';
let curId      = null;        // the row the keyboard is on
let drawerOpen = false;
let drawerTab  = 'basics';
let checked    = new Set();   // ticked rows, for the bulk bar
let openAsks   = new Set();   // rows whose requests are unfolded
let editing    = null;        // { id, key } while a table cell is being typed in
let renderDue  = false;       // a refresh arrived mid-edit and is waiting

const NEW_TAG = '__new_tag__';

try { view = localStorage.getItem('treasury-view') ?? VIEW_ALL; } catch {}

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
const askedIds = () => new Set(requests.map(r => r.itemId));
const idLit = id => `'${escJs(id)}'`;

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
    fixView();
    renderAll();
    await Promise.all([loadShopStatus(), loadRequests(), loadChars()]);
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
    fixView();
    renderAll();
  } catch { showStatus('Network error.', true); }
}

async function loadChars() {
  try {
    const res = await api('/api/characters');
    if (res.ok) chars = (await res.json()).map(c => ({ id: c.id, name: c.name || 'Unnamed' }));
  } catch {}
  renderGive();
}

async function refreshAll() {
  await loadItems();
  await Promise.all([loadShopStatus(), loadRequests(), loadChars()]);
  ledgerRows = null;
  if (drawerOpen && drawerTab === 'history') renderHistory();
  showStatus('Refreshed.', false);
}

// A remembered tag can vanish (its last item moved or deleted); fall back to
// everything rather than showing an empty table.
function fixView() {
  if (view === VIEW_ALL || view === VIEW_ASKED) return;
  if (!items.some(i => (i.tag || '') === view)) view = VIEW_ALL;
}

function renderAll() {
  renderShopStrip();
  renderTagButton();
  renderModeFilter();
  renderTable();
  renderDrawer();
  renderBulkBar();
  renderAskCount();
}

// ── Saving: as you go, with one step of undo ─────────────────────────────────
// A change is applied to the page at once and sent a moment later, so a burst
// of typing is one save. `before` remembers what the fields held, which is what
// Undo puts back.
const pending = new Map();    // itemId -> { patch, before, timer, label }
let lastUndo = null;          // { id, before, label }

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
  const { id, before } = lastUndo;
  lastUndo = null;
  renderUndo();
  const it = byId(id);
  if (!it) return;
  Object.assign(it, before);
  try {
    const res = await api(`/api/treasury/${id}`, { method: 'PUT', body: JSON.stringify(before) });
    if (!res.ok) throw new Error('refused');
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

// ── Shop strip ───────────────────────────────────────────────────────────────
async function loadShopStatus() {
  try {
    const res = await api('/api/treasury/status');
    if (!res.ok) return;
    const d = await res.json();
    shopIsOpen = d.isOpen;
    shopActiveTags = d.activeTags || (d.activeTag ? [d.activeTag] : []);
    renderShopStrip();
    renderTagButton();
  } catch {}
}

async function setShopStatus(isOpen, activeTags) {
  try {
    const res = await api('/api/treasury/status', {
      method: 'PUT',
      body: JSON.stringify({ isOpen, activeTags: activeTags || [] }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not change the shop.', true); return; }
    const d = await res.json();
    shopIsOpen = d.isOpen;
    shopActiveTags = d.activeTags || [];
    renderShopStrip();
    renderTagButton();
  } catch { showStatus('Network error.', true); }
}

function renderShopStrip() {
  const el = $('shop-strip');
  if (!el) return;
  const tags = tagEntries(items, true, []).filter(e => e.tag && (e.forSale > 0 || shopActiveTags.includes(e.tag)));
  const everything = shopActiveTags.length === 0;
  let html = `<button type="button" class="shop-switch${shopIsOpen ? ' open' : ''}" onclick="setShopStatus(${!shopIsOpen}, shopActiveTags)"
      title="${shopIsOpen ? 'Close the shop — players stop seeing it' : 'Open the shop'}">
      <span class="dot"></span>${shopIsOpen ? 'Shop open' : 'Shop closed'}</button>`;
  if (shopIsOpen) {
    html += `<span class="strip-lbl">On sale:</span>`
      + `<button type="button" class="chip${everything ? ' on' : ''}" onclick="setShopStatus(true, [])" title="Every shop item, whatever its tag">Everything</button>`
      + tags.map(e => `<button type="button" class="chip${shopActiveTags.includes(e.tag) ? ' on' : ''}"
            onclick="setShopStatus(true, shopTagsAfterToggle(shopActiveTags, '${escJs(e.tag)}'))"
            title="${shopActiveTags.includes(e.tag) ? 'Take this tag off sale' : 'Sell only the chosen tags'}">${esc(e.tag)} <small>${e.forSale}</small></button>`).join('');
  } else {
    html += `<span class="strip-lbl">Players cannot see the shop.</span>`;
  }
  el.innerHTML = html;
}

// ── Tag picker ───────────────────────────────────────────────────────────────
function viewLabel(v) {
  if (v === VIEW_ALL) return 'All items';
  if (v === VIEW_ASKED) return 'Asked for';
  return v || 'No tag';
}

function renderTagButton() {
  const btn = $('tag-btn');
  if (!btn) return;
  const shown = itemsInView(items, { view, mode: 'all', q: '', askedIds: askedIds() });
  const entry = tagEntries(items, shopIsOpen, shopActiveTags).find(e => e.tag === view);
  btn.innerHTML = `${entry && entry.onSale ? '<i class="sale" title="On sale in the shop"></i>' : ''}`
    + `<span>${esc(viewLabel(view))}</span><small>${shown.length}</small><span class="caret">▾</span>`;
  if ($('tag-menu').classList.contains('open')) renderTagMenu();
}

function renderTagMenu() {
  const q = ($('tag-q').value || '').trim().toLowerCase();
  const entries = tagEntries(items, shopIsOpen, shopActiveTags);
  const row = (v, label, count, onSale) => `<button type="button" class="${v === view ? 'on' : ''}" onclick="setView('${escJs(v)}')">`
    + `${onSale ? '<i class="sale" title="On sale in the shop"></i>' : ''}<span>${esc(label)}</span><small>${count}</small></button>`;
  const tags = entries.filter(e => e.tag && (!q || e.tag.toLowerCase().includes(q)));
  const noTag = entries.find(e => !e.tag);
  let html = tags.map(e => row(e.tag, e.tag, e.count, e.onSale)).join('');
  if (!tags.length) html += `<div class="menu-empty">${q ? 'No tag matches.' : 'No tags yet.'}</div>`;
  if (!q) {
    html += '<hr>';
    if (noTag) html += row('', 'No tag', noTag.count, noTag.onSale);
    html += row(VIEW_ALL, 'All items', items.length, false);
    if (requests.length) html += row(VIEW_ASKED, 'Asked for', askedIds().size, false);
  }
  $('tag-list').innerHTML = html;
}

function toggleTagMenu(open) {
  const menu = $('tag-menu');
  const want = open === undefined ? !menu.classList.contains('open') : open;
  menu.classList.toggle('open', want);
  $('tag-btn').setAttribute('aria-expanded', want ? 'true' : 'false');
  if (want) { $('tag-q').value = ''; renderTagMenu(); setTimeout(() => $('tag-q').focus(), 0); }
}

function setView(v) {
  view = v;
  try { localStorage.setItem('treasury-view', v); } catch {}
  toggleTagMenu(false);
  checked.clear();
  renderAll();
}

document.addEventListener('click', e => {
  if (!e.target.closest('#tag-dd')) $('tag-menu')?.classList.remove('open');
});

// ── Toolbar ──────────────────────────────────────────────────────────────────
function renderModeFilter() {
  const el = $('mode-filter');
  if (!el) return;
  const inView = itemsInView(items, { view, mode: 'all', q: $('search').value, askedIds: askedIds() });
  const n = m => (m === 'all' ? inView.length : inView.filter(i => i.mode === m).length);
  el.innerHTML = ['all', ...MODES].map(m =>
    `<button type="button" class="${m === modeFilter ? 'on ' + m : ''}" onclick="setModeFilter('${m}')">${m === 'all' ? 'All' : MODE_LABEL[m]} <small>${n(m)}</small></button>`).join('');
}
function setModeFilter(m) { modeFilter = m; renderModeFilter(); renderTable(); }
function onSearch() { renderModeFilter(); renderTable(); }

function visibleItems() {
  const list = itemsInView(items, { view, mode: modeFilter, q: $('search').value, askedIds: askedIds() });
  return sortItems(list, sortKey, sortDir, id => asksFor(id).length);
}

function setSort(key) {
  if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortKey = key; sortDir = 'asc'; }
  renderTable();
}

// ── The table ────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'name',  label: 'Item' },
  { key: 'mode',  label: 'Where it is' },
  { key: 'price', label: 'Price' },
  { key: 'stock', label: 'Stock' },
  { key: 'state', label: 'State' },
  { key: 'asked', label: 'Requests' },
];

function askRowsHTML(it) {
  return asksFor(it.id).map(r => `<div class="ask">
      <strong>${esc(r.charName) || 'Unknown'}</strong><span class="ask-when">${whenText(r.requestedAt)}</span>
      <span class="sp"></span>
      <button type="button" class="btn sm ok" onclick="decideRequest(${idLit(r.id)},'approve')" title="Give it to this character">Give</button>
      <button type="button" class="btn sm" onclick="decideRequest(${idLit(r.id)},'decline')" title="Turn this request down">Decline</button>
    </div>`).join('');
}

function rowHTML(it) {
  const asks = asksFor(it.id);
  const open = asks.length && (view === VIEW_ASKED || openAsks.has(it.id));
  const thumb = it.imageThumb
    ? `<img class="thumb" src="${esc(it.imageThumb)}" alt="">`
    : `<span class="thumb ph"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-square"></use></svg></span>`;
  const seg = MODES.map(m => `<button type="button" class="${m === it.mode ? 'on ' + m : ''}" title="${MODE_HELP[m]}"
      onclick="event.stopPropagation();setItemMode(${idLit(it.id)},'${m}')">${MODE_LABEL[m]}</button>`).join('');
  const cell = (key, text, cls) => (editing && editing.id === it.id && editing.key === key
    ? `<input class="cell-in" id="cell-in" value="${esc(text)}" onclick="event.stopPropagation()"
         onkeydown="cellKey(event)" onblur="commitCell()">`
    : `<button type="button" class="cell ${cls || ''}" title="Click to change" onclick="event.stopPropagation();editCell(${idLit(it.id)},'${key}')">${esc(text)}</button>`);
  const price = it.mode === 'shop' || it.valueCp ? cpToGp(it.valueCp || 0) : '—';
  const gone = it.quantity === 0;
  const main = `<tr class="row${it.id === curId ? ' cur' : ''}${checked.has(it.id) ? ' ticked' : ''}" data-id="${esc(it.id)}" onclick="openItem(${idLit(it.id)})">
      <td class="c-chk"><input type="checkbox" ${checked.has(it.id) ? 'checked' : ''} aria-label="Select ${esc(it.name)}"
            onclick="event.stopPropagation();toggleChecked(${idLit(it.id)})"></td>
      <td class="c-name"><div class="nm">${thumb}<div class="nm-t"><b>${esc(it.name) || '<em>Untitled</em>'}</b>
            <small>${esc(kindSummary(it))}${!it.descVisible && it.unidName ? ' · players see “' + esc(it.unidName) + '”' : ''}</small></div></div></td>
      <td class="c-mode"><span class="seg">${seg}</span></td>
      <td class="c-num">${cell('price', editing && editing.id === it.id && editing.key === 'price' ? (it.valueCp ? cpToGp(it.valueCp) : '') : price, 'gold')}</td>
      <td class="c-num">${cell('stock', stockText(it.quantity), gone ? 'muted' : '')}</td>
      <td class="c-state">${it.descVisible
        ? '<span class="muted">Identified</span>'
        : `<span class="chip unid">Unidentified</span> <button type="button" class="btn sm" onclick="event.stopPropagation();identifyItem(${idLit(it.id)})" title="Reveal its real name, description and properties to the players">Identify</button>`}</td>
      <td class="c-ask">${asks.length
        ? `<button type="button" class="chip asked${asks.length > 1 ? ' many' : ''}" onclick="event.stopPropagation();toggleAsks(${idLit(it.id)})"
             title="${asks.map(r => esc(r.charName)).join(', ')}">${asks.length} asking ${open ? '▴' : '▾'}</button>`
        : ''}</td>
    </tr>`;
  return main + (open ? `<tr class="asks"><td></td><td colspan="6">${askRowsHTML(it)}</td></tr>` : '');
}

function renderTable() {
  if (editing) { renderDue = true; return; }
  renderDue = false;
  const head = $('thead'), body = $('rows'), empty = $('empty');
  if (!body) return;
  head.innerHTML = `<tr><th class="c-chk"><input type="checkbox" id="chk-all" aria-label="Select all" onclick="toggleAllChecked(this.checked)"></th>`
    + COLS.map(c => `<th class="sortable${sortKey === c.key ? ' sorted' : ''}" onclick="setSort('${c.key}')" aria-sort="${sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}">`
        + `${c.label}${sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('') + `</tr>`;
  const shown = visibleItems();
  if (curId && !shown.some(i => i.id === curId) && !drawerOpen) curId = null;

  if (shown.length === 0) {
    body.innerHTML = '';
    empty.style.display = '';
    empty.innerHTML = items.length === 0
      ? 'No items yet. Use <strong>+ Add item</strong> to make the first one.'
      : (view === VIEW_ASKED ? 'Nobody is waiting on free loot right now.' : 'Nothing here matches. Try another tag, or clear the search.');
  } else {
    empty.style.display = 'none';
    // "All items" keeps a heading per tag; one tag on show needs none.
    if (view === VIEW_ALL || view === VIEW_ASKED) {
      const groups = new Map();
      for (const i of shown) { const t = i.tag || ''; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(i); }
      const keys = [...groups.keys()].sort((a, b) => (!a && b ? 1 : a && !b ? -1 : a.localeCompare(b)));
      body.innerHTML = keys.map(t => `<tr class="grp"><td colspan="7"><button type="button" onclick="setView('${escJs(t)}')" title="Show only this tag">${esc(t || 'No tag')}</button> <small>${groups.get(t).length}</small></td></tr>`
        + groups.get(t).map(i => rowHTML(i)).join('')).join('');
    } else {
      body.innerHTML = shown.map(i => rowHTML(i)).join('');
    }
  }
  const all = $('chk-all');
  if (all) all.checked = shown.length > 0 && shown.every(i => checked.has(i.id));
}

// ── Editing in the row ───────────────────────────────────────────────────────
function setItemMode(id, mode) {
  const it = byId(id);
  if (!it || it.mode === mode) return;
  queueSave(id, { mode }, { now: true, label: `${it.name} → ${MODE_LABEL[mode]}` });
  renderAll();
}

function editCell(id, key) {
  if (editing) commitCell();
  // The drawer follows the row being worked on, so it never shows one item
  // while another is being changed.
  if (curId !== id) { curId = id; if (drawerOpen) renderDrawer(true); renderTable(); }
  editing = { id, key };
  // Only this row is redrawn: renderTable() holds off while a cell is being
  // typed in, so a refresh from the server cannot take the box away.
  const tr = document.querySelector(`#rows tr.row[data-id="${CSS.escape(id)}"]`);
  const it = byId(id);
  if (tr && it) {
    tr.outerHTML = rowHTML(it).split('<tr class="asks">')[0];
    const el = $('cell-in');
    if (el) { el.focus(); el.select(); }
  }
}

function cellKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitCell(); }
  if (e.key === 'Escape') { e.preventDefault(); cancelCell(); }
  e.stopPropagation();
}

function cancelCell() {
  editing = null;
  renderTable();
}

function commitCell() {
  if (!editing) return;
  const { id, key } = editing;
  const el = $('cell-in');
  editing = null;
  const it = byId(id);
  if (el && it) {
    if (key === 'price') {
      const cp = parsePrice(el.value);
      if (cp === null) showStatus('That is not a price. Try “50”, “7 sp” or “2 pp 5 gp”.', true);
      else if (cp !== (it.valueCp || 0)) queueSave(id, { valueCp: cp }, { now: true, label: `${it.name} price` });
    } else if (key === 'stock') {
      const q = parseStock(el.value);
      if (q === null) showStatus('Stock is a whole number, or ∞ for no limit.', true);
      else if (q !== it.quantity) queueSave(id, { quantity: q }, { now: true, label: `${it.name} stock` });
    }
  }
  renderTable();
  if (drawerOpen && curId === id) fillDrawer(byId(id));
}

async function identifyItem(id) {
  const it = byId(id);
  if (!it || it.descVisible) return;
  if (!confirm(`Identify "${it.name}"?\n\nPlayers will see its real name, description and properties, on every copy they hold. This cannot be undone.`)) return;
  queueSave(id, { descVisible: true }, { now: true });
  renderAll();
}

function toggleAsks(id) {
  if (openAsks.has(id)) openAsks.delete(id); else openAsks.add(id);
  renderTable();
}

// ── Ticked rows ──────────────────────────────────────────────────────────────
function toggleChecked(id) {
  if (checked.has(id)) checked.delete(id); else checked.add(id);
  renderTable();
  renderBulkBar();
}
function toggleAllChecked(on) {
  for (const i of visibleItems()) { if (on) checked.add(i.id); else checked.delete(i.id); }
  renderTable();
  renderBulkBar();
}
function clearChecked() { checked.clear(); renderTable(); renderBulkBar(); }

function renderBulkBar() {
  const bar = $('bulk-bar');
  if (!bar) return;
  bar.classList.toggle('on', checked.size > 0);
  $('bulk-count').textContent = `${checked.size} selected`;
  fillTagSelect('bulk-tag');
}

async function bulkPost(path, body, okMsg) {
  const ids = [...checked];
  if (ids.length === 0) return;
  try {
    const res = await api(path, { method: 'POST', body: JSON.stringify({ ids, ...body }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('That did not work.', true); return; }
    const d = await res.json();
    showStatus(okMsg(d.count), false);
    checked.clear();
    await loadItems();
  } catch { showStatus('Network error.', true); }
}
function applyBulkTag() {
  bulkPost('/api/treasury/bulk-update-tag', { tag: tagPickValue('bulk-tag') }, n => `Tagged ${n} item${n !== 1 ? 's' : ''}.`);
}
function applyBulkMode(mode) {
  bulkPost('/api/treasury/bulk-mode', { mode }, n => `Moved ${n} item${n !== 1 ? 's' : ''} to ${MODE_LABEL[mode]}.`);
}
function bulkDelete() {
  const n = checked.size;
  if (!n || !confirm(`Delete ${n} item${n !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  bulkPost('/api/treasury/bulk-delete', {}, c => `Deleted ${c} item${c !== 1 ? 's' : ''}.`);
}

// ── Tag selects (drawer, bulk bar, import) ───────────────────────────────────
// A select rather than free text: typing into a suggestion list got in the way
// of simply picking a tag. "+ New tag…" reveals a text box for a fresh one.
function fillTagSelect(prefix, current) {
  const sel = $(prefix + '-sel');
  if (!sel || sel.value === NEW_TAG) return;
  const cur = current !== undefined ? current : sel.value;
  const known = [...new Set(items.map(i => i.tag || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (cur && !known.includes(cur)) known.push(cur);
  sel.innerHTML = '<option value="">— No tag —</option>'
    + known.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
    + `<option value="${NEW_TAG}">+ New tag…</option>`;
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

// ── The drawer ───────────────────────────────────────────────────────────────
function openItem(id, focusName) {
  if (editing) commitCell();
  curId = id;
  drawerOpen = true;
  renderTable();
  renderDrawer(true);
  if (focusName) setTimeout(() => { $('d-name').focus(); $('d-name').select(); }, 0);
}

function closeDrawer() {
  drawerOpen = false;
  renderDrawer();
  renderTable();
}

function setDrawerTab(tab) {
  drawerTab = tab;
  document.querySelectorAll('#d-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('#drawer .pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
  if (tab === 'history') renderHistory();
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
  setDrawerTab(drawerTab);
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
  set('f-desc-visible', !!it.descVisible, 'checked');
  if (force || document.activeElement !== $('f-tag-new')) fillTagSelect('f-tag', it.tag || '');

  const d = cpToDenoms(it.valueCp || 0);
  for (const c of ['pp', 'gp', 'ep', 'sp', 'cp']) set('f-' + c, d[c]);
  set('f-qty', it.quantity ?? 1);
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
  $('d-mode-help').textContent = MODE_HELP[it.mode] || '';
  for (const s of ['weapon', 'armor', 'bonuses', 'charges']) $('sect-' + s).hidden = !sectionShown(it, s);
  $('d-identify').style.display = it.descVisible ? 'none' : '';
  $('d-unid-row').hidden = !!it.descVisible;
  $('price-preview').textContent = it.valueCp ? '= ' + cpToGp(it.valueCp) : '';

  const asks = asksFor(it.id);
  $('d-asks-wrap').hidden = asks.length === 0;
  $('d-asks').innerHTML = askRowsHTML(it);
  setImagePreview(it.imageMedium || it.imageUrl);
  renderGive();
}

// One handler for every plain field in the drawer: the field names the item
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
  if (key === 'descVisible' && value) { el.checked = false; identifyItem(curId); return; }
  const it = byId(curId);
  queueSave(curId, { [key]: value }, { now: el.type === 'checkbox' || el.tagName === 'SELECT', label: `${it ? it.name : 'item'} ${el.dataset.label || key}` });
  if (key === 'name' || key === 'unidName' || key === 'charges') renderTable();
  if (key === 'descVisible') renderAll();
}

// The weapon's magic bonus is stored as text ("1"), so its number box is saved
// as it is typed rather than as a number.
function onFieldText(el) {
  if (!curId) return;
  queueSave(curId, { [el.dataset.f]: String(el.value).trim() }, { label: el.dataset.label });
  renderTable();
}

function onPrice() {
  if (!curId) return;
  const cp = ['pp', 'gp', 'ep', 'sp', 'cp'].reduce((sum, c) => sum + (parseInt($('f-' + c).value) || 0) * COIN_CP[c], 0);
  $('price-preview').textContent = cp ? '= ' + cpToGp(cp) : '';
  queueSave(curId, { valueCp: cp }, { label: 'price' });
  renderTable();
}

function onStock() {
  if (!curId) return;
  const q = parseInt($('f-qty').value);
  if (!Number.isFinite(q) || q < -1) return;
  queueSave(curId, { quantity: q }, { label: 'stock' });
  renderTable();
}

function onDrawerTag() {
  onTagPick('f-tag');
  const sel = $('f-tag-sel');
  if (sel.value === NEW_TAG) return;                 // wait for the new name to be typed
  commitDrawerTag();
}
function commitDrawerTag() {
  if (!curId) return;
  const tag = tagPickValue('f-tag');
  const it = byId(curId);
  if (!it || (it.tag || '') === tag) return;
  queueSave(curId, { tag }, { now: true, label: `${it.name} tag` });
  // Follow the item, or it would vanish from the table the moment it is retagged.
  if (view !== VIEW_ALL && view !== VIEW_ASKED) { view = tag; try { localStorage.setItem('treasury-view', view); } catch {} }
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
  fillDrawer(it);
  renderTable();
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
  const err = $('props-err');
  if (err) err.textContent = atMax ? 'Three at most.' : '';
}

// ── Add, duplicate, delete, give ─────────────────────────────────────────────
async function createItem() {
  // A new item lands in the tag on show, so it appears where you are looking.
  const tag = (view === VIEW_ALL || view === VIEW_ASKED) ? '' : view;
  try {
    const res = await api('/api/treasury', { method: 'POST', body: JSON.stringify({ name: 'New item', mode: 'hidden', tag }) });
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not add an item.', true); return; }
    const { id } = await res.json();
    if (view === VIEW_ASKED) view = VIEW_ALL;
    modeFilter = 'all';
    $('search').value = '';
    await loadItems();
    drawerTab = 'basics';
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
    if (byId(d.id)) { modeFilter = 'all'; openItem(d.id, true); }
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
  } catch { showStatus('Network error.', true); }
}

function renderGive() {
  const sel = $('d-give-char');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Choose a character…</option>'
    + chars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  sel.value = chars.some(c => c.id === cur) ? cur : '';
}

async function giveItem() {
  const it = byId(curId);
  const charId = $('d-give-char').value;
  if (!it) return;
  if (!charId) { showStatus('Choose who gets it first.', true); return; }
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

// ── Requests ─────────────────────────────────────────────────────────────────
async function loadRequests() {
  if (!masterPw) return;
  try {
    const res = await api('/api/treasury/requests');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) return;
    requests = await res.json();
  } catch { return; }
  if (view === VIEW_ASKED && requests.length === 0) view = VIEW_ALL;
  renderAskCount();
  renderTagButton();
  renderTable();
  if (drawerOpen) fillDrawer(byId(curId));
}

function renderAskCount() {
  const pill = $('req-count');
  if (!pill) return;
  pill.textContent = requests.length;
  pill.style.display = requests.length ? '' : 'none';
  $('btn-requests').classList.toggle('waiting', requests.length > 0);
}

// The top-bar button: straight to everything somebody is waiting for.
function showAsked() {
  if (requests.length === 0) { showStatus('Nobody is waiting on free loot right now.', false); return; }
  setView(view === VIEW_ASKED ? VIEW_ALL : VIEW_ASKED);
}

function whenText(raw) {
  const s = String(raw || '');
  const dt = new Date(s + (s && !s.endsWith('Z') && s.includes('T') ? 'Z' : ''));
  return isNaN(dt) ? esc(s) : dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  fillTagSelect('import-tag', (view === VIEW_ALL || view === VIEW_ASKED) ? '' : view);
  $('import-modal').style.display = 'flex';
  setTimeout(() => $('import-text').focus(), 50);
}
function closeImportModal() { $('import-modal').style.display = 'none'; }

async function runImport() {
  const text = $('import-text').value.trim();
  const statusEl = $('import-status');
  statusEl.className = 'bad';
  if (!text) { statusEl.textContent = 'Paste some items first.'; return; }
  try {
    const res = await api('/api/treasury/import', {
      method: 'POST',
      body: JSON.stringify({ text, tag: tagPickValue('import-tag'), mode: $('import-mode').value }),
    });
    if (res.status === 401) { handleUnauth(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { statusEl.textContent = data.error || 'Import failed.'; return; }
    closeImportModal();
    showStatus(`Imported ${data.count} item${data.count !== 1 ? 's' : ''}.`, false);
    await loadItems();
  } catch { statusEl.textContent = 'Network error.'; }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
// Arrows walk the rows, Enter opens one, H / L / S move it between hidden, free
// loot and shop. None of it fires while a box is being typed in.
function moveCur(step) {
  const list = visibleItems();
  if (!list.length) return;
  const at = list.findIndex(i => i.id === curId);
  const next = list[Math.max(0, Math.min(list.length - 1, at === -1 ? (step > 0 ? 0 : list.length - 1) : at + step))];
  curId = next.id;
  renderTable();
  if (drawerOpen) renderDrawer(true);
  document.querySelector(`#rows tr.row[data-id="${CSS.escape(curId)}"]`)?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', e => {
  if (!masterPw) return;
  if (e.key === 'Escape') {
    if ($('import-modal').style.display !== 'none') return closeImportModal();
    if ($('ledger-modal').style.display !== 'none') return closeLedger();
    if ($('tag-menu').classList.contains('open')) return toggleTagMenu(false);
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.closest('#drawer, .tools')) return document.activeElement.blur();
    if (drawerOpen) return closeDrawer();
    return;
  }
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && lastUndo) { e.preventDefault(); undoLast(); }
    return;
  }
  if ($('import-modal').style.display !== 'none' || $('ledger-modal').style.display !== 'none') return;
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowDown') { e.preventDefault(); moveCur(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveCur(-1); }
  else if (e.key === 'Enter' && curId) { e.preventDefault(); openItem(curId, true); }
  else if (e.key === '/') { e.preventDefault(); $('search').focus(); $('search').select(); }
  else if (k === 't') { e.preventDefault(); toggleTagMenu(true); }
  else if (curId && k === 'h') setItemMode(curId, 'hidden');
  else if (curId && k === 'l') setItemMode(curId, 'loot');
  else if (curId && k === 's') setItemMode(curId, 'shop');
  else if (curId && k === 'i') identifyItem(curId);
  else if (curId && k === 'd') duplicateItem(curId);
  else if (k === 'n') createItem();
});

// A change still waiting to be sent would be lost by leaving the page.
window.addEventListener('beforeunload', e => {
  if (pending.size) { e.preventDefault(); e.returnValue = ''; }
});

// ── Auto-auth from the stored session ────────────────────────────────────────
// A tab already logged in as DM unlocks without asking again, once the server
// confirms the session is still live.
_gate.start();

// ── Real-time ────────────────────────────────────────────────────────────────
// connectRealtime() comes from the shared /js/lib/realtime.js (loaded first).
connectRealtime({
  notification: (p) => { typeof handleNotification === 'function' && handleNotification(p); },
  treasury: (data) => {
    if (!masterPw) return;
    if (data.action === 'statusChanged') {
      shopIsOpen = data.isOpen;
      shopActiveTags = data.activeTags || (data.activeTag ? [data.activeTag] : []);
      renderShopStrip();
      renderTagButton();
      return;
    }
    loadItems();
    if (['requested', 'approved', 'declined', 'deleted', 'updated', 'bulk-updated'].includes(data.action)) loadRequests();
    if (['approved', 'claimed', 'purchase'].includes(data.action)) {
      ledgerRows = null;
      if (drawerOpen && drawerTab === 'history') renderHistory();
    }
  },
  characters: () => { if (masterPw) loadChars(); },
});
