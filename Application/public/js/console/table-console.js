// ── Console Mode Bridge (Screen 1 — Map) ─────────────────────────────────────
// Loaded only by table-console.html. Opens the secondary info window and keeps
// it in sync via server-side SSE relay so both screens can run in different
// browsers/devices on the same LAN.

let _secondaryWin = null;
let _consoleEs    = null;

function _consolePost(msg) {
  fetch('/api/console/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

function _consoleStartSSE() {
  if (_consoleEs) _consoleEs.close();
  _consoleEs = new EventSource('/api/console/events');
  _consoleEs.onmessage = ev => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    const { type } = d;
    if (type === 'SECONDARY_READY') {
      _setDot('online');
      _consolePost({
        type: 'STATE_SNAPSHOT',
        tokens: JSON.parse(JSON.stringify(tokens || [])),
        initData: JSON.parse(JSON.stringify(initData || {})),
      });
      if (selectedTokenId) {
        const tok = (tokens || []).find(t => t.id === selectedTokenId);
        if (tok) _consolePost({ type: 'TOKEN_SELECTED', token: JSON.parse(JSON.stringify(tok)) });
      }
    }
    if (type === 'SECONDARY_CLOSED') _setDot('offline');
    if (type === 'OPEN_ADD_TOKEN') openAddTokenModal?.();
  };
  _consoleEs.onerror = () => _setDot('offline');
}

function consoleOpenSecondary() {
  if (_secondaryWin && !_secondaryWin.closed) { _secondaryWin.focus(); return; }
  _secondaryWin = window.open('/console/table-secondary.html', 'rpg-secondary', 'width=620,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes');
  _setDot('offline');
}

function _setDot(state) {
  const dot = document.getElementById('console-secondary-dot');
  if (dot) dot.className = state;
}

// Show/hide D-pad based on whether current user can move the selected token
function _consoleUpdateArrows() {
  const wrap = document.getElementById('console-arrow-btns');
  if (!wrap) return;
  const tok = (tokens || []).find(t => t.id === selectedTokenId);
  const canMove = tok && isMyToken(tok) && (!initData.currentId || tok.id === getActiveTurnTokenId());
  wrap.style.display = canMove ? 'flex' : 'none';
}

// Wrap openHpPanel to relay the selected token to the secondary
const _prevOpenHpPanel = openHpPanel;
window.openHpPanel = function(tok) {
  _prevOpenHpPanel(tok);
  _consolePost({ type: 'TOKEN_SELECTED', token: JSON.parse(JSON.stringify(tok)) });
  _consoleUpdateArrows();
};

const _prevCloseHpPanel = closeHpPanel;
window.closeHpPanel = function() {
  _prevCloseHpPanel();
  _consolePost({ type: 'TOKEN_CLEARED' });
  _consoleUpdateArrows();
};

// Keep arrows in sync when initiative changes (turn advance hides/shows arrow for non-active tokens)
const _prevRenderTokens = renderTokens;
window.renderTokens = function() {
  _prevRenderTokens();
  _consoleUpdateArrows();
};

// Detect secondary window closed via polling (no close event from window.open)
setInterval(() => {
  if (_secondaryWin && _secondaryWin.closed) { _secondaryWin = null; _setDot('offline'); }
}, 2000);

// On logout: broadcast to other PWA apps, clear session, reload
window.logout = function() {
  navigator.sendBeacon('/api/console/event', new Blob([JSON.stringify({ type: 'SESSION_LOGOUT' })], { type: 'application/json' }));
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
  location.reload();
};

window.addEventListener('load', () => {
  _consoleStartSSE();
}, { once: true });
