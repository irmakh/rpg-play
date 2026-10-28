// Written by Irmak Hakman — 2026-10-28 14:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Companions ────────────────────────────────────────────────────────────────
// Familiars, summons and beasts a player built on their sheet (Companions tab,
// js/index/index-companions.js) and puts on the map from here. A companion
// token is type 'companion', belongs to its player (assignedCharId) and carries
// the stats it was summoned with in tok.companion (JSON) - its attacks, notes
// and how it takes its turn. Its owner runs it like the DM runs a monster:
// HP, conditions, name, picture, hidden or not, dismiss (table-hppanel.js).

function isCompanion(tok) { return !!tok && tok.type === 'companion'; }

/** The stats a companion token was summoned with. */
function companionOf(tok) {
  try { return JSON.parse((tok && tok.companion) || '{}') || {}; } catch { return {}; }
}

/** A companion's own rolls go to chat as "Owl (Arwil)". */
function companionSender(tok) {
  const owner = (typeof _charList !== 'undefined' ? _charList : []).find(c => c.id === tok.assignedCharId);
  const ownerName = owner ? owner.name : (isCharSession() && tok.assignedCharId === sessionCharId ? sessionCharName : '');
  const s = ownerName ? `${tok.name} (${ownerName})` : tok.name;
  return s.length > 40 ? tok.name.slice(0, 40) : s;
}

function _cmpSigned(n) {
  const v = parseInt(n) || 0;
  return (v >= 0 ? '+' : '') + v;
}

/** The right panel for a companion token: what it rolls, and its notes. */
function renderCompanionPanel(tok) {
  const c = companionOf(tok);
  const id = escJs(tok.id);
  const own = c.initMode === 'own';
  const inTracker = !!(tok.initiativeId && (initData.entries || []).some(e => e.id === tok.initiativeId));
  const initStat = own
    ? `<div class="rp-sec-stat" onclick="rollCompanionInitiative('${id}')" title="Roll initiative for ${esc(tok.name)}">`
      + `<div class="rp-sec-val">${esc(_cmpSigned(c.initBonus))}</div><div class="rp-sec-lbl">${inTracker ? 'REROLL INIT' : 'INITIATIVE'}</div></div>`
    : `<div class="rp-sec-stat" title="Acts on its owner's turn"><div class="rp-sec-val">—</div><div class="rp-sec-lbl">SHARES TURN</div></div>`;
  const stats = `<div class="rp-sec-stats">${initStat}<div class="rp-sec-divider"></div>`
    + `<div class="rp-sec-stat"><div class="rp-sec-val">${esc(String(tok.tokenSize || 1))}</div><div class="rp-sec-lbl">SIZE (CELLS)</div></div></div>`;

  const attacks = Array.isArray(c.attacks) ? c.attacks : [];
  const atkHtml = attacks.length
    ? `<div class="rp-atk-list">` + attacks.map((a, i) => {
        const hit = a.toHit !== '' && a.toHit != null ? _cmpSigned(a.toHit) : '';
        const atk = `companionAttack('${id}',${i})`;
        return `<div class="rp-atk-row">`
          + `<span class="rp-atk-name" onclick="${atk}" title="${esc(a.name)}">${esc(a.name || 'Attack')}</span>`
          + (hit ? `<span class="rp-atk-hit" onclick="${atk}" title="Attack: d20${esc(hit)}">${esc(hit)}</span>` : '')
          + (a.damage ? `<span class="rp-atk-sep">·</span><span class="rp-atk-dmg" onclick="companionDamage('${id}',${i})" title="Damage: ${esc(a.damage)}">${esc(a.damage)}</span>` : '')
          + `</div>`;
      }).join('') + `</div>`
    : `<div class="rp-tab-empty">No attacks. Add them on the character sheet.</div>`;

  const notes = c.notes ? `<div class="rp-flat-hdr">Notes</div><div class="cmp-notes">${esc(c.notes)}</div>` : '';
  return stats + `<div class="rp-flat-hdr">Attacks</div>${atkHtml}${notes}`
    + `<button class="btn sm danger cmp-dismiss" onclick="dismissCompanion('${id}')">Dismiss ${esc(tok.name)}</button>`;
}

function _cmpRoll(pending) {
  rollPending = pending;
  if (diceMode === 'ask') { _showAdvModal(pending.label); return; }
  confirmRoll(diceMode);
}

