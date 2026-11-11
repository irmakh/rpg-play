// Written by Irmak Hakman — 2026-11-12 01:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: a character's sheet, inside the Token tab ────────────────────
// When the selected token is a player character (your own, or any of them for
// the DM), the Token tab offers four parts beside Health:
//
//   Skills   abilities, saving throws and skills - tap any of them to roll
//   Combat   attacks, then the character's actions by kind, with limited uses
//   Spells   spell slots and ready spells; choosing one opens its cast view
//            (Cast a Spell, v324: the console's form of js/lib/spell-cast.js)
//   Items    what is carried; tap to wear or take off
//
// It mirrors the table screen's right panel (js/table/table-panel.js) and uses
// the same server routes, so a slot spent or an item worn here is the same
// change as one made there. The numbers come from the character's saved sheet
// (sQrollData); nothing is recomputed in the browser except ability modifiers.

const S_ABIL_KEYS   = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const S_ACTION_CATS = [['action', 'Actions'], ['bonus', 'Bonus actions'], ['reaction', 'Reactions'], ['other', 'Other']];

function sSheetCharId() {
  return sSelectedToken && sSelectedToken.type !== 'monster' ? (sSelectedToken.linkedId || null) : null;
}
function sSheetCanEdit() {
  return !!sSelectedToken && (sIsDM() || sIsMyToken(sSelectedToken));
}
// A list stored on the sheet as a JSON string (_items, _spells, ...).
function sSheetList(key) {
  try { const v = JSON.parse((sQrollData || {})[key] || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Redraw whichever part of the sheet is showing.
function sRenderSheetPane(name) {
  const pane = sEl(`s-pane-${name}`);
  if (!pane || !sQrollData) return;
  pane.innerHTML = name === 'skills' ? sSheetSkillsHTML()
                 : name === 'combat' ? sSheetCombatHTML()
                 : name === 'spells' ? sSheetSpellsHTML()
                 : sSheetItemsHTML();
}
function sSheetRepaint() {
  if (sCurrentTab === 'token' && ['skills', 'combat', 'spells', 'items'].includes(sTokenPane)) sRenderSheetPane(sTokenPane);
}

// ── Skills ───────────────────────────────────────────────────────────────────
function sSheetSkillsHTML() {
  const d = sQrollData;
  // The sheet's "init" is dexterity plus items; a manual bonus is kept separately.
  const initStr = sSigned((parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0));

  // Worn items can add to ability CHECKS. (Their bonuses to saves and skills
  // are already inside the saved save-* and sk-* numbers.)
  let checks = {};
  try { checks = aggregateItemBonuses(sSheetList('_items')).checks || {}; } catch {}
  const abilities = S_ABIL_KEYS.map((k, i) => {
    const score = parseInt(d[k]);
    if (isNaN(score) || score === 0) return `<span class="none"><small>${SAVE_NAMES[i]}</small><b>—</b></span>`;
    const mod = sSigned(Math.floor((score - 10) / 2) + (checks[k] || 0));
    return `<button type="button" onclick="sQrollRoll('${SAVE_NAMES[i]} Check','${mod}')"><small>${SAVE_NAMES[i]}</small><b>${mod}</b><span>${score}</span></button>`;
  }).join('');

  const facts = [];
  const pb = d['prof-bonus'] ?? d['pb'] ?? d['proficiency'];
  const pp = d['passive-perception'] ?? d['pp'];
  if (pb != null && pb !== '') facts.push(['Proficiency', isNaN(parseInt(pb)) ? pb : sSigned(parseInt(pb))]);
  if (pp != null && pp !== '') facts.push(['Passive Perception', pp]);
  if (d['sp-dc'] != null && d['sp-dc'] !== '') facts.push(['Spell save DC', d['sp-dc']]);
  const factsHTML = facts.length
    ? `<p class="p-facts">${facts.map(([k, v]) => `<span>${k} <b>${esc(v)}</b></span>`).join('')}</p>` : '';

  const saves = SAVE_NAMES.map((name, i) => {
    const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
    return sRollRowHTML(name, val, `sQrollRoll('${name} Save','${escJs(val)}')`);
  }).join('');
  const skills = SKILL_NAMES.map((name, i) => {
    const val = d[`sk-${i}`] || '+0';
    return sRollRowHTML(name, val, `sQrollRoll('${escJs(name)}','${escJs(val)}')`);
  }).join('');

  return sRollModeHTML()
    + sRollRowHTML('Initiative', initStr, `sQrollRoll('Initiative','${escJs(initStr)}')`)
    + `<div class="p-sb-abil pad">${abilities}</div>`
    + factsHTML
    + `<h3 class="p-h">Saving throws</h3><div class="p-cols three">${saves}</div>`
    + `<h3 class="p-h">Skills</h3><div class="p-cols">${skills}</div>`;
}

// ── Combat ───────────────────────────────────────────────────────────────────
function sSheetCombatHTML() {
  const d = sQrollData;
  const canEdit = sSheetCanEdit();

  let attacks = sSheetList('_weapons').filter(r => r && r[0]).map(r => {
    const [wName, wAtk, wDmg] = [r[0] || '', r[1] || '+0', r[2] || ''];
    return sRollRowHTML(wName, wAtk, `sQrollRoll('${escJs(wName)} Atk','${escJs(wAtk)}')`)
      + (wDmg ? sRollRowHTML('Damage', wDmg, `sRollDamageStr('${escJs(wName)} Dmg','${escJs(wDmg)}')`, true) : '');
  }).join('');
  const spAtk = d['sp-atk'];
  if (spAtk != null && spAtk !== '') {
    const spStr = parseInt(spAtk) >= 0 ? `+${spAtk}` : `${spAtk}`;
    attacks += sRollRowHTML('Spell attack', spStr, `sQrollRoll('Spell Attack','${escJs(spStr)}')`);
  }
  if (!attacks) attacks = '<p class="p-empty">No weapons on this character sheet.</p>';

  // Each kind of action: the ready spells that take one (js/lib/spell-data.js)
  // and the character's own custom actions.
  const spells  = sSheetSpells();
  const prepares = spellPrepares(sQrollData);
  const actions = sSheetList('_actions');
  const groups = S_ACTION_CATS.map(([key, label]) => {
    const sp = spells.map((s, idx) => ({ s, idx }))
      .filter(o => spellActionCategory(o.s) === key && spellIsReady(o.s, prepares));
    const cu = actions.filter(a => a && a.category === key);
    if (!sp.length && !cu.length) return '';
    return sGroupHTML(label,
      sp.map(o => sSheetSpellRowHTML(o.s, o.idx)).join('') + cu.map(a => sSheetActionHTML(a, canEdit)).join(''), true);
  }).join('');

  const hasLimited = actions.some(a => a && (parseInt(a.uses) || 0) > 0);
  const rest = canEdit && hasLimited
    ? `<h3 class="p-h">Rest</h3><div class="p-inline pad p-rest">
         <button type="button" class="c-btn" onclick="sSheetRest('short')">Short rest</button>
         <button type="button" class="c-btn" onclick="sSheetRest('long')">Long rest</button>
       </div>` : '';

  return sRollModeHTML() + sGroupHTML('Attacks', attacks, true) + groups + rest;
}

// A spell as one row. Whoever may cast for this character gets Cast (it opens
// the cast view) with Post beside it; anyone else only Post (its text to chat).
// A spell with nothing left to cast it with is greyed, with the reason.
function sSheetSpellRowHTML(s, idx) {
  const lvl = s.level ? `level ${s.level}` : 'cantrip';
  const flags = (s.conc ? ', concentration' : '') + (s.ritual ? ', ritual' : '') + (s.noSlot ? ', no slot' : '');
  const post = `onclick="sSheetPostSpell(${idx})"`;
  if (!sSheetCanEdit()) {
    return `<button type="button" class="p-roll two" ${post}>
      <span class="lbl"><span>${esc(s.name || 'Spell')}</span><small>${esc(lvl + flags)}</small></span><span class="val post">Post</span></button>`;
  }
  const how = spellCastOptions(s, sQrollData);
  const why = how.castable ? '' : ' · ' + how.reason;
  return `<div class="p-roll-wrap">
    <button type="button" class="p-roll two${how.castable ? '' : ' off'}" ${how.castable ? `onclick="sCastOpen(${idx})"` : 'disabled'}>
      <span class="lbl"><span>${esc(s.name || 'Spell')}</span><small>${esc(lvl + flags + why)}</small></span><span class="val">${how.castable ? 'Cast' : ''}</span></button>
    <button type="button" class="p-post" ${post}>Post</button></div>`;
}

// The sheet's spells as spell objects; old sheets' arrays are converted.
function sSheetSpells() {
  return parseSpellList(sQrollData ? sQrollData._spells : '[]');
}

// A custom action: what it does, its dice, and one box per limited use.
function sSheetActionHTML(a, canEdit) {
  const dice = (a.dice || '').trim();
  const uses = parseInt(a.uses) || 0;
  const used = Math.min(parseInt(a.used) || 0, uses);
  // The id is whatever the sheet stored (a number or a string): written as a
  // JSON literal and HTML-escaped for the attribute.
  const idLit = esc(JSON.stringify(a.id));
  let boxes = '';
  if (uses > 0) {
    const recharge = a.recharge === 'short' ? 'back on a short rest' : a.recharge === 'long' ? 'back on a long rest' : '';
    boxes = '<div class="p-uses">'
      + Array.from({ length: uses }, (_, i) =>
          `<button type="button" class="p-use${i < used ? ' used' : ''}" ${canEdit ? `onclick="sSheetUseBox(${idLit},${i})"` : 'disabled'} aria-label="Use ${i + 1} of ${uses}, ${i < used ? 'spent' : 'available'}"></button>`).join('')
      + `<span>${uses - used} of ${uses} left${recharge ? ', ' + recharge : ''}</span></div>`;
  }
  return `<div class="p-act">
    <div class="p-act-head">
      <strong>${esc(a.name || 'Action')}</strong>
      ${dice ? `<button type="button" class="c-btn" onclick="sSheetRollAction(${idLit})">Roll ${esc(dice)}</button>` : ''}
      <button type="button" class="c-btn" onclick="sSheetPostAction(${idLit})">Post</button>
    </div>
    ${a.description ? `<p>${esc(a.description)}</p>` : ''}
    ${boxes}
  </div>`;
}

function sSheetFindAction(id) {
  return sSheetList('_actions').find(a => a && String(a.id) === String(id)) || null;
}

function sSheetRollAction(id) {
  const a = sSheetFindAction(id);
  if (a && (a.dice || '').trim()) sRollDamageStr(a.name || 'Action', a.dice.trim());
}

function sSheetPostAction(id) {
  const a = sSheetFindAction(id);
  if (!a) return;
  const meta = [];
  const kind = { action: 'Action', bonus: 'Bonus action', reaction: 'Reaction', other: 'Other' }[a.category];
  if (kind) meta.push(kind);
  if (a.dice) meta.push(a.dice);
  const uses = parseInt(a.uses) || 0;
  if (uses > 0) meta.push(`${uses - Math.min(parseInt(a.used) || 0, uses)} of ${uses} uses left`);
  sPostInfoCard({ name: a.name || 'Action', meta, text: a.description });
}

// Tapping a box spends uses up to it; tapping a spent box gives them back down
// to it. Spending also rolls the action's dice, as on the table screen.
function sSheetUseBox(id, idx) {
  const charId = sSheetCharId();
  if (!charId || !sQrollData) return;
  const arr = sSheetList('_actions');
  const a = arr.find(x => x && String(x.id) === String(id));
  if (!a) return;
  const uses = parseInt(a.uses) || 0;
  const used = Math.min(parseInt(a.used) || 0, uses);
  let newUsed;
  if (idx < used) newUsed = idx;
  else {
    newUsed = idx + 1;
    if ((a.dice || '').trim()) sRollDamageStr(a.name || 'Action', a.dice.trim());
  }
  if (newUsed === used) return;
  a.used = newUsed;
  sQrollData._actions = JSON.stringify(arr);
  sSheetRepaint();
  fetch(`/api/characters/${charId}/action-use`, {
    method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ actionId: a.id, used: newUsed }),
  }).catch(() => {});
}

async function sSheetRest(type) {
  const charId = sSheetCharId();
  if (!charId || !sQrollData) return;
  if (!await sConfirm(type === 'long' ? 'Take a long rest? Every limited use comes back.'
                                      : 'Take a short rest? Uses that return on a short rest come back.',
                      type === 'long' ? 'Long rest' : 'Short rest')) return;
  const arr = sSheetList('_actions');
  arr.forEach(a => { if (a && (a.recharge === 'short' || (type === 'long' && a.recharge === 'long'))) a.used = 0; });
  sQrollData._actions = JSON.stringify(arr);
  sSheetRepaint();
  fetch(`/api/characters/${charId}/action-rest`, {
    method: 'POST', headers: sAuthHeaders(), body: JSON.stringify({ type }),
  }).catch(() => {});
}

// ── Spells ───────────────────────────────────────────────────────────────────
// ── Cast a Spell ─────────────────────────────────────────────────────────────
// The cast view replaces the Spells part while a spell is chosen: Back, the
// spell's facts, one row per way to cast it (a slot of its level or higher,
// its own free use, a ritual; spent ones disabled), Cast, and its text. The
// rules are spellCastOptions() in js/lib/spell-data.js, the same ones the
// server applies in POST /api/characters/:id/cast. Every control is a button,
// so the gamepad's focus ring reaches them like any other row.
let sCastIdx = null;     // index into sSheetSpells() of the chosen spell
let sCastOpt = null;     // index into its options
let sCastFor = null;     // the character it was chosen for
let sCastBusy = false;
let sCastMeta = new Set();   // Metamagic chosen for this cast (Sorcerer)

function sCastOpen(idx) {
  const s = sSheetSpells()[idx];
  if (!s || !sSheetCanEdit()) return;
  const how = spellCastOptions(s, sQrollData);
  if (!how.castable) return;
  sCastIdx = idx;
  sCastOpt = how.options.indexOf(how.best);
  sCastFor = sSheetCharId();
  sCastMeta = new Set();
  if (sTokenPane !== 'spells') sSetTokenPane('spells'); else sSheetRepaint();
  setTimeout(() => sEl('s-cast-go')?.focus(), 0);
}

function sCastClose() {
  sCastIdx = null; sCastOpt = null;
  sSheetRepaint();
}

function sCastChoose(j) {
  sCastOpt = j;
  sSheetRepaint();
  setTimeout(() => sEl('s-cast-go')?.focus(), 0);
}

function sCastMetaToggle(key) {
  if (sCastMeta.has(key)) sCastMeta.delete(key);
  else {
    const m = spellKnownMetamagic(sQrollData).find(x => x.key === key);
    const sorc = spellSorcFrom(sQrollData);
    const spent = spellKnownMetamagic(sQrollData).filter(x => sCastMeta.has(x.key)).reduce((n, x) => n + x.cost, 0);
    if (!m || !sorc || spent + m.cost > sorc.left) return;
    sCastMeta.add(key);
  }
  sSheetRepaint();
}

function sCastMetaHTML() {
  const known = spellKnownMetamagic(sQrollData);
  const sorc = spellSorcFrom(sQrollData);
  if (!known.length || !sorc) return '';
  const cost = known.filter(m => sCastMeta.has(m.key)).reduce((n, m) => n + m.cost, 0);
  const left = sorc.left - cost;
  return `<h3 class="p-h">Metamagic · ${left} of ${sorc.max} points left${cost ? ` (spending ${cost})` : ''}</h3>`
    + known.map(m => {
      const on = sCastMeta.has(m.key);
      const can = on || m.cost <= left;
      return `<button type="button" class="p-roll p-cast-opt${on ? ' on' : ''}${can ? '' : ' off'}" ${can ? `onclick="sCastMetaToggle('${m.key}')" aria-pressed="${on}"` : 'disabled'}>`
        + `<span class="lbl">${esc(m.name)} (${m.cost})</span><span class="val">${on ? '●' : ''}</span></button>`;
    }).join('');
}

function sCastViewHTML() {
  const s = sSheetSpells()[sCastIdx];
  if (!s) { sCastIdx = null; return ''; }
  const how = spellCastOptions(s, sQrollData);
  let opt = how.options[sCastOpt];
  if (!opt || !opt.available) { opt = how.best; sCastOpt = how.options.indexOf(opt); }
  const facts = [spellLevelLabel(s.level) + (s.school ? ' ' + spellSchoolName(s.school).toLowerCase() : ''),
                 s.castText || spellCastLabel(s), s.range, (s.conc ? 'Concentration, ' : '') + s.duration]
    .filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('');
  const options = how.options.map((o, j) =>
    `<button type="button" class="p-roll p-cast-opt${o === opt ? ' on' : ''}${o.available ? '' : ' off'}"`
    + (o.available ? ` onclick="sCastChoose(${j})" aria-pressed="${o === opt}"` : ' disabled')
    + `><span class="lbl">${esc(o.label)}</span><span class="val">${o === opt ? '●' : ''}</span></button>`).join('');
  const lv = opt && (opt.mode === 'slot' || opt.mode === 'pact') ? opt.level : s.level;
  const info = spellCastInfo(s, null, lv, parseInt(sQrollData.level || sQrollData['total-level'], 10) || 1);
  const fx = [
    info.attack ? `${info.attack === 'melee' ? 'Melee' : 'Ranged'} spell attack ${sQrollData['sp-atk'] || ''}` : '',
    info.save ? `DC ${sQrollData['sp-dc'] || '?'} ${info.save} save` : '',
    info.damage ? `${info.healing ? 'Healing' : 'Damage'} ${info.damage}${info.damageType && !info.healing ? ' ' + info.damageType : ''}` : '',
  ].filter(Boolean).map(esc).join(' · ');
  const comp = spellComponentsLabel(s);
  const text = (comp ? `<p class="p-sb-line"><b>Components</b> ${esc(comp)}</p>` : '')
    + spellDescHTML(s) + (s.notes ? `<p class="p-cast-notes">${esc(s.notes)}</p>` : '');
  const up = opt && (opt.mode === 'slot' || opt.mode === 'pact') && opt.level > s.level ? ` at level ${opt.level}`
           : opt && opt.mode === 'ritual' ? ' as a ritual' : '';
  return `<div class="p-cast">
    <div class="p-cast-head"><button type="button" class="c-btn" onclick="sCastClose()">Back</button><strong>${esc(s.name)}</strong></div>
    <p class="p-facts">${facts}</p>
    ${s.source && (s.source.kind || s.source.detail) ? `<p class="p-facts"><span>${esc(spellSourceLabel(s.source))}</span></p>` : ''}
    <h3 class="p-h">How to cast it</h3>
    ${options}
    ${fx ? `<p class="p-cast-fx">${fx}</p>` : ''}
    ${opt && opt.mode !== 'ritual' ? sCastMetaHTML() : ''}
    <div class="p-inline pad p-cast-go">
      <button type="button" class="c-btn primary" id="s-cast-go" onclick="sCastGo()" ${opt && !sCastBusy ? '' : 'disabled'}>Cast ${esc(s.name)}${esc(up)}</button>
      <button type="button" class="c-btn" onclick="sSheetPostSpell(${sCastIdx})">Post text</button>
    </div>
    ${text ? `<div class="p-sb">${text}</div>` : ''}
  </div>`;
}

async function sCastGo() {
  const charId = sSheetCharId();
  const s = sSheetSpells()[sCastIdx];
  const opt = s && spellCastOptions(s, sQrollData).options[sCastOpt];
  if (!charId || !s || !opt || !opt.available || sCastBusy) return;
  sCastBusy = true;
  sSheetRepaint();
  try {
    const res = await fetch(`/api/characters/${encodeURIComponent(charId)}/cast`, {
      method: 'POST', headers: sAuthHeaders(),
      body: JSON.stringify({ spellId: s.id, name: s.name, level: s.level, mode: opt.mode,
                             slotLevel: opt.mode === 'slot' ? opt.level : undefined,
                             metamagic: opt.mode === 'ritual' ? [] : [...sCastMeta] }),
    });
    const out = await res.json().catch(() => ({}));
    sCastBusy = false;
    if (!res.ok) { sToast(out.error || 'The spell could not be cast.'); sSheetRepaint(); return; }
    if (sQrollData && sSheetCharId() === charId) Object.assign(sQrollData, out.data || {});
    const sp = out.entry && out.entry.spell;
    sToast(sp ? `Cast ${sp.name}${sp.castLevel > sp.level ? ' at level ' + sp.castLevel : ''}.` : 'Cast.');
    sCastClose();
  } catch {
    sCastBusy = false;
    sToast('Network error.');
    sSheetRepaint();
  }
}

function sSheetSpellsHTML() {
  // A different character than the one a spell was chosen for: back to the list.
  if (sCastIdx !== null && sCastFor !== sSheetCharId()) { sCastIdx = null; sCastOpt = null; }
  if (sCastIdx !== null && sSheetCanEdit()) {
    const view = sCastViewHTML();
    if (view) return view;
  }
  const d = sQrollData;
  const canEdit = sSheetCanEdit();

  let slots = '';
  for (let level = 1; level <= 9; level++) {
    const total = parseInt(d[`slot-${level}-total`]) || 0;
    if (!total) continue;
    const used  = Math.min(parseInt(d[`slot-${level}-used`]) || 0, total);
    const avail = total - used;
    // Available slots are drawn first, spent ones after.
    slots += `<div class="p-slots"><span class="lvl">Level ${level}</span><div class="p-uses">`
      + Array.from({ length: total }, (_, j) =>
          `<button type="button" class="p-use${j < avail ? '' : ' used'}" ${canEdit ? `onclick="sSheetSlot(${level},${j})"` : 'disabled'} aria-label="Level ${level} slot, ${j < avail ? 'available' : 'spent'}"></button>`).join('')
      + `<span>${avail} of ${total} left</span></div></div>`;
  }
  // Warlock pact slots (tap to use / restore) and Sorcerer sorcery points (v325).
  const pact = spellPactFrom(d);
  if (pact) {
    slots += `<div class="p-slots"><span class="lvl">Pact ${pact.level}</span><div class="p-uses">`
      + Array.from({ length: pact.total }, (_, j) =>
          `<button type="button" class="p-use${j < pact.left ? '' : ' used'}" ${canEdit ? `onclick="sSheetPact(${j})"` : 'disabled'} aria-label="Pact slot, ${j < pact.left ? 'available' : 'spent'}"></button>`).join('')
      + `<span>${pact.left} of ${pact.total} left</span></div></div>`;
  }
  const sorc = spellSorcFrom(d);
  if (sorc) slots += `<div class="p-slots"><span class="lvl">Sorcery</span><span class="p-sorc">${sorc.left} of ${sorc.max} points</span></div>`;

  const spells   = sSheetSpells();
  const prepares = spellPrepares(sQrollData);
  const prepared = spells.map((s, idx) => ({ s, idx })).filter(o => spellIsReady(o.s, prepares));
  // Rituals that are not prepared: castable as a ritual only.
  const rituals = canEdit ? spells.map((s, idx) => ({ s, idx }))
    .filter(o => !spellIsReady(o.s, prepares) && spellCastOptions(o.s, d).ritualOnly) : [];
  const byLevel  = new Map();
  for (const o of prepared) {
    const lvl = String(o.s.level || 0);
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(o);
  }
  const lists = [...byLevel.keys()].sort((a, b) => Number(a) - Number(b)).map(lvl =>
    sGroupHTML(lvl === '0' ? 'Cantrips' : `Level ${lvl}`, byLevel.get(lvl).map(o => sSheetSpellRowHTML(o.s, o.idx)).join(''), true)).join('')
    + (rituals.length ? sGroupHTML('Rituals (not prepared)', rituals.map(o => sSheetSpellRowHTML(o.s, o.idx)).join(''), false) : '');

  if (!slots && !lists) return '<p class="p-empty">No spell slots or prepared spells on this character sheet.</p>';
  return (slots ? `<h3 class="p-h">Spell slots</h3>${slots}` : '')
       + (lists ? `<h3 class="p-h">Ready spells</h3>${lists}` : '');
}

// A Warlock's pact slot, tapped like a spell slot.
function sSheetPact(pipIndex) {
  const charId = sSheetCharId();
  const pact = sQrollData && spellPactFrom(sQrollData);
  if (!charId || !pact) return;
  const newUsed = pipIndex < pact.left ? Math.min(pact.total, pact.used + 1) : Math.max(0, pact.used - 1);
  if (newUsed === pact.used) return;
  sQrollData['pact-used'] = String(newUsed);
  sSheetRepaint();
  fetch(`/api/characters/${charId}/spell-slot`, {
    method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ level: 'pact', used: newUsed }),
  }).catch(() => {});
}

