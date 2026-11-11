// Written by Irmak Hakman — 2026-11-11 18:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

let masterPw = '';
let monsters = [];
let pendingInitMonster = null;
let editingMonsterId = null;
let editFormData = null;
let _editPortraitData = null; // base64 data URL or null = no change, '' = remove

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escape a value for a single-quoted JS string inside an HTML attribute (see escJs note in esc.js).
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


function applyTheme() {  /* single lamplit theme now; kept as a no-op guard */
  document.body.className = '';
}
(function(){ applyTheme(localStorage.getItem('monsters-theme') || 'dark-gold'); })();

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

// The shared DM gate (js/lib/auth-ui.js): maths captcha, lockout, and a session
// token kept in masterPw where the typed password used to go.
const _gate = AuthUI.dmGate({
  capEl:   document.getElementById('gate-cap'),
  pwInput: document.getElementById('gate-pw'),
  errEl:   document.getElementById('gate-err'),
  onUnlock: async (token) => {
    masterPw = token;
    document.getElementById('gate').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    await loadMonsters();
  },
});
function authenticate() { return _gate.submit(); }

async function loadMonsters() {
  try {
    const res = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { showStatus('Failed to load monsters.', true); return; }
    monsters = await res.json();
    // The stat block on the right is built from the list, so it is rebuilt from
    // the fresh copy too - after an edit it went on showing the old monster
    // until the page was reloaded. (selectMonster also repaints the list.)
    if (selectedMonsterId && monsters.some(m => m.id === selectedMonsterId)) selectMonster(selectedMonsterId);
    else renderTable();
  } catch { showStatus('Network error.', true); }
}

function getTypeStr(data) {
  if (!data.type) return '';
  if (typeof data.type === 'string') return data.type;
  let s = data.type.type || '';
  if (data.type.tags && data.type.tags.length) s += ' (' + data.type.tags.join(', ') + ')';
  return s;
}

function getAcStr(data) {
  if (!data.ac) return '—';
  const first = [].concat(data.ac)[0];
  if (typeof first === 'number') return String(first);
  if (typeof first === 'object') return String(first.ac || '—');
  return String(first);
}

function getHpStr(data) {
  if (!data.hp) return '—';
  return data.hp.average !== undefined ? String(data.hp.average) : String(data.hp);
}

function getSpeedStr(data) {
  if (!data.speed) return '—';
  const parts = [];
  if (data.speed.walk) parts.push(data.speed.walk + ' ft.');
  if (data.speed.fly) parts.push('✈' + data.speed.fly);
  if (data.speed.swim) parts.push('🌊' + data.speed.swim);
  return parts.join(' ') || '—';
}

function getInitBonus(data) {
  const dexMod = Math.floor(((data.dex || 10) - 10) / 2);
  let bonus = dexMod;
  if (data.initiative && data.initiative.proficiency) bonus += getMonsterProfBonus(data.cr);
  if (data.initBonus) bonus += data.initBonus;
  return bonus;
}

let selectedMonsterId = null;

// The sidebar list. Rows are selectable; the stat block renders into the detail
// pane rather than a modal, so reading one monster and then the next no longer
// means opening and closing a dialog each time.
function renderTable() {
  if (monTab === 'official') { renderOfficialList(); return; }
  const wrap = document.getElementById('monster-table-wrap');
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const filtered = monsters.filter(m => {
    if (!q) return true;
    const type = getTypeStr(m.data).toLowerCase();
    return m.name.toLowerCase().includes(q) || type.includes(q);
  });
  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="app-empty">' +
      (monsters.length === 0 ? 'No monsters imported yet.' : 'No monsters match your search.') + '</div>';
    return;
  }
  wrap.innerHTML = filtered.map(m => `
    <div class="app-row${m.id === selectedMonsterId ? ' selected' : ''}"
         role="button" tabindex="0" onclick="selectMonster('${escJs(m.id)}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectMonster('${escJs(m.id)}')}">
      <span class="app-row-name">${esc(m.name)}${m.data?.unique ? ' <span class="cr-badge" title="Unique: one token at a time, called by its name">Unique</span>' : ''}</span>
      <span class="cr-badge">${esc(m.cr || '?')}</span>
    </div>`).join('');
}

// Detail pane: the stat block, with the actions for THIS monster beside it
// instead of five buttons repeated on every row of a table.
function selectMonster(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  selectedMonsterId = monsterId;
  const d = m.data || {};
  document.getElementById('monster-detail').innerHTML = `
    <div class="detail-hdr">
      <div>
        <h2 class="detail-title">${esc(m.name)}</h2>
        <div class="detail-sub">${d.unique ? 'Unique &middot; ' : ''}${esc(getTypeStr(d))} &middot; CR ${esc(m.cr || '?')} &middot; AC ${esc(getAcStr(d))} &middot; HP ${esc(getHpStr(d))} &middot; ${esc(getSpeedStr(d))}</div>
      </div>
      <div class="detail-actions">
        <button class="btn success" onclick="openInitModal('${escJs(m.id)}')" title="Add to the initiative tracker">+ Initiative</button>
        <button class="btn" onclick="openEditMonsterModal('${escJs(m.id)}')" title="Edit this monster's JSON">Edit</button>
        <button class="btn" onclick="exportMonster('${escJs(m.id)}','${escJs(m.name)}')" title="Export to a file">Export</button>
        <button class="btn danger" onclick="deleteMonster('${escJs(m.id)}')" title="Remove this monster">Delete</button>
      </div>
    </div>
    <div class="detail-body">${renderMonsterStatBlock(d)}</div>`;
  renderTable();   // repaint so the selected row is marked
}

