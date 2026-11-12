// Written by Irmak Hakman — 2026-11-12 13:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The treasury's 3rd Party items: magic items from books (server/routes/
 * book-items.js).
 *
 *   Books…        import whole 5etools books, upload a 5etools homebrew file,
 *                 remove a book. All per campaign.
 *   From book…    (in a pile) search the catalogue, read an item, and add a
 *                 hidden copy to the pile. The copy is an ordinary treasury
 *                 item from then on.
 *
 * Uses treasury.js's api(), $, esc(), escJs(), curPile, loadItems(),
 * handleUnauth(), and lib/confirm-dialog.js.
 */

const TB_RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies', 'unknown (magic)'];
const TB_KINDS = [['weapon', 'Weapon'], ['armor', 'Armour'], ['shield', 'Shield'], ['potion', 'Potion'], ['wondrous', 'Wondrous'], ['other', 'Other']];
const TB_PAGE = 60;

let tbSources = [];          // [{ source, bookName, origin, count }] this campaign holds
let tbBooks = null;          // 5etools books with magic items, loaded when Books… first opens
let tbFound = { rows: [], total: 0 };
let tbSel = null;            // { id, name, fields, bookName } shown in the preview
let tbTimer = null;
let tbAdded = 0;

const tbRarityLabel = r => (r === 'unknown (magic)' ? 'rarity unknown' : r || '');
const tbKindLabel = k => (TB_KINDS.find(x => x[0] === k) || [k, 'Other'])[1];

async function tbLoadSources() {
  try {
    const r = await api('/api/book-items/sources');
    if (r.status === 401) { handleUnauth(); return; }
    if (r.ok) tbSources = await r.json();
  } catch {}
}

