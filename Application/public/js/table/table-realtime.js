// ── Real-time updates (connectRealtime in js/lib/realtime.js) ────────────────
function startSSE() {
  connectRealtime({
    table: (d) => {
      switch (d.action) {
        case 'map-updated':
        case 'state-updated':
          fetchAll(); break;
        case 'token-added':
          if (!tokens.find(t => t.id === d.token.id)) tokens.push(d.token);
          renderTokens(); renderHpTable(); break;
        case 'token-moved':
          patchToken(d.id, { x: d.x, y: d.y, movedFt: d.movedFt });
          renderTokens(); renderSidePanel(); renderHpTable(); break;
        case 'token-updated':
          replaceToken(d.token); renderTokens(); renderSidePanel(); renderHpTable();
          if (selectedTokenId === d.token.id) updateHpPanel(d.token);
          // Refresh side qroll if it was the active token (HP changed)
          if (d.token.id === getActiveTurnTokenId()) { _sideQrollTokenId = null; loadSideQroll(); }
          break;
        case 'token-removed':
          if (_dragPendingTimer && dragState?.tokenId === d.id) {
            clearTimeout(_dragPendingTimer); _dragPendingTimer = null;
          }
          if (dragState?.tokenId === d.id) {
            dragState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
          if (selectedTokenId === d.id) { selectedTokenId = null; closeHpPanel(); renderSidePanel(); }
          tokens = tokens.filter(t => t.id !== d.id); renderTokens(); renderHpTable(); break;
        case 'tokens-cleared':
          if (_dragPendingTimer) { clearTimeout(_dragPendingTimer); _dragPendingTimer = null; }
          dragState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          selectedTokenId = null; closeHpPanel(); renderSidePanel();
          tokens = []; renderTokens(); renderHpTable(); break;
        case 'fog-updated':
          applyFogRegions(d.fogRegions); break;
        case 'items-updated':
          applyHiddenItems(d.hiddenItems); break;
        case 'ping':
          renderPing(d.x, d.y, d.color); break;
      }
    },
    initiative: async (d) => {
      const prevCurrentId = initData.currentId;
      await fetchInitiative();
      // On turn advance or initiative start/end/clear, release manual view selection
      if (d?.action === 'next' || d?.action === 'start' || d?.action === 'end' || d?.action === 'clear') {
        _sideViewInitId = null;
      }
      // Only invalidate the side panel cache if the active turn actually changed
      if (initData.currentId !== prevCurrentId) _sideQrollTokenId = null;
      renderInitiativeTracker();
      updateInitiativeButton();
      renderTokens();
      renderSidePanel();
      renderHpTable();
      loadSideQroll();
      // Ping the newly active token's map position
      const activeTokId = getActiveTurnTokenId();
      const activeTok = activeTokId ? tokens.find(t => t.id === activeTokId) : null;
      if (activeTok) renderTurnPing(activeTok.x || 0, activeTok.y || 0);
    },
    characters: async (d) => {
      if (d.action !== 'updated') return;
      // If the changed character is linked to the active token, reload side panel data
      const activeTok = tokens.find(t => t.id === getActiveTurnTokenId());
      if (activeTok?.linkedId === d.id) {
        _sideQrollTokenId = null;
        loadSideQroll();
      }
    },
    chat: (entry) => {
      appendChatEntry(entry);
      scrollChatLog();
      if (!chatOpen) {
        chatUnread++;
        updateChatBadge();
      }
    },
    'chat-clear': () => {
      document.getElementById('chat-log').innerHTML = '';
    },
    'chat-delete': (d) => {
      const div = document.querySelector(`[data-entry-id="${CSS.escape(d.id)}"]`);
      if (div) div.remove();
    },
    drawing: (d) => {
      if (d.action === 'add') {
        if (!drawings.find(s => s.id === d.shape.id)) drawings.push(d.shape);
        renderDrawings();
      } else if (d.action === 'preview') {
        // Show another client's in-progress shape on the overlay canvas
        if (currentTool !== 'draw') renderDrawPreview(d.shape);
      } else if (d.action === 'remove') {
        drawings = drawings.filter(s => s.id !== d.id);
        renderDrawings();
      } else if (d.action === 'clear') {
        drawings = [];
        renderDrawings();
      }
    },
    'dice-roll': (d) => {
      if (_selfRollIds.has(d.rollId)) { _selfRollIds.delete(d.rollId); return; }
      showDiceAnimation(d.sides, d.dieResults || [d.dieResult], d.modifier, d.total, d.label, d.duration, d.usedIdx ?? -1);
    },
    monsters: (d) => {
      if (d.action === 'portrait-updated') {
        // Update local cache so the modal thumbnail is correct immediately
        const mon = _monsterList.find(m => m.id === d.id);
        if (mon) { if (!mon.data) mon.data = {}; mon.data.portrait = d.portrait; mon.data.portraitThumb = d.portraitThumb || null; }
        // If the add-token modal is open, refresh its monster tab
        const modal = document.getElementById('add-token-modal');
        if (modal && modal.style.display !== 'none') populateAddTokenModal(_charList);
      }
    },
  });
}

function patchToken(id, fields) {
  const tok = tokens.find(t => t.id === id);
  if (tok) Object.assign(tok, fields);
}
function replaceToken(newTok) {
  const idx = tokens.findIndex(t => t.id === newTok.id);
  if (idx >= 0) tokens[idx] = newTok;
  else tokens.push(newTok);
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchAll() {
  try {
    const res = await fetch('/api/table');
    if (!res.ok) return;
    const { state, tokens: tok } = await res.json();
    tableState = state;
    tokens = tok;
    const { w, h } = getCanvasSize();
    resizeCanvases(w, h);
    if (tableState.hasMap) {
      mapImg.src = '/api/table/map?' + Date.now();
      mapImg.style.display = '';
    } else {
      mapImg.src = '';
      mapImg.style.display = 'none';
    }
    applyFogRegions(state.fogRegions || []);
    applyHiddenItems(state.hiddenItems || []);
    renderGrid();
    renderFog();
    renderItems();
    renderDrawings();
    renderTokens();
    renderSidePanel();
    renderHpTable();
  } catch (err) { console.error(err); }
}

async function fetchInitiative() {
  try {
    const res = await fetch('/api/initiative');
    if (!res.ok) return;
    initData = await res.json();
  } catch {}
}
