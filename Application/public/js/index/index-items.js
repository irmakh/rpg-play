// Written by Irmak Hakman — 2026-10-15 14:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Equipment & Items ─────────────────────────────────────────────────────────
const ITEM_WEAPON_PROPS = ['Ammunition','Finesse','Heavy','Light','Loading','Range','Reach','Thrown','Two-Handed','Versatile'];

let editingItemId = null;
let detailItemId  = null;

function openItemModal(id) {
  editingItemId = id;
  document.getElementById('item-modal-title').textContent = id === null ? 'Add Item' : 'Edit Item';
  if (id === null) {
    document.getElementById('im-name').value = '';
    document.getElementById('im-type').value = 'wondrous';
    document.getElementById('im-armor-type').value = 'light';
    document.getElementById('im-ac-base').value = '10';
    document.getElementById('im-value').value = '';
    document.getElementById('im-equipped').checked = true;
    document.getElementById('im-req-attune').checked = false;
    document.getElementById('im-attuned').checked = false;
    document.getElementById('im-ac-bonus').value = '0';
    document.getElementById('im-init-bonus').value = '0';
    document.getElementById('im-speed-bonus').value = '0';
    document.getElementById('im-sp-atk-bonus').value = '0';
    document.getElementById('im-sp-dc-bonus').value = '0';
    document.getElementById('im-weapon-atk').value = '0';
    document.getElementById('im-weapon-dmg').value = '';
    initItemPropsGrid(); setSelectedItemProps([]);
    setItemBonusRows([]);
    document.getElementById('im-charges').value = '0';
    document.getElementById('im-charges-left').value = '0';
    document.getElementById('im-charges-long').checked = false;
    document.getElementById('im-notes').value = '';
  } else {
    const item = items.find(i => i.id === id);
    if (!item) return;
    document.getElementById('im-name').value = item.name;
    document.getElementById('im-type').value = item.itemType === 'item' ? 'wondrous' : item.itemType;
    document.getElementById('im-armor-type').value = item.armorType || 'light';
    document.getElementById('im-ac-base').value = item.acBase || 10;
    document.getElementById('im-value').value = item.value || '';
    document.getElementById('im-equipped').checked = item.equipped;
    document.getElementById('im-req-attune').checked = item.requiresAttunement;
    document.getElementById('im-attuned').checked = item.attuned;
    document.getElementById('im-ac-bonus').value = item.acBonus || 0;
    document.getElementById('im-init-bonus').value = item.initBonus || 0;
    document.getElementById('im-speed-bonus').value = item.speedBonus || 0;
    document.getElementById('im-sp-atk-bonus').value = item.spellAtkBonus || 0;
    document.getElementById('im-sp-dc-bonus').value = item.spellDcBonus || 0;
    document.getElementById('im-weapon-atk').value = item.weaponAtk || '0';
    document.getElementById('im-weapon-dmg').value = item.weaponDmg || '';
    initItemPropsGrid(); setSelectedItemProps(item.weaponProperties || []);
    setItemBonusRows(item.bonuses || []);
    document.getElementById('im-charges').value = itemChargesMax(item);
    document.getElementById('im-charges-left').value = itemChargesLeft(item);
    document.getElementById('im-charges-long').checked = item.chargesRecharge === 'long';
    document.getElementById('im-notes').value = item.notes || '';
  }
  itemTypeChange();
  itemAttuneChange();
  document.getElementById('item-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('im-name').focus(), 50);
}

function closeItemModal() {
  document.getElementById('item-modal').style.display = 'none';
  editingItemId = null;
}

// Everything an item holds comes from the sheet (the player's own, or an
// import), so every value below is escaped where it meets markup — ids go into
// onclick as HTML-escaped JSON literals, keeping number or string as stored.
function initItemPropsGrid() {
  const grid = document.getElementById('im-props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = ITEM_WEAPON_PROPS.map(p =>
    `<label style="display:flex;align-items:center;gap:calc(5px*var(--fs, 1));cursor:pointer;font-size:calc(12px * var(--fs, 1))">
      <input type="checkbox" id="iw-prop-${p.replace(/[^a-zA-Z]/g,'').toLowerCase()}" value="${p}" onchange="onItemPropChange()" style="width:calc(13px*var(--fs, 1));height:calc(13px*var(--fs, 1));accent-color:var(--bone)">
      ${p}</label>`
  ).join('');
}

// ── Generic item bonuses (saves / skills / ability checks) ────────────────────
function _bonusTargetOptionsHtml(selected) {
  // Guard against a stale/missing dnd-data.js so the +Add Bonus button still
  // adds a (currently empty) row rather than throwing and doing nothing.
  const groups = typeof ITEM_BONUS_GROUPS !== 'undefined' ? ITEM_BONUS_GROUPS : [];
  return groups.map(g =>
    `<optgroup label="${g.label}">` +
    g.opts.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('') +
    `</optgroup>`
  ).join('');
}

function addBonusRow(target = 'save-str', value = 1) {
  const list = document.getElementById('im-bonus-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'im-bonus-row';
  row.style.cssText = 'display:flex;gap:calc(6px*var(--fs, 1));margin-bottom:calc(4px*var(--fs, 1));align-items:center';
  row.innerHTML =
    `<select class="im-bonus-target" style="flex:1;font-size:calc(12px * var(--fs, 1))">${_bonusTargetOptionsHtml(target)}</select>`
    + `<input type="number" class="im-bonus-value" value="${parseInt(value) || 0}" style="width:calc(64px*var(--fs, 1))">`
    + `<button type="button" class="del-btn" onclick="removeBonusRow(this)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>`;
  list.appendChild(row);
}

function removeBonusRow(btn) {
  const row = btn.closest('.im-bonus-row');
  if (row) row.remove();
}

function setItemBonusRows(bonuses) {
  const list = document.getElementById('im-bonus-list');
  if (list) list.innerHTML = '';
  (bonuses || []).forEach(b => addBonusRow(b.target, b.value));
}

function getItemBonusRows() {
  const rows = [];
  document.querySelectorAll('#im-bonus-list .im-bonus-row').forEach(r => {
    const target = r.querySelector('.im-bonus-target')?.value;
    const value  = parseInt(r.querySelector('.im-bonus-value')?.value) || 0;
    if (target && value) rows.push({ target, value });
  });
  return rows;
}

function getSelectedItemProps() {
  return ITEM_WEAPON_PROPS.filter(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    return el && el.checked;
  });
}

function setSelectedItemProps(props) {
  ITEM_WEAPON_PROPS.forEach(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    if (el) el.checked = Array.isArray(props) && props.includes(p);
  });
  updateItemPropsLimit();
}