// ── Official monsters (whole 5etools books, read-only) ────────────────────────
// The second tab of the sidebar. They live on the server
// (server/routes/official-monsters.js) and can run to thousands, so the list
// is searched there, a page at a time. The DM uses one as it is (initiative,
// tokens) or copies it to My Monsters to change it.
let monTab = 'mine';
const official = { rows: [], total: 0, loading: false };
const officialFull = new Map();   // id -> { id, name, cr, data, official, source }
let officialBooks = null;         // the books 5etools offers (loaded with the Books window)
let officialSources = [];         // [{ source, count }] in this campaign
let _offSearchTimer = null;
const OFFICIAL_PAGE = 100;

function switchMonTab(tab) {
  monTab = tab === 'official' ? 'official' : 'mine';
  for (const t of ['mine', 'official']) {
    const b = document.getElementById('seg-' + t);
    b.classList.toggle('active', t === monTab);
    b.setAttribute('aria-selected', t === monTab ? 'true' : 'false');
  }
  document.getElementById('official-tools').style.display = monTab === 'official' ? '' : 'none';
  if (monTab === 'official') { loadOfficialSources(); loadOfficial(true); loadOfficialBookNames(); }
  else renderTable();
}

// The books' real names for the filter ("Monster Manual (2025)", not "XMM"),
// fetched once in the background; the codes show until they arrive.
let _offNamesAsked = false;
async function loadOfficialBookNames() {
  if (officialBooks || _offNamesAsked) return;
  _offNamesAsked = true;
  try {
    const r = await fetch('/api/monsters/official/books', { headers: { 'X-Master-Password': masterPw } });
    if (!r.ok) { _offNamesAsked = false; return; }
    officialBooks = await r.json();
    loadOfficialSources();
  } catch { _offNamesAsked = false; }
}

function onMonSearch() {
  if (monTab !== 'official') { renderTable(); return; }
  clearTimeout(_offSearchTimer);
  _offSearchTimer = setTimeout(() => loadOfficial(true), 250);
}

async function loadOfficialSources() {
  try {
    const r = await fetch('/api/monsters/official/sources', { headers: { 'X-Master-Password': masterPw } });
    if (!r.ok) return;
    officialSources = await r.json();
  } catch { return; }
  const sel = document.getElementById('official-book');
  const cur = sel.value;
  const name = code => (officialBooks && officialBooks.find(b => b.code === code)?.name) || code;
  sel.innerHTML = '<option value="">All books</option>' + officialSources.map(s =>
    `<option value="${esc(s.source)}">${esc(name(s.source))} (${s.count})</option>`).join('');
  if (officialSources.some(s => s.source === cur)) sel.value = cur;
}

async function loadOfficial(reset) {
  if (official.loading && !reset) return;
  official.loading = true;
  const q = (document.getElementById('search-input').value || '').trim();
  const source = document.getElementById('official-book').value;
  const offset = reset ? 0 : official.rows.length;
  try {
    const r = await fetch(`/api/monsters/official?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}&limit=${OFFICIAL_PAGE}&offset=${offset}`,
      { headers: { 'X-Master-Password': masterPw } });
    if (r.status === 401) { location.href = '/dm.html'; return; }
    const out = r.ok ? await r.json() : { rows: [], total: 0 };
    official.rows = reset ? out.rows : official.rows.concat(out.rows);
    official.total = out.total;
  } catch { showStatus('Network error.', true); }
  finally { official.loading = false; }
  if (monTab === 'official') renderTable();
}

function renderOfficialList() {
  const wrap = document.getElementById('monster-table-wrap');
  if (!official.rows.length) {
    const none = !officialSources.length && !(document.getElementById('search-input').value || '').trim();
    wrap.innerHTML = none
      ? `<div class="app-empty"><div>No official monsters in this campaign yet.<br><br><button class="btn primary" onclick="openOfficialBooks()">Import books…</button></div></div>`
      : '<div class="app-empty">No official monsters match your search.</div>';
    return;
  }
  wrap.innerHTML = official.rows.map(m => `
    <div class="app-row${m.id === selectedMonsterId ? ' selected' : ''}"
         role="button" tabindex="0" onclick="selectOfficial('${escJs(m.id)}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectOfficial('${escJs(m.id)}')}">
      <span class="app-row-name">${esc(m.name)}</span>
      <span class="ob-code" title="Book">${esc(m.source)}</span>
      <span class="cr-badge">${esc(m.cr || '?')}</span>
    </div>`).join('')
    + (official.total > official.rows.length
      ? `<div class="ob-more"><button class="btn sm" onclick="loadOfficial(false)">Show more (${official.total - official.rows.length} left)</button></div>` : '');
}

