// ── HP Panel ──────────────────────────────────────────────────────────────────
async function openHpPanel(tok) {
  // Characters may only open the panel for their own token
  if (!isDM() && !isMyToken(tok)) { closeHpPanel(); return; }
  selectedTokenId = tok.id;
  _hpPanelAc = tok.ac != null ? tok.ac : null;

  // Show right panel token details
  const details = document.getElementById('rp-token-details');
  const placeholder = document.getElementById('rp-placeholder');
  if (details) details.style.display = '';
  if (placeholder) placeholder.style.display = 'none';
  const sp = document.getElementById('side-panel');
  if (sp) { sp.style.display = ''; sp.classList.add('rp-open'); sp.scrollTop = 0; }

  _refreshHpPanel(tok);

  // Trigger character/monster sheet load
  _sideQrollTokenId = null;
  loadSideQroll();

  if (tok.linkedId) {
    try {
      if (tok.type === 'monster' && tok.ac == null) {
        // Fallback for old monster tokens placed before AC was stored on the token (DM only)
        if (isDM()) {
          const r = await fetch(`/api/monsters/${tok.linkedId}`, { headers: { 'X-Master-Password': masterPw } });
          if (r.ok) {
            const m = await r.json();
            const ac = [].concat((m.data || {}).ac || [])[0];
            _hpPanelAc = typeof ac === 'number' ? ac : (ac && ac.ac != null ? ac.ac : null);
          }
        }
      } else if (tok.type !== 'monster') {
        // Characters/NPCs: always fetch real-time via public qroll endpoint (AC can change)
        const r = await fetch(`/api/characters/${tok.linkedId}/qroll`);
        if (r.ok) {
          const c = await r.json();
          const ac = (c.data || {}).ac;
          _hpPanelAc = ac != null && ac !== '' ? (parseInt(ac) || null) : null;
          // Cache AC on the token so initiative panel can display it
          const liveTok = tokens.find(t => t.id === tok.id);
          if (liveTok && _hpPanelAc != null) { liveTok.ac = _hpPanelAc; renderInitiativeTracker(); }
        }
      }
    } catch {}
  }
  // Only update if the same token is still selected
  if (selectedTokenId === tok.id) {
    const acEl = document.getElementById('hp-ac-display');
    if (acEl) acEl.textContent = _hpPanelAc != null ? _hpPanelAc : '—';
  }
}
function closeHpPanel() {
  const details = document.getElementById('rp-token-details');
  const placeholder = document.getElementById('rp-placeholder');
  if (details) details.style.display = 'none';
  if (placeholder) placeholder.style.display = '';
  _hpPanelAc = null;
  const sp = document.getElementById('side-panel');
  if (sp) sp.classList.remove('rp-open');
}
function _refreshHpPanel(tok) {
  const hpPct = (tok.hpMax || 0) > 0 ? Math.max(0, Math.min(1, (tok.hpCurrent || 0) / tok.hpMax)) : 0;
  // Prefer the token's live AC (kept current by SSE token-updated) over the cache
  // fetched on panel open, so AC changes on the character sheet refresh in real time.
  if (tok.ac != null) _hpPanelAc = tok.ac;
  const acEl = document.getElementById('hp-ac-display');
  if (acEl) acEl.textContent = _hpPanelAc != null ? _hpPanelAc : '—';

  // Portrait in right panel header
  const rpImg = document.getElementById('rp-portrait-img');
  const rpPh  = document.getElementById('rp-portrait-ph');
  const portrait = tok.portraitThumb || tok.portrait || '';
  if (rpImg && rpPh) {
    if (portrait) {
      rpImg.src = portrait; rpImg.style.display = ''; rpPh.style.display = 'none';
    } else {
      rpImg.style.display = 'none'; rpPh.style.display = '';
      rpPh.textContent = tok.type === 'monster' ? '🐉' : '⚔';
    }
  }

  // Speed stat
  const speedVal = document.getElementById('rp-speed-val');
  if (speedVal) speedVal.textContent = tok.speed || 30;

  const hpNameEl = document.getElementById('hp-panel-name');
  if (isDM() && tok.type === 'monster' && tok.label) {
    const baseName = tok.name.slice(0, tok.name.length - tok.label.length).trimEnd() || tok.name;
    hpNameEl.innerHTML = esc(baseName) + ` <span style="color:var(--txd);font-weight:normal;font-size:11px">[${esc(tok.label)}]</span>`;
  } else {
    hpNameEl.textContent = tokDisplayName(tok);
  }
  const canEdit = isDM() || isMyToken(tok);
  const delBtn = document.getElementById('hp-del-btn');
  if (delBtn) delBtn.style.display = isDM() ? '' : 'none';
  const editLabelBtn = document.getElementById('hp-edit-label-btn');
  if (editLabelBtn) editLabelBtn.style.display = isDM() ? '' : 'none';
  // HP change inputs — visible only to editors
  const hpEditArea = document.getElementById('hp-edit-area');
  if (hpEditArea) hpEditArea.style.display = canEdit ? '' : 'none';
  const labelRow = document.getElementById('hp-label-row');
  if (labelRow) labelRow.style.display = 'none';
  const curEl = document.getElementById('hp-cur-display');
  curEl.textContent = tok.hpCurrent || 0;
  curEl.style.color = hpBarColor(hpPct);
  document.getElementById('hp-max-display').textContent = tok.hpMax || 0;
  const temp = tok.hpTemp || 0;
  const tempWrap = document.getElementById('hp-temp-display-wrap');
  tempWrap.style.display = temp > 0 ? '' : 'none';
  document.getElementById('hp-temp-display').textContent = temp;
  document.getElementById('hp-temp-input').value = temp;
  // Visibility toggle — DM only
  const visRow = document.getElementById('hp-vis-row');
  const visBtn = document.getElementById('hp-vis-btn');
  if (visRow && visBtn) {
    if (isDM()) {
      visRow.style.display = '';
      const isVisible = tok.visible !== false;
      visBtn.textContent = isVisible ? '👁 Visible to players' : '🚫 Hidden from players';
      visBtn.style.background = isVisible ? 'var(--ok)' : 'var(--err)';
      visBtn.style.color = '#fff';
      visBtn.style.border = 'none';
    } else {
      visRow.style.display = 'none';
    }
  }
  // Conditions grid — all editors
  const condGrid = document.getElementById('hp-conditions-grid');
  if (condGrid) {
    const active = parseConditions(tok.conditions);
    condGrid.innerHTML = '';
    for (const c of CONDITIONS) {
      const btn = document.createElement('button');
      btn.className = 'cond-btn' + (active.includes(c) ? ' active' : '');
      btn.textContent = COND_ABBREV[c];
      btn.title = c;
      btn.onclick = () => toggleCondition(c);
      condGrid.appendChild(btn);
    }
  }
  // Roll Initiative — DM only, all token types
  const initRow = document.getElementById('hp-init-row');
  const initBtn = document.getElementById('hp-init-btn');
  if (initRow && initBtn) {
    if (isDM()) {
      initRow.style.display = '';
      const hasEntry = !!initData.entries.find(e => e.id === tok.initiativeId);
      if (tok.type === 'monster') {
        initBtn.textContent = '🎲 Roll Monster Initiative';
      } else {
        initBtn.textContent = hasEntry ? '🎲 Reroll Initiative' : '🎲 Roll Initiative';
      }
    } else {
      initRow.style.display = 'none';
    }
  }
  // Token portrait upload — DM only, monster tokens
  const portraitRow = document.getElementById('hp-portrait-row');
  const portraitPreview = document.getElementById('hp-portrait-preview');
  const portraitResetBtn = document.getElementById('hp-portrait-reset-btn');
  if (portraitRow) {
    if (isDM() && tok.type === 'monster') {
      portraitRow.style.display = '';
      const img = tok.portraitThumb || tok.portrait || '';
      if (img && portraitPreview) { portraitPreview.src = img; portraitPreview.style.display = ''; }
      else if (portraitPreview) { portraitPreview.src = ''; portraitPreview.style.display = 'none'; }
      if (portraitResetBtn) portraitResetBtn.style.display = tok.customPortrait ? '' : 'none';
    } else {
      portraitRow.style.display = 'none';
    }
  }
  // Token assignment — DM only
  const assignRow = document.getElementById('hp-assign-row');
  const assignSel = document.getElementById('hp-assign-sel');
  const unassignBtn = document.getElementById('hp-unassign-btn');
  if (assignRow && assignSel) {
    if (isDM()) {
      assignRow.style.display = '';
      const currentAssign = tok.assignedCharId || (tok.type !== 'monster' ? tok.linkedId : '');
      assignSel.innerHTML = '<option value="">(Unassigned)</option>' +
        _charList.map(c => `<option value="${c.id}"${currentAssign === c.id ? ' selected' : ''}>${c.name}</option>`).join('');
      if (unassignBtn) unassignBtn.style.display = tok.assignedCharId ? '' : 'none';
    } else {
      assignRow.style.display = 'none';
    }
  }
}