function onItemPropChange() {
  const selected = getSelectedItemProps();
  if (selected.length > 3) {
    document.getElementById('iw-prop-' + selected[selected.length - 1].replace(/[^a-zA-Z]/g,'').toLowerCase()).checked = false;
  }
  updateItemPropsLimit();
}

function updateItemPropsLimit() {
  const selected = getSelectedItemProps();
  const atMax = selected.length >= 3;
  const counter = document.getElementById('im-props-count');
  if (counter) counter.textContent = `(${selected.length}/3)`;
  ITEM_WEAPON_PROPS.forEach(p => {
    const el = document.getElementById('iw-prop-' + p.replace(/[^a-zA-Z]/g,'').toLowerCase());
    if (el) el.disabled = atMax && !el.checked;
  });
}

function calcWeaponAtkStr(magicBonus, props) {
  const strMod = getMod('str'), dexMod = getMod('dex');
  const prof = parseInt(document.querySelector('[data-key="profbonus"]')?.value) || 0;
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod : strMod;
  const total = prof + abilityMod + magicBonus;
  return (total >= 0 ? '+' : '') + total;
}

/**
 * Applies the ability + magic bonus to a weapon's damage string.
 *
 * The string may list several typed parts ("1d6 piercing, 2d8 fire"). The bonus
 * belongs to the WEAPON's own damage, so it lands on the first part only —
 * a flaming sword adds Strength to the slashing, not to the fire.
 */
