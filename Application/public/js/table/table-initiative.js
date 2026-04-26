// ── Initiative panel ──────────────────────────────────────────────────────────
function renderInitiativeTracker(showBadge) {
  const list = document.getElementById('init-tracker-list');
  if (!list) return;
  const allEntries = initData.entries || [];
  const visibleEntries = isDM() ? allEntries : allEntries.filter(e => !e.monsterId || !!initData.currentId);
  const sorted = [...visibleEntries].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">No combatants yet.</div>';
    return;
  }
  list.innerHTML = sorted.map(e => {
    const isCur = e.id === initData.currentId;
    const isViewing = e.id === _sideViewInitId;
    const canView = isDM() || !e.monsterId; // players can't click monsters
    // Resolve the display name: DM sees full name, players see identifier only
    const eTok = e.monsterId ? tokens.find(t => t.initiativeId === e.id) : null;
    const eDisplayName = (!isDM() && e.monsterId)
      ? (eTok ? tokDisplayName(eTok) : (() => { const p = e.name.trim().split(' '); return p[p.length-1]; })())
      : e.name;
    const nameHtml = (e.monsterId && isDM())
      ? `<a href="/monsters.html" target="_blank" style="color:inherit;text-decoration:underline dotted;cursor:pointer" title="Open monsters page" onclick="event.stopPropagation()">${esc(e.name)}</a>`
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
      body: JSON.stringify({ name: name.trim(), roll })
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

async function toggleInitiative() {
  if (!isDM()) return;
  const running = !!initData.currentId;
  try {
    await fetch(running ? '/api/initiative/end' : '/api/initiative/start', {
      method: 'POST', headers: { 'X-Master-Password': masterPw }
    });
  } catch { showToast('Failed to toggle initiative.', true); }
}

function updateInitiativeButton() {
  const btn = document.getElementById('btn-init-toggle');
  if (!btn) return;
  btn.textContent = initData.currentId ? '⏹ End Initiative' : '▶ Start Initiative';
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
