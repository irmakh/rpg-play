// ── Secondary Screen (Screen 2 — Info Panel) ──────────────────────────────────
// table-secondary.html only. Self-contained: own SSE, own state, own API calls.
// Receives TOKEN_SELECTED from primary via the server-side SSE relay.

// ── State ────────────────────────────────────────────────────────────────────
let sTokens     = [];
let sInitData   = { entries: [], currentId: null };
let sCharList   = [];
let sPrepMaps   = [];
let sFogRegions = [];
let sHiddenItems = [];
let sMonsterData = null;

let sSelectedToken   = null;
let sSelectedTokenAc = null;
let sQrollData       = null;
let sQrollCharName   = '';
let sRollMode        = 'norm';

let sChatUnread = 0;
let sCurrentTab = 'init';

let sessionRole    = null;
let sessionCharId  = null;
let sessionCharPw  = null;
let masterPw       = '';

const _sTokQ = { _p: Promise.resolve(), run(fn) { this._p = this._p.then(() => fn(), () => fn()); } };
let _sConsoleEs = null;

function _sConsolePost(msg) {
  fetch('/api/console/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function sIsDM()          { return sessionRole === 'dm' && !!masterPw; }
function sIsCharSession() { return sessionRole === 'character' && !!sessionCharId; }

function sIsMyToken(tok) {
  if (sIsDM()) return true;
  if (sIsCharSession()) {
    if (tok.assignedCharId && tok.assignedCharId === sessionCharId) return true;
    if (!tok.assignedCharId && tok.linkedId && tok.linkedId === sessionCharId) return true;
  }
  return false;
}

function sAuthHeaders(extra = {}) {
  if (sIsDM()) return { 'Content-Type': 'application/json', 'X-Master-Password': masterPw, ...extra };
  const h = { 'Content-Type': 'application/json' };
  if (sessionCharId) h['X-Character-Id']       = sessionCharId;
  if (sessionCharPw) h['X-Character-Password'] = sessionCharPw;
  return { ...h, ...extra };
}

function sLoadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    if (!s || !s.role) return false;
    sessionRole   = s.role;
    masterPw      = s.role === 'dm'        ? (s.masterPw    || '') : '';
    sessionCharId = s.role === 'character' ? (s.characterId || null) : null;
    sessionCharPw = s.role === 'character' ? (s.charPw      || null) : null;
    return true;
  } catch { return false; }
}

function sApplyBadges() {
  const dmBadge    = document.getElementById('s-badge-dm');
  const charBadge  = document.getElementById('s-badge-char');
  const dmTab      = document.querySelector('[data-tab="dm"]');
  const initCtrl   = document.getElementById('s-init-ctrl-row');
  if (sIsDM()) {
    if (dmBadge)   dmBadge.style.display   = '';
    if (charBadge) charBadge.style.display = 'none';
    if (dmTab)     dmTab.style.display     = '';
    if (initCtrl)  initCtrl.style.display  = '';
  } else {
    if (dmBadge)   dmBadge.style.display   = 'none';
    if (charBadge) {
      const s = JSON.parse(sessionStorage.getItem('rpgSession') || '{}');
      charBadge.textContent = s.characterName || 'Player';
      charBadge.style.display = '';
    }
    if (dmTab)    dmTab.style.display    = 'none';
    if (initCtrl) initCtrl.style.display = 'none';
  }
}

