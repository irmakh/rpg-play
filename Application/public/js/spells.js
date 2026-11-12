// Written by Irmak Hakman — 2026-11-12 12:52
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── DM spell library (spells.html) ────────────────────────────────────────────
// Master-detail over GET /api/spells. Imports 5etools JSON (one spell, a list,
// or a whole file; several files at once) through POST /api/spells/import, and
// deletes through POST /api/spells/delete. Players add spells to their sheets
// from this same library (index-spells.js).

let masterPw = '';
let library = [];          // rows from GET /api/spells: { id, name, source, level, school, data, addedBy }
let curId = null;          // the spell open on the right
const selected = new Set();
let _importTexts = [];     // files chosen in the import modal, read as text

const $ = id => document.getElementById(id);
const ico = name => `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

function showStatus(msg, isError) {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), 'X-Master-Password': masterPw };
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers });
}

function handleUnauth() {
  masterPw = '';
  $('gate').style.display = '';
  $('main-content').style.display = 'none';
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const _gate = AuthUI.dmGate({
  capEl:   $('gate-cap'),
  pwInput: $('gate-pw'),
  errEl:   $('gate-err'),
  onUnlock: async (token) => {
    masterPw = token;
    $('gate').style.display = 'none';
    $('main-content').style.display = '';
    await loadSpells();
  },
});
function authenticate() { return _gate.submit(); }

// ── Loading ───────────────────────────────────────────────────────────────────
async function loadSpells() {
  try {
    const res = await api('/api/spells');
    if (res.status === 401) { handleUnauth(); return; }
    if (!res.ok) { showStatus('Could not load the spell library.', true); return; }
    library = await res.json();
    for (const id of [...selected]) if (!library.some(r => r.id === id)) selected.delete(id);
    if (curId && !library.some(r => r.id === curId)) curId = null;
    fillFilters();
    renderList();
    renderDetail();
  } catch { showStatus('Network error.', true); }
}

function fillFilters() {
  const classes = new Set(), books = new Set();
  for (const r of library) {
    spellClasses(r.data).forEach(c => classes.add(c));
    if (r.source) books.add(r.source);
  }
  const keep = (sel, values, blank) => {
    const was = sel.value;
    sel.innerHTML = `<option value="">${blank}</option>`
      + [...values].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = values.has(was) ? was : '';
  };
  keep($('sl-class'), classes, 'Any class');
  keep($('sl-book'), books, 'Any book');
  $('sl-total').textContent = library.length ? `${library.length} spell${library.length === 1 ? '' : 's'}` : '';
}

// ── List ──────────────────────────────────────────────────────────────────────
function shownRows() {
  const q = $('sl-search').value.trim().toLowerCase();
  const lvl = $('sl-level').value;
  const cls = $('sl-class').value;
  const book = $('sl-book').value;
  return library.filter(r =>
    (!q || r.name.toLowerCase().includes(q))
    && (lvl === '' || String(r.level) === lvl)
    && (!cls || spellClasses(r.data).includes(cls))
    && (!book || r.source === book));
}

function renderList() {
  const list = $('sl-list');
  const rows = shownRows();
  $('sl-shown').textContent = library.length ? `${rows.length} shown` : '';
  $('sl-all').checked = rows.length > 0 && rows.every(r => selected.has(r.id));
  if (!library.length) {
    list.innerHTML = '<div class="app-empty">The library is empty.<br>Import a spell or a 5etools spell file to begin.</div>';
  } else if (!rows.length) {
    list.innerHTML = '<div class="app-empty">No spells match.</div>';
  } else {
    // Sorted by level, then name; one header per level.
    let html = '', lastLvl = null;
    for (const r of rows) {
      if (r.level !== lastLvl) {
        lastLvl = r.level;
        html += `<div class="sl-lvl">${r.level === 0 ? 'Cantrips' : 'Level ' + r.level}</div>`;
      }
      const idLit = esc(JSON.stringify(r.id));
      html += `<div class="app-row${r.id === curId ? ' selected' : ''}" onclick="openSpell(${idLit})">
        <input type="checkbox" class="sl-chk" ${selected.has(r.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleSelect(${idLit}, this.checked)" aria-label="Select ${esc(r.name)}">
        <span class="app-row-name">${esc(r.name)}</span>
        <span class="app-row-meta">${esc(spellSchoolName(spellSchoolCode(r.school)) || '')}${r.source ? ' · ' + esc(r.source) : ''}</span>
      </div>`;
    }
    list.innerHTML = html;
  }
  const n = selected.size;
  const del = $('sl-del-sel');
  del.style.display = n ? '' : 'none';
  del.innerHTML = `${ico('trash')} Delete ${n}`;
}

function toggleSelect(id, on) {
  if (on) selected.add(id); else selected.delete(id);
  renderList();
}

function selectAllShown(on) {
  for (const r of shownRows()) { if (on) selected.add(r.id); else selected.delete(r.id); }
  renderList();
}

// ── Detail ────────────────────────────────────────────────────────────────────
function openSpell(id) {
  curId = id;
  renderList();
  renderDetail();
}

function renderDetail() {
  const box = $('sl-detail');
  const r = library.find(x => x.id === curId);
  if (!r) { box.innerHTML = '<div class="app-empty">Select a spell to read it.</div>'; return; }
  const s = spellFrom5e(r.data, r.id);
  const school = spellSchoolName(s.school);
  const sub = (s.level === 0 ? `${school} cantrip` : `Level ${s.level} ${school.toLowerCase()}`)
    + (s.ritual ? ' (ritual)' : '');
  const facts = [
    ['Casting time', s.castText || spellCastLabel(s)],
    ['Range', s.range],
    ['Components', spellComponentsLabel(s)],
    ['Duration', (s.conc ? 'Concentration, ' : '') + s.duration],
  ].filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join('');
  const classes = spellClasses(r.data);
  const idLit = esc(JSON.stringify(r.id));
  box.innerHTML = `<article class="sl-card">
    <header>
      <h2>${esc(s.name)}</h2>
      <div class="sl-sub">${esc(sub)}${s.book ? ' · ' + esc(s.book) : ''}</div>
    </header>
    <div class="sl-facts">${facts}</div>
    <div class="sl-text">${spellDescHTML(s) || '<p class="sl-none">No description in this spell&rsquo;s JSON.</p>'}</div>
    ${classes.length ? `<div class="sl-classes"><span>Classes</span>${classes.map(c => `<span class="sl-chip">${esc(c)}</span>`).join('')}</div>` : ''}
    <footer>
      <span class="sl-added">${r.addedBy ? 'Added by ' + esc(r.addedBy) : ''}${r.updatedAt ? ' · updated ' + esc(new Date(r.updatedAt).toLocaleDateString()) : ''}</span>
      <button class="btn danger sm" onclick="deleteSpells([${idLit}])">${ico('trash')} Delete</button>
    </footer>
  </article>`;
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteSpells(ids) {
  if (!ids.length) return;
  const names = ids.map(id => library.find(r => r.id === id)?.name).filter(Boolean);
  const what = ids.length === 1 ? `"${names[0] || 'this spell'}"` : `${ids.length} spells`;
  if (!confirm(`Delete ${what} from the library? Character sheets that already have them keep their copy.`)) return;
  try {
    const res = await api('/api/spells/delete', { method: 'POST', body: JSON.stringify({ ids }) });
    if (res.status === 401) { handleUnauth(); return; }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { showStatus(r.error || 'Delete failed.', true); return; }
    ids.forEach(id => selected.delete(id));
    showStatus(`Deleted ${r.removed} spell${r.removed === 1 ? '' : 's'}.`);
    await loadSpells();
  } catch { showStatus('Network error.', true); }
}

function deleteSelected() { deleteSpells([...selected]); }

// ── Import ────────────────────────────────────────────────────────────────────
function openImportModal() {
  _importTexts = [];
  $('import-text').value = '';
  $('import-status').textContent = '';
  $('import-modal').style.display = 'flex';
  setTimeout(() => $('import-text').focus(), 30);
}

function closeImportModal() {
  $('import-modal').style.display = 'none';
  _importTexts = [];
}

function onImportFiles(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  _importTexts = [];
  let left = files.length;
  for (const f of files) {
    const reader = new FileReader();
    reader.onload = e => {
      _importTexts.push({ name: f.name, text: String(e.target.result || '') });
      if (--left === 0) {
        $('import-status').textContent = files.length === 1 ? `${files[0].name} is ready.` : `${files.length} files are ready.`;
        $('import-text').placeholder = 'The chosen files will be imported.';
      }
    };
    reader.readAsText(f);
  }
}

/** The spell objects inside parsed JSON, unwrapped the way the server does it. */
function spellListOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.spell)) return parsed.spell;
  if (parsed && Array.isArray(parsed.spells)) return parsed.spells;
  return parsed && typeof parsed === 'object' ? [parsed] : [];
}

// Big files are sent in pieces so no single request is huge.
const IMPORT_BATCH = 500;

async function runImport() {
  const status = $('import-status');
  const sources = _importTexts.length ? _importTexts
    : [{ name: 'pasted JSON', text: $('import-text').value }];
  if (!sources.some(s => s.text.trim())) { status.textContent = 'Paste some JSON or choose a file first.'; return; }

  let all = [];
  for (const src of sources) {
    if (!src.text.trim()) continue;
    try { all = all.concat(spellListOf(JSON.parse(src.text))); }
    catch { status.textContent = `${src.name} is not valid JSON.`; return; }
  }
  if (!all.length) { status.textContent = 'No spells found in that JSON.'; return; }

  const btn = $('import-go');
  btn.disabled = true;
  const total = { imported: 0, updated: 0, skipped: 0, skips: [] };
  try {
    for (let i = 0; i < all.length; i += IMPORT_BATCH) {
      status.textContent = `Importing ${Math.min(i + IMPORT_BATCH, all.length)} of ${all.length}…`;
      const res = await api('/api/spells/import', {
        method: 'POST', body: JSON.stringify({ spells: all.slice(i, i + IMPORT_BATCH) }),
      });
      if (res.status === 401) { handleUnauth(); return; }
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = r.error || 'The import failed.'; return; }
      total.imported += r.imported; total.updated += r.updated; total.skipped += r.skipped;
      total.skips.push(...(r.skips || []));
    }
    const parts = [`${total.imported} new`];
    if (total.updated) parts.push(`${total.updated} updated`);
    if (total.skipped) parts.push(`${total.skipped} skipped`);
    status.textContent = parts.join(', ') + '.'
      + (total.skips.length ? ' Skipped: ' + total.skips.slice(0, 4).join('; ') + (total.skips.length > 4 ? '…' : '') : '');
    _importTexts = [];
    $('import-text').value = '';
    await loadSpells();
  } catch {
    status.textContent = 'Network error.';
  } finally {
    btn.disabled = false;
  }
}

// ── Import whole books (5etools) ─────────────────────────────────────────────
// GET /api/spells/books lists them; POST /api/spells/import-books brings every
// spell of the ticked books into THIS campaign's library. The server fetches
// the files into memory, imports and discards them.
let books = null;

async function openBooksModal() {
  $('books-modal').style.display = 'flex';
  $('books-status').textContent = '';
  try {
    const c = await api('/api/campaign/current').then(r => (r.ok ? r.json() : null));
    if (c && c.name) $('books-camp').textContent = c.name;
  } catch {}
  if (books) { renderBooks(); return; }
  $('books-list').innerHTML = '<div class="sl-hint">Loading the list of books…</div>';
  try {
    const res = await api('/api/spells/books');
    if (res.status === 401) { handleUnauth(); return; }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { $('books-list').innerHTML = `<div class="sl-hint">${esc(r.error || 'Could not load the list of books.')}</div>`; return; }
    books = r;
    renderBooks();
  } catch {
    $('books-list').innerHTML = '<div class="sl-hint">Network error.</div>';
  }
}

function closeBooksModal() { $('books-modal').style.display = 'none'; }

function renderBooks() {
  // How many of each book's spells the library already holds, by book code.
  const have = {};
  for (const r of library) have[r.source] = (have[r.source] || 0) + 1;
  $('books-list').innerHTML = books.map(b => `<label class="sl-book">
      <input type="checkbox" value="${esc(b.code)}" onchange="booksChanged()">
      <span class="sl-book-name">${esc(b.name)}</span>
      <span class="sl-book-code">${esc(b.code)}</span>
      ${have[b.code] ? `<span class="sl-book-have">${have[b.code]} in library</span>
        <button type="button" class="btn sm danger" onclick="event.preventDefault();removeSpellBook('${escJs(b.code)}')" title="Remove this book's spells from the library">Remove</button>` : ''}
    </label>`).join('');
  booksChanged();
}

// Spells a character sheet took stay in the library; the server says how many.
async function removeSpellBook(code) {
  const n = library.filter(r => r.source === code).length;
  if (!await confirmDialog({
    title: `Remove ${code}?`,
    message: `Remove the ${n} spells of ${code} from this campaign's library?\n\nSpells a character has taken stay, so their sheets keep working. You can import the book again at any time.`,
    confirmText: 'Remove book', danger: true,
  })) return;
  const status = $('books-status');
  try {
    const res = await api(`/api/spells/books/${encodeURIComponent(code)}`, { method: 'DELETE' });
    if (res.status === 401) { handleUnauth(); return; }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = r.error || 'Could not remove the book.'; return; }
    status.textContent = `Removed ${r.removed || 0} spells of ${code}.` +
      (r.kept ? ` Kept ${r.kept} that characters have taken.` : '');
    await loadSpells();
    renderBooks();
  } catch {
    status.textContent = 'Network error.';
  }
}

