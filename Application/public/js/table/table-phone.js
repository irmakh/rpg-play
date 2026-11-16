// Written by Irmak Hakman — 2026-11-17 12:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── The table screen on a phone (v363) ───────────────────────────────────────
// On a phone-sized screen the map gets the whole screen and a bottom tab bar
// opens everything else as a sheet over it (css/table-phone.css):
//   Map      closes whatever sheet is open
//   Turn     the initiative panel (#left-panel)
//   Details  the selected token: a short peek card first, then the full side
//            panel (#side-panel); a player with nothing selected gets their sheet;
//            with several tokens selected (DM), the bulk-edit panel
//   Chat     the chat bar (#chat-bar)
//   More     everything the toolbar held: dice mode, DM tools, settings, links
// Plus one round button on the map for the tools (Move, Pan, Ruler, Ping, Draw,
// and Multi and Notes for the DM).
//
// Nothing here runs on a computer: isPhoneTable() is false there, body never
// gets .tbl-phone, and every wrapped function just calls the original. The
// panels themselves are the desktop ones, moved by CSS, so no feature is
// rebuilt; the hooks only decide which sheet shows.

const PHONE_TABLE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';
const PHONE_TABS = ['map', 'turn', 'details', 'chat', 'more'];

var phoneTab = 'map';     // var: the tests read it
let _phPeek = false;          // Details shows the peek card, not the full panel
let _phToolOpen = false;
const _phOrig = {};           // the desktop functions this file wraps

function isPhoneTable() {
  return typeof window !== 'undefined' && !!window.matchMedia && !!document.getElementById('ph-tabs')
    && window.matchMedia(PHONE_TABLE_QUERY).matches;
}
function _phOn() { return document.body.classList.contains('tbl-phone'); }

// ── Switching sheets ─────────────────────────────────────────────────────────
// opts.peek: open Details as the peek card (a token was just selected).
function phoneSetTab(tab, opts) {
  opts = opts || {};
  if (!PHONE_TABS.includes(tab) || !_phOn()) return;
  const prev = phoneTab;
  // Chat counts unread messages only while it is closed (chatOpen false).
  if (prev === 'chat' && tab !== 'chat' && typeof chatOpen !== 'undefined' && chatOpen) _phOrig.chatToggle();
  phoneTab = tab;
  _phPeek = tab === 'details' && !!opts.peek && !!_phSelectedTok();
  const b = document.body.classList;
  PHONE_TABS.forEach(t => b.toggle('ph-tab-' + t, t === tab && t !== 'map'));
  b.toggle('ph-peek', _phPeek);

  if (tab === 'chat' && typeof chatOpen !== 'undefined' && !chatOpen) _phOrig.chatToggle();
  if (tab === 'details') {
    if (_phPeek) phoneRenderPeek();
    else _phOpenDetails();
  }
  if (tab === 'more') phoneRenderMore();
  if (tab !== 'map') phoneToolRow(false);
  _phSyncTabs();
  _phMeasure();
}

// The full side panel: the selected token, else (a player) their own sheet,
// else (the DM) the "tap a token" placeholder. Unfolded through the original
// so its desktop state stays consistent.
function _phOpenDetails() {
  _phOrig.rightPanelFold(false, true);
  const sp = document.getElementById('side-panel');
  if (sp) sp.scrollTop = 0;
  if (!_phSelectedTok() && !_phBulkOn() && typeof isCharSession === 'function' && isCharSession()
      && typeof loadOwnCharacterSheet === 'function') loadOwnCharacterSheet();
}

function phoneDetailsExpand() {
  if (phoneTab !== 'details') return;
  phoneSetTab('details', { peek: false });
}

function _phSelectedTok() {
  if (typeof tokens === 'undefined' || typeof selectedTokenId === 'undefined' || !selectedTokenId) return null;
  return tokens.find(t => t.id === selectedTokenId) || null;
}

