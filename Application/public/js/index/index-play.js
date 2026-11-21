// Written by Irmak Hakman — 2026-11-21 09:50
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Phone view of the character sheet (v360) ─────────────────────────────────
// Under 760px the row of tabs gives way to a bottom bar within thumb reach:
// Main · Spells · Items · More. More lists every other page this viewer has.
// (v368: Main replaced the phone-only Play page, which was not useful.)

const PHONE_QUERY = '(max-width: 760px)';
const PN_MAIN = ['main', 'spells', 'inventory'];   // the bar's own buttons; the rest live under More

function isPhoneView() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia(PHONE_QUERY).matches;
}

// ── Bottom bar ───────────────────────────────────────────────────────────────
function phoneNavGo(name) {
  closePhoneMore();
  const top = document.getElementById(`tabbtn-${name}`) || document.getElementById(`tab-btn-${name}`);
  if (top) showTab(name, top);
}

// Marks the bar's button for the page on show (called from showTab).
function syncPhoneNav(name) {
  document.querySelectorAll('#phone-nav [data-pn]').forEach(b => {
    const on = b.dataset.pn === name || (b.dataset.pn === 'more' && !PN_MAIN.includes(name));
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
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
  // The sheet opens on Main; light up its button on the bar.
  window.addEventListener('load', () => {
    if (isPhoneView() && document.getElementById('tab-main')?.classList.contains('active')) syncPhoneNav('main');
  });
}
