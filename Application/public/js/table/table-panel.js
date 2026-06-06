// ── Side panel Quick Roll ─────────────────────────────────────────────────────
let _sideCharId = null; // character ID currently displayed in the side panel
let _sideAllSpells = []; // full parsed _spells of the displayed char (for action spell description posting)
function toggleSideSection(name) {
  const el    = document.getElementById(`side-sec-${name}`);
  const arrow = document.getElementById(`side-sec-${name}-arrow`);
  if (el) {
    const hidden = el.style.display === 'none';
    el.style.display = hidden ? '' : 'none';
    if (arrow) arrow.textContent = hidden ? '▼' : '▶';
    if (hidden) _sideOpenSections.add(name); else _sideOpenSections.delete(name);
  }
}

function _sideSecStyle(name) {
  return _sideOpenSections.has(name) ? '' : 'display:none';
}
function _sideSecArrow(name) {
  return _sideOpenSections.has(name) ? '▼' : '▶';
}

const _ABILITY_LABELS = ['STR','DEX','CON','INT','WIS','CHA'];
const _ABILITY_KEYS   = ['str','dex','con','int','wis','cha'];

function _abilityModStr(score) {
  const n = parseInt(score);
  if (isNaN(n) || n === 0) return null;
  const mod = Math.floor((n - 10) / 2);
  return { score: n, mod: mod >= 0 ? '+' + mod : '' + mod };
}