function companionAttack(tokId, idx) {
  const tok = tokens.find(t => t.id === tokId);
  const a = tok && (companionOf(tok).attacks || [])[idx];
  if (!a || !isMyToken(tok)) return;
  const label = `${a.name || 'Attack'} Atk`;
  if (a.toHit === '' || a.toHit == null) {
    // Damage only (a breath, a save-for-half): nothing to hit with.
    if (a.damage) rollDamageStr(`${a.name || 'Attack'} Dmg`, a.damage, '', companionSender(tok));
    return;
  }
  _cmpRoll({ label, modifier: parseInt(a.toHit) || 0, weaponDmg: a.damage || null, weaponNote: '', sender: companionSender(tok) });
}

function companionDamage(tokId, idx) {
  const tok = tokens.find(t => t.id === tokId);
  const a = tok && (companionOf(tok).attacks || [])[idx];
  if (!a || !a.damage || !isMyToken(tok)) return;
  rollDamageStr(`${a.name || 'Attack'} Dmg`, a.damage, '', companionSender(tok));
}

/** A companion with its own turn rolls into the tracker as its own row. */
function rollCompanionInitiative(tokId) {
  const tok = tokens.find(t => t.id === tokId);
  if (!tok || !isMyToken(tok)) return;
  _cmpRoll({
    label: 'Initiative',
    modifier: parseInt(companionOf(tok).initBonus) || 0,
    sender: companionSender(tok),
    afterRoll: async (total) => {
      try {
        const r = await fetch(`/api/table/companions/${encodeURIComponent(tokId)}/initiative`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ roll: total }),
        });
        if (!r.ok) showToast('Could not add it to initiative.', true);
      } catch { showToast('Connection error.', true); }
    },
  });
}

async function dismissCompanion(tokId) {
  const tok = tokens.find(t => t.id === tokId);
  if (!tok || !isMyToken(tok)) return;
  if (!await showConfirm(`Dismiss "${tok.name}"? It leaves the map; summon it again from your sheet.`)) return;
  if (selectedTokenId === tokId) { selectedTokenId = null; if (typeof closeHpPanel === 'function') closeHpPanel(); }
  _tokQ.run(async () => {
    try {
      const r = await fetch(`/api/table/tokens/${encodeURIComponent(tokId)}`, { method: 'DELETE', headers: authHeaders() });
      if (!r.ok) showToast('Could not dismiss it.', true);
    } catch { showToast('Connection error.', true); }
  });
}

/**
 * The Companions tab of a character in the right panel: each companion with
 * a Summon button (for its player and the DM) and how many are on the map.
 */
function sideCompanionsPane(d, charId, canSummon) {
  let list = [];
  try { list = JSON.parse(d['_companions'] || '[]'); } catch {}
  if (!Array.isArray(list) || !list.length) {
    return `<div class="rp-tab-empty">No companions. Add familiars and summons on the character sheet (Companions tab).</div>`;
  }
  return list.map(c => {
    const onMap = tokens.filter(t => isCompanion(t) && t.assignedCharId === charId && companionOf(t).id === c.id).length;
    const img = c.portraitThumb || c.portrait;
    const meta = [`HP ${parseInt(c.hpMax) || 0}`, c.ac !== '' && c.ac != null ? `AC ${c.ac}` : '', `${parseInt(c.speed) || 0} ft`,
                  c.initMode === 'own' ? 'own turn' : 'shares turn'].filter(Boolean).join(' · ');
    return `<div class="cmp-side-row">`
      + (img ? `<img class="cmp-side-img" src="${esc(img)}" alt="">` : `<span class="cmp-side-img cmp-side-ph" aria-hidden="true">🐾</span>`)
      + `<div class="cmp-side-main"><div class="cmp-side-name">${esc(c.name || 'Companion')}</div>`
      + `<div class="cmp-side-meta">${esc(meta)}${onMap ? ` · <b>${onMap} on map</b>` : ''}</div></div>`
      + (canSummon ? `<button class="btn sm" onclick="summonCompanion('${escJs(charId)}','${escJs(c.id)}')">Summon</button>` : '')
      + `</div>`;
  }).join('');
}

async function summonCompanion(charId, companionId) {
  try {
    const r = await fetch('/api/table/companions/summon', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ charId, companionId }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.error || 'Could not summon it.', true);
      return;
    }
    // The token arrives on the 'token-added' event like any other; repaint
    // the panel so the "on map" count catches up.
    setTimeout(() => { _sideQrollTokenId = null; loadSideQroll(); }, 400);
  } catch { showToast('Connection error.', true); }
}
