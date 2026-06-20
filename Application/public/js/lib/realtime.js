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
  return new URLSearchParams({ page: location.pathname, role, charId, charName, loginAt, ver: _clientVer() }).toString();
}

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
