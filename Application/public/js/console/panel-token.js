// Written by Irmak Hakman — 2026-10-10 23:39
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: Token tab ────────────────────────────────────────────────────
// Everything about the one selected token. A token is selected by tapping it on
// the map screen, a row on the Turn tab, or (DM) a row on the Table tab.
//
// The tab is split into parts, switched with the strip under the header:
//   Health      damage, healing, temporary hit points, conditions
//   Skills, Combat, Spells, Items
//               a player character's sheet (js/console/panel-sheet.js)
//   Rolls       a monster's actions (DM)
//   Stat block  the full monster stat block (DM)
//   Manage      DM-only: initiative, hide, assign to a player, delete
// A part that does not apply to the selected token is not offered.

const S_TOKEN_PANES = ['health', 'skills', 'combat', 'spells', 'items', 'rolls', 'block', 'manage'];
const S_SHEET_PANES = ['skills', 'combat', 'spells', 'items'];

// ── Selecting ────────────────────────────────────────────────────────────────
// Called by a tap (or the pad) on this screen. The map screen is told too, so
// the same token is selected there and the sticks and arrows move it.
function sSelectToken(id) {
  const tok = sTokens.find(t => t.id === id);
  if (!tok) return;
  sSelectTokenObj(tok, true);
  _sConsolePost({ type: 'SELECT_TOKEN', id });
}

/**
 * Makes `tok` the selected token and loads what the Token tab shows about it.
 * @param {object} tok
 * @param {boolean} openTab  switch to the Token tab as well
 */
