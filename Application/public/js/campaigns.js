// ── Campaign picker ───────────────────────────────────────────────────────────
// The app's front door. Lists every campaign, shows one in detail, and logs you
// into it. Selecting a campaign sets the `campaign` cookie (via
// POST /api/campaigns/:id/enter) which scopes every later API call — that is why
// no other page had to learn about campaigns to keep working.

// Standalone page: its own escapers, same contract as js/lib/esc.js.
function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// For a value interpolated into a single-quoted JS string inside an HTML
// attribute: onclick="fn('${escJs(v)}')". esc() is wrong there — the browser
// decodes &#39; before the inline JS parses, so apostrophes break the handler.
function escJs(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

let _campaigns = [];
let _sel = null;          // the loaded detail object for the selected campaign
let _setupCharId = null;  // character mid password-setup

// Where to go after login (honour ?next= so auth guards can bounce back).
function _nextUrl() {
  const p = new URLSearchParams(location.search).get('next');
  if (p && p.startsWith('/') && !p.startsWith('//')) return p;
  return '/index.html';
}

function initial(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }

function fmtBytes(n) {
  if (!n) return '0 MB';
  const mb = n / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(1) + ' MB';
}

function fmtWhen(iso) {
  if (!iso) return 'never opened';
  const d = new Date(iso);
  if (isNaN(d)) return 'never opened';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── List ──────────────────────────────────────────────────────────────────────

async function loadCampaigns() {
  const box = document.getElementById('camp-list');
  try {
    const res = await fetch('/api/campaigns');
    if (!res.ok) throw new Error('load failed');
    _campaigns = await res.json();
  } catch {
    box.innerHTML = '<div class="detail-empty"><div>Could not reach the server.</div></div>';
    return;
  }
  renderList();
  // Deep link (?campaign=slug) or the campaign already in the cookie wins;
  // otherwise a single-campaign install opens straight into its only campaign.
  const want = new URLSearchParams(location.search).get('campaign') || readCampaignCookie();
  const match = _campaigns.find(c => c.id === want || c.slug === want);
  if (match) selectCampaign(match.id, { silent: true });
  else if (_campaigns.length === 1) selectCampaign(_campaigns[0].id, { silent: true });
}

function readCampaignCookie() {
  const m = /(?:^|;\s*)campaign=([^;]*)/.exec(document.cookie || '');
  try { return m ? decodeURIComponent(m[1]) : ''; } catch { return m ? m[1] : ''; }
}

function renderList() {
  const box = document.getElementById('camp-list');
  document.getElementById('list-count').textContent =
    _campaigns.length === 1 ? '1 Campaign' : `${_campaigns.length} Campaigns`;

  if (!_campaigns.length) {
    box.innerHTML = '<div class="detail-empty"><div>No campaigns yet.</div>'
      + '<button class="btn btn-sm" style="margin-top:10px" onclick="openNewCampaign()">Create the first one</button></div>';
    return;
  }

  box.innerHTML = _campaigns.map(c => `
    <button class="camp-card${_sel && _sel.id === c.id ? ' active' : ''}" onclick="selectCampaign('${escJs(c.id)}')">
      <div class="camp-cover">${c.coverThumb
        ? `<img src="${esc(c.coverThumb)}" alt="">`
        : esc(initial(c.name))}</div>
      <div class="camp-meta">
        <div class="camp-name">${esc(c.name)}</div>
        <div class="camp-desc">${esc(c.description || 'No description')}</div>
        <div class="camp-sub">Last played: ${esc(fmtWhen(c.lastPlayedAt))}</div>
      </div>
    </button>
  `).join('');
}

// ── Detail ────────────────────────────────────────────────────────────────────

async function selectCampaign(id, opts = {}) {
  const detail = document.getElementById('detail');
  detail.innerHTML = '<div class="detail-empty"><div>Loading…</div></div>';
  document.body.classList.add('detail-open');

  try {
    // Entering sets the campaign cookie. It grants nothing on its own — the
    // login below still has to succeed — but it scopes the character list and
    // the password check that follow.
    const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/enter`, { method: 'POST' });
    if (!res.ok) throw new Error('enter failed');
    _sel = await res.json();
  } catch {
    detail.innerHTML = '<div class="detail-empty"><div>Could not open that campaign.</div></div>';
    return;
  }
  renderList();
  renderDetail();
  if (!opts.silent) detail.scrollTop = 0;
}

function renderDetail() {
  const c = _sel;
  const s = c.stats || {};
  const chars = c.characters || [];

  document.getElementById('detail').innerHTML = `
    <button class="btn btn-sm btn-ghost back-btn" style="margin-bottom:14px" onclick="closeDetail()">← All campaigns</button>

    <div class="detail-head">
      <div class="detail-cover">${c.coverMedium || c.coverUrl
        ? `<img src="${esc(c.coverMedium || c.coverUrl)}" alt="">`
        : esc(initial(c.name))}</div>
      <div class="detail-title">
        <h2>${esc(c.name)}</h2>
        <p>${esc(c.description || 'No description yet.')}</p>
        <div class="when">Last played: ${esc(fmtWhen(c.lastPlayedAt))}</div>
      </div>
    </div>

    <div class="chips">
      <span class="chip"><b>${s.characters ?? 0}</b> characters</span>
      <span class="chip"><b>${s.monsters ?? 0}</b> monsters</span>
      <span class="chip"><b>${s.maps ?? 0}</b> maps</span>
      <span class="chip"><b>${s.treasury ?? 0}</b> treasury items</span>
      <span class="chip"><b>${s.stories ?? 0}</b> stories</span>
      <span class="chip">${esc(fmtBytes(s.sizeBytes))}</span>
    </div>

    <div class="sect">
      <div class="sect-hdr">Enter Campaign</div>
      <div class="tabs">
        <button class="tab-btn active" id="tab-char-btn" onclick="switchTab('character')">Character</button>
        <button class="tab-btn" id="tab-dm-btn" onclick="switchTab('dm')">Dungeon Master</button>
      </div>

      <div class="tab-pane active" id="pane-character">
        <div id="char-login-step">
          <div class="field">
            <label>Character</label>
            <select id="char-select">
              ${chars.length
                ? chars.map(ch => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('')
                : '<option value="">No characters in this campaign</option>'}
            </select>
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="char-pw" placeholder="Enter password…" autocomplete="current-password"
                   onkeydown="if(event.key==='Enter')loginCharacter()">
          </div>
          <div class="err-msg" id="char-err"></div>
          <button class="btn" id="char-login-btn" onclick="loginCharacter()"${chars.length ? '' : ' disabled'}>Login</button>
        </div>

        <div id="char-setup-step" style="display:none">
          <div style="font-size:13px;color:var(--bone);font-weight:bold;margin-bottom:4px" id="setup-char-name"></div>
          <div style="font-size:11px;color:var(--ash);margin-bottom:14px">This character has no password yet.<br>Set one to continue.</div>
          <div class="field">
            <label>New Password</label>
            <input type="password" id="setup-pw1" autocomplete="new-password"
                   onkeydown="if(event.key==='Enter')document.getElementById('setup-pw2').focus()">
          </div>
          <div class="field">
            <label>Confirm Password</label>
            <input type="password" id="setup-pw2" autocomplete="new-password"
                   onkeydown="if(event.key==='Enter')setupPassword()">
          </div>
          <div class="err-msg" id="setup-err"></div>
          <button class="btn" id="setup-btn" onclick="setupPassword()">Set Password &amp; Login</button>
          <button class="btn btn-ghost" style="margin-top:8px" onclick="cancelSetup()">Back</button>
        </div>
      </div>

      <div class="tab-pane" id="pane-dm">
        <div class="field">
          <label>DM Password</label>
          <input type="password" id="dm-pw" placeholder="This campaign's DM password" autocomplete="current-password"
                 onkeydown="if(event.key==='Enter')loginDM()">
        </div>
        <div class="err-msg" id="dm-err"></div>
        <button class="btn" onclick="loginDM()">Login as DM</button>
        <div class="hint">Each campaign has its own DM password.</div>
      </div>
    </div>

    <div class="row" style="max-width:520px">
      <button class="btn btn-sm btn-ghost" onclick="openManage()">⚙ Campaign settings</button>
    </div>
  `;
}

function closeDetail() {
  document.body.classList.remove('detail-open');
}

function switchTab(tab) {
  const isChar = tab === 'character';
  document.getElementById('tab-char-btn').classList.toggle('active', isChar);
  document.getElementById('tab-dm-btn').classList.toggle('active', !isChar);
  document.getElementById('pane-character').classList.toggle('active', isChar);
  document.getElementById('pane-dm').classList.toggle('active', !isChar);
  document.getElementById(isChar ? 'char-pw' : 'dm-pw')?.focus();
}

// ── Login ─────────────────────────────────────────────────────────────────────

function _storeSession(sess) {
  if (!sess.loginAt) sess.loginAt = Date.now();
  // Which campaign this session belongs to — pages show it and use it to detect
  // a session left over from a different campaign.
  sess.campaignId = _sel.id;
  sess.campaignName = _sel.name;
  sessionStorage.setItem('rpgSession', JSON.stringify(sess));
  if (sess.role === 'dm') {
    sessionStorage.setItem('tableMasterPw', sess.masterPw);
    sessionStorage.setItem('dmMasterPw', sess.masterPw);
  } else {
    sessionStorage.removeItem('tableMasterPw');
    sessionStorage.removeItem('dmMasterPw');
  }
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
      headers: { 'Content-Type': 'application/json', 'X-Campaign-Id': _sel.id },
      body: JSON.stringify({ type: 'character', characterId, password }),
    });
    const data = await res.json();
    if (data.needsSetup) { showSetupStep(data.characterId, data.characterName); return; }
    if (!res.ok) { errEl.textContent = data.error || 'Login failed.'; return; }
    _storeSession({ role: 'character', characterId: data.characterId, characterName: data.characterName, charPw: password });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

function showSetupStep(charId, charName) {
  _setupCharId = charId;
  document.getElementById('char-login-step').style.display = 'none';
  document.getElementById('char-setup-step').style.display = 'block';
  document.getElementById('setup-char-name').textContent = charName;
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
      headers: { 'Content-Type': 'application/json', 'X-Campaign-Id': _sel.id },
      body: JSON.stringify({ new_password: pw1 }),
    });
    if (!res.ok) { errEl.textContent = 'Failed to set password.'; return; }
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Campaign-Id': _sel.id },
      body: JSON.stringify({ type: 'character', characterId: _setupCharId, password: pw1 }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) { errEl.textContent = loginData.error || 'Login failed after setup.'; return; }
    _storeSession({ role: 'character', characterId: loginData.characterId, characterName: loginData.characterName, charPw: pw1 });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

async function loginDM() {
  const password = document.getElementById('dm-pw').value;
  const errEl = document.getElementById('dm-err');
  errEl.textContent = '';
  if (!password) { errEl.textContent = "Enter this campaign's DM password."; return; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Campaign-Id': _sel.id },
      body: JSON.stringify({ type: 'dm', password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Wrong password.'; return; }
    _storeSession({ role: 'dm', masterPw: password });
    location.replace(_nextUrl());
  } catch { errEl.textContent = 'Connection error.'; }
}

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function openNewCampaign() {
  for (const id of ['new-name', 'new-desc', 'new-dmpw', 'new-adminpw']) document.getElementById(id).value = '';
  document.getElementById('new-err').textContent = '';
  openModal('new-modal');
  setTimeout(() => document.getElementById('new-name').focus(), 30);
}

async function createCampaign() {
  const name = document.getElementById('new-name').value.trim();
  const description = document.getElementById('new-desc').value.trim();
  const dmPassword = document.getElementById('new-dmpw').value;
  const adminPw = document.getElementById('new-adminpw').value;
  const errEl = document.getElementById('new-err');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Enter a campaign name.'; return; }
  if (!dmPassword || dmPassword.length < 3) { errEl.textContent = 'DM password must be at least 3 characters.'; return; }
  if (!adminPw) { errEl.textContent = 'Enter the admin password.'; return; }

  const btn = document.getElementById('new-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': adminPw },
      body: JSON.stringify({ name, description, dmPassword }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Could not create the campaign.'; return; }
    closeModal('new-modal');
    await loadCampaigns();
    selectCampaign(data.id);
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

function openManage() {
  if (!_sel) return;
  document.getElementById('mg-auth').value = '';
  document.getElementById('mg-name').value = _sel.name || '';
  document.getElementById('mg-desc').value = _sel.description || '';
  document.getElementById('mg-newpw').value = '';
  document.getElementById('mg-cover').value = '';
  document.getElementById('mg-err').textContent = '';
  document.getElementById('mg-ok').textContent = '';
  openModal('manage-modal');
  setTimeout(() => document.getElementById('mg-auth').focus(), 30);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function saveCampaign() {
  const auth = document.getElementById('mg-auth').value;
  const errEl = document.getElementById('mg-err');
  const okEl  = document.getElementById('mg-ok');
  errEl.textContent = ''; okEl.textContent = '';
  if (!auth) { errEl.textContent = "Enter this campaign's DM password."; return; }

  const btn = document.getElementById('mg-btn');
  btn.disabled = true;
  const H = { 'Content-Type': 'application/json', 'X-Master-Password': auth, 'X-Campaign-Id': _sel.id };
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(_sel.id)}`, {
      method: 'PUT', headers: H,
      body: JSON.stringify({
        name: document.getElementById('mg-name').value.trim(),
        description: document.getElementById('mg-desc').value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Save failed.'; return; }

    const file = document.getElementById('mg-cover').files[0];
    if (file) {
      const coverRes = await fetch(`/api/campaigns/${encodeURIComponent(_sel.id)}/cover`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ dataUrl: await readFileAsDataUrl(file) }),
      });
      if (!coverRes.ok) {
        const e = await coverRes.json().catch(() => ({}));
        errEl.textContent = e.error || 'Cover upload failed.'; return;
      }
    }

    const newPw = document.getElementById('mg-newpw').value;
    if (newPw) {
      if (newPw.length < 3) { errEl.textContent = 'New password must be at least 3 characters.'; return; }
      const pwRes = await fetch(`/api/campaigns/${encodeURIComponent(_sel.id)}/dm-password`, {
        method: 'PUT', headers: H, body: JSON.stringify({ newPassword: newPw }),
      });
      if (!pwRes.ok) {
        const e = await pwRes.json().catch(() => ({}));
        errEl.textContent = e.error || 'Password change failed.'; return;
      }
    }

    okEl.textContent = 'Saved.';
    await loadCampaigns();
    await selectCampaign(_sel.id, { silent: true });
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

function openDelete() {
  document.getElementById('del-name').value = '';
  document.getElementById('del-adminpw').value = '';
  document.getElementById('del-err').textContent = '';
  closeModal('manage-modal');
  openModal('del-modal');
}

async function deleteCampaign() {
  const confirmName = document.getElementById('del-name').value;
  const adminPw = document.getElementById('del-adminpw').value;
  const errEl = document.getElementById('del-err');
  errEl.textContent = '';
  if (confirmName !== _sel.name) { errEl.textContent = 'The name does not match.'; return; }
  if (!adminPw) { errEl.textContent = 'Enter the admin password.'; return; }

  const btn = document.getElementById('del-btn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(_sel.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': adminPw },
      body: JSON.stringify({ confirmName }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Delete failed.'; return; }
    closeModal('del-modal');
    _sel = null;
    document.body.classList.remove('detail-open');
    document.getElementById('detail').innerHTML =
      '<div class="detail-empty"><div class="big">🗺️</div><div>Select a campaign to see its details and log in.</div></div>';
    await loadCampaigns();
  } catch { errEl.textContent = 'Connection error.'; }
  finally { btn.disabled = false; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
// The guard owns backdrop clicks and Escape for these three: it will not
// discard a part-filled form without asking.
for (const id of ['new-modal', 'manage-modal', 'del-modal']) {
  if (window.guardModal) guardModal(id, () => closeModal(id));
}
loadCampaigns();
