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
    document.getElementById('im-weapon-atk').value = '0';
    document.getElementById('im-weapon-dmg').value = '';
    initItemPropsGrid(); setSelectedItemProps([]);
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
    document.getElementById('im-weapon-atk').value = item.weaponAtk || '0';
    document.getElementById('im-weapon-dmg').value = item.weaponDmg || '';
    initItemPropsGrid(); setSelectedItemProps(item.weaponProperties || []);
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

function initItemPropsGrid() {
  const grid = document.getElementById('im-props-grid');
  if (!grid || grid.childElementCount > 0) return;
  grid.innerHTML = ITEM_WEAPON_PROPS.map(p =>
    `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px">
      <input type="checkbox" id="iw-prop-${p.replace(/[^a-zA-Z]/g,'').toLowerCase()}" value="${p}" onchange="onItemPropChange()" style="width:13px;height:13px;accent-color:var(--ac)">
      ${p}</label>`
  ).join('');
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

function calcWeaponDmgStr(magicBonus, dmgRaw, props) {
  const strMod = getMod('str'), dexMod = getMod('dex');
  const abilityMod = props.includes('Finesse') ? Math.max(strMod, dexMod)
                   : props.includes('Ammunition') ? dexMod : strMod;
  const raw = (dmgRaw || '1d4').trim();
  const spaceIdx = raw.indexOf(' ');
  const dicePart = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
  const typePart = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();
  const dmgBonus = abilityMod + magicBonus;
  return dmgBonus > 0 ? `${dicePart}+${dmgBonus}${typePart ? ' ' + typePart : ''}`
       : dmgBonus < 0 ? `${dicePart}${dmgBonus}${typePart ? ' ' + typePart : ''}`
       : raw;
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
    tr.innerHTML = `<td><input type="text" value="${esc(item.name)}"></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(atkStr)}" style="width:46px"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack">🎲</button></div></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="${esc(dmgStr)}"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage">🎲</button></div></td><td><input type="text" value="${esc(notes)}"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
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
    notes: document.getElementById('im-notes').value
  };
  if (editingItemId !== null) {
    const idx = items.findIndex(i => i.id === editingItemId);
    if (idx >= 0) items[idx] = item; else items.push(item);
  } else {
    items.push(item);
  }
  if (item.itemType === 'weapon') syncWeaponItemToAttacks(item);
  closeItemModal();
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
}

function toggleItemEquipped(id) {
  const item = items.find(i => i.id === id);
  if (item) { item.equipped = !item.equipped; renderItems(); renderWeaponsSummary(); renderEquippedItemsSummary(); recalcAll(); }
}

function deleteItem(id) {
  const wpnRow = document.querySelector(`#wpn-tbl tr[data-item-id="${id}"]`);
  if (wpnRow) wpnRow.remove();
  items = items.filter(i => i.id !== id);
  renderItems();
  renderWeaponsSummary();
  renderEquippedItemsSummary();
  recalcAll();
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
                  : 'Other';
  const rows = [['Type', typeLabel]];
  if (item.value) rows.push(['Value', item.value]);
  if (item.itemType === 'armor') rows.push(['Base AC', item.acBase]);
  if (item.acBonus)    rows.push(['AC Bonus',         (item.acBonus   > 0 ? '+' : '') + item.acBonus]);
  if (item.initBonus)  rows.push(['Initiative Bonus', (item.initBonus > 0 ? '+' : '') + item.initBonus]);
  if (item.speedBonus) rows.push(['Speed Bonus',      (item.speedBonus > 0 ? '+' : '') + item.speedBonus + ' ft']);
  rows.push(['Equipped', item.equipped ? 'Yes' : 'No']);
  if (item.requiresAttunement) rows.push(['Attuned', item.attuned ? 'Yes' : 'No']);
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 6px;color:var(--txd);width:42%">${k}</td><td style="padding:4px 6px;font-weight:bold">${esc(String(v))}</td></tr>`).join('') +
    `</table>`;
  if (item.notes) html += `<div style="margin-top:10px"><div class="lbl" style="margin-bottom:4px">Notes</div><div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${esc(item.notes)}</div></div>`;
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
    body.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No items — click "+ Add Item" to begin.</div>';
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
                   : 'other';
    const bonusParts = [];
    if (item.itemType === 'armor') bonusParts.push(`AC${item.acBase}`);
    if (item.acBonus) bonusParts.push(`AC${item.acBonus > 0 ? '+' : ''}${item.acBonus}`);
    if (item.initBonus) bonusParts.push(`Init${item.initBonus > 0 ? '+' : ''}${item.initBonus}`);
    if (item.speedBonus) bonusParts.push(`Spd${item.speedBonus > 0 ? '+' : ''}${item.speedBonus}`);
    const bonusStr = bonusParts.join(' ');
    const attuneStr = item.attuned ? ' 🔮' : '';
    const equippedStyle = item.equipped ? 'color:var(--ahi);font-weight:bold' : 'color:var(--txd)';
    const valueStr = item.value ? ` · <span style="color:var(--exp)">${esc(item.value)}</span>` : '';

    return `<div class="item-row">
      <input type="checkbox" class="item-chk" ${item.equipped ? 'checked' : ''} onchange="toggleItemEquipped(${item.id})" title="Equipped">
      <span class="item-name" style="${equippedStyle};cursor:pointer" onclick="openItemDetail(${item.id})">${esc(item.name)}${attuneStr}</span>
      <span class="item-meta">${typeLabel}${bonusStr ? ' · ' + bonusStr : ''}${valueStr}</span>
      <button class="char-btn" style="padding:2px 8px;font-size:11px" onclick="openItemModal(${item.id})">Edit</button>
      <button class="del-btn" onclick="deleteItem(${item.id})">✕</button>
    </div>`;
  }).join('');

  const summary = summaryParts.length > 0
    ? `<div style="font-size:10px;color:var(--txd);margin-top:6px;padding-top:4px;border-top:1px solid var(--sep)">⚡ Equipped: ${summaryParts.join(' · ')}</div>`
    : '';

  body.innerHTML = rows + summary;
}