function renderSideCharacter() {
  const d = qrollData || {};
  const isModern = document.body.dataset.theme === 'modern';
  const spAtk = d['sp-atk'] !== undefined ? d['sp-atk'] : null;
  const initMod = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  const initBonusStr = initMod >= 0 ? '+' + initMod : '' + initMod;

  const abilities = _ABILITY_KEYS.map((k, i) => {
    const raw = d[k] || d[k + '-score'] || d[k + '-val'] || null;
    if (!raw) return null;
    const parsed = _abilityModStr(raw);
    return parsed ? { name: _ABILITY_LABELS[i], ...parsed } : null;
  });
  const hasAbilities = abilities.some(Boolean);

  const pb = d['prof-bonus'] || d['pb'] || d['proficiency'];
  const pp = d['passive-perception'] || d['pp'];
  const spDC = d['sp-dc'];

  // Spell slots (levels 1-9)
  const spellSlots = [];
  for (let i = 1; i <= 9; i++) {
    const total = parseInt(d['slot-' + i + '-total']) || 0;
    if (total > 0) spellSlots.push({ level: i, total, used: parseInt(d['slot-' + i + '-used']) || 0 });
  }

  // Prepared spells (index 7 = prepared flag). Keep the full list for the Actions
  // sections, which reference spells by their index in _sideAllSpells.
  _sideAllSpells = [];
  let preparedSpells = [];
  try {
    _sideAllSpells = JSON.parse(d['_spells'] || '[]');
    preparedSpells = _sideAllSpells.filter(s => s && s[7]);
  } catch {}
  // Actions sections (action-flagged spells [13] + custom actions from _actions)
  const canEditActions = isDM() || isCharSession();
  const actionSectionsHtml = _buildSidePanelActions(d, canEditActions);

  // Shared rows (both themes)
  const skillRows = SKILL_NAMES.map((name, i) => {
    const val = d[`sk-${i}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)}','${esc(val)}')" title="${esc(name)}">`
      + `<span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  const saveRows = SAVE_NAMES.map((name, i) => {
    const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)} Save','${esc(val)}')" title="${esc(name)} Save">`
      + `<span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  let weapons = [];
  try { weapons = JSON.parse(d['_weapons'] || '[]'); } catch {}
  const atkRows = weapons.filter(r => r[0]).map(r => {
    const [wName, wAtk, wDmg, wNote] = [r[0]||'', r[1]||'+0', r[2]||'', r[3]||''];
    const wNoteJs = wNote.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
    const dmgRow = wDmg
      ? `<div class="qroll-row" onclick="rollDamageStr('${esc(wName)} Dmg','${esc(wDmg)}'${wNoteJs ? `,'${wNoteJs}'` : ''})" style="padding-left:20px;background:rgba(0,0,0,.15)">`
        + `<span style="font-size:11px;color:var(--txd)">↳ Damage</span>`
        + `<span class="qroll-val" style="color:#ff9966;font-size:13px">${esc(wDmg)}</span></div>`
      : '';
    return `<div class="qroll-row" onclick="qroll('${esc(wName)} Atk','${esc(wAtk)}','${esc(wDmg)}'${wNoteJs ? `,'${wNoteJs}'` : ''})" title="Attack roll — then choose Miss / Roll Damage">`
      + `<span>${esc(wName)}</span><span class="qroll-val">${esc(wAtk)}</span></div>${dmgRow}`;
  }).join('');
  const spAtkRow = spAtk !== null
    ? `<div class="qroll-row" onclick="qroll('Spell Attack','${esc(String(spAtk))}')" title="Spell Attack">`
      + `<span>Spell Atk</span><span class="qroll-val">${parseInt(spAtk) >= 0 ? '+' : ''}${esc(String(spAtk))}</span></div>`
    : '';
  const atkSection = (atkRows + spAtkRow) || `<div style="padding:4px 8px;font-size:11px;color:var(--txd)">No weapons.</div>`;

  // Ability grid HTML (shared) — clickable to roll ability check
  const abilityGridHtml = hasAbilities
    ? `<div class="rp-ability-grid">`
      + abilities.map((a, i) => a
        ? `<div class="rp-ability-block rp-ability-clickable" onclick="qroll('${_ABILITY_LABELS[i]} Check','${a.mod}')" title="${_ABILITY_LABELS[i]} Ability Check (d20${a.mod})"><div class="rp-ability-name">${a.name}</div><div class="rp-ability-mod">${a.mod}</div><div class="rp-ability-score">${a.score}</div></div>`
        : `<div class="rp-ability-block" style="opacity:.3"><div class="rp-ability-name">${_ABILITY_LABELS[i]}</div><div class="rp-ability-mod">—</div></div>`
      ).join('')
      + `</div>`
    : '';

  // Spell slots HTML (shared) — pips are clickable to toggle used/available
  const canEditSlots = isDM() || isCharSession();
  const spellSlotsHtml = spellSlots.length > 0
    ? `<div class="rp-flat-hdr">Spell Slots${canEditSlots ? ' <span style="font-size:8px;opacity:.5;font-weight:normal;letter-spacing:0">(click to use/restore)</span>' : ''}</div>`
      + `<div class="rp-spell-slots">`
      + spellSlots.map(s => {
          const avail = s.total - s.used;
          const pips = Array.from({ length: s.total }, (_, j) => {
            const isAvail = j < avail;
            const clickAttr = canEditSlots
              ? ` onclick="clickSpellSlotPip(${s.level},${j})" style="cursor:pointer"`
              : '';
            return `<div class="rp-spell-pip${isAvail ? '' : ' used'}" title="Slot ${isAvail ? 'available — click to use' : 'used — click to restore'}"${clickAttr}></div>`;
          }).join('');
          return `<div class="rp-spell-lvl"><div class="rp-spell-lvl-num">${s.level}</div><div class="rp-spell-pips">${pips}</div></div>`;
        }).join('')
      + `</div>`
    : '';

  // Items (wear / unwear) — shown before spell slots, 2-per-row grid with checkboxes
  const itemsHtml = _buildSidePanelItems(d, canEditSlots);

  // Prepared spells HTML (shared). _sideSpells holds the rendered spells so a name
  // click can look the spell up by index and post its description to chat (item 9).
  let spellListHtml = '';
  _sideSpells = preparedSpells;
  if (preparedSpells.length > 0) {
    const byLevel = {};
    for (const s of preparedSpells) {
      const lvl = s[0] || 0;
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push(s);
    }
    spellListHtml = `<div class="rp-flat-hdr">Prepared Spells</div>`;
    for (const lvl of Object.keys(byLevel).sort((a, b) => Number(a) - Number(b))) {
      const lvlName = lvl === '0' ? 'Cantrips' : `Level ${lvl}`;
      spellListHtml += `<div style="font-size:9px;color:var(--txd);padding:3px 10px 1px;text-transform:uppercase;letter-spacing:.5px">${lvlName}</div>`;
      for (const s of byLevel[lvl]) {
        const idx = preparedSpells.indexOf(s);
        const sName = s[1] || '?';
        const flags = (s[4] ? ' <span style="color:#aaddff" title="Concentration">C</span>' : '')
                    + (s[5] ? ' <span style="color:#ddaaff" title="Ritual">R</span>' : '');
        const nameSpan = `<span class="rp-spell-name" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" onclick="postSpellInfoFromPanel(${idx})" title="Send to chat">${esc(sName)}</span>${flags}`;
        spellListHtml += `<div class="qroll-row" style="padding:3px 10px;font-size:11px">`
          + nameSpan
          + (spAtk !== null ? `<span class="qroll-val" onclick="event.stopPropagation();qroll('${esc(sName)}','${esc(String(spAtk))}')" style="font-size:11px;cursor:pointer" title="Spell attack">⚡</span>` : '')
          + `</div>`;
      }
    }
  }

  if (isModern) {
    // ── Modern HUD: secondary stats bar + flat (non-collapsible) sections ──

    // Build secondary stats: Initiative (clickable) | Prof Bonus | Passive Perc | Spell DC
    const secStats = [];
    secStats.push({ val: initBonusStr, lbl: 'INITIATIVE', onclick: 'rollInitiativeFromPanel()' });
    if (pb != null) {
      const pbN = parseInt(pb);
      secStats.push({ val: isNaN(pbN) ? pb : (pbN >= 0 ? '+' + pbN : '' + pbN), lbl: 'PROF. BONUS' });
    }
    if (pp != null) secStats.push({ val: pp, lbl: 'PASS. PERC' });
    if (spDC != null) secStats.push({ val: spDC, lbl: 'SPELL DC' });

    const secStatsHtml = `<div class="rp-sec-stats">`
      + secStats.map((s, i) =>
          (i > 0 ? '<div class="rp-sec-divider"></div>' : '')
          + `<div class="rp-sec-stat"${s.onclick ? ` onclick="${s.onclick}" title="Roll initiative"` : ''}>`
          + `<div class="rp-sec-val">${esc(String(s.val))}</div>`
          + `<div class="rp-sec-lbl">${esc(s.lbl)}</div></div>`
        ).join('')
      + `</div>`;

    const abilitiesSection = hasAbilities
      ? `<div class="rp-flat-hdr">Abilities</div>${abilityGridHtml}`
      : '';

    const saveGridHtml = `<div class="rp-save-grid">`
      + SAVE_NAMES.map((name, i) => {
          const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
          return `<div class="rp-save-cell" onclick="qroll('${esc(name)} Save','${esc(val)}')" title="${esc(name)} Saving Throw">`
            + `<div class="rp-save-val">${esc(val)}</div>`
            + `<div class="rp-save-name">${esc(name)}</div>`
            + `</div>`;
        }).join('')
      + `</div>`;

    const atkCompactHtml = (weapons.some(r => r[0]) || spAtk !== null)
      ? `<div class="rp-atk-list">`
        + weapons.filter(r => r[0]).map(r => {
            const [wName, wAtk, wDmg, wNote] = [r[0]||'', r[1]||'+0', r[2]||'', r[3]||''];
            const wNoteJs = wNote.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
            const atkClick = `qroll('${esc(wName)} Atk','${esc(wAtk)}','${esc(wDmg)}'${wNoteJs ? `,'${wNoteJs}'` : ''})`;
            const dmgClick = wDmg ? `rollDamageStr('${esc(wName)} Dmg','${esc(wDmg)}'${wNoteJs ? `,'${wNoteJs}'` : ''})` : '';
            return `<div class="rp-atk-row">`
              + `<span class="rp-atk-name" onclick="${atkClick}" title="${esc(wName)}">${esc(wName)}</span>`
              + `<span class="rp-atk-hit" onclick="${atkClick}" title="Attack: d20${esc(wAtk)}">${esc(wAtk)}</span>`
              + (wDmg ? `<span class="rp-atk-sep">·</span><span class="rp-atk-dmg" onclick="${dmgClick}" title="Damage: ${esc(wDmg)}">${esc(wDmg)}</span>` : '')
              + `</div>`;
          }).join('')
        + (spAtk !== null
            ? `<div class="rp-atk-row"><span class="rp-atk-name">Spell Atk</span><span class="rp-atk-hit" onclick="qroll('Spell Attack','${esc(String(spAtk))}')">${parseInt(spAtk) >= 0 ? '+' : ''}${esc(String(spAtk))}</span></div>`
            : '')
        + `</div>`
      : `<div style="padding:4px 10px;font-size:11px;color:var(--txd)">No weapons.</div>`;

    return secStatsHtml
      + abilitiesSection
      + `<div class="rp-flat-hdr">Saving Throws</div>${saveGridHtml}`
      + `<div class="rp-flat-hdr">Skills</div><div class="rp-skill-grid">${skillRows}</div>`
      + `<div class="rp-flat-hdr">Attacks</div>${atkCompactHtml}`
      + actionSectionsHtml
      + itemsHtml
      + spellSlotsHtml
      + spellListHtml;
  }

  // ── Classic: collapsible sections ──
  const extraStatsHtml = (pb || pp)
    ? `<div style="display:flex;gap:6px;padding:5px 8px;border-top:1px solid var(--a44);font-size:11px">`
      + (pb ? `<span style="color:var(--txd)">Prof: <strong style="color:var(--ac)">${parseInt(pb) >= 0 ? '+' + parseInt(pb) : pb}</strong></span>` : '')
      + (pp ? `<span style="color:var(--txd)">Passive Perc: <strong style="color:var(--ac)">${pp}</strong></span>` : '')
      + `</div>`
    : '';

  const classicAbilityHtml = hasAbilities
    ? `<div style="font-size:10px;color:var(--ac);text-transform:uppercase;letter-spacing:.5px;padding:6px 8px 3px;border-top:1px solid var(--a44)">Ability Scores</div>${abilityGridHtml}`
    : '';

  return `<div style="display:flex;align-items:center;justify-content:flex-end;padding:4px 8px;border-top:1px solid var(--a44)">`
    + `<button class="btn sm" onclick="rollInitiativeFromPanel()" title="Roll Initiative (d20${initBonusStr})" style="font-size:10px;padding:2px 6px">🎲 Init ${esc(initBonusStr)}</button>`
    + `</div>`
    + classicAbilityHtml
    + extraStatsHtml
    + `<div class="qroll-section"><div class="qroll-section-hdr" onclick="toggleSideSection('skills')">Skills <span id="side-sec-skills-arrow">${_sideSecArrow('skills')}</span></div>`
    + `<div id="side-sec-skills" class="qroll-rows" style="${_sideSecStyle('skills')}">${skillRows}</div></div>`
    + `<div class="qroll-section"><div class="qroll-section-hdr" onclick="toggleSideSection('saves')">Saves <span id="side-sec-saves-arrow">${_sideSecArrow('saves')}</span></div>`
    + `<div id="side-sec-saves" class="qroll-rows" style="${_sideSecStyle('saves')}">${saveRows}</div></div>`
    + `<div class="qroll-section"><div class="qroll-section-hdr" onclick="toggleSideSection('attacks')">Attacks <span id="side-sec-attacks-arrow">${_sideSecArrow('attacks')}</span></div>`
    + `<div id="side-sec-attacks" class="qroll-rows" style="${_sideSecStyle('attacks')}">${atkSection}</div></div>`
    + (actionSectionsHtml ? `<div class="qroll-section">${actionSectionsHtml}</div>` : '')
    + (itemsHtml ? `<div class="qroll-section">${itemsHtml}</div>` : '')
    + (spellSlotsHtml ? `<div class="qroll-section">${spellSlotsHtml}</div>` : '')
    + (spellListHtml ? `<div class="qroll-section">${spellListHtml}</div>` : '');
}

