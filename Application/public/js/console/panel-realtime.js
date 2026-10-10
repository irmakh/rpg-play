// Written by Irmak Hakman — 2026-10-10 23:39
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: live updates, the link to the map screen, start-up ───────────
// Two streams feed the panel:
//  1. The campaign's live events (connectRealtime in js/lib/realtime.js) - the
//     same events every page gets: tokens, initiative, chat, music.
//  2. The console relay - messages between THIS person's two screens only,
//     such as "a token was tapped on the map".

// Redraw whatever on the current tab shows token data.
function sTokensChanged() {
  if (sCurrentTab === 'turn')  sRenderInitiative();
  if (sCurrentTab === 'table') { sRenderDmHpList(); sRenderTableInit(); }
}

async function sReloadTable() {
  try {
    const r = await fetch('/api/table', { headers: sAuthHeaders() });
    if (!r.ok) return;
    const { tokens, state } = await r.json();
    sTokens      = tokens || [];
    sFogRegions  = state?.fogRegions  || [];
    sHiddenItems = state?.hiddenItems || [];
    // Keep the selection pointing at the fresh copy of its token, or drop it.
    if (sSelectedToken) {
      const upd = sTokens.find(t => t.id === sSelectedToken.id);
      if (upd) { sSelectedToken = upd; if (sCurrentTab === 'token') sRenderHpPanel(upd); }
      else sClearSelection();
    }
    sTokensChanged();
    if (sCurrentTab === 'table') { sRenderFogSection(); sRenderItemsSection(); }
  } catch {}
}

function sStartSSE() {
  connectRealtime({
    table: d => {
      if (d.action === 'token-added') {
        if (!sTokens.find(t => t.id === d.token.id)) sTokens.push(d.token);
        sSelectOwnTokenQuietly();
        sTokensChanged();
      } else if (d.action === 'token-moved') {
        const t = sTokens.find(t => t.id === d.id);
        if (t) Object.assign(t, { x: d.x, y: d.y, movedFt: d.movedFt });
      } else if (d.action === 'token-updated') {
        const idx = sTokens.findIndex(t => t.id === d.token.id);
        if (idx >= 0) sTokens[idx] = d.token; else sTokens.push(d.token);
        if (sSelectedToken?.id === d.token.id) {
          sSelectedToken = d.token;
          if (sCurrentTab === 'token') sRenderHpPanel(d.token);
        }
        sTokensChanged();
      } else if (d.action === 'token-removed') {
        sTokens = sTokens.filter(t => t.id !== d.id);
        if (sSelectedToken?.id === d.id) sClearSelection();
        sTokensChanged();
      } else if (d.action === 'tokens-cleared') {
        sTokens = [];
        sClearSelection();
        sTokensChanged();
      } else if (d.action === 'map-updated' || d.action === 'state-updated') {
        sReloadTable();
      } else if (d.action === 'fog-updated') {
        sFogRegions = d.fogRegions || [];
        if (sCurrentTab === 'table') sRenderFogSection();
      } else if (d.action === 'items-updated') {
        sHiddenItems = d.hiddenItems || [];
        if (sCurrentTab === 'table') sRenderItemsSection();
      }
    },
    initiative: async () => {
      try { const r = await fetch('/api/initiative', { headers: sAuthHeaders() }); if (r.ok) sInitData = await r.json(); } catch {}
      sInitChanged();
    },
    chat: entry => {
      appendChatEntry(entry);
      sChatArrived();
    },
    // A private message arrives as an id only; chat-pm.js asks the server whether
    // it is ours and renders it if so.
    'chat-pm': d => {
      if (typeof onPrivateChatSignal !== 'function') return;
      onPrivateChatSignal(d && d.id).then(shown => { if (shown) sChatArrived(); });
    },
    'chat-clear':  () => { const log = sEl('chat-log'); if (log) log.innerHTML = ''; },
    'chat-delete': d  => { const div = document.querySelector(`[data-entry-id="${CSS.escape(d.id)}"]`); if (div) div.remove(); },
    sound: d => { handleSoundEvent(d); },          // js/table/table-music.js
    notification: p => { handleNotification(p); },  // js/lib/notifications.js
    handouts: () => { sLoadHandouts(); },
    // A character sheet was saved somewhere (the sheet page, the table screen).
    // If it is the one showing here, read it again.
    characters: d => {
      if (d && d.id && sSelectedToken && sSelectedToken.type !== 'monster' && sSelectedToken.linkedId === d.id) sReloadSheet();
    },
  });
}

