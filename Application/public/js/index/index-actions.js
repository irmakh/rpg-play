// ── Actions tab ───────────────────────────────────────────────────────────────
// Aggregates weapon attacks (from the hidden #wpn-tbl, fed by Inventory weapons),
// spells the user has flagged with an action type, and custom actions stored in the
// global `actions` array. Supports limited-use tracking + dice rolls.
//
// Custom action shape:
//   { id, name, category:'action'|'bonus'|'reaction'|'other', description, dice,
//     uses (max, 0 = no tracking), used (current), recharge:'short'|'long'|'' }

const ACT_CAT_LABEL = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction', other: 'Other' };

// ── Data readers ────────────────────────────────────────────────────────────────
function _actAttackRange(itemId) {
  if (itemId != null) {
    const it = (typeof items !== 'undefined' ? items : []).find(i => i.id === itemId);
    const p = (it && it.weaponProperties) || [];
    if (p.includes('Reach'))                                return '10 ft.';
    if (p.includes('Ammunition') || p.includes('Thrown'))  return 'ranged';
  }
  return '5 ft.';
}

function _actCollectAttacks() {
  const rows = [];
  document.querySelectorAll('#wpn-tbl tr:not(:first-child)').forEach(tr => {
    const inp = tr.querySelectorAll('input[type=text], input[type=number]');
    if (inp.length < 3) return;
    const name = (inp[0].value || '').trim();
    if (!name) return;
    rows.push({
      name,
      atk: inp[1]?.value || '+0',
      dmg: inp[2]?.value || '',
      notes: inp[3]?.value || '',
      range: _actAttackRange(tr.dataset.itemId ? parseInt(tr.dataset.itemId) : null)
    });
  });
  return rows;
}