// Tapping an available slot spends one; tapping a spent slot gives one back.
function sSheetSlot(level, pipIndex) {
  const charId = sSheetCharId();
  if (!charId || !sQrollData) return;
  const total = parseInt(sQrollData[`slot-${level}-total`]) || 0;
  const used  = parseInt(sQrollData[`slot-${level}-used`]) || 0;
  const avail = total - used;
  const newUsed = pipIndex < avail ? Math.min(total, used + 1) : Math.max(0, used - 1);
  if (newUsed === used) return;
  sQrollData[`slot-${level}-used`] = newUsed;
  sSheetRepaint();
  fetch(`/api/characters/${charId}/spell-slot`, {
    method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ level, used: newUsed }),
  }).catch(() => {});
}

// Puts a spell's description in chat. The spell notes are the player's own
// HTML (links allowed); the server keeps html only from a logged-in sender and
// every chat page renders it through an allowlist (chat-render.js).
function sSheetPostSpell(idx) {
  const s = sSheetSpells()[idx];
  if (!s) return;
  const name = s.name || 'Spell';
  const meta = [spellLevelLabel(s.level)];
  const cast = s.castText || spellCastLabel(s);
  if (cast) meta.push(`Casting time ${cast}`);
  if (s.range) meta.push(`Range ${s.range}`);
  if (s.duration) meta.push(`Duration ${s.conc ? 'concentration, ' : ''}${s.duration}`);
  sPostInfoCard({ name, meta, html: spellDescHTML(s) + (s.notes || '') });
}

