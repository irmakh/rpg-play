// Written by Irmak Hakman — 2026-11-12 18:50
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Spells tab ────────────────────────────────────────────────────────────────
// The character's spells live in `spells` (index-state.js), a list of spell
// objects (js/lib/spell-data.js), saved as `_spells` by collectData(). Every
// change here re-renders the list and schedules the autosave.
//
// Three ways in:
//   + Add spell      typed by hand (the edit modal)
//   From library     the campaign's spell library (GET /api/spells)
//   Import JSON      5etools JSON, which also goes into the library
//                    (POST /api/spells/import)

let _spellFilter = 'all';            // 'all' | 'ready' | 'unprepared'
const _spellOpen = new Set();        // ids whose details are shown
let _spmEditId = null;               // id in the edit modal, null = new
let _spellLib = null;                // library rows, loaded when the picker opens
const _splChosen = new Set();        // library ids ticked in the picker

const SPELL_ADD_TO_SHEET_MAX = 25;   // an import bigger than this goes to the library only

const _spId = id => esc(JSON.stringify(id));
const _spIco = name => `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

/** Does this character prepare spells? The sheet's "no preparing" box says no. */
function _spPrepares() {
  const el = document.querySelector('[data-key="sp-no-prep"]');
  return !(el && el.checked);
}

/** The sheet's class fields, which decide the Warlock / Sorcerer rules. */
function _spClassData() {
  const v = k => document.querySelector(`[data-key="${k}"]`)?.value || '';
  const d = { class: v('class'), subclass: v('subclass') };
  for (const k of ['pact-slots', 'pact-level', 'pact-used', 'sorc-points', 'sorc-used']) d[k] = v(k);
  return d;
}

/**
 * Show the Pact Magic / Sorcery Points cards for a Warlock / Sorcerer, keep the
 * "no preparing" box ticked and locked for them (they know their spells), and
 * refresh the points left.
 */
function updateClassCards() {
  const f = spellCasterFlags(_spClassData());
  const pact = document.getElementById('pact-card');
  const sorc = document.getElementById('sorc-card');
  if (pact) pact.style.display = f.warlock ? '' : 'none';
  if (sorc) sorc.style.display = f.sorcerer ? '' : 'none';
  const box = document.querySelector('[data-key="sp-no-prep"]');
  const hint = document.getElementById('sp-noprep-hint');
  if (box) {
    const locked = f.warlock || f.sorcerer;
    if (locked && !box.checked) { box.checked = true; scheduleAutoSave(); }
    box.disabled = locked;
    if (hint) hint.textContent = locked ? `(${f.warlock ? 'Warlock' : 'Sorcerer'}: every spell is always ready)` : '(Warlock, Sorcerer…): every spell is always ready';
  }
  const left = document.getElementById('sorc-left');
  if (left) {
    const s = spellSorcFrom(_spClassData());
    left.value = s ? `${s.left} / ${s.max}` : '';
  }
}

function fillPactFromLevel() { autoFillSlots(true); }

/**
 * Spell slot totals, pact slots and sorcery points from Level and Class
 * (spellAutoSlots in spell-data.js; "Wizard 5 / Cleric 3" multiclasses). Runs
 * by itself whenever Level, Class or Subclass changes — the totals always
 * follow them — and from the Fill from level button. "Used" counts are kept,
 * never above the new total. A sheet with no spellcasting class is left alone.
 */
function autoFillSlots(fromButton) {
  const v = k => document.querySelector(`[data-key="${k}"]`)?.value || '';
  const r = spellAutoSlots({ class: v('class'), subclass: v('subclass'), level: v('level') });
  if (!r.known) {
    if (fromButton) setStatus('No spellcasting class in the Class field (e.g. "Wizard" or "Wizard 5 / Cleric 3").', true);
    return false;
  }
  const clampUsed = (usedKey, total) => { if (_num(usedKey) > total) _setNum(usedKey, total); };
  for (let i = 1; i <= 9; i++) {
    _setNum(`slot-${i}-total`, r.slots[i - 1]);
    clampUsed(`slot-${i}-used`, r.slots[i - 1]);
  }
  if (r.pact) { _setNum('pact-slots', r.pact.slots); _setNum('pact-level', r.pact.level); clampUsed('pact-used', r.pact.slots); }
  if (r.sorc !== null) { _setNum('sorc-points', r.sorc); clampUsed('sorc-used', r.sorc); }
  updateClassCards();
  renderSpells();
  scheduleAutoSave();
  if (fromButton) setStatus('Slots filled from level.');
  return true;
}

// Font of Magic. Slot -> points: a slot of the level is spent, its level in
// points comes back (never above the maximum). Points -> slot: the points are
// spent and a SPENT slot of that level comes back (the sheet keeps no slots
// beyond each level's total, so a level with none spent cannot take one).
function _fontMsg(t) { const el = document.getElementById('font-msg'); if (el) el.textContent = t; }
function _num(k) { return parseInt(document.querySelector(`[data-key="${k}"]`)?.value, 10) || 0; }
function _setNum(k, v) { const el = document.querySelector(`[data-key="${k}"]`); if (el) el.value = String(v); }

function fontSlotToPoints() {
  const L = parseInt(document.getElementById('font-level')?.value, 10) || 1;
  const s = spellSorcFrom(_spClassData());
  if (!s) return _fontMsg('Set your sorcery point maximum first.');
  if (_num(`slot-${L}-total`) - _num(`slot-${L}-used`) <= 0) return _fontMsg(`No level ${L} slot left to spend.`);
  if (!s.used) return _fontMsg('Your sorcery points are already full.');
  _setNum(`slot-${L}-used`, _num(`slot-${L}-used`) + 1);
  _setNum('sorc-used', Math.max(0, s.used - L));
  _fontMsg(`Level ${L} slot spent: +${Math.min(L, s.used)} points.`);
  updateClassCards(); renderSpells(); scheduleAutoSave();
}

function fontPointsToSlot() {
  const L = parseInt(document.getElementById('font-level')?.value, 10) || 1;
  const cost = SORC_SLOT_COST[L];
  const s = spellSorcFrom(_spClassData());
  if (!s) return _fontMsg('Set your sorcery point maximum first.');
  if (s.left < cost) return _fontMsg(`A level ${L} slot costs ${cost} points; ${s.left} left.`);
  if (_num(`slot-${L}-used`) <= 0) return _fontMsg(`No spent level ${L} slot to get back.`);
  _setNum(`slot-${L}-used`, _num(`slot-${L}-used`) - 1);
  _setNum('sorc-used', s.used + cost);
  _fontMsg(`${cost} points spent: a level ${L} slot is back.`);
  updateClassCards(); renderSpells(); scheduleAutoSave();
}

function _spChanged() {
  renderSpells();
  recalcPreparedCount();
  if (typeof renderActionsTab === 'function') renderActionsTab();
  scheduleAutoSave();
}

function onSpellPrepModeChange() {
  const btn = document.querySelector('.sp-filters [data-f="unprepared"]');
  if (!_spPrepares() && _spellFilter === 'unprepared') _spellFilter = 'all';
  if (btn) btn.style.display = _spPrepares() ? '' : 'none';
  _spChanged();
}

function setSpellFilter(f, btn) {
  _spellFilter = f;
  document.querySelectorAll('.sp-filters .act-chip').forEach(c => c.classList.toggle('active', c === btn));
  renderSpells();
}

/** Short label for the casting-time badge. */
function _spCastBadge(s) {
  if (s.cast === 'action') return 'Action';
  if (s.cast === 'bonus') return 'Bonus';
  if (s.cast === 'reaction') return 'Reaction';
  return s.castText || (s.cast === 'minute' ? 'Minutes' : s.cast === 'hour' ? 'Hours' : 'Other');
}

function _spMatches(s, q) {
  if (!q) return true;
  return [s.name, spellSourceLabel(s.source), spellSchoolName(s.school), s.notes]
    .some(v => String(v || '').toLowerCase().includes(q));
}

function renderSpells() {
  const box = document.getElementById('spell-list');
  if (!box) return;
  updateClassCards();
  const prepares = _spPrepares();
  const pf = document.getElementById('prep-count-field');
  if (pf) pf.style.display = prepares ? '' : 'none';
  const unprepBtn = document.querySelector('.sp-filters [data-f="unprepared"]');
  if (unprepBtn) unprepBtn.style.display = prepares ? '' : 'none';

  if (!spells.length) {
    box.innerHTML = '<div class="sp-empty">No spells yet. Add one by hand, pick from the campaign&rsquo;s library, or import 5etools JSON.</div>';
    return;
  }
  const q = (document.getElementById('sp-search')?.value || '').trim().toLowerCase();
  const show = s => {
    const ready = spellIsReady(s, prepares);
    if (_spellFilter === 'ready' && !ready) return false;
    if (_spellFilter === 'unprepared' && ready) return false;
    return _spMatches(s, q);
  };

  let html = '';
  for (let lvl = 0; lvl <= 9; lvl++) {
    const rows = spells.filter(s => s.level === lvl && show(s))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) continue;
    html += `<div class="sp-group"><div class="sp-lvl">${lvl === 0 ? 'Cantrips' : 'Level ' + lvl} <span>${rows.length}</span></div>`
         + rows.map(s => _spRowHTML(s, prepares)).join('') + '</div>';
  }
  box.innerHTML = html || '<div class="sp-empty">No spells match.</div>';
}

function _spRowHTML(s, prepares) {
  const id = _spId(s.id);
  const ready = spellIsReady(s, prepares);
  const open = _spellOpen.has(s.id);
  let prep;
  if (prepares && s.level > 0 && !s.noSlot && !s.alwaysPrepared) {
    prep = `<input type="checkbox" ${s.prepared ? 'checked' : ''} onchange="toggleSpellPrepared(${id})" title="Prepared" aria-label="Prepared: ${esc(s.name)}">`;
  } else {
    const why = s.level === 0 ? 'Cantrips are always ready' : s.alwaysPrepared ? 'Always prepared' : s.noSlot ? 'Can be cast for free' : 'Always ready';
    prep = `<span class="sp-always" title="${why}" aria-label="${why}"></span>`;
  }
  const flags = (s.conc ? '<span class="sp-flag" title="Concentration">C</span>' : '')
              + (s.ritual ? '<span class="sp-flag" title="Ritual">R</span>' : '')
              + (s.alwaysPrepared && s.level > 0 ? '<span class="sp-ap" title="Always prepared: given by a feat, subclass feature or item">Always prepared</span>' : '');
  const meta = [s.range, s.duration].filter(Boolean).map(esc).join(' · ');
  const src = spellSourceLabel(s.source);
  let uses = '';
  if (spellIsArcanum(s, _spClassData())) {
    uses = `<span class="sp-uses"><span class="act-box${s.used ? ' used' : ''}" onclick="clickSpellUse(${id},0)" title="${s.used ? 'Restore' : 'Use'}"></span><span class="act-recharge">Mystic Arcanum / Long Rest</span></span>`;
  } else if (s.noSlot) {
    if (s.uses > 0) {
      let boxes = '';
      for (let i = 0; i < s.uses; i++) {
        boxes += `<span class="act-box${i < s.used ? ' used' : ''}" onclick="clickSpellUse(${id},${i})" title="${i < s.used ? 'Restore use' : 'Use'}"></span>`;
      }
      const rl = s.recharge === 'short' ? 'Short Rest' : s.recharge === 'long' ? 'Long Rest' : '';
      uses = `<span class="sp-uses">${boxes}${rl ? `<span class="act-recharge">/ ${rl}</span>` : ''}</span>`;
    } else {
      uses = '<span class="sp-uses sp-atwill">At will</span>';
    }
  }
  const detail = open ? _spDetailHTML(s) : '';
  return `<div class="sp-row${ready ? '' : ' unready'}${open ? ' open' : ''}">
    <span class="sp-prep">${prep}</span>
    <button type="button" class="sp-name" onclick="toggleSpellOpen(${id})" aria-expanded="${open}">${esc(s.name || 'Unnamed spell')}</button>
    <span class="sp-cast sp-cast-${esc(s.cast)}">${esc(_spCastBadge(s))}</span>${flags}
    <span class="sp-meta">${meta}</span>
    ${src ? `<span class="sp-src" title="Where this spell comes from">${esc(src)}</span>` : ''}
    ${uses}
    <span class="sp-btns">
      ${ready && s.name ? `<button type="button" class="sp-cast-btn" onclick="openSheetSpellCast(${id})" title="Cast ${esc(s.name)}">Cast</button>` : ''}
      <button type="button" class="act-edit-btn" onclick="openSpellModal(${id})" title="Edit">${_spIco('pencil')}</button>
      <button type="button" class="del-btn" onclick="deleteSpell(${id})" title="Delete spell">${_spIco('close')}</button>
    </span>
  </div>${detail}`;
}

function _spDetailHTML(s) {
  const facts = [
    spellLevelLabel(s.level) + (s.school ? ' ' + spellSchoolName(s.school).toLowerCase() : ''),
    s.castText ? 'Casting time: ' + s.castText : '',
    spellComponentsLabel(s) ? 'Components: ' + spellComponentsLabel(s) : '',
    s.book ? 'Book: ' + s.book : '',
  ].filter(Boolean).map(esc).join(' · ');
  const desc = spellDescHTML(s);
  return `<div class="sp-detail">
    <div class="sp-facts">${facts}</div>
    ${desc ? `<div class="sp-desc">${desc}</div>` : ''}
    ${s.notes ? `<div class="sp-notes">${esc(s.notes)}</div>` : ''}
  </div>`;
}

function toggleSpellOpen(id) {
  if (_spellOpen.has(id)) _spellOpen.delete(id); else _spellOpen.add(id);
  renderSpells();
}

function toggleSpellPrepared(id) {
  const s = spells.find(x => x.id === id);
  if (!s) return;
  s.prepared = !s.prepared;
  _spChanged();
}

function clickSpellUse(id, idx) {
  const s = spells.find(x => x.id === id);
  if (!s) return;
  s.used = idx < s.used ? idx : idx + 1;
  _spChanged();
}

function deleteSpell(id) {
  const s = spells.find(x => x.id === id);
  if (!s) return;
  showConfirm(`Delete ${s.name || 'this spell'}?`, () => {
    spells = spells.filter(x => x.id !== id);
    _spellOpen.delete(id);
    _spChanged();
  });
}

/**
 * Rest: a Long Rest empties every slot level's "used" and refills every spell's
 * uses; a Short Rest refills the uses that recharge on one. Called from
 * actionRest() (Actions tab and the Spell Slots card). Returns how many
 * things changed.
 */
function restSpells(type) {
  let changed = 0;
  for (const s of spells) {
    if (!s.noSlot || !s.used) continue;
    if (s.recharge === 'short' || (type === 'long' && s.recharge === 'long')) { s.used = 0; changed++; }
  }
  if (type === 'long') {
    for (let i = 1; i <= 9; i++) {
      const el = document.querySelector(`[data-key="slot-${i}-used"]`);
      if (el && (parseInt(el.value) || 0) !== 0) { el.value = '0'; changed++; }
    }
    if (_num('sorc-used')) { _setNum('sorc-used', 0); changed++; }
    // Mystic Arcanum spells are back.
    const cd = _spClassData();
    for (const s of spells) if (s.used && spellIsArcanum(s, cd)) { s.used = 0; changed++; }
  }
  // Pact slots come back on any rest.
  if (_num('pact-used')) { _setNum('pact-used', 0); changed++; }
  if (changed) updateClassCards();
  if (changed) renderSpells();
  return changed;
}

// ── Cast a Spell (js/lib/spell-cast.js) ───────────────────────────────────────
// Saves first, so the server casts from the sheet as it is now (a spell just
// added or prepared is still waiting in the autosave). The server spends the
// slot or use and returns the keys it changed; they go straight onto the sheet
// and into the saved snapshot, so the autosave does not send them back.
async function openSheetSpellCast(spellId) {
  if (!currentCharId || typeof openSpellCast !== 'function') return;
  clearTimeout(_autoSaveTimer);
  try { await autoSaveCharacter(); } catch {}
  openSpellCast({
    charId: currentCharId, data: collectData(), spellId,
    headers: () => sheetAuthHeaders(),
    onDone: _sheetCastDone,
  });
}

function _sheetCastDone(out) {
  const d = (out && out.data) || {};
  const keys = Object.keys(d);
  _applyingData = true;
  for (const k of keys) {
    if (k === '_spells') spells = parseSpellList(d._spells);
    else if (k === '_companions') {
      // A summon spell's creature (lib/summon.js), added or updated by the server.
      try { companions = JSON.parse(d._companions || '[]'); } catch {}
      if (typeof renderCompanions === 'function') renderCompanions();
    } else { const el = document.querySelector(`[data-key="${k}"]`); if (el) el.value = d[k]; }
  }
  _applyingData = false;
  renderSpells();
  recalcPreparedCount();
  if (typeof renderActionsTab === 'function') renderActionsTab();
  const now = collectData();
  for (const k of keys) _lastSavedData[k] = now[k];
  const sp = out && out.entry && out.entry.spell;
  if (sp) setStatus(`Cast ${sp.name}${sp.castLevel > sp.level ? ' at level ' + sp.castLevel : ''}.`);
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function _spmOptions(selId, pairs, value, blank) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = (blank ? `<option value="">${esc(blank)}</option>` : '')
    + pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  sel.value = value || '';
}

function openSpellModal(id) {
  const s = id ? spells.find(x => x.id === id) : null;
  const sp = s || normalizeSpell({});
  _spmEditId = s ? s.id : null;
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  const chk = (elId, v) => { const el = document.getElementById(elId); if (el) el.checked = !!v; };
  document.getElementById('spm-title').textContent = s ? 'Edit Spell' : 'Add Spell';
  set('spm-name', sp.name);
  set('spm-level', String(sp.level));
  _spmOptions('spm-school', SPELL_SCHOOLS.map(([c, n]) => [c, n]), sp.school, '—');
  _spmOptions('spm-cast', SPELL_CAST_TYPES, sp.cast);
  set('spm-casttext', sp.castText);
  set('spm-range', sp.range);
  set('spm-duration', sp.duration);
  chk('spm-conc', sp.conc); chk('spm-ritual', sp.ritual);
  chk('spm-v', sp.v); chk('spm-s', sp.s); chk('spm-m', sp.m);
  set('spm-material', sp.material);
  _spmOptions('spm-src-kind', SPELL_SOURCE_KINDS, sp.source.kind, '—');
  set('spm-src-detail', sp.source.detail);
  chk('spm-prepared', sp.prepared);
  chk('spm-noslot', sp.noSlot);
  chk('spm-always', sp.alwaysPrepared);
  chk('spm-summon', sp.summon);
  set('spm-uses', sp.uses ? String(sp.uses) : '');
  set('spm-recharge', sp.uses ? sp.recharge : 'long');
  set('spm-notes', sp.notes);
  const desc = document.getElementById('spm-desc');
  if (desc) {
    const html = spellDescHTML(sp);
    desc.innerHTML = html;
    desc.style.display = html ? '' : 'none';
  }
  const prepLine = document.getElementById('spm-prepared-line');
  if (prepLine) prepLine.style.display = _spPrepares() ? '' : 'none';
  spmMaterialToggle();
  spmNoSlotToggle();
  spmAlwaysToggle();
  document.getElementById('spell-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('spm-name')?.focus(), 30);
}

function closeSpellModal() {
  document.getElementById('spell-modal').style.display = 'none';
  _spmEditId = null;
}

function spmMaterialToggle() {
  const on = document.getElementById('spm-m')?.checked;
  const f = document.getElementById('spm-material-field');
  if (f) f.style.display = on ? '' : 'none';
}

// "Always prepared" makes the Prepared box meaningless, so it is greyed out.
function spmAlwaysToggle() {
  const always = !!document.getElementById('spm-always')?.checked;
  const prep = document.getElementById('spm-prepared');
  if (prep) { prep.disabled = always; if (always) prep.checked = true; }
}

function spmNoSlotToggle() {
  const on = document.getElementById('spm-noslot')?.checked;
  const row = document.getElementById('spm-uses-row');
  if (row) row.style.display = on ? '' : 'none';
}

function saveSpellModal() {
  const val = id => document.getElementById(id)?.value ?? '';
  const on = id => !!document.getElementById(id)?.checked;
  const name = val('spm-name').trim();
  if (!name) { showAlert('Give the spell a name.'); return; }
  const old = _spmEditId ? spells.find(x => x.id === _spmEditId) : null;
  const noSlot = on('spm-noslot');
  const uses = noSlot ? Math.max(0, parseInt(val('spm-uses')) || 0) : 0;
  const s = normalizeSpell({
    ...(old || {}),
    name,
    level: parseInt(val('spm-level')) || 0,
    school: val('spm-school'),
    cast: val('spm-cast'),
    castText: val('spm-casttext').trim(),
    range: val('spm-range').trim(),
    duration: val('spm-duration').trim(),
    conc: on('spm-conc'), ritual: on('spm-ritual'),
    v: on('spm-v'), s: on('spm-s'), m: on('spm-m'),
    material: on('spm-m') ? val('spm-material').trim() : '',
    source: { kind: val('spm-src-kind'), detail: val('spm-src-detail').trim() },
    prepared: on('spm-prepared'),
    alwaysPrepared: on('spm-always'),
    summon: on('spm-summon'),
    noSlot, uses,
    used: old && old.uses === uses ? old.used : 0,
    recharge: uses ? val('spm-recharge') : '',
    notes: val('spm-notes'),
  });
  if (old) spells[spells.indexOf(old)] = s;
  else spells.push(s);
  closeSpellModal();
  _spChanged();
}

// ── Library picker ────────────────────────────────────────────────────────────
async function _loadSpellLibrary() {
  const res = await fetch('/api/spells', { headers: sheetAuthHeaders() });
  if (!res.ok) throw new Error(res.status === 401 ? 'Log in to see the spell library.' : 'Could not load the spell library.');
  _spellLib = await res.json();
  return _spellLib;
}

/** Is this library spell already on the sheet (linked, or the same name)? */
function _spOnSheet(row) {
  const n = String(row.name || '').toLowerCase();
  return spells.some(s => s.libId === row.id || s.name.toLowerCase() === n);
}

async function openSpellLibrary() {
  _splChosen.clear();
  document.getElementById('spell-lib-modal').style.display = 'flex';
  const list = document.getElementById('spl-list');
  list.innerHTML = '<div class="sp-empty">Loading…</div>';
  try {
    await _loadSpellLibrary();
  } catch (err) {
    list.innerHTML = `<div class="sp-empty">${esc(err.message)}</div>`;
    return;
  }
  const classes = new Set();
  for (const r of _spellLib) spellClasses(r.data).forEach(c => classes.add(c));
  const myClass = (document.querySelector('[data-key="class"]')?.value || '').trim();
  const sel = document.getElementById('spl-class');
  sel.innerHTML = '<option value="">Any class</option>'
    + [...classes].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  // Start on the character's own class when the library knows it.
  const hit = [...classes].find(c => c.toLowerCase() === myClass.toLowerCase());
  sel.value = hit || '';
  renderSpellLibrary();
  setTimeout(() => document.getElementById('spl-search')?.focus(), 30);
}

function closeSpellLibrary() {
  document.getElementById('spell-lib-modal').style.display = 'none';
  _splChosen.clear();
}

function renderSpellLibrary() {
  const list = document.getElementById('spl-list');
  if (!list || !_spellLib) return;
  if (!_spellLib.length) {
    list.innerHTML = '<div class="sp-empty">The library is empty. Use Import JSON to add spells, or ask the DM to import a spell file.</div>';
    _splCount();
    return;
  }
  const q = (document.getElementById('spl-search')?.value || '').trim().toLowerCase();
  const lvl = document.getElementById('spl-level')?.value ?? '';
  const cls = document.getElementById('spl-class')?.value || '';
  const rows = _spellLib.filter(r =>
    (!q || r.name.toLowerCase().includes(q))
    && (lvl === '' || String(r.level) === lvl)
    && (!cls || spellClasses(r.data).includes(cls)));
  const LIMIT = 300;
  list.innerHTML = rows.slice(0, LIMIT).map(r => {
    const on = _spOnSheet(r);
    const lv = r.level === 0 ? 'Cantrip' : 'Level ' + r.level;
    return `<label class="spl-row${on ? ' on' : ''}">
      <input type="checkbox" ${on ? 'checked disabled' : (_splChosen.has(r.id) ? 'checked' : '')} onchange="toggleLibrarySpell(${_spId(r.id)}, this.checked)">
      <span class="spl-name">${esc(r.name)}</span>
      <span class="spl-meta">${esc(lv)}${r.school ? ' · ' + esc(spellSchoolName(spellSchoolCode(r.school))) : ''}${r.source ? ' · ' + esc(r.source) : ''}</span>
      ${on ? '<span class="spl-on">on sheet</span>' : ''}
    </label>`;
  }).join('') + (rows.length > LIMIT ? `<div class="sp-empty">${rows.length - LIMIT} more — narrow the search.</div>` : '')
    + (rows.length ? '' : '<div class="sp-empty">No spells match.</div>');
  _splCount();
}

function toggleLibrarySpell(id, on) {
  if (on) _splChosen.add(id); else _splChosen.delete(id);
  _splCount();
}

function _splCount() {
  const n = _splChosen.size;
  const btn = document.getElementById('spl-add');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Add ${n} spell${n === 1 ? '' : 's'}` : 'Add'; }
}

