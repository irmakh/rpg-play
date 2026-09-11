// ── Hidden maintenance dashboard ──────────────────────────────────────────────
// Super-admin gated. Polls /api/maintenance/clients and shows every connected
// real-time client: identity (DM / character / anonymous), when they logged in,
// the page they're currently viewing, IP and connection details — plus the
// login activity of every campaign (/api/maintenance/auth-events).

let _pw = null;            // super-admin SESSION TOKEN (never the password), memory only
let _pollTimer = null;
let _pollTick = 0;
let _serverVersion = null; // current deployed frontend version
let _outdatedCount = 0;
const POLL_MS = 4000;
const EVENTS_EVERY = 5;    // login activity refreshes every 5th poll (20 s)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
));

// ── Login gate ────────────────────────────────────────────────────────────────
// The admin password (MASTER_PASSWORD) plus the maths captcha buys a session.
// The captcha's answer box sits inside the form, so Enter submits it natively.
const _cap = AuthUI.captcha($('gate-cap'));

$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('gate-pw').value;
  const errEl = $('gate-err');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Enter a password.'; return; }
  const r = await AuthUI.adminLogin(pw, _cap);
  if (!r.ok) { errEl.textContent = r.message; return; }
  _pw = r.data.token;
  $('gate-pw').value = '';
  $('gate').style.display = 'none';
  $('panel').style.display = 'block';
  startPolling();
});

function _toGate(message) {
  stopPolling();
  _pw = null;
  $('panel').style.display = 'none';
  $('gate').style.display = 'flex';
  $('gate-err').textContent = message || '';
  $('gate-pw').value = '';
  _cap.reload();
  $('gate-pw').focus();
}

$('btn-refresh').addEventListener('click', () => { loadClients(); loadAuthEvents(); });
$('btn-logout').addEventListener('click', () => {
  AuthUI.logout(_pw);   // end it on the server, not just here
  _toGate('');
});

$('btn-reload-all').addEventListener('click', () => {
  if (confirm('Force EVERY connected client to reload now?')) sendReload('all');
});
$('btn-reload-outdated').addEventListener('click', () => {
  if (_outdatedCount === 0) return;
  if (confirm(`Reload ${_outdatedCount} client(s) running an old version?`)) sendReload('outdated');
});

async function sendReload(mode) {
  if (!_pw) return;
  try {
    const res = await fetch('/api/maintenance/reload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': _pw },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) { alert('Reload request failed.'); return; }
    // Give clients a moment to drop & reconnect, then refresh the list.
    setTimeout(loadClients, 2500);
  } catch { alert('Reload request failed — network error.'); }
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  loadClients();
  loadAuthEvents();
  _pollTick = 0;
  _pollTimer = setInterval(() => {
    loadClients();
    if (++_pollTick % EVENTS_EVERY === 0) loadAuthEvents();
  }, POLL_MS);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function loadClients() {
  if (!_pw) return;
  try {
    const res = await fetch('/api/maintenance/clients', { headers: { 'X-Master-Password': _pw } });
    if (res.status === 401) {   // session expired or revoked — bounce back to gate
      _toGate('Session expired — log in again.');
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    render(data);
  } catch { /* transient network error — keep last view */ }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function relTime(ts, now) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60)   return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60)   return m + 'm ago';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24)   return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return d + 'd ago';
}
function absTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}

// ── Login activity ────────────────────────────────────────────────────────────
const EVENT_LABELS = {
  'login':                ['Logged in', 'ok'],
  'login-as-dm':          ['DM opened a character', 'ok'],
  'logout':               ['Logged out', ''],
  'login-fail':           ['Wrong password', 'bad'],
  'captcha-fail':         ['Wrong captcha answer', 'bad'],
  'locked':               ['Locked out', 'bad'],
  'setup-started':        ['Asked to choose a password', ''],
  'password-set':         ['Password set', 'ok'],
  'password-changed':     ['Password changed', 'ok'],
  'password-removed':     ['Password removed', ''],
  'password-change-fail': ['Wrong current password', 'bad'],
};