function calcWeaponDmgStr(magicBonus, dmgRaw, props) {
  const strMod = getMod('str'), dexMod = getMod('dex');
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod : strMod;
  const raw = (dmgRaw || '1d4').trim();
  const dmgBonus = abilityMod + magicBonus;
  if (dmgBonus === 0) return raw;

  const spec = typeof parseDamageSpec === 'function' ? parseDamageSpec(raw) : null;
  if (!spec) return raw;   // unparseable — leave the user's text alone

  return spec.parts.map((p, i) => {
    const mod = p.modifier + (i === 0 ? dmgBonus : 0);
    const modStr = mod === 0 ? '' : (mod > 0 ? '+' : '') + mod;
    const dice = p.sides ? `${p.count}d${p.sides}${modStr}` : String(p.flat + (i === 0 ? dmgBonus : 0));
    return p.type === DMG_GENERIC ? dice : `${dice} ${p.type}`;
  }).join(', ');
}

function syncWeaponItemToAttacks(item) {
  const props = item.weaponProperties || [];
  const magic = parseInt(item.weaponAtk) || 0;
  const atkStr = calcWeaponAtkStr(magic, props);
  const dmgStr = calcWeaponDmgStr(magic, item.weaponDmg, props);
  const notes = item.notes || '';
  const existing = document.querySelector(`#wpn-tbl tr[data-item-id="${item.id}"]`);
  if (existing) {
    const inp = existing.querySelectorAll('input[type=text], input[type=number]');
    if (inp[0]) inp[0].value = item.name;
    if (inp[1]) inp[1].value = atkStr;
    if (inp[2]) inp[2].value = dmgStr;
    if (inp[3]) inp[3].value = notes;
  } else {
    const tbl = document.getElementById('wpn-tbl');
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.innerHTML = `<td><input type="text" value="${esc(item.name)}"></td><td><div style="display:flex;align-items:center;gap:calc(2px*var(--fs, 1))"><input type="text" value="${esc(atkStr)}" style="width:calc(46px*var(--fs, 1))"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-dice"></use></svg></button></div></td><td><div style="display:flex;align-items:center;gap:calc(2px*var(--fs, 1))"><input type="text" value="${esc(dmgStr)}"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-dice"></use></svg></button></div></td><td><input type="text" value="${esc(notes)}"></td><td><button class="del-btn" onclick="delRow(this)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button></td>`;
    tbl.appendChild(tr);
  }
  renderWeaponsSummary();
}

function itemTypeChange() {
  const t = document.getElementById('im-type').value;
  const isArmor = t === 'armor';
  const isWeapon = t === 'weapon';
  document.getElementById('im-armor-type-wrap').style.display = isArmor ? 'block' : 'none';
  document.getElementById('im-ac-base-wrap').style.display = isArmor ? 'block' : 'none';
  document.getElementById('im-weapon-fields').style.display = isWeapon ? 'block' : 'none';
  if (isWeapon) initItemPropsGrid();
  if (t === 'shield' && parseInt(document.getElementById('im-ac-bonus').value) === 0) {
    document.getElementById('im-ac-bonus').value = '2';
  }
}

function itemAttuneChange() {
  const reqAttune = document.getElementById('im-req-attune').checked;
  document.getElementById('im-attune-wrap').style.display = reqAttune ? 'block' : 'none';
  if (!reqAttune) document.getElementById('im-attuned').checked = false;
}