function sLogout() {
  navigator.sendBeacon('/api/console/event', new Blob([JSON.stringify({ type: 'SESSION_LOGOUT' })], { type: 'application/json' }));
  sessionStorage.removeItem('rpgSession');
  sessionStorage.removeItem('tableMasterPw');
  sessionStorage.removeItem('dmMasterPw');
  location.reload();
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function sShowTab(name) {
  sCurrentTab = name;
  document.querySelectorAll('.s-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.s-tab-content').forEach(c => c.classList.toggle('active', c.id === `s-tab-${name}`));
  if (name === 'chat') {
    sChatUnread = 0;
    const dot = document.getElementById('s-chat-dot');
    if (dot) dot.classList.remove('show');
    const log = document.getElementById('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
  if (name === 'hp') {
    sRenderHpPanel(sSelectedToken);
    const dot = document.getElementById('s-hp-dot');
    if (dot) dot.classList.remove('show');
  }
  if (name === 'dm' && sIsDM()) {
    sRenderDmHpList();
    sRenderFogSection();
    sRenderItemsSection();
    sLoadPrepMaps();
  }
  if (name === 'monster') {
    const dot = document.getElementById('s-monster-dot');
    if (dot) dot.classList.remove('show');
  }
  if (name === 'actions') {
    const dot = document.getElementById('s-actions-dot');
    if (dot) dot.classList.remove('show');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sTokDisplayName(tok) {
  if (!sIsDM() && tok.type === 'monster') return tok.label || tok.name.trim().split(' ').pop();
  return tok.name;
}

function sHpColor(pct) {
  if (pct > 0.6) return '#88ff88';
  if (pct > 0.3) return '#ffcc44';
  if (pct > 0)   return '#ff8844';
  return '#ff4444';
}

function sParseConditions(str) { try { return JSON.parse(str || '[]'); } catch { return []; } }

function sGetActiveTokId() {
  if (!sInitData.currentId) return null;
  const entry = sInitData.entries.find(e => e.id === sInitData.currentId);
  if (!entry) return null;
  const tok = sTokens.find(t => t.initiativeId === entry.id
    || (entry.characterId && t.linkedId === entry.characterId));
  return tok ? tok.id : null;
}

function sGetSender() {
  const s = JSON.parse(sessionStorage.getItem('rpgSession') || '{}');
  return s.characterName || (sIsDM() ? 'DM' : 'Player');
}

// ── Initiative ────────────────────────────────────────────────────────────────
function sRenderInitiative() {
  const list      = document.getElementById('s-init-list');
  const bannerEl  = document.getElementById('s-init-current-name');
  const toggleBtn = document.getElementById('s-init-toggle-btn');
  const dmToggle  = document.getElementById('s-dm-init-toggle');
  const running   = !!sInitData.currentId;

  if (toggleBtn) toggleBtn.textContent = running ? '⏹ End' : '▶ Start';
  if (dmToggle)  dmToggle.textContent  = running ? '⏹ End Initiative' : '▶ Start Initiative';

  if (sInitData.currentId) {
    const cur = sInitData.entries.find(e => e.id === sInitData.currentId);
    if (bannerEl) bannerEl.textContent = cur ? `▶ ${cur.name}` : 'Initiative running';
  } else {
    if (bannerEl) bannerEl.textContent = 'No initiative running';
  }

  if (!list) return;
  const all     = sInitData.entries || [];
  const visible = sIsDM() ? all : all.filter(e => !e.monsterId || !!sInitData.currentId);
  const sorted  = [...visible].sort((a, b) => (b.roll || 0) - (a.roll || 0));

  if (sorted.length === 0) {
    list.innerHTML = '<div class="s-empty-msg-small">No combatants yet.</div>';
    return;
  }

  list.innerHTML = sorted.map(e => {
    const isCur = e.id === sInitData.currentId;
    const name  = (sIsDM() || !e.monsterId) ? esc(e.name) : esc(e.name.trim().split(' ').pop());
    const del   = sIsDM() ? `<button class="s-del-btn" onclick="sRemoveInitEntry('${e.id}')">✕</button>` : '';
    return `<div class="s-init-row${isCur ? ' s-init-cur' : ''}">
      <span class="s-init-marker">${isCur ? '▶' : ''}</span>
      <span class="s-init-name">${name}</span>
      <span class="s-init-roll">${e.roll}</span>
      ${del}
    </div>`;
  }).join('');
}

// ── HP Panel ──────────────────────────────────────────────────────────────────
function sRenderHpPanel(tok) {
  const panel = document.getElementById('s-hp-panel');
  const empty = document.getElementById('s-hp-empty');
  if (!tok || (!sIsDM() && tok.type === 'monster' && !sIsMyToken(tok))) {
    if (panel) panel.style.display = 'none';
    if (empty) empty.style.display = '';
    sRenderCharStats(null);
    return;
  }
  if (panel) panel.style.display = '';
  if (empty) empty.style.display = 'none';

  const cur  = tok.hpCurrent || 0;
  const max  = tok.hpMax || 0;
  const temp = tok.hpTemp || 0;
  const pct  = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const col  = sHpColor(pct);

  const nameEl = document.getElementById('s-hp-name');
  if (nameEl) nameEl.textContent = sTokDisplayName(tok);

  const acEl = document.getElementById('s-hp-ac-badge');
  if (acEl) acEl.textContent = sSelectedTokenAc != null ? `AC ${sSelectedTokenAc}` : 'AC —';

  const barEl = document.getElementById('s-hp-bar');
  if (barEl) { barEl.style.width = `${pct * 100}%`; barEl.style.background = col; }

  const curEl = document.getElementById('s-hp-cur');
  if (curEl) { curEl.textContent = cur; curEl.style.color = col; }

  const maxEl = document.getElementById('s-hp-max');
  if (maxEl) maxEl.textContent = max;

  const tempWrap = document.getElementById('s-hp-temp-wrap');
  const tempEl   = document.getElementById('s-hp-temp');
  if (tempWrap) { tempWrap.style.display = temp > 0 ? '' : 'none'; if (tempEl) tempEl.textContent = temp; }

  const tempInput = document.getElementById('s-hp-temp-input');
  if (tempInput) tempInput.value = temp;

  const editEl = document.getElementById('s-hp-edit');
  if (editEl) editEl.style.display = (sIsDM() || sIsMyToken(tok)) ? '' : 'none';

  const dmExtras = document.getElementById('s-hp-dm-extras');
  if (dmExtras) dmExtras.style.display = sIsDM() ? '' : 'none';

  if (sIsDM()) {
    const visBtn = document.getElementById('s-vis-toggle-btn');
    if (visBtn) {
      const nowHidden = tok.visible === false;
      visBtn.textContent = nowHidden ? '👁 Show Token' : '🚫 Hide Token';
      visBtn.className = 's-btn' + (nowHidden ? ' s-btn-success' : '');
    }
    const assignSel = document.getElementById('s-assign-sel');
    if (assignSel) {
      const pcs = sCharList.filter(c => c.char_type === 'pc');
      assignSel.innerHTML = '<option value="">— Select character —</option>' +
        pcs.map(c => `<option value="${c.id}"${tok.assignedCharId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    }
    const unassignBtn = document.getElementById('s-unassign-btn');
    if (unassignBtn) unassignBtn.style.display = tok.assignedCharId ? '' : 'none';
  }

  const condGrid = document.getElementById('s-conds-grid');
  if (condGrid) {
    const active    = sParseConditions(tok.conditions);
    const canToggle = sIsDM() || sIsMyToken(tok);
    condGrid.innerHTML = '';
    for (const c of CONDITIONS) {
      const btn = document.createElement('button');
      btn.className = 's-cond-btn' + (active.includes(c) ? ' active' : '');
      btn.textContent = COND_ABBREV[c];
      btn.title = c;
      if (canToggle) btn.onclick = () => sToggleCondition(c);
      condGrid.appendChild(btn);
    }
  }

  const initBtn = document.getElementById('s-roll-init-btn');
  if (initBtn) {
    const hasEntry = !!sInitData.entries.find(e => e.id === tok.initiativeId);
    initBtn.textContent = hasEntry ? '🎲 Reroll Initiative' : '🎲 Roll Initiative';
  }

  sRenderCharStats(tok);
}

// ── HP Mutations ──────────────────────────────────────────────────────────────
function sPutHp(fields) {
  if (!sSelectedToken) return;
  const local = sTokens.find(t => t.id === sSelectedToken.id);
  if (local) Object.assign(local, fields);
  sSelectedToken = { ...sSelectedToken, ...fields };
  sRenderHpPanel(sSelectedToken);
  if (sCurrentTab === 'dm') sRenderDmHpList();
  const id = sSelectedToken.id;
  _sTokQ.run(async () => {
    try {
      await fetch(`/api/table/tokens/${id}`, {
        method: 'PUT',
        headers: sAuthHeaders(),
        body: JSON.stringify(fields),
      });
    } catch {}
  });
}

function sApplyHp(mode) {
  if (!sSelectedToken) return;
  const tok    = sSelectedToken;
  const amount = Math.max(0, parseInt(document.getElementById('s-hp-amount')?.value) || 0);
  if (amount === 0) return;
  if (mode === 'dmg') {
    const newTemp = Math.max(0, (tok.hpTemp || 0) - amount);
    const dmgRem  = Math.max(0, amount - (tok.hpTemp || 0));
    sPutHp({ hpCurrent: Math.max(0, (tok.hpCurrent || 0) - dmgRem), hpTemp: newTemp });
  } else {
    sPutHp({ hpCurrent: Math.min(tok.hpMax || 0, (tok.hpCurrent || 0) + amount) });
  }
}
function sQuickDmg(n)  { const el = document.getElementById('s-hp-amount'); if (el) el.value = n; sApplyHp('dmg'); }
function sQuickHeal(n) { const el = document.getElementById('s-hp-amount'); if (el) el.value = n; sApplyHp('heal'); }
function sApplyTempHp() {
  sPutHp({ hpTemp: Math.max(0, parseInt(document.getElementById('s-hp-temp-input')?.value) || 0) });
}

function sToggleCondition(name) {
  if (!sSelectedToken) return;
  const active = sParseConditions(sSelectedToken.conditions);
  const next   = active.includes(name) ? active.filter(c => c !== name) : [...active, name];
  sPutHp({ conditions: JSON.stringify(next) });
}

async function sDeleteToken() {
  if (!sSelectedToken || !sIsDM()) return;
  if (!confirm(`Delete "${sSelectedToken.name}"?`)) return;
  try { await fetch(`/api/table/tokens/${sSelectedToken.id}`, { method: 'DELETE', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

function sToggleTokenVisibility() {
  if (!sSelectedToken || !sIsDM()) return;
  const nowHidden = sSelectedToken.visible === false;
  sPutHp({ visible: nowHidden });
}

function sSaveTokenAssignment() {
  if (!sSelectedToken || !sIsDM()) return;
  const charId = document.getElementById('s-assign-sel')?.value || '';
  if (!charId) return;
  sPutHp({ assignedCharId: charId });
}

function sUnassignToken() {
  if (!sSelectedToken || !sIsDM()) return;
  sPutHp({ assignedCharId: '' });
}

// ── Character Stats (HP tab) ──────────────────────────────────────────────────
function sSetRollMode(mode) {
  sRollMode = mode;
  ['norm', 'adv', 'dis'].forEach(m => {
    const btn = document.getElementById(`s-roll-mode-${m}`);
    if (btn) btn.classList.toggle('active', m === mode);
  });
}

function sToggleStatsSection(name) {
  const el    = document.getElementById(`s-stats-${name}`);
  const arrow = document.getElementById(`s-stats-${name}-arrow`);
  if (!el) return;
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
}

function sQrollRoll(label, modifier) {
  const mod = parseInt(String(modifier).replace(/[^0-9\-+]/g, '')) || 0;
  const r1  = Math.ceil(Math.random() * 20);
  const r2  = Math.ceil(Math.random() * 20);
  let used, typeLabel;
  if      (sRollMode === 'adv') { used = Math.max(r1, r2); typeLabel = `${label} (Adv)`; }
  else if (sRollMode === 'dis') { used = Math.min(r1, r2); typeLabel = `${label} (Dis)`; }
  else                          { used = r1;                typeLabel = label; }
  const total = used + mod;
  fetch('/api/chat', {
    method: 'POST',
    headers: sAuthHeaders(),
    body: JSON.stringify({
      type: 'roll', dice: '1d20', results: [used], modifier: mod,
      total, sender: sGetSender(), label: typeLabel,
      rollId: Math.random().toString(36).slice(2),
    }),
  }).catch(() => {});
}

function sRollDamageStr(label, dmgStr) {
  const m = dmgStr.trim().match(/^(\d*)d(\d+)([+-]\d+)?/i);
  if (!m) return;
  const count   = parseInt(m[1] || '1');
  const sides   = parseInt(m[2]);
  const mod     = parseInt(m[3] || '0');
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total   = results.reduce((a, b) => a + b, 0) + mod;
  fetch('/api/chat', {
    method: 'POST',
    headers: sAuthHeaders(),
    body: JSON.stringify({
      type: 'roll', dice: dmgStr, results, modifier: mod,
      total, sender: sGetSender(), label,
      rollId: Math.random().toString(36).slice(2),
    }),
  }).catch(() => {});
}

function sRenderCharStats(tok) {
  const container = document.getElementById('s-char-stats');
  if (!container) return;

  const canSeeStats = tok && tok.linkedId && tok.type !== 'monster'
    && (sIsDM() || sIsMyToken(tok));

  if (!canSeeStats || !sQrollData) {
    container.style.display = 'none';
    _sShowActionsTab(false);
    return;
  }
  container.style.display = '';
  const d        = sQrollData;
  const initMod  = (parseInt(d['init']) || 0) + (parseInt(d['init-bonus']) || 0);
  const initStr  = initMod >= 0 ? `+${initMod}` : `${initMod}`;

  const skillRows = SKILL_NAMES.map((name, i) => {
    const val = d[`sk-${i}`] || '+0';
    return `<div class="s-qroll-row" onclick="sQrollRoll('${esc(name)}','${esc(val)}')">
      <span class="s-qroll-label">${esc(name)}</span><span class="s-qroll-val">${esc(val)}</span>
    </div>`;
  }).join('');

  const saveRows = SAVE_NAMES.map((name, i) => {
    const val = d[`save-${SAVE_KEYS[i]}`] || '+0';
    return `<div class="s-qroll-row" onclick="sQrollRoll('${esc(name)} Save','${esc(val)}')">
      <span class="s-qroll-label">${esc(name)} Save</span><span class="s-qroll-val">${esc(val)}</span>
    </div>`;
  }).join('');

  let weapons = [];
  try { weapons = JSON.parse(d['_weapons'] || '[]'); } catch {}
  const spAtk = d['sp-atk'];

  let atkRows = weapons.filter(r => r[0]).map(r => {
    const [wName, wAtk, wDmg] = [r[0] || '', r[1] || '+0', r[2] || ''];
    const wNoteJs = (r[3] || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
    const dmgRow = wDmg
      ? `<div class="s-qroll-row" onclick="sRollDamageStr('${esc(wName)} Dmg','${esc(wDmg)}')" style="padding-left:20px;background:rgba(0,0,0,.2)">
          <span class="s-qroll-label" style="color:var(--txd);font-size:11px">↳ Damage</span>
          <span class="s-qroll-val" style="color:#ff9966">${esc(wDmg)}</span>
        </div>` : '';
    return `<div class="s-qroll-row" onclick="sQrollRoll('${esc(wName)} Atk','${esc(wAtk)}')">
      <span class="s-qroll-label">${esc(wName)}</span><span class="s-qroll-val">${esc(wAtk)}</span>
    </div>${dmgRow}`;
  }).join('');

  if (spAtk != null && spAtk !== '') {
    const spStr = parseInt(spAtk) >= 0 ? `+${spAtk}` : `${spAtk}`;
    atkRows += `<div class="s-qroll-row" onclick="sQrollRoll('Spell Attack','${spStr}')">
      <span class="s-qroll-label">Spell Atk</span><span class="s-qroll-val">${esc(spStr)}</span>
    </div>`;
  }
  if (!atkRows) atkRows = '<div class="s-empty-msg-small">No weapons configured.</div>';

  container.innerHTML = `
    <div class="s-stats-header">
      <span>${esc(sQrollCharName)}</span>
      <button class="s-btn" onclick="sQrollRoll('Initiative','${initStr}')" style="flex:none;padding:5px 10px;font-size:11px;min-height:32px">🎲 Init ${esc(initStr)}</button>
    </div>
    <div class="s-roll-mode-row">
      <span class="s-label" style="padding-right:6px">Roll:</span>
      <button id="s-roll-mode-norm" class="s-roll-mode-btn active" onclick="sSetRollMode('norm')">Normal</button>
      <button id="s-roll-mode-adv"  class="s-roll-mode-btn" onclick="sSetRollMode('adv')">Adv</button>
      <button id="s-roll-mode-dis"  class="s-roll-mode-btn" onclick="sSetRollMode('dis')">Dis</button>
    </div>
    <div class="s-qroll-section">
      <div class="s-qroll-hdr" onclick="sToggleStatsSection('skills')">Skills <span id="s-stats-skills-arrow">▶</span></div>
      <div id="s-stats-skills" class="s-qroll-rows" style="display:none">${skillRows}</div>
    </div>
    <div class="s-qroll-section">
      <div class="s-qroll-hdr" onclick="sToggleStatsSection('saves')">Saves <span id="s-stats-saves-arrow">▶</span></div>
      <div id="s-stats-saves" class="s-qroll-rows" style="display:none">${saveRows}</div>
    </div>
    <div class="s-qroll-section">
      <div class="s-qroll-hdr" onclick="sToggleStatsSection('attacks')">Attacks <span id="s-stats-attacks-arrow">▶</span></div>
      <div id="s-stats-attacks" class="s-qroll-rows" style="display:none">${atkRows}</div>
    </div>`;
  sSetRollMode(sRollMode);
  _sShowActionsTab(true);
}

// ── Monster Stats ─────────────────────────────────────────────────────────────
function _sPlainEntry(s) {
  return String(s || '').replace(/\{@(\w+)\s([^}]*)\}/g, (_, tag, content) => {
    const p = content.split('|');
    switch (tag) {
      case 'hit':      return (parseInt(p[0]) >= 0 ? '+' : '') + p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc':       return 'DC ' + p[0];
      case 'h':        return 'Hit: ';
      case 'atk': case 'atkr': return '';
      case 'recharge': return '(Recharge ' + p[0] + '–6)';
      default:         return p[0] || content;
    }
  }).replace(/\{@\w+\}/g, '').replace(/\s+/g, ' ').trim();
}

function _sParseEntry(s) {
  const e = String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return e.replace(/\{@(\w+)\s([^}]*)\}/g, (_, tag, content) => {
    const p = content.split('|');
    switch (tag) {
      case 'spell': case 'item': case 'creature': case 'condition': case 'status': return '<em>' + p[0] + '</em>';
      case 'hit':      return (parseInt(p[0]) >= 0 ? '+' : '') + p[0];
      case 'damage': case 'dice': return p[0];
      case 'dc':       return 'DC ' + p[0];
      case 'h': case 'atk': case 'atkr': return '';
      case 'recharge': return '(Recharge ' + p[0] + '–6)';
      default:         return p[0] || content;
    }
  }).replace(/\{@\w+\}/g, '');
}

function sMonsterRollAction(section, idx) {
  if (!sMonsterData) return;
  const item = (sMonsterData[section] || [])[idx];
  if (!item) return;
  const entryText = [].concat(item.entries || []).join(' ');
  const m = entryText.match(/\{@hit\s([+-]?\d+)\}/i);
  if (!m) return;
  const bonus = parseInt(m[1]);
  sQrollRoll((item.name || '') + ' Atk', (bonus >= 0 ? '+' : '') + bonus);
}

function sMonsterRollDamage(section, idx) {
  if (!sMonsterData) return;
  const item = (sMonsterData[section] || [])[idx];
  if (!item) return;
  const entryText = [].concat(item.entries || []).join(' ');
  const dmgTag = entryText.match(/\{@damage\s+([^}]+)\}/i);
  const rawDmg = dmgTag ? dmgTag[1] : (entryText.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0] || '');
  const dmgStr = rawDmg.replace(/\s+/g, '');
  if (!dmgStr) return;
  sRollDamageStr((item.name || '') + ' Dmg', dmgStr);
}

function sMonsterUseAction(section, idx) {
  if (!sMonsterData) return;
  const item = (sMonsterData[section] || [])[idx];
  if (!item) return;
  const sender   = (sSelectedToken?.label || sMonsterData.name || 'Monster').slice(0, 40);
  const rawText  = [].concat(item.entries || []).map(e => {
    if (typeof e === 'string') return _sPlainEntry(e);
    if (e && e.type === 'list' && Array.isArray(e.items))
      return e.items.map(i => '• ' + _sPlainEntry(typeof i === 'string' ? i : (i.name || ''))).join(' ');
    return '';
  }).filter(Boolean).join(' ');
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({ sender, type: 'text', message: (item.name || 'Action') + ': ' + rawText }),
  }).catch(() => {});
}

function sRenderMonsterStats(tok) {
  const container = document.getElementById('s-char-stats');
  if (!container) return;
  if (!tok || tok.type !== 'monster' || !sIsDM() || !sMonsterData) {
    container.style.display = 'none';
    _sShowActionsTab(false);
    return;
  }
  const d          = sMonsterData;
  const cr         = (d.cr && typeof d.cr === 'object') ? d.cr.cr : (d.cr || '?');
  const dexMod     = Math.floor(((d.dex || 10) - 10) / 2);
  const initStr    = (dexMod >= 0 ? '+' : '') + dexMod;
  const displayName = tok.label || tok.name;

  function rActionItem(item, section, idx) {
    const entryText = [].concat(item.entries || []).join(' ');
    const atkMatch  = entryText.match(/\{@hit\s([+-]?\d+)\}/i);
    const dmgTag    = entryText.match(/\{@damage\s+([^}]+)\}/i);
    const rawDmg    = dmgTag ? dmgTag[1] : (entryText.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0] || '');
    const dmgStr    = rawDmg.replace(/\s+/g, '');
    const useBtn    = `<button class="s-btn" onclick="sMonsterUseAction('${section}',${idx})" style="flex:none;padding:4px 7px;min-height:30px;font-size:10px;background:rgba(100,150,255,.18);color:#aaf">Use</button>`;
    if (atkMatch) {
      const bonus = parseInt(atkMatch[1]);
      const bStr  = (bonus >= 0 ? '+' : '') + bonus;
      const dmgRow = dmgStr
        ? `<div class="s-qroll-row" onclick="sMonsterRollDamage('${section}',${idx})" style="padding-left:20px;background:rgba(0,0,0,.2)">
            <span class="s-qroll-label" style="color:var(--txd);font-size:11px">↳ Damage</span>
            <span class="s-qroll-val" style="color:#ff9966">${esc(dmgStr)}</span>
          </div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:2px">
        <div class="s-qroll-row" style="flex:1;margin:0" onclick="sMonsterRollAction('${section}',${idx})" title="${esc(_sPlainEntry(entryText).slice(0, 120))}">
          <span class="s-qroll-label">${esc(item.name || '')}</span>
          <span class="s-qroll-val">${bStr}</span>
        </div>${useBtn}</div>${dmgRow}`;
    }
    return `<div style="display:flex;align-items:center;gap:2px;padding:3px 4px">
      <span style="flex:1;font-size:12px;color:var(--ac);font-weight:bold;font-style:italic">${esc(item.name || '')}</span>
      ${useBtn}</div>`;
  }

  function rGroup(items, title, section) {
    if (!items || !items.length) return '';
    return `<div class="s-qroll-section">
      <div class="s-qroll-hdr" onclick="sToggleStatsSection('mon-${section}')">
        ${title} <span id="s-stats-mon-${section}-arrow">▶</span>
      </div>
      <div id="s-stats-mon-${section}" class="s-qroll-rows" style="display:none">
        ${items.map((item, idx) => rActionItem(item, section, idx)).join('')}
      </div>
    </div>`;
  }

  container.style.display = '';
  container.innerHTML = `
    <div class="s-stats-header">
      <span style="color:#ff9999">${esc(displayName)}<span style="color:var(--txd);font-weight:normal;font-size:11px"> CR ${esc(String(cr))}</span></span>
      <button class="s-btn" onclick="sQrollRoll('Initiative','${initStr}')" style="flex:none;padding:5px 10px;font-size:11px;min-height:32px">🎲 Init ${initStr}</button>
    </div>
    <div class="s-roll-mode-row">
      <span class="s-label" style="padding-right:6px">Roll:</span>
      <button id="s-roll-mode-norm" class="s-roll-mode-btn active" onclick="sSetRollMode('norm')">Normal</button>
      <button id="s-roll-mode-adv"  class="s-roll-mode-btn" onclick="sSetRollMode('adv')">Adv</button>
      <button id="s-roll-mode-dis"  class="s-roll-mode-btn" onclick="sSetRollMode('dis')">Dis</button>
    </div>
    ${rGroup(d.trait,     'Traits',        'trait')}
    ${rGroup(d.action,    'Actions',       'action')}
    ${rGroup(d.bonus,     'Bonus Actions', 'bonus')}
    ${rGroup(d.reaction,  'Reactions',     'reaction')}
    ${rGroup(d.legendary, 'Legendary',     'legendary')}`;
  sSetRollMode(sRollMode);
  _sShowActionsTab(true);
}

function sRenderMonsterStatBlock(data, tok) {
  const SZ = {T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
  const AL = {L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
  const size    = (data.size || []).map(s => SZ[s] || s).join('/');
  const typeStr = typeof data.type === 'string' ? data.type
    : data.type ? (data.type.type || '') + (data.type.tags?.length ? ' (' + data.type.tags.join(', ') + ')' : '') : '';
  const align   = (data.alignment || []).map(a => AL[a] || a).join(' ');
  const cr      = (data.cr && typeof data.cr === 'object') ? data.cr.cr : (data.cr || '—');
  const acStr   = !data.ac ? '—' : [].concat(data.ac).map(a =>
    typeof a === 'number' ? a : typeof a === 'object'
      ? String(a.ac || '') + ([].concat(a.from || []).length ? ' (' + [].concat(a.from).join(', ') + ')' : '') : a
  ).join(', ');
  const hpStr   = !data.hp ? '—' : data.hp.average !== undefined
    ? String(data.hp.average) + (data.hp.formula ? ' (' + data.hp.formula + ')' : '') : String(data.hp);
  const speedParts = [];
  if (data.speed) {
    if (data.speed.walk)   speedParts.push(data.speed.walk + ' ft.');
    if (data.speed.fly)    speedParts.push('fly ' + data.speed.fly + ' ft.');
    if (data.speed.swim)   speedParts.push('swim ' + data.speed.swim + ' ft.');
    if (data.speed.climb)  speedParts.push('climb ' + data.speed.climb + ' ft.');
    if (data.speed.burrow) speedParts.push('burrow ' + data.speed.burrow + ' ft.');
  }
  const speedStr   = speedParts.join(', ') || '—';
  const scores     = ['str','dex','con','int','wis','cha'];
  const snames     = ['STR','DEX','CON','INT','WIS','CHA'];
  const immuneStr  = [].concat(data.immune || []).map(i => typeof i === 'string' ? i : [].concat(i.immune || []).join('/')).join(', ');
  const resistStr  = [].concat(data.resist || []).map(i => typeof i === 'string' ? i : [].concat(i.resist || []).join('/')).join(', ');
  const condImmStr = [].concat(data.conditionImmune || []).map(i => typeof i === 'string' ? i : [].concat(i.conditionImmune || []).join('/')).join(', ');
  const sensesStr  = [...(data.senses || [])].join(', ') + (data.passive ? ((data.senses || []).length ? ', ' : '') + 'Passive Perception ' + data.passive : '');
  const langStr    = (data.languages || []).join(', ') || '—';
  const HR         = '<hr style="border:none;border-top:1px solid var(--a44);margin:6px 0">';

  function rEntries(entries) {
    return (entries || []).map(e => {
      if (typeof e === 'string') return '<p style="margin:2px 0 3px">' + _sParseEntry(e) + '</p>';
      if (e && e.type === 'list' && Array.isArray(e.items))
        return '<ul style="margin:2px 0 3px;padding-left:14px">' + e.items.map(i => '<li>' + _sParseEntry(typeof i === 'string' ? i : (i.name || '')) + '</li>').join('') + '</ul>';
      return '';
    }).join('');
  }

  function rTextSection(items, title) {
    if (!items || !items.length) return '';
    return HR + '<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">' + title + '</div>' +
      items.map(item => '<div style="margin:4px 0"><span style="color:var(--ac);font-weight:bold;font-style:italic">' + _sParseEntry(item.name || '') + '</span> ' + rEntries(item.entries) + '</div>').join('');
  }

  function rActionSection(items, title, section) {
    if (!items || !items.length) return '';
    return HR + '<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:3px">' + title + '</div>' +
      items.map((item, idx) => {
        const entryText = [].concat(item.entries || []).join(' ');
        const atkMatch  = entryText.match(/\{@hit\s([+-]?\d+)\}/i);
        const dmgTag    = entryText.match(/\{@damage\s+([^}]+)\}/i);
        const rawDmg    = dmgTag ? dmgTag[1] : (entryText.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0] || '');
        const dmgStr    = rawDmg.replace(/\s+/g, '');
        let rollBtns    = '';
        if (atkMatch) {
          const bonus = parseInt(atkMatch[1]);
          const bStr  = (bonus >= 0 ? '+' : '') + bonus;
          rollBtns = `<button class="s-btn" onclick="sMonsterRollAction('${section}',${idx})" style="padding:2px 7px;min-height:26px;font-size:10px;flex:none">${bStr} Atk</button>`;
          if (dmgStr) rollBtns += `<button class="s-btn" onclick="sMonsterRollDamage('${section}',${idx})" style="padding:2px 7px;min-height:26px;font-size:10px;flex:none;background:rgba(255,150,100,.15);color:#ff9966">${esc(dmgStr)}</button>`;
        }
        rollBtns += `<button class="s-btn" onclick="sMonsterUseAction('${section}',${idx})" style="padding:2px 7px;min-height:26px;font-size:10px;flex:none;background:rgba(100,150,255,.15);color:#aaf">Use</button>`;
        return `<div style="margin:5px 0">
          <div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin-bottom:2px">
            <span style="color:var(--ac);font-weight:bold;font-style:italic;flex:1;min-width:0">${_sParseEntry(item.name || '')}</span>
            <div style="display:flex;gap:3px;flex-shrink:0">${rollBtns}</div>
          </div>
          ${rEntries(item.entries)}
        </div>`;
      }).join('');
  }

  let html = '';
  if (data.portraitMedium || data.portrait) {
    html += `<div style="text-align:center;margin-bottom:8px"><img src="${esc(data.portraitMedium || data.portrait)}" style="max-width:120px;max-height:120px;border-radius:6px;object-fit:cover;border:1px solid var(--a44)" onerror="this.style.display='none'"></div>`;
  }
  html += `<div style="font-size:15px;font-weight:bold;color:#ff9999">${esc(tok?.label ? tok.label + ' (' + (data.name || '') + ')' : (data.name || 'Monster'))}</div>`;
  if (size || typeStr || align) html += `<div style="font-size:11px;font-style:italic;color:var(--txd);margin-bottom:4px">${esc([size, typeStr, align].filter(Boolean).join(', '))}${data.source ? ' <span style="font-size:10px;opacity:.6">(' + esc(data.source) + ')</span>' : ''}</div>`;
  html += HR;
  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">AC</span> ${esc(String(acStr))}</div>`;
  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">HP</span> ${esc(String(hpStr))}</div>`;
  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Speed</span> ${esc(speedStr)}</div>`;
  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Challenge</span> ${esc(String(cr))}</div>`;
  html += HR + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:2px;text-align:center;margin:4px 0">';
  for (let i = 0; i < 6; i++) {
    const sc = scores[i], val = data[sc] || 10, m = Math.floor((val - 10) / 2), ms = (m >= 0 ? '+' : '') + m;
    html += `<div onclick="sQrollRoll('${snames[i]} Check','${ms}')" style="background:var(--bg3);border-radius:3px;padding:3px 1px;cursor:pointer">
      <div style="font-size:8px;color:var(--ac);font-weight:bold">${snames[i]}</div>
      <div style="font-size:12px;font-weight:bold">${val}</div>
      <div style="font-size:9px;color:var(--txd)">${ms}</div>
    </div>`;
  }
  html += '</div>' + HR;
  html += '<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin-bottom:2px">Saves</div>';
  html += scores.map((sc, i) => {
    const profVal = data.save && data.save[sc];
    const rawMod  = Math.floor(((data[sc] || 10) - 10) / 2);
    const val     = profVal || (rawMod >= 0 ? '+' + rawMod : '' + rawMod);
    return `<div class="s-qroll-row" onclick="sQrollRoll('${snames[i]} Save','${val}')" style="${profVal ? '' : 'opacity:.7'}">
      <span>${snames[i]}${profVal ? ' ★' : ''}</span><span class="s-qroll-val">${val}</span>
    </div>`;
  }).join('');
  if (data.skill && Object.keys(data.skill).length) {
    html += '<div style="font-size:10px;color:var(--ac);text-transform:uppercase;font-weight:bold;letter-spacing:.5px;margin:4px 0 2px">Skills</div>';
    html += Object.entries(data.skill).map(([key, val]) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return `<div class="s-qroll-row" onclick="sQrollRoll('${label}','${val}')"><span>${label}</span><span class="s-qroll-val">${val}</span></div>`;
    }).join('');
  }
  if (immuneStr)  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Immune</span> ${esc(immuneStr)}</div>`;
  if (resistStr)  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Resist</span> ${esc(resistStr)}</div>`;
  if (condImmStr) html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Cond. Immune</span> ${esc(condImmStr)}</div>`;
  if (sensesStr)  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Senses</span> ${esc(sensesStr)}</div>`;
  html += `<div style="margin:2px 0"><span style="color:var(--ac);font-weight:bold">Languages</span> ${esc(langStr)}</div>`;
  html += rTextSection(data.trait, 'Traits');
  html += rActionSection(data.action,    'Actions',           'action');
  html += rActionSection(data.bonus,     'Bonus Actions',     'bonus');
  html += rActionSection(data.reaction,  'Reactions',         'reaction');
  html += rActionSection(data.legendary, 'Legendary Actions', 'legendary');
  if (data.mythic?.length) html += rTextSection(data.mythic, 'Mythic Actions');
  return html;
}

function sRenderMonsterTab(tok) {
  const tabBtn = document.getElementById('s-tab-btn-monster');
  const panel  = document.getElementById('s-monster-panel');
  const empty  = document.getElementById('s-monster-empty');
  if (!sIsDM() || !tok || tok.type !== 'monster' || !sMonsterData) {
    if (tabBtn) tabBtn.style.display = 'none';
    if (sCurrentTab === 'monster') sShowTab('hp');
    return;
  }
  if (tabBtn) tabBtn.style.display = '';
  if (!panel || !empty) return;
  panel.style.display = '';
  empty.style.display = 'none';
  panel.innerHTML = sRenderMonsterStatBlock(sMonsterData, tok);
  if (sCurrentTab !== 'monster') {
    const dot = document.getElementById('s-monster-dot');
    if (dot) dot.classList.add('show');
  }
}

function _sShowActionsTab(show) {
  const btn = document.getElementById('s-tab-btn-actions');
  if (!btn) return;
  btn.style.display = show ? '' : 'none';
  if (!show && sCurrentTab === 'actions') sShowTab('hp');
  if (show && sCurrentTab !== 'actions') {
    const dot = document.getElementById('s-actions-dot');
    if (dot) dot.classList.add('show');
  }
}

async function sFetchCharStats(tok) {
  sQrollData     = null;
  sQrollCharName = '';
  sMonsterData   = null;

  if (tok && tok.type === 'monster' && tok.linkedId && sIsDM()) {
    try {
      const r = await fetch(`/api/monsters/${tok.linkedId}`, { headers: { 'X-Master-Password': masterPw } });
      if (r.ok) {
        const mon = await r.json();
        sMonsterData = mon.data || {};
        if (sSelectedToken?.id === tok.id && sSelectedTokenAc == null && sMonsterData.ac) {
          const acRaw = [].concat(sMonsterData.ac)[0];
          sSelectedTokenAc = typeof acRaw === 'number' ? acRaw : (acRaw?.ac != null ? parseInt(acRaw.ac) : null);
          sRenderHpPanel(sSelectedToken);
        }
      }
    } catch {}
    sRenderMonsterStats(tok);
    sRenderMonsterTab(tok);
    return;
  }

  sRenderMonsterStats(null);
  sRenderMonsterTab(null);

  if (!tok || tok.type === 'monster' || !tok.linkedId || !(sIsDM() || sIsMyToken(tok))) {
    sRenderCharStats(tok);
    return;
  }
  try {
    const url     = sIsDM() ? `/api/characters/${tok.linkedId}` : `/api/characters/${tok.linkedId}/qroll`;
    const headers = sIsDM() ? { 'X-Character-Password': masterPw }
                             : (sessionCharPw ? { 'X-Character-Password': sessionCharPw } : {});
    const r = await fetch(url, { headers });
    if (r.ok) {
      const char   = await r.json();
      sQrollCharName = char.name || tok.name;
      sQrollData   = char.data || {};
    }
  } catch {}
  sRenderCharStats(tok);
}

// ── HP Tracker List (DM tab) ──────────────────────────────────────────────────
function sRenderDmHpList() {
  const list = document.getElementById('s-dm-hp-list');
  if (!list) return;
  const visible = sIsDM()
    ? sTokens
    : sTokens.filter(t => t.visible !== false && (t.type !== 'monster' || !!t.assignedCharId));
  if (visible.length === 0) { list.innerHTML = '<div class="s-empty-msg-small">No tokens on map.</div>'; return; }
  const activeTokId = sGetActiveTokId();
  list.innerHTML = visible.map(tok => {
    const cur = tok.hpCurrent || 0;
    const max = tok.hpMax     || 0;
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    const col = sHpColor(pct);
    const isCur = tok.id === activeTokId;
    const canSel = sIsDM() || sIsMyToken(tok);
    const isSel  = sSelectedToken?.id === tok.id;
    return `<div class="s-hp-row${isCur ? ' s-hp-cur' : ''}${isSel ? ' s-hp-selected' : ''}${canSel ? ' clickable' : ''}" ${canSel ? `onclick="sSelectToken('${tok.id}')"` : ''}>
      <div style="flex:1;min-width:0">
        <div class="s-hp-row-name">${isCur ? '▶ ' : ''}${esc(sTokDisplayName(tok))}</div>
        <div class="s-hp-bar-mini"><div style="width:${pct*100}%;height:100%;background:${col};border-radius:2px"></div></div>
      </div>
      <div class="s-hp-row-nums">${cur}<span style="color:var(--txd);font-weight:normal">/${max}</span></div>
    </div>`;
  }).join('');
}

function sSelectToken(id) {
  const tok = sTokens.find(t => t.id === id);
  if (!tok) return;
  sSelectedToken   = tok;
  sSelectedTokenAc = null;
  sShowTab('hp');
  sRenderHpPanel(tok);
  sFetchCharStats(tok);
  if (tok.linkedId && tok.type !== 'monster') {
    fetch(`/api/characters/${tok.linkedId}/qroll`)
      .then(r => r.ok ? r.json() : null)
      .then(c => {
        if (!c) return;
        const ac = c.data?.ac;
        sSelectedTokenAc = (ac != null && ac !== '') ? (parseInt(ac) || null) : null;
        if (sSelectedToken?.id === tok.id) sRenderHpPanel(sSelectedToken);
      }).catch(() => {});
  }
}

// ── Fog Regions (DM tab) ──────────────────────────────────────────────────────
function sRenderFogSection() {
  const section = document.getElementById('s-fog-section');
  if (!section) return;
  const show = sIsDM() && sFogRegions.length > 0;
  section.style.display = show ? '' : 'none';
  if (!show) return;
  const list = document.getElementById('s-fog-list');
  if (!list) return;
  list.innerHTML = sFogRegions.map(r => `
    <div class="s-fog-row">
      <span class="s-fog-name" style="color:${r.visible ? 'var(--ok)' : 'var(--txd)'}">${esc(r.label || 'Region')}</span>
      ${!r.visible
        ? `<button class="s-btn s-btn-success" onclick="sRevealFog('${r.id}')" style="flex:none;padding:5px 10px;min-height:34px;font-size:12px">Reveal</button>`
        : `<button class="s-btn"               onclick="sHideFog('${r.id}')"   style="flex:none;padding:5px 10px;min-height:34px;font-size:12px">Hide</button>`}
    </div>`).join('');
}

async function sRevealFog(id) {
  try { await fetch(`/api/table/fog/${id}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
async function sHideFog(id) {
  try { await fetch(`/api/table/fog/${id}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

// ── Hidden Items (DM tab) ─────────────────────────────────────────────────────
const S_ITEM_ICONS = { trap: '⚠', chest: '◈', door: '▭', note: '✎', other: '◉' };

function sRenderItemsSection() {
  const section = document.getElementById('s-items-section');
  if (!section) return;
  const show = sIsDM() && sHiddenItems.length > 0;
  section.style.display = show ? '' : 'none';
  if (!show) return;
  const list = document.getElementById('s-items-list');
  if (!list) return;
  list.innerHTML = sHiddenItems.map(item => `
    <div class="s-item-row">
      <div class="s-item-header" onclick="sToggleItemBody('${item.id}')">
        <span class="s-item-icon">${S_ITEM_ICONS[item.type] || '?'}</span>
        <span class="s-item-name" style="color:${item.visible ? 'var(--ok)' : 'var(--txd)'}">${esc(item.label || 'Item')}</span>
        ${!item.visible
          ? `<button class="s-btn s-btn-success" onclick="event.stopPropagation();sRevealItem('${item.id}')" style="flex:none;padding:4px 8px;min-height:30px;font-size:11px">Reveal</button>`
          : `<button class="s-btn"               onclick="event.stopPropagation();sHideItem('${item.id}')"   style="flex:none;padding:4px 8px;min-height:30px;font-size:11px">Hide</button>`}
      </div>
      <div id="s-item-body-${item.id}" class="s-item-body" style="display:none">
        ${item.description
          ? `<div style="font-size:11px;color:var(--txd);white-space:pre-wrap">${esc(item.description)}</div>`
          : '<div style="font-size:11px;color:var(--a55);font-style:italic">No description.</div>'}
      </div>
    </div>`).join('');
}

function sToggleItemBody(id) {
  const body = document.getElementById(`s-item-body-${id}`);
  if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
}
async function sRevealItem(id) {
  try { await fetch(`/api/table/items/${id}/reveal`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
async function sHideItem(id) {
  try { await fetch(`/api/table/items/${id}/hide`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

// ── Initiative Actions ────────────────────────────────────────────────────────
async function sNextTurn() {
  try { const h = sIsDM() ? { 'X-Master-Password': masterPw } : {}; await fetch('/api/initiative/next', { method: 'POST', headers: h }); } catch {}
}
async function sPrevTurn() {
  try { const h = sIsDM() ? { 'X-Master-Password': masterPw } : {}; await fetch('/api/initiative/prev', { method: 'POST', headers: h }); } catch {}
}
async function sToggleInitiative() {
  if (!sIsDM()) return;
  try {
    await fetch(sInitData.currentId ? '/api/initiative/end' : '/api/initiative/start', {
      method: 'POST', headers: { 'X-Master-Password': masterPw },
    });
  } catch {}
}
async function sRollMyInitiative() {
  const name = prompt('Your name for initiative:');
  if (!name) return;
  const bonus = parseInt(prompt('Initiative bonus:', '0')) || 0;
  const roll  = Math.ceil(Math.random() * 20) + bonus;
  try {
    await fetch('/api/initiative/roll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), roll }),
    });
  } catch {}
}
async function sRemoveInitEntry(id) {
  if (!sIsDM()) return;
  const entry = sInitData.entries?.find(e => e.id === id);
  if (!entry || !confirm(`Remove "${entry.name}"?`)) return;
  try {
    await fetch(`/api/initiative/${id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
      body: JSON.stringify({}),
    });
  } catch {}
}
async function sRollTokenInit() {
  if (!sSelectedToken || !sIsDM()) return;
  const roll     = Math.ceil(Math.random() * 20);
  const tok      = sSelectedToken;
  const existing = sInitData.entries.find(e => e.id === tok.initiativeId);
  try {
    if (existing) {
      await fetch(`/api/initiative/${tok.initiativeId}/roll`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ roll }),
      });
    } else {
      const res = await fetch('/api/initiative/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ name: tok.name, roll, monsterId: tok.linkedId || '' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.id) await fetch(`/api/table/tokens/${tok.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
          body: JSON.stringify({ initiativeId: data.id }),
        });
      }
    }
  } catch {}
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function sSendChat() {
  const input = document.getElementById('s-chat-input');
  const msg   = (input?.value || '').trim();
  if (!msg) return;
  input.value = '';
  const rollMatch = msg.match(/^\/r\s+(.+)/i);
  if (rollMatch) { sRollDiceExpr(rollMatch[1]); return; }
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({ type: 'text', message: msg, sender: sGetSender() }),
  }).catch(() => {});
}

function sRollDie(sides) { sRollDiceExpr(`d${sides}`); }

function sRollDiceExpr(expr) {
  const m = expr.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return;
  const count   = parseInt(m[1] || '1');
  const sides   = parseInt(m[2]);
  const mod     = parseInt(m[3] || '0');
  const results = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
  const total   = results.reduce((a, b) => a + b, 0) + mod;
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({
      type: 'roll', dice: expr.trim(), results, modifier: mod,
      total, sender: sGetSender(), rollId: Math.random().toString(36).slice(2),
    }),
  }).catch(() => {});
}

// ── DM Map Operations ─────────────────────────────────────────────────────────
async function sLoadPrepMaps() {
  if (!sIsDM()) return;
  try {
    const res = await fetch('/api/prepared-maps', { headers: { 'X-Master-Password': masterPw } });
    if (!res.ok) return;
    sPrepMaps = await res.json();
    const sel = document.getElementById('s-map-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select Map —</option>' +
      sPrepMaps.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  } catch {}
}
async function sLoadMap() {
  const mapId = document.getElementById('s-map-sel')?.value;
  if (!mapId || !sIsDM()) return;
  try { await fetch(`/api/prepared-maps/${mapId}/load-to-table`, { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
async function sClearTokens() {
  if (!sIsDM() || !confirm('Remove all tokens and clear initiative?')) return;
  try { await fetch('/api/table/clear', { method: 'POST', headers: { 'X-Master-Password': masterPw } }); } catch {}
}
function sOpenAddTokenOnPrimary() { _sConsolePost({ type: 'OPEN_ADD_TOKEN' }); }

// ── SSE ───────────────────────────────────────────────────────────────────────
function sStartSSE() {
  connectRealtime({
    table: d => {
      if (d.action === 'token-added') {
        if (!sTokens.find(t => t.id === d.token.id)) sTokens.push(d.token);
        if (sCurrentTab === 'dm') sRenderDmHpList();
      } else if (d.action === 'token-moved') {
        const t = sTokens.find(t => t.id === d.id);
        if (t) Object.assign(t, { x: d.x, y: d.y, movedFt: d.movedFt });
        if (sCurrentTab === 'dm') sRenderDmHpList();
      } else if (d.action === 'token-updated') {
        const idx = sTokens.findIndex(t => t.id === d.token.id);
        if (idx >= 0) sTokens[idx] = d.token; else sTokens.push(d.token);
        if (sSelectedToken?.id === d.token.id) {
          sSelectedToken = d.token;
          if (sCurrentTab === 'hp') sRenderHpPanel(d.token);
        }
        if (sCurrentTab === 'dm') sRenderDmHpList();
      } else if (d.action === 'token-removed') {
        sTokens = sTokens.filter(t => t.id !== d.id);
        if (sSelectedToken?.id === d.id) { sSelectedToken = null; sRenderHpPanel(null); }
        if (sCurrentTab === 'dm') sRenderDmHpList();
      } else if (d.action === 'tokens-cleared') {
        sTokens = []; sSelectedToken = null;
        sRenderHpPanel(null);
        if (sCurrentTab === 'dm') sRenderDmHpList();
      } else if (d.action === 'map-updated' || d.action === 'state-updated') {
        fetch('/api/table').then(r => r.json()).then(({ tokens, state }) => {
          sTokens      = tokens || [];
          sFogRegions  = state?.fogRegions  || [];
          sHiddenItems = state?.hiddenItems || [];
          if (sCurrentTab === 'dm') { sRenderDmHpList(); sRenderFogSection(); sRenderItemsSection(); }
          if (sSelectedToken) {
            const upd = sTokens.find(t => t.id === sSelectedToken.id);
            if (upd && sCurrentTab === 'hp') sRenderHpPanel(upd);
          }
        }).catch(() => {});
      } else if (d.action === 'fog-updated') {
        sFogRegions = d.fogRegions || [];
        if (sCurrentTab === 'dm') sRenderFogSection();
      } else if (d.action === 'items-updated') {
        sHiddenItems = d.hiddenItems || [];
        if (sCurrentTab === 'dm') sRenderItemsSection();
      }
    },
    initiative: async () => {
      try { const r = await fetch('/api/initiative'); if (r.ok) sInitData = await r.json(); } catch {}
      sRenderInitiative();
      if (sCurrentTab === 'dm') sRenderDmHpList();
    },
    chat: entry => {
      appendChatEntry(entry);
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
      if (sCurrentTab !== 'chat') {
        sChatUnread++;
        const dot = document.getElementById('s-chat-dot');
        if (dot) dot.classList.add('show');
      }
    },
    'chat-clear':  () => { const log = document.getElementById('chat-log'); if (log) log.innerHTML = ''; },
    'chat-delete': d  => { const div = document.querySelector(`[data-entry-id="${CSS.escape(d.id)}"]`); if (div) div.remove(); },
  });
}

// ── Console relay SSE ─────────────────────────────────────────────────────────
function _sStartConsoleSSE() {
  if (_sConsoleEs) _sConsoleEs.close();
  _sConsoleEs = new EventSource('/api/console/events');
  // Send SECONDARY_READY only after the SSE connection is confirmed open.
  // Posting it immediately races with the EventSource GET — the server may
  // broadcast STATE_SNAPSHOT/TOKEN_SELECTED before this client is registered,
  // causing the secondary to miss the snapshot.  onopen fires on reconnects
  // too, so state is automatically re-synced after a drop.
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
      sRenderInitiative();
      if (sCurrentTab === 'dm') sRenderDmHpList();
    }
    if (type === 'TOKEN_SELECTED') {
      const tok = d.token;
      // Non-DM players should not see unowned monster tokens
      if (!sIsDM() && tok.type === 'monster' && !sIsMyToken(tok)) return;
      sSelectedToken   = tok;
      sSelectedTokenAc = null;
      if (tok.linkedId && tok.type !== 'monster') {
        fetch(`/api/characters/${tok.linkedId}/qroll`)
          .then(r => r.ok ? r.json() : null)
          .then(c => {
            if (!c) return;
            const ac = c.data?.ac;
            sSelectedTokenAc = (ac != null && ac !== '') ? (parseInt(ac) || null) : null;
            if (sSelectedToken?.id === tok.id) sRenderHpPanel(sSelectedToken);
          }).catch(() => {});
      }
      sFetchCharStats(tok);
      sShowTab('hp');
    }
    if (type === 'TOKEN_CLEARED') {
      sSelectedToken = null;
      sQrollData     = null;
      sMonsterData   = null;
      if (sCurrentTab === 'hp') sRenderHpPanel(null);
      sRenderMonsterTab(null);
      _sShowActionsTab(false);
    }
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  if (!sLoadSession()) return; // gate is showing, skip init until after reload
  sApplyBadges();

  try {
    const [tableRes, initRes, charsRes] = await Promise.all([
      fetch('/api/table'),
      fetch('/api/initiative'),
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

  sRenderInitiative();
  if (sIsDM()) sLoadPrepMaps();

  fetch('/api/chat').then(r => r.ok ? r.json() : [])
    .then(entries => {
      entries.forEach(appendChatEntry);
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }).catch(() => {});

  sStartSSE();
  _sStartConsoleSSE();

  window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/console/event',
      new Blob([JSON.stringify({ type: 'SECONDARY_CLOSED' })], { type: 'application/json' }));
    if (_sConsoleEs) _sConsoleEs.close();
  });
});
