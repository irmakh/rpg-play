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
