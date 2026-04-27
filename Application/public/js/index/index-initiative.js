// ── Initiative Tracker ────────────────────────────────────────────────────────
let initDataMap        = {};
let initEditId         = null;
let initEditCharId     = null;
let initTrackerCollapsed = true;
let _initDataLoaded    = false;

function getDmPw() {
  let pw = sessionStorage.getItem('initDmPw') || '';
  if (!pw) {
    pw = prompt('DM password:') || '';
    if (pw) sessionStorage.setItem('initDmPw', pw);
  }
  return pw;
}
function clearDmPw() { sessionStorage.removeItem('initDmPw'); }

async function loadInitiativeTracker() {
  try {
    const res = await fetch('/api/initiative');
    if (!res.ok) return;
    initData = await res.json();
    _initDataLoaded = true;
    renderInitiativeTracker(false);
  } catch {}
}

function initTogglePanel() {
  initTrackerCollapsed = !initTrackerCollapsed;
  const bodyWrap = document.getElementById('init-body-wrap');
  const chevron  = document.getElementById('init-chevron');
  bodyWrap.classList.toggle('open', !initTrackerCollapsed);
  chevron.textContent = initTrackerCollapsed ? '▲' : '▼';
  if (!initTrackerCollapsed) {
    if (chatOpen) chatToggle();
    document.getElementById('init-badge').style.display = 'none';
    if (!_initDataLoaded) {
      _initDataLoaded = true;
      loadInitiativeTracker();
    } else {
      renderInitiativeTracker(false);
    }
  }
}