function openTokenPortraitUpload() {
  document.getElementById('hp-portrait-input')?.click();
}

function onTokenPortraitChosen(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl = e.target.result;
    const preview = document.getElementById('hp-portrait-preview');
    if (preview) { preview.src = dataUrl; preview.style.display = ''; }
    // Also update header portrait
    const rpImg = document.getElementById('rp-portrait-img');
    const rpPh  = document.getElementById('rp-portrait-ph');
    if (rpImg) { rpImg.src = dataUrl; rpImg.style.display = ''; }
    if (rpPh) rpPh.style.display = 'none';
    try {
      const res = await fetch(`/api/table/tokens/${tok.id}/portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ dataUrl })
      });
      if (!res.ok) { showToast('Portrait upload failed.', true); return; }
      const data = await res.json();
      patchToken(tok.id, { portrait: data.portrait, portraitThumb: data.portraitThumb, customPortrait: 1 });
      renderTokens();
      const resetBtn = document.getElementById('hp-portrait-reset-btn');
      if (resetBtn) resetBtn.style.display = '';
    } catch { showToast('Connection error.', true); }
  };
  reader.readAsDataURL(file);
}

async function removeTokenCustomPortrait() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  try {
    const res = await fetch(`/api/table/tokens/${tok.id}/portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ dataUrl: '' })
    });
    if (!res.ok) { showToast('Failed to reset portrait.', true); return; }
    const data = await res.json();
    patchToken(tok.id, { portrait: data.portrait, portraitThumb: data.portraitThumb, customPortrait: 0 });
    renderTokens();
    const newPortrait = data.portraitThumb || data.portrait || '';
    const preview = document.getElementById('hp-portrait-preview');
    if (preview) {
      if (newPortrait) { preview.src = newPortrait; preview.style.display = ''; }
      else { preview.src = ''; preview.style.display = 'none'; }
    }
    // Also update header portrait
    const rpImg = document.getElementById('rp-portrait-img');
    const rpPh  = document.getElementById('rp-portrait-ph');
    if (rpImg && rpPh) {
      if (newPortrait) { rpImg.src = newPortrait; rpImg.style.display = ''; rpPh.style.display = 'none'; }
      else { rpImg.style.display = 'none'; rpPh.style.display = ''; rpPh.textContent = '🐉'; }
    }
    const resetBtn = document.getElementById('hp-portrait-reset-btn');
    if (resetBtn) resetBtn.style.display = 'none';
  } catch { showToast('Connection error.', true); }
}