async function getOfficial(id) {
  if (officialFull.has(id)) return officialFull.get(id);
  try {
    const r = await fetch(`/api/monsters/${encodeURIComponent(id)}`, { headers: { 'X-Master-Password': masterPw } });
    if (!r.ok) return null;
    const m = await r.json();
    officialFull.set(id, m);
    return m;
  } catch { return null; }
}

async function selectOfficial(id) {
  selectedMonsterId = id;
  renderTable();
  const m = await getOfficial(id);
  if (!m || selectedMonsterId !== id) { if (!m) showStatus('Could not load that monster.', true); return; }
  const d = m.data || {};
  const book = (officialBooks && officialBooks.find(b => b.code === m.source)?.name) || m.source;
  document.getElementById('monster-detail').innerHTML = `
    <div class="detail-hdr">
      <div>
        <h2 class="detail-title">${esc(m.name)}</h2>
        <div class="detail-sub"><span class="cr-badge" title="Official monsters cannot be edited">Official</span> ${esc(book)} &middot; ${esc(getTypeStr(d))} &middot; CR ${esc(m.cr || '?')} &middot; AC ${esc(getAcStr(d))} &middot; HP ${esc(getHpStr(d))} &middot; ${esc(getSpeedStr(d))}</div>
      </div>
      <div class="detail-actions">
        <button class="btn success" onclick="openInitModal('${escJs(m.id)}')" title="Add to the initiative tracker">+ Initiative</button>
        <button class="btn" onclick="copyOfficial('${escJs(m.id)}')" title="Make an editable copy in My Monsters">Copy to My Monsters</button>
      </div>
    </div>
    <div class="detail-body">${renderMonsterStatBlock(d)}</div>`;
}

async function copyOfficial(id) {
  const m = officialFull.get(id);
  if (!m) return;
  try {
    const r = await fetch(`/api/monsters/official/${encodeURIComponent(id)}/copy`, { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    if (r.status === 401) { location.href = '/dm.html'; return; }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { showStatus(out.error || 'Could not copy the monster.', true); return; }
    selectedMonsterId = null;
    switchMonTab('mine');
    await loadMonsters();
    if (monsters.some(x => x.id === out.id)) selectMonster(out.id);
    showStatus(`${out.name} copied to My Monsters. Edit it here; tokens of the official one stay as they are.`);
  } catch { showStatus('Network error.', true); }
}

// The Books window: import whole books, or remove one.
async function openOfficialBooks() {
  document.getElementById('obooks-modal').style.display = 'flex';
  document.getElementById('obooks-status').textContent = '';
  try {
    const c = await fetch('/api/campaign/current', { headers: { 'X-Master-Password': masterPw } }).then(r => (r.ok ? r.json() : null));
    if (c && c.name) document.getElementById('obooks-camp').textContent = c.name;
  } catch {}
  await loadOfficialSources();
  if (officialBooks) { renderOfficialBooks(); return; }
  document.getElementById('obooks-list').innerHTML = '<div class="ob-hint">Loading the list of books…</div>';
  try {
    const r = await fetch('/api/monsters/official/books', { headers: { 'X-Master-Password': masterPw } });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { document.getElementById('obooks-list').innerHTML = `<div class="ob-hint">${esc(out.error || 'Could not load the list of books.')}</div>`; return; }
    officialBooks = out;
    renderOfficialBooks();
    loadOfficialSources();   // book names for the filter
  } catch { document.getElementById('obooks-list').innerHTML = '<div class="ob-hint">Network error.</div>'; }
}

function closeOfficialBooks() { document.getElementById('obooks-modal').style.display = 'none'; }

function renderOfficialBooks() {
  if (!officialBooks) return;
  const ticked = new Set(chosenOfficialBooks());
  const f = (document.getElementById('obooks-filter').value || '').trim().toLowerCase();
  const have = Object.fromEntries(officialSources.map(s => [s.source, s.count]));
  const list = officialBooks.filter(b => !f || b.name.toLowerCase().includes(f) || b.code.toLowerCase().includes(f));
  document.getElementById('obooks-list').innerHTML = list.map(b => `<label class="ob-book">
      <input type="checkbox" value="${esc(b.code)}" ${ticked.has(b.code) ? 'checked' : ''} onchange="officialBooksChanged()">
      <span class="ob-name">${esc(b.name)}</span>
      <span class="ob-code">${esc(b.code)}</span>
      ${have[b.code] ? `<span class="ob-have">${have[b.code]} imported</span>
        <button type="button" class="btn sm danger" onclick="event.preventDefault();removeOfficialBook('${escJs(b.code)}')" title="Remove this book's official monsters">Remove</button>` : ''}
    </label>`).join('') || '<div class="ob-hint">No books match.</div>';
  officialBooksChanged();
}

function chosenOfficialBooks() {
  return [...document.querySelectorAll('#obooks-list input[type=checkbox]:checked')].map(i => i.value);
}
function setAllOfficialBooks(on) {
  document.querySelectorAll('#obooks-list input[type=checkbox]').forEach(i => { i.checked = on; });
  officialBooksChanged();
}
function officialBooksChanged() {
  const n = chosenOfficialBooks().length;
  const btn = document.getElementById('obooks-go');
  btn.disabled = !n;
  btn.textContent = n ? `Import ${n} book${n === 1 ? '' : 's'}` : 'Import';
}

async function runOfficialImport() {
  const codes = chosenOfficialBooks();
  if (!codes.length) return;
  const btn = document.getElementById('obooks-go');
  const status = document.getElementById('obooks-status');
  btn.disabled = true;
  status.textContent = `Downloading and importing ${codes.length} book${codes.length === 1 ? '' : 's'}… (all of them takes a minute or two)`;
  try {
    const r = await fetch('/api/monsters/official/import-books', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ books: codes }),
    });
    if (r.status === 401) { location.href = '/dm.html'; return; }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = out.error || 'The import failed.'; return; }
    status.textContent = `${out.imported} new, ${out.updated} updated.`
      + (out.unresolved && out.unresolved.length ? ` ${out.unresolved.length} could not be built (the monster they copy is in no book): ${out.unresolved.slice(0, 5).join(', ')}${out.unresolved.length > 5 ? '…' : ''}` : '');
    document.querySelectorAll('#obooks-list input[type=checkbox]').forEach(i => { i.checked = false; });
    await loadOfficialSources();
    renderOfficialBooks();
    if (monTab === 'official') loadOfficial(true);
  } catch { status.textContent = 'Network error.'; }
  finally { officialBooksChanged(); }
}

