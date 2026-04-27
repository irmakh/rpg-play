// ── Side panel Quick Roll ─────────────────────────────────────────────────────
function toggleSideSection(name) {
  const el    = document.getElementById(`side-sec-${name}`);
  const arrow = document.getElementById(`side-sec-${name}-arrow`);
  if (el) {
    const hidden = el.style.display === 'none';
    el.style.display = hidden ? '' : 'none';
    if (arrow) arrow.textContent = hidden ? '▼' : '▶';
    if (hidden) _sideOpenSections.add(name); else _sideOpenSections.delete(name);
  }
}

function _sideSecStyle(name) {
  return _sideOpenSections.has(name) ? '' : 'display:none';
}
function _sideSecArrow(name) {
  return _sideOpenSections.has(name) ? '▼' : '▶';
}

function renderSideCharacter() {
  const d = qrollData || {};
  const spAtk = d['sp-atk'] !== undefined ? d['sp-atk'] : null;
  // 'init' is dex mod + item bonuses; 'init-bonus' is the manual bonus — always add both
  const initMod = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  const initBonusStr = initMod >= 0 ? '+' + initMod : '' + initMod;

  const skillRows = SKILL_NAMES.map((name, i) => {
    const val = d[`sk-${i}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)}','${esc(val)}')" title="${esc(name)}">
      <span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  const saveRows = SAVE_NAMES.map((name, i) => {
    const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
    return `<div class="qroll-row" onclick="qroll('${esc(name)} Save','${esc(val)}')" title="${esc(name)} Save">
      <span>${esc(name)}</span><span class="qroll-val">${esc(val)}</span></div>`;
  }).join('');
  let weapons = [];
  try { weapons = JSON.parse(d['_weapons'] || '[]'); } catch {}
  const atkRows = weapons.filter(r => r[0]).map(r => {
    const [wName, wAtk, wDmg] = [r[0]||'', r[1]||'+0', r[2]||''];
    const dmgRow = wDmg
      ? `<div class="qroll-row" onclick="rollDamageStr('${esc(wName)} Dmg','${esc(wDmg)}')" style="padding-left:20px;background:rgba(0,0,0,.15)">
          <span style="font-size:11px;color:var(--txd)">↳ Damage</span>
          <span class="qroll-val" style="color:#ff9966;font-size:13px">${esc(wDmg)}</span>
        </div>`
      : '';
    return `<div class="qroll-row" onclick="qroll('${esc(wName)} Atk','${esc(wAtk)}')" title="Attack roll">
      <span>${esc(wName)}</span><span class="qroll-val">${esc(wAtk)}</span>
    </div>${dmgRow}`;
  }).join('');
  const spAtkRow = spAtk !== null
    ? `<div class="qroll-row" onclick="qroll('Spell Attack','${esc(String(spAtk))}')" title="Spell Attack">
        <span>Spell Atk</span><span class="qroll-val">${parseInt(spAtk) >= 0 ? '+' : ''}${esc(String(spAtk))}</span></div>`
    : '';
  const atkSection = (atkRows + spAtkRow) || '<div style="padding:4px 0;font-size:11px;color:var(--txd)">No weapons.</div>';

  return `<div style="padding:2px 0 4px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:12px;color:var(--ac);font-weight:bold">${esc(qrollCharName)}</span>
    <button class="btn sm" onclick="rollInitiativeFromPanel()" title="Roll Initiative (d20${initBonusStr})" style="font-size:10px;padding:2px 6px">🎲 Init ${esc(initBonusStr)}</button>
  </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('skills')">Skills <span id="side-sec-skills-arrow">${_sideSecArrow('skills')}</span></div>
      <div id="side-sec-skills" class="qroll-rows" style="${_sideSecStyle('skills')}">${skillRows}</div>
    </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('saves')">Saves <span id="side-sec-saves-arrow">${_sideSecArrow('saves')}</span></div>
      <div id="side-sec-saves" class="qroll-rows" style="${_sideSecStyle('saves')}">${saveRows}</div>
    </div>
    <div class="qroll-section">
      <div class="qroll-section-hdr" onclick="toggleSideSection('attacks')">Attacks <span id="side-sec-attacks-arrow">${_sideSecArrow('attacks')}</span></div>
      <div id="side-sec-attacks" class="qroll-rows" style="${_sideSecStyle('attacks')}">${atkSection}</div>
    </div>`;
}

async function loadSideQroll() {
  const content = document.getElementById('side-qroll-content');
  if (!content) return;

  // Priority: selected token on map → initiative row click → active turn token
  let targetId = selectedTokenId || null;
  if (!targetId && _sideViewInitId) {
    const viewEntry = initData.entries?.find(e => e.id === _sideViewInitId);
    if (viewEntry) {
      const viewTok = tokens.find(t => t.initiativeId === _sideViewInitId);
      targetId = viewTok?.id || null;
    } else {
      _sideViewInitId = null; // entry no longer exists
    }
  }
  if (!targetId) {
    targetId = getActiveTurnTokenId() || null;
  }

  if (targetId === _sideQrollTokenId) return; // already rendered (data unchanged)
  // Only reset section state when switching to a genuinely different token
  if (targetId !== _sidePrevTokenId) _sideOpenSections.clear();
  _sidePrevTokenId = targetId;
  _sideQrollTokenId = targetId;

  const activeTok = targetId ? tokens.find(t => t.id === targetId) : null;
  if (!activeTok) { content.innerHTML = ''; qrollCharName = ''; qrollData = null; return; }

  if (activeTok.type === 'monster') {
    qrollCharName = (activeTok.label) ? activeTok.label : tokDisplayName(activeTok);
    qrollData = null;
    if (isDM() && activeTok.linkedId) {
      // DM: load and show full stat block
      if (_monsterList.length === 0) {
        try {
          const r = await fetch('/api/monsters', { headers: { 'X-Master-Password': masterPw } });
          if (r.ok) _monsterList = await r.json();
        } catch {}
      }
      const mon = _monsterList.find(m => m.id === activeTok.linkedId);
      if (mon) {
        content.innerHTML = renderMonsterFullStats(mon.data || {}, activeTok);
        // section open/collapsed state is preserved via _sideOpenSections
        return;
      }
    }
    // Players (or monster with no linkedId): show identifier only — no HP, no real name
    content.innerHTML = `<div style="font-size:13px;color:#ff9999;font-weight:bold;margin-bottom:6px">${esc(tokDisplayName(activeTok))}</div>`;
    return;
  }

  // Character / NPC / custom
  if (activeTok.linkedId) {
    try {
      // Use public qroll endpoint so all players can see skills/saves/attacks
      // DM uses full endpoint (has access to all data anyway)
      const url = isDM()
        ? `/api/characters/${activeTok.linkedId}`
        : `/api/characters/${activeTok.linkedId}/qroll`;
      const headers = isDM() ? { 'X-Character-Password': masterPw } : {};
      const r = await fetch(url, { headers });
      if (r.ok) {
        const char = await r.json();
        qrollCharName = char.name || activeTok.name;
        qrollData = char.data || {};
        content.innerHTML = renderSideCharacter();
        // section open/collapsed state is preserved via _sideOpenSections
        return;
      }
    } catch {}
  }
  qrollCharName = activeTok.name;
  qrollData = null;
  content.innerHTML = `<div style="font-size:12px;color:var(--ac);font-weight:bold;padding:2px 0">${esc(activeTok.name)}</div>
    <div style="font-size:11px;color:var(--txd)">HP: ${activeTok.hpCurrent||0}/${activeTok.hpMax||0}</div>`;
}

function qroll(label, modifier) {
  rollPending = { label, modifier: parseInt(String(modifier).replace(/[^0-9\-+]/g,'')) || 0 };
  const lbl = document.getElementById('adv-label');
  if (lbl) lbl.textContent = 'Roll: ' + label;
  document.getElementById('adv-modal').style.display = 'flex';
}

function parseDice(expr) {
  if (!expr) return null;
  const cleaned = String(expr).trim().replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)((?:[+\-]\d+)*)/);
  if (!m) {
    const flat = parseInt(cleaned);
    if (!isNaN(flat)) return { total: flat, detail: String(flat) };
    return null;
  }
  const num = parseInt(m[1]), die = parseInt(m[2]);
  let mod = 0;
  (m[3] || '').match(/[+\-]\d+/g)?.forEach(s => { mod += parseInt(s); });
  const rolls = Array.from({ length: num }, () => Math.ceil(Math.random() * die));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  let detail = `${num}d${die}(${rolls.join(',')})`;
  if (mod !== 0) detail += (mod > 0 ? '+' : '') + mod;
  return { total, detail, rolls, die, num, mod, diceExpr: `${num}d${die}` };
}

async function rollDamageStr(label, dmgStr) {
  const result = parseDice(dmgStr);
  if (!result) return;
  const sides    = result.die || 6;
  const rolls    = result.rolls || [result.total];
  const modifier = result.mod || 0;
  const { total } = result;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, sides, rolls, modifier, total, label, duration);
  await showDiceAnimation(sides, rolls, modifier, total, label, duration);
  await postToChat({ sender: getChatSender(), dice: result.diceExpr || String(total), results: rolls, modifier, total, label });
  _pushRollToChar(getActiveCharLinkedId(), { label, type: 'dmg', detail: result.detail, total, isCrit: false, isFail: false, isDamage: true, time: new Date().toISOString() });
}

function rollInitiativeFromPanel() {
  const d = qrollData || {};
  // init = dex mod + item bonuses; init-bonus = manual bonus — always add both
  const modifier = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  const activeTokId = getActiveTurnTokenId();
  const targetId = activeTokId || (!initData.currentId ? selectedTokenId : null);
  const tok = targetId ? tokens.find(t => t.id === targetId) : null;
  rollPending = {
    label: 'Initiative',
    modifier,
    afterRoll: tok?.linkedId ? async (total) => {
      try {
        await fetch('/api/initiative/roll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId: tok.linkedId, name: qrollCharName || tok.name, roll: total })
        });
      } catch {}
    } : null
  };
  const lbl = document.getElementById('adv-label');
  if (lbl) lbl.textContent = 'Roll: Initiative';
  document.getElementById('adv-modal').style.display = 'flex';
}

// ── Advantage modal ───────────────────────────────────────────────────────────
function advClose() {
  document.getElementById('adv-modal').style.display = 'none';
  rollPending = null;
}

async function confirmRoll(type) {
  if (!rollPending) return;
  document.getElementById('adv-modal').style.display = 'none';
  const { label, modifier, afterRoll } = rollPending;
  rollPending = null;
  const charId = getActiveCharLinkedId();
  const r1 = Math.ceil(Math.random() * 20);
  const r2 = Math.ceil(Math.random() * 20);
  const used = type === 'adv' ? Math.max(r1, r2) : type === 'dis' ? Math.min(r1, r2) : r1;
  const total = used + modifier;
  const chatLabel = type === 'adv' ? `${label} (Adv)` : type === 'dis' ? `${label} (Dis)` : label;
  const duration  = 1000 + Math.random() * 2000;
  const rollId    = Math.random().toString(36).slice(2);
  // For adv/dis show both dice; usedIdx identifies the kept die
  const dieResults = type !== 'norm' ? [r1, r2] : [r1];
  const usedIdx    = type === 'adv' ? (r2 > r1 ? 1 : 0) : type === 'dis' ? (r2 < r1 ? 1 : 0) : 0;
  _selfRollIds.add(rollId);
  _broadcastDiceRoll(rollId, 20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  await showDiceAnimation(20, dieResults, modifier, total, chatLabel, duration, usedIdx);
  await postToChat({ sender: getChatSender(), dice: '1d20', results: [used], modifier, total, label: chatLabel });
  const detail = type !== 'norm' ? `d20(${r1}, ${r2} → ${used})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier) : ''}` : `d20(${r1})${modifier !== 0 ? (modifier > 0 ? ' + ' : ' − ') + Math.abs(modifier) : ''}`;
  _pushRollToChar(charId, { label: chatLabel, type, detail, total, isCrit: used === 20, isFail: used === 1, isDamage: false, time: new Date().toISOString() });
  if (afterRoll) afterRoll(total);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('media-lightbox')) { lightboxClose(); return; }
  if (e.key === 'Escape' && placementState) { exitPlacementMode(); return; }
  if (e.key === 'Escape' && currentTool === 'draw') { drawingState = null; oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); setTool('select'); return; }
  if (document.getElementById('dice-roller-modal').style.display === 'flex') {
    if (e.key === 'Escape') { closeDiceRollerModal(); return; }
  }
  if (document.getElementById('monster-info-modal').style.display === 'flex') {
    if (e.key === 'Escape') { closeMonsterInfoTableModal(); return; }
  }
  if (document.getElementById('adv-modal').style.display === 'flex') {
    if      (e.key === 'a' || e.key === 'A') { e.preventDefault(); confirmRoll('adv'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); confirmRoll('norm'); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); confirmRoll('dis'); }
    else if (e.key === 'Escape') advClose();
    return;
  }
  // Don't intercept keys while typing in an input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape' && selectedTokenId) {
    selectedTokenId = null;
    renderTokens();
    _sideQrollTokenId = null;
    renderSidePanel();
    if (!initData.currentId) loadSideQroll();
    return;
  }
  if (selectedTokenId) {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveSelectedToken(e.key);
    } else if (e.key === 'Delete' && isDM()) {
      e.preventDefault();
      deleteSelectedToken();
    }
  }
});
