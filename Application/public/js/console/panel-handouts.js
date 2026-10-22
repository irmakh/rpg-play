// Written by Irmak Hakman — 2026-10-22 10:05
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: Handouts tab ─────────────────────────────────────────────────
// A handout is something the DM gives a character to read. It can sit behind a
// skill check: the player examines it (a roll made on the SERVER, whose result
// the player never sees), and the DM then decides what they found. What a
// player may read at each stage is decided by the server - this file only
// shows whatever GET /api/handouts returns for the logged-in role.
//
//   Player   the handouts their character holds: examine, wait, read
//   DM       every handout; open one to give it to characters, see the checks
//            come in, and call each one a success or a failure

let sHandouts = [];
let sHoPick = null;                 // DM: the handout whose detail is open
const sHoOpen = new Set();          // player: handouts unfolded for reading
const sHoChecked = new Set();       // DM: characters ticked to receive it

let _sHoSeq = 0;
async function sLoadHandouts() {
  const seq = ++_sHoSeq;
  try {
    const res = await fetch('/api/handouts', { headers: sAuthHeaders() });
    if (!res.ok) return;
    const list = await res.json();
    // Loads overlap when events come close together; an older answer landing
    // last would put the earlier outcome back on screen.
    if (seq !== _sHoSeq || !Array.isArray(list)) return;
    sHandouts = list;
  } catch { return; }
  if (sHoPick && !sHandouts.find(h => h.id === sHoPick)) sHoPick = null;
  if (sCurrentTab === 'handouts') sRenderHandouts();
  else sMark('handouts', sHandouts.some(sHandoutWantsAttention));
}