async function removeOfficialBook(code) {
  const n = (officialSources.find(s => s.source === code) || {}).count || 0;
  if (!confirm(`Remove the ${n} official monsters of ${code} from this campaign? Tokens and initiative entries made from them lose their stat blocks until the book is imported again.`)) return;
  try {
    const r = await fetch(`/api/monsters/official/books/${encodeURIComponent(code)}`, { method: 'DELETE', headers: { 'X-Master-Password': masterPw } });
    if (!r.ok) { document.getElementById('obooks-status').textContent = 'Could not remove the book.'; return; }
    const out = await r.json().catch(() => ({}));
    document.getElementById('obooks-status').textContent = `Removed ${out.removed || 0} monsters of ${code}.`;
    for (const id of [...officialFull.keys()]) if (officialFull.get(id).source === code) officialFull.delete(id);
    await loadOfficialSources();
    renderOfficialBooks();
    if (monTab === 'official') loadOfficial(true);
  } catch { document.getElementById('obooks-status').textContent = 'Network error.'; }
}

// ── Import modal ──────────────────────────────────────────────────────────────
function openImportModal() {
  document.getElementById('import-status').textContent = '';
  document.getElementById('import-modal').style.display = 'flex';
  document.getElementById('import-text').focus();
}
function closeImportModal() {
  document.getElementById('import-modal').style.display = 'none';
}

// ── Info modal ────────────────────────────────────────────────────────────────
function openInfoModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  document.getElementById('info-modal-title').textContent = m.name;
  document.getElementById('info-modal-body').innerHTML = renderMonsterStatBlock(m.data || {});
  document.getElementById('info-modal').style.display = 'flex';
}

function closeInfoModal() {
  document.getElementById('info-modal').style.display = 'none';
}

// ── Add to initiative modal ───────────────────────────────────────────────────
function openInitModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId) || officialFull.get(monsterId);
  if (!m) return;
  pendingInitMonster = m;
  const d = m.data || {};
  const dexMod = Math.floor(((d.dex || 10) - 10) / 2);
  const hasProf = !!(d.initiative && d.initiative.proficiency);
  const prof = getMonsterProfBonus(d.cr);
  const manualBonus = d.initBonus || 0;
  const bonus = getInitBonus(d);
  const parts = ['DEX ' + (dexMod >= 0 ? '+' : '') + dexMod];
  if (hasProf) parts.push('Prof +' + prof);
  if (manualBonus !== 0) parts.push('Mod ' + (manualBonus >= 0 ? '+' : '') + manualBonus);
  document.getElementById('init-modal-title').textContent = 'Add to Initiative: ' + m.name;
  document.getElementById('init-modal-desc').textContent = 'd20 ' + (bonus >= 0 ? '+' : '-') + ' ' + Math.abs(bonus) + ' (' + parts.join(', ') + ')';
  document.getElementById('init-name-override').value = m.name;
  document.getElementById('init-bonus-val').value = bonus;
  document.getElementById('init-modal-err').textContent = '';
  document.getElementById('init-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-bonus-val').focus(), 50);
}

function closeInitModal() {
  document.getElementById('init-modal').style.display = 'none';
  pendingInitMonster = null;
}