async function toggleTokenVisibility() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  await _putHp({ visible: tok.visible === false });
}

function openEditLabel() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  const input = document.getElementById('hp-label-input');
  if (input) input.value = tok.label || '';
  const row = document.getElementById('hp-label-row');
  if (row) row.style.display = '';
  setTimeout(() => input?.focus(), 30);
}

function cancelEditLabel() {
  const row = document.getElementById('hp-label-row');
  if (row) row.style.display = 'none';
}

async function saveEditLabel() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  const newLabel = (document.getElementById('hp-label-input')?.value || '').trim();
  if (!newLabel) return;
  const baseName = tok.label ? tok.name.slice(0, tok.name.length - tok.label.length).trimEnd() : tok.name;
  const newName = baseName ? `${baseName} ${newLabel}` : newLabel;
  try {
    const res = await fetch(`/api/table/tokens/${tok.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({ name: newName, label: newLabel }),
    });
    if (!res.ok) return showToast('Failed to update identifier.', true);
    patchToken(tok.id, { name: newName, label: newLabel });
    cancelEditLabel();
    _refreshHpPanel({ ...tok, name: newName, label: newLabel });
    renderTokens();
    _sideQrollTokenId = null;
    loadSideQroll();
  } catch { showToast('Connection error.', true); }
}

function rollTokenInitiative() {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok || !isDM()) return;
  if (tok.type === 'monster') {
    openGroupInitModal(tok, null);
  } else {
    _startCharInitRoll(tok);
  }
}

function rollMonsterInitiativeFromPanel() {
  if (!isDM()) return;
  const panelTok = _sideQrollTokenId ? tokens.find(t => t.id === _sideQrollTokenId) : null;
  if (!panelTok || panelTok.type !== 'monster') return;
  _startMonsterInitRoll(panelTok);
}

function _startMonsterInitRoll(tok) {
  const initBonus = _groupInitDexMod(tok);
  const existingEntry = initData.entries.find(e => e.id === tok.initiativeId);
  const tokId = tok.id, tokName = tok.name, tokLinkedId = tok.linkedId, tokInitId = tok.initiativeId;
  rollPending = {
    label: 'Initiative',
    modifier: initBonus,
    dmOnlyChat: true,
    skipDiceBroadcast: true,
    afterRoll: async (total) => {
      try {
        if (existingEntry) {
          const res = await fetch(`/api/initiative/entries/${tokInitId}/roll`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
            body: JSON.stringify({ roll: total })
          });
          if (!res.ok) return showToast('Failed to update initiative.', true);
        } else {
          const res = await fetch('/api/initiative/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
            body: JSON.stringify({ name: tokName, roll: total, monsterId: tokLinkedId || '' })
          });
          if (!res.ok) return showToast('Failed to add initiative entry.', true);
          const data = await res.json();
          if (data.id) {
            await fetch(`/api/table/tokens/${tokId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
              body: JSON.stringify({ initiativeId: data.id })
            });
            patchToken(tokId, { initiativeId: data.id });
          }
        }
        const updatedTok = tokens.find(t => t.id === tokId);
        if (updatedTok && selectedTokenId === tokId) _refreshHpPanel(updatedTok);
      } catch { showToast('Connection error.', true); }
    }
  };
  confirmRoll(diceMode); // item 2: persistent dice mode, no modal
}