/**
 * A sheet spell from a library row. When the spell is on the character's own
 * class list, its source starts as that class.
 */
function _spFromLibrary(row) {
  const s = spellFrom5e(row.data, row.id);
  const myClass = (document.querySelector('[data-key="class"]')?.value || '').trim().toLowerCase();
  const cls = spellClasses(row.data).find(c => c.toLowerCase() === myClass);
  if (cls) s.source = { kind: 'class', detail: cls };
  return s;
}

function addSpellsFromLibrary() {
  if (!_spellLib) return;
  let added = 0;
  for (const row of _spellLib) {
    if (!_splChosen.has(row.id) || _spOnSheet(row)) continue;
    spells.push(_spFromLibrary(row));
    added++;
  }
  closeSpellLibrary();
  if (added) { _spChanged(); setStatus(`Added ${added} spell${added === 1 ? '' : 's'}.`); }
}

// ── JSON import ───────────────────────────────────────────────────────────────
let _spiFileText = '';   // a big file is kept here instead of in the text box

function openSpellImport() {
  _spiFileText = '';
  document.getElementById('spi-text').value = '';
  document.getElementById('spi-msg').textContent = '';
  document.getElementById('spell-import-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('spi-text')?.focus(), 30);
}

function closeSpellImport() {
  document.getElementById('spell-import-modal').style.display = 'none';
  _spiFileText = '';
}

function onSpellImportFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = String(e.target.result || '');
    const ta = document.getElementById('spi-text');
    // A whole 5etools file is a few MB; a text box that size is slow to draw.
    if (text.length > 200000) { _spiFileText = text; ta.value = ''; ta.placeholder = `${file.name} is ready to import.`; }
    else { _spiFileText = ''; ta.value = text; }
    document.getElementById('spi-msg').textContent = file.name;
  };
  reader.readAsText(file);
}

