// ── Add Token Modal ───────────────────────────────────────────────────────────
function openAddTokenModal() {
  if (_addTokenBusy) return;
  _pendingTokenLinkedId = null;
  _pendingTokenType = null;
  switchTokenTab('chars');
  document.getElementById('add-token-modal').style.display = 'flex';
}
function closeAddTokenModal() {
  document.getElementById('add-token-modal').style.display = 'none';
}

function switchTokenTab(tab) {
  _pendingTokenTab = tab;
  ['chars','monsters','custom'].forEach(t => {
    document.getElementById(`tok-tab-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tabBtn-${t}`)?.classList.toggle('active', t === tab);
  });
  const idRow = document.getElementById('tok-identifier-row');
  if (idRow) {
    idRow.style.display = tab === 'monsters' ? 'flex' : 'none';
    if (tab !== 'monsters') document.getElementById('tok-identifier').value = '';
  }
}

async function populateAddTokenModal(chars) {
  // Characters tab
  const charTab = document.getElementById('tok-tab-chars');
  if (charTab && chars.length > 0) {
    charTab.innerHTML = chars.map(c => `
      <div class="qroll-row" onclick="selectTokenChar('${esc(c.id)}','${esc(c.name)}','${c.char_type||'character'}')"
           style="padding:6px 10px;border-bottom:1px solid var(--sep)">
        <span>${esc(c.name)}</span>
        <span style="font-size:10px;color:var(--txd)">${c.char_type === 'npc' ? 'NPC' : 'PC'}</span>
      </div>`).join('');
  } else if (charTab) {
    charTab.innerHTML = '<div style="padding:10px;font-size:11px;color:var(--txd)">No characters found.</div>';
  }

  // Monsters tab (load on demand)
  const monTab = document.getElementById('tok-tab-monsters');
  if (monTab && isDM()) {
    try {
      const mRes = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
      if (mRes.ok) {
        _monsterList = await mRes.json();
        monTab.innerHTML = _monsterList.length > 0
          ? _monsterList.map(m => {
              const portrait = m.data?.portraitThumb || m.data?.portrait;
              const thumb = portrait
                ? `<img loading="lazy" src="${portrait}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid var(--a55);flex-shrink:0">`
                : `<div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);border:1px solid var(--a55);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--txd)">?</div>`;
              return `<div class="qroll-row" onclick="selectTokenMonster('${esc(m.id)}','${esc(m.name)}')"
                   style="padding:5px 10px;border-bottom:1px solid var(--sep);display:flex;align-items:center;gap:8px">
                ${thumb}
                <span style="flex:1">${esc(m.name)}</span>
                <span style="font-size:10px;color:var(--txd)">CR ${esc(m.cr||'?')}</span>
                <button onclick="event.stopPropagation();uploadMonsterPortrait('${esc(m.id)}')"
                        style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;opacity:.6"
                        title="Upload portrait">📷</button>
              </div>`;
            }).join('')
          : '<div style="padding:10px;font-size:11px;color:var(--txd)">No monsters found.</div>';
      }
    } catch {}
  }
}