// ── Items ────────────────────────────────────────────────────────────────────
function sSheetItemsHTML() {
  const items = sSheetList('_items');
  if (!items.length) return '<p class="p-empty">No items on this character sheet.</p>';
  const canEdit = sSheetCanEdit();
  return '<ul class="p-list">' + items.map(it => {
    const worn = !!it.equipped;
    const ac = it.itemType === 'armor' ? `AC ${parseInt(it.acBase) || 10}`
             : (parseInt(it.acBonus) || 0) ? `AC ${sSigned(parseInt(it.acBonus))}` : '';
    return `<li class="p-reveal">
      <span class="name">${esc(it.name || 'Item')}${ac ? `<small>${ac}</small>` : ''}</span>
      <button type="button" class="c-btn" aria-pressed="${worn}" ${canEdit ? `onclick="sSheetEquip(${esc(JSON.stringify(it.id))})"` : 'disabled'}>${worn ? 'Worn' : 'Wear'}</button>
    </li>`;
  }).join('') + '</ul>';
}

// Wearing an item changes armour class, speed, saves and more. Only the server
// works those out, so after the change the sheet is read again from it.
async function sSheetEquip(itemId) {
  const charId = sSheetCharId();
  if (!charId || !sQrollData) return;
  const items = sSheetList('_items');
  const it = items.find(x => x && x.id === itemId);
  if (!it) return;
  it.equipped = !it.equipped;
  sQrollData._items = JSON.stringify(items);
  sSheetRepaint();
  try {
    const r = await fetch(`/api/characters/${charId}/equip`, {
      method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ itemId, equipped: it.equipped }),
    });
    if (!r.ok) sToast(r.status === 401 ? 'You may not change this sheet.' : 'Could not save that item.');
  } catch { sToast('Connection error.'); }
  sReloadSheet();
}