function clickSpellSlotPip(level, pipIndex) {
  if (!qrollData || !_sideCharId) return;
  const totalKey = `slot-${level}-total`;
  const usedKey  = `slot-${level}-used`;
  const total = parseInt(qrollData[totalKey]) || 0;
  const used  = parseInt(qrollData[usedKey])  || 0;
  const avail = total - used;
  // pipIndex < avail → it's an available pip → use one slot
  // pipIndex >= avail → it's a used pip → restore one slot
  const newUsed = pipIndex < avail ? Math.min(total, used + 1) : Math.max(0, used - 1);
  if (newUsed === used) return;
  qrollData[usedKey] = newUsed;
  const content = document.getElementById('side-qroll-content');
  if (content) content.innerHTML = renderSideCharacter();
  updateSpellSlot(level, newUsed);
}

async function updateSpellSlot(level, used) {
  if (!_sideCharId) return;
  try {
    await fetch(`/api/characters/${_sideCharId}/spell-slot`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ level, used })
    });
  } catch {}
}

// ── Items (wear / unwear) ─────────────────────────────────────────────────────
function _sideItemChip(it) {
  if (it.itemType === 'armor') return `<span class="rp-item-chip">AC ${parseInt(it.acBase) || 10}</span>`;
  const ac = parseInt(it.acBonus) || 0;
  if (ac) return `<span class="rp-item-chip">AC${ac > 0 ? '+' : ''}${ac}</span>`;
  return '';
}

