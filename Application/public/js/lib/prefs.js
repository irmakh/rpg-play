// Written by Irmak Hakman — 2026-11-16 18:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Preferences (v360) ───────────────────────────────────────────────────────
// One place for this device's settings, behind a gear button beside the
// notification bell on every page. They were scattered: the dice switch only
// on the table's toolbar, the notification switches inside the bell's panel.
//
// Saved per device (this browser), so a phone and a laptop can differ. Each
// switch writes the same key its old home used, so nothing else had to change:
//   diceAnimEnabled   '0' off, anything else on        (dice-engine.js)
//   notifMutes        { sound, toast, popup }           (notifications.js)
//   reduceMotion      '1' on, '0' off, unset = follow the system setting
// The display template keeps its own button (js/lib/template.js).

function prefReduceMotion() {
  try {
    const v = localStorage.getItem('reduceMotion');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function prefDiceAnim() {
  try { return localStorage.getItem('diceAnimEnabled') !== '0'; } catch { return true; }
}

// Applied on every page at load, so the sheet obeys the dice switch too (it
// used to be read on the table only), and less motion turns the dice off.
function applyPrefs() {
  window.diceAnimEnabled = prefDiceAnim() && !prefReduceMotion();
  document.documentElement.classList.toggle('reduce-motion', prefReduceMotion());
  if (typeof _updateDiceAnimBtn === 'function') _updateDiceAnimBtn(window.diceAnimEnabled);
}

const PREF_ROWS = [
  { id: 'dice', label: 'Dice animation', hint: 'Show the rolling dice before the result.',
    get: () => prefDiceAnim(), set: (on) => { try { localStorage.setItem('diceAnimEnabled', on ? '1' : '0'); } catch {} } },
  { id: 'motion', label: 'Reduce motion', hint: 'Fewer animations. Also turns the dice animation off.',
    get: () => prefReduceMotion(), set: (on) => { try { localStorage.setItem('reduceMotion', on ? '1' : '0'); } catch {} } },
  { id: 'sound', label: 'Chime on important notifications', hint: 'Your turn, items given to you, damage.',
    get: () => !(typeof notifMuted === 'function' && notifMuted('sound')), set: (on) => { if (typeof notifSetMute === 'function') notifSetMute('sound', !on); } },
  { id: 'toast', label: 'Show rolls and chat on screen', hint: 'Pop-ups for other players’ rolls and table chat.',
    get: () => !(typeof notifMuted === 'function' && notifMuted('toast')), set: (on) => { if (typeof notifSetMute === 'function') notifSetMute('toast', !on); } },
  { id: 'popup', label: 'Notify me when this window is in the background', hint: 'Uses your system’s notifications.',
    get: () => !(typeof notifMuted === 'function' && notifMuted('popup')), set: (on) => {
      if (typeof notifSetMute === 'function') notifSetMute('popup', !on);
      if (on && typeof notifRequestPermission === 'function') notifRequestPermission();
    } },
];

function openPrefs() {
  let el = document.getElementById('prefs-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'prefs-panel';
    el.innerHTML = `<div class="prefs-bg"></div>
      <div class="prefs-box" role="dialog" aria-modal="true" aria-labelledby="prefs-title">
        <div class="prefs-hdr"><h2 id="prefs-title">Preferences</h2>
          <button type="button" class="prefs-x" aria-label="Close" onclick="closePrefs()">×</button></div>
        <p class="prefs-note">Saved on this device only.</p>
        <div class="prefs-rows"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.prefs-bg').onclick = closePrefs;
    _prefsStyle();
  }
  el.querySelector('.prefs-rows').innerHTML = PREF_ROWS.map(r => `
    <label class="prefs-row" for="pref-${r.id}">
      <span class="prefs-text"><b>${r.label}</b><span>${r.hint}</span></span>
      <input type="checkbox" role="switch" id="pref-${r.id}" ${r.get() ? 'checked' : ''} onchange="setPref('${r.id}', this.checked)">
    </label>`).join('');
  el.hidden = false;
  el.querySelector('input')?.focus();
}

function closePrefs() {
  const el = document.getElementById('prefs-panel');
  if (el) el.hidden = true;
}

function setPref(id, on) {
  const r = PREF_ROWS.find(x => x.id === id);
  if (!r) return;
  r.set(on);
  applyPrefs();
}

function _prefsStyle() {
  if (document.getElementById('prefs-style')) return;
  const st = document.createElement('style');
  st.id = 'prefs-style';
  st.textContent = [
    '#prefs-panel{position:fixed;inset:0;z-index:5900}',
    '#prefs-panel[hidden]{display:none}',
    '#prefs-panel .prefs-bg{position:absolute;inset:0;background:#0009}',
    '#prefs-panel .prefs-box{position:absolute;left:50%;top:10vh;transform:translateX(-50%);width:min(440px,calc(100vw - 24px));',
    '  max-height:80vh;overflow-y:auto;background:var(--slate,#101a2c);color:var(--bone,#e6edf7);border:1px solid var(--rule-hi,#ffffff33);',
    '  border-radius:10px;box-shadow:0 18px 48px #000c;padding:14px 16px}',
    '.prefs-hdr{display:flex;align-items:center;justify-content:space-between}',
    '.prefs-hdr h2{margin:0;font-size:18px}',
    '.prefs-x{background:none;border:0;color:inherit;font-size:24px;line-height:1;cursor:pointer;min-width:40px;min-height:40px}',
    '.prefs-note{margin:2px 0 10px;color:var(--ash,#8c9ab3);font-size:12px}',
    '.prefs-rows{display:grid}',
    '.prefs-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--rule-hi,#ffffff22);cursor:pointer;min-height:44px}',
    '.prefs-text{flex:1;display:flex;flex-direction:column;gap:2px}',
    '.prefs-text span{color:var(--ash,#8c9ab3);font-size:12px}',
    '.prefs-row input{width:22px;height:22px;accent-color:var(--arc,#e0a93f);flex:none}',
    '.prefs-open-btn{display:inline-flex;align-items:center;justify-content:center;margin-right:6px}',
    'html.reduce-motion *,html.reduce-motion *::before,html.reduce-motion *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}',
  ].join('\n');
  document.head.appendChild(st);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePrefs(); });
  document.addEventListener('DOMContentLoaded', () => {
    _prefsStyle();
    applyPrefs();
    // The gear goes beside the bell, on every page that has one.
    const bell = document.querySelector('[data-notif-bell]');
    if (!bell || !bell.parentNode || document.querySelector('.prefs-open-btn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (bell.className || 'btn') + ' prefs-open-btn';
    b.title = 'Preferences';
    b.setAttribute('aria-label', 'Preferences');
    b.innerHTML = '<svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-gear"></use></svg>';
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPrefs(); };
    bell.parentNode.insertBefore(b, bell);
  });
}
