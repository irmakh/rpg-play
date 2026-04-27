// ── Escape helper ─────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

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
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'shop')     loadShopTab();
  if (name === 'loot')     loadLootTab();
  if (name === 'calendar') pcalLoad();
}