// Roll initiative for a player/NPC character token (not a monster).
// Always POSTs charId + name: the server upserts by charId (one entry per character)
// and re-links the map token so the entry shows the correct portrait / HP / AC.
function _startCharInitRoll(tok) {
  const tokId = tok.id, tokCharId = tok.linkedId || '';
  const d = qrollData && _sideQrollTokenId === tokId ? qrollData : {};
  const initBonus = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  rollPending = {
    label: 'Initiative',
    modifier: initBonus,
    dmOnlyChat: true,
    skipDiceBroadcast: true,
    afterRoll: async (total) => {
      try {
        const res = await fetch('/api/initiative/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ name: tok.name, roll: total, charId: tokCharId })
        });
        if (!res.ok) return showToast('Failed to roll initiative.', true);
        const updatedTok = tokens.find(t => t.id === tokId);
        if (updatedTok && selectedTokenId === tokId) _refreshHpPanel(updatedTok);
      } catch { showToast('Connection error.', true); }
    }
  };
  confirmRoll(diceMode); // item 2: persistent dice mode, no modal
}

let _groupInitTok = null;
let _groupInitTokenIds = [];
let _groupInitMode = 'merged';
let _groupInitRollType = 'normal';

function _rollD20(rollType) {
  const a = Math.ceil(Math.random() * 20);
  if (rollType === 'normal') return a;
  const b = Math.ceil(Math.random() * 20);
  return rollType === 'adv' ? Math.max(a, b) : Math.min(a, b);
}

function _groupInitDexMod(tok) {
  if (!tok || !tok.linkedId) return 0;
  const mon = _monsterList.find(m => m.id === tok.linkedId);
  if (!mon) return 0;
  const d = mon.data || {};
  const dexMod = d.dex ? Math.floor((parseInt(d.dex) - 10) / 2) : 0;
  let bonus = dexMod;
  if (d.initiative && d.initiative.proficiency) bonus += getMonsterProfBonus(d.cr);
  if (d.initBonus) bonus += d.initBonus;
  return bonus;
}

function setGroupInitMode(mode) {
  _groupInitMode = mode;
  _updateGroupInitUI();
}

function setGroupInitRollType(type) {
  _groupInitRollType = type;
  _updateGroupInitUI();
}

