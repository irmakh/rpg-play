// ── Hidden maintenance dashboard ──────────────────────────────────────────────
// DM-password gated. Polls /api/maintenance/clients and shows every connected
// real-time client: identity (DM / character / anonymous), when they logged in,
// the page they're currently viewing, IP and connection details.

let _pw = null;            // DM master password, kept in memory only
let _pollTimer = null;
const POLL_MS = 4000;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
));

// ── Login gate ────────────────────────────────────────────────────────────────
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('gate-pw').value;
  const errEl = $('gate-err');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Enter a password.'; return; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dm', password: pw }),
    });
    if (!res.ok) { errEl.textContent = 'Wrong password.'; return; }
    _pw = pw;
    $('gate').style.display = 'none';
    $('panel').style.display = 'block';
    startPolling();
  } catch {
    errEl.textContent = 'Connection error.';
  }
});

$('btn-refresh').addEventListener('click', () => loadClients());
$('btn-logout').addEventListener('click', () => {
  stopPolling();
  _pw = null;
  $('panel').style.display = 'none';
  $('gate').style.display = 'flex';
  $('gate-pw').value = '';
  $('gate-pw').focus();
});

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  loadClients();
  _pollTimer = setInterval(loadClients, POLL_MS);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function loadClients() {
  if (!_pw) return;
  try {
    const res = await fetch('/api/maintenance/clients', { headers: { 'X-Master-Password': _pw } });
    if (res.status === 401) {   // password changed / invalid — bounce back to gate
      stopPolling(); _pw = null;
      $('panel').style.display = 'none';
      $('gate').style.display = 'flex';
      $('gate-err').textContent = 'Session expired — log in again.';
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

function render(data) {
  const { clients = [], now = Date.now(), count = 0 } = data;
  $('count-pill').textContent = count + ' connected';
  $('updated').textContent = 'updated ' + new Date(now).toLocaleTimeString();

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
    const loginRow = loggedIn
      ? `<div class="row"><span class="k">Logged in</span><span class="v" title="${esc(absTime(c.loginAt))}">${relTime(c.loginAt, now)}</span></div>`
      : '';
    return `
      <div class="client ${role}">
        <div class="who">
          <span class="badge ${role}">${badgeLabel}</span>
          <span class="name">${esc(name)}</span>
        </div>
        <div class="row"><span class="k">Current page</span><span class="v page-v">${esc(page)}</span></div>
        ${loginRow}
        <div class="row"><span class="k">Connected</span><span class="v" title="${esc(absTime(c.connectedAt))}">${relTime(c.connectedAt, now)}</span></div>
        <div class="row"><span class="k">IP address</span><span class="v ip-v">${esc(c.ip || '—')}</span></div>
        <div class="row"><span class="k">Transport</span><span class="v">${esc((c.transport || '').toUpperCase())}</span></div>
        ${c.userAgent ? `<div class="ua">${esc(c.userAgent)}</div>` : ''}
      </div>`;
  }).join('');
}
