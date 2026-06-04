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
    const isCur = e.id === initData.currentId;
    const isViewing = e.id === _sideViewInitId;
    const canView = isDM() || !e.monsterId; // players can't click monsters
    // All users see only the identifier for monsters (full type shown in right panel only)
    const eTok = e.monsterId ? tokens.find(t => t.initiativeId === e.id) : null;
    const eDisplayName = e.monsterId
      ? (eTok ? tokDisplayName(eTok) : (() => { const p = e.name.trim().split(' '); return p[p.length-1]; })())
      : e.name;
    // DM: identifier opens monster info modal; full name shown as tooltip
    const nameHtml = (e.monsterId && isDM())
      ? `<span style="color:inherit;text-decoration:underline dotted;cursor:pointer" title="${esc(e.name)}" onclick="event.stopPropagation();showMonsterInfoModal('${esc(e.monsterId)}')">${esc(eDisplayName)}</span>`
      : esc(eDisplayName);
    const canEdit = isDM() || !e.monsterId; // DM edits all; players edit non-monster entries
    const rollHtml = canEdit
      ? `<input type="number" class="init-roll-input" value="${e.roll}" data-id="${e.id}" data-monster="${e.monsterId ? '1' : ''}"
           style="width:36px;background:var(--bg3);border:1px solid var(--a55);color:var(--ac);border-radius:3px;padding:2px 3px;font-size:11px;font-weight:bold;text-align:center"
           onchange="updateInitRoll(this)" onclick="event.stopPropagation()">`
      : `<span class="init-row-roll">${e.roll}</span>`;
    const delHtml = isDM()
      ? `<button class="btn sm danger" style="padding:1px 5px;font-size:11px;line-height:1.2;margin-left:4px" onclick="event.stopPropagation();removeInitEntry('${e.id}')" title="Remove from initiative">✕</button>`
      : '';
    const clickAttr = canView ? `onclick="viewInitEntry('${e.id}')"` : '';

    // ── Modern HUD: avatar card rows ──────────────────────────────────────
    if (document.body.dataset.theme === 'modern') {
      const eTokAll = _findInitToken(e);
      const portrait = eTokAll?.portraitThumb || eTokAll?.portrait || null;
      const apiData  = _initCharData[e.id] || null;
      const cur = apiData?.hpCurrent ?? eTokAll?.hpCurrent ?? null;
      const max = apiData?.hpMax     ?? eTokAll?.hpMax     ?? null;
      const ac  = apiData?.ac        ?? eTokAll?.ac        ?? null;
      const showStats = !e.monsterId || isDM();
      const hpPct = (max > 0 && cur !== null) ? Math.max(0, Math.min(1, cur / max)) : 0;
      const hpColor = hpBarColor(hpPct);
      const statParts = [];
      if (showStats) {
        if (ac !== null) statParts.push(`AC ${ac}`);
        if (cur !== null && max !== null) statParts.push(`<span style="color:${hpColor}">${cur}/${max}</span>`);
      }
      const statsHtml = statParts.length
        ? `<div class="init-meta-stats">${statParts.join(' · ')}</div>`
        : '';
      const curBorder = isCur ? ' init-cur-portrait' : '';
      const avatarHtml = portrait
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

    // ── Classic row ───────────────────────────────────────────────────────
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

async function rollMyInitiative() {
  const name = prompt('Your name (for initiative):');
  if (!name) return;
  const bonus = parseInt(prompt('Initiative bonus (e.g. +2 → enter 2):', '0')) || 0;
  const roll = Math.ceil(Math.random() * 20) + bonus;
  try {
    await fetch('/api/initiative/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), roll, charId: sessionCharId || '' })
    });
  } catch { showToast('Failed to roll initiative.', true); }
}

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
  const running = !!initData.currentId;
  const btnStart = document.getElementById('btn-init-start');
  const btnEnd   = document.getElementById('btn-init-end');
  const btnPrev  = document.getElementById('btn-init-prev');
  const btnNext  = document.getElementById('btn-init-next');
  if (btnStart) btnStart.style.display = running ? 'none' : '';
  if (btnEnd)   btnEnd.style.display   = running ? '' : 'none';
  if (btnPrev)  btnPrev.style.display  = running ? '' : 'none';
  if (btnNext)  btnNext.style.display  = running ? '' : 'none';
}

async function updateInitRoll(input) {
  const id = input.dataset.id;
  const isMonster = !!input.dataset.monster;
  const roll = parseInt(input.value);
  if (isNaN(roll)) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (isMonster) headers['X-Master-Password'] = masterPw;
    const res = await fetch(`/api/initiative/${id}/roll`, {
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
  if (_sideViewInitId === id) { _sideViewInitId = null; }
  try {
    const res = await fetch(`/api/initiative/${id}`, {
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
  // Players cannot view monster entries
  if (!isDM() && entry.monsterId) return;
  // Toggle: clicking the same entry again returns to active-turn view
  _sideViewInitId = (_sideViewInitId === id) ? null : id;
  _sideQrollTokenId = null; // force reload
  loadSideQroll();
  renderInitiativeTracker(); // refresh highlight
}
