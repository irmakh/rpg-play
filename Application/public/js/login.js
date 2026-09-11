// ── Login page logic ──────────────────────────────────────────────────────────
//
// Logging in is always scoped to a campaign — the DM password and the character
// roster both belong to one. The campaign picker at "/" is the normal way in and
// sets the campaign cookie; this page is what auth guards redirect to, so it
// reads that cookie and bounces back to the picker when there is no campaign.
//
// Each form carries the maths captcha (js/lib/auth-ui.js), and a successful
// login returns a SESSION TOKEN. The token is stored where the typed password
// used to be (rpgSession.masterPw / .charPw), so every page's existing request
// headers keep working — and the password itself never leaves this page.

let _campaign = null;   // { id, name, ... } once loaded
let _capChar = null;    // captcha widgets (AuthUI.captcha)
let _capDm = null;

function _campaignFromCookie() {
  const m = /(?:^|;\s*)campaign=([^;]*)/.exec(document.cookie || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function _toPicker() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/?next=${next}`);
}

async function loadCampaign() {
  try {
    const res = await fetch('/api/campaign/current');
    if (!res.ok) { _toPicker(); return false; }
    _campaign = await res.json();
  } catch { return false; }

  // Name the campaign you are logging into, and offer a way back to the picker.
  const logo = document.querySelector('.logo p');
  if (logo && _campaign) logo.textContent = _campaign.name;
  const hint = document.querySelector('.hint');
  if (hint) {
    hint.innerHTML = 'Session is stored in this browser tab only.<br>'
      + '<a href="/" style="color:var(--bone)">Switch campaign</a>';
  }
  return true;
}

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
  else { _capDm?.ensure(); document.getElementById('dm-pw').focus(); }
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
    const r = await AuthUI.login({ type: 'character', characterId, password }, _capChar);
    if (r.data.needsSetup) {
      showSetupStep(r.data.characterId, r.data.characterName, r.data.setupTicket);
      return;
    }
    if (!r.ok) { errEl.textContent = r.message; return; }
    _storeSession({ role: 'character', characterId: r.data.characterId, characterName: r.data.characterName, charPw: r.data.token });
    location.replace(_nextUrl());
  } finally { btn.disabled = false; }
}

// ── Password setup step ───────────────────────────────────────────────────────

let _setupCharId = null;
let _setupTicket = null;   // from the login answer: proves this form's captcha was solved

function showSetupStep(charId, charName, ticket) {
  _setupCharId = charId;
  _setupTicket = ticket || null;
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
  _setupTicket = null;
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
    const r = await AuthUI.setFirstPassword(_setupCharId, pw1, _setupTicket);
    if (!r.ok) { errEl.textContent = r.message; return; }
    _storeSession({ role: 'character', characterId: r.data.characterId, characterName: r.data.characterName, charPw: r.data.token });
    location.replace(_nextUrl());
  } finally { btn.disabled = false; }
}

// ── DM tab ────────────────────────────────────────────────────────────────────

async function loginDM() {
  const password = document.getElementById('dm-pw').value;
  const errEl = document.getElementById('dm-err');
  errEl.textContent = '';
  if (!password) { errEl.textContent = 'Enter the master password.'; return; }

  const r = await AuthUI.login({ type: 'dm', password }, _capDm);
  if (!r.ok) { errEl.textContent = r.message; return; }
  _storeSession({ role: 'dm', masterPw: r.data.token });
  location.replace(_nextUrl());
}

// ── Session storage ───────────────────────────────────────────────────────────

// `masterPw` / `charPw` hold the SESSION TOKEN. The names are kept because ~180
// request sites across the app read them.
function _storeSession(sess) {
  if (!sess.loginAt) sess.loginAt = Date.now();   // when this user logged in (shown on maintenance page)
  // Stamp the campaign so a page can tell a live session from one left over
  // after switching campaigns.
  if (_campaign) { sess.campaignId = _campaign.id; sess.campaignName = _campaign.name; }
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

function _dropSession() {
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
}

// ── Init ──────────────────────────────────────────────────────────────────────
// If already logged in, skip login page
(async function() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    const cookieCampaign = _campaignFromCookie();
    const token = s ? (s.role === 'dm' ? s.masterPw : s.charPw) : '';
    // A session from a different campaign is stale — the campaign was switched
    // in another tab or the cookie was replaced. So is one holding a plain
    // password instead of a token (a tab opened before v226). Drop both.
    if (s && s.campaignId && cookieCampaign && s.campaignId !== cookieCampaign) {
      _dropSession();
    } else if (s && s.role && !String(token || '').startsWith('rpgs_')) {
      _dropSession();
    } else if (s && s.role) {
      // Characters can only access index/table — don't let them loop into DM-only pages
      const dest = s.role === 'character' ? '/index.html' : _nextUrl();
      location.replace(dest);
      return;
    }
  } catch {}
  // No campaign selected yet: the picker is the only sensible destination.
  if (!(await loadCampaign())) return;
  _capChar = AuthUI.captcha(document.getElementById('char-cap'), { onEnter: loginCharacter });
  _capDm   = AuthUI.captcha(document.getElementById('dm-cap'), { onEnter: loginDM, lazy: true });
  loadCharacters();
  // Focus password field if DM tab is active (it won't be on load, so focus char pw)
  setTimeout(() => document.getElementById('char-pw')?.focus(), 100);
})();