function _updateGroupInitUI() {
  for (const m of ['merged', 'individual']) {
    const btn = document.getElementById(`group-init-btn-${m}`);
    if (!btn) continue;
    const active = _groupInitMode === m;
    btn.style.background = active ? 'var(--ac)' : '';
    btn.style.color = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--ac)' : '';
  }
  for (const t of ['normal', 'adv', 'dis']) {
    const btn = document.getElementById(`group-init-btn-${t}`);
    if (!btn) continue;
    const active = _groupInitRollType === t;
    btn.style.background = active ? 'var(--ac)' : '';
    btn.style.color = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--ac)' : '';
  }
}

function openGroupInitModal(tok, forcedTokenIds) {
  if (!isDM()) return;
  let targetIds;
  if (forcedTokenIds != null) {
    targetIds = [...forcedTokenIds];
  } else if (tok && tok.linkedId) {
    targetIds = tokens.filter(t => t.linkedId === tok.linkedId && t.type === 'monster').map(t => t.id);
  } else {
    targetIds = tok ? [tok.id] : [];
  }
  if (!targetIds.length) return;

  _groupInitTok = tok || tokens.find(t => t.id === targetIds[0]);
  _groupInitTokenIds = targetIds;
  _groupInitMode = 'merged';
  _groupInitRollType = 'normal';

  const desc = document.getElementById('group-init-desc');
  if (desc) {
    if (forcedTokenIds != null) {
      desc.textContent = `${targetIds.length} monster${targetIds.length !== 1 ? 's' : ''} selected.`;
    } else if (tok) {
      const baseName = tok.label ? tok.name.slice(0, tok.name.length - tok.label.length).trimEnd() : tok.name;
      desc.textContent = targetIds.length === 1
        ? `Rolling for ${baseName}.`
        : `${targetIds.length} ${baseName} on the map.`;
    }
  }

  const modeRow = document.getElementById('group-init-mode-row');
  if (modeRow) modeRow.style.display = targetIds.length > 1 ? '' : 'none';

  _updateGroupInitUI();
  document.getElementById('group-init-modal').style.display = 'flex';
}

function rollBulkInitiative() {
  if (!isDM() || bulkTokenIds.size === 0) return;
  const monsterToks = [...bulkTokenIds]
    .map(id => tokens.find(t => t.id === id))
    .filter(t => t && t.type === 'monster');
  if (monsterToks.length === 0) { showToast('No monster tokens selected.', true); return; }
  openGroupInitModal(monsterToks[0], monsterToks.map(t => t.id));
}

function closeMonsterGroupInitModal() {
  document.getElementById('group-init-modal').style.display = 'none';
  _groupInitTok = null;
  _groupInitTokenIds = [];
}

async function confirmGroupInitRoll() {
  const mode = _groupInitMode;
  const rollType = _groupInitRollType;
  const tokenIds = [..._groupInitTokenIds];
  closeMonsterGroupInitModal();
  if (!isDM()) return;

  const targetToks = tokenIds.map(id => tokens.find(t => t.id === id)).filter(Boolean);
  if (!targetToks.length) return;

  if (mode === 'merged') {
    // One shared d20 + reference token's dex mod → same total for all
    const refTok = _groupInitTok || targetToks[0];
    const d20 = _rollD20(rollType);
    const roll = d20 + _groupInitDexMod(refTok);
    for (const tok of targetToks) await _applyMonsterInitRoll(tok, roll);
    showToast(`Initiative ${roll} set for all ${targetToks.length} tokens.`);
  } else {
    // Individual: separate d20 + each token's own dex mod
    for (const tok of targetToks) {
      const d20 = _rollD20(rollType);
      await _applyMonsterInitRoll(tok, d20 + _groupInitDexMod(tok));
    }
    showToast(`Individual initiative rolled for ${targetToks.length} tokens.`);
  }

  const selTok = tokens.find(t => t.id === selectedTokenId);
  if (selTok && tokenIds.includes(selectedTokenId)) _refreshHpPanel(selTok);
}