function renderInitiativeTracker(showBadge = false) {
  const list = document.getElementById('init-tracker-list');
  if (!list) return;
  const visibleEntries = (initData.entries || []).filter(e => !e.monsterId || !!initData.currentId);
  const sorted = [...visibleEntries].sort((a, b) => (b.roll || 0) - (a.roll || 0));
  if (showBadge && initTrackerCollapsed && sorted.length > 0) {
    document.getElementById('init-badge').style.display = '';
  }
  if (sorted.length === 0) {
    list.innerHTML = '<div class="init-empty-msg">No combatants yet.</div>';
    return;
  }
  initDataMap = {};
  sorted.forEach(e => { initDataMap[e.id] = e; });
  list.innerHTML = sorted.map(e => {
    const isCur = e.id === initData.currentId;
    return `<div class="init-row${isCur ? ' init-cur' : ''}">
      <span class="init-cur-marker">${isCur ? '▶' : ''}</span>
      <span class="init-row-name">${esc(e.name)}</span>
      <span class="init-row-roll">${e.roll}</span>
      <button class="sk-roll-btn" onclick="openInitEditModal('${e.id}')" title="Edit">✎</button>
      <button class="del-btn" onclick="deleteInitEntry('${e.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function rollMyInitiative() {
  if (!currentCharId) {
    showAlert('Please select a character first.');
    return;
  }
  const initEl = document.querySelector('[data-key="init"]');
  const modifier = (parseInt(initEl?.value) || 0) + (parseInt(document.querySelector('[data-key="init-bonus"]')?.value) || 0);
  const charName = document.querySelector('[data-key="name"]')?.value?.trim() || 'Unknown';
  rollPending = { label: 'Initiative', modifier, isInitiative: true, initCharName: charName };
  document.getElementById('adv-label').textContent = 'Roll: Initiative';
  document.getElementById('adv-modal').style.display = 'flex';
}

async function submitInitiativeRoll(total, name) {
  if (!currentCharId || !name) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    await fetch('/api/initiative/roll', {
      method: 'POST', headers,
      body: JSON.stringify({ charId: currentCharId, name, roll: total })
    });
  } catch {}
}

function openInitNpcModal() {
  document.getElementById('init-npc-name').value = '';
  document.getElementById('init-npc-bonus').value = '0';
  document.getElementById('init-npc-pw').value = sessionStorage.getItem('initDmPw') || '';
  document.getElementById('init-npc-err').textContent = '';
  document.getElementById('init-npc-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-npc-name').focus(), 50);
}
function closeInitNpcModal() { document.getElementById('init-npc-modal').style.display = 'none'; }

async function submitInitNpc() {
  const name  = document.getElementById('init-npc-name').value.trim();
  const bonus = parseInt(document.getElementById('init-npc-bonus').value) || 0;
  const pw    = document.getElementById('init-npc-pw').value;
  const errEl = document.getElementById('init-npc-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  if (!pw)   { errEl.textContent = 'DM password required.'; return; }
  const roll = Math.ceil(Math.random() * 20) + bonus;
  errEl.textContent = '';
  try {
    const res = await fetch('/api/initiative/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': pw },
      body: JSON.stringify({ name, roll })
    });
    if (res.status === 401) { clearDmPw(); errEl.textContent = 'Wrong DM password.'; return; }
    if (!res.ok) { errEl.textContent = 'Failed.'; return; }
    sessionStorage.setItem('initDmPw', pw);
    closeInitNpcModal();
  } catch { errEl.textContent = 'Network error.'; }
}

async function initSkipTurn() {
  try {
    await fetch('/api/initiative/next', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch {}
}

function initClear() {
  showConfirm('Clear all initiative entries?', async () => {
    const pw = getDmPw();
    if (!pw) return;
    try {
      const res = await fetch('/api/initiative/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': pw }
      });
      if (res.status === 401) { clearDmPw(); showAlert('Wrong DM password.'); }
    } catch {}
  });
}

function openInitEditModal(id) {
  const e = initDataMap[id];
  if (!e) return;
  initEditId = id;
  initEditCharId = e.charId || '';
  const isOwn = initEditCharId && initEditCharId === currentCharId;
  document.getElementById('init-edit-name').value = e.name;
  document.getElementById('init-edit-roll').value = e.roll;
  document.getElementById('init-edit-err').textContent = '';
  const pwRow = document.getElementById('init-edit-pw-row');
  const pwInput = document.getElementById('init-edit-pw');
  if (isOwn) {
    pwRow.style.display = 'none';
    pwInput.value = '';
  } else {
    pwRow.style.display = '';
    pwInput.value = sessionStorage.getItem('initDmPw') || '';
  }
  document.getElementById('init-edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('init-edit-name').focus(), 50);
}
function closeInitEditModal() {
  document.getElementById('init-edit-modal').style.display = 'none';
  initEditId = null; initEditCharId = null;
}

async function submitInitEdit() {
  if (!initEditId) return;
  const name  = document.getElementById('init-edit-name').value.trim();
  const roll  = parseInt(document.getElementById('init-edit-roll').value);
  const errEl = document.getElementById('init-edit-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }
  if (isNaN(roll)) { errEl.textContent = 'Invalid roll.'; return; }
  const isOwn = initEditCharId && initEditCharId === currentCharId;
  const headers = { 'Content-Type': 'application/json' };
  const body = { name, roll };
  if (isOwn) {
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    body.charId = currentCharId;
  } else {
    const pw = document.getElementById('init-edit-pw').value;
    if (!pw) { errEl.textContent = 'DM password required.'; return; }
    headers['X-Master-Password'] = pw;
  }
  try {
    const res = await fetch(`/api/initiative/${initEditId}`, {
      method: 'PUT', headers, body: JSON.stringify(body)
    });
    if (res.status === 401 || res.status === 403) {
      if (!isOwn) clearDmPw();
      errEl.textContent = 'Wrong DM password.'; return;
    }
    if (!res.ok) { errEl.textContent = 'Failed.'; return; }
    if (!isOwn) sessionStorage.setItem('initDmPw', document.getElementById('init-edit-pw').value);
    closeInitEditModal();
  } catch { errEl.textContent = 'Network error.'; }
}

async function deleteInitEntry(id) {
  const e = initDataMap[id];
  const charId = e?.charId || '';
  const isOwn = charId && charId === currentCharId;
  const headers = { 'Content-Type': 'application/json' };
  const body = {};
  if (isOwn) {
    if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
    body.charId = currentCharId;
  } else {
    const pw = getDmPw();
    if (!pw) return;
    headers['X-Master-Password'] = pw;
  }
  try {
    const res = await fetch(`/api/initiative/${id}`, {
      method: 'DELETE', headers, body: JSON.stringify(body)
    });
    if (res.status === 401 || res.status === 403) { if (!isOwn) clearDmPw(); showAlert('Wrong password.'); }
  } catch {}
}