function saveItemModal() {
  const name = document.getElementById('im-name').value.trim();
  if (!name) { document.getElementById('im-name').focus(); return; }
  const itemType = document.getElementById('im-type').value;
  const item = {
    id: editingItemId !== null ? editingItemId : ++itemIdCounter,
    name,
    itemType,
    weaponAtk: itemType === 'weapon' ? (parseInt(document.getElementById('im-weapon-atk').value) || 0) : 0,
    weaponDmg: itemType === 'weapon' ? document.getElementById('im-weapon-dmg').value.trim() : '',
    weaponProperties: itemType === 'weapon' ? getSelectedItemProps() : [],
    armorType: document.getElementById('im-armor-type').value,
    acBase: parseInt(document.getElementById('im-ac-base').value) || 10,
    value: document.getElementById('im-value').value.trim(),
    equipped: document.getElementById('im-equipped').checked,
    requiresAttunement: document.getElementById('im-req-attune').checked,
    attuned: document.getElementById('im-attuned').checked,
    acBonus: parseInt(document.getElementById('im-ac-bonus').value) || 0,
    initBonus: parseInt(document.getElementById('im-init-bonus').value) || 0,
    speedBonus: parseInt(document.getElementById('im-speed-bonus').value) || 0,
    spellAtkBonus: parseInt(document.getElementById('im-sp-atk-bonus').value) || 0,
    spellDcBonus: parseInt(document.getElementById('im-sp-dc-bonus').value) || 0,
    bonuses: getItemBonusRows(),
    notes: document.getElementById('im-notes').value
  };
  // Charges are stored as how many it holds and how many are gone.
  item.charges = Math.max(0, Math.min(999, parseInt(document.getElementById('im-charges').value) || 0));
  const left = Math.max(0, Math.min(item.charges, parseInt(document.getElementById('im-charges-left').value) || 0));
  item.chargesUsed = item.charges - left;
  item.chargesRecharge = item.charges && document.getElementById('im-charges-long').checked ? 'long' : '';
  if (editingItemId !== null) {
    const idx = items.findIndex(i => i.id === editingItemId);
    // Keep what the form does not show (where the item came from, its picture,
    // whether it is still unidentified) — the form used to drop them on save.
    if (idx >= 0) items[idx] = Object.assign({}, items[idx], item); else items.push(item);
  } else {
    items.push(item);
  }
  if (item.itemType === 'weapon') syncWeaponItemToAttacks(item);
  closeItemModal();
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
  scheduleAutoSave();
}

// ── Charges ───────────────────────────────────────────────────────────────────
function itemChargesMax(item)  { return Math.max(0, parseInt(item && item.charges) || 0); }
function itemChargesLeft(item) {
  const max = itemChargesMax(item);
  return Math.max(0, max - Math.min(max, parseInt(item && item.chargesUsed) || 0));
}

// Spend one charge and tell the table.
function useItemCharge(id) {
  const item = items.find(i => i.id === id);
  if (!item || itemChargesLeft(item) <= 0) return;
  item.chargesUsed = (parseInt(item.chargesUsed) || 0) + 1;
  renderItems();
  scheduleAutoSave();
  const who = getChatSender();
  postToChat({
    sender: who, type: 'text', html: true,
    message: `<strong>${esc(item.name)}</strong><div style="font-size:calc(10px * var(--fs, 1));opacity:.7;margin-top:1px">`
      + `${esc(who)} uses a charge · ${itemChargesLeft(item)} of ${itemChargesMax(item)} left</div>`,
  });
}

function refillItemCharges(id) {
  const item = items.find(i => i.id === id);
  if (!item || !itemChargesMax(item)) return;
  item.chargesUsed = 0;
  renderItems();
  scheduleAutoSave();
}

// A long rest refills the items that say it does. Called from actionRest().
function restItemCharges(type) {
  if (type !== 'long') return 0;
  let changed = 0;
  items.forEach(i => {
    if (i && i.chargesRecharge === 'long' && (parseInt(i.chargesUsed) || 0) !== 0) { i.chargesUsed = 0; changed++; }
  });
  if (changed) renderItems();
  return changed;
}

function toggleItemEquipped(id) {
  const item = items.find(i => i.id === id);
  if (item) { item.equipped = !item.equipped; renderItems(); renderWeaponsSummary(); renderEquippedItemsSummary(); recalcAll(); scheduleAutoSave(); }
}

