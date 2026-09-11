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

$('btn-refresh').addEventListener('click', () => { loadClients(); loadBlocked(); loadAuthEvents(); });
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
  loadBlocked();
  loadAuthEvents();
  _pollTick = 0;
  _pollTimer = setInterval(() => {
    loadClients();
    loadBlocked();
    // Only page 1 refreshes by itself: on an older page new events would push
    // the rows along while they are being read.
    if (++_pollTick % EVENTS_EVERY === 0 && _authPage === 1) loadAuthEvents();
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

// ── Blocked addresses ─────────────────────────────────────────────────────────
// Every live login lock (lib/login-guard.js), with Unblock. The countdown ticks
// locally between polls; the server's clock is the reference, so a skewed
// client clock does not show the wrong time left.
let _clockOffset = 0;   // Date.now() - server now
let _blockedTicker = null;

async function loadBlocked() {
  if (!_pw) return;
  try {
    const res = await fetch('/api/maintenance/blocked', { headers: { 'X-Master-Password': _pw } });
    if (!res.ok) return;
    const data = await res.json();
    _clockOffset = Date.now() - (data.now || Date.now());
    renderBlocked(data.locks || []);
  } catch { /* keep the last view */ }
}

function waitLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s <= 0) return 'unlocked';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** "Chrome 153 · Windows" from a user agent; the full string is on hover. */
function shortBrowser(ua) {
  if (!ua) return '—';
  const b = /(Edg|OPR|Firefox|Chrome|Safari)\/(\d+)/.exec(ua);
  const os = /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/.exec(ua);
  const name = b ? ({ Edg: 'Edge', OPR: 'Opera' }[b[1]] || b[1]) + ' ' + b[2] : 'Browser';
  return os ? `${name} · ${os[1].replace('Mac OS X', 'macOS')}` : name;
}

function renderBlocked(locks) {
  const host = $('blocked');
  $('blocked-pill').textContent = locks.length + ' blocked';
  if (!locks.length) { host.innerHTML = '<div class="muted" style="padding:14px">No addresses are blocked.</div>'; return; }

  // "Unblock address" once per address that has more than one lock.
  const perIp = {};
  for (const l of locks) perIp[l.ip] = (perIp[l.ip] || 0) + 1;
  const offered = new Set();

  host.innerHTML = `<table class="events">
    <thead><tr><th>Address</th><th>Blocked</th><th>Unlocks in</th><th>Times locked</th><th>Wrong attempts</th><th>Last browser</th><th></th></tr></thead>
    <tbody>${locks.map(l => {
      const attempts = `First ${absTime(l.firstFailAt)} · last ${absTime(l.lastFailAt)}`;
      const whole = l.kind === 'ip';
      const btns = [`<button data-ip="${esc(l.ip)}" data-account="${esc(whole ? '' : l.account)}" data-label="${esc(whole ? 'the whole address ' + l.ip : l.scope)}">Unblock</button>`];
      if (!whole && perIp[l.ip] > 1 && !offered.has(l.ip)) {
        offered.add(l.ip);
        btns.push(`<button data-ip="${esc(l.ip)}" data-account="" data-label="${esc('every lock on ' + l.ip)}">Unblock address</button>`);
      }
      return `<tr>
        <td class="ip-v">${esc(l.ip)}</td>
        <td class="${whole ? 'ev-bad' : ''}">${esc(l.scope)}</td>
        <td class="countdown" data-until="${Number(l.lockedUntil) || 0}">${waitLeft(l.lockedUntil - (Date.now() - _clockOffset))}</td>
        <td>${Number(l.timesLocked) || 0}</td>
        <td title="${esc(attempts)}">${Number(l.failures) || 0}</td>
        <td class="ua-v" title="${esc(l.lastUserAgent || '')}">${esc(shortBrowser(l.lastUserAgent))}</td>
        <td class="actions">${btns.join('')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;

  if (!_blockedTicker) {
    _blockedTicker = setInterval(() => {
      const serverNow = Date.now() - _clockOffset;
      for (const cell of document.querySelectorAll('#blocked .countdown')) {
        cell.textContent = waitLeft(Number(cell.dataset.until) - serverNow);
      }
    }, 1000);
  }
}

// One listener for every Unblock button: the values travel in data-*
// attributes (escaped), never inside an inline handler.
$('blocked').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-ip]');
  if (!btn || !_pw) return;
  const { ip, account, label } = btn.dataset;
  if (!confirm(`Unblock ${label}?\n\nThey can try to log in again straight away.`)) return;
  btn.disabled = true;
  try {
    const res = await fetch('/api/maintenance/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': _pw },
      body: JSON.stringify(account ? { ip, account } : { ip }),
    });
    if (res.status === 401) { _toGate('Session expired — log in again.'); return; }
    if (!res.ok) { alert('Unblock failed.'); btn.disabled = false; return; }
    await loadBlocked();
    loadAuthEvents();
  } catch { alert('Unblock failed — network error.'); btn.disabled = false; }
});

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
  'unblocked':            ['Unblocked by admin', 'ok'],
};

// Paged on the server (GET /api/maintenance/auth-events?page=&pageSize=).
const PAGE_SIZE_KEY = 'maintAuthPageSize';
const PAGE_SIZES = [25, 50, 100];
let _authPage = 1;
let _authPages = 1;
let _authPageSize = (() => {
  try { const n = Number(localStorage.getItem(PAGE_SIZE_KEY)); return PAGE_SIZES.includes(n) ? n : 50; } catch { return 50; }
})();
$('auth-page-size').value = String(_authPageSize);

async function loadAuthEvents(page = _authPage) {
  if (!_pw) return;
  try {
    const res = await fetch(`/api/maintenance/auth-events?page=${page}&pageSize=${_authPageSize}`,
      { headers: { 'X-Master-Password': _pw } });
    if (!res.ok) return;
    const data = await res.json();
    _authPage = data.page || 1;
    _authPages = data.pages || 1;
    renderAuthEvents(data.events || []);
    renderPager(data);
  } catch { /* keep the last view */ }
}

function renderPager({ page = 1, pages = 1, total = 0 }) {
  const pager = $('auth-pager');
  pager.hidden = false;
  $('auth-page-info').textContent = `Page ${page} of ${pages} · ${total} event${total === 1 ? '' : 's'}`;
  pager.querySelector('[data-page="first"]').disabled = page <= 1;
  pager.querySelector('[data-page="prev"]').disabled  = page <= 1;
  pager.querySelector('[data-page="next"]').disabled  = page >= pages;
  $('auth-paused').hidden = page <= 1;
}

$('auth-pager').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-page]');
  if (!btn || btn.disabled) return;
  const to = { first: 1, prev: _authPage - 1, next: _authPage + 1 }[btn.dataset.page];
  if (to) loadAuthEvents(Math.min(_authPages, Math.max(1, to)));
});

$('auth-page-size').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  if (!PAGE_SIZES.includes(n)) return;
  _authPageSize = n;
  try { localStorage.setItem(PAGE_SIZE_KEY, String(n)); } catch {}
  loadAuthEvents(1);
});

function renderAuthEvents(events) {
  const host = $('auth-events');
  if (!events.length) { host.innerHTML = '<div class="muted" style="padding:14px">No login activity recorded yet.</div>'; return; }
  const now = Date.now();
  const who = e => e.kind === 'unblocked' ? (e.charName || 'Whole address')
    : e.role === 'admin' ? 'Admin'
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