async function submitAddToInit() {
  if (!pendingInitMonster) return;
  const m = pendingInitMonster;
  const nameOverride = document.getElementById('init-name-override').value.trim() || m.name;
  const bonus = parseInt(document.getElementById('init-bonus-val').value) || 0;
  const d20 = Math.ceil(Math.random() * 20);
  const roll = d20 + bonus;
  const errEl = document.getElementById('init-modal-err');
  try {
    const res = await fetch('/api/initiative/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name: nameOverride, roll, monsterId: m.id })
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { errEl.textContent = 'Failed to add to initiative.'; return; }
    closeInitModal();
    showStatus(`${nameOverride} added with roll ${roll} (d20${bonus>=0?'+':''}${bonus} = ${d20}${bonus>=0?'+':''}${bonus}=${roll}).`, false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Delete monster ────────────────────────────────────────────────────────────
async function deleteMonster(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m || !confirm(`Remove "${m.name}" from monster list?`)) return;
  try {
    const res = await fetch(`/api/monsters/${monsterId}`, {
      method: 'DELETE',
      headers: { 'X-Master-Password': masterPw }
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { showStatus('Failed to delete monster.', true); return; }
    monsters = monsters.filter(x => x.id !== monsterId);
    if (selectedMonsterId === monsterId) {
      selectedMonsterId = null;
      document.getElementById('monster-detail').innerHTML = '<div class="app-empty">Select a monster to see its stat block.</div>';
    }
    renderTable();
    showStatus(`${m.name} removed.`, false);
  } catch { showStatus('Network error.', true); }
}

// ── Export single monster ─────────────────────────────────────────────────────
async function exportMonster(id, name) {
  try {
    const res = await fetch(`/api/monsters/${id}/export`, { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const data = await res.json();
    const date = new Date().toISOString().split('T')[0];
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `monster-${slug}-${date}.json`;
    a.click();
  } catch (err) {
    const statusEl = document.getElementById('import-status');
    if (statusEl) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Export failed: ' + err.message; }
  }
}

// ── Import ────────────────────────────────────────────────────────────────────
async function importMonsters() {
  const raw = document.getElementById('import-text').value.trim();
  const statusEl = document.getElementById('import-status');
  if (!raw) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Paste JSON first.'; return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Invalid JSON: ' + e.message; return; }
  // Normalise: support single object, array, or 5etools {monster:[...]} format
  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.monster)) {
    list = parsed.monster;
  } else if (parsed && typeof parsed === 'object' && parsed.name) {
    list = [parsed];
  } else {
    statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Expected a monster object, array, or {monster:[...]} wrapper.'; return;
  }
  statusEl.style.color = 'var(--ash)'; statusEl.textContent = 'Importing…';
  try {
    const res = await fetch('/api/monsters/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ monsters: list })
    });
    if (res.status === 401) { location.href = '/dm.html'; return; }
    const data = await res.json();
    if (!res.ok) { statusEl.style.color = 'var(--blood)'; statusEl.textContent = data.error || 'Import failed.'; return; }
    // innerHTML so the check icon renders (textContent showed its markup as text);
    // the one server value in it is escaped.
    statusEl.style.color = 'var(--verdigris)'; statusEl.innerHTML = `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg> Imported ${esc(data.count)} monster${data.count !== 1 ? 's' : ''}.`;
    document.getElementById('import-text').value = '';
    await loadMonsters();
  } catch { statusEl.style.color = 'var(--blood)'; statusEl.textContent = 'Network error.'; }
}

// ── Edit monster (form) ───────────────────────────────────────────────────────
function efSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val === undefined || val === null) ? '' : String(val);
}

function efFormatProfMap(obj) {
  if (!obj) return '';
  return Object.entries(obj).map(([k, v]) => k[0].toUpperCase() + k.slice(1) + ' ' + v).join(', ');
}

function efFormatDmgList(list) {
  if (!list || !list.length) return '';
  return [].concat(list).map(i => typeof i === 'string' ? i : [].concat(i.immune || i.resist || i.conditionImmune || i.vulnerable || []).join('/')).join(', ');
}

function addEditRow(containerId) {
  efAppendRow(document.getElementById(containerId), { name: '', entries: [] });
  document.getElementById(containerId).lastElementChild.querySelector('[data-field=name]').focus();
}

function efAppendRow(container, item) {
  const div = document.createElement('div');
  div.className = 'ef-entry-row';
  div.innerHTML = `<div style="display:flex;gap:calc(6px*var(--fs, 1));margin-bottom:calc(4px*var(--fs, 1));align-items:center">
    <input type="text" placeholder="Name" data-field="name" style="flex:1">
    <button type="button" class="btn sm ef-move ef-up" onclick="efMoveRow(this, -1)" title="Move up" aria-label="Move up">▲</button>
    <button type="button" class="btn sm ef-move ef-down" onclick="efMoveRow(this, 1)" title="Move down" aria-label="Move down">▼</button>
    <button type="button" class="btn sm danger" onclick="this.closest('.ef-entry-row').remove()"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>
  </div>
  <textarea placeholder="Description" data-field="entries" style="min-height:calc(56px*var(--fs, 1));resize:vertical;width:100%"></textarea>`;
  div.querySelector('[data-field=name]').value = item.name || '';
  div.querySelector('[data-field=entries]').value = (item.entries || []).filter(e => typeof e === 'string').join('\n\n');
  container.appendChild(div);
}

// Moves an entry one place up or down within its section. The stat block lists
// them in the order the form holds them (efReadSection reads the rows in DOM
// order), so this is how a Multiattack added last gets back to the top.
function efMoveRow(btn, dir) {
  const row = btn.closest('.ef-entry-row');
  const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!other) return;
  if (dir < 0) row.parentNode.insertBefore(row, other);
  else row.parentNode.insertBefore(other, row);
  btn.focus();
}

