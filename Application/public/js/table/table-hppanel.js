// ── HP Panel ──────────────────────────────────────────────────────────────────
async function openHpPanel(tok) {
  selectedTokenId = tok.id;
  // Monsters: use stored AC (set at token creation, doesn't change). Render immediately.
  // Characters: render immediately with stored AC if present, then update real-time from server.
  _hpPanelAc = tok.ac != null ? tok.ac : null;
  document.getElementById('lp-token-section').style.display = '';
  _refreshHpPanel(tok);
  // Scroll left panel so the token section is visible
  const lp = document.getElementById('left-panel');
  if (lp) lp.scrollTop = lp.scrollHeight;
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
  document.getElementById('lp-token-section').style.display = 'none';
  _hpPanelAc = null;
  // Keep selectedTokenId — token stays selected after closing HP panel
}
function _refreshHpPanel(tok) {
  const hpPct = (tok.hpMax || 0) > 0 ? Math.max(0, Math.min(1, (tok.hpCurrent || 0) / tok.hpMax)) : 0;
  const acEl = document.getElementById('hp-ac-display');
  if (acEl) acEl.textContent = _hpPanelAc != null ? _hpPanelAc : '—';
  const hpNameEl = document.getElementById('hp-panel-name');
  if (isDM() && tok.type === 'monster' && tok.label) {
    const baseName = tok.name.slice(0, tok.name.length - tok.label.length).trimEnd() || tok.name;
    hpNameEl.innerHTML = esc(baseName) + ` <span style="color:var(--txd);font-weight:normal;font-size:11px">[${esc(tok.label)}]</span>`;
  } else {
    hpNameEl.textContent = tokDisplayName(tok);
  }
  const delBtn = document.getElementById('hp-del-btn');
  if (delBtn) delBtn.style.display = isDM() ? '' : 'none';
  const editLabelBtn = document.getElementById('hp-edit-label-btn');
  if (editLabelBtn) editLabelBtn.style.display = isDM() ? '' : 'none';
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
      initBtn.textContent = hasEntry ? '🎲 Reroll Initiative' : '🎲 Roll Initiative';
    } else {
      initRow.style.display = 'none';
    }
  }
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
  _startMonsterInitRoll(tok);
}

function rollMonsterInitiativeFromPanel() {
  if (!isDM()) return;
  const panelTok = _sideQrollTokenId ? tokens.find(t => t.id === _sideQrollTokenId) : null;
  if (!panelTok || panelTok.type !== 'monster') return;
  _startMonsterInitRoll(panelTok);
}

function _startMonsterInitRoll(tok) {
  let dexMod = 0;
  if (tok.linkedId) {
    const mon = _monsterList.find(m => m.id === tok.linkedId);
    if (mon?.data?.dex) dexMod = Math.floor((parseInt(mon.data.dex) - 10) / 2);
  }
  const existingEntry = initData.entries.find(e => e.id === tok.initiativeId);
  const tokId = tok.id, tokName = tok.name, tokLinkedId = tok.linkedId, tokInitId = tok.initiativeId;
  rollPending = {
    label: 'Initiative',
    modifier: dexMod,
    afterRoll: async (total) => {
      try {
        if (existingEntry) {
          const res = await fetch(`/api/initiative/${tokInitId}/roll`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
            body: JSON.stringify({ roll: total })
          });
          if (!res.ok) return showToast('Failed to update initiative.', true);
        } else {
          const res = await fetch('/api/initiative/add', {
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
  const lbl = document.getElementById('adv-label');
  if (lbl) lbl.textContent = 'Roll: Initiative';
  document.getElementById('adv-modal').style.display = 'flex';
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
        headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: condStr })
      });
    } catch {}
  });
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
    // Hide monsters from non-DM players until initiative is running
    if (!isDM() && t.type === 'monster' && !initData.currentId) return false;
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
    const showNums = !isMonster || isDM();
    const isCur = tok.id === activeTokId;
    const canEdit = isDM() || tok.type === 'character' || tok.type === 'npc';
    const rowStyle = `display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--sep)${isCur ? ';background:var(--a22);margin:0 -10px;padding-left:10px;padding-right:10px' : ''}${canEdit ? ';cursor:pointer' : ''}`;
    const hpNumStr = showNums
      ? `<span style="font-weight:bold;color:${col}">${cur}</span><span style="color:var(--txd)">/${max}</span>${temp > 0 ? `<span style="color:#aaddff;font-size:10px"> +${temp}</span>` : ''}`
      : '';
    const clickAttr = canEdit ? `onclick="openHpPanel(tokens.find(t=>t.id==='${tok.id}'))"` : '';
    const activeConds = parseConditions(tok.conditions);
    const condsHtml = activeConds.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px" onclick="event.stopPropagation()">
          ${activeConds.map(c => `<a href="https://5e.tools/conditionsdiseases.html#${encodeURIComponent(c.toLowerCase())}_xphb" target="_blank" rel="noopener"
              style="font-size:9px;font-weight:bold;background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.6);color:#ffa500;border-radius:2px;padding:0 3px;line-height:13px;text-decoration:none;white-space:nowrap"
              title="${esc(c)}">${esc(COND_ABBREV[c] || c.slice(0,2).toUpperCase())}</a>`).join('')}
        </div>`
      : '';
    return `<div style="${rowStyle}" ${clickAttr}>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${isCur ? ';color:var(--ac);font-weight:bold' : ''}">${isCur ? '▶ ' : ''}${esc(tokDisplayName(tok))}</div>
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