function _phSyncTabs() {
  document.querySelectorAll('#ph-tabs [data-ph-tab]').forEach(btn => {
    const on = btn.dataset.phTab === phoneTab;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// The tab buttons: a tab opens its sheet; the open tab (or Map) closes it.
function phoneTabClick(tab) {
  if (tab === 'map' || (tab === phoneTab && !(tab === 'details' && _phPeek))) { phoneSetTab('map'); return; }
  if (tab === 'details') { phoneSetTab('details', { peek: false }); return; }
  phoneSetTab(tab);
}

// Sheets start at the map's top edge; map buttons rise above the peek card.
function _phMeasure() {
  if (!_phOn()) return;
  const wrap = document.getElementById('table-wrap');
  const top = wrap ? Math.round(wrap.getBoundingClientRect().top) : 96;
  document.body.style.setProperty('--ph-sheet-top', (top + 6) + 'px');
  const peek = document.getElementById('ph-peek');
  const lift = _phPeek && peek ? peek.offsetHeight : 0;
  document.body.style.setProperty('--ph-lift', lift + 'px');
  // The turn banner and prompts place themselves on resize.
  try { if (typeof _placeTurnBanner === 'function') _placeTurnBanner(); } catch {}
  try { if (typeof _placeCombatPrompts === 'function') _placeCombatPrompts(); } catch {}
}

// ── Peek card ────────────────────────────────────────────────────────────────
function phoneRenderPeek() {
  const el = document.getElementById('ph-peek');
  if (!el) return;
  const tok = _phSelectedTok();
  if (!tok) { if (phoneTab === 'details' && _phPeek) phoneSetTab('map'); return; }
  const name = (typeof tokDisplayName === 'function' && tokDisplayName(tok)) || tok.name || 'Token';
  const cur = tok.hpCurrent || 0, max = tok.hpMax || 0, temp = tok.hpTemp || 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(cur / max * 100))) : 0;
  const ac = tok.ac != null ? tok.ac : (typeof _hpPanelAc !== 'undefined' && _hpPanelAc != null ? _hpPanelAc : null);
  const conds = typeof parseConditions === 'function' ? parseConditions(tok.conditions) : [];
  const timers = typeof tokTimers === 'function' ? tokTimers(tok) : {};
  const chips = conds.map(c => {
    const t = timers[c];
    return `<span class="ph-pk-chip">${esc(c)}${t && t.rounds ? ' · ' + t.rounds : ''}</span>`;
  });
  if (tok.concentration) chips.push(`<span class="ph-pk-chip">Concentrating: ${esc(tok.concentration)}</span>`);
  const img = tok.portraitThumb || tok.portrait || '';
  el.innerHTML = `
    <div class="ph-pk-top">
      ${img ? `<img class="ph-pk-img" src="${esc(img)}" alt="">` : ''}
      <span class="ph-pk-name">${esc(name)}</span>
      ${ac != null ? `<span class="ph-pk-pill">AC <b>${esc(String(ac))}</b></span>` : ''}
    </div>
    ${max > 0 ? `<div class="ph-pk-hp"><span>HP${temp ? ` (+${temp} temp)` : ''}</span><span><b>${cur}</b> / ${max}</span></div>
      <div class="ph-pk-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}
    ${chips.length ? `<div class="ph-pk-chips">${chips.join('')}</div>` : ''}
    <div class="ph-pk-hint">Tap or swipe up for full details</div>`;
  el.setAttribute('aria-label', `${name}: tap for full details`);
  _phMeasure();
}

// ── Tools ────────────────────────────────────────────────────────────────────
const PH_TOOLS = [
  ['move', 'i-move', 'Move'], ['pan', 'i-hand', 'Pan'], ['ruler', 'i-ruler', 'Ruler'],
  ['ping', 'i-pin', 'Ping'], ['draw', 'i-pencil', 'Draw'],
  ['multi', 'i-square', 'Multi-select', true], ['note', 'i-document', 'Notes', true],
];
function _phIcon(id) { return `<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`; }

function phoneToolRow(open) {
  _phToolOpen = open == null ? !_phToolOpen : !!open;
  const row = document.querySelector('#ph-tool .ph-tool-row');
  if (!row) return;
  if (_phToolOpen) {
    const dm = typeof isDM === 'function' && isDM();
    row.innerHTML = PH_TOOLS.filter(t => !t[3] || dm).map(([id, icon, label]) =>
      `<button type="button" aria-label="${label}" title="${label}" aria-pressed="${currentTool === id}" onclick="phonePickTool('${id}')">${_phIcon(icon)}</button>`).join('');
  }
  row.hidden = !_phToolOpen;
  document.querySelector('#ph-tool .ph-fab-main')?.setAttribute('aria-expanded', String(_phToolOpen));
}

function phonePickTool(id) {
  phoneToolRow(false);
  if (typeof setTool === 'function') setTool(id);
}

// The round button shows the current tool; away from Move a chip says which
// tool is on with an X back to Move. Undo appears after a move, as on the toolbar.
function phoneSyncTool() {
  const box = document.getElementById('ph-tool');
  if (!box) return;
  const t = PH_TOOLS.find(x => x[0] === currentTool) || PH_TOOLS[0];
  const main = box.querySelector('.ph-fab-main');
  if (main) {
    main.innerHTML = _phIcon(t[1]);
    main.classList.toggle('on', currentTool !== 'move');
    main.setAttribute('aria-label', `Map tools (now: ${t[2]})`);
  }
  const chip = box.querySelector('.ph-tool-chip');
  if (chip) {
    chip.hidden = currentTool === 'move';
    chip.innerHTML = `${esc(t[2])}<span aria-hidden="true">✕</span>`;
    chip.setAttribute('aria-label', `${t[2]} is on. Back to Move`);
  }
  const undo = box.querySelector('.ph-fab-undo');
  const deskUndo = document.getElementById('btn-undo-move');
  if (undo) undo.hidden = !deskUndo || deskUndo.style.display === 'none';
  if (_phToolOpen) phoneToolRow(true);
}

// ── More ─────────────────────────────────────────────────────────────────────
function phoneRenderMore() {
  const body = document.querySelector('#ph-more .ph-more-body');
  if (!body) return;
  const dm = typeof isDM === 'function' && isDM();
  const mode = typeof diceMode !== 'undefined' ? diceMode : 'ask';
  const pressed = (id) => document.getElementById(id)?.getAttribute('aria-checked') === 'true';
  const seg = [['ask', 'Ask'], ['norm', 'Normal'], ['adv', 'Adv'], ['dis', 'Dis']].map(([m, l]) =>
    `<button type="button" aria-pressed="${mode === m}" onclick="phoneMoreDice('${m}')">${l}</button>`).join('');
  const gi = (icon, label, call, on) =>
    `<button type="button" class="ph-gi"${on != null ? ` aria-pressed="${!!on}"` : ''} onclick="${call}">${_phIcon(icon)}<span>${label}</span></button>`;
  const link = (icon, label, href) => `<a class="ph-gi" href="${href}">${_phIcon(icon)}<span>${label}</span></a>`;
  const wx = (document.getElementById('wx-toolbar-text')?.textContent || '').trim();
  const follow = typeof uxFollowOn === 'function' ? uxFollowOn() : null;

  body.innerHTML = `
    <div class="ph-lab">Every d20 roll</div>
    <div class="ph-seg" role="group" aria-label="Roll mode">${seg}</div>
    <div class="ph-grid">
      ${gi('i-dice', 'Dice roller', "phoneMoreRun('openDiceRollerModal')")}
      ${gi('i-bolt', 'Next damage crits', "phoneMoreToggle('toggleCritArmed')", pressed('btn-crit-next'))}
      ${gi('i-dice', 'Dice animation', "phoneMoreToggle('toggleDiceAnim')", pressed('btn-dice-anim'))}
      ${follow != null ? gi('i-target', 'Follow the turn', "phoneMoreToggle('uxToggleFollow')", follow) : ''}
    </div>
    ${dm ? `<div class="ph-lab">DM</div>
    <div class="ph-grid">
      ${gi('i-plus', 'Token', "phoneMoreRun('openAddTokenModal')")}
      ${gi('i-music', 'Music', "phoneMoreRun('openMusicModal')")}
      ${gi('i-document', 'Handouts', "phoneMoreRun('openHandoutModal')")}
      ${gi('i-pause', 'Waiting screen', "phoneMoreRun('openWaitingPicker')")}
    </div>` : ''}
    <div class="ph-lab">Table</div>
    <div class="ph-grid">
      ${typeof openPalette === 'function' ? gi('i-search', 'Search', "phoneMoreRun('openPalette')") : ''}
      ${typeof openPrefs === 'function' ? gi('i-gear', 'Settings', "phoneMoreRun('openPrefs')") : ''}
      ${gi('i-exit', 'Log out', "phoneMoreRun('logout')")}
    </div>
    ${wx ? `<div class="ph-weather">Today: ${esc(wx)}</div>` : ''}
    <div class="ph-lab">Go to</div>
    <div class="ph-grid">
      ${dm ? link('i-shield', 'DM page', '/dm.html') : ''}
      ${link('i-document', dm ? 'Sheets' : 'My sheet', '/index.html')}
      ${dm ? link('i-skull', 'Monsters', '/monsters.html') + link('i-coins', 'Treasury', '/treasury.html') : ''}
    </div>`;
}

function phoneMoreDice(mode) {
  if (typeof setDiceMode === 'function') setDiceMode(mode);
  phoneRenderMore();
}
// A switch: flip it and keep More open to show the new state.
function phoneMoreToggle(fn) {
  if (typeof window[fn] === 'function') window[fn]();
  phoneRenderMore();
}
// An action that opens its own window: close More first.
function phoneMoreRun(fn) {
  phoneSetTab('map');
  if (typeof window[fn] === 'function') window[fn]();
}

// ── Badges ───────────────────────────────────────────────────────────────────
function _phBadge(tab, text, cls) {
  const b = document.querySelector(`#ph-tabs [data-ph-tab="${tab}"] .ph-badge`);
  if (!b) return;
  b.hidden = !text && cls !== 'dot';
  b.textContent = cls === 'dot' ? '' : (text || '');
  b.className = 'ph-badge' + (cls ? ' ' + cls : '');
}
function phoneSyncChatBadge() {
  const src = document.getElementById('chat-badge');
  const n = src && src.style.display !== 'none' ? src.textContent.trim() : '';
  _phBadge('chat', n && n !== '0' ? n : '');
}
// "!" when it is your turn or initiative wants you; a dot while combat runs.
function phoneSyncTurnBadge() {
  const mine = typeof isMyTurn === 'function' && isMyTurn();
  const flag = document.getElementById('init-badge');
  const ask = flag && flag.style.display !== 'none';
  const running = typeof initData !== 'undefined' && initData && !!initData.currentId;
  if (mine || ask) _phBadge('turn', '!', 'gold');
  else if (running) _phBadge('turn', '', 'dot');
  else _phBadge('turn', '');
}

// ── Bulk edit (DM, several tokens selected) ──────────────────────────────────
// On a computer the bulk-edit panel sits in the initiative column. On a phone
// it moves into the details panel (same element, same ids, so every bulk
// action works), and comes back when the screen is wide again.
let _phBulkHome = null;   // { parent, next } where it lives on a computer
function _phPlaceBulk(phone) {
  const bulk = document.getElementById('lp-bulk-section');
  const sp = document.getElementById('side-panel');
  if (!bulk || !sp) return;
  if (phone) {
    if (bulk.parentNode === sp) return;
    _phBulkHome = { parent: bulk.parentNode, next: bulk.nextSibling };
    const hdr = document.getElementById('rp-hdr');
    sp.insertBefore(bulk, hdr ? hdr.nextSibling : sp.firstChild);
  } else if (_phBulkHome && bulk.parentNode === sp) {
    _phBulkHome.parent.insertBefore(bulk, _phBulkHome.next && _phBulkHome.next.parentNode === _phBulkHome.parent ? _phBulkHome.next : null);
    _phBulkHome = null;
  }
  phoneSyncBulk();
}
function _phBulkOn() {
  const bulk = document.getElementById('lp-bulk-section');
  return !!bulk && bulk.style.display !== 'none';
}
// The bulk panel showing opens Details on it; clearing it closes Details
// (or goes back to the selected token's card).
function phoneSyncBulk() {
  const on = _phOn() && _phBulkOn();
  const was = document.body.classList.contains('ph-bulk');
  document.body.classList.toggle('ph-bulk', on);
  if (!_phOn()) return;
  if (on && (phoneTab !== 'details' || _phPeek)) phoneSetTab('details', { peek: false });
  else if (!on && was && phoneTab === 'details') {
    if (_phSelectedTok()) phoneSetTab('details', { peek: true }); else phoneSetTab('map');
  }
}

// ── Swipes on the grab bars ──────────────────────────────────────────────────
// Down closes a sheet (the full Details panel goes back to its peek card when a
// token is selected); up on the peek card opens the full panel.
function _phSwipe(el, onDown, onUp) {
  if (!el) return;
  let y0 = null;
  el.addEventListener('touchstart', e => { if (_phOn() && e.touches.length === 1) y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (y0 == null) return;
    const dy = (e.changedTouches[0] || {}).clientY - y0;
    y0 = null;
    if (dy > 40 && onDown) { e.preventDefault(); onDown(); }
    else if (dy < -40 && onUp) { e.preventDefault(); onUp(); }
  });
}
function _phCloseDetails() {
  if (_phSelectedTok() && !_phPeek) phoneSetTab('details', { peek: true });
  else phoneSetTab('map');
}

// ── Hooks into the desktop functions ─────────────────────────────────────────
function _phWrap(name, after) {
  const orig = typeof window[name] === 'function' ? window[name] : null;
  if (!orig) return;
  _phOrig[name] = orig;
  window[name] = function () {
    const out = after.apply(this, [orig, arguments]);
    return out;
  };
}

function _phInstallHooks() {
  // The side panel opening is a token being selected (auto) or a hand opening it.
  _phWrap('rightPanelFold', (orig, args) => {
    const [fold, auto] = args;
    if (!_phOn()) return orig.apply(null, args);
    if (fold) {
      orig.apply(null, args);
      if (phoneTab !== 'details') return;
      if (_phBulkOn()) { _phOrig.rightPanelFold(false, true); return; }   // bulk edit stays open
      if (!auto && _phSelectedTok() && !_phPeek) phoneSetTab('details', { peek: true });   // the header: back to the card
      else phoneSetTab('map');
      return;
    }
    orig.apply(null, args);
    // The full panel is already showing: stay. (Loading a player's own sheet
    // unfolds the panel again; reopening Details here would load it again,
    // round and round.)
    if (phoneTab === 'details' && !_phPeek) return;
    const tok = _phSelectedTok();
    phoneSetTab('details', { peek: !!(auto && tok) });
  });
  _phWrap('rightPanelOpen', (orig, args) => {
    if (!_phOn()) return orig.apply(null, args);
    phoneSetTab('details', { peek: false });
  });
  // The initiative panel opening or folding by hand is the Turn sheet; folding
  // or opening by itself (no initiative yet) changes nothing on a phone.
  _phWrap('leftPanelCollapse', (orig, args) => {
    const [collapse, auto] = args;
    if (!_phOn() || auto) return orig.apply(null, args);
    if (!collapse && _phBulkOn()) return;     // bulk edit opens Details, not Turn
    if (!collapse) phoneSetTab('turn');
    else if (phoneTab === 'turn') phoneSetTab('map');
  });
  // The chat header closes the chat sheet.
  _phWrap('chatToggle', (orig, args) => {
    if (!_phOn()) return orig.apply(null, args);
    phoneSetTab(phoneTab === 'chat' ? 'map' : 'chat');
  });
  _phWrap('renderTokens', (orig, args) => {
    const out = orig.apply(null, args);
    if (_phOn() && phoneTab === 'details' && _phPeek) phoneRenderPeek();
    return out;
  });
  _phWrap('setTool', (orig, args) => {
    const out = orig.apply(null, args);
    if (_phOn()) phoneSyncTool();
    return out;
  });
  _phWrap('renderInitiativeTracker', (orig, args) => {
    const out = orig.apply(null, args);
    if (_phOn()) phoneSyncTurnBadge();
    return out;
  });
}

// ── Phone or not ─────────────────────────────────────────────────────────────
function phoneApply() {
  const on = isPhoneTable();
  const was = _phOn();
  if (on === was) { if (on) _phMeasure(); return; }
  if (!on) phoneSetTab('map');      // leave no sheet classes behind
  document.body.classList.toggle('tbl-phone', on);
  _phPlaceBulk(on);
  // On a phone the keyboard shrinks the page rather than covering it, so the
  // chat box and the HP entry stay above it (Chrome on Android; others ignore it).
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1.0' + (on ? ', interactive-widget=resizes-content' : ''));
  if (on) {
    // The chat starts open on a computer; closed, it counts unread messages.
    if (typeof chatOpen !== 'undefined' && chatOpen && _phOrig.chatToggle) _phOrig.chatToggle();
    phoneSyncTool(); phoneSyncChatBadge(); phoneSyncTurnBadge();
    // A token already selected shows as the card.
    if (_phSelectedTok() && !document.body.classList.contains('rp-collapsed')) phoneSetTab('details', { peek: true });
    else phoneSetTab('map');
  } else {
    document.body.classList.remove('ph-peek');
    document.body.style.removeProperty('--ph-lift');
  }
  try { window.dispatchEvent(new Event('resize')); } catch {}
}

function _phInit() {
  if (!document.getElementById('ph-tabs')) return;   // only the map screen has the bar
  _phInstallHooks();

  const peek = document.getElementById('ph-peek');
  if (peek) {
    peek.addEventListener('click', phoneDetailsExpand);
    _phSwipe(peek, () => phoneSetTab('map'), phoneDetailsExpand);
  }
  _phSwipe(document.getElementById('rp-hdr'), _phCloseDetails, null);
  _phSwipe(document.getElementById('init-hdr'), () => phoneSetTab('map'), null);
  _phSwipe(document.getElementById('chat-bar-hdr'), () => phoneSetTab('map'), null);
  _phSwipe(document.querySelector('#ph-more .ph-more-hdr'), () => phoneSetTab('map'), null);

  // Quick dice above the chat input (phone only; hidden by CSS elsewhere).
  const roller = document.getElementById('chat-roller');
  if (roller && !roller.querySelector('.ph-quick-dice')) {
    const row = document.createElement('div');
    row.className = 'ph-quick-dice';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Quick dice');
    row.innerHTML = [4, 6, 8, 10, 12, 20, 100].map(n => `<button type="button" onclick="phoneQuickDie(${n})">d${n}</button>`).join('');
    roller.insertBefore(row, roller.firstChild);
  }

  // Badges follow the desktop ones.
  const watch = (id, fn) => {
    const el = document.getElementById(id);
    if (el && typeof MutationObserver === 'function')
      new MutationObserver(fn).observe(el, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
  };
  watch('chat-badge', phoneSyncChatBadge);
  watch('init-badge', phoneSyncTurnBadge);
  watch('btn-undo-move', phoneSyncTool);
  // Several tokens selected (DM): their bulk-edit panel shows in Details.
  const bulk = document.getElementById('lp-bulk-section');
  if (bulk && typeof MutationObserver === 'function') new MutationObserver(phoneSyncBulk)
    .observe(bulk, { attributes: true, attributeFilter: ['style'] });

  // Tapping the map closes Turn, Chat and More (Details closes when the tap
  // clears the selection, as on a computer), and any open tool row.
  document.getElementById('canvas-area')?.addEventListener('pointerdown', () => {
    if (!_phOn()) return;
    if (_phToolOpen) phoneToolRow(false);
    if (phoneTab === 'turn' || phoneTab === 'chat' || phoneTab === 'more') phoneSetTab('map');
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !_phOn()) return;
    if (_phToolOpen) phoneToolRow(false);
    else if (phoneTab !== 'map' && !document.querySelector('.modal-overlay[style*="flex"]')) phoneSetTab('map');
  });

  const mq = window.matchMedia(PHONE_TABLE_QUERY);
  if (mq.addEventListener) mq.addEventListener('change', phoneApply);
  else if (mq.addListener) mq.addListener(phoneApply);
  window.addEventListener('resize', () => { if (_phOn()) _phMeasure(); });
  phoneApply();
}

// A die from the quick row, rolled through the chat's own /r command.
function phoneQuickDie(n) {
  const input = document.getElementById('chat-input');
  if (!input || typeof sendChatInput !== 'function') return;
  const keep = input.value;
  input.value = `/r 1d${n}`;
  sendChatInput();
  input.value = keep;
}

if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _phInit);
  else _phInit();
}