async function uploadMonsterPortrait(monsterId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const res = await fetch(`/api/monsters/${monsterId}/portrait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ dataUrl: e.target.result })
        });
        if (!res.ok) { showToast('Upload failed.', true); return; }
        // Update local cache so the thumbnail updates immediately
        const mon = _monsterList.find(m => m.id === monsterId);
        if (mon) { if (!mon.data) mon.data = {}; mon.data.portrait = e.target.result; }
        // Rebuild monster tab HTML
        await populateAddTokenModal(_charList);
        showToast('Portrait saved.');
      } catch { showToast('Upload failed.', true); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function selectTokenChar(charId, charName, charType) {
  _pendingTokenLinkedId = charId;
  _pendingTokenType = charType === 'npc' ? 'npc' : 'character';
  // highlight selected
  document.querySelectorAll('#tok-tab-chars .qroll-row').forEach(r => r.style.background = '');
  event.currentTarget.style.background = 'var(--a22)';
}

function selectTokenMonster(monsterId, monsterName) {
  _pendingTokenLinkedId = monsterId;
  _pendingTokenType = 'monster';
  document.querySelectorAll('#tok-tab-monsters .qroll-row').forEach(r => r.style.background = '');
  event.currentTarget.style.background = 'var(--a22)';
}

async function submitAddToken() {
  const tab = _pendingTokenTab;
  let payload;
  const cs = tableState.cellSize || 50;
  const { w, h } = getCanvasSize();
  const centerX = Math.floor((w / 2 - (tableState.offsetX||0)) / cs);
  const centerY = Math.floor((h / 2 - (tableState.offsetY||0)) / cs);

  const tokenSize = parseInt(document.getElementById('tok-size-sel')?.value) || 1;

  if (tab === 'custom') {
    const name = document.getElementById('custom-tok-name')?.value?.trim();
    if (!name) { showToast('Name is required.', true); return; }
    payload = {
      name, type: 'custom',
      hpCurrent: parseInt(document.getElementById('custom-tok-hp')?.value) || 10,
      hpMax: parseInt(document.getElementById('custom-tok-hp')?.value) || 10,
      speed: parseInt(document.getElementById('custom-tok-speed')?.value) || 30,
      color: document.getElementById('custom-tok-color')?.value || '#888888',
      tokenSize, x: centerX, y: centerY
    };
  } else if (tab === 'chars' && _pendingTokenLinkedId) {
    // Fetch char data for HP/speed
    const char = _charList.find(c => c.id === _pendingTokenLinkedId);
    const name = char?.name || 'Character';
    let hpMax = 10, hpCur = 10, hpTemp = 0, speed = 30;
    try {
      const res = await fetch(`/api/characters/${_pendingTokenLinkedId}`, {
        headers: masterPw ? { 'X-Character-Password': masterPw } : {}
      });
      if (res.ok) {
        const cdata = await res.json();
        hpMax = parseInt(cdata.data?.hpmax) || 10;
        hpCur = parseInt(cdata.data?.hpcur) || hpMax;
        hpTemp = Math.max(0, parseInt(cdata.data?.hptemp) || 0);
        if (cdata.data?.['speed-base'] !== undefined) {
          // speed-base is raw; add equipped item bonuses
          let charItems = [];
          try { charItems = JSON.parse(cdata.data?.['_items'] || '[]'); } catch {}
          const itemSpeedBonus = charItems.filter(i => i.equipped)
            .reduce((s, i) => s + (parseInt(i.speedBonus) || 0), 0);
          speed = (parseInt(String(cdata.data['speed-base']).replace(/[^0-9]/g,'')) || 30) + itemSpeedBonus;
        } else {
          // Older character — data.speed already includes bonuses
          speed = parseInt(String(cdata.data?.speed || '30').replace(/[^0-9]/g,'')) || 30;
        }
      }
    } catch {}
    // Fetch portrait (DM only — non-DMs won't have masterPw but portrait is stored on token anyway)
    let portrait = null, portraitThumb = null;
    if (masterPw) {
      try {
        const pRes = await fetch(`/api/characters/${_pendingTokenLinkedId}/portrait`, {
          headers: { 'X-Master-Password': masterPw }
        });
        if (pRes.ok) { const pd = await pRes.json(); portrait = pd.portrait || null; portraitThumb = pd.portraitThumb || null; }
      } catch {}
    }
    const initEntry = initData.entries.find(e => e.charId === _pendingTokenLinkedId);
    payload = {
      name, type: _pendingTokenType || 'character', linkedId: _pendingTokenLinkedId,
      hpCurrent: hpCur, hpMax, hpTemp, speed,
      color: _pendingTokenType === 'npc' ? '#7ec8e3' : '#c8a04a',
      initiativeId: initEntry?.id || '',
      portrait, portraitThumb,
      tokenSize, x: centerX, y: centerY
    };
  } else if (tab === 'monsters' && _pendingTokenLinkedId) {
    const mon = _monsterList.find(m => m.id === _pendingTokenLinkedId);
    const baseName = mon?.name || 'Monster';
    let identifier = document.getElementById('tok-identifier')?.value?.trim();
    if (!identifier) {
      // Generate a random letter + digit, e.g. "A3", "K7"
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      identifier = letters[Math.floor(Math.random() * letters.length)]
                 + (Math.floor(Math.random() * 9) + 1);
    }
    const name = `${baseName} ${identifier}`;
    const mData = mon?.data || {};
    const hp = mData.hp?.average || mData.hp || 10;
    const spd = mData.speed?.walk || (typeof mData.speed === 'string' ? parseInt(mData.speed) : null) || 30;
    const rawAc = [].concat(mData.ac || [])[0];
    const monAc = typeof rawAc === 'number' ? rawAc : (rawAc?.ac ?? null);
    payload = {
      name, type: 'monster', linkedId: _pendingTokenLinkedId,
      hpCurrent: hp, hpMax: hp, speed: spd, ac: monAc,
      color: '#cc3333',
      initiativeId: '', // always empty → server creates a new entry per monster using the identifier name
      portrait: mon?.data?.portrait || null,
      portraitThumb: mon?.data?.portraitThumb || null,
      label: identifier, // shown to players instead of the full monster name
      tokenSize, x: centerX, y: centerY
    };
  } else {
    showToast('Select a character or monster first, or fill in custom fields.', true);
    return;
  }

  closeAddTokenModal();
  enterPlacementMode(payload);
}

async function clearAllTokens() {
  if (!await showConfirm('Remove all tokens and clear initiative?')) return;
  try {
    await fetch('/api/table/clear', { method: 'POST', headers: { 'X-Master-Password': masterPw } });
  } catch { showToast('Failed to clear tokens.', true); }
}
