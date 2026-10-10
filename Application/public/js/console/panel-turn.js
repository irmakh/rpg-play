// Written by Irmak Hakman — 2026-10-10 23:39
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: Turn tab ─────────────────────────────────────────────────────
// The initiative order, one combatant per row: roll, name, health. The line
// above the list is about YOU - your own character and whether it is your turn
// (or, for the DM, whose turn it is).

function sMyOwnToken() {
  if (!sIsCharSession()) return null;
  return sTokens.find(t => t.type !== 'monster' && t.linkedId === sessionCharId)
      || sTokens.find(t => t.assignedCharId === sessionCharId)
      || null;
}

function sRenderYouLine() {
  const el = sEl('s-you');
  if (!el) return;
  const running = !!sInitData.currentId;
  const cur = running ? sInitData.entries.find(e => e.id === sInitData.currentId) : null;

  if (sIsDM()) {
    const name = cur ? ((cur.name || '').trim() || 'Someone') : '';
    el.innerHTML = running
      ? `<strong>${esc(name)}</strong><span class="turn">acting now</span>`
      : `<strong>No initiative running</strong>`;
    return;
  }

  const mine = sMyOwnToken();
  const activeId = sGetActiveTokId();
  const myTurn = !!mine && mine.id === activeId;
  const name = mine ? mine.name : sSessionName();
  const state = myTurn ? '<span class="turn">your turn</span>'
              : running ? '<span class="wait">waiting</span>'
              : '<span class="wait">no initiative running</span>';
  const hp = mine
    ? `<span class="num">${mine.hpCurrent || 0}<small>/${mine.hpMax || 0} HP</small></span>` : '';
  el.innerHTML = `<strong>${esc(name)}</strong>${state}${hp}`;
}

function sRenderInitiative() {
  sRenderYouLine();
  sRenderCmd();

  const list = sEl('s-init-list');
  if (!list) return;
  const rows = sInitRows(sInitData, sTokens, { isDM: sIsDM(), isMine: sIsMyToken });

  if (rows.length === 0) {
    list.innerHTML = `<li class="p-empty">No one has rolled initiative yet.</li>`;
    return;
  }

  list.innerHTML = rows.map(r => {
    const cls = ['p-init', r.current ? 'on' : '', r.foe ? 'foe' : ''].filter(Boolean).join(' ');
    const conds = r.conditions.length
      ? `<small>${esc(r.conditions.join(', '))}</small>` : '';
    const hp = r.hp
      ? `${sHpBarHTML(r.hp.pct)}<span class="hp">${r.hp.cur}/${r.hp.max}</span>`
      : `<span></span><span></span>`;
    // A row you may open is a button that selects that token; any other row is plain.
    const tag = r.canSelect ? 'button' : 'div';
    const act = r.canSelect ? ` type="button" onclick="sSelectToken('${escJs(r.tokenId)}')"` : '';
    const del = sIsDM()
      ? `<button type="button" class="p-x" aria-label="Remove ${esc(r.name)} from initiative" onclick="sRemoveInitEntry('${escJs(r.id)}')">Remove</button>`
      : '';
    return `<li class="${cls}">
      <${tag} class="p-init-main"${act}>
        <span class="roll">${esc(r.roll ?? '')}</span>
        <span class="name"><span>${esc(r.name)}</span>${conds}</span>
        ${hp}
      </${tag}>${del}
    </li>`;
  }).join('');
}

// ── Turn control ─────────────────────────────────────────────────────────────
// Needs a login since v240 - the DM's or a player's.

// POSTs one initiative action and reports a refusal instead of failing in
// silence. The change itself comes back as an 'initiative' live event; the
// re-read here only makes this screen catch up without waiting for it.
async function sInitPost(path, failure) {
  try {
    const res = await fetch(path, { method: 'POST', headers: sAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      sToast(res.status === 401 ? 'You are not allowed to do that. Log in again.' : failure(err));
      return false;
    }
    const fresh = await fetch('/api/initiative', { headers: sAuthHeaders() });
    if (fresh.ok) sInitData = await fresh.json();
    sInitChanged();
    return true;
  } catch { sToast('Connection error.'); return false; }
}

// Everything on this screen that shows whether initiative is running.
function sInitChanged() {
  if (sCurrentTab === 'turn') sRenderInitiative(); else sRenderCmd();
  if (sCurrentTab === 'table') { sRenderDmHpList(); sRenderTableInit(); }
  if (sCurrentTab === 'token' && sTokenPane === 'manage' && sSelectedToken) sRenderManagePane(sSelectedToken);
}

function sNextTurn() { return sInitPost('/api/initiative/next', () => 'Could not move to the next turn.'); }
function sPrevTurn() { return sInitPost('/api/initiative/prev', () => 'Could not go back a turn.'); }

async function sToggleInitiative() {
  if (!sIsDM()) return;
  if (sInitData.currentId) {
    if (!await sConfirm('End initiative for everyone?', 'End initiative')) return;
    await sInitPost('/api/initiative/end', () => 'Could not end initiative.');
  } else {
    // The server refuses to start with an empty order.
    await sInitPost('/api/initiative/start', () => (sInitData.entries || []).length
      ? 'Could not start initiative.'
      : 'Nobody has rolled initiative yet. Roll for the monsters on the Table tab first.');
  }
}
async function sRemoveInitEntry(id) {
  if (!sIsDM()) return;
  const entry = sInitData.entries?.find(e => e.id === id);
  if (!entry || !await sConfirm(`Remove ${entry.name} from initiative?`, 'Remove')) return;
  try {
    await fetch(`/api/initiative/entries/${id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({}),
    });
  } catch {}
}