// ── Books… ────────────────────────────────────────────────────────────────────
async function openBookItemBooks() {
  $('tb-books-modal').style.display = 'flex';
  $('tb-books-status').textContent = '';
  await tbLoadSources();
  if (tbBooks) { tbRenderBooks(); return; }
  $('tb-books-list').innerHTML = '<div class="tb-hint">Loading the list of books…</div>';
  try {
    const r = await api('/api/book-items/books');
    if (r.status === 401) { handleUnauth(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $('tb-books-list').innerHTML = `<div class="tb-hint">${esc(d.error || 'Could not load the list of books.')}</div>`; return; }
    tbBooks = d;
    tbRenderBooks();
  } catch { $('tb-books-list').innerHTML = '<div class="tb-hint">Network error.</div>'; }
}
function closeBookItemBooks() { $('tb-books-modal').style.display = 'none'; }

function tbRenderBooks() {
  const ticked = new Set(tbChosenBooks());
  const f = ($('tb-books-filter').value || '').trim().toLowerCase();
  const have = Object.fromEntries(tbSources.map(s => [s.source, s]));
  const removeBtn = code => `<button type="button" class="btn sm danger" onclick="event.preventDefault();removeBookItemBook('${escJs(code)}')" title="Remove this book's items from the catalogue">Remove</button>`;
  // Uploaded homebrew books are not in the 5etools list: shown first, remove only.
  const known = new Set((tbBooks || []).map(b => b.code));
  const uploaded = tbSources.filter(s => !known.has(s.source))
    .filter(s => !f || (s.bookName || '').toLowerCase().includes(f) || s.source.toLowerCase().includes(f))
    .map(s => `<div class="tb-book">
        <span class="tb-book-name">${esc(s.bookName || s.source)}</span>
        <span class="tb-book-code">${esc(s.source)}</span>
        <span class="tb-book-have">${s.count} imported · ${s.origin === 'upload' ? 'uploaded' : '5etools'}</span>
        ${removeBtn(s.source)}
      </div>`).join('');
  const list = (tbBooks || []).filter(b => !f || b.name.toLowerCase().includes(f) || b.code.toLowerCase().includes(f))
    .map(b => `<label class="tb-book">
        <input type="checkbox" value="${esc(b.code)}" ${ticked.has(b.code) ? 'checked' : ''} onchange="tbBooksChanged()">
        <span class="tb-book-name">${esc(b.name)}</span>
        <span class="tb-book-code">${esc(b.code)}</span>
        <span class="tb-book-count">${b.count} item${b.count === 1 ? '' : 's'}</span>
        ${have[b.code] ? `<span class="tb-book-have">${have[b.code].count} imported</span>${removeBtn(b.code)}` : ''}
      </label>`).join('');
  $('tb-books-list').innerHTML = (uploaded + list) || '<div class="tb-hint">No books match.</div>';
  tbBooksChanged();
}

function tbChosenBooks() { return [...document.querySelectorAll('#tb-books-list input[type=checkbox]:checked')].map(i => i.value); }
function tbSetAllBooks(on) { document.querySelectorAll('#tb-books-list input[type=checkbox]').forEach(i => { i.checked = on; }); tbBooksChanged(); }
function tbBooksChanged() {
  const n = tbChosenBooks().length;
  const btn = $('tb-books-go');
  btn.disabled = !n;
  btn.textContent = n ? `Import ${n} book${n === 1 ? '' : 's'}` : 'Import';
}

const tbSummary = r => `${r.imported} new, ${r.updated} updated` + ((r.books || []).length ? ` (${r.books.map(b => `${b.code} ${b.count}`).join(', ')})` : '') + '.';

async function runBookItemImport() {
  const codes = tbChosenBooks();
  if (!codes.length) return;
  const btn = $('tb-books-go');
  const status = $('tb-books-status');
  btn.disabled = true;
  status.textContent = `Downloading and importing ${codes.length} book${codes.length === 1 ? '' : 's'}…`;
  try {
    const r = await api('/api/book-items/import-books', { method: 'POST', body: JSON.stringify({ books: codes }) });
    if (r.status === 401) { handleUnauth(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = d.error || 'The import failed.'; return; }
    status.textContent = tbSummary(d);
    await tbLoadSources();
    document.querySelectorAll('#tb-books-list input[type=checkbox]').forEach(i => { i.checked = false; });
    tbRenderBooks();
  } catch { status.textContent = 'Network error.'; }
  finally { tbBooksChanged(); }
}

async function uploadBookItemFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const status = $('tb-books-status');
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { status.textContent = `${file.name} is not valid JSON.`; return; }
  status.textContent = `Importing ${file.name}…`;
  try {
    const r = await api('/api/book-items/upload', { method: 'POST', body: JSON.stringify({ file: json }) });
    if (r.status === 401) { handleUnauth(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = d.error || 'The upload failed.'; return; }
    status.textContent = `${file.name}: ${tbSummary(d)}`
      + (d.skipped ? ` ${d.skipped} item${d.skipped === 1 ? '' : 's'} without a rarity skipped.` : '')
      + (d.unresolved ? ` ${d.unresolved} could not be resolved.` : '');
    await tbLoadSources();
    tbRenderBooks();
  } catch { status.textContent = 'Network error.'; }
}

async function removeBookItemBook(code) {
  const s = tbSources.find(x => x.source === code);
  const n = s ? s.count : 0;
  const name = s && s.bookName && s.bookName !== code ? `${s.bookName} (${code})` : code;
  if (!await confirmDialog({
    title: `Remove ${code}?`,
    message: `Remove the ${n} 3rd Party items of ${name} from this campaign's catalogue?\n\nItems already added to treasury piles are separate copies and stay as they are. You can import the book again at any time.`,
    confirmText: 'Remove book', danger: true,
  })) return;
  const status = $('tb-books-status');
  try {
    const r = await api(`/api/book-items/books/${encodeURIComponent(code)}`, { method: 'DELETE' });
    if (r.status === 401) { handleUnauth(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = d.error || 'Could not remove the book.'; return; }
    status.textContent = `Removed ${d.removed || 0} items of ${code}.`;
    await tbLoadSources();
    tbRenderBooks();
  } catch { status.textContent = 'Network error.'; }
}

// ── From book… ────────────────────────────────────────────────────────────────
async function openBookItemPicker() {
  if (curPile === null) return;
  tbAdded = 0;
  tbSel = null;
  $('tb-pick-pile').textContent = curPile || 'Unsorted';
  $('tb-pick-status').textContent = '';
  $('tb-pick-modal').style.display = 'flex';
  await tbLoadSources();
  const sel = $('tb-pick-book');
  const keep = sel.value;
  sel.innerHTML = '<option value="">All books</option>' + tbSources
    .map(s => `<option value="${esc(s.source)}">${esc(s.bookName || s.source)} (${s.count})</option>`).join('');
  if (tbSources.some(s => s.source === keep)) sel.value = keep;
  tbRenderPreview();
  tbSearch(true);
  setTimeout(() => $('tb-pick-q').focus(), 0);
}

function closeBookItemPicker() {
  $('tb-pick-modal').style.display = 'none';
  if (tbAdded) loadItems();
}

function tbSearchSoon() { clearTimeout(tbTimer); tbTimer = setTimeout(() => tbSearch(true), 200); }

async function tbSearch(fresh) {
  if (!tbSources.length) {
    $('tb-pick-list').innerHTML = `<div class="tb-hint">No 3rd Party items in this campaign yet.<br><br>
      <button type="button" class="btn primary" onclick="closeBookItemPicker();openBookItemBooks()">Import books…</button></div>`;
    $('tb-pick-count').textContent = '';
    return;
  }
  const qs = new URLSearchParams({
    q: $('tb-pick-q').value.trim(), source: $('tb-pick-book').value, rarity: $('tb-pick-rarity').value,
    kind: $('tb-pick-kind').value, limit: TB_PAGE, offset: fresh ? 0 : tbFound.rows.length,
  });
  try {
    const r = await api(`/api/book-items?${qs}`);
    if (r.status === 401) { handleUnauth(); return; }
    if (!r.ok) { $('tb-pick-list').innerHTML = '<div class="tb-hint">Could not search.</div>'; return; }
    const d = await r.json();
    tbFound = fresh ? d : { rows: [...tbFound.rows, ...d.rows], total: d.total };
    tbRenderList();
  } catch { $('tb-pick-list').innerHTML = '<div class="tb-hint">Network error.</div>'; }
}

function tbRenderList() {
  const rows = tbFound.rows;
  $('tb-pick-count').textContent = `${tbFound.total} item${tbFound.total === 1 ? '' : 's'}`;
  if (!rows.length) { $('tb-pick-list').innerHTML = '<div class="tb-hint">No items match.</div>'; return; }
  $('tb-pick-list').innerHTML = rows.map(r => `<div class="tb-row${tbSel && tbSel.id === r.id ? ' on' : ''}" role="button" tabindex="0"
        onclick="tbPick('${escJs(r.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();tbPick('${escJs(r.id)}')}">
        <span class="tb-row-name">${esc(r.name)}</span>
        <span class="tb-row-meta"><span class="tb-rar r-${esc(r.rarity.replace(/[^a-z]+/g, '-'))}">${esc(tbRarityLabel(r.rarity))}</span> · ${esc(tbKindLabel(r.kind))} · ${esc(r.source)}</span>
      </div>`).join('')
    + (rows.length < tbFound.total ? `<div class="tb-more"><button type="button" class="btn sm" onclick="tbSearch(false)">Show more (${tbFound.total - rows.length} left)</button></div>` : '');
}

async function tbPick(id) {
  try {
    const r = await api(`/api/book-items/${encodeURIComponent(id)}`);
    if (r.status === 401) { handleUnauth(); return; }
    if (!r.ok) return;
    tbSel = await r.json();
    tbRenderList();
    tbRenderPreview();
  } catch {}
}

function tbRenderPreview() {
  const box = $('tb-pick-prev');
  const go = $('tb-pick-go');
  if (!tbSel) {
    box.innerHTML = '<div class="tb-hint">Pick an item to read it.</div>';
    go.disabled = true;
    go.textContent = 'Add to pile';
    return;
  }
  const f = tbSel.fields;
  const bits = [];
  if (parseInt(f.weaponAtk)) bits.push(`${parseInt(f.weaponAtk) > 0 ? '+' : ''}${parseInt(f.weaponAtk)} weapon`);
  if (f.weaponDmg) bits.push(f.weaponDmg);
  if ((f.weaponProperties || []).length) bits.push(f.weaponProperties.join(', '));
  if (f.itemType === 'armor' && f.acBase !== 10) bits.push(`AC ${f.acBase}`);
  if (f.acBonus) bits.push(`AC ${f.acBonus > 0 ? '+' : ''}${f.acBonus}`);
  if (f.spellAtkBonus) bits.push(`spell attack +${f.spellAtkBonus}`);
  if (f.spellDcBonus) bits.push(`spell DC +${f.spellDcBonus}`);
  if (f.charges) bits.push(`${f.charges} charges${f.chargesRecharge ? ', recharge daily' : ''}`);
  if (f.valueCp) bits.push(`${(f.valueCp / 100).toLocaleString()} gp`);
  box.innerHTML = `<div class="tb-prev-name">${esc(tbSel.name)}</div>
    <div class="tb-prev-book">${esc(tbSel.bookName || tbSel.source)}</div>
    ${bits.length ? `<div class="tb-prev-stats">${esc(bits.join(' · '))}</div>` : ''}
    <div class="tb-prev-desc">${esc(f.description || '')}</div>`;
  go.disabled = false;
  go.textContent = `Add to ${curPile || 'Unsorted'}`;
}

async function addBookItemToPile() {
  if (!tbSel || curPile === null) return;
  const go = $('tb-pick-go');
  go.disabled = true;
  try {
    const r = await api(`/api/book-items/${encodeURIComponent(tbSel.id)}/copy`, { method: 'POST', body: JSON.stringify({ tag: curPile || '' }) });
    if (r.status === 401) { handleUnauth(); return; }
    if (!r.ok) { $('tb-pick-status').textContent = 'Could not add it.'; return; }
    tbAdded++;
    $('tb-pick-status').textContent = `Added ${tbSel.name} to ${curPile || 'Unsorted'}, hidden. ${tbAdded > 1 ? `${tbAdded} added so far.` : ''}`;
    loadItems();
  } catch { $('tb-pick-status').textContent = 'Network error.'; }
  finally { go.disabled = false; }
}

// Another tab imported or removed a book: refresh what is open.
async function tbOnUpdated() {
  await tbLoadSources();
  if ($('tb-books-modal').style.display !== 'none') tbRenderBooks();
  if ($('tb-pick-modal').style.display !== 'none') tbSearch(true);
}
