// ── Auto-calculate proficiency bonus from level ───────────────────────────────
function recalcProfBonus() {
  const level = parseInt(document.querySelector('[data-key="level"]')?.value) || 0;
  if (!level) return;
  const bonus = Math.floor((level - 1) / 4) + 2;
  const el = document.querySelector('[data-key="profbonus"]');
  if (el) el.value = bonus;
}

// ── Full recalculation from ability scores + proficiency checkboxes ───────────
function recalcAll() {
  const prof = parseInt(document.querySelector('[data-key="profbonus"]')?.value) || 0;

  // Ability modifier circles
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (el) el.value = fmt(getMod(s));
  });

  // Saving throws: ability mod + proficiency bonus if proficient
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const isProficient = document.querySelector(`[data-key="save-prof-${s}"]`)?.checked;
    const el = document.querySelector(`[data-key="save-${s}"]`);
    if (el) el.value = fmt(getMod(s) + (isProficient ? prof : 0));
  });

  // Skills: ability mod + prof (×2 if expertise, ×1 if proficient, ×0 otherwise)
  SKILL_AB.forEach((ab, i) => {
    const isProficient = document.querySelector(`[data-key="sk-prof-${i}"]`)?.checked;
    const isExpert     = document.querySelector(`[data-key="sk-exp-${i}"]`)?.checked;
    const mult = isExpert ? 2 : (isProficient ? 1 : 0);
    const el = document.querySelector(`[data-key="sk-${i}"]`);
    if (el) el.value = fmt(getMod(ab) + prof * mult);
  });

  // Passive Perception = 10 + Perception modifier (skill index 11, WIS)
  const percProf = document.querySelector('[data-key="sk-prof-11"]')?.checked;
  const ppEl = document.querySelector('[data-key="pp"]');
  if (ppEl) ppEl.value = 10 + getMod('wis') + (percProf ? prof : 0);

  // Spellcasting: DC = 8 + prof + mod, Atk = prof + mod, Modifier = mod
  const ABILITY_MAP = {
    strength:'str', str:'str', dexterity:'dex', dex:'dex',
    constitution:'con', con:'con', intelligence:'int', int:'int',
    wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha'
  };
  const spKey = ABILITY_MAP[(document.querySelector('[data-key="sp-ability"]')?.value || '').toLowerCase().trim()];
  if (spKey) {
    const spMod = getMod(spKey);
    const dcEl  = document.querySelector('[data-key="sp-dc"]');
    const atkEl = document.querySelector('[data-key="sp-atk"]');
    const modEl = document.querySelector('[data-key="sp-mod"]');
    if (dcEl)  dcEl.value  = 8 + prof + spMod;
    if (atkEl) atkEl.value = fmt(prof + spMod);
    if (modEl) modEl.value = fmt(spMod);
  }

  recalcPreparedCount();

  // Auto-calc Initiative: DEX mod + equipped item bonuses (init-bonus is additive, stored separately)
  {
    const dexMod = getMod('dex');
    const itemBonus = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.initBonus) || 0), 0);
    const base = dexMod + itemBonus;
    const initEl = document.querySelector('[data-key="init"]');
    if (initEl) initEl.value = (base >= 0 ? '+' : '') + base;
  }

  // Auto-calc Speed: base speed + equipped item speed bonuses
  {
    const speedBonus = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
    const baseEl = document.querySelector('[data-key="speed-base"]');
    const speedEl = document.querySelector('[data-key="speed"]');
    const base = parseInt(baseEl?.value) || 30;
    if (speedEl) speedEl.value = (base + speedBonus) + ' ft';
  }

  // Auto-calc AC: equipped armor + DEX mod + item bonuses
  {
    const dexMod = getMod('dex');
    const equipped = items.filter(i => i.equipped);
    const armor = equipped.find(i => i.itemType === 'armor');
    let baseAC;
    if (!armor) {
      baseAC = 10 + dexMod;
    } else if (armor.armorType === 'heavy') {
      baseAC = armor.acBase || 10;
    } else if (armor.armorType === 'medium') {
      baseAC = (armor.acBase || 10) + Math.min(2, dexMod);
    } else {
      baseAC = (armor.acBase || 10) + dexMod;
    }
    const flatBonus = equipped.reduce((s, i) => s + (parseInt(i.acBonus) || 0), 0);
    const acEl = document.querySelector('[data-key="ac"]');
    if (acEl && document.activeElement !== acEl) acEl.value = baseAC + flatBonus;
  }
}

// ── Prepared spell counter ────────────────────────────────────────────────────
function recalcPreparedCount() {
  let count = 0;
  document.querySelectorAll('#spell-tbl tr:not(:first-child)').forEach(tr => {
    const lvlInput = tr.querySelector('input[type=text]');
    const prepChk  = tr.querySelector('input[type=checkbox]');
    if (parseInt(lvlInput?.value) > 0 && prepChk?.checked) count++;
  });
  const ABILITY_MAP = {
    strength:'str', str:'str', dexterity:'dex', dex:'dex',
    constitution:'con', con:'con', intelligence:'int', int:'int',
    wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha'
  };
  const spKey = ABILITY_MAP[(document.querySelector('[data-key="sp-ability"]')?.value || '').toLowerCase().trim()];
  const spMod = spKey ? getMod(spKey) : 0;
  const level = parseInt(document.querySelector('[data-key="level"]')?.value) || 0;
  const maxPrep = Math.max(1, level + spMod);
  const el = document.getElementById('prep-count');
  if (el) {
    el.value = `${count} / ${maxPrep}`;
    el.style.color = count > maxPrep ? '#ff8888' : '#88ff88';
  }
}

