// ── Shared real-time transport ────────────────────────────────────────────────
// Handles both WebSocket (localdb) and SSE (instantdb) connections.
// Call with a handlers map: { eventName: fn(data) }

// The frontend version this page loaded — read from the ?v=N the server injected
// onto our own asset URLs (same trick as table-popout.js _assetVer). Lets the
// maintenance page flag clients running stale code.
function _clientVer() {
  try {
    const els = document.querySelectorAll('script[src], link[href]');
    for (const el of els) {
      const m = (el.src || el.getAttribute('href') || '').match(/[?&]v=(\d+)/);
      if (m) return m[1];
    }
  } catch {}
  return '';
}

// Identity + current page, attached as query params to the real-time URL so the
// server can list connected clients on the maintenance page. Passwords are never
// included — only role, character id/name, login time, current path and version.
function _realtimeParams() {
  let role = 'none', charId = '', charName = '', loginAt = '';
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    if (s && s.role) {
      role = s.role;
      if (s.role === 'character') { charId = s.characterId || ''; charName = s.characterName || ''; }
      if (s.loginAt) loginAt = String(s.loginAt);
    }
  } catch {}
  return new URLSearchParams({
    page: location.pathname, role, charId, charName, loginAt,
    ver: _clientVer(),
    // Which campaign this connection is watching. The server only delivers a
    // campaign's events to its own clients, so a connection with no campaign
    // receives nothing. The cookie is also sent on the WS upgrade, but passing
    // it explicitly keeps the two paths reading the same value.
    campaign: campaignFromCookie(),
  }).toString();
}

// ── Campaign context (shared by every page that loads this lib) ───────────────

/** The campaign id currently selected in this browser, or '' if none. */
function campaignFromCookie() {
  const m = /(?:^|;\s*)campaign=([^;]*)/.exec(document.cookie || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Sends the visitor back to the campaign picker, remembering where they were. */
function goToCampaignPicker() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/?next=${next}`);
}

/**
 * Fills any #campaign-badge element with the active campaign's name and makes
 * it a shortcut back to the picker. Pages opt in just by having the element —
 * no per-page wiring.
 */
/**
 * Drops a session that belongs to a different campaign than the one selected.
 *
 * Sessions carry the campaign they were created in. After switching campaigns
 * the stored role and password are meaningless here — worse, a DM password
 * would keep being sent to a campaign it has no authority over. Clear it and
 * send the visitor back to pick a login.
 */
function enforceCampaignSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    const cookie = campaignFromCookie();
    if (!s || !s.campaignId || !cookie || s.campaignId === cookie) return;
    _dropStoredSession();
    goToCampaignPicker();
  } catch {}
}
document.addEventListener('DOMContentLoaded', enforceCampaignSession);

async function initCampaignBadge() {
  const el = document.getElementById('campaign-badge');
  if (!el) return;
  try {
    const res = await fetch('/api/campaign/current');
    if (!res.ok) return;
    const c = await res.json();
    el.textContent = c.name;
    el.title = 'Switch campaign';
    el.style.display = '';
    el.onclick = () => { location.href = '/'; };
  } catch {}
}
document.addEventListener('DOMContentLoaded', initCampaignBadge);

// ── Login sessions ────────────────────────────────────────────────────────────
// Since v226 a login returns a SESSION TOKEN ('rpgs_…'), stored where the typed
// password used to be (rpgSession.masterPw / .charPw, dmMasterPw, tableMasterPw).
// The server accepts nothing else in the credential headers.

function _dropStoredSession() {
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
}

/** Back to the login page, returning here afterwards. */
function goToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login.html?next=${next}`);
}

const _isToken = v => typeof v === 'string' && v.startsWith('rpgs_');

/**
 * Ends this tab's session on the server as well as in the browser. Every
 * logout button calls this before clearing storage, so a copied token dies too.
 */
function revokeStoredSession() {
  let token = '';
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    token = (s && (s.role === 'dm' ? s.masterPw : s.charPw)) || sessionStorage.getItem('dmMasterPw') || '';
  } catch {}
  if (!_isToken(token)) return;
  try {
    fetch('/api/auth/logout', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  } catch {}
}

// A tab opened before v226 still holds the PLAIN PASSWORD. The server no longer
// accepts it, so drop it now — before this page's own scripts read it — and log
// in again, rather than letting the page load half-working first.
(function dropPasswordSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    const legacy = sessionStorage.getItem('dmMasterPw') || sessionStorage.getItem('tableMasterPw');
    const token = s ? (s.role === 'dm' ? s.masterPw : s.charPw) : '';
    const stale = (s && s.role && !_isToken(token)) || (legacy && !_isToken(legacy));
    if (!stale) return;
    _dropStoredSession();
    if (s && s.role) goToLogin();
  } catch {}
})();

// Two answers are handled once here rather than at all ~276 fetch() call sites:
//   409 NO_CAMPAIGN      the campaign cookie was cleared, expired, or points at a
//                        campaign that has since been deleted -> the picker
//   401 SESSION_EXPIRED  the stored session is no longer valid (expired, logged
//                        out elsewhere, password changed) -> the login page
(function installCampaignGuard() {
  if (typeof window === 'undefined' || !window.fetch || window.__campaignGuardInstalled) return;
  window.__campaignGuardInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  let redirecting = false;
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if ((res.status === 409 || res.status === 401) && !redirecting) {
      // Only these two codes redirect — every other 409/401 belongs to its caller.
      try {
        const body = await res.clone().json();
        if (res.status === 409 && body && body.code === 'NO_CAMPAIGN') {
          redirecting = true; goToCampaignPicker();
        } else if (res.status === 401 && body && body.code === 'SESSION_EXPIRED') {
          redirecting = true; _dropStoredSession(); goToLogin();
        }
      } catch {}
    }
    return res;
  };
})();

// DM-triggered remote reload (from the maintenance page). Reloads to pick up the
// latest deployed version. mode 'outdated' only reloads clients whose loaded
// version differs from the server's current one (avoids reloading up-to-date
// clients); mode 'all' always reloads.
let _forceReloading = false;
function _onForceReload(d) {
  if (_forceReloading) return;
  d = d || {};
  if (d.mode === 'outdated' && d.version != null && String(_clientVer()) === String(d.version)) return;
  _forceReloading = true;
  try { location.reload(); } catch {}
}

async function connectRealtime(handlers) {
  let provider = 'instantdb', wsUrl = null;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    provider = cfg.dbProvider;
    wsUrl = cfg.wsUrl || null;
  } catch {}
  if (provider === 'localdb') {
    function connect() {
      const base = wsUrl || `ws://${location.host}/ws`;
      const ws = new WebSocket(base + (base.includes('?') ? '&' : '?') + _realtimeParams());
      ws.onmessage = e => {
        const { event, data } = JSON.parse(e.data);
        if (event === 'force-reload') return _onForceReload(data);   // handled for every page
        if (handlers[event]) handlers[event](data);
      };
      ws.onclose = () => setTimeout(connect, 3000);
    }
    connect();
  } else {
    const es = new EventSource('/api/events?' + _realtimeParams());
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, e => fn(JSON.parse(e.data)));
    }
    es.addEventListener('force-reload', e => _onForceReload(JSON.parse(e.data)));   // handled for every page
    es.onerror = () => {};
  }
}