function _buildSidePanelItems(d, canEdit) {
  let its = [];
  try { its = JSON.parse(d['_items'] || '[]'); } catch {}
  if (!its.length) return '';
  const cells = its.map(it => {
    const worn = !!it.equipped;
    const attrs = canEdit
      ? ` onclick="clickEquipItem(${it.id})" style="cursor:pointer" title="${worn ? 'Worn — click to remove' : 'Click to wear'}"`
      : '';
    return `<div class="rp-item-cell${worn ? ' worn' : ''}"${attrs}>`
      + `<span class="rp-item-box${worn ? ' on' : ''}"></span>`
      + `<span class="rp-item-name">${esc(it.name || 'Item')}</span>${_sideItemChip(it)}</div>`;
  }).join('');
  return `<div class="rp-flat-hdr">Items${canEdit ? ' <span style="font-size:8px;opacity:.5;font-weight:normal;letter-spacing:0">(click to wear / remove)</span>' : ''}</div>`
    + `<div class="rp-item-grid">${cells}</div>`;
}

function clickEquipItem(itemId) {
  if (!qrollData || !_sideCharId) return;
  let its = [];
  try { its = JSON.parse(qrollData._items || '[]'); } catch { return; }
  const it = its.find(x => x && x.id === itemId);
  if (!it) return;
  it.equipped = !it.equipped;             // optimistic toggle; server recomputes AC/speed
  qrollData._items = JSON.stringify(its);
  const content = document.getElementById('side-qroll-content');
  if (content) content.innerHTML = renderSideCharacter();
  _syncEquip(itemId, it.equipped);
}

async function _syncEquip(itemId, equipped) {
  if (!_sideCharId) return;
  try {
    await fetch(`/api/characters/${_sideCharId}/equip`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ itemId, equipped })
    });
  } catch {}
}

// ── Actions sections (Actions / Bonus / Reactions / Other) ────────────────────
const _RP_ACT_CATS = [['action', 'Actions'], ['bonus', 'Bonus Actions'], ['reaction', 'Reactions'], ['other', 'Other']];

