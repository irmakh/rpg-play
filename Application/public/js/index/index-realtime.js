// ── Real-time updates (connectRealtime in js/lib/realtime.js) ─────────────────
window.addEventListener('load', function startRealtime() {
  connectRealtime({
    characters: async (payload) => {
      loadCharacterList(true);
      if (currentCharId && payload.id === currentCharId && !_suppressSSEReload) {
        try {
          const headers = {};
          if (charPasswords[currentCharId]) headers['X-Character-Password'] = charPasswords[currentCharId];
          const res = await fetch(`/api/characters/${currentCharId}`, { headers });
          if (res.ok) {
            const char = await res.json();
            applyData(char.data);
            document.getElementById('char-title').textContent = char.name || 'Character Sheet';
            renderShopWallet();
          }
        } catch {}
      }
    },
    shop: () => {
      loadShopTab();
    },
    loot: () => {
      loadLootTab();
      syncLootDescVisibility();
    },
    initiative: async () => {
      try {
        const res = await fetch('/api/initiative');
        if (!res.ok) return;
        initData = await res.json();
        renderInitiativeTracker(true);
      } catch {}
    },
    chat: (entry) => {
      appendChatEntry(entry);
      scrollChatLog();
      if (!chatOpen) {
        chatUnread++;
        const badge = document.getElementById('chat-badge');
        if (badge) { badge.textContent = chatUnread > 9 ? '9+' : String(chatUnread); badge.style.display = ''; }
      }
    },
    'chat-clear': () => {
      document.getElementById('chat-log').innerHTML = '';
    },
    'dice-roll': (d) => {
      if (_selfRollIds.has(d.rollId)) { _selfRollIds.delete(d.rollId); return; }
      showDiceAnimation(d.sides, d.dieResults || [d.dieResult], d.modifier, d.total, d.label, d.duration, d.usedIdx ?? -1);
    },
    'calendar-updated': () => {
      pcalOnServerUpdate();
    },
  });
});