function chosenBooks() {
  return [...document.querySelectorAll('#books-list input[type=checkbox]:checked')].map(i => i.value);
}

function setAllBooks(on) {
  document.querySelectorAll('#books-list input[type=checkbox]').forEach(i => { i.checked = on; });
  booksChanged();
}

function booksChanged() {
  const n = chosenBooks().length;
  const btn = $('books-go');
  btn.disabled = !n;
  btn.textContent = n ? `Import ${n} book${n === 1 ? '' : 's'}` : 'Import';
}

async function runBooksImport() {
  const codes = chosenBooks();
  if (!codes.length) return;
  const btn = $('books-go');
  const status = $('books-status');
  btn.disabled = true;
  status.textContent = `Downloading and importing ${codes.length} book${codes.length === 1 ? '' : 's'}…`;
  try {
    const res = await api('/api/spells/import-books', { method: 'POST', body: JSON.stringify({ books: codes }) });
    if (res.status === 401) { handleUnauth(); return; }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = r.error || 'The import failed.'; return; }
    const per = (r.books || []).map(b => `${b.code} ${b.count}`).join(', ');
    status.textContent = `${r.imported} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (reprint references)` : ''}. ${per ? '(' + per + ')' : ''}`;
    await loadSpells();
    renderBooks();
    // renderBooks() clears the ticks; keep what was just imported ticked off.
  } catch {
    status.textContent = 'Network error.';
  } finally {
    booksChanged();
  }
}

// "/" jumps to the search box, as on the treasury page.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if ($('main-content').style.display === 'none') return;
  e.preventDefault();
  $('sl-search').focus();
});

_gate.start();

connectRealtime({
  notification: (p) => { typeof handleNotification === 'function' && handleNotification(p); },
  spells: () => { if (masterPw) loadSpells(); },
});