function _buildSidePanelActions(d, canEdit) {
  let acts = [];
  try { acts = JSON.parse(d['_actions'] || '[]'); } catch {}
  let html = '';
  const hasLimited = acts.some(a => a && (parseInt(a.uses) || 0) > 0);
  for (const [key, label] of _RP_ACT_CATS) {
    const spells = _sideAllSpells
      .map((s, idx) => ({ s, idx }))
      .filter(o => o.s && o.s[13] === key);
    const customs = acts.filter(a => a && a.category === key);
    if (!spells.length && !customs.length) continue;
    html += `<div class="rp-flat-hdr">${label}</div>`;
    html += spells.map(o => _renderSidePanelSpell(o.s, o.idx, d)).join('');
    html += customs.map(a => _renderSidePanelCustom(a, canEdit)).join('');
  }
  if (html && canEdit && hasLimited) {
    html += `<div class="rp-act-rest">`
      + `<button class="btn sm" onclick="tableActionRest('short')" title="Restore short-rest uses">↻ Short</button>`
      + `<button class="btn sm" onclick="tableActionRest('long')" title="Restore short- and long-rest uses">↻ Long</button>`
      + `</div>`;
  }
  return html;
}

function _renderSidePanelSpell(s, idx, d) {
  const sName = s[1] || '?';
  const lvl = (s[0] && String(s[0]) !== '0') ? `(${esc(String(s[0]))})` : '(cantrip)';
  const spAtk = d['sp-atk'];
  const nameSpan = `<span class="rp-spell-name" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" onclick="postSpellInfoFromAll(${idx})" title="Send to chat">${esc(sName)}</span>`;
  const atk = (spAtk !== undefined && spAtk !== null && spAtk !== '')
    ? `<span class="qroll-val" onclick="event.stopPropagation();qroll('Spell Attack','${esc(String(spAtk))}')" style="font-size:11px;cursor:pointer" title="Spell attack">⚡</span>`
    : '';
  return `<div class="qroll-row" style="padding:3px 10px;font-size:11px">${nameSpan} <span style="font-size:10px;color:var(--txd)">${lvl}</span> ${atk}</div>`;
}

function _renderSidePanelCustom(a, canEdit) {
  const n = esc(a.name || 'Action');
  const dice = (a.dice || '').trim();
  const uses = parseInt(a.uses) || 0;
  const used = Math.min(parseInt(a.used) || 0, uses);
  const diceBtn = dice
    ? `<span class="rp-act-roll" data-name="${n}" data-dice="${esc(dice)}" onclick="rollDamageStr(this.dataset.name, this.dataset.dice)" title="Roll ${esc(dice)}">🎲 ${esc(dice)}</span>`
    : '';
  let usesHtml = '';
  if (uses > 0) {
    let boxes = '';
    for (let i = 0; i < uses; i++) {
      const click = canEdit ? ` onclick="clickActionBox(${a.id},${i})" style="cursor:pointer"` : '';
      boxes += `<span class="rp-act-box${i < used ? ' used' : ''}"${click} title="${i < used ? 'Used' : 'Available'}"></span>`;
    }
    const rl = a.recharge === 'short' ? 'Short Rest' : a.recharge === 'long' ? 'Long Rest' : '';
    usesHtml = `<div class="rp-act-uses">${boxes}${rl ? `<span class="rp-act-recharge">/ ${rl}</span>` : ''}</div>`;
  }
  return `<div class="rp-act-item">`
    + `<div class="rp-act-head"><span class="rp-act-name">${n}</span>${diceBtn}</div>`
    + (a.description ? `<div class="rp-act-desc">${esc(a.description)}</div>` : '')
    + usesHtml
    + `</div>`;
}

function clickActionBox(actionId, idx) {
  if (!qrollData || !_sideCharId) return;
  let arr;
  try { arr = JSON.parse(qrollData._actions || '[]'); } catch { return; }
  const a = arr.find(x => x && x.id === actionId);
  if (!a) return;
  const uses = parseInt(a.uses) || 0;
  const used = Math.min(parseInt(a.used) || 0, uses);
  let newUsed;
  if (idx < used) {
    newUsed = idx;                 // clicking a filled box restores down to it
  } else {
    newUsed = idx + 1;             // clicking an empty box consumes up to it
    if ((a.dice || '').trim()) rollDamageStr(a.name || 'Action', a.dice.trim());
  }
  if (newUsed === used) return;
  a.used = newUsed;
  qrollData._actions = JSON.stringify(arr);
  const content = document.getElementById('side-qroll-content');
  if (content) content.innerHTML = renderSideCharacter();
  updateActionUse(actionId, newUsed);
}

async function updateActionUse(actionId, used) {
  if (!_sideCharId) return;
  try {
    await fetch(`/api/characters/${_sideCharId}/action-use`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ actionId, used })
    });
  } catch {}
}

async function tableActionRest(type) {
  if (!qrollData || !_sideCharId) return;
  let arr;
  try { arr = JSON.parse(qrollData._actions || '[]'); } catch { arr = []; }
  arr.forEach(a => {
    if (a && (a.recharge === 'short' || (type === 'long' && a.recharge === 'long'))) a.used = 0;
  });
  qrollData._actions = JSON.stringify(arr);
  const content = document.getElementById('side-qroll-content');
  if (content) content.innerHTML = renderSideCharacter();
  try {
    await fetch(`/api/characters/${_sideCharId}/action-rest`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type })
    });
  } catch {}
}

