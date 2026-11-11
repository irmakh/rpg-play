// Written by Irmak Hakman — 2026-11-11 22:50
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Cast a Spell pop-up ───────────────────────────────────────────────────────
// One pop-up for the character sheet and the table (and the table's pop-out,
// which runs this page's code). It lists the spells the character can cast
// now; one that cannot be cast — no slot of its level or higher left, or its
// own uses spent — is greyed and cannot be chosen. Choosing a spell shows how
// to cast it: its own free use, a slot level (empty levels greyed, the lowest
// open one picked), or as a ritual. Cast sends POST /api/characters/:id/cast;
// the server spends the slot and posts the spell card to chat.
//
//   openSpellCast({ charId, data, headers, onDone, spellId })
//     data     the character's data (the sheet's collectData() / the table's qrollData)
//     headers  () => fetch headers carrying the session
//     onDone   (result) => void — result.data holds the keys the server changed
//     spellId  optional: open with this spell chosen
//
// Needs js/lib/spell-data.js. Styles: css/spell-cast.css.

const SPC_FILTERS = [['all', 'All'], ['action', 'Action'], ['bonus', 'Bonus'], ['reaction', 'Reaction'], ['ritual', 'Ritual']];
let _spc = null;   // { opts, spells, rows, filter, query, sel, option, busy }