function scToItem(sc) {
  const parts = [];
  (sc.headerEntries || []).forEach(e => { if (typeof e === 'string') parts.push(e); });
  if (sc.will && sc.will.length) parts.push('At will: ' + sc.will.join(', '));
  if (sc.daily) for (const [k, v] of Object.entries(sc.daily)) {
    const n = k.replace('e', '');
    parts.push(n + '/day' + (k.endsWith('e') ? ' each' : '') + ': ' + v.join(', '));
  }
  if (sc.spells) for (const [lvl, sd] of Object.entries(sc.spells)) {
    const slots = sd.slots ? ' (' + sd.slots + ' slot' + (sd.slots !== 1 ? 's' : '') + ')' : '';
    const ord = ['', 'st', 'nd', 'rd'];
    const lvlStr = lvl === '0' ? 'Cantrips (at will)' : lvl + (ord[+lvl] || 'th') + '-level' + slots;
    parts.push(lvlStr + ': ' + [].concat(sd.spells || []).join(', '));
  }
  return { name: sc.name || '', entries: parts };
}

function efLoadSection(containerId, items) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  (items || []).forEach(item => efAppendRow(el, item));
}

function efReadSection(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('.ef-entry-row')].map(row => ({
    name: row.querySelector('[data-field=name]').value.trim(),
    entries: row.querySelector('[data-field=entries]').value.trim() ? [row.querySelector('[data-field=entries]').value.trim()] : []
  })).filter(r => r.name || r.entries.length);
}

function efParseProfStr(str) {
  if (!str.trim()) return undefined;
  const result = {};
  str.split(',').forEach(part => {
    const m = part.trim().match(/^(\w+)\s+([+-]?\d+)$/);
    if (m) { const n = parseInt(m[2]); result[m[1].toLowerCase()] = (n >= 0 ? '+' : '') + n; }
  });
  return Object.keys(result).length ? result : undefined;
}

function efParseTypeStr(str) {
  if (!str.trim()) return 'unknown';
  const m = str.trim().match(/^(.+?)\s*\((.+)\)$/);
  if (m) return { type: m[1].trim().toLowerCase(), tags: m[2].split(',').map(s => s.trim().toLowerCase()) };
  return str.trim().toLowerCase();
}

function efParseAlignStr(str) {
  const MAP = { lawful:'L', neutral:'N', chaotic:'C', good:'G', evil:'E', unaligned:'U', any:'A' };
  return str.trim().split(/[\s,]+/).map(w => MAP[w.toLowerCase()] || w.slice(0,1).toUpperCase()).filter(Boolean);
}