// Post an action-flagged spell to chat (indexes into _sideAllSpells).
function postSpellInfoFromAll(idx) { _postSpellInfo(_sideAllSpells[idx]); }

async function loadSideQroll() {
  const content = document.getElementById('side-qroll-content');
  if (!content) return;

  // Priority: selected token on map → initiative row click → active turn token
  let targetId = selectedTokenId || null;
  if (!targetId && _sideViewInitId) {
    const viewEntry = initData.entries?.find(e => e.id === _sideViewInitId);
    if (viewEntry) {
      const viewTok = _findInitToken(viewEntry);
      targetId = viewTok?.id || null;
    } else {
      _sideViewInitId = null; // entry no longer exists
    }
  }
  if (!targetId) {
    targetId = getActiveTurnTokenId() || null;
  }

  if (targetId === _sideQrollTokenId) return; // already rendered (data unchanged)
  // Only reset section state when switching to a genuinely different token
  if (targetId !== _sidePrevTokenId) _sideOpenSections.clear();
  _sidePrevTokenId = targetId;
  _sideQrollTokenId = targetId;

  const activeTok = targetId ? tokens.find(t => t.id === targetId) : null;
  if (!activeTok) { content.innerHTML = ''; qrollCharName = ''; qrollData = null; _sideCharId = null; return; }

  const subtitleEl = document.getElementById('rp-subtitle');

  if (activeTok.type === 'monster') {
    qrollCharName = (activeTok.label) ? activeTok.label : tokDisplayName(activeTok);
    qrollData = null; _sideCharId = null;
    const canSeeMonsterStats = isDM() || isMyToken(activeTok);
    if (canSeeMonsterStats && activeTok.linkedId) {
      if (isDM()) {
        // DM: use cached full list
        if (_monsterList.length === 0) {
          try {
            const r = await fetch('/api/monsters', { headers: authHeaders() });
            if (r.ok) _monsterList = await r.json();
          } catch {}
        }
        const mon = _monsterList.find(m => m.id === activeTok.linkedId);
        if (mon) {
          const md = mon.data || {};
          if (subtitleEl) {
            const parts = [md.size, md.type].filter(Boolean);
            if (md.subtype) parts.push(`(${md.subtype})`);
            subtitleEl.textContent = parts.join(' ') || 'Monster';
          }
          content.innerHTML = renderMonsterFullStats(md, activeTok);
          return;
        }
      } else {
        // Assigned player: fetch this specific monster by ID
        try {
          const r = await fetch(`/api/monsters/${activeTok.linkedId}`, { headers: authHeaders() });
          if (r.ok) {
            const mon = await r.json();
            const md = mon.data || {};
            if (subtitleEl) {
              const parts = [md.size, md.type].filter(Boolean);
              subtitleEl.textContent = parts.join(' ') || 'Monster';
            }
            content.innerHTML = renderMonsterFullStats(md, activeTok);
            return;
          }
        } catch {}
      }
    }
    // Other players — no stat block shown, subtitle placeholder
    if (subtitleEl) subtitleEl.textContent = 'Monster';
    content.innerHTML = '';
    return;
  }

  // Character / NPC / custom token
  if (!isMyToken(activeTok)) {
    // Another player's character — no sheet access
    qrollCharName = tokDisplayName(activeTok);
    qrollData = null; _sideCharId = null;
    if (subtitleEl) subtitleEl.textContent = '';
    content.innerHTML = '';
    return;
  }
  if (activeTok.linkedId) {
    try {
      const url = isDM()
        ? `/api/characters/${activeTok.linkedId}`
        : `/api/characters/${activeTok.linkedId}/qroll`;
      const headers = isDM() ? { 'X-Character-Password': masterPw } : sessionCharPw ? { 'X-Character-Password': sessionCharPw } : {};
      const r = await fetch(url, { headers });
      if (r.ok) {
        const char = await r.json();
        qrollCharName = char.name || activeTok.name;
        qrollData = char.data || {};
        _sideCharId = activeTok.linkedId;
        // Build subtitle: race · class level
        if (subtitleEl) {
          const d = qrollData;
          const race  = d.race || d['race-name'] || '';
          const cls   = d.class || d['class-name'] || d['class-1'] || '';
          const sub   = d.subclass || d['subclass-1'] || '';
          const lvl   = d.level || d['total-level'] || d['char-level'] || '';
          const parts = [];
          if (race) parts.push(race);
          if (cls) {
            const clsPart = sub ? `${cls} (${sub})` : cls;
            parts.push(lvl ? `${clsPart} ${lvl}` : clsPart);
          } else if (lvl) {
            parts.push(`Level ${lvl}`);
          }
          subtitleEl.textContent = parts.join(' · ');
        }
        content.innerHTML = renderSideCharacter();
        return;
      }
    } catch {}
  }
  qrollCharName = activeTok.name;
  qrollData = null; _sideCharId = null;
  if (subtitleEl) subtitleEl.textContent = '';
  content.innerHTML = '';
}