// Spells flagged with an action category, grouped by category.
function _actCollectSpells() {
  const out = { action: [], bonus: [], reaction: [] };
  document.querySelectorAll('#spell-tbl tr:not(:first-child)').forEach(tr => {
    const cat = tr.querySelector('.spell-action')?.value || '';
    if (!out[cat]) return;
    const txts = tr.querySelectorAll('input[type=text], input[type=number]');
    const name = (txts[1]?.value || '').trim();
    if (!name) return;
    out[cat].push({
      name,
      level: txts[0]?.value || '0',
      notes: tr.querySelector('.spell-notes')?.value || '',
      duration: tr.querySelector('.spell-duration')?.value || ''
    });
  });
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────────
function renderActionsTab() {
  const body = document.getElementById('actions-body');
  if (!body) return;
  const filter = _actionFilter || 'all';
  const attacks = _actCollectAttacks();
  const spells = _actCollectSpells();

  // LIMITED USE view: flat list of every custom action that tracks uses.
  if (filter === 'limited') {
    const limited = actions.filter(a => (parseInt(a.uses) || 0) > 0);
    body.innerHTML = limited.length
      ? `<div class="act-section">${limited.map(_actRenderCustom).join('')}</div>`
      : _actEmpty('No limited-use actions yet.');
    return;
  }

  let html = '';
  const showCat = c => filter === 'all' || filter === c;
  const showAttacks = filter === 'all' || filter === 'attack';

  // ACTIONS section (attacks + action spells + custom actions)
  if (showAttacks || showCat('action')) {
    let inner = '';
    if (showAttacks) inner += _actRenderAttacks(attacks);
    if (showCat('action')) {
      inner += _actRenderSpellList(spells.action);
      inner += actions.filter(a => a.category === 'action').map(_actRenderCustom).join('');
    }
    if (inner.trim()) html += `<div class="act-section"><div class="act-section-hdr">Actions</div>${inner}</div>`;
  }

  // BONUS ACTIONS
  if (showCat('bonus')) {
    let inner = _actRenderSpellList(spells.bonus)
      + actions.filter(a => a.category === 'bonus').map(_actRenderCustom).join('');
    if (inner.trim()) html += `<div class="act-section"><div class="act-section-hdr">Bonus Actions</div>${inner}</div>`;
  }

  // REACTIONS
  if (showCat('reaction')) {
    let inner = _actRenderSpellList(spells.reaction)
      + actions.filter(a => a.category === 'reaction').map(_actRenderCustom).join('');
    if (inner.trim()) html += `<div class="act-section"><div class="act-section-hdr">Reactions</div>${inner}</div>`;
  }

  // OTHER
  if (showCat('other')) {
    const inner = actions.filter(a => a.category === 'other').map(_actRenderCustom).join('');
    if (inner.trim()) html += `<div class="act-section"><div class="act-section-hdr">Other</div>${inner}</div>`;
  }

  body.innerHTML = html || _actEmpty('Nothing here yet. Add weapons in Inventory, flag spells on the Spells tab, or click MANAGE CUSTOM.');
}

function _actEmpty(msg) {
  return `<div style="color:var(--txd);font-size:11px;padding:10px 4px;text-align:center">${esc(msg)}</div>`;
}

function _actRenderAttacks(attacks) {
  if (!attacks.length) return '';
  const rows = attacks.map(w => {
    const n = esc(w.name), a = esc(w.atk || '+0'), d = esc(w.dmg || '—');
    const atkBtn = `<button class="roll-btn" data-name="${n}" data-val="${a}" onclick="rollWeaponAtkVal(this.dataset.name,this.dataset.val)" title="Roll attack">🎲</button>`;
    const dmgBtn = w.dmg
      ? `<button class="roll-btn" data-name="${n}" data-val="${esc(w.dmg)}" data-notes="${esc(w.notes)}" onclick="rollWeaponDmgVal(this.dataset.name,this.dataset.val,this.dataset.notes)" title="Roll damage">🎲</button>`
      : '';
    return `<tr>
      <td class="act-atk-name">${n}</td>
      <td class="act-atk-range">${esc(w.range)}</td>
      <td class="act-atk-hit"><span>${a}</span>${atkBtn}</td>
      <td class="act-atk-dmg"><span>${d}</span>${dmgBtn}</td>
      <td class="act-atk-notes">${esc(w.notes)}</td>
    </tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table class="act-atk-tbl">
    <tr><th>Attack</th><th>Range</th><th>Hit/DC</th><th>Damage</th><th>Notes</th></tr>${rows}</table></div>`;
}

function _actRenderSpellList(list) {
  if (!list || !list.length) return '';
  const spAtkEl = document.querySelector('[data-key="sp-atk"]');
  const spAtk = spAtkEl ? spAtkEl.value : '';
  return list.map(sp => {
    const n = esc(sp.name);
    const lvl = sp.level && sp.level !== '0' ? `(${esc(sp.level)})` : '(cantrip)';
    const atkBtn = spAtk
      ? `<button class="roll-btn" data-name="${n}" data-val="${esc(spAtk)}" onclick="startRoll(this.dataset.name + ' (Spell Atk)', this.dataset.val)" title="Roll spell attack">🎲</button>`
      : '';
    const dmgMatch = (sp.notes || '').match(/\d+d\d+(\s*[+-]\s*\d+)?/);
    const dmgBtn = dmgMatch
      ? `<button class="roll-btn" data-name="${n}" data-val="${esc(dmgMatch[0])}" onclick="rollDamage(this.dataset.name + ' Damage', this.dataset.val)" title="Roll damage ${esc(dmgMatch[0])}">⚔️</button>`
      : '';
    return `<div class="act-item act-spell">
      <div class="act-head"><span class="act-name">${n}</span> <span class="act-lvl">${lvl}</span>
        <span class="act-controls">${atkBtn}${dmgBtn}</span></div>
      ${sp.notes ? `<div class="act-desc">${esc(sp.notes)}</div>` : ''}
    </div>`;
  }).join('');
}

function _actRenderCustom(a) {
  const n = esc(a.name || 'Action');
  const uses = parseInt(a.uses) || 0;
  const used = Math.min(parseInt(a.used) || 0, uses);
  const dice = (a.dice || '').trim();
  const tag = ACT_CAT_LABEL[a.category] || 'Action';
  const diceBtn = dice
    ? `<button class="roll-btn" data-name="${n}" data-val="${esc(dice)}" onclick="rollDamage(this.dataset.name, this.dataset.val)" title="Roll ${esc(dice)}">🎲 ${esc(dice)}</button>`
    : '';
  let usesHtml = '';
  if (uses > 0) {
    let boxes = '';
    for (let i = 0; i < uses; i++) {
      boxes += `<span class="act-box${i < used ? ' used' : ''}" onclick="toggleActionBox(${a.id},${i})" title="${i < used ? 'Restore use' : 'Use'}"></span>`;
    }
    const rechargeLbl = a.recharge === 'short' ? 'Short Rest' : a.recharge === 'long' ? 'Long Rest' : '';
    usesHtml = `<div class="act-uses">${boxes}${rechargeLbl ? `<span class="act-recharge">/ ${rechargeLbl}</span>` : ''}</div>`;
  }
  return `<div class="act-item">
    <div class="act-head">
      <span class="act-name">${n}</span> <span class="act-tag">${esc(tag)}</span>
      <span class="act-controls">${diceBtn}<button class="act-edit-btn" onclick="openActionModal(${a.id})" title="Edit">✎</button></span>
    </div>
    ${a.description ? `<div class="act-desc">${esc(a.description)}</div>` : ''}
    ${usesHtml}
  </div>`;
}

// ── Filter chips ──────────────────────────────────────────────────────────────
function setActionFilter(f, btn) {
  _actionFilter = f;
  document.querySelectorAll('#act-filters .act-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderActionsTab();
}

// ── Limited-use tracking ──────────────────────────────────────────────────────
function toggleActionBox(id, idx) {
  const a = actions.find(x => x.id === id);
  if (!a) return;
  const prevUsed = Math.min(parseInt(a.used) || 0, parseInt(a.uses) || 0);
  if (idx < prevUsed) {
    a.used = idx;            // clicking a filled box restores down to it
  } else {
    a.used = idx + 1;        // clicking an empty box consumes up to it
    if ((a.dice || '').trim()) rollDamage(a.name || 'Action', a.dice.trim());
  }
  renderActionsTab();
  scheduleAutoSave();
}

function actionRest(type) {
  let changed = 0;
  actions.forEach(a => {
    // Long rest restores both long- and short-recharge uses; short rest only short.
    if (a.recharge === 'short' || (type === 'long' && a.recharge === 'long')) {
      if ((parseInt(a.used) || 0) !== 0) { a.used = 0; changed++; }
    }
  });
  renderActionsTab();
  if (changed) scheduleAutoSave();
}

// ── Custom action modal ───────────────────────────────────────────────────────
let _editingActionId = null;

function openActionModal(id) {
  _editingActionId = id;
  const a = id != null ? actions.find(x => x.id === id) : null;
  document.getElementById('act-modal-title').textContent = a ? 'Edit Action' : 'Add Action';
  document.getElementById('am-name').value = a ? (a.name || '') : '';
  document.getElementById('am-category').value = a ? (a.category || 'action') : 'action';
  document.getElementById('am-desc').value = a ? (a.description || '') : '';
  document.getElementById('am-dice').value = a ? (a.dice || '') : '';
  document.getElementById('am-uses').value = a ? (a.uses || 0) : 0;
  document.getElementById('am-recharge').value = a ? (a.recharge || '') : '';
  document.getElementById('am-delete-btn').style.display = a ? 'inline-block' : 'none';
  document.getElementById('action-modal').style.display = 'flex';
  document.getElementById('am-name').focus();
}

function closeActionModal() {
  document.getElementById('action-modal').style.display = 'none';
  _editingActionId = null;
}

function saveActionModal() {
  const name = document.getElementById('am-name').value.trim();
  if (!name) { document.getElementById('am-name').focus(); return; }
  const uses = Math.max(0, parseInt(document.getElementById('am-uses').value) || 0);
  const fields = {
    name,
    category: document.getElementById('am-category').value || 'action',
    description: document.getElementById('am-desc').value.trim(),
    dice: document.getElementById('am-dice').value.trim(),
    uses,
    recharge: document.getElementById('am-recharge').value || ''
  };
  if (_editingActionId != null) {
    const a = actions.find(x => x.id === _editingActionId);
    if (a) { Object.assign(a, fields); a.used = Math.min(parseInt(a.used) || 0, uses); }
  } else {
    actions.push({ id: ++actionIdCounter, used: 0, ...fields });
  }
  closeActionModal();
  renderActionsTab();
  scheduleAutoSave();
}

function deleteActionEntry() {
  if (_editingActionId == null) return;
  const id = _editingActionId;
  const a = actions.find(x => x.id === id);
  showConfirm('Delete ' + (a ? (a.name || 'this action') : 'this action') + '?', () => {
    actions = actions.filter(x => x.id !== id);
    closeActionModal();
    renderActionsTab();
    scheduleAutoSave();
  });
}
