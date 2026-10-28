// Written by Irmak Hakman — 2026-10-28 14:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Companions tab ────────────────────────────────────────────────────────────
// Familiars, summons and beasts the player builds here and puts on the map
// themselves from the table (Companions tab of the right panel). Saved with the
// character as `_companions` (collectData). A summoned token takes a copy of
// these stats at full HP, so editing one here changes the next summon only.

const COMPANION_SIZES = [[1, 'Up to Medium'], [2, 'Large'], [3, 'Huge'], [4, 'Gargantuan']];

let _cmpEditId = null;        // id being edited, null = new
let _cmpPortrait = null;      // { portrait, portraitThumb } chosen in the modal
let _cmpUploaded = '';        // a picture uploaded in this modal, not saved yet

function _cmpNewId() {
  return 'cmp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function _cmpSigned(n) {
  const v = parseInt(n) || 0;
  return (v >= 0 ? '+' : '') + v;
}

function renderCompanions() {
  const body = document.getElementById('companions-body');
  if (!body) return;
  if (!companions.length) {
    body.innerHTML = '<div style="color:var(--ash);font-size:calc(11px * var(--fs, 1));padding:calc(4px*var(--fs, 1)) 0">No companions yet. Add a familiar, a summon or an animal companion, then summon it from the table.</div>';
    return;
  }
  body.innerHTML = companions.map(c => {
    const idLit = esc(JSON.stringify(c.id));
    const img = c.portraitThumb || c.portrait;
    const stats = [`HP ${parseInt(c.hpMax) || 0}`, c.ac ? `AC ${esc(c.ac)}` : '', `${parseInt(c.speed) || 0} ft`,
                   `Init ${_cmpSigned(c.initBonus)}`,
                   c.initMode === 'own' ? 'own turn' : 'shares your turn'].filter(Boolean).join(' · ');
    const atks = (c.attacks || []).map(a =>
      `<span class="cmp-atk">${esc(a.name || 'Attack')}${a.toHit !== '' && a.toHit != null ? ' ' + esc(_cmpSigned(a.toHit)) : ''}${a.damage ? ' · ' + esc(a.damage) : ''}</span>`
    ).join('');
    return `<div class="item-row cmp-row">
      ${img ? `<img class="item-thumb" src="${esc(img)}" alt="" loading="lazy">` : '<span class="cmp-ph" aria-hidden="true">🐾</span>'}
      <div class="cmp-main">
        <span class="item-name">${esc(c.name || 'Companion')}</span>
        <span class="item-meta">${stats}</span>
        ${atks ? `<div class="cmp-atks">${atks}</div>` : ''}
      </div>
      <button class="char-btn" style="padding:calc(2px*var(--fs, 1)) calc(8px*var(--fs, 1));font-size:calc(11px * var(--fs, 1))" onclick="openCompanionModal(${idLit})">Edit</button>
      <button class="del-btn" onclick="deleteCompanion(${idLit})" title="Delete companion"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>
    </div>`;
  }).join('');
}

function openCompanionModal(id) {
  const c = id ? companions.find(x => x.id === id) : null;
  _cmpEditId = c ? c.id : null;
  _cmpPortrait = c && c.portrait ? { portrait: c.portrait, portraitThumb: c.portraitThumb || '' } : null;
  _cmpUploaded = '';
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  document.getElementById('cmp-modal-title').textContent = c ? 'Edit Companion' : 'Add Companion';
  set('cmp-name', c ? c.name || '' : '');
  set('cmp-hp', c ? c.hpMax ?? '' : '');
  set('cmp-ac', c ? c.ac ?? '' : '');
  set('cmp-speed', c ? c.speed ?? 30 : 30);
  set('cmp-init', c ? c.initBonus ?? 0 : 0);
  set('cmp-init-mode', c && c.initMode === 'own' ? 'own' : 'shared');
  const sizeSel = document.getElementById('cmp-size');
  if (sizeSel) {
    sizeSel.innerHTML = COMPANION_SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    sizeSel.value = String(c ? parseInt(c.size) || 1 : 1);
  }
  set('cmp-notes', c ? c.notes || '' : '');
  const list = document.getElementById('cmp-atk-list');
  if (list) list.innerHTML = '';
  (c ? c.attacks || [] : []).forEach(a => addCompanionAttackRow(a));
  _cmpShowPortrait();
  document.getElementById('companion-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cmp-name')?.focus(), 30);
}