function efParseCsvList(str) {
  if (!str.trim()) return undefined;
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function openAddMonsterModal() {
  editingMonsterId = null;
  editFormData = {};
  // Clear portrait
  _editPortraitData = null;
  _setEfPortraitUI(null);
  // Clear all fields
  ['ef-name','ef-cr','ef-type','ef-alignment','ef-source','ef-hp-formula',
   'ef-saves','ef-skills','ef-immune','ef-resist','ef-condimm','ef-vuln','ef-senses','ef-languages'].forEach(id => efSet(id, ''));
  ['ef-ac','ef-hp-avg','ef-speed-walk','ef-speed-fly','ef-speed-swim','ef-speed-climb','ef-speed-burrow',
   'ef-str','ef-dex','ef-con','ef-int','ef-wis','ef-cha','ef-passive','ef-init-bonus'].forEach(id => efSet(id, ''));
  document.getElementById('ef-size').value = 'M';
  document.getElementById('ef-init-prof').checked = false;
  document.getElementById('ef-unique').checked = false;
  ['ef-traits','ef-actions','ef-bonus','ef-reactions','ef-legendary'].forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('edit-modal-title').textContent = 'Add Monster';
  document.getElementById('edit-err').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ef-name').focus(), 50);
}

function openEditMonsterModal(monsterId) {
  const m = monsters.find(x => x.id === monsterId);
  if (!m) return;
  editingMonsterId = monsterId;
  editFormData = JSON.parse(JSON.stringify(m.data || {}));
  const d = editFormData;

  // Basic
  efSet('ef-name', d.name);
  efSet('ef-cr', typeof d.cr === 'object' ? d.cr.cr : d.cr);
  efSet('ef-size', (d.size || ['M'])[0] || 'M');
  efSet('ef-type', typeof d.type === 'string' ? d.type : d.type ? (d.type.type || '') + (d.type.tags && d.type.tags.length ? ' (' + d.type.tags.join(', ') + ')' : '') : '');
  const AL = {L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  efSet('ef-alignment', (d.alignment || []).map(a => AL[a] || a).join(' '));
  efSet('ef-source', d.source);
  document.getElementById('ef-unique').checked = d.unique === true;
  // Combat
  const acFirst = [].concat(d.ac || [])[0];
  efSet('ef-ac', typeof acFirst === 'number' ? acFirst : (acFirst && acFirst.ac) || '');
  efSet('ef-hp-avg', d.hp ? d.hp.average : '');
  efSet('ef-hp-formula', d.hp ? d.hp.formula : '');
  efSet('ef-speed-walk', d.speed ? d.speed.walk || '' : '');
  efSet('ef-speed-fly', d.speed ? d.speed.fly || '' : '');
  efSet('ef-speed-swim', d.speed ? d.speed.swim || '' : '');
  efSet('ef-speed-climb', d.speed ? d.speed.climb || '' : '');
  efSet('ef-speed-burrow', d.speed ? d.speed.burrow || '' : '');
  // Ability scores
  ['str','dex','con','int','wis','cha'].forEach(s => efSet('ef-' + s, d[s] || ''));
  // Proficiencies
  efSet('ef-saves', efFormatProfMap(d.save));
  efSet('ef-skills', efFormatProfMap(d.skill));
  efSet('ef-immune', efFormatDmgList(d.immune));
  efSet('ef-resist', efFormatDmgList(d.resist));
  efSet('ef-condimm', efFormatDmgList(d.conditionImmune));
  efSet('ef-vuln', efFormatDmgList(d.vulnerable));
  efSet('ef-senses', (d.senses || []).join(', '));
  efSet('ef-passive', d.passive);
  efSet('ef-languages', (d.languages || []).join(', '));
  efSet('ef-init-bonus', d.initBonus || '');
  document.getElementById('ef-init-prof').checked = d.initiative?.proficiency === true;
  // Dynamic sections — merge spellcasting entries by displayAs into the matching section
  const scByKey = {};
  for (const sc of (d.spellcasting || [])) {
    const k = (sc.displayAs || 'trait').toLowerCase();
    (scByKey[k] || (scByKey[k] = [])).push(sc);
  }
  efLoadSection('ef-traits', d.trait);
  efLoadSection('ef-actions', [...(d.action || []), ...(scByKey['action'] || []).map(scToItem)]);
  efLoadSection('ef-bonus', [...(d.bonus || []), ...(scByKey['bonus'] || []).map(scToItem)]);
  efLoadSection('ef-reactions', [...(d.reaction || []), ...(scByKey['reaction'] || []).map(scToItem)]);
  efLoadSection('ef-legendary', [...(d.legendary || []), ...(scByKey['legendary'] || []).map(scToItem)]);

  // Portrait
  _editPortraitData = null;
  const existingPortrait = d.portrait || null;
  _setEfPortraitUI(existingPortrait);

  document.getElementById('edit-modal-title').textContent = 'Edit Monster';
  document.getElementById('edit-err').textContent = '';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ef-name').focus(), 50);
}

function closeEditMonsterModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingMonsterId = null;
  editFormData = null;
  _editPortraitData = null;
}

async function submitEditMonster() {
  if (!editingMonsterId) return;
  const errEl = document.getElementById('edit-err');
  const name = document.getElementById('ef-name').value.trim();
  if (!name) { errEl.textContent = 'Name is required.'; return; }

  // Start from original data to preserve untouched fields (spellcasting, tokens, etc.)
  const data = JSON.parse(JSON.stringify(editFormData || {}));

  // Basic
  data.name = name;
  const srcVal = document.getElementById('ef-source').value.trim();
  if (srcVal) data.source = srcVal; else delete data.source;
  const crStr = document.getElementById('ef-cr').value.trim();
  if (crStr) data.cr = typeof data.cr === 'object' ? { ...data.cr, cr: crStr } : crStr;
  const sizeVal = document.getElementById('ef-size').value;
  if (sizeVal) data.size = [sizeVal];
  const typeStr = document.getElementById('ef-type').value.trim();
  if (typeStr) data.type = efParseTypeStr(typeStr);
  data.alignment = efParseAlignStr(document.getElementById('ef-alignment').value);

  // Combat
  const acNum = parseInt(document.getElementById('ef-ac').value);
  if (!isNaN(acNum)) data.ac = [acNum];
  const hpAvg = parseInt(document.getElementById('ef-hp-avg').value);
  const hpFormula = document.getElementById('ef-hp-formula').value.trim();
  if (!isNaN(hpAvg) || hpFormula) data.hp = { average: isNaN(hpAvg) ? (data.hp?.average || 0) : hpAvg, formula: hpFormula || data.hp?.formula || '' };
  const speed = {};
  for (const f of ['walk','fly','swim','climb','burrow']) {
    const v = document.getElementById('ef-speed-' + f).value.trim();
    if (v !== '') { const n = parseInt(v); if (!isNaN(n)) speed[f] = n; }
  }
  if (Object.keys(speed).length) data.speed = speed;

  // Ability scores
  for (const s of ['str','dex','con','int','wis','cha']) {
    const v = parseInt(document.getElementById('ef-' + s).value);
    if (!isNaN(v)) data[s] = v;
  }

  // Proficiencies
  const saves = efParseProfStr(document.getElementById('ef-saves').value);
  if (saves) data.save = saves; else delete data.save;
  const skills = efParseProfStr(document.getElementById('ef-skills').value);
  if (skills) data.skill = skills; else delete data.skill;
  const immune = efParseCsvList(document.getElementById('ef-immune').value);
  if (immune) data.immune = immune; else delete data.immune;
  const resist = efParseCsvList(document.getElementById('ef-resist').value);
  if (resist) data.resist = resist; else delete data.resist;
  const condImm = efParseCsvList(document.getElementById('ef-condimm').value);
  if (condImm) data.conditionImmune = condImm; else delete data.conditionImmune;
  const vuln = efParseCsvList(document.getElementById('ef-vuln').value);
  if (vuln) data.vulnerable = vuln; else delete data.vulnerable;
  const senses = efParseCsvList(document.getElementById('ef-senses').value);
  if (senses) data.senses = senses; else delete data.senses;
  const passive = parseInt(document.getElementById('ef-passive').value);
  if (!isNaN(passive)) data.passive = passive; else delete data.passive;
  const langs = efParseCsvList(document.getElementById('ef-languages').value);
  if (langs) data.languages = langs; else delete data.languages;
  const initBonusVal = parseInt(document.getElementById('ef-init-bonus').value) || 0;
  if (initBonusVal !== 0) data.initBonus = initBonusVal; else delete data.initBonus;
  // Unique: one token at a time on the table, called by its own name.
  if (document.getElementById('ef-unique').checked) data.unique = true; else delete data.unique;
  const initProf = document.getElementById('ef-init-prof').checked;
  if (initProf) {
    data.initiative = { ...(data.initiative || {}), proficiency: true };
  } else if (data.initiative && data.initiative.proficiency) {
    delete data.initiative.proficiency;
    if (!Object.keys(data.initiative).length) delete data.initiative;
  }

  // Dynamic sections
  const trait = efReadSection('ef-traits'); if (trait.length) data.trait = trait; else delete data.trait;
  const action = efReadSection('ef-actions'); if (action.length) data.action = action; else delete data.action;
  const bonus = efReadSection('ef-bonus'); if (bonus.length) data.bonus = bonus; else delete data.bonus;
  const reaction = efReadSection('ef-reactions'); if (reaction.length) data.reaction = reaction; else delete data.reaction;
  const legendary = efReadSection('ef-legendary'); if (legendary.length) data.legendary = legendary; else delete data.legendary;
  // Remove spellcasting entries that were merged into the sections above
  if (data.spellcasting) {
    data.spellcasting = data.spellcasting.filter(sc => {
      const k = (sc.displayAs || 'trait').toLowerCase();
      return !['action', 'bonus', 'reaction', 'legendary'].includes(k);
    });
    if (!data.spellcasting.length) delete data.spellcasting;
  }

  const crForApi = typeof data.cr === 'object' ? data.cr.cr : (data.cr || '?');
  errEl.textContent = '';
  try {
    let res;
    if (editingMonsterId) {
      res = await fetch(`/api/monsters/${editingMonsterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ name, cr: String(crForApi), dataJson: JSON.stringify(data) })
      });
    } else {
      res = await fetch('/api/monsters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ monsters: [data] })
      });
    }
    if (res.status === 401) { location.href = '/dm.html'; return; }
    if (!res.ok) { errEl.textContent = 'Failed to save.'; return; }
    // Upload portrait if changed (_editPortraitData='' means remove, string = new image)
    if (_editPortraitData !== null && editingMonsterId) {
      await fetch(`/api/monsters/${editingMonsterId}/portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ dataUrl: _editPortraitData })
      });
    }
    closeEditMonsterModal();
    await loadMonsters();
    showStatus(editingMonsterId ? `${name} updated.` : `${name} added.`, false);
  } catch { errEl.textContent = 'Network error.'; }
}