function deleteItem(id) {
  const wpnRow = document.querySelector(`#wpn-tbl tr[data-item-id="${id}"]`);
  if (wpnRow) wpnRow.remove();
  items = items.filter(i => i.id !== id);
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
  scheduleAutoSave();
}

function openItemDetail(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  detailItemId = id;
  document.getElementById('item-detail-title').textContent = item.name;
  const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                  : item.itemType === 'shield' ? 'Shield'
                  : item.itemType === 'weapon' ? 'Weapon'
                  : item.itemType === 'wondrous' || item.itemType === 'item' ? 'Wondrous / Magic Item'
                  : item.itemType === 'potion' ? 'Potion / Consumable'
                  : 'Other';
  const rows = [['Type', typeLabel]];
  if (item.value) rows.push(['Value', item.value]);
  if (item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',         (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus', (item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',      (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  if (item.spellAtkBonus) rows.push(['Spell Atk Bonus', (item.spellAtkBonus > 0 ? '+' : '') + item.spellAtkBonus]);
  if (item.spellDcBonus)  rows.push(['Spell DC Bonus',  (item.spellDcBonus  > 0 ? '+' : '') + item.spellDcBonus]);
  (item.bonuses || []).forEach(b => {
    if (b && b.value) rows.push([itemBonusTargetLabel(b.target), (b.value > 0 ? '+' : '') + b.value]);
  });
  if (itemChargesMax(item)) {
    rows.push(['Charges', `${itemChargesLeft(item)} of ${itemChargesMax(item)} left`
      + (item.chargesRecharge === 'long' ? ' · refills on a long rest' : '')]);
  }
  rows.push(['Equipped', item.equipped ? 'Yes' : 'No']);
  if (item.requiresAttunement) rows.push(['Attuned', item.attuned ? 'Yes' : 'No']);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:calc(12px * var(--fs, 1))">` +
    rows.map(([k, v]) => `<tr><td style="padding:calc(4px*var(--fs, 1)) calc(6px*var(--fs, 1));color:var(--ash);width:42%">${esc(k)}</td><td style="padding:calc(4px*var(--fs, 1)) calc(6px*var(--fs, 1));font-weight:bold">${esc(String(v))}</td></tr>`).join('') +
    `</table>`;
  if (item.notes) html += `<div style="margin-top:calc(10px*var(--fs, 1))"><div class="lbl" style="margin-bottom:calc(4px*var(--fs, 1))">Notes</div><div style="font-size:calc(12px * var(--fs, 1));white-space:pre-wrap;line-height:1.5">${esc(item.notes)}</div></div>`;
  document.getElementById('item-detail-body').innerHTML = html;
  document.getElementById('item-detail-modal').style.display = 'flex';
}

function closeItemDetail() {
  document.getElementById('item-detail-modal').style.display = 'none';
  detailItemId = null;
}

function editFromDetail() {
  const id = detailItemId;
  closeItemDetail();
  openItemModal(id);
}

function renderItems() {
  const body = document.getElementById('items-body');
  if (!body) return;
  if (items.length === 0) {
    body.innerHTML = '<div style="color:var(--ash);font-size:calc(11px * var(--fs, 1));padding:calc(4px*var(--fs, 1)) 0">No items — click "+ Add Item" to begin.</div>';
    return;
  }

  const equipped = items.filter(i => i.equipped);
  const totalAC = equipped.reduce((s, i) => s + (parseInt(i.acBonus) || 0), 0);
  const totalInit = equipped.reduce((s, i) => s + (parseInt(i.initBonus) || 0), 0);
  const totalSpeed = equipped.reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
  const armorItem = equipped.find(i => i.itemType === 'armor');

  let summaryParts = [];
  if (armorItem) summaryParts.push(`${armorItem.name} (base ${armorItem.acBase})`);
  if (totalAC !== 0) summaryParts.push(`AC ${totalAC > 0 ? '+' : ''}${totalAC}`);
  if (totalInit !== 0) summaryParts.push(`Init ${totalInit > 0 ? '+' : ''}${totalInit}`);
  if (totalSpeed !== 0) summaryParts.push(`Spd ${totalSpeed > 0 ? '+' : ''}${totalSpeed} ft`);

  const rows = items.map(item => {
    const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                   : item.itemType === 'shield' ? 'shield'
                   : item.itemType === 'weapon' ? 'weapon'
                   : item.itemType === 'wondrous' || item.itemType === 'item' ? 'wondrous'
                   : item.itemType === 'potion' ? 'potion'
                   : 'other';
    const bonusParts = [];
    if (item.itemType === 'armor') bonusParts.push(`AC${item.acBase}`);
    if (item.acBonus) bonusParts.push(`AC${item.acBonus > 0 ? '+' : ''}${item.acBonus}`);
    if (item.initBonus) bonusParts.push(`Init${item.initBonus > 0 ? '+' : ''}${item.initBonus}`);
    if (item.speedBonus) bonusParts.push(`Spd${item.speedBonus > 0 ? '+' : ''}${item.speedBonus}`);
    if (item.spellAtkBonus) bonusParts.push(`SpAtk${item.spellAtkBonus > 0 ? '+' : ''}${item.spellAtkBonus}`);
    if (item.spellDcBonus) bonusParts.push(`SpDC${item.spellDcBonus > 0 ? '+' : ''}${item.spellDcBonus}`);
    const nBonus = (item.bonuses || []).filter(b => b && b.value).length;
    if (nBonus) bonusParts.push(`✦${nBonus}`);
    const bonusStr = bonusParts.join(' ');
    const attuneStr = item.attuned ? ' 🔮' : '';
    const equippedStyle = item.equipped ? 'color:var(--arc-hi);font-weight:bold' : 'color:var(--ash)';
    const valueStr = item.value ? ` · <span style="color:var(--arc)">${esc(item.value)}</span>` : '';
    // An unidentified item under the DM's stand-in name carries no marker in
    // the name itself, so it gets one here.
    const unidStr = item.unidentified && !/\(unidentified\)\s*$/.test(item.name || '')
      ? ' <span class="item-unid" title="Its properties are unknown until the DM identifies it">unidentified</span>' : '';
    const max = itemChargesMax(item), left = itemChargesLeft(item);
    const idLit = esc(JSON.stringify(item.id));
    const chargeStr = max
      ? `<span class="item-charges${left ? '' : ' empty'}" title="Charges left">⚡ ${left}/${max}</span>`
        + `<button class="char-btn item-use" ${left ? '' : 'disabled'} onclick="useItemCharge(${idLit})" title="Use one charge">Use</button>`
        + (left < max ? `<button class="char-btn item-use" onclick="refillItemCharges(${idLit})" title="Restore every charge">Refill</button>` : '')
      : '';

    return `<div class="item-row">
      <input type="checkbox" class="item-chk" ${item.equipped ? 'checked' : ''} onchange="toggleItemEquipped(${esc(JSON.stringify(item.id))})" title="Equipped">
      <span class="item-name" style="${equippedStyle};cursor:pointer" onclick="openItemDetail(${esc(JSON.stringify(item.id))})">${esc(item.name)}${attuneStr}${unidStr}</span>
      <span class="item-meta">${esc(typeLabel)}${bonusStr ? ' · ' + esc(bonusStr) : ''}${valueStr}</span>
      ${chargeStr}
      <button class="char-btn" style="padding:calc(2px*var(--fs, 1)) calc(8px*var(--fs, 1));font-size:calc(11px * var(--fs, 1))" onclick="openItemModal(${esc(JSON.stringify(item.id))})">Edit</button>
      <button class="del-btn" onclick="deleteItem(${esc(JSON.stringify(item.id))})"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>
    </div>`;
  }).join('');

  const summary = summaryParts.length > 0
    ? `<div style="font-size:calc(10px * var(--fs, 1));color:var(--ash);margin-top:calc(6px*var(--fs, 1));padding-top:calc(4px*var(--fs, 1));border-top:1px solid var(--rule)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-bolt"></use></svg> Equipped: ${esc(summaryParts.join(' · '))}</div>`
    : '';

  body.innerHTML = rows + summary;
}

function renderWeaponsSummary() {
  // The Main-tab "Weapons & Attacks" summary card was removed. Weapon attacks now
  // live on the Actions tab; any weapon change re-renders that tab's display.
  if (typeof renderActionsTab === 'function') renderActionsTab();
}

function renderEquippedItemsSummary() {
  const el = document.getElementById('main-items-summary');
  if (!el) return;
  const equipped = items.filter(i => i.equipped);
  if (equipped.length === 0) {
    el.innerHTML = '<div style="color:var(--ash);font-size:calc(11px * var(--fs, 1));padding:calc(4px*var(--fs, 1)) 0">No equipped items — add them in the Inventory tab.</div>';
    return;
  }
  const html = equipped.map(item => {
    const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                    : item.itemType === 'shield' ? 'shield'
                    : item.itemType === 'weapon' ? 'weapon'
                    : item.itemType === 'potion' ? 'potion'
                    : 'wondrous';
    const chips = [];
    if (item.itemType === 'armor') chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">Base AC ${esc(item.acBase)}</span>`);
    if (item.acBonus)    chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">AC ${item.acBonus > 0 ? '+' : ''}${esc(item.acBonus)}</span>`);
    if (item.initBonus)  chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">Init ${item.initBonus > 0 ? '+' : ''}${esc(item.initBonus)}</span>`);
    if (item.speedBonus) chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">Speed ${item.speedBonus > 0 ? '+' : ''}${esc(item.speedBonus)} ft</span>`);
    if (item.spellAtkBonus) chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">Spell Atk ${item.spellAtkBonus > 0 ? '+' : ''}${esc(item.spellAtkBonus)}</span>`);
    if (item.spellDcBonus)  chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">Spell DC ${item.spellDcBonus > 0 ? '+' : ''}${esc(item.spellDcBonus)}</span>`);
    (item.bonuses || []).forEach(b => {
      if (b && b.value) chips.push(`<span style="background:var(--rule-hi);padding:1px calc(5px*var(--fs, 1));border-radius:calc(3px*var(--fs, 1));font-size:calc(10px * var(--fs, 1))">${esc(itemBonusTargetLabel(b.target))} ${b.value > 0 ? '+' : ''}${esc(b.value)}</span>`);
    });
    const attuneStr = item.attuned ? ' 🔮' : '';
    const notesSnip = item.notes ? `<div style="font-size:calc(10px * var(--fs, 1));color:var(--ash);margin-top:calc(2px*var(--fs, 1))">${esc(item.notes.slice(0,80))}${item.notes.length > 80 ? '…' : ''}</div>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:calc(6px*var(--fs, 1));padding:calc(4px*var(--fs, 1)) 0;border-bottom:1px solid var(--rule)">
      <div style="flex:1;min-width:0">
        <span style="font-weight:bold;color:var(--arc-hi);cursor:pointer" onclick="showTab('inventory',document.querySelector('.tab[onclick*=inventory]'));openItemDetail(${esc(JSON.stringify(item.id))})">${esc(item.name)}${attuneStr}</span>
        <span style="color:var(--ash);font-size:calc(10px * var(--fs, 1));margin-left:calc(4px*var(--fs, 1))">${esc(typeLabel)}</span>
        ${chips.length ? `<div style="display:flex;flex-wrap:wrap;gap:calc(3px*var(--fs, 1));margin-top:calc(3px*var(--fs, 1))">${chips.join('')}</div>` : ''}
        ${notesSnip}
      </div>
    </div>`;
  }).join('');
  el.innerHTML = html;
}
