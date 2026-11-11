// Written by Irmak Hakman — 2026-11-11 15:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

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

  // Equipped-item bonuses to saves / skills / ability checks. Baked into the
  // displayed value fields so every consumer (display + dice rolls on both the
  // character sheet and the table right-panel, which reads these saved values)
  // automatically picks them up. Guarded so a stale/missing dnd-data.js (helper
  // undefined) degrades to "no item bonuses" instead of throwing and aborting
  // the whole recalculation — which silently breaks the entire sheet.
  let itemBonuses;
  try { itemBonuses = aggregateItemBonuses(items); }
  catch { itemBonuses = { saves: {}, skills: {}, checks: {} }; }

  // Ability modifier circles (also the value rolled for ability checks → add
  // any check bonus here). Saves/skills are derived from getMod (ability score),
  // not from this field, so they are unaffected by the check bonus.
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('mod-' + s);
    if (el) el.value = fmt(getMod(s) + (itemBonuses.checks[s] || 0));
  });

  // Saving throws: ability mod + proficiency bonus if proficient + item bonus
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const isProficient = document.querySelector(`[data-key="save-prof-${s}"]`)?.checked;
    const el = document.querySelector(`[data-key="save-${s}"]`);
    if (el) el.value = fmt(getMod(s) + (isProficient ? prof : 0) + (itemBonuses.saves[s] || 0));
  });

  // Skills: ability mod + prof (×2 expertise, ×1 proficient, ×0 otherwise) + item bonus
  SKILL_AB.forEach((ab, i) => {
    const isProficient = document.querySelector(`[data-key="sk-prof-${i}"]`)?.checked;
    const isExpert     = document.querySelector(`[data-key="sk-exp-${i}"]`)?.checked;
    const mult = isExpert ? 2 : (isProficient ? 1 : 0);
    const el = document.querySelector(`[data-key="sk-${i}"]`);
    if (el) el.value = fmt(getMod(ab) + prof * mult + (itemBonuses.skills[i] || 0));
  });

  // Passive Perception = 10 + Perception modifier (skill index 11, WIS) + item bonus
  const percProf = document.querySelector('[data-key="sk-prof-11"]')?.checked;
  const ppEl = document.querySelector('[data-key="pp"]');
  if (ppEl) ppEl.value = 10 + getMod('wis') + (percProf ? prof : 0) + (itemBonuses.skills[11] || 0);

  // Spellcasting: DC = 8 + prof + mod, Atk = prof + mod, Modifier = mod
  const ABILITY_MAP = {
    strength:'str', str:'str', dexterity:'dex', dex:'dex',
    constitution:'con', con:'con', intelligence:'int', int:'int',
    wisdom:'wis', wis:'wis', charisma:'cha', cha:'cha'
  };
  const spKey = ABILITY_MAP[(document.querySelector('[data-key="sp-ability"]')?.value || '').toLowerCase().trim()];
  if (spKey) {
    const spMod = getMod(spKey);
    const spAtkItem = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.spellAtkBonus) || 0), 0);
    const spDcItem  = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.spellDcBonus)  || 0), 0);
    const dcEl  = document.querySelector('[data-key="sp-dc"]');
    const atkEl = document.querySelector('[data-key="sp-atk"]');
    const modEl = document.querySelector('[data-key="sp-mod"]');
    if (dcEl)  dcEl.value  = 8 + prof + spMod + spDcItem;
    if (atkEl) atkEl.value = fmt(prof + spMod + spAtkItem);
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

  // Auto-calc Speed: base speed + equipped item speed bonuses + manual bonus
  {
    const itemSpeedBonus = items.filter(i => i.equipped).reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
    const manualSpeedBonus = parseInt(document.querySelector('[data-key="speed-bonus"]')?.value) || 0;
    const baseEl = document.querySelector('[data-key="speed-base"]');
    const speedEl = document.querySelector('[data-key="speed"]');
    const base = parseInt(baseEl?.value) || 30;
    if (speedEl) speedEl.value = (base + itemSpeedBonus + manualSpeedBonus) + ' ft';
  }

  // Auto-calc AC: equipped armor + DEX mod + item bonuses + manual bonus
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
    const manualAcBonus = parseInt(document.querySelector('[data-key="ac-bonus"]')?.value) || 0;
    const acEl = document.querySelector('[data-key="ac"]');
    if (acEl && document.activeElement !== acEl) acEl.value = baseAC + flatBonus + manualAcBonus;
  }
  // vitals mirror AC and Speed, so refresh after they are recalculated
  if (typeof syncVitals === 'function') syncVitals();
}

// ── Prepared spell counter ────────────────────────────────────────────────────
function recalcPreparedCount() {
  const count = spellPreparedCount(spells);
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
    el.style.color = count > maxPrep ? 'var(--blood)' : 'var(--verdigris)';
  }
}

// ── Ability score change: triggers full recalc ────────────────────────────────
function updMod(stat) { recalcAll(); }

// ── Inspiration toggle ────────────────────────────────────────────────────────
function toggleInspire() {
  document.getElementById('inspire').classList.toggle('on');
  scheduleAutoSave();
}

// ── Add / Delete rows ─────────────────────────────────────────────────────────
function delRow(btn) {
  btn.closest('tr').remove(); recalcPreparedCount(); renderWeaponsSummary(); scheduleAutoSave();
}

function addWeapon() {
  const tbl = document.getElementById('wpn-tbl');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" placeholder="Name"></td><td><div style="display:flex;align-items:center;gap:calc(2px*var(--fs, 1))"><input type="text" value="+0" style="width:calc(46px*var(--fs, 1))"><button class="roll-btn" onclick="rollWeaponAtk(this)" title="Roll attack"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-dice"></use></svg></button></div></td><td><div style="display:flex;align-items:center;gap:calc(2px*var(--fs, 1))"><input type="text" placeholder="1d6 slashing"><button class="roll-btn" onclick="rollWeaponDmg(this)" title="Roll damage"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-dice"></use></svg></button></div></td><td><input type="text" placeholder="Notes"></td><td><button class="del-btn" onclick="delRow(this)"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button></td>`;
  tbl.appendChild(tr);
  renderWeaponsSummary();
}