// Something here is waiting on whoever is looking: a check for the DM to judge,
// or for a player a handout to examine or a result not yet read.
function sHandoutWantsAttention(h) {
  if (sIsDM()) return (h.recipients || []).some(r => r.outcome === 'rolled');
  return !!h.canRoll || sHandoutUnread(h);
}
function sHandoutUnread(h) {
  return (h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt;
}

function sRenderHandouts() {
  const el = sEl('s-handouts');
  if (!el) return;
  el.innerHTML = sIsDM() ? sHoDmHTML() : sHoPlayerHTML();
}

// ── Player ───────────────────────────────────────────────────────────────────
function sHoPlayerHTML() {
  if (!sHandouts.length) return '<p class="p-empty">You have no handouts. When the DM gives you one it appears here.</p>';
  return '<ul class="p-list">' + sHandouts.map(h => {
    const open  = sHoOpen.has(h.id);
    const state = h.canRoll ? 'examine it' : h.awaitingDm ? 'waiting for the DM' : sHandoutUnread(h) ? 'new' : '';
    let body = '';
    if (open) {
      if (h.canRoll) {
        body = `<p>${esc(h.promptText || 'Something here rewards a closer look.')}</p>
          <button type="button" class="c-btn primary" onclick="sHoExamine('${escJs(h.id)}',this)">Examine it</button>`;
      } else if (h.awaitingDm) {
        body = `${h.promptText ? `<p>${esc(h.promptText)}</p>` : ''}
          <p class="c-mute">You study it closely. The DM will say what you find.</p>`;
      } else {
        const img = h.imageMedium || h.imageUrl;
        body = (img ? `<img src="${esc(img)}" alt="" onclick="lightboxOpen('${escJs(h.imageUrl || h.imageMedium)}')">` : '')
             + `<p class="text">${esc(h.text || '')}</p>`;
      }
    }
    return `<li class="p-ho${sHandoutWantsAttention(h) ? ' new' : ''}">
      <button type="button" class="p-roll" aria-expanded="${open}" onclick="sHoToggle('${escJs(h.id)}')">
        <span class="lbl">${esc(h.title)}</span><span class="val">${state}</span>
      </button>${open ? `<div class="p-ho-body">${body}</div>` : ''}
    </li>`;
  }).join('') + '</ul>';
}

function sHoToggle(id) {
  if (sHoOpen.has(id)) sHoOpen.delete(id); else sHoOpen.add(id);
  const h = sHandouts.find(x => x.id === id);
  // Unfolding a result is reading it. The server keeps "read" so it is not
  // announced again on another device.
  if (h && sHoOpen.has(id) && sHandoutUnread(h)) {
    h.seenAt = new Date().toISOString();
    fetch('/api/handouts/' + encodeURIComponent(id) + '/seen', { method: 'POST', headers: sAuthHeaders() }).catch(() => {});
  }
  sRenderHandouts();
}

async function sHoExamine(id, btn) {
  if (btn) btn.disabled = true;
  try {
    // Blind: no number comes back, and none is shown.
    await fetch('/api/handouts/' + encodeURIComponent(id) + '/roll', {
      method: 'POST', headers: sAuthHeaders(), body: JSON.stringify({}),
    });
  } catch {}
  await sLoadHandouts();
}

// ── DM ───────────────────────────────────────────────────────────────────────
function sHoCheckText(h) {
  return h.checkSkill >= 0 ? `${h.checkSkillName || 'Check'}${h.checkDc ? ' DC ' + h.checkDc : ''}` : 'No check';
}

function sHoDmHTML() {
  const picked = sHandouts.find(h => h.id === sHoPick);
  if (picked) return sHoDmDetailHTML(picked);
  if (!sHandouts.length) return '<p class="p-empty">No handouts yet. They are written on the Handouts page of the DM screen.</p>';
  return '<ul class="p-list">' + sHandouts.map(h => {
    const recs = h.recipients || [];
    const waiting = recs.filter(r => r.outcome === 'rolled').length;
    const note = waiting ? `${waiting} to judge` : recs.length ? `with ${recs.length}` : '';
    return `<li class="p-ho${waiting ? ' new' : ''}">
      <button type="button" class="p-roll two" onclick="sHoPickHandout('${escJs(h.id)}')">
        <span class="lbl"><span>${esc(h.title)}</span><small>${esc(sHoCheckText(h))}</small></span><span class="val">${note}</span>
      </button></li>`;
  }).join('') + '</ul>';
}

function sHoDmDetailHTML(h) {
  const pcs     = sCharList.filter(c => (c.char_type || 'pc') === 'pc');
  const recById = new Map((h.recipients || []).map(r => [r.charId, r]));
  const holders = pcs.filter(c => recById.has(c.id));
  const others  = pcs.filter(c => !recById.has(c.id));
  const hid     = escJs(h.id);

  const outcomeBtn = (c, outcome, label, cls) =>
    `<button type="button" class="c-btn ${cls}" onclick="sHoTag('${hid}','${escJs(c.id)}','${outcome}')">${label}</button>`;

  const holderRows = holders.map(c => {
    const rec = recById.get(c.id);
    const rolled = rec.rollTotal != null;
    const state = rec.outcome === 'success' ? 'found it' : rec.outcome === 'fail' ? 'found nothing'
                : rec.outcome === 'rolled' ? 'waiting for your call' : (h.checkSkill >= 0 ? 'has not examined it' : 'has it');
    const roll = rolled
      ? `Rolled <b>${esc(rec.rollTotal)}</b> ${esc(rec.rollDetail || '')}`
        + (rec.suggested && rec.outcome === 'rolled' ? `, which is a ${rec.suggested === 'success' ? 'success' : 'failure'} against the DC` : '')
      : '';
    return `<div class="p-ho-rec ${esc(rec.outcome)}">
      <div class="top"><strong>${esc(c.name)}</strong><span>${state}</span></div>
      ${roll ? `<p>${roll}</p>` : ''}
      <div class="btns">
        ${outcomeBtn(c, 'success', 'Success', 'ok')}${outcomeBtn(c, 'fail', 'Fail', 'danger')}
        ${rolled ? outcomeBtn(c, 'pending', 'Roll again', '') : ''}
        <button type="button" class="c-btn" onclick="sHoRecall('${hid}','${escJs(c.id)}')">Take back</button>
      </div>
    </div>`;
  }).join('');

  const anySuggested = holders.some(c => { const r = recById.get(c.id); return r.outcome === 'rolled' && r.suggested; });
  const chips = others.map(c =>
    `<button type="button" class="p-chip" aria-pressed="${sHoChecked.has(c.id)}" onclick="sHoCheck('${escJs(c.id)}')">${esc(c.name)}</button>`).join('');
  const n = others.filter(c => sHoChecked.has(c.id)).length;

  return `<button type="button" class="p-roll" onclick="sHoPickHandout(null)"><span class="lbl">All handouts</span><span class="val">Back</span></button>
    <div class="p-ho-head"><strong>${esc(h.title)}</strong><small>${esc(sHoCheckText(h))}</small></div>
    ${holderRows}
    ${anySuggested ? `<div class="pad p-ho-go"><button type="button" class="c-btn block" onclick="sHoApplySuggested('${hid}')">Accept every result the DC suggests</button></div>` : ''}
    ${others.length ? `<h3 class="p-h">Hand out to</h3><div class="p-chips">${chips}</div>
      <div class="pad p-ho-go"><button type="button" class="c-btn primary block" ${n ? '' : 'disabled'} onclick="sHoGive('${hid}')">${n ? `Hand out to ${n}` : 'Choose who gets it'}</button></div>` : ''}
    ${!pcs.length ? '<p class="p-empty">No player characters in this campaign.</p>' : ''}`;
}

function sHoPickHandout(id) {
  sHoPick = id;
  sHoChecked.clear();
  sRenderHandouts();
}

function sHoCheck(charId) {
  if (sHoChecked.has(charId)) sHoChecked.delete(charId); else sHoChecked.add(charId);
  sRenderHandouts();
}

async function sHoGive(handoutId) {
  const charIds = [...sHoChecked];
  if (!charIds.length) return;
  try {
    const res = await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/hand-out', {
      method: 'POST', headers: sAuthHeaders(), body: JSON.stringify({ charIds }),
    });
    if (!res.ok) throw new Error();
    sHoChecked.clear();
    sToast(`Handed out to ${charIds.length}.`);
  } catch { sToast('Could not hand it out.'); }
  await sLoadHandouts();
}

