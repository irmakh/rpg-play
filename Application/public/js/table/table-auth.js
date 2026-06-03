// ── Auth ──────────────────────────────────────────────────────────────────────

function _loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    if (!s || !s.role) return;
    sessionRole  = s.role;
    masterPw     = s.role === 'dm' ? (s.masterPw || '') : '';
    sessionCharId  = s.role === 'character' ? (s.characterId || null) : null;
    sessionCharPw  = s.role === 'character' ? (s.charPw || null) : null;
  } catch {}
}

function isDM() { return sessionRole === 'dm' && !!masterPw; }
function isCharSession() { return sessionRole === 'character' && !!sessionCharId; }

// Returns true if the logged-in user owns / is allowed to control this token.
// DM owns everything. A character owns their linked token (PC/NPC) or any token
// where assignedCharId was explicitly set to them (e.g. a monster assigned to a player).
function isMyToken(tok) {
  if (isDM()) return true;
  if (isCharSession()) {
    if (tok.assignedCharId && tok.assignedCharId === sessionCharId) return true;
    if (!tok.assignedCharId && tok.linkedId && tok.linkedId === sessionCharId) return true;
  }
  return false;
}

// A token that any player can see in the HP tracker / on the map without fog.
// Includes all character/NPC tokens AND monster tokens assigned to a specific player.
function isPlayerToken(tok) {
  if (tok.type === 'monster') return !!tok.assignedCharId;
  return !!tok.linkedId;
}

// Auth headers for fetch calls
function dmHeaders(extra) {
  return { 'Content-Type': 'application/json', 'X-Master-Password': masterPw, ...extra };
}
function charHeaders(extra) {
  const h = { 'Content-Type': 'application/json' };
  if (sessionCharId) h['X-Character-Id'] = sessionCharId;
  if (sessionCharPw) h['X-Character-Password'] = sessionCharPw;
  return { ...h, ...extra };
}
// Returns auth headers appropriate for the current session
function authHeaders(extra) {
  return isDM() ? dmHeaders(extra) : charHeaders(extra);
}

function logout() {
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
  location.replace('/login.html');
}

// ── Deprecated inline DM-unlock helpers (kept as stubs so old call sites don't error) ──
function unlockDM() {}
function cancelDMUnlock() {}
function submitDMPassword() {}
function exitDM() { logout(); }

function openSettingsModal() { openDMToolsModal(); }
function closeSettingsModal() { closeDMToolsModal(); }

function toggleLeftPanel() {
  const panel = document.getElementById('left-panel');
  const btn = document.getElementById('btn-leftpanel-toggle');
  if (!panel) return;
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? '' : 'none';
  if (btn) btn.textContent = hidden ? '◀' : '▶';
}
function toggleSidePanel() {
  const panel = document.getElementById('side-panel');
  const btn = document.getElementById('btn-sidepanel-toggle');
  if (!panel) return;
  const hidden = panel.style.display === 'none';
  panel.style.display = hidden ? '' : 'none';
  if (btn) btn.textContent = hidden ? '▶' : '◀';
}

function applyDMControls() {
  const dmBadge = document.getElementById('dm-badge');
  const dmUnlock = document.getElementById('btn-dm-unlock');
  const userBadge = document.getElementById('user-badge');
  const dmControls = document.querySelectorAll('.dm-controls');
  if (isDM()) {
    if (dmBadge) dmBadge.style.display = '';
    if (dmUnlock) dmUnlock.style.display = 'none';
    if (userBadge) userBadge.style.display = 'none';
    dmControls.forEach(el => el.style.display = 'contents');
    updateInitiativeButton();
    loadPrepMaps();
    renderFogPanel();
    renderItemsPanel();
  } else {
    if (dmBadge) dmBadge.style.display = 'none';
    if (dmUnlock) dmUnlock.style.display = 'none';
    if (userBadge) {
      const s = JSON.parse(sessionStorage.getItem('rpgSession') || '{}');
      userBadge.textContent = s.characterName || 'Player';
      userBadge.style.display = '';
    }
    dmControls.forEach(el => el.style.display = 'none');
    renderFogPanel();
  }
}