function renderWeaponsSummary() {
  const el = document.getElementById('main-weapons-summary');
  if (!el) return;
  const wpnRows = [];
  document.querySelectorAll('#wpn-tbl tr:not(:first-child)').forEach(tr => {
    const inp = tr.querySelectorAll('input[type=text], input[type=number]');
    if (inp.length >= 3) wpnRows.push([inp[0].value, inp[1].value, inp[2].value, inp[3]?.value || '']);
  });
  if (wpnRows.length === 0) {
    el.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No weapons — add them in the Inventory tab.</div>';
    return;
  }
  const tableRows = wpnRows.map(([name, atk, dmg, notes]) => {
    const n = esc(name || '—'), a = esc(atk || '+0'), d = esc(dmg || '—');
    return `<tr>
      <td style="font-weight:bold">${n}</td>
      <td><div style="display:flex;align-items:center;gap:2px">${a}<button class="roll-btn" data-name="${n}" data-val="${a}" onclick="rollWeaponAtkVal(this.dataset.name,this.dataset.val)" title="Roll attack">🎲</button></div></td>
      <td><div style="display:flex;align-items:center;gap:2px">${d}<button class="roll-btn" data-name="${n}" data-val="${esc(dmg||'1d6')}" onclick="rollWeaponDmgVal(this.dataset.name,this.dataset.val)" title="Roll damage">🎲</button></div></td>
      <td style="color:var(--txd);font-size:11px">${esc(notes)}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="tbl-wrap"><table><tr><th>Name</th><th>Atk</th><th>Damage</th><th>Notes</th></tr>${tableRows}</table></div>`;
}

function renderEquippedItemsSummary() {
  const el = document.getElementById('main-items-summary');
  if (!el) return;
  const equipped = items.filter(i => i.equipped && i.itemType !== 'other');
  if (equipped.length === 0) {
    el.innerHTML = '<div style="color:var(--txd);font-size:11px;padding:4px 0">No equipped items — add them in the Inventory tab.</div>';
    return;
  }
  const html = equipped.map(item => {
    const typeLabel = item.itemType === 'armor' ? `${item.armorType} armor`
                    : item.itemType === 'shield' ? 'shield'
                    : item.itemType === 'weapon' ? 'weapon'
                    : 'wondrous';
    const chips = [];
    if (item.itemType === 'armor') chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Base AC ${item.acBase}</span>`);
    if (item.acBonus)    chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">AC ${item.acBonus > 0 ? '+' : ''}${item.acBonus}</span>`);
    if (item.initBonus)  chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Init ${item.initBonus > 0 ? '+' : ''}${item.initBonus}</span>`);
    if (item.speedBonus) chips.push(`<span style="background:var(--a44);padding:1px 5px;border-radius:3px;font-size:10px">Speed ${item.speedBonus > 0 ? '+' : ''}${item.speedBonus} ft</span>`);
    const attuneStr = item.attuned ? ' 🔮' : '';
    const notesSnip = item.notes ? `<div style="font-size:10px;color:var(--txd);margin-top:2px">${esc(item.notes.slice(0,80))}${item.notes.length > 80 ? '…' : ''}</div>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid var(--sep)">
      <div style="flex:1;min-width:0">
        <span style="font-weight:bold;color:var(--ahi);cursor:pointer" onclick="showTab('inventory',document.querySelector('.tab[onclick*=inventory]'));openItemDetail(${item.id})">${esc(item.name)}${attuneStr}</span>
        <span style="color:var(--txd);font-size:10px;margin-left:4px">${typeLabel}</span>
        ${chips.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">${chips.join('')}</div>` : ''}
        ${notesSnip}
      </div>
    </div>`;
  }).join('');
  el.innerHTML = html;
}