// The gate: nothing a player can read changes until the DM sets an outcome.
// 'pending' clears the roll so the player may examine it again.
async function sHoTag(handoutId, charId, outcome) {
  try {
    const res = await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recipients/' + encodeURIComponent(charId), {
      method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ outcome }),
    });
    if (!res.ok) throw new Error();
  } catch { sToast('Could not set the result.'); }
  await sLoadHandouts();
}

async function sHoApplySuggested(handoutId) {
  const h = sHandouts.find(x => x.id === handoutId);
  if (!h) return;
  for (const r of (h.recipients || []).filter(r => r.outcome === 'rolled' && r.suggested)) {
    try {
      await fetch('/api/handouts/' + encodeURIComponent(h.id) + '/recipients/' + encodeURIComponent(r.charId), {
        method: 'PATCH', headers: sAuthHeaders(), body: JSON.stringify({ outcome: r.suggested, ifOutcome: 'rolled' }),
      });
    } catch {}
  }
  await sLoadHandouts();
}

async function sHoRecall(handoutId, charId) {
  const c = sCharList.find(x => x.id === charId);
  if (!await sConfirm(`Take this handout back from ${c ? c.name : 'this character'}?`, 'Take back')) return;
  try {
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recall', {
      method: 'POST', headers: sAuthHeaders(), body: JSON.stringify({ charId }),
    });
  } catch {}
  await sLoadHandouts();
}
