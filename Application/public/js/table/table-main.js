// ── DM Tools Modal ────────────────────────────────────────────────────────────
function openDMToolsModal() {
  const m = document.getElementById('dm-tools-modal');
  if (m) { m.style.display = 'flex'; renderHpTable(); }
}
function closeDMToolsModal() {
  const m = document.getElementById('dm-tools-modal');
  if (m) m.style.display = 'none';
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// The classic HUD has been retired — the modern HUD is the only theme now.
function initTheme() {
  document.body.dataset.theme = 'modern';
  localStorage.setItem('tableTheme', 'modern'); // migrate any stored 'classic'
}

// ── Dice animation on/off ─────────────────────────────────────────────────────
function initDiceAnim() {
  const on = localStorage.getItem('diceAnimEnabled') !== '0'; // default on
  window.diceAnimEnabled = on;
  _updateDiceAnimBtn(on);
}
function toggleDiceAnim() {
  const next = !window.diceAnimEnabled;
  window.diceAnimEnabled = next;
  localStorage.setItem('diceAnimEnabled', next ? '1' : '0');
  _updateDiceAnimBtn(next);
}
function _updateDiceAnimBtn(on) {
  const btn = document.getElementById('btn-dice-anim');
  if (!btn) return;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
}

// ── Side panel ────────────────────────────────────────────────────────────────
function renderSidePanel() {
  const activeTokId = getActiveTurnTokenId();
  const activeTok = tokens.find(t => t.id === activeTokId);
  const movEl = document.getElementById('movement-display');
  const infoEl = document.getElementById('active-token-info');
  if (!initData.currentId) {
    if (movEl) movEl.textContent = '∞ (free)';
    const selTok = selectedTokenId ? tokens.find(t => t.id === selectedTokenId) : null;
    if (infoEl) infoEl.innerHTML = selTok ? `<strong>${esc(tokDisplayName(selTok))}</strong>` : 'No initiative';
  } else if (activeTok) {
    const remaining = (activeTok.speed || 30) - (activeTok.movedFt || 0);
    if (movEl) movEl.textContent = `${remaining} / ${activeTok.speed || 30} ft`;
    if (infoEl) infoEl.innerHTML = `<strong>${esc(tokDisplayName(activeTok))}</strong>`;
  } else {
    if (movEl) movEl.textContent = '— ft';
    if (infoEl) infoEl.textContent = 'None';
  }
}

// ── Zoom float position sync (call after panel resize or open/close) ──────────
function updateZoomFloat() {
  const zf = document.getElementById('zoom-float');
  const rp = document.getElementById('side-panel');
  if (!zf || !rp) return;
  const isModern = document.body.dataset.theme === 'modern';
  const panelHidden = rp.style.display === 'none';
  const panelClosed = isModern && !rp.classList.contains('rp-open');
  zf.style.right = (panelHidden || panelClosed ? 12 : rp.offsetWidth + 12) + 'px';
}

// ── Resizable panels ──────────────────────────────────────────────────────────
function _isModernTheme() { return document.body.dataset.theme === 'modern'; }

function initResizablePanels() {
  // Left panel
  const lp = document.getElementById('left-panel');
  const rhL = document.getElementById('rh-left');
  if (lp && rhL) {
    const saved = localStorage.getItem('tbl_lpW');
    if (saved) {
      document.documentElement.style.setProperty('--lp-width', saved);
      if (!_isModernTheme()) lp.style.width = saved;
    }
    // Clear any stale inline style so modern CSS width:0 auto-hide can work
    if (_isModernTheme()) lp.style.width = '';
    rhL.addEventListener('mousedown', e => {
      e.preventDefault();
      rhL.classList.add('rh-active');
      const x0 = e.clientX, w0 = lp.offsetWidth;
      function onMove(e) {
        const w = Math.max(120, Math.min(500, w0 + e.clientX - x0)) + 'px';
        document.documentElement.style.setProperty('--lp-width', w);
        if (!_isModernTheme()) lp.style.width = w;
      }
      function onUp() {
        rhL.classList.remove('rh-active');
        localStorage.setItem('tbl_lpW', lp.offsetWidth + 'px');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  // Right panel
  const rp = document.getElementById('side-panel');
  const rhR = document.getElementById('rh-right');
  if (rp && rhR) {
    const saved = localStorage.getItem('tbl_rpW');
    if (saved) {
      document.documentElement.style.setProperty('--rp-width', saved);
      if (!_isModernTheme()) rp.style.width = saved;
    }
    // Clear any stale inline style so modern CSS width:0 auto-hide can work
    if (_isModernTheme()) rp.style.width = '';
    rhR.addEventListener('mousedown', e => {
      e.preventDefault();
      rhR.classList.add('rh-active');
      const x0 = e.clientX, w0 = rp.offsetWidth;
      function onMove(e) {
        const w = Math.max(120, Math.min(520, w0 - (e.clientX - x0))) + 'px';
        document.documentElement.style.setProperty('--rp-width', w);
        if (!_isModernTheme()) rp.style.width = w;
        updateZoomFloat();
      }
      function onUp() {
        rhR.classList.remove('rh-active');
        localStorage.setItem('tbl_rpW', rp.offsetWidth + 'px');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Keep zoom float in sync when rp-open class changes (token selection)
    new MutationObserver(updateZoomFloat).observe(rp, { attributes: true, attributeFilter: ['class','style'] });
  }
  // Chat bar
  const chatLog = document.querySelector('#chat-bar .chat-log');
  const rhC = document.getElementById('rh-chat');
  if (chatLog && rhC) {
    const saved = localStorage.getItem('tbl_chatH');
    if (saved) chatLog.style.height = saved;
    rhC.addEventListener('mousedown', e => {
      e.preventDefault();
      rhC.classList.add('rh-active');
      const y0 = e.clientY, h0 = chatLog.offsetHeight;
      function onMove(e) { chatLog.style.height = Math.max(60, Math.min(700, h0 - (e.clientY - y0))) + 'px'; }
      function onUp() {
        rhC.classList.remove('rh-active');
        localStorage.setItem('tbl_chatH', chatLog.style.height);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ── Modal backdrop click-to-close ─────────────────────────────────────────────
function initModalBackdrops() {
  [
    ['dm-tools-modal',     closeDMToolsModal],
    ['add-token-modal',    closeAddTokenModal],
    ['dice-roller-modal',  closeDiceRollerModal],
    ['monster-info-modal', closeMonsterInfoTableModal],
  ].forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => { if (e.target === el) fn(); });
  });
}

// ── Draggable modals ──────────────────────────────────────────────────────────
function initDraggableModals() {
  function setup(modalId, getBox, getHandle) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const box    = getBox(modal);
    const handle = box && (getHandle ? getHandle(box) : box.querySelector('.modal-drag-handle'));
    if (box && handle) makeDraggable(box, handle);
  }
  setup('dm-tools-modal',     m => m.firstElementChild,            null);
  setup('dice-roller-modal',  m => m.firstElementChild,            null);
  setup('monster-info-modal', m => m.firstElementChild,            null);
  setup('music-modal',        m => m.firstElementChild,            null);
  setup('add-token-modal',    m => m.querySelector('.modal-box'),  b => b.querySelector('.ct'));
}

// ── Page init ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  _loadSession();
  initTheme();
  initDiceAnim();
  applyDMControls();
  setTool('move'); // initialize pointer-events on overlay canvas (move tool also selects)

  // Open init panel by default
  const initBody = document.getElementById('init-body-wrap');
  if (initBody) { initBody.classList.add('open'); initPanelOpen = true; }
  const initChev = document.getElementById('init-chevron');
  if (initChev) initChev.textContent = '▼';

  try {
    const [tableRes, initRes, charsRes] = await Promise.all([
      fetch('/api/table'),
      fetch('/api/initiative'),
      fetch('/api/characters')
    ]);

    if (tableRes.ok) {
      const { state, tokens: tok } = await tableRes.json();
      tableState = state; tokens = tok;
    }
    if (initRes.ok) initData = await initRes.json();
    if (charsRes.ok) {
      _charList = await charsRes.json();
    }

    await populateAddTokenModal(_charList);
  } catch (err) { console.error('Init error:', err); }

  const { w, h } = getCanvasSize();
  resizeCanvases(w, h);

  if (tableState.hasMap) {
    mapImg.src = '/api/table/map?' + Date.now();
    mapImg.style.display = '';
  }

  applyFogRegions(tableState.fogRegions || []);
  applyHiddenItems(tableState.hiddenItems || []);
  renderGrid();
  renderFog();
  renderItems();
  renderTokens();
  renderHpTable();
  renderInitiativeTracker();
  updateInitiativeButton();
  renderSidePanel();
  loadSideQroll();

  fetchDrawings();
  startSSE();
  initMusicPlayer();
  initChatDragDrop();
  initResizablePanels();
  initDraggableModals();
  initModalBackdrops();

  // Load chat history in background — non-blocking so map and SSE start immediately
  fetch('/api/chat', { headers: isDM() ? { 'X-Master-Password': masterPw } : {} })
    .then(r => r.ok ? r.json() : [])
    .then(entries => { entries.forEach(appendChatEntry); scrollChatLog(); })
    .catch(() => {});
});