async function _applyMonsterInitRoll(tok, roll) {
  const existingEntry = initData.entries.find(e => e.id === tok.initiativeId);
  try {
    if (existingEntry) {
      await fetch(`/api/initiative/entries/${tok.initiativeId}/roll`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ roll })
      });
    } else {
      const res = await fetch('/api/initiative/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ name: tok.name, roll, monsterId: tok.linkedId || '' })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.id) {
        await fetch(`/api/table/tokens/${tok.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ initiativeId: data.id })
        });
        patchToken(tok.id, { initiativeId: data.id });
      }
    }
  } catch {}
}

function updateHpPanel(tok) {
  if (selectedTokenId !== tok.id) return;
  _refreshHpPanel(tok);
}

function _putHp(fields) {
  // Optimistic update — immediate
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (tok) {
    patchToken(selectedTokenId, fields);
    _refreshHpPanel({ ...tok, ...fields });
    renderHpTable();
    renderSidePanel();
  }
  // Network — queued (capture id now; selectedTokenId may change before queue runs)
  const id = selectedTokenId;
  _tokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(fields)
      });
    } catch {}
  });
}

function toggleCondition(name) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const active = parseConditions(tok.conditions);
  const next = active.includes(name) ? active.filter(c => c !== name) : [...active, name];
  const condStr = JSON.stringify(next);
  // Optimistic update — immediate
  patchToken(selectedTokenId, { conditions: condStr });
  _refreshHpPanel({ ...tok, conditions: condStr });
  renderTokens();
  // Network — queued
  const id = selectedTokenId;
  _tokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ conditions: condStr })
      });
    } catch {}
  });
}

async function saveTokenAssignment() {
  if (!isDM()) return;
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const newAssignedCharId = document.getElementById('hp-assign-sel')?.value || '';
  try {
    const res = await fetch(`/api/table/tokens/${tok.id}`, {
      method: 'PUT',
      headers: dmHeaders(),
      body: JSON.stringify({ assignedCharId: newAssignedCharId }),
    });
    if (!res.ok) { showToast('Failed to assign token.', true); return; }
    patchToken(tok.id, { assignedCharId: newAssignedCharId });
    _refreshHpPanel({ ...tok, assignedCharId: newAssignedCharId });
    renderHpTable();
    renderTokens();
  } catch { showToast('Connection error.', true); }
}

async function unassignToken() {
  if (!isDM()) return;
  const sel = document.getElementById('hp-assign-sel');
  if (sel) sel.value = '';
  await saveTokenAssignment();
}

function applyHpChange(mode) {
  const tok = tokens.find(t => t.id === selectedTokenId);
  if (!tok) return;
  const amount = Math.max(0, parseInt(document.getElementById('hp-amount').value) || 0);
  if (amount === 0) return;
  if (mode === 'dmg') {
    // Damage absorbs temp HP first
    let remaining = amount;
    const newTemp = Math.max(0, (tok.hpTemp || 0) - remaining);
    remaining = Math.max(0, remaining - (tok.hpTemp || 0));
    const newHp = Math.max(0, (tok.hpCurrent || 0) - remaining);
    _putHp({ hpCurrent: newHp, hpTemp: newTemp });
  } else {
    const newHp = Math.min(tok.hpMax || 0, (tok.hpCurrent || 0) + amount);
    _putHp({ hpCurrent: newHp });
  }
}
function quickDmg(n) {
  document.getElementById('hp-amount').value = n;
  applyHpChange('dmg');
}
function quickHeal(n) {
  document.getElementById('hp-amount').value = n;
  applyHpChange('heal');
}
async function applyTempHp() {
  const val = Math.max(0, parseInt(document.getElementById('hp-temp-input').value) || 0);
  _putHp({ hpTemp: val });
}

// Enter key on amount field triggers damage by default
document.getElementById('hp-amount')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') applyHpChange('dmg');
});

// ── HP tracker ────────────────────────────────────────────────────────────────
function renderHpTable() {
  const list = document.getElementById('hp-tracker-list');
  if (!list) return;
  const visible = tokens.filter(t => {
    if (t.visible === false && !isDM()) return false;
    if (!isDM()) {
      // Show only player tokens (character/NPC tokens or assigned monsters)
      if (!isPlayerToken(t)) return false;
    }
    return true;
  });
  if (visible.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:var(--txd)">No tokens on map.</div>';
    return;
  }
  const activeTokId = getActiveTurnTokenId();
  list.innerHTML = visible.map(tok => {
    const cur = tok.hpCurrent || 0;
    const max = tok.hpMax || 0;
    const temp = tok.hpTemp || 0;
    const hpPct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    const col = hpBarColor(hpPct);
    const isMonster = tok.type === 'monster';
    const showNums = !isMonster || isDM() || isMyToken(tok);
    const isCur = tok.id === activeTokId;
    const canOpenPanel = isDM() || isMyToken(tok);
    const ownerId = tok.assignedCharId || (!isMonster ? tok.linkedId : '');
    const ownerChar = ownerId ? _charList.find(c => c.id === ownerId) : null;
    const controllerHtml = ownerChar && ownerChar.name !== tokDisplayName(tok)
      ? `<div style="font-size:9px;color:var(--ac);margin-top:1px">⚔ ${esc(ownerChar.name)}</div>`
      : '';
    const isBulk = isDM() && bulkTokenIds.has(tok.id);
    const rowStyle = `display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--sep)${isCur ? ';background:var(--a22);margin:0 -10px;padding-left:10px;padding-right:10px' : ''}${canOpenPanel ? ';cursor:pointer' : ''}${isBulk ? ';border-left:3px solid #00e5ff;padding-left:5px' : ''}`;
    const hpNumStr = showNums
      ? `<span style="font-weight:bold;color:${col}">${cur}</span><span style="color:var(--txd)">/${max}</span>${temp > 0 ? `<span style="color:#aaddff;font-size:10px"> +${temp}</span>` : ''}`
      : '';
    const clickAttr = canOpenPanel ? `onclick="hpTrackerRowClick('${tok.id}', event)"` : '';
    const activeConds = parseConditions(tok.conditions);
    const condsHtml = activeConds.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px" onclick="event.stopPropagation()">
          ${activeConds.map(c => `<a href="https://5e.tools/conditionsdiseases.html#${encodeURIComponent(c.toLowerCase())}_xphb" target="_blank" rel="noopener"
              style="font-size:9px;font-weight:bold;background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.6);color:#ffa500;border-radius:2px;padding:0 3px;line-height:13px;text-decoration:none;white-space:nowrap"
              title="${esc(c)}">${esc(COND_ABBREV[c] || c.slice(0,3).toUpperCase())}</a>`).join('')}
        </div>`
      : '';
    return `<div style="${rowStyle}" ${clickAttr}>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;word-break:break-word${isCur ? ';color:var(--ac);font-weight:bold' : ''}">${isCur ? '▶ ' : ''}${esc(tokDisplayName(tok))}</div>
        ${controllerHtml}
        ${condsHtml}
        <div style="display:flex;align-items:center;gap:3px;margin-top:2px">
          <div style="flex:1;background:var(--bg3);border-radius:2px;overflow:hidden;height:4px">
            <div style="width:${hpPct*100}%;height:100%;background:${col};transition:width .3s"></div>
          </div>
          ${temp > 0 ? `<div style="width:${Math.min(30,temp/max*100)}%;max-width:20%;height:4px;background:#aaddff;border-radius:2px;flex-shrink:0"></div>` : ''}
        </div>
      </div>
      <div style="font-size:11px;min-width:44px;text-align:right;flex-shrink:0;line-height:1.3">${hpNumStr}</div>
    </div>`;
  }).join('');
}

