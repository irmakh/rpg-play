// ── Auth ──────────────────────────────────────────────────────────────────────
function unlockDM() {
  document.getElementById('btn-dm-unlock').style.display = 'none';
  const inline = document.getElementById('dm-pw-inline');
  inline.style.display = 'flex';
  document.getElementById('dm-pw-input').value = '';
  document.getElementById('dm-pw-input').focus();
}

function cancelDMUnlock() {
  document.getElementById('dm-pw-inline').style.display = 'none';
  document.getElementById('btn-dm-unlock').style.display = '';
}

async function submitDMPassword() {
  const pw = document.getElementById('dm-pw-input').value;
  if (!pw) return;
  try {
    const res = await fetch('/api/loot/all', { headers: { 'X-Master-Password': pw } });
    if (res.status === 401) { showToast('Wrong password.', true); document.getElementById('dm-pw-input').select(); return; }
    masterPw = pw;
    sessionStorage.setItem('tableMasterPw', pw);
    location.reload();
  } catch { showToast('Connection error.', true); }
}

function exitDM() {
  masterPw = '';
  sessionStorage.removeItem('tableMasterPw');
  location.reload();
}

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
  const dmControls = document.querySelectorAll('.dm-controls');
  if (isDM()) {
    if (dmBadge) dmBadge.style.display = '';
    if (dmUnlock) dmUnlock.style.display = 'none';
    dmControls.forEach(el => el.style.display = 'contents');
    updateInitiativeButton();
    loadPrepMaps();
    renderFogPanel();
    renderItemsPanel();
  } else {
    if (dmBadge) dmBadge.style.display = 'none';
    if (dmUnlock) dmUnlock.style.display = '';
    dmControls.forEach(el => el.style.display = 'none');
    renderFogPanel();
  }
}