async function loadAuthEvents() {
  if (!_pw) return;
  try {
    const res = await fetch('/api/maintenance/auth-events?limit=200', { headers: { 'X-Master-Password': _pw } });
    if (!res.ok) return;
    renderAuthEvents((await res.json()).events || []);
  } catch { /* keep the last view */ }
}

function renderAuthEvents(events) {
  const host = $('auth-events');
  if (!events.length) { host.innerHTML = '<div class="muted" style="padding:14px">No login activity recorded yet.</div>'; return; }
  const now = Date.now();
  const who = e => e.role === 'admin' ? 'Admin'
    : e.role === 'dm' ? 'DM'
    : e.role === 'stories' ? 'Stories page'
    : (e.charName || e.charId || 'Character');
  host.innerHTML = `<table class="events">
    <thead><tr><th>When</th><th>What</th><th>Who</th><th>Campaign</th><th>IP address</th></tr></thead>
    <tbody>${events.map(e => {
      const [label, tone] = EVENT_LABELS[e.kind] || [e.kind, ''];
      return `<tr>
        <td title="${esc(absTime(e.ts))}">${relTime(e.ts, now)}</td>
        <td class="${tone ? 'ev-' + tone : ''}">${esc(label)}</td>
        <td>${esc(who(e))}</td>
        <td>${esc(e.campaignName || (e.campaignId ? e.campaignId.slice(0, 8) : '—'))}</td>
        <td class="ip-v">${esc(e.ip || '—')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function render(data) {
  const { clients = [], now = Date.now(), count = 0, serverVersion = null } = data;
  _serverVersion = serverVersion;
  $('count-pill').textContent = count + ' connected';
  $('ver-pill').textContent = serverVersion != null ? ('server v' + serverVersion) : '';
  $('updated').textContent = 'updated ' + new Date(now).toLocaleTimeString();

  const sv = serverVersion != null ? String(serverVersion) : null;
  _outdatedCount = clients.filter(c => c.ver && sv && c.ver !== sv).length;
  const outBtn = $('btn-reload-outdated');
  outBtn.disabled = _outdatedCount === 0;
  outBtn.textContent = _outdatedCount > 0 ? `Reload outdated (${_outdatedCount})` : 'Reload outdated';

  const cards = $('cards');
  const empty = $('empty');
  if (!clients.length) {
    cards.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  cards.innerHTML = clients.map(c => {
    const role = c.role === 'dm' ? 'dm' : (c.role === 'character' ? 'character' : 'none');
    const loggedIn = role !== 'none';
    const name = role === 'dm' ? 'Dungeon Master'
               : role === 'character' ? (c.charName || c.charId || 'Character')
               : 'Anonymous';
    const badgeLabel = role === 'dm' ? 'DM' : role === 'character' ? 'Player' : 'Not logged in';
    const page = c.page || '(unknown)';
    const stale = c.ver && sv && c.ver !== sv;
    const verStr = c.ver ? ('v' + c.ver + (stale ? ' (outdated)' : '')) : 'unknown';
    const loginRow = loggedIn
      ? `<div class="row"><span class="k">Logged in</span><span class="v" title="${esc(absTime(c.loginAt))}">${relTime(c.loginAt, now)}</span></div>`
      : '';
    return `
      <div class="client ${role}">
        <div class="who">
          <span class="badge ${role}">${badgeLabel}</span>
          <span class="name">${esc(name)}</span>
        </div>
        <div class="row"><span class="k">Campaign</span><span class="v">${esc(c.campaignName || '—')}</span></div>
        <div class="row"><span class="k">Current page</span><span class="v page-v">${esc(page)}</span></div>
        <div class="row"><span class="k">Version</span><span class="v ${stale ? 'ver-stale' : 'ver-ok'}">${esc(verStr)}</span></div>
        ${loginRow}
        <div class="row"><span class="k">Connected</span><span class="v" title="${esc(absTime(c.connectedAt))}">${relTime(c.connectedAt, now)}</span></div>
        <div class="row"><span class="k">IP address</span><span class="v ip-v">${esc(c.ip || '—')}</span></div>
        <div class="row"><span class="k">Transport</span><span class="v">${esc((c.transport || '').toUpperCase())}</span></div>
        ${c.userAgent ? `<div class="ua">${esc(c.userAgent)}</div>` : ''}
      </div>`;
  }).join('');
}