// ── Bulk selection (DM only) ──────────────────────────────────────────────────
function hpTrackerRowClick(id, event) {
  const tok = tokens.find(t => t.id === id);
  if (!tok) return;
  if (event.shiftKey && isDM()) {
    if (bulkTokenIds.has(id)) {
      bulkTokenIds.delete(id);
    } else {
      bulkTokenIds.add(id);
    }
    closeHpPanel();
    renderTokens();
    renderBulkPanel();
    renderHpTable();
  } else {
    if (bulkTokenIds.size > 0) {
      bulkTokenIds.clear();
      renderBulkPanel();
    }
    selectToken(id);
    panToToken(id);
    openHpPanel(tok);
  }
}

function clearBulkSelection() {
  bulkTokenIds.clear();
  renderBulkPanel();
  renderTokens();
  renderHpTable();
}

function bulkDeselectToken(id) {
  bulkTokenIds.delete(id);
  renderBulkPanel();
  renderTokens();
  renderHpTable();
}

function updateLeftPanelVisibility() {
  const lp = document.getElementById('left-panel');
  if (!lp) return;
  const hasInit = (initData.entries || []).length > 0;
  const hasBulk = isDM() && bulkTokenIds.size > 0;
  lp.classList.toggle('lp-open', hasInit || hasBulk);
}

