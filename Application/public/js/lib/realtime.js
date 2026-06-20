// ── Shared real-time transport ────────────────────────────────────────────────
// Handles both WebSocket (localdb) and SSE (instantdb) connections.
// Call with a handlers map: { eventName: fn(data) }

// Identity + current page, attached as query params to the real-time URL so the
// server can list connected clients on the maintenance page. Passwords are never
// included — only role, character id/name, login time and the current path.
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
  return new URLSearchParams({ page: location.pathname, role, charId, charName, loginAt }).toString();
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
    es.onerror = () => {};
  }
}
