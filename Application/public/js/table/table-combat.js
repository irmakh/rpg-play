// Written by Irmak Hakman — 2026-11-16 20:00
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Combat bookkeeping on the table (v360) ───────────────────────────────────
// Condition durations and concentration (server/routes/combat.js).
//
// Prompts: cards over the map, under the turn banner, for whoever controls the
// token (its player; the DM sees every token's, so they can answer for
// anyone):
//   "Goblin #1's turn: Poisoned has 2 rounds left"  Decrease now / At end of turn / Disregard
//   "Mira took 14 damage while concentrating on Bless. CON save DC 10"  Roll CON save / Drop
// They come from the token data itself (condTimers.ask, concChecks), so every
// screen shows the same thing and an answer on one clears it on all.
//
// The right panel lists each active condition with its rounds, and the
// concentration spell with a Drop button.

function tokTimers(tok) {
  try { const v = JSON.parse((tok && tok.condTimers) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function tokConcChecks(tok) {
  try { const v = JSON.parse((tok && tok.concChecks) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function _combatCanAnswer(tok) {
  return isDM() || isMyToken(tok);
}

async function _combatPost(tokId, path, body) {
  try {
    const r = await fetch(`/api/table/tokens/${encodeURIComponent(tokId)}/${path}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body || {}),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(out.error || 'That did not go through.', true); return null; }
    return out;
  } catch { showToast('Connection error.', true); return null; }
}

// ── Prompts ──────────────────────────────────────────────────────────────────
let _combatPromptKey = '';

function renderCombatPrompts() {
  const cards = [];
  for (const tok of tokens) {
    if (!_combatCanAnswer(tok)) continue;
    const name = tokDisplayName(tok) || tok.name || 'Token';
    const conds = parseConditions(tok.conditions);
    for (const [cond, t] of Object.entries(tokTimers(tok))) {
      if (!t || !t.ask || !conds.includes(cond)) continue;
      cards.push({ key: `ask|${tok.id}|${cond}|${t.rounds}`, html:
        `<div class="cbt-card" data-tok="${esc(tok.id)}">
          <div class="cbt-text"><b>${esc(name)}'s turn:</b> ${esc(cond)} has ${t.rounds} round${t.rounds === 1 ? '' : 's'} left.</div>
          <div class="cbt-btns">
            <button type="button" class="cbt-btn go" onclick="combatAnswer('${escJs(tok.id)}','${escJs(cond)}','now')">Decrease now</button>
            <button type="button" class="cbt-btn" onclick="combatAnswer('${escJs(tok.id)}','${escJs(cond)}','end')">At end of turn</button>
            <button type="button" class="cbt-btn ghost" onclick="combatAnswer('${escJs(tok.id)}','${escJs(cond)}','skip')">Disregard</button>
          </div>
        </div>` });
    }
    const checks = tokConcChecks(tok);
    if (tok.concentration && checks.length) {
      const c = checks[0];
      const more = checks.length > 1 ? ` (${checks.length - 1} more after this)` : '';
      cards.push({ key: `conc|${tok.id}|${checks.length}|${c.dc}`, html:
        `<div class="cbt-card conc" data-tok="${esc(tok.id)}">
          <div class="cbt-text"><b>${esc(name)} took ${c.damage} damage</b> while concentrating on ${esc(tok.concentration)}.
            <span class="cbt-sub">Constitution save, DC ${c.dc}${more}</span></div>
          <div class="cbt-btns">
            <button type="button" class="cbt-btn go" onclick="combatRollConc('${escJs(tok.id)}')">Roll CON save</button>
            <button type="button" class="cbt-btn ghost" onclick="combatDropConc('${escJs(tok.id)}')">Drop concentration</button>
          </div>
        </div>` });
    }
  }
  const key = cards.map(c => c.key).join('#');
  if (key === _combatPromptKey) return;
  _combatPromptKey = key;
  let host = document.getElementById('combat-prompts');
  if (!cards.length) { if (host) host.hidden = true; return; }
  if (!host) {
    host = document.createElement('div');
    host.id = 'combat-prompts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    window.addEventListener('resize', _placeCombatPrompts);
  }
  host.innerHTML = cards.map(c => c.html).join('');
  host.hidden = false;
  _placeCombatPrompts();
}

// Over the map, below the turn banner when it shows.
function _placeCombatPrompts() {
  const host = document.getElementById('combat-prompts');
  const area = document.getElementById('canvas-area');
  if (!host || host.hidden || !area) return;
  const r = area.getBoundingClientRect();
  const banner = document.getElementById('turn-banner');
  const below = banner && !banner.hidden ? banner.getBoundingClientRect().bottom + 8 : r.top + 10;
  host.style.top = Math.round(below) + 'px';
  host.style.left = Math.round(r.left + r.width / 2) + 'px';
}

async function combatAnswer(tokId, cond, choice) {
  const out = await _combatPost(tokId, 'condition-ask', { condition: cond, choice });
  // Close the question at once from the answer, without waiting for the
  // token-updated broadcast that follows.
  if (out && out.condTimers) {
    const tok = tokens.find(t => t.id === tokId);
    const fields = { condTimers: JSON.stringify(out.condTimers) };
    if (tok && out.ended && out.ended.length) fields.conditions = JSON.stringify(parseConditions(tok.conditions).filter(c => !out.ended.includes(c)));
    patchToken(tokId, fields);
    renderTokens();
    if (selectedTokenId === tokId && tok && typeof _refreshHpPanel === 'function') _refreshHpPanel(tok);
  } else if (out && out.already) {
    const tok = tokens.find(t => t.id === tokId);
    const timers = tokTimers(tok);
    if (timers[cond]) { timers[cond].ask = false; patchToken(tokId, { condTimers: JSON.stringify(timers) }); renderCombatPrompts(); }
  }
  if (out && out.ended && out.ended.length) {
    const tok = tokens.find(t => t.id === tokId);
    showToast(`${out.ended.join(', ')} ended on ${tok ? tokDisplayName(tok) || tok.name : 'the token'}.`);
  }
}

async function combatDropConc(tokId) {
  await _combatPost(tokId, 'concentration', { spell: '' });
}

// The CON button among the conditions: mark the token as concentrating (on
// "a spell", when it was not set by casting one), or drop it. Updated on the
// spot; the server's token-updated confirms it for everyone.
async function toggleConcentration(tokId) {
  const tok = tokens.find(t => t.id === tokId);
  if (!tok) return;
  const spell = tok.concentration ? '' : 'a spell';
  const out = await _combatPost(tokId, 'concentration', { spell });
  if (!out) return;
  patchToken(tokId, { concentration: spell, concChecks: '[]' });
  renderTokens();
  if (selectedTokenId === tokId && typeof _refreshHpPanel === 'function') _refreshHpPanel(tokens.find(t => t.id === tokId));
}

// The CON save, rolled through the table's normal dice (animation, chat, the
// Normal/Adv/Dis toggle), then reported so the server keeps or ends the spell.
async function combatRollConc(tokId) {
  const tok = tokens.find(t => t.id === tokId);
  if (!tok) return;
  const c = tokConcChecks(tok)[0];
  if (!c) return;
  const mod = await _tokenConSave(tok);
  const name = tokDisplayName(tok) || tok.name || 'Token';
  rollPending = {
    label: `${name}: Concentration (CON save, DC ${c.dc})`,
    modifier: mod,
    sender: tok.type === 'companion' && typeof companionSender === 'function' ? companionSender(tok) : undefined,
    dmOnlyChat: !tok.visible && isDM() ? true : undefined,
    afterRoll: async (total) => {
      const out = await _combatPost(tokId, 'conc-check', { total });
      if (!out || out.already) return;
      showToast(out.passed
        ? `${name} keeps concentrating on ${out.spell} (${total} vs DC ${out.dc}).`
        : `${name} lost concentration on ${out.spell} (${total} vs DC ${out.dc}).`, !out.passed);
    },
  };
  confirmRoll(diceMode === 'ask' ? 'norm' : diceMode);
}

// The token's Constitution save bonus: the sheet's for a character, the stat
// block's for a monster or companion (its proficient save, else its CON mod).
async function _tokenConSave(tok) {
  const modOf = (score) => Math.floor(((parseInt(score) || 10) - 10) / 2);
  const num = (v) => parseInt(String(v == null ? '' : v).replace(/[^0-9\-+]/g, '')) || 0;
  try {
    if ((tok.type === 'character' || tok.type === 'npc') && tok.linkedId) {
      const r = await fetch(`/api/characters/${encodeURIComponent(tok.linkedId)}/qroll`, { headers: authHeaders() });
      if (r.ok) { const c = await r.json(); return num((c.data || {})['save-con']); }
    }
    if (tok.type === 'companion') {
      const d = companionOf(tok);
      return d.save && d.save.con ? num(d.save.con) : modOf(d.con);
    }
    if (tok.type === 'monster' && tok.linkedId && typeof ensureTableMonster === 'function') {
      const mon = await ensureTableMonster(tok.linkedId);
      let d = {};
      try { d = mon ? (mon.data || JSON.parse(mon.dataJson || '{}')) : {}; } catch {}
      return d.save && d.save.con ? num(d.save.con) : modOf(d.con);
    }
  } catch {}
  return 0;
}

// ── The right panel: rounds per condition, and concentration ────────────────
// Called by _refreshHpPanel (table-hppanel.js) for a token the viewer edits.
function renderCombatPanel(tok) {
  const box = document.getElementById('hp-cond-timers');
  if (!box) return;
  const conds = parseConditions(tok.conditions);
  const timers = tokTimers(tok);
  const rows = conds.map(c => {
    const t = timers[c];
    return `<label class="cbt-row"><span class="cbt-row-name">${esc(c)}</span>
      <input type="number" min="0" max="999" class="cbt-rounds" value="${t ? t.rounds : ''}" placeholder="—"
        aria-label="${esc(c)}: rounds left (empty for no limit)"
        onchange="combatSetRounds('${escJs(tok.id)}','${escJs(c)}', this.value)">
      <span class="cbt-row-unit">rounds</span></label>`;
  }).join('');
  const conc = tok.concentration
    ? `<div class="cbt-conc"><span>Concentrating: <b>${esc(tok.concentration)}</b></span>
        <button type="button" class="btn sm" onclick="combatDropConc('${escJs(tok.id)}')">Drop</button></div>`
    : '';
  box.innerHTML = (rows ? `<div class="cbt-rows-hint">Rounds left (empty: until removed)</div>${rows}` : '') + conc;
  box.hidden = !rows && !conc;
}

async function combatSetRounds(tokId, cond, value) {
  const n = Math.max(0, parseInt(value) || 0);
  await _combatPost(tokId, 'condition-timer', { condition: cond, rounds: n });
}

// ── News from the server ─────────────────────────────────────────────────────
// token-updated may say a condition ran out or concentration ended.
function combatNewsFromUpdate(d) {
  const tok = d && d.token;
  if (!tok || !_combatCanAnswer(tok)) return;
  const name = tokDisplayName(tok) || tok.name || 'Token';
  if (Array.isArray(d.condEnded) && d.condEnded.length) {
    if (typeof notifToast === 'function') notifToast({ kind: 'condition', title: `${d.condEnded.join(', ')} ended on ${name}`, ms: 6000 });
  }
  if (d.concEnded && !tok.concentration) {
    if (typeof notifToast === 'function') notifToast({ kind: 'condition', title: `${name} is no longer concentrating on ${d.concEnded}`, ms: 6000 });
  }
}