// Item 2: rolls fire immediately using the persistent diceMode toggle — no modal.
// Item 3: weapon attacks pass weaponDmg/weaponNote so confirmRoll can offer a
// Miss / Roll Damage prompt once the attack die settles.
function qroll(label, modifier, weaponDmg = null, weaponNote = '') {
  rollPending = {
    label,
    modifier: parseInt(String(modifier).replace(/[^0-9\-+]/g,'')) || 0,
    weaponDmg: weaponDmg || null,
    weaponNote: weaponNote || ''
  };
  confirmRoll(diceMode);
}

// Item 2: persistent dice-mode toggle (Normal / Adv / Dis) shown under the name.
function setDiceMode(mode) {
  if (!['norm', 'adv', 'dis'].includes(mode)) mode = 'norm';
  diceMode = mode;
  document.querySelectorAll('#rp-dice-mode .dm-seg').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

// Item 3: after a weapon attack roll, prompt for Miss (close) or Roll Damage.
function showWeaponDmgPrompt(atkLabel, dmg, note) {
  const wName = String(atkLabel).replace(/ Atk$/i, '').replace(/ atk$/i, '');
  _pendingWeaponDmg = { wName, dmg, note: note || '' };
  const el = document.getElementById('weapon-dmg-prompt');
  if (!el) return;
  const lbl = document.getElementById('weapon-dmg-prompt-label');
  if (lbl) lbl.textContent = `${wName} hit?`;
  el.style.display = 'flex';
}
function weaponDmgMiss() {
  _pendingWeaponDmg = null;
  const el = document.getElementById('weapon-dmg-prompt');
  if (el) el.style.display = 'none';
}
function weaponDmgRoll() {
  const w = _pendingWeaponDmg;
  _pendingWeaponDmg = null;
  const el = document.getElementById('weapon-dmg-prompt');
  if (el) el.style.display = 'none';
  if (w && w.dmg) rollDamageStr(`${w.wName} Dmg`, w.dmg, w.note || '');
}

// Item 9: clicking a spell name posts it to chat rendered as raw HTML (so links
// in the notes are clickable). Always posts — even with an empty description — and
// appends a 5e.tools link for the spell that opens in a new tab.
function _spell5eUrl(name) {
  return `https://5e.tools/spells.html#${encodeURIComponent(String(name || '').trim().toLowerCase())}_xphb`;
}

function _postSpellInfo(s) {
  if (!s) return;
  const name = s[1] || 'Spell';
  const desc = s[6] || '';
  const lvl  = s[0];
  const meta = [];
  if (lvl !== undefined && lvl !== '' && lvl !== null) meta.push(String(lvl) === '0' ? 'Cantrip' : `Level ${esc(String(lvl))}`);
  if (s[2])  meta.push(`⏱ ${esc(s[2])}`);
  if (s[3])  meta.push(`🎯 ${esc(s[3])}`);
  if (s[14]) meta.push(`⏳ ${esc(s[14])}`);
  let html = `<strong>${esc(name)}</strong>`;
  if (meta.length) html += `<div style="font-size:10px;opacity:.7;margin-top:1px">${meta.join(' · ')}</div>`;
  if (desc) html += `<div style="margin-top:4px">${desc}</div>`;
  html += `<div style="margin-top:4px"><a href="${esc(_spell5eUrl(name))}" target="_blank" rel="noopener">📖 Open on 5e.tools ↗</a></div>`;
  // postToChat() forces type:'roll', so post the HTML text message directly.
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: getChatSender(), type: 'text', message: html, html: true })
  }).catch(() => {});
}

function postSpellInfoFromPanel(idx) { _postSpellInfo(_sideSpells[idx]); }

async function rollDamageStr(label, dmgStr, description = '') {
  const result = parseDice(dmgStr);
  if (!result) return;
  const sides    = result.die || 6;
  const rolls    = result.rolls || [result.total];
  const modifier = result.mod || 0;
  const { total } = result;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, rolls, modifier, total, label, duration);
  await showDiceAnimation(sides, rolls, modifier, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: result.diceExpr || String(total), results: rolls, modifier, total, label, ...(description ? { description } : {}) });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'dmg', detail: result.detail, total, isCrit: false, isFail: false, isDamage: true, time: new Date().toISOString() });
}

function rollInitiativeFromPanel() {
  const d = qrollData || {};
  // init = dex mod + item bonuses; init-bonus = manual bonus — always add both
  const modifier = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  // Roll for the character whose sheet is displayed in THIS side panel.
  // Derive the charId from the live panel token (_sideQrollTokenId is set
  // synchronously) rather than _sideCharId, which is only assigned after an
  // async fetch and can briefly lag behind the displayed token.
  const panelTok = _sideQrollTokenId ? tokens.find(t => t.id === _sideQrollTokenId) : null;
  const charId = (panelTok && panelTok.type !== 'monster') ? (panelTok.linkedId || _sideCharId || '') : (_sideCharId || '');
  const name   = qrollCharName || panelTok?.name || '';
  rollPending = {
    label: 'Initiative',
    modifier,
    afterRoll: charId ? async (total) => {
      try {
        const hdrs = { 'Content-Type': 'application/json' };
        if (masterPw) hdrs['X-Master-Password'] = masterPw;
        else if (sessionCharPw) hdrs['X-Character-Password'] = sessionCharPw;
        await fetch('/api/initiative/entries', {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ charId, name, roll: total })
        });
      } catch {}
    } : null
  };
  confirmRoll(diceMode); // item 2: use persistent dice mode, no modal
}

