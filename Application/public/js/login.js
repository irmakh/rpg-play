// ── Login page logic ──────────────────────────────────────────────────────────

// Where to go after login (honour ?next= param so auth guards can redirect back)
function _nextUrl() {
  const p = new URLSearchParams(location.search).get('next');
  if (p && p.startsWith('/') && !p.startsWith('//')) return p;
  return '/index.html';
}

function switchTab(tab) {
  document.getElementById('tab-char-btn').classList.toggle('active', tab === 'character');
  document.getElementById('tab-dm-btn').classList.toggle('active', tab === 'dm');
  document.getElementById('tab-character').classList.toggle('active', tab === 'character');
  document.getElementById('tab-dm').classList.toggle('active', tab === 'dm');
  if (tab === 'character') document.getElementById('char-pw').focus();
  else document.getElementById('dm-pw').focus();
}

// ── Character tab ─────────────────────────────────────────────────────────────

async function loadCharacters() {
  try {
    const res = await fetch('/api/characters');
    if (!res.ok) return;
    const chars = await res.json();
    const sel = document.getElementById('char-select');
    if (chars.length === 0) {
      sel.innerHTML = '<option value="">No characters found</option>';
      return;
    }
    sel.innerHTML = chars
      .filter(c => c.char_type === 'pc')
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('');
    onCharSelect();
  } catch {
    document.getElementById('char-select').innerHTML = '<option value="">Error loading characters</option>';
  }
}

function onCharSelect() {
  // Nothing special needed — password field is always shown since we mandate passwords
}

async function loginCharacter() {
  const characterId = document.getElementById('char-select').value;
  const password = document.getElementById('char-pw').value;
  const errEl = document.getElementById('char-err');
  errEl.textContent = '';

  if (!characterId) { errEl.textContent = 'Select a character.'; return; }
  if (!password) { errEl.textContent = 'Enter your password.'; return; }

  const btn = document.getElementById('char-login-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'character', characterId, password }),
    });
    const data = await res.json();
    if (data.needsSetup) {
      showSetupStep(data.characterId, data.characterName);
      return;
    }
    if (!res.ok) { errEl.textContent = data.error || 'Login failed.'; return; }
    _storeSession({ role: 'character', characterId: data.characterId, characterName: data.characterName, charPw: password });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

// ── Password setup step ───────────────────────────────────────────────────────

let _setupCharId = null;

function showSetupStep(charId, charName) {
  _setupCharId = charId;
  document.getElementById('char-login-step').style.display = 'none';
  document.getElementById('char-setup-step').style.display = 'block';
  document.getElementById('setup-char-name').textContent = charName;
  document.getElementById('setup-pw1').value = '';
  document.getElementById('setup-pw2').value = '';
  document.getElementById('setup-err').textContent = '';
  setTimeout(() => document.getElementById('setup-pw1').focus(), 30);
}

function cancelSetup() {
  _setupCharId = null;
  document.getElementById('char-setup-step').style.display = 'none';
  document.getElementById('char-login-step').style.display = 'block';
  document.getElementById('char-pw').value = '';
  document.getElementById('char-err').textContent = '';
}

async function setupPassword() {
  const pw1 = document.getElementById('setup-pw1').value;
  const pw2 = document.getElementById('setup-pw2').value;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';

  if (!pw1) { errEl.textContent = 'Enter a password.'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }
  if (pw1.length < 3) { errEl.textContent = 'Password must be at least 3 characters.'; return; }

  const btn = document.getElementById('setup-btn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/characters/${_setupCharId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: pw1 }),
    });
    if (!res.ok) { errEl.textContent = 'Failed to set password.'; return; }
    // Now login with the new password
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'character', characterId: _setupCharId, password: pw1 }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) { errEl.textContent = loginData.error || 'Login failed after setup.'; return; }
    _storeSession({ role: 'character', characterId: loginData.characterId, characterName: loginData.characterName, charPw: pw1 });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

// ── DM tab ────────────────────────────────────────────────────────────────────

async function loginDM() {
  const password = document.getElementById('dm-pw').value;
  const errEl = document.getElementById('dm-err');
  errEl.textContent = '';
  if (!password) { errEl.textContent = 'Enter the master password.'; return; }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dm', password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Wrong password.'; return; }
    _storeSession({ role: 'dm', masterPw: password });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
}

// ── Session storage ───────────────────────────────────────────────────────────

function _storeSession(sess) {
  sessionStorage.setItem('rpgSession', JSON.stringify(sess));
  // Keep legacy keys alive for any page that still reads them directly
  if (sess.role === 'dm') {
    sessionStorage.setItem('tableMasterPw', sess.masterPw);
    sessionStorage.setItem('dmMasterPw', sess.masterPw);
  } else {
    sessionStorage.removeItem('tableMasterPw');
    sessionStorage.removeItem('dmMasterPw');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
// If already logged in, skip login page
(function() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    if (s && s.role) { location.replace(_nextUrl()); return; }
  } catch {}
  loadCharacters();
  // Focus password field if DM tab is active (it won't be on load, so focus char pw)
  setTimeout(() => document.getElementById('char-pw')?.focus(), 100);
})();