function sSelectTokenObj(tok, openTab) {
  const changed = !sSelectedToken || sSelectedToken.id !== tok.id;
  sSelectedToken   = tok;
  sSelectedTokenAc = null;
  if (changed) sTokenPane = 'health';

  if (openTab) sShowTab('token');
  else {
    if (sCurrentTab === 'token') sRenderHpPanel(tok);
    else sMark('token', true);
  }

  // A character's armour class lives on its sheet, not on the token.
  if (tok.linkedId && tok.type !== 'monster') {
    // qroll needs a login since v240.
    fetch(`/api/characters/${tok.linkedId}/qroll`, { headers: sAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(c => {
        if (!c) return;
        const ac = c.data?.ac;
        sSelectedTokenAc = (ac != null && ac !== '') ? (parseInt(ac) || null) : null;
        if (sSelectedToken?.id === tok.id) sRenderHpPanel(sSelectedToken);
      }).catch(() => {});
  }
  sFetchCharStats(tok);
}

function sClearSelection() {
  sSelectedToken = null;
  sSelectedTokenAc = null;
  sQrollData = null;
  sMonsterData = null;
  if (sCurrentTab === 'token') sRenderHpPanel(null);
}

// ── Which parts apply ────────────────────────────────────────────────────────
function sTokenPanes(tok) {
  if (!tok) return [];
  const panes = ['health'];
  const isMonster = tok.type === 'monster';
  if (!isMonster && sQrollData && (sIsDM() || sIsMyToken(tok))) panes.push(...S_SHEET_PANES);
  if (isMonster && sIsDM() && sMonsterData) panes.push('rolls', 'block');
  if (sIsDM()) panes.push('manage');
  return panes;
}

function sSetTokenPane(name) {
  sTokenPane = name;
  sRenderHpPanel(sSelectedToken);
}

// ── Rendering ────────────────────────────────────────────────────────────────
// (Still called sRenderHpPanel: it is the function every live update calls.)
function sRenderHpPanel(tok) {
  const panel = sEl('s-token-panel');
  const empty = sEl('s-token-empty');
  if (!panel || !empty) return;

  // A player may not open a monster that is not theirs.
  if (!tok || (!sIsDM() && tok.type === 'monster' && !sIsMyToken(tok))) {
    panel.hidden = true;
    empty.hidden = false;
    return;
  }
  panel.hidden = false;
  empty.hidden = true;

  const cur  = tok.hpCurrent || 0;
  const max  = tok.hpMax || 0;
  const temp = tok.hpTemp || 0;
  const pct  = sHpPct(cur, max);

  sEl('s-hp-name').textContent = sTokDisplayName(tok);
  sEl('s-hp-name').classList.toggle('foe', tok.type === 'monster');
  sEl('s-hp-ac').textContent = sSelectedTokenAc != null ? sSelectedTokenAc : '—';
  sEl('s-hp-cur').textContent = cur;
  sEl('s-hp-cur').classList.toggle('low', sHpLow(pct));
  sEl('s-hp-max').textContent = max;
  sEl('s-hp-temp-wrap').hidden = temp <= 0;
  sEl('s-hp-temp').textContent = temp;
  const bar = sEl('s-hp-bar');
  bar.style.width = `${Math.round(pct * 100)}%`;
  bar.classList.toggle('low', sHpLow(pct));

  // The strip: only the parts that apply, and none at all when Health is the only one.
  const panes = sTokenPanes(tok);
  if (!panes.includes(sTokenPane)) sTokenPane = 'health';
  const seg = sEl('s-token-seg');
  seg.hidden = panes.length < 2;
  seg.querySelectorAll('button').forEach(b => {
    b.hidden = !panes.includes(b.dataset.pane);
    b.setAttribute('aria-selected', String(b.dataset.pane === sTokenPane));
  });
  for (const p of S_TOKEN_PANES) sEl(`s-pane-${p}`).hidden = p !== sTokenPane;

  if (sTokenPane === 'health') sRenderHealthPane(tok);
  if (S_SHEET_PANES.includes(sTokenPane)) sRenderSheetPane(sTokenPane);
  if (sTokenPane === 'rolls')  sRenderMonsterRolls(tok);
  if (sTokenPane === 'block')  sEl('s-pane-block').innerHTML = sRenderMonsterStatBlock(sMonsterData, tok);
  if (sTokenPane === 'manage') sRenderManagePane(tok);
}

function sRenderHealthPane(tok) {
  const canEdit = sIsDM() || sIsMyToken(tok);
  sEl('s-hp-edit').hidden = !canEdit;

  // Do not overwrite the box while someone is typing a number into it.
  const tempInput = sEl('s-hp-temp-input');
  if (tempInput && document.activeElement !== tempInput) tempInput.value = tok.hpTemp || 0;

  const grid = sEl('s-conds-grid');
  const active = sParseConditions(tok.conditions);
  grid.replaceChildren(...CONDITIONS.map(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'p-chip';
    btn.textContent = c;
    btn.setAttribute('aria-pressed', String(active.includes(c)));
    if (canEdit) btn.onclick = () => sToggleCondition(c);
    else btn.disabled = true;
    return btn;
  }));
}

function sRenderManagePane(tok) {
  const hidden = tok.visible === false;
  sEl('s-vis-toggle-btn').textContent = hidden ? 'Show token to players' : 'Hide token from players';

  const hasEntry = !!sInitData.entries.find(e => e.id === tok.initiativeId);
  sEl('s-roll-init-btn').textContent = hasEntry ? 'Reroll initiative' : 'Roll initiative';

  const sel = sEl('s-assign-sel');
  const pcs = sCharList.filter(c => c.char_type === 'pc');
  // Names go in as text - a player typed them.
  sel.replaceChildren(new Option('Choose a character', ''), ...pcs.map(c => new Option(c.name || '', c.id)));
  sel.value = tok.assignedCharId || '';
  sEl('s-unassign-btn').hidden = !tok.assignedCharId;
}

// ── Hit point changes ────────────────────────────────────────────────────────
// The change is drawn at once and sent after; the server's 'token-updated'
// event then confirms it (or corrects it) on every screen.
function sPutHp(fields) {
  if (!sSelectedToken) return;
  const local = sTokens.find(t => t.id === sSelectedToken.id);
  if (local) Object.assign(local, fields);
  sSelectedToken = { ...sSelectedToken, ...fields };
  sRenderHpPanel(sSelectedToken);
  if (sCurrentTab === 'table') sRenderDmHpList();
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
  const amount = Math.max(0, parseInt(sEl('s-hp-amount')?.value) || 0);
  if (amount === 0) return;
  if (mode === 'dmg') {
    // Damage eats temporary hit points first.
    const newTemp = Math.max(0, (tok.hpTemp || 0) - amount);
    const dmgRem  = Math.max(0, amount - (tok.hpTemp || 0));
    sPutHp({ hpCurrent: Math.max(0, (tok.hpCurrent || 0) - dmgRem), hpTemp: newTemp });
  } else {
    sPutHp({ hpCurrent: Math.min(tok.hpMax || 0, (tok.hpCurrent || 0) + amount) });
  }
}
function sQuickDmg(n)  { const el = sEl('s-hp-amount'); if (el) el.value = n; sApplyHp('dmg'); }
function sQuickHeal(n) { const el = sEl('s-hp-amount'); if (el) el.value = n; sApplyHp('heal'); }
function sApplyTempHp() {
  sPutHp({ hpTemp: Math.max(0, parseInt(sEl('s-hp-temp-input')?.value) || 0) });
}

function sToggleCondition(name) {
  if (!sSelectedToken) return;
  const active = sParseConditions(sSelectedToken.conditions);
  const next   = active.includes(name) ? active.filter(c => c !== name) : [...active, name];
  sPutHp({ conditions: JSON.stringify(next) });
}

// ── Manage (DM) ──────────────────────────────────────────────────────────────
async function sDeleteToken() {
  if (!sSelectedToken || !sIsDM()) return;
  const tok = sSelectedToken;
  if (!await sConfirm(`Delete the token ${tok.name}?`, 'Delete token')) return;
  try { await fetch(`/api/table/tokens/${tok.id}`, { method: 'DELETE', headers: { 'X-Master-Password': masterPw } }); } catch {}
}

function sToggleTokenVisibility() {
  if (!sSelectedToken || !sIsDM()) return;
  sPutHp({ visible: sSelectedToken.visible === false });
}

function sSaveTokenAssignment() {
  if (!sSelectedToken || !sIsDM()) return;
  const charId = sEl('s-assign-sel')?.value || '';
  if (!charId) return;
  sPutHp({ assignedCharId: charId });
}

function sUnassignToken() {
  if (!sSelectedToken || !sIsDM()) return;
  sPutHp({ assignedCharId: '' });
}

async function sRollTokenInit() {
  if (!sSelectedToken || !sIsDM()) return;
  await sRollInitFor(sSelectedToken);
}

// Rolls a d20 for one token and puts it in the initiative order (or replaces
// the roll it already has).
async function sRollInitFor(tok) {
  const roll     = Math.ceil(Math.random() * 20);
  const existing = sInitData.entries.find(e => e.id === tok.initiativeId);
  try {
    if (existing) {
      await fetch(`/api/initiative/entries/${tok.initiativeId}/roll`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Master-Password': masterPw },
        body: JSON.stringify({ roll }),
      });
    } else {
      const res = await fetch('/api/initiative/entries', {
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

// ── Rolling ──────────────────────────────────────────────────────────────────
function sSetRollMode(mode) {
  sRollMode = mode;
  document.querySelectorAll('[data-rollmode]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.rollmode === mode)));
}

// A d20 plus a modifier, posted to chat. Advantage and disadvantage roll two
// dice and keep the higher or the lower.
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
  sMark('chat', sCurrentTab !== 'chat');
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
  sMark('chat', sCurrentTab !== 'chat');
}

// The three-way strip at the top of the Rolls part.
function sRollModeHTML() {
  const opt = (mode, label) =>
    `<button type="button" role="tab" data-rollmode="${mode}" aria-selected="${sRollMode === mode}" onclick="sSetRollMode('${mode}')">${label}</button>`;
  return `<div class="c-seg p-rollmode" role="tablist" aria-label="How the d20 is rolled">
    ${opt('norm', 'Normal')}${opt('adv', 'Advantage')}${opt('dis', 'Disadvantage')}</div>`;
}

// One tappable roll row. `onclick` is ready-made JavaScript whose string
// arguments the caller has already passed through escJs().
function sRollRowHTML(label, value, onclick, sub) {
  return `<button type="button" class="p-roll${sub ? ' sub' : ''}" onclick="${onclick}">
    <span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></button>`;
}

function sGroupHTML(title, body, open) {
  return `<details class="p-group"${open ? ' open' : ''}><summary>${esc(title)}</summary>${body}</details>`;
}

// ── A monster's rolls and stat block (DM) ────────────────────────────────────
// Monster text uses 5e.tools tags such as {@hit 5} and {@damage 2d6+3}.
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

// As above but for HTML output: the text is escaped FIRST, then tags are turned
// into markup, so nothing in a monster's text can inject its own.
function _sParseEntry(s) {
  const e = String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

// The attack bonus and damage dice written into an action's text, if any.
function _sActionNumbers(item) {
  const text   = [].concat(item.entries || []).join(' ');
  const atk    = text.match(/\{@hit\s([+-]?\d+)\}/i);
  const dmgTag = text.match(/\{@damage\s+([^}]+)\}/i);
  const rawDmg = dmgTag ? dmgTag[1] : (text.match(/\d+d\d+\s*(?:[+-]\s*\d+)?/i)?.[0] || '');
  const bonus  = atk ? parseInt(atk[1]) : null;
  return {
    text,
    bonus,
    bonusStr: bonus == null ? '' : (bonus >= 0 ? '+' : '') + bonus,
    dmg: rawDmg.replace(/\s+/g, ''),
  };
}

function sMonsterRollAction(section, idx) {
  const item = (sMonsterData?.[section] || [])[idx];
  if (!item) return;
  const n = _sActionNumbers(item);
  if (n.bonus == null) return;
  sQrollRoll((item.name || '') + ' Atk', n.bonusStr);
}

function sMonsterRollDamage(section, idx) {
  const item = (sMonsterData?.[section] || [])[idx];
  if (!item) return;
  const n = _sActionNumbers(item);
  if (!n.dmg) return;
  sRollDamageStr((item.name || '') + ' Dmg', n.dmg);
}

// Posts the action's own text to chat, signed with the monster's identifier.
function sMonsterUseAction(section, idx) {
  const item = (sMonsterData?.[section] || [])[idx];
  if (!item) return;
  const sender  = (sSelectedToken?.label || sMonsterData.name || 'Monster').slice(0, 40);
  const rawText = [].concat(item.entries || []).map(e => {
    if (typeof e === 'string') return _sPlainEntry(e);
    if (e && e.type === 'list' && Array.isArray(e.items))
      return e.items.map(i => '• ' + _sPlainEntry(typeof i === 'string' ? i : (i.name || ''))).join(' ');
    return '';
  }).filter(Boolean).join(' ');
  fetch('/api/chat', {
    method: 'POST', headers: sAuthHeaders(),
    body: JSON.stringify({ sender, type: 'text', message: (item.name || 'Action') + ': ' + rawText }),
  }).catch(() => {});
  sMark('chat', sCurrentTab !== 'chat');
}

// One action: its attack roll (if it has one), its damage, and "Post" to put
// the text in chat. `section` is one of a fixed set of keys, never user text.
function sMonsterActionHTML(item, section, idx) {
  const n    = _sActionNumbers(item);
  const post = `<button type="button" class="p-post" onclick="sMonsterUseAction('${section}',${idx})">Post</button>`;
  const head = n.bonus != null
    ? `<button type="button" class="p-roll" onclick="sMonsterRollAction('${section}',${idx})">
         <span class="lbl">${esc(item.name || '')}</span><span class="val">${esc(n.bonusStr)}</span></button>`
    : `<div class="p-roll plain"><span class="lbl">${esc(item.name || '')}</span></div>`;
  const dmg = n.bonus != null && n.dmg
    ? sRollRowHTML('Damage', n.dmg, `sMonsterRollDamage('${section}',${idx})`, true) : '';
  return `<div class="p-roll-wrap">${head}${post}</div>${dmg}`;
}

const S_MONSTER_GROUPS = [
  ['action', 'Actions'], ['bonus', 'Bonus actions'], ['reaction', 'Reactions'],
  ['legendary', 'Legendary actions'], ['trait', 'Traits'],
];

function sRenderMonsterRolls(tok) {
  const pane = sEl('s-pane-rolls');
  if (!pane || !sMonsterData) return;
  const d       = sMonsterData;
  const dexMod  = Math.floor(((d.dex || 10) - 10) / 2);
  const initStr = (dexMod >= 0 ? '+' : '') + dexMod;
  const groups  = S_MONSTER_GROUPS.map(([section, title], i) => {
    const items = d[section] || [];
    if (!items.length) return '';
    return sGroupHTML(title, items.map((item, idx) => sMonsterActionHTML(item, section, idx)).join(''), i === 0);
  }).join('');
  pane.innerHTML = sRollModeHTML()
    + sRollRowHTML('Initiative', initStr, `sQrollRoll('Initiative','${escJs(initStr)}')`)
    + groups;
}

function sRenderMonsterStatBlock(data, tok) {
  if (!data) return '';
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
  const listOf     = (v, key) => [].concat(v || []).map(i => typeof i === 'string' ? i : [].concat(i[key] || []).join('/')).join(', ');
  const immuneStr  = listOf(data.immune, 'immune');
  const resistStr  = listOf(data.resist, 'resist');
  const condImmStr = listOf(data.conditionImmune, 'conditionImmune');
  const sensesStr  = [...(data.senses || [])].join(', ') + (data.passive ? ((data.senses || []).length ? ', ' : '') + 'passive Perception ' + data.passive : '');
  const langStr    = (data.languages || []).join(', ') || '—';

  const line = (label, value) => `<p class="p-sb-line"><b>${label}</b> ${esc(String(value))}</p>`;

  function entriesHTML(entries) {
    return (entries || []).map(e => {
      if (typeof e === 'string') return '<p>' + _sParseEntry(e) + '</p>';
      if (e && e.type === 'list' && Array.isArray(e.items))
        return '<ul>' + e.items.map(i => '<li>' + _sParseEntry(typeof i === 'string' ? i : (i.name || '')) + '</li>').join('') + '</ul>';
      return '';
    }).join('');
  }

  function section(items, title) {
    if (!items || !items.length) return '';
    return `<h3 class="p-sb-h">${title}</h3>` + items.map(item =>
      `<div class="p-sb-item"><b>${_sParseEntry(item.name || '')}.</b> ${entriesHTML(item.entries)}</div>`).join('');
  }

  let html = '<div class="p-sb">';
  if (data.portraitMedium || data.portrait) {
    html += `<img class="p-sb-img" src="${esc(data.portraitMedium || data.portrait)}" alt="" onerror="this.remove()">`;
  }
  html += `<h2 class="p-sb-name">${esc(tok?.label ? tok.label + ' (' + (data.name || '') + ')' : (data.name || 'Monster'))}</h2>`;
  const kind = [size, typeStr, align].filter(Boolean).join(', ');
  if (kind || data.source) html += `<p class="p-sb-kind">${esc(kind)}${data.source ? ' (' + esc(data.source) + ')' : ''}</p>`;
  html += line('Armour class', acStr) + line('Hit points', hpStr) + line('Speed', speedStr) + line('Challenge', cr);

  // Tap an ability to roll a check with it.
  html += '<div class="p-sb-abil">' + scores.map((sc, i) => {
    const val = data[sc] || 10, m = Math.floor((val - 10) / 2), ms = (m >= 0 ? '+' : '') + m;
    return `<button type="button" onclick="sQrollRoll('${snames[i]} Check','${ms}')"><small>${snames[i]}</small><b>${esc(val)}</b><span>${ms}</span></button>`;
  }).join('') + '</div>';

  html += '<h3 class="p-sb-h">Saving throws</h3>' + scores.map((sc, i) => {
    const profVal = data.save && data.save[sc];
    const rawMod  = Math.floor(((data[sc] || 10) - 10) / 2);
    const val     = profVal || (rawMod >= 0 ? '+' + rawMod : '' + rawMod);
    return sRollRowHTML(snames[i] + (profVal ? ' (proficient)' : ''), val, `sQrollRoll('${snames[i]} Save','${escJs(val)}')`);
  }).join('');

  if (data.skill && Object.keys(data.skill).length) {
    html += '<h3 class="p-sb-h">Skills</h3>' + Object.entries(data.skill).map(([key, val]) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return sRollRowHTML(label, val, `sQrollRoll('${escJs(label)}','${escJs(val)}')`);
    }).join('');
  }

  html += '<h3 class="p-sb-h">Defences and senses</h3>';
  if (immuneStr)  html += line('Immune', immuneStr);
  if (resistStr)  html += line('Resistant', resistStr);
  if (condImmStr) html += line('Condition immune', condImmStr);
  if (sensesStr)  html += line('Senses', sensesStr);
  html += line('Languages', langStr);

  html += section(data.trait, 'Traits')
        + section(data.action, 'Actions')
        + section(data.bonus, 'Bonus actions')
        + section(data.reaction, 'Reactions')
        + section(data.legendary, 'Legendary actions')
        + section(data.mythic, 'Mythic actions');
  return html + '</div>';
}

// ── Loading what the Rolls and Stat block parts need ─────────────────────────
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
        // A monster's armour class comes from its stat block.
        if (sSelectedToken?.id === tok.id && sSelectedTokenAc == null && sMonsterData.ac) {
          const acRaw = [].concat(sMonsterData.ac)[0];
          sSelectedTokenAc = typeof acRaw === 'number' ? acRaw : (acRaw?.ac != null ? parseInt(acRaw.ac) : null);
        }
      }
    } catch {}
  } else if (tok && tok.type !== 'monster' && tok.linkedId && (sIsDM() || sIsMyToken(tok))) {
    const char = await sFetchSheet(tok.linkedId);
    if (char) {
      sQrollCharName = char.name || tok.name;
      sQrollData     = char.data || {};
    }
  }
  // The answer may arrive after the selection has moved on.
  if (sSelectedToken?.id === tok?.id && sCurrentTab === 'token') sRenderHpPanel(sSelectedToken);
}

