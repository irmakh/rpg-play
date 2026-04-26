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

// ── Page init ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  masterPw = sessionStorage.getItem('tableMasterPw') || '';
  applyDMControls();
  setTool('select'); // initialize pointer-events on overlay canvas

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

  // Load chat history in background — non-blocking so map and SSE start immediately
  fetch('/api/chat')
    .then(r => r.ok ? r.json() : [])
    .then(entries => { entries.forEach(appendChatEntry); scrollChatLog(); })
    .catch(() => {});
});
