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
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">No combatants yet.</div>';
    return;
  }
  list.innerHTML = sorted.map(e => {
    const isCur    = e.id === initData.currentId;
    const isViewing = e.id === _sideViewInitId;
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
      ? `<input type="number" class="init-roll-input" value="${e.roll}" data-id="${e.id}" data-monster="${e.monsterId ? '1' : ''}"
           style="width:36px;background:var(--bg3);border:1px solid var(--a55);color:var(--ac);border-radius:3px;padding:2px 3px;font-size:11px;font-weight:bold;text-align:center"
           onchange="updateInitRoll(this)" onclick="event.stopPropagation()">`
      : `<span class="init-row-roll">${e.roll}</span>`;
    const delHtml  = isDM()
      ? `<button class="btn sm danger" style="padding:1px 5px;font-size:11px;line-height:1.2;margin-left:4px" onclick="event.stopPropagation();removeInitEntry('${escJs(e.id)}')" title="Remove from initiative">✕</button>`
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
        ? `<img class="init-avatar${curBorder}" src="${portrait}" alt="">`
        : `<div class="init-avatar-ph${curBorder}">${e.monsterId ? '🐉' : '⚔'}</div>`;
      return `<div class="init-row${isCur ? ' init-cur' : ''}${isViewing ? ' init-viewing' : ''}" ${clickAttr}>
        ${avatarHtml}
        <div class="init-meta">
          <div class="init-meta-name">${nameHtml}</div>
          ${statsHtml}
        </div>
        ${rollHtml}
        ${delHtml}
      </div>`;
    }

    // ── Classic row ──────────────────────────────────────────────────────────
    return `<div class="init-row${isCur ? ' init-cur' : ''}${isViewing ? ' init-viewing' : ''}" ${clickAttr}>
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      <span class="init-row-name">${nameHtml}</span>
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

async function initSkipTurn() {
  try {
    const headers = {};
    if (isDM()) headers['X-Master-Password'] = masterPw;
    await fetch('/api/initiative/next', { method: 'POST', headers });
  } catch {}
}

async function dmNextTurn() {
  await initSkipTurn();
}

async function dmPrevTurn() {
  try {
    const headers = {};
    if (isDM()) headers['X-Master-Password'] = masterPw;
    await fetch('/api/initiative/prev', { method: 'POST', headers });
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
  const btnStart = document.getElementById('btn-init-start');
  const btnEnd   = document.getElementById('btn-init-end');
  const btnPrev  = document.getElementById('btn-init-prev');
  const btnNext  = document.getElementById('btn-init-next');
  if (btnStart) btnStart.style.display = running ? 'none' : '';
  if (btnEnd)   btnEnd.style.display   = running ? '' : 'none';
  if (btnPrev)  btnPrev.style.display  = running ? '' : 'none';
  if (btnNext)  btnNext.style.display  = running ? '' : 'none';
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
  // Permission: a player may only preview an entry whose token they own; the DM sees all.
  if (!isDM()) {
    const mtok = _findInitToken(entry);
    if (!mtok || !isMyToken(mtok)) return;
  }
  const wasViewing = _sideViewInitId === id;
  _sideViewInitId = wasViewing ? null : id;
  // The initiative-row preview takes priority over any map selection (mirrors how
  // selectToken() clears _sideViewInitId), so clear the selection + its highlight.
  selectedTokenId = null;
  _sideQrollTokenId = null;
  if (typeof renderTokens === 'function') renderTokens();
  loadSideQroll();
  renderInitiativeTracker();
  // Item 6: clicking any combatant in the list pans the camera to its token,
  // regardless of whose turn it is. (Skip when toggling the row off.)
  if (!wasViewing) {
    const tok = _findInitToken(entry);
    if (tok) panToToken(tok.id);
  }
}