// One character's sheet from the server, or null. The DM reads the whole
// sheet; a player reads the roll numbers of their own.
async function sFetchSheet(charId) {
  try {
    const url     = sIsDM() ? `/api/characters/${charId}` : `/api/characters/${charId}/qroll`;
    const headers = sIsDM() ? { 'X-Character-Password': masterPw }
                             : (sessionCharPw ? { 'X-Character-Password': sessionCharPw } : {});
    const r = await fetch(url, { headers });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Reads the selected character's sheet again and redraws, without the blank
// moment a fresh selection has. Used after a change the server recomputes
// (wearing an item) and when the sheet is edited somewhere else.
async function sReloadSheet() {
  const tok = sSelectedToken;
  if (!tok || tok.type === 'monster' || !tok.linkedId || !(sIsDM() || sIsMyToken(tok))) return;
  const char = await sFetchSheet(tok.linkedId);
  if (!char || sSelectedToken?.id !== tok.id) return;
  sQrollCharName = char.name || tok.name;
  sQrollData     = char.data || {};
  const ac = sQrollData.ac;
  if (ac != null && ac !== '') sSelectedTokenAc = parseInt(ac) || sSelectedTokenAc;
  if (sCurrentTab === 'token') sRenderHpPanel(sSelectedToken);
}
