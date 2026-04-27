// ── Shared real-time transport ────────────────────────────────────────────────
// Handles both WebSocket (localdb) and SSE (instantdb) connections.
// Call with a handlers map: { eventName: fn(data) }
async function connectRealtime(handlers) {
  let provider = 'instantdb', wsUrl = null;
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    provider = cfg.dbProvider;
    wsUrl = cfg.wsUrl || null;
  } catch {}
  if (provider === 'localdb') {
    function connect() {
      const ws = new WebSocket(wsUrl || `ws://${location.host}/ws`);
      ws.onmessage = e => {
        const { event, data } = JSON.parse(e.data);
        if (handlers[event]) handlers[event](data);
      };
      ws.onclose = () => setTimeout(connect, 3000);
    }
    connect();
  } else {
    const es = new EventSource('/api/events');
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, e => fn(JSON.parse(e.data)));
    }
    es.onerror = () => {};
  }
}
