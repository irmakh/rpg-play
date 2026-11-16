// Written by Irmak Hakman — 2026-11-16 14:58
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Initiative panel ──────────────────────────────────────────────────────────

function renderInitiativeTracker(showBadge) {
  const list = document.getElementById('init-tracker-list');
  if (!list) return;
  const allEntries = initData.entries || [];
  const visibleEntries = isDM() ? allEntries : allEntries.filter(e => {
    if (!e.monsterId) return true;
    if (!!initData.currentId) return true;
    const tok = tokens.find(t => t.initiativeId === e.id);
    return tok ? !!tok.assignedCharId : false;
  });
  const sorted = [...visibleEntries].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  const onDeckId = initOnDeckId();
  // Opens the left panel when initiative is first rolled, folds it to its
  // strip when the tracker empties (leftPanelAuto, table-chat.js).
  if (typeof leftPanelAuto === 'function') leftPanelAuto(sorted.length);
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">There is no initiative yet. Roll for initiative.</div>';
    if (typeof updateLeftPanelVisibility === 'function') updateLeftPanelVisibility();
    return;
  }
  list.innerHTML = sorted.map(e => {
    const isCur    = e.id === initData.currentId;
    const isViewing = e.id === _sideViewInitId;
    const deckHtml = e.id === onDeckId ? ' <span class="init-deck-tag">On deck</span>' : '';
    const eTok     = _findInitToken(e);
    // "Can see details" → drives whether clicking the row loads it in the right panel.
    // The DM sees everything; a player only their own character / assigned monster
    // token (matches the access loadSideQroll() enforces on the sheet/stat block).
    const canView  = isDM() || (!!eTok && isMyToken(eTok));
    const eDisplayName = e.monsterId
      ? (eTok ? tokDisplayName(eTok) : (() => { const p = e.name.trim().split(' '); return p[p.length - 1]; })())
      : e.name;
    const nameHtml = (e.monsterId && isDM())
      ? `<span style="color:inherit;text-decoration:underline dotted;cursor:pointer" title="${esc(e.name)}" onclick="event.stopPropagation();viewInitEntry('${escJs(e.id)}');showMonsterInfoModal('${escJs(e.monsterId)}')">${esc(eDisplayName)}</span>`
      : esc(eDisplayName);
    const canEdit  = isDM() || !e.monsterId;
    const rollHtml = canEdit
      ? `<input type="number" class="init-roll-input" value="${esc(e.roll)}" data-id="${esc(e.id)}" data-monster="${e.monsterId ? '1' : ''}"
           style="width:calc(36px*var(--fs, 1));background:var(--slate-hi);border:1px solid var(--rule-hi);color:var(--bone);border-radius:calc(3px*var(--fs, 1));padding:calc(2px*var(--fs, 1)) calc(3px*var(--fs, 1));font-size:calc(11px * var(--fs, 1));font-weight:bold;text-align:center"
           onchange="updateInitRoll(this)" onclick="event.stopPropagation()">`
      : `<span class="init-row-roll">${e.roll}</span>`;
    const delHtml  = isDM()
      ? `<button class="btn sm danger" style="padding:1px calc(5px*var(--fs, 1));font-size:calc(11px * var(--fs, 1));line-height:1.2;margin-left:calc(4px*var(--fs, 1))" onclick="event.stopPropagation();removeInitEntry('${escJs(e.id)}')" title="Remove from initiative"><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-close"></use></svg></button>`
      : '';
    const clickAttr = canView ? `onclick="viewInitEntry('${escJs(e.id)}')"` : '';

    // ── Modern HUD: avatar card rows ─────────────────────────────────────────
    if (document.body.dataset.theme === 'modern') {
      const eTokAll  = _findInitToken(e);
      const portrait = eTokAll?.portraitThumb || eTokAll?.portrait || null;
      const apiData  = _initCharData[e.id] || null;
      // Token HP is combat HP (updated live by the HP panel).
      // Always prefer token HP; fall back to API data only when no map token exists.
      const cur = eTokAll?.hpCurrent ?? apiData?.hpCurrent ?? null;
      const max = eTokAll?.hpMax     ?? apiData?.hpMax     ?? null;
      const ac  = apiData?.ac        ?? eTokAll?.ac        ?? null;
      const showStats = !e.monsterId || isDM();
      const hpPct    = (max > 0 && cur !== null) ? Math.max(0, Math.min(1, cur / max)) : 0;
      const hpColor  = hpBarColor(hpPct);
      const statParts = [];
      if (showStats) {
        if (ac !== null) statParts.push(`AC ${ac}`);
        if (cur !== null && max !== null) statParts.push(`<span style="color:${hpColor}">${cur}/${max}</span>`);
      }
      const statsHtml   = statParts.length ? `<div class="init-meta-stats">${statParts.join(' · ')}</div>` : '';
      const curBorder   = isCur ? ' init-cur-portrait' : '';
      const avatarHtml  = portrait
        ? `<img class="init-avatar${curBorder}" src="${esc(portrait)}" alt="">`
        : `<div class="init-avatar-ph${curBorder}">${e.monsterId ? '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-swords"></use></svg>' : '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-swords"></use></svg>'}</div>`;
      return `<div class="init-row${isCur ? ' init-cur' : ''}${isViewing ? ' init-viewing' : ''}" ${clickAttr}>
        ${avatarHtml}
        <div class="init-meta">
          <div class="init-meta-name">${nameHtml}${deckHtml}</div>
          ${statsHtml}
        </div>
        ${rollHtml}
        ${delHtml}
      </div>`;
    }

    // ── Classic row ──────────────────────────────────────────────────────────
    return `<div class="init-row${isCur ? ' init-cur' : ''}${isViewing ? ' init-viewing' : ''}" ${clickAttr}>
      <span class="init-cur-marker">${isCur ? '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-play"></use></svg>' : ''}</span>
      <span class="init-row-name">${nameHtml}${deckHtml}</span>
      ${rollHtml}
      ${delHtml}
    </div>`;
  }).join('');

  if (showBadge && !initPanelOpen) {
    const badge = document.getElementById('init-badge');
    if (badge) badge.style.display = '';
  }
  if (typeof updateLeftPanelVisibility === 'function') updateLeftPanelVisibility();
}