// ── Edit-modal portrait helpers ───────────────────────────────────────────────
function _setEfPortraitUI(dataUrl) {
  const preview = document.getElementById('ef-portrait-preview');
  const none = document.getElementById('ef-portrait-none');
  const clearBtn = document.getElementById('ef-portrait-clear');
  if (dataUrl) {
    preview.src = dataUrl;
    preview.style.display = '';
    none.style.display = 'none';
    clearBtn.style.display = '';
  } else {
    preview.src = '';
    preview.style.display = 'none';
    none.style.display = '';
    clearBtn.style.display = 'none';
  }
}
function efPickPortrait() {
  document.getElementById('ef-portrait-input').click();
}
function efClearPortrait() {
  _editPortraitData = '';
  _setEfPortraitUI(null);
}
function efPortraitChosen(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _editPortraitData = e.target.result;
    _setEfPortraitUI(_editPortraitData);
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
// The monster stat editor holds dozens of fields — Escape must ask first.
window.addEventListener('DOMContentLoaded', () => {
  if (!window.guardModal) return;
  guardModal('edit-modal', closeEditMonsterModal, { backdrop: false });
  guardModal('init-modal', closeInitModal,        { backdrop: false });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('info-modal').style.display !== 'none') closeInfoModal();
    if (document.getElementById('init-modal').style.display !== 'none') closeInitModal();
    if (document.getElementById('edit-modal').style.display !== 'none') closeEditMonsterModal();
  }
});

// ── Auto-auth from the stored session ─────────────────────────────────────────
// A tab already logged in as DM unlocks without asking again, once the server
// confirms the session is still live.
_gate.start();