// ── Console relay: this person's map screen ──────────────────────────────────
function _sStartConsoleSSE() {
  if (_sConsoleEs) _sConsoleEs.close();
  _sConsoleEs = new EventSource(_sConsoleUrl('/api/console/events'));
  // Say "ready" only once the stream is open. Posting it straight away races
  // the EventSource request: the map screen could answer with its snapshot
  // before we are registered to receive it. onopen also fires on a reconnect,
  // so the state is re-synced after a dropped connection.
  _sConsoleEs.onopen = () => {
    _sConsolePost({ type: 'SECONDARY_READY' });
  };
  _sConsoleEs.onmessage = ev => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    const { type } = d;
    if (type === 'STATE_SNAPSHOT') {
      sTokens   = d.tokens   || [];
      sInitData = d.initData || { entries: [], currentId: null };
      sTokensChanged();
      if (sCurrentTab !== 'turn') sRenderCmd();
    }
    if (type === 'TOKEN_SELECTED') {
      const tok = d.token;
      // A player may not open a monster that is not theirs.
      if (!tok || (!sIsDM() && tok.type === 'monster' && !sIsMyToken(tok))) return;
      sSelectTokenObj(tok, true);
    }
    if (type === 'TOKEN_CLEARED') sClearSelection();
    // A gamepad button pressed while the map screen had the pad.
    if (type === 'PAD' && typeof ConsolePad !== 'undefined') ConsolePad.remote(d.action);
  };
}

// A player's own token becomes the selection when nothing else is selected,
// without switching tab or marking it as news.
function sSelectOwnTokenQuietly() {
  if (sSelectedToken) return;
  const own = sMyOwnToken();
  if (!own) return;
  sSelectTokenObj(own, false);
  sMark('token', false);
}

// ── Start-up ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  if (!sLoadSession()) return;   // the login form is showing; the page reloads after it
  sApplyRole();

  try {
    const [tableRes, initRes, charsRes] = await Promise.all([
      // Our credential on both: hidden tokens and pre-combat monsters are the DM's (v237).
      fetch('/api/table', { headers: sAuthHeaders() }),
      fetch('/api/initiative', { headers: sAuthHeaders() }),
      fetch('/api/characters'),
    ]);
    if (tableRes.ok) {
      const { tokens, state } = await tableRes.json();
      sTokens      = tokens || [];
      sFogRegions  = state?.fogRegions  || [];
      sHiddenItems = state?.hiddenItems || [];
    }
    if (initRes.ok)  sInitData = await initRes.json();
    if (charsRes.ok) sCharList = await charsRes.json();
  } catch {}

  // A player starts with their own token selected, so the Token tab is never
  // empty for them. It does not switch tab.
  const own = sMyOwnToken();
  sSelectOwnTokenQuietly();

  sShowTab('turn');
  if (sIsDM()) sLoadPrepMaps();
  sLoadHandouts();
  initMusicPlayer();                                 // js/table/table-music.js

  // Send our own credential: the server decides which private messages belong in
  // this history, and a caller who sends nothing gets only the public ones.
  fetch('/api/chat', { headers: sAuthHeaders() }).then(r => (r.ok ? r.json() : []))
    .then(entries => {
      entries.forEach(appendChatEntry);
      const log = sEl('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }).catch(() => {});

  if (typeof initChatRecipients === 'function') {
    initChatRecipients('s-chat-to', 's-chat-input').then(() => bindChatRecipientPicker('s-chat-to', 's-chat-input'));
  }

  sStartSSE();
  _sStartConsoleSSE();
  sPadInit();

  window.addEventListener('beforeunload', () => {
    navigator.sendBeacon(_sConsoleUrl('/api/console/event'),
      new Blob([JSON.stringify({ type: 'SECONDARY_CLOSED' })], { type: 'application/json' }));
    if (_sConsoleEs) _sConsoleEs.close();
  });
});