function initTogglePanel() {
  const body = document.getElementById('init-body-wrap');
  const chev = document.getElementById('init-chevron');
  if (!body) return;
  initPanelOpen = !initPanelOpen;
  body.classList.toggle('open', initPanelOpen);
  if (chev) chev.textContent = initPanelOpen ? '▼' : '▲';
  if (initPanelOpen) {
    const badge = document.getElementById('init-badge');
    if (badge) badge.style.display = 'none';
  }
}

// ── Player initiative roll modal ──────────────────────────────────────────────

// Find the best target token for an initiative roll.
// Only uses EXPLICITLY selected or session-owned tokens. Never falls back to
// _sideQrollTokenId — during running combat that is the active-turn token, and
// using it would cause the modal to upsert the wrong (active-turn) entry.
function _initRollTargetTok() {
  const selTok = selectedTokenId ? tokens.find(t => t.id === selectedTokenId && t.type !== 'monster') : null;
  if (selTok) return selTok;
  if (sessionCharId) return tokens.find(t => t.linkedId === String(sessionCharId) && t.type !== 'monster') || null;
  return null;
}

function openInitRollModal() {
  const nameInput  = document.getElementById('init-roll-name');
  const bonusInput = document.getElementById('init-roll-bonus');
  const targetTok  = _initRollTargetTok();

  // Name: use the target token's name directly.
  // Do NOT use qrollCharName — during running combat that is the active-turn
  // character's name, not the character we are rolling for.
  if (nameInput) {
    nameInput.value = targetTok?.name || '';
  }
  // Bonus: only pull from qrollData when the side panel is actually showing this token.
  // Otherwise the bonus would come from the active-turn character's sheet.
  if (bonusInput) {
    const panelMatchesTarget = targetTok && _sideQrollTokenId === targetTok.id;
    const d = panelMatchesTarget ? (qrollData || {}) : {};
    const bonus = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
    bonusInput.value = bonus;
  }
  _updateInitRollPreview();
  document.getElementById('init-roll-modal').style.display = 'flex';
  if (nameInput) nameInput.focus();
}

