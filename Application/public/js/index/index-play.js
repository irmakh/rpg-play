// Written by Irmak Hakman — 2026-11-16 17:15
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Phone view of the character sheet (v360) ─────────────────────────────────
// Under 760px the row of eleven tabs gives way to a bottom bar within thumb
// reach: Play · Spells · Items · More. "Play" is a phone-only page with what a
// turn needs on one screen: attacks and actions, spell slots, Cast a Spell and
// the rests. Hit points stay in the vitals bar above every page.
//
// Everything here reads and writes the sheet's own fields and reuses the
// Actions tab's builders (index-actions.js), so Play is never a second copy
// of the data: tapping a slot changes slot-N-used, which saves as usual.

const PHONE_QUERY = '(max-width: 760px)';
const PN_MAIN = ['play', 'spells', 'inventory'];   // the bar's own buttons; the rest live under More

function isPhoneView() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia(PHONE_QUERY).matches;
}

// ── Play page ────────────────────────────────────────────────────────────────
function renderPlayTab() {
  const body = document.getElementById('play-body');
  if (!body) return;
  if (!currentCharId) { body.innerHTML = '<div class="play-empty">Choose a character first.</div>'; return; }

  const slots = _playSlotsHTML();
  let actionsHtml = '';
  if (typeof _actCollectAttacks === 'function') {
    const spellsBy = _actCollectSpells();
    const custom = (cat) => (typeof actions !== 'undefined' ? actions : []).filter(a => a.category === cat).map(_actRenderCustom).join('');
    const section = (title, inner) => inner.trim() ? `<div class="act-section"><div class="act-section-hdr">${title}</div>${inner}</div>` : '';
    actionsHtml = section('Actions', _actRenderAttacks(_actCollectAttacks()) + _actRenderSpellList(spellsBy.action) + custom('action'))
      + section('Bonus Actions', _actRenderSpellList(spellsBy.bonus) + custom('bonus'))
      + section('Reactions', _actRenderSpellList(spellsBy.reaction) + custom('reaction'));
  }

  body.innerHTML = `
    <div class="play-quick">
      <button type="button" class="char-btn primary play-big" onclick="openSheetSpellCast()">Cast a Spell</button>
      <button type="button" class="char-btn play-big" onclick="playRest('short')">Short Rest</button>
      <button type="button" class="char-btn play-big" onclick="playRest('long')">Long Rest</button>
    </div>
    ${slots}
    ${actionsHtml || '<div class="play-empty">No attacks or actions yet. Add weapons under Items and spells under Spells.</div>'}`;
}

function _playNum(k) { return parseInt(document.querySelector(`[data-key="${k}"]`)?.value, 10) || 0; }

// One row of boxes per slot level the character has; a filled box is a spent slot.
function _playSlotsHTML() {
  const rows = [];
  const row = (label, total, used, key) => {
    let boxes = '';
    for (let i = 0; i < total; i++) {
      const spent = i < used;
      boxes += `<button type="button" class="play-slot${spent ? ' used' : ''}" aria-pressed="${spent}"
        aria-label="${esc(label)} slot ${i + 1}: ${spent ? 'spent, tap to get it back' : 'open, tap to spend'}"
        onclick="playToggleSlot('${key}', ${i})"></button>`;
    }
    return `<div class="play-slot-row"><span class="play-slot-lbl">${esc(label)}</span><span class="play-slot-boxes">${boxes}</span>
      <span class="play-slot-left">${Math.max(0, total - used)} left</span></div>`;
  };
  for (let lv = 1; lv <= 9; lv++) {
    const total = _playNum(`slot-${lv}-total`);
    if (total > 0) rows.push(row(`Level ${lv}`, total, Math.min(total, _playNum(`slot-${lv}-used`)), `slot-${lv}-used`));
  }
  const pact = _playNum('pact-slots');
  if (pact > 0) rows.push(row(`Pact (L${_playNum('pact-level') || '?'})`, pact, Math.min(pact, _playNum('pact-used')), 'pact-used'));
  return rows.length ? `<div class="act-section"><div class="act-section-hdr">Spell Slots</div>${rows.join('')}</div>` : '';
}

// Tapping box i: spend up to it, or, on a spent box, give back from it on.
function playToggleSlot(key, i) {
  const el = document.querySelector(`[data-key="${key}"]`);
  if (!el) return;
  const used = parseInt(el.value, 10) || 0;
  el.value = String(i < used ? i : i + 1);
  el.dispatchEvent(new Event('input', { bubbles: true }));   // the sheet's autosave
  renderPlayTab();
}

function playRest(type) {
  if (typeof actionRest === 'function') actionRest(type);
  if (typeof notifToast === 'function') notifToast({ kind: 'info', title: type === 'long' ? 'Long rest: slots and uses are back' : 'Short rest: short-rest uses are back', ms: 4000 });
  renderPlayTab();
}

// ── Bottom bar ───────────────────────────────────────────────────────────────
function phoneNavGo(name) {
  closePhoneMore();
  const top = document.getElementById(name === 'play' ? 'tabbtn-play' : `tabbtn-${name}`) || document.getElementById(`tab-btn-${name}`);
  if (top) showTab(name, top);
}

// Marks the bar's button for the page on show (called from showTab).
function syncPhoneNav(name) {
  document.querySelectorAll('#phone-nav [data-pn]').forEach(b => {
    const on = b.dataset.pn === name || (b.dataset.pn === 'more' && !PN_MAIN.includes(name));
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (name === 'play') renderPlayTab();
}

function openPhoneMore() {
  const sheet = document.getElementById('phone-more');
  if (!sheet) return;
  // Only the pages this viewer has (DM-only tabs are hidden on the top bar).
  const list = [...document.querySelectorAll('.tabs [role="tab"]')]
    .filter(t => !PN_MAIN.includes(t.getAttribute('aria-controls').replace('tab-', '')) && t.style.display !== 'none' && !t.hidden);
  sheet.querySelector('.pm-list').innerHTML = list.map(t => {
    const name = t.getAttribute('aria-controls').replace('tab-', '');
    return `<button type="button" class="pm-item" onclick="phoneNavGo('${escJs(name)}')">${esc(t.textContent.trim())}</button>`;
  }).join('');
  sheet.hidden = false;
  document.getElementById('phone-more-bg').hidden = false;
  sheet.querySelector('.pm-item')?.focus();
}

function closePhoneMore() {
  const sheet = document.getElementById('phone-more');
  if (sheet) sheet.hidden = true;
  const bg = document.getElementById('phone-more-bg');
  if (bg) bg.hidden = true;
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhoneMore(); });
  // On a phone the sheet opens on Play; the Actions tab and slot fields keep
  // it current while it shows.
  window.addEventListener('load', () => {
    if (isPhoneView() && document.getElementById('tab-main')?.classList.contains('active')) phoneNavGo('play');
  });
  document.addEventListener('input', (e) => {
    if (!document.getElementById('tab-play')?.classList.contains('active')) return;
    if (e.target.closest && e.target.closest('#play-body')) return;
    clearTimeout(renderPlayTab._t);
    renderPlayTab._t = setTimeout(renderPlayTab, 300);
  });
}