function closeCompanionModal() {
  document.getElementById('companion-modal').style.display = 'none';
  _cmpUploaded = '';
  _cmpEditId = null;
  _cmpPortrait = null;
}

function addCompanionAttackRow(a) {
  const list = document.getElementById('cmp-atk-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'cmp-atk-row';
  row.innerHTML = `<input type="text" class="cmp-atk-name" placeholder="Bite" value="${esc(a?.name || '')}" aria-label="Attack name">
    <input type="text" class="cmp-atk-hit" placeholder="+4" value="${esc(a?.toHit ?? '')}" aria-label="To hit">
    <input type="text" class="cmp-atk-dmg" placeholder="2d4+2 piercing" value="${esc(a?.damage || '')}" aria-label="Damage">
    <button type="button" class="del-btn" onclick="this.parentElement.remove()" title="Remove attack"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>`;
  list.appendChild(row);
}

function _cmpShowPortrait() {
  const img = document.getElementById('cmp-portrait-img');
  const rm = document.getElementById('cmp-portrait-rm');
  const src = _cmpPortrait ? _cmpPortrait.portraitThumb || _cmpPortrait.portrait : '';
  if (img) { img.src = src || ''; img.style.display = src ? '' : 'none'; }
  if (rm) rm.style.display = src ? '' : 'none';
}

function chooseCompanionPortrait() {
  document.getElementById('cmp-portrait-input')?.click();
}

function onCompanionPortraitChosen(input) {
  const file = input.files[0];
  input.value = '';
  if (!file || !currentCharId) return;
  const reader = new FileReader();
  reader.onload = async e => {
    setStatus('Uploading picture…', false);
    try {
      const res = await fetch(`/api/characters/${currentCharId}/companion-portrait`, {
        method: 'POST',
        headers: sheetAuthHeaders(),
        // A picture uploaded a moment ago and replaced before saving is
        // nobody's. A saved one is left alone: a summoned token may show it.
        body: JSON.stringify({ dataUrl: e.target.result, replace: _cmpUploaded || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || 'Picture upload failed', true);
        return;
      }
      const d = await res.json();
      _cmpPortrait = { portrait: d.portrait, portraitThumb: d.portraitThumb };
      _cmpUploaded = d.portrait;
      _cmpShowPortrait();
      setStatus('Picture ready - press Save', false);
    } catch { setStatus('Connection error', true); }
  };
  reader.readAsDataURL(file);
}

function removeCompanionPortrait() {
  _cmpPortrait = null;
  _cmpShowPortrait();
}

function saveCompanionModal() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const name = val('cmp-name');
  if (!name) { document.getElementById('cmp-name')?.focus(); return; }
  const attacks = [...document.querySelectorAll('#cmp-atk-list .cmp-atk-row')].map(r => ({
    name:   r.querySelector('.cmp-atk-name').value.trim(),
    toHit:  r.querySelector('.cmp-atk-hit').value.trim().replace(/^\+/, ''),
    damage: r.querySelector('.cmp-atk-dmg').value.trim(),
  })).filter(a => a.name || a.damage);
  const c = {
    id: _cmpEditId || _cmpNewId(),
    name,
    portrait: _cmpPortrait ? _cmpPortrait.portrait : '',
    portraitThumb: _cmpPortrait ? _cmpPortrait.portraitThumb : '',
    size: parseInt(val('cmp-size')) || 1,
    hpMax: Math.max(0, parseInt(val('cmp-hp')) || 0),
    ac: val('cmp-ac') === '' ? '' : parseInt(val('cmp-ac')) || 0,
    speed: Math.max(0, parseInt(val('cmp-speed')) || 0),
    initBonus: parseInt(val('cmp-init')) || 0,
    initMode: val('cmp-init-mode') === 'own' ? 'own' : 'shared',
    attacks,
    notes: val('cmp-notes'),
  };
  const idx = companions.findIndex(x => x.id === c.id);
  if (idx >= 0) companions[idx] = c; else companions.push(c);
  closeCompanionModal();
  renderCompanions();
  scheduleAutoSave();
}

function deleteCompanion(id) {
  const c = companions.find(x => x.id === id);
  if (!c) return;
  showConfirm(`Delete "${c.name}"? Any already on the map stay there until dismissed.`, () => {
    companions = companions.filter(x => x.id !== id);
    renderCompanions();
    scheduleAutoSave();
  });
}