function closeInitRollModal() {
  document.getElementById('init-roll-modal').style.display = 'none';
}

function _updateInitRollPreview() {
  const bonusInput = document.getElementById('init-roll-bonus');
  const preview    = document.getElementById('init-roll-preview');
  if (!preview) return;
  const bonus = parseInt(bonusInput?.value) || 0;
  preview.textContent = bonus >= 0 ? `1d20 + ${bonus}` : `1d20 - ${Math.abs(bonus)}`;
}

async function confirmInitRoll() {
  const nameInput  = document.getElementById('init-roll-name');
  const bonusInput = document.getElementById('init-roll-bonus');
  const name  = nameInput?.value?.trim();
  const bonus = parseInt(bonusInput?.value) || 0;
  if (!name) { nameInput?.focus(); return; }
  const d20  = Math.ceil(Math.random() * 20);
  const roll = d20 + bonus;

  // Link the roll to the target token's character (so portrait/HP appear in the list)
  const targetTok = _initRollTargetTok();
  const charId = targetTok?.linkedId || sessionCharId || '';

  closeInitRollModal();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (isDM()) headers['X-Master-Password'] = masterPw;
    else if (sessionCharPw) headers['X-Character-Password'] = sessionCharPw;
    await fetch('/api/initiative/entries', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, roll, charId: String(charId) })
    });
  } catch { showToast('Failed to roll initiative.', true); }
}

// DM rolls initiative for a non-monster token (called from hp panel)
async function rollMyInitiative() {
  openInitRollModal();
}

// ── Combat controls ───────────────────────────────────────────────────────────

// Turn control needs a login since v240 — the DM's or a player's, so both
// send their credential through authHeaders() (table-auth.js).
async function initSkipTurn() {
  try {
    await fetch('/api/initiative/next', { method: 'POST', headers: authHeaders() });
  } catch {}
}

async function dmNextTurn() {
  await initSkipTurn();
}

async function dmPrevTurn() {
  try {
    await fetch('/api/initiative/prev', { method: 'POST', headers: authHeaders() });
  } catch {}
}

async function startInitiative() {
  if (!isDM()) return;
  try {
    await fetch('/api/initiative/start', { method: 'POST', headers: { 'X-Master-Password': masterPw } });
  } catch { showToast('Failed to start initiative.', true); }
}

async function endInitiative() {
  if (!isDM()) return;
  try {
    await fetch('/api/initiative/end', { method: 'POST', headers: { 'X-Master-Password': masterPw } });
    initData = { ...initData, currentId: null };
    updateInitiativeButton();
  } catch { showToast('Failed to end initiative.', true); }
}

function updateInitiativeButton() {
  const running  = !!initData.currentId;
  const dm       = isDM();
  const mine     = running && isMyTurn();
  const btnStart = document.getElementById('btn-init-start');
  const btnEnd   = document.getElementById('btn-init-end');
  const btnPrev  = document.getElementById('btn-init-prev');
  const btnNext  = document.getElementById('btn-init-next');
  if (btnStart) btnStart.style.display = running ? 'none' : '';
  if (btnEnd)   btnEnd.style.display   = running ? '' : 'none';
  // The DM steps back and forward. A player sees only End turn, and only on
  // their own turn (the server refuses anything else).
  if (btnPrev)  btnPrev.style.display  = running && dm ? '' : 'none';
  if (btnNext) {
    btnNext.style.display = running && (dm || mine) ? '' : 'none';
    const label = dm ? 'Next' : 'End turn';
    if (btnNext.dataset.label !== label) {
      btnNext.dataset.label = label;
      btnNext.innerHTML = `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-next"></use></svg> ${label}`;
    }
    btnNext.classList.toggle('init-end-turn', !dm);
  }
  renderTurnBanner();
}

// ── Whose turn ───────────────────────────────────────────────────────────────
// The active entry is this player's when it was rolled for their character, or
// a token in it is theirs (their character, or a companion assigned to them).
function isMyTurn() {
  if (!initData.currentId || isDM()) return false;
  const e = (initData.entries || []).find(x => x.id === initData.currentId);
  if (!e) return false;
  if (e.charId && sessionCharId && String(e.charId) === String(sessionCharId)) return true;
  return tokens.some(t => t.initiativeId === e.id && t.type !== 'monster' && isMyToken(t));
}