function renderBulkPanel() {
  const section = document.getElementById('lp-bulk-section');
  if (!section) return;
  if (bulkTokenIds.size === 0 || !isDM()) {
    section.style.display = 'none';
    updateLeftPanelVisibility();
    return;
  }
  section.style.display = '';
  const selected = [...bulkTokenIds].map(id => tokens.find(t => t.id === id)).filter(Boolean);
  document.getElementById('bulk-count').textContent = `${selected.length} token${selected.length !== 1 ? 's' : ''} selected`;

  const namesList = document.getElementById('bulk-names-list');
  if (namesList) {
    namesList.innerHTML = selected.map(tok =>
      `<span style="font-size:10px;background:var(--bg3);border:1px solid #00e5ff44;border-radius:2px;padding:1px 5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px" onclick="bulkDeselectToken('${tok.id}')" title="Remove from selection">${esc(tokDisplayName(tok))} <span style="color:var(--txd);font-size:9px">✕</span></span>`
    ).join('');
  }

  const condGrid = document.getElementById('bulk-conditions-grid');
  if (condGrid) {
    condGrid.innerHTML = '';
    for (const c of CONDITIONS) {
      const count = selected.filter(tok => parseConditions(tok.conditions).includes(c)).length;
      const isAll = count === selected.length && count > 0;
      const isSome = count > 0 && !isAll;
      const btn = document.createElement('button');
      btn.className = 'cond-btn' + (isAll ? ' active' : isSome ? ' partial' : '');
      btn.textContent = COND_ABBREV[c];
      btn.title = c + (count > 0 ? ` (${count}/${selected.length})` : '');
      btn.onclick = () => bulkToggleCondition(c);
      condGrid.appendChild(btn);
    }
  }

  const initRow = document.getElementById('bulk-init-row');
  if (initRow) {
    const hasMonsters = selected.some(t => t.type === 'monster');
    initRow.style.display = hasMonsters ? '' : 'none';
  }
  updateLeftPanelVisibility();
}

function applyBulkHpChange(mode) {
  if (bulkTokenIds.size === 0) return;
  const amount = Math.max(0, parseInt(document.getElementById('bulk-amount').value) || 0);
  if (amount === 0) return;
  for (const id of bulkTokenIds) {
    const tok = tokens.find(t => t.id === id);
    if (!tok) continue;
    let fields;
    if (mode === 'dmg') {
      let remaining = amount;
      const newTemp = Math.max(0, (tok.hpTemp || 0) - remaining);
      remaining = Math.max(0, remaining - (tok.hpTemp || 0));
      fields = { hpCurrent: Math.max(0, (tok.hpCurrent || 0) - remaining), hpTemp: newTemp };
    } else {
      fields = { hpCurrent: Math.min(tok.hpMax || 0, (tok.hpCurrent || 0) + amount) };
    }
    patchToken(id, fields);
    const tid = id, f = fields;
    _tokQ.run(async () => {
      try { await fetch(`/api/table/tokens/${tid}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(f) }); } catch {}
    });
  }
  renderHpTable();
  renderTokens();
  const selTok = tokens.find(t => t.id === selectedTokenId);
  if (selTok && bulkTokenIds.has(selectedTokenId)) _refreshHpPanel(selTok);
}

function applyBulkQuickDmg(n) { document.getElementById('bulk-amount').value = n; applyBulkHpChange('dmg'); }
function applyBulkQuickHeal(n) { document.getElementById('bulk-amount').value = n; applyBulkHpChange('heal'); }

function bulkToggleCondition(name) {
  if (bulkTokenIds.size === 0) return;
  const selected = [...bulkTokenIds].map(id => tokens.find(t => t.id === id)).filter(Boolean);
  const count = selected.filter(tok => parseConditions(tok.conditions).includes(name)).length;
  const addToAll = count < selected.length;
  for (const tok of selected) {
    const active = parseConditions(tok.conditions);
    const next = addToAll
      ? (active.includes(name) ? active : [...active, name])
      : active.filter(c => c !== name);
    const condStr = JSON.stringify(next);
    patchToken(tok.id, { conditions: condStr });
    const tid = tok.id;
    _tokQ.run(async () => {
      try { await fetch(`/api/table/tokens/${tid}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ conditions: condStr }) }); } catch {}
    });
  }
  renderTokens();
  renderBulkPanel();
  renderHpTable();
  const selTok = tokens.find(t => t.id === selectedTokenId);
  if (selTok && bulkTokenIds.has(selectedTokenId)) _refreshHpPanel(selTok);
}
