// Written by Irmak Hakman — 2026-10-11 00:16
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Info panel: shared state, session and helpers ────────────────────────────
// The info panel (console/table-secondary.html) is the bottom screen of the
// two-screen console. Its script used to be one 1,600-line file; it is now
// split by tab, all classic scripts sharing these globals, loaded in this order:
//
//   panel-core.js      state, session, helpers            (this file)
//   panel-nav.js       tabs, unread marks, the command bar
//   panel-turn.js      Turn tab: initiative order
//   panel-token.js     Token tab: hit points, conditions, rolls, stat block
//   panel-chat.js      Chat tab
//   panel-table.js     Table tab (DM): maps, tokens, fog, hidden items
//   panel-music.js     music controls and the audio element
//   panel-realtime.js  live updates, the link to the map screen, start-up
//
// Function names keep their old `s` prefix (s = second screen) so the moved
// code reads the same as before the split.

// ── State ────────────────────────────────────────────────────────────────────
let sTokens      = [];
let sInitData    = { entries: [], currentId: null };
let sCharList    = [];
let sPrepMaps    = [];
let sFogRegions  = [];
let sHiddenItems = [];
let sMonsterData = null;      // stat block of the selected monster (DM only)

let sSelectedToken   = null;
let sSelectedTokenAc = null;
let sQrollData       = null;  // sheet numbers of the selected character
let sQrollCharName   = '';
let sRollMode        = 'norm';   // norm | adv | dis
let sTokenPane       = 'health'; // which part of the Token tab is showing

let sChatUnread = 0;
let sCurrentTab = 'turn';

let sessionRole   = null;
let sessionCharId = null;
let sessionCharPw = null;
let masterPw      = '';

// Token writes go out one at a time, in order: two quick taps on -5 must not
// race each other to the server.
const _sTokQ = { _p: Promise.resolve(), run(fn) { this._p = this._p.then(() => fn(), () => fn()); } };
let _sConsoleEs = null;

// ── The link to the map screen ───────────────────────────────────────────────
// The console relay needs our session (v237) and only pairs screens held by the
// same person. EventSource and sendBeacon cannot send headers, so the token
// rides in the query — _storedSessionToken() is in js/lib/realtime.js.
function _sConsoleUrl(path) {
  const t = typeof _storedSessionToken === 'function' ? _storedSessionToken() : '';
  return path + '?token=' + encodeURIComponent(t);
}

function _sConsolePost(msg) {
  fetch(_sConsoleUrl('/api/console/event'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

// ── Session ──────────────────────────────────────────────────────────────────
function sIsDM()          { return sessionRole === 'dm' && !!masterPw; }
function sIsCharSession() { return sessionRole === 'character' && !!sessionCharId; }

// js/lib/chat-render.js asks isDM() before showing a DM-only chat entry.
function isDM() { return sIsDM(); }

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

function sSessionName() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || '{}');
    return s.characterName || (sIsDM() ? 'Dungeon Master' : 'Player');
  } catch { return 'Player'; }
}

// The name a chat line is signed with.
function sGetSender() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || '{}');
    return s.characterName || (sIsDM() ? 'DM' : 'Player');
  } catch { return 'Player'; }
}

// Ends the session on the server and on every console screen on this device.
function sLogout() { ConsoleLogin.logout(); }

// ── Small helpers ────────────────────────────────────────────────────────────
function sEl(id) { return document.getElementById(id); }

// Players never see a monster's real name, only its identifier ("G7").
function sMonsterIdent(name) { return String(name || '').trim().split(' ').pop(); }

function sTokDisplayName(tok) {
  if (!sIsDM() && tok.type === 'monster') return tok.label || sMonsterIdent(tok.name);
  return tok.name;
}