// ── Ability score change: triggers full recalc ────────────────────────────────
function updMod(stat) { recalcAll(); }

// ── Inspiration toggle ────────────────────────────────────────────────────────
function toggleInspire() {
  document.getElementById('inspire').classList.toggle('on');
}

// ── Add / Delete rows ─────────────────────────────────────────────────────────
function delRow(btn) {
  const tr = btn.closest('tr');
  const isSpell = tr.closest('#spell-tbl') !== null;
  if (isSpell) {
    const name = tr.querySelector('input[type=text]')?.value?.trim() || 'this spell';
    showConfirm('Delete ' + name + '?', () => { tr.remove(); recalcPreparedCount(); });
  } else {
    tr.remove(); recalcPreparedCount(); renderWeaponsSummary();
  }
}
function toggleSpellExpand(el) { el.closest('tr').classList.toggle('spell-expanded'); }

function addWeapon() {
  const tbl = document.getElementById('wpn-tbl');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" placeholder="Name"></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" value="+0" style="width:46px"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack">🎲</button></div></td><td><div style="display:flex;align-items:center;gap:2px"><input type="text" placeholder="1d6 slashing"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage">🎲</button></div></td><td><input type="text" placeholder="Notes"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
  tbl.appendChild(tr);
  renderWeaponsSummary();
}

function addSpell() {
  const tbl = document.getElementById('spell-tbl');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td style="text-align:center"><input type="checkbox" onchange="recalcPreparedCount()"></td><td><input type="text" value="0" style="width:28px"></td><td><div style="display:flex;align-items:center;gap:3px"><span class="spell-tog" onclick="toggleSpellExpand(this)"></span><input type="text" placeholder="Spell name"><a href="#" class="tools-link" onclick="openSpell5e(this);return false" title="Open in 5e.tools">↗</a></div></td><td><input type="text" value="Action" style="width:70px"></td><td><input type="text" placeholder="Range" style="width:65px"></td><td style="text-align:center"><input type="checkbox"></td><td style="text-align:center"><input type="checkbox"></td><td><select class="spell-school" style="width:60px;font-size:11px;padding:1px 2px"><option value="">—</option><option value="Abj">Abj</option><option value="Conj">Conj</option><option value="Div">Div</option><option value="Ench">Ench</option><option value="Evoc">Evoc</option><option value="Illu">Illu</option><option value="Necro">Necro</option><option value="Trans">Trans</option></select></td><td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:3px"><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-v" style="width:11px;height:11px">V</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-s" style="width:11px;height:11px">S</label><label style="font-size:10px;display:flex;align-items:center;gap:1px;cursor:pointer"><input type="checkbox" class="spell-m" style="width:11px;height:11px" onchange="spellMChange(this)">M</label></div></td><td><input type="text" placeholder="Notes"><input type="text" class="spell-mat" placeholder="Material…" style="display:none;width:100%;font-size:10px;margin-top:2px"></td><td><button class="del-btn" onclick="delRow(this)">✕</button></td>`;
  tbl.appendChild(tr);
}

function spellMChange(cb) {
  const mat = cb.closest('tr').querySelector('.spell-mat');
  if (mat) mat.style.display = cb.checked ? 'block' : 'none';
}

// ── Spell table column sort ───────────────────────────────────────────────────
let spellSortCol = null, spellSortDir = 1;

function sortSpells(col) {
  spellSortDir = spellSortCol === col ? -spellSortDir : 1;
  spellSortCol = col;

  const tbl  = document.getElementById('spell-tbl');
  const rows = Array.from(tbl.querySelectorAll('tr:not(:first-child)'));
  rows.sort((a, b) => {
    const av = _spellCellVal(a, col), bv = _spellCellVal(b, col);
    if (av < bv) return -spellSortDir;
    if (av > bv) return  spellSortDir;
    return 0;
  });
  rows.forEach(r => tbl.appendChild(r));

  for (let i = 0; i <= 7; i++) {
    const ind = document.getElementById('spth-' + i);
    if (ind) ind.textContent = i === spellSortCol ? (spellSortDir === 1 ? ' ▲' : ' ▼') : '';
  }
}

function _spellCellVal(row, col) {
  const cell = row.querySelectorAll('td')[col];
  if (!cell) return '';
  switch (col) {
    case 0: case 5: case 6:  // Prep / Conc / Ritual — checked sorts first (asc)
      return cell.querySelector('input[type=checkbox]')?.checked ? 0 : 1;
    case 1:  // Lvl — numeric
      return parseInt(cell.querySelector('input')?.value || '0', 10);
    case 2:  // Name — text inside flex div
      return (cell.querySelector('input[type=text]')?.value || '').toLowerCase();
    case 7:  // School — select
      return (cell.querySelector('select')?.value || '').toLowerCase();
    default:  // Time (3), Range (4) — plain text input
      return (cell.querySelector('input')?.value || '').toLowerCase();
  }
}
