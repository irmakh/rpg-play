// ── Ability score helpers ─────────────────────────────────────────────────────
function getMod(stat) {
  const score = parseInt(document.querySelector(`[data-key="${stat}"]`)?.value) || 10;
  return Math.floor((score - 10) / 2);
}
function fmt(n) { return (n >= 0 ? '+' : '') + n; }

// ── Status display ────────────────────────────────────────────────────────────
let statusTimer = null;
function setStatus(msg, isError) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.className = isError ? 'error' : (msg ? 'info' : '');
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 2500);
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function showLoading(msg = 'Loading…') {
  document.getElementById('loading-label').textContent = msg;
  document.getElementById('loading-overlay').classList.add('active');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ── Generic alert / confirm modals ────────────────────────────────────────────
function showAlert(msg) {
  document.getElementById('alert-msg').textContent = msg;
  document.getElementById('alert-modal').style.display = 'flex';
}
function closeAlert() {
  document.getElementById('alert-modal').style.display = 'none';
}

let confirmCallback = null;
function showConfirm(msg, onConfirm) {
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = onConfirm;
  document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirm() {
  document.getElementById('confirm-modal').style.display = 'none';
  confirmCallback = null;
}
function acceptConfirm() {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function showTab(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    // roving tabindex: only the selected tab is in the tab order, so Tab moves
    // past the tablist instead of through all ten buttons
    t.setAttribute('aria-selected', 'false');
    t.setAttribute('tabindex', '-1');
  });
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  el.setAttribute('aria-selected', 'true');
  el.setAttribute('tabindex', '0');
  if (name === 'treasury') loadTreasuryTab();
  if (name === 'handouts' && typeof loadHandouts === 'function') loadHandouts();
  if (name === 'calendar') pcalLoad();
  if (name === 'actions' && typeof renderActionsTab === 'function') renderActionsTab();
}


// Arrow-key navigation for the sheet's tablist, per the WAI-ARIA tabs pattern.
// Left/Right move and activate, Home/End jump to the ends. Hidden tabs (the
// DM-only ones) are skipped so arrowing never lands on something invisible.
// Guarded: the unit tests evaluate this file inside a vm context whose document
// stub has no addEventListener, and an unguarded top-level call throws there.
if (typeof document !== 'undefined' && document.addEventListener) {
document.addEventListener('keydown', function (e) {
  const tab = e.target.closest && e.target.closest('.tabs [role="tab"]');
  if (!tab) return;
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')]
    .filter(t => t.offsetParent !== null);
  if (!tabs.length) return;
  const move = keys[e.key];
  let next;
  if (move === 'first') next = tabs[0];
  else if (move === 'last') next = tabs[tabs.length - 1];
  else next = tabs[(tabs.indexOf(tab) + move + tabs.length) % tabs.length];
  e.preventDefault();
  next.focus();
  next.click();
});
}


// ── Toolbar overflow menu ────────────────────────────────────────────────────
function toggleCharMenu(force) {
  const btn = document.getElementById('cb-more-btn');
  const menu = document.getElementById('cb-menu');
  if (!btn || !menu) return;
  const open = force !== undefined ? force : menu.hasAttribute('hidden');
  if (open) { menu.removeAttribute('hidden'); } else { menu.setAttribute('hidden', ''); }
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if (typeof document !== 'undefined' && document.addEventListener) {
  // close on outside click
  document.addEventListener('click', function (e) {
    const menu = document.getElementById('cb-menu');
    if (!menu || menu.hasAttribute('hidden')) return;
    if (e.target.closest && e.target.closest('.cb-more')) return;
    toggleCharMenu(false);
  });
  // Escape closes and puts focus back on the button that opened it
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const menu = document.getElementById('cb-menu');
    if (!menu || menu.hasAttribute('hidden')) return;
    toggleCharMenu(false);
    const btn = document.getElementById('cb-more-btn');
    if (btn) btn.focus();
  });
  // choosing an item closes the menu
  document.addEventListener('click', function (e) {
    const item = e.target.closest && e.target.closest('#cb-menu [role="menuitem"]');
    if (item) toggleCharMenu(false);
  });
}


// ── Persistent vitals ────────────────────────────────────────────────────────
// Mirrors the real HP/AC/Speed inputs (which stay the single source of truth,
// inside the Combat card) and writes back through them, so the existing
// delegated autosave on #char-body persists the change with no new save path.
function _vitEl(key) { return document.querySelector('[data-key="' + key + '"]'); }

function syncVitals() {
  const box = document.getElementById('vitals');
  if (!box) return;
  const cur = parseInt(_vitEl('hpcur')?.value, 10);
  const max = parseInt(_vitEl('hpmax')?.value, 10);
  const tmp = parseInt(_vitEl('hptemp')?.value, 10) || 0;
  if (isNaN(cur) && isNaN(max)) { box.hidden = true; return; }
  box.hidden = false;

  const ring = document.getElementById('vitals-ring');
  const total = (isNaN(cur) ? 0 : cur) + tmp;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((total / max) * 100))) : 100;
  ring.style.setProperty('--hp', pct);
  ring.toggleAttribute('data-hurt', pct <= 50 && total > 0);
  if (total <= 0) ring.setAttribute('data-state', 'down'); else ring.removeAttribute('data-state');

  document.getElementById('vitals-hp').textContent = isNaN(cur) ? '-' : String(total);
  document.getElementById('vitals-hpmax').textContent = max > 0 ? 'of ' + max : '';
  const ac = _vitEl('ac')?.value, sp = _vitEl('speed')?.value;
  document.getElementById('vitals-ac').textContent = ac || '-';
  document.getElementById('vitals-speed').textContent = sp || '-';
}

// sign: -1 damage, +1 healing. Temp HP soaks damage first, as 5e expects.
function vitalsApply(sign) {
  const amtEl = document.getElementById('vitals-amt');
  let amt = Math.abs(parseInt(amtEl.value, 10));
  if (!amt || isNaN(amt)) { amtEl.focus(); return; }
  const curEl = _vitEl('hpcur'), tmpEl = _vitEl('hptemp');
  if (!curEl) return;
  let cur = parseInt(curEl.value, 10) || 0;
  const max = parseInt(_vitEl('hpmax')?.value, 10) || 0;

  if (sign < 0) {
    let tmp = parseInt(tmpEl?.value, 10) || 0;
    if (tmp > 0) {
      const soaked = Math.min(tmp, amt);
      tmp -= soaked; amt -= soaked;
      tmpEl.value = String(tmp);
      tmpEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    cur = Math.max(0, cur - amt);
  } else {
    cur = max > 0 ? Math.min(max, cur + amt) : cur + amt;
  }
  curEl.value = String(cur);
  // bubbles so the delegated autosave listener on #char-body picks it up
  curEl.dispatchEvent(new Event('input', { bubbles: true }));
  amtEl.value = '';
  syncVitals();
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('[data-key="hpcur"],[data-key="hpmax"],[data-key="hptemp"],[data-key="ac"],[data-key="speed"]')) syncVitals();
  });
  // Enter in the amount box applies damage, the commoner case in play
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'vitals-amt') { e.preventDefault(); vitalsApply(-1); }
  });
}