function _spcEl() {
  let ov = document.getElementById('spc-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'spc-overlay';
  ov.className = 'spc-overlay';
  ov.style.display = 'none';
  ov.innerHTML = `<div class="spc-box" role="dialog" aria-modal="true" aria-labelledby="spc-title">
    <div class="spc-hdr"><span id="spc-title">Cast a Spell</span>
      <button type="button" class="spc-x" onclick="closeSpellCast()" aria-label="Close">&times;</button></div>
    <div class="spc-tools">
      <div class="spc-chips" id="spc-chips" role="group" aria-label="Casting time"></div>
      <input type="search" id="spc-q" class="spc-q" placeholder="Find a spell…" aria-label="Find a spell" oninput="_spcQuery(this.value)">
    </div>
    <div class="spc-body">
      <div class="spc-list" id="spc-list"></div>
      <div class="spc-pick" id="spc-pick"></div>
    </div>
  </div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeSpellCast(); });
  document.body.appendChild(ov);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ov.style.display !== 'none') closeSpellCast();
  });
  return ov;
}

function openSpellCast(opts) {
  const data = (opts && opts.data) || {};
  const spells = parseSpellList(data._spells);
  const prepares = spellPrepares(data);
  // Ready spells only: an unprepared spell is not one you can cast today.
  const rows = spells.filter(s => s.name && spellIsReady(s, prepares))
    .map(s => ({ s, how: spellCastOptions(s, data) }))
    .sort((a, b) => a.s.level - b.s.level || a.s.name.localeCompare(b.s.name));
  _spc = { opts, data, rows, filter: 'all', query: '', sel: -1, option: null, busy: false };
  const ov = _spcEl();
  document.getElementById('spc-q').value = '';
  if (opts.spellId) {
    const i = rows.findIndex(r => r.s.id === opts.spellId);
    if (i >= 0 && rows[i].how.castable) _spcPick(i, true);
  }
  _spcRender();
  ov.style.display = 'flex';
  setTimeout(() => document.getElementById('spc-q')?.focus(), 30);
}

function closeSpellCast() {
  const ov = document.getElementById('spc-overlay');
  if (ov) ov.style.display = 'none';
  _spc = null;
}

function _spcQuery(q) { if (_spc) { _spc.query = q; _spcRenderList(); } }
function _spcFilter(f) { if (_spc) { _spc.filter = f; _spcRender(); } }

function _spcShown(r) {
  const f = _spc.filter;
  if (f === 'ritual' && !r.s.ritual) return false;
  if (f !== 'all' && f !== 'ritual' && r.s.cast !== f) return false;
  const q = _spc.query.trim().toLowerCase();
  return !q || r.s.name.toLowerCase().includes(q);
}

function _spcRender() {
  document.getElementById('spc-chips').innerHTML = SPC_FILTERS.map(([k, l]) =>
    `<button type="button" class="spc-chip${_spc.filter === k ? ' on' : ''}" onclick="_spcFilter('${k}')">${l}</button>`).join('');
  _spcRenderList();
  _spcRenderPick();
}

function _spcRenderList() {
  const list = document.getElementById('spc-list');
  if (!_spc.rows.length) {
    list.innerHTML = '<div class="spc-empty">No spells ready to cast. Prepare spells on the Spells tab of the character sheet.</div>';
    return;
  }
  let html = '', last = null, any = false;
  _spc.rows.forEach((r, i) => {
    if (!_spcShown(r)) return;
    any = true;
    if (r.s.level !== last) {
      last = r.s.level;
      html += `<div class="spc-lvl">${last === 0 ? 'Cantrips' : 'Level ' + last}</div>`;
    }
    const off = !r.how.castable;
    const cast = r.s.cast === 'bonus' ? 'Bonus' : r.s.cast === 'reaction' ? 'Reaction' : r.s.cast === 'action' ? 'Action' : (r.s.castText || 'Other');
    html += `<button type="button" class="spc-row${off ? ' off' : ''}${i === _spc.sel ? ' sel' : ''}"`
      + (off ? ` disabled title="${_spEsc(r.how.reason)}"` : ` onclick="_spcPick(${i})"`) + `>`
      + `<span class="spc-name">${_spEsc(r.s.name)}</span>`
      + `<span class="spc-tag spc-${_spEsc(r.s.cast)}">${_spEsc(cast)}</span>`
      + (r.s.conc ? '<span class="spc-flag" title="Concentration">C</span>' : '')
      + (r.s.ritual ? '<span class="spc-flag" title="Ritual">R</span>' : '')
      + (off ? `<span class="spc-why">${_spEsc(r.how.reason)}</span>` : '')
      + `</button>`;
  });
  list.innerHTML = any ? html : '<div class="spc-empty">No spells match.</div>';
}

function _spcPick(i, quiet) {
  if (!_spc || !_spc.rows[i] || !_spc.rows[i].how.castable) return;
  _spc.sel = i;
  _spc.option = _spc.rows[i].how.best;
  if (!quiet) { _spcRenderList(); _spcRenderPick(); }
}

function _spcChoose(j) {
  const r = _spc && _spc.rows[_spc.sel];
  if (!r || !r.how.options[j] || !r.how.options[j].available) return;
  _spc.option = r.how.options[j];
  _spcRenderPick();
}

function _spcRenderPick() {
  const box = document.getElementById('spc-pick');
  const r = _spc.rows[_spc.sel];
  if (!r) { box.innerHTML = '<div class="spc-empty">Choose a spell.</div>'; return; }
  const s = r.s;
  const opt = _spc.option;
  const meta = [spellLevelLabel(s.level) + (s.school ? ' ' + spellSchoolName(s.school).toLowerCase() : ''),
                s.castText || spellCastLabel(s), s.range, (s.conc ? 'Concentration, ' : '') + s.duration]
    .filter(Boolean).map(_spEsc).join(' · ');
  const options = r.how.options.map((o, j) =>
    `<label class="spc-opt${o.available ? '' : ' off'}">`
    + `<input type="radio" name="spc-opt" ${o === opt ? 'checked' : ''} ${o.available ? `onchange="_spcChoose(${j})"` : 'disabled'}>`
    + `<span>${_spEsc(o.label)}</span></label>`).join('');
  const lv = opt ? (opt.mode === 'slot' ? opt.level : s.level) : s.level;
  const charLevel = parseInt(_spc.data.level || _spc.data['total-level'], 10) || 1;
  const info = spellCastInfo(s, null, lv, charLevel);
  const fx = [
    info.attack ? `${info.attack === 'melee' ? 'Melee' : 'Ranged'} spell attack ${_spEsc(_spc.data['sp-atk'] || '')}` : '',
    info.save ? `DC ${_spEsc(_spc.data['sp-dc'] || '?')} ${_spEsc(info.save)} save` : '',
    info.damage ? `${info.healing ? 'Healing' : 'Damage'} ${_spEsc(info.damage)}${info.damageType && !info.healing ? ' ' + _spEsc(info.damageType) : ''}` : '',
  ].filter(Boolean).join(' · ');
  box.innerHTML = `<div class="spc-sel-name">${_spEsc(s.name)}</div>
    <div class="spc-sel-meta">${meta}</div>
    ${s.source && (s.source.kind || s.source.detail) ? `<div class="spc-sel-src">${_spEsc(spellSourceLabel(s.source))}</div>` : ''}
    ${_spcDetails(s)}
    <div class="spc-opts" role="radiogroup" aria-label="How to cast it">${options}</div>
    ${fx ? `<div class="spc-fx">${fx}</div>` : ''}
    <div class="spc-err" id="spc-err" role="alert"></div>
    <button type="button" class="spc-go" id="spc-go" onclick="_spcCast()" ${opt ? '' : 'disabled'}>Cast ${_spEsc(s.name)}${opt && opt.mode === 'slot' && opt.level > s.level ? ' at level ' + opt.level : ''}</button>`;
}

/** The spell's text under its casting time and range: components, description, notes. */
function _spcDetails(s) {
  const comp = spellComponentsLabel(s);
  const desc = spellDescHTML(s);
  if (!comp && !desc && !s.notes) return '';
  return `<div class="spc-desc">`
    + (comp ? `<div class="spc-comp">Components: ${_spEsc(comp)}</div>` : '')
    + desc
    + (s.notes ? `<div class="spc-notes">${_spEsc(s.notes)}</div>` : '')
    + `</div>`;
}

async function _spcCast() {
  if (!_spc || _spc.busy) return;
  const r = _spc.rows[_spc.sel];
  const o = _spc.option;
  if (!r || !o) return;
  _spc.busy = true;
  const btn = document.getElementById('spc-go');
  const err = document.getElementById('spc-err');
  if (btn) btn.disabled = true;
  const headers = { 'Content-Type': 'application/json', ...((_spc.opts.headers && _spc.opts.headers()) || {}) };
  try {
    const res = await fetch(`/api/characters/${encodeURIComponent(_spc.opts.charId)}/cast`, {
      method: 'POST', headers,
      body: JSON.stringify({ spellId: r.s.id, name: r.s.name, level: r.s.level, mode: o.mode, slotLevel: o.mode === 'slot' ? o.level : undefined }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (err) err.textContent = out.error || 'The spell could not be cast.';
      if (btn) btn.disabled = false;
      _spc.busy = false;
      return;
    }
    const done = _spc.opts.onDone;
    closeSpellCast();
    if (typeof done === 'function') done(out);
  } catch {
    if (err) err.textContent = 'Network error.';
    if (btn) btn.disabled = false;
    if (_spc) _spc.busy = false;
  }
}