function sParseConditions(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// A modifier with its sign: 3 -> "+3", -1 -> "-1".
function sSigned(n) { return (n >= 0 ? '+' : '') + n; }

// 0..1 share of hit points left; 0 when there is no maximum to compare with.
function sHpPct(cur, max) {
  return max > 0 ? Math.max(0, Math.min(1, (cur || 0) / max)) : 0;
}

// Health is green until a quarter is left, then red. The bar's LENGTH says how
// much; the colour only says "this one is about to drop".
function sHpLow(pct) { return pct <= 0.25; }

function sHpBarHTML(pct) {
  return `<span class="p-bar"><i class="${sHpLow(pct) ? 'low' : ''}" style="width:${Math.round(pct * 100)}%"></i></span>`;
}

// The token an initiative entry belongs to: by the id stamped on the token, or
// - for a player character - by the character it is linked to.
function sTokenForEntry(entry, tokens) {
  const charId = entry.charId || entry.characterId || '';
  return tokens.find(t => t.initiativeId === entry.id)
      || (charId ? tokens.find(t => t.linkedId === charId && t.type !== 'monster') : null)
      || null;
}

function sGetActiveTokId() {
  if (!sInitData.currentId) return null;
  const entry = sInitData.entries.find(e => e.id === sInitData.currentId);
  if (!entry) return null;
  const tok = sTokenForEntry(entry, sTokens);
  return tok ? tok.id : null;
}

/**
 * The Turn tab's rows, as plain data (no DOM), highest roll first.
 *
 * What a viewer may see is decided here, in one place:
 *  - a player does not see monsters in the order until combat has started;
 *  - a player sees a monster's identifier, never its name;
 *  - hit points are shown for a combatant only to the DM, or when it is a
 *    player character or the viewer's own token.
 *
 * @param {{entries: object[], currentId: string|null}} initData
 * @param {object[]} tokens
 * @param {{isDM: boolean, isMine: (tok: object) => boolean}} viewer
 */
function sInitRows(initData, tokens, viewer) {
  const running = !!initData.currentId;
  const all = initData.entries || [];
  const visible = viewer.isDM ? all : all.filter(e => !e.monsterId || running);
  return [...visible].sort((a, b) => (b.roll || 0) - (a.roll || 0)).map(e => {
    const tok = sTokenForEntry(e, tokens);
    const foe = !!e.monsterId;
    const mine = !!tok && viewer.isMine(tok);
    const showHp = !!tok && (viewer.isDM || !foe || mine);
    return {
      id: e.id,
      name: (viewer.isDM || !foe) ? e.name : sMonsterIdent(e.name),
      roll: e.roll,
      current: e.id === initData.currentId,
      foe,
      mine,
      tokenId: tok ? tok.id : null,
      canSelect: !!tok && (viewer.isDM || mine),
      hp: showHp ? { cur: tok.hpCurrent || 0, max: tok.hpMax || 0, pct: sHpPct(tok.hpCurrent, tok.hpMax) } : null,
      conditions: showHp ? sParseConditions(tok.conditions) : [],
    };
  });
}

// ── Confirm and toast ────────────────────────────────────────────────────────
// The browser's own confirm()/alert() boxes are tiny on the handheld and cannot
// be reached with the gamepad, so the panel draws its own.
let _sConfirmDone = null;

/** Asks a yes/no question. Resolves true when the action button is pressed. */
function sConfirm(message, actionLabel = 'OK') {
  return new Promise(resolve => {
    const sheet = sEl('s-confirm');
    if (!sheet) { resolve(false); return; }
    if (_sConfirmDone) _sConfirmDone(false);   // a second question replaces the first
    sEl('s-confirm-msg').textContent = message;
    sEl('s-confirm-ok').textContent = actionLabel;
    sheet.hidden = false;
    _sConfirmDone = answer => { _sConfirmDone = null; sheet.hidden = true; resolve(answer); };
    sEl('s-confirm-cancel').focus();
  });
}
function sConfirmAnswer(answer) { if (_sConfirmDone) _sConfirmDone(answer); }

let _sToastTimer = null;
function sToast(message) {
  const el = sEl('s-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(_sToastTimer);
  _sToastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