/** The spell objects in parsed JSON, the same way the server unwraps them. */
function _spiList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.spell)) return parsed.spell;
  if (parsed && Array.isArray(parsed.spells)) return parsed.spells;
  return parsed && typeof parsed === 'object' ? [parsed] : [];
}

async function runSpellImport() {
  const msg = document.getElementById('spi-msg');
  const text = _spiFileText || document.getElementById('spi-text').value;
  if (!text.trim()) { msg.textContent = 'Paste some JSON or choose a file first.'; return; }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { msg.textContent = 'That is not valid JSON.'; return; }
  const list = _spiList(parsed);
  if (!list.length) { msg.textContent = 'No spells found in that JSON.'; return; }

  const btn = document.getElementById('spi-go');
  btn.disabled = true;
  msg.textContent = 'Importing…';
  try {
    const res = await fetch('/api/spells/import', {
      method: 'POST', headers: sheetAuthHeaders(), body: JSON.stringify({ spells: list }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = r.error || 'The import failed.'; return; }

    // Add what was accepted to the sheet — unless it was a whole book.
    let added = 0;
    if (r.spells.length <= SPELL_ADD_TO_SHEET_MAX) {
      const byKey = new Map(list.filter(x => x && x.name)
        .map(x => [String(x.name).trim().toLowerCase() + '|' + String(x.source || '').trim(), x]));
      for (const row of r.spells) {
        const raw = byKey.get(row.name.toLowerCase() + '|' + row.source);
        const libRow = { id: row.id, name: row.name, data: raw || { name: row.name, level: row.level } };
        if (_spOnSheet(libRow)) continue;
        spells.push(_spFromLibrary(libRow));
        added++;
      }
      if (added) _spChanged();
    }
    _spellLib = null;   // the picker reloads next time
    const parts = [];
    if (r.imported) parts.push(`${r.imported} new in the library`);
    if (r.updated) parts.push(`${r.updated} updated`);
    if (r.existing) parts.push(`${r.existing} already there`);
    if (r.skipped) parts.push(`${r.skipped} skipped${r.skips && r.skips.length ? ' (' + r.skips.slice(0, 3).join('; ') + (r.skips.length > 3 ? '…' : '') + ')' : ''}`);
    const sheet = r.spells.length > SPELL_ADD_TO_SHEET_MAX
      ? ` That is a lot of spells, so none were added to this sheet: pick yours with From library.`
      : (added ? ` ${added} added to this sheet.` : '');
    msg.textContent = (parts.join(', ') || 'Nothing to import') + '.' + sheet;
  } catch {
    msg.textContent = 'Network error.';
  } finally {
    btn.disabled = false;
  }
}

// Typing a class, subclass or level switches the Warlock / Sorcerer rules on
// or off and refills the slot totals (a moment after the typing stops).
let _autoSlotsTimer = null;
for (const k of ['class', 'subclass', 'level']) {
  document.querySelector(`[data-key="${k}"]`)?.addEventListener('input', () => {
    renderSpells(); recalcPreparedCount();
    clearTimeout(_autoSlotsTimer);
    _autoSlotsTimer = setTimeout(() => autoFillSlots(false), 500);
  });
}