// Who goes after the current turn, in the server's order (roll, then who
// joined first), wrapping round to the top.
function initOnDeckId() {
  const all = initData.entries || [];
  if (!initData.currentId || all.length < 2) return null;
  const i = all.findIndex(e => e.id === initData.currentId);
  if (i < 0) return null;
  return all[(i + 1) % all.length].id;
}

// "Your turn, Mira" across the top of the map with an End turn button, for
// the player whose turn it is. Players who are next see "You're on deck".
function renderTurnBanner() {
  let el = document.getElementById('turn-banner');
  const mine = isMyTurn();
  let deck = false;
  if (!mine && !isDM() && initData.currentId) {
    const d = (initData.entries || []).find(x => x.id === initOnDeckId());
    deck = !!d && ((d.charId && String(d.charId) === String(sessionCharId))
      || tokens.some(t => t.initiativeId === d.id && t.type !== 'monster' && isMyToken(t)));
  }
  if (!mine && !deck) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'turn-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    window.addEventListener('resize', _placeTurnBanner);
  }
  const e = (initData.entries || []).find(x => x.id === initData.currentId);
  const who = sessionCharName || (e && e.name) || '';
  el.className = mine ? 'turn-banner mine' : 'turn-banner deck';
  el.innerHTML = mine
    ? `<b>Your turn${who ? ', ' + esc(who) : ''}</b><button type="button" class="turn-banner-end" onclick="initSkipTurn()">End turn</button>`
    : `<span>You're on deck</span>`;
  el.hidden = false;
  _placeTurnBanner();
}

// Centred over the map, just below its top edge, whatever the side panels do.
function _placeTurnBanner() {
  const el = document.getElementById('turn-banner');
  const area = document.getElementById('canvas-area');
  if (!el || el.hidden || !area) return;
  const r = area.getBoundingClientRect();
  el.style.top = Math.round(r.top + 10) + 'px';
  el.style.left = Math.round(r.left + r.width / 2) + 'px';
}

// ── Entry management ──────────────────────────────────────────────────────────

async function updateInitRoll(input) {
  const id        = input.dataset.id;
  const isMonster = !!input.dataset.monster;
  const roll      = parseInt(input.value);
  if (isNaN(roll)) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (isMonster) headers['X-Master-Password'] = masterPw;
    const res = await fetch(`/api/initiative/entries/${id}/roll`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ roll })
    });
    if (!res.ok) { showToast('Failed to update initiative.', true); input.value = input.defaultValue; }
  } catch { showToast('Connection error.', true); }
}

async function removeInitEntry(id) {
  const entry = initData.entries?.find(e => e.id === id);
  if (!entry || !isDM()) return;
  if (!confirm(`Remove "${entry.name}" from initiative?`)) return;
  if (_sideViewInitId === id) _sideViewInitId = null;
  try {
    const res = await fetch(`/api/initiative/entries/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({})
    });
    if (!res.ok) showToast('Failed to remove entry.', true);
  } catch { showToast('Connection error.', true); }
}

function viewInitEntry(id) {
  const entry = initData.entries?.find(e => e.id === id);
  if (!entry) return;
  // Resolve the entry to its map token using the SAME link the list uses to show
  // each row's HP and name (_findInitToken), then behave exactly as if the user had
  // clicked that token on the map — selectToken() is the proven path that puts the
  // correct combatant in the right panel. No toggle: clicking always selects it.
  const tok = _findInitToken(entry);
  if (!tok) return;
  // Permission: the DM sees everyone; a player only a token they own.
  if (!isDM() && !isMyToken(tok)) return;
  // Mirror a map token click exactly: selectToken() highlights + loads the sheet,
  // openHpPanel() reveals the right panel (the details container is hidden behind a
  // placeholder until then — that's why selecting alone left the panel blank).
  selectToken(tok.id);
  openHpPanel(tok);
  panToToken(tok.id);
}
