// ── Parsing helpers ───────────────────────────────────────────────────────────
function parseConditions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isErr) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = isErr ? 'var(--err)' : 'var(--a66)';
  el.style.color = isErr ? 'var(--err)' : 'var(--tx)';
  el.style.display = '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'flex';
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function done(result) {
      modal.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function isDM() { return !!masterPw; }
function initials(name) {
  return String(name||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
}
// Returns what a given user should see as the token's name.
// Players see only the identifier for monsters (e.g. "A3"), DM sees full name.
function tokDisplayName(tok) {
  if (!isDM() && tok.type === 'monster') {
    if (tok.label) return tok.label;
    // Fallback for older tokens without label: show last word (the identifier)
    const parts = String(tok.name || '').trim().split(' ');
    return parts[parts.length - 1] || tok.name;
  }
  return tok.name;
}
function tokenRingColor(type) {
  if (type === 'character') return '#c8a04a';
  if (type === 'monster') return '#ff4444';
  if (type === 'npc') return '#7ec8e3';
  return '#888888';
}
function hpBarColor(pct) {
  if (pct >= 0.5) return '#44cc44';
  if (pct >= 0.25) return '#ffcc00';
  return '#ff4444';
}
function getActiveTurnTokenId() {
  if (!initData.currentId) return null;
  return tokens.find(t => t.initiativeId === initData.currentId)?.id || null;
}
function showStatus(msg, isErr) {
  // no status bar on this page, use console
  console.log((isErr ? 'ERROR: ' : '') + msg);
}