// ── Advantage modal (advClose in js/lib/dice-engine.js) ──────────────────────
async function confirmRoll(type) {
  if (!rollPending) return;
  document.getElementById('adv-modal').style.display = 'none';
  const { label, modifier, afterRoll, dmOnlyChat, skipDiceBroadcast, weaponDmg, weaponNote } = rollPending;
  rollPending = null;
  const charId = getActiveCharLinkedId();
  const r1 = Math.ceil(Math.random() * 20);
  const r2 = Math.ceil(Math.random() * 20);
  const used = type === 'adv' ? Math.max(r1, r2) : type === 'dis' ? Math.min(r1, r2) : r1;
  const total = used + modifier;
  const chatLabel = type === 'adv' ? `${label} (Adv)` : type === 'dis' ? `${label} (Dis)` : label;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  // For adv/dis show both dice; usedIdx identifies the kept die
  const dieResults = type !== 'norm' ? [r1, r2] : [r1];
  const usedIdx    = type === 'adv' ? (r2 > r1 ? 1 : 0) : type === 'dis' ? (r2 < r1 ? 1 : 0) : 0;
  if (!skipDiceBroadcast) {
    _selfRollIds.add(rollId);
    _broadcastDiceRoll(rollId, 20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  }
  await showDiceAnimation(20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  await postToChat({ sender: getChatSender(), dice: '1d20', results: [used], modifier, total, label: chatLabel, ...(dmOnlyChat ? { dmOnly: true } : {}) });
  const detail = type !== 'norm' ? `d20(${r1}, ${r2} → ${used})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier) : ''}` : `d20(${r1})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier) : ''}`;
  _pushRollToChar(charId, { label: chatLabel, type, detail, total, isCrit: used === 20, isFail: used === 1, isDamage: false, time: new Date().toISOString() });
  if (afterRoll) afterRoll(total);
  // Item 3: weapon attack → offer Miss / Roll Damage now that the die has settled.
  if (weaponDmg) showWeaponDmgPrompt(label, weaponDmg, weaponNote);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('image-reveal-modal')?.style.display === 'flex') { closeImageRevealModal(); return; }
  if (e.key === 'Escape' && document.getElementById('media-lightbox')) { lightboxClose(); return; }
  if (e.key === 'Escape' && placementState) { exitPlacementMode(); return; }
  if (e.key === 'Escape' && currentTool === 'draw') {
    if (drawSubMode === 'select' && selectedShapeId) {
      selectedShapeId = null; shapeEditState = null;
      oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (typeof updateDrawSelectionUI === 'function') updateDrawSelectionUI();
      return;
    }
    drawingState = null; selectedShapeId = null; shapeEditState = null;
    oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); setTool('select'); return;
  }
  if (e.key === 'Escape' && currentTool === 'multi') { multiSelectState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); return; }
  if (document.getElementById('dm-tools-modal')?.style.display === 'flex') {
    if (e.key === 'Escape') { closeDMToolsModal(); return; }
  }
  if (document.getElementById('dice-roller-modal').style.display === 'flex') {
    if (e.key === 'Escape') { closeDiceRollerModal(); return; }
  }
  if (document.getElementById('monster-info-modal').style.display === 'flex') {
    if (e.key === 'Escape') { closeMonsterInfoTableModal(); return; }
  }
  if (document.getElementById('adv-modal').style.display === 'flex') {
    if      (e.key === 'a' || e.key === 'A') { e.preventDefault(); confirmRoll('adv'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); confirmRoll('norm'); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); confirmRoll('dis'); }
    else if (e.key === 'Escape') advClose();
    return;
  }
  // Don't intercept keys while typing in an input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape' && selectedTokenId) {
    selectedTokenId = null;
    renderTokens();
    _sideQrollTokenId = null;
    renderSidePanel();
    if (!initData.currentId) loadSideQroll();
    return;
  }
  if (selectedTokenId) {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveSelectedToken(e.key);
    } else if (e.key === 'Delete' && isDM()) {
      e.preventDefault();
      deleteSelectedToken();
    }
  }
  if (currentTool === 'draw' && drawSubMode === 'select' && selectedShapeId) {
    if (e.key === 'Delete') { e.preventDefault(); deleteSelectedShape(); }
  }
});

// When the right panel docks back from a pop-out window, force a clean rebind to
// the currently-selected token so live SSE updates / item wear-toggle work again
// without needing to reselect (loadSideQroll's early-return is bypassed via reset).
window.addEventListener('popout-docked', e => {
  if (e.detail && e.detail.id === 'side-panel' && typeof loadSideQroll === 'function') {
    _sideQrollTokenId = null;
    loadSideQroll();
  }
});
