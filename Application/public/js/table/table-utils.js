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
function isDM() { return !!masterPw; }
function initials(name) {
  const words = String(name||'?').trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 4) || '?';
  // Multi-word: show first 3 chars of first word, keeps it readable without overflow
  return words[0].slice(0, 3) || '?';
}
// Returns the display name for a token. Monsters always show identifier only;
// full type/name is only visible in the right panel character sheet.
function tokDisplayName(tok) {
  if (tok.type === 'monster') {
    if (tok.label) return tok.label;
    // Fallback for older tokens without label: use last word (the auto-generated identifier)
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
  const byInitId = tokens.find(t => t.initiativeId === initData.currentId);
  if (byInitId) return byInitId.id;
  // Player entries: charId → token.linkedId fallback (token placed before initiative was rolled)
  const entry = initData.entries?.find(e => e.id === initData.currentId);
  if (entry?.charId && !entry.monsterId)
    return tokens.find(t => t.linkedId === entry.charId && t.type !== 'monster')?.id || null;
  return null;
}
function showStatus(msg, isErr) {
  // no status bar on this page, use console
  console.log((isErr ? 'ERROR: ' : '') + msg);
}

// ── Draggable modal utility ───────────────────────────────────────────────────
function makeDraggable(box, handle) {
  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button,input,select,textarea,a')) return;
    e.preventDefault();
    if (!box.style.left) {
      const r = box.getBoundingClientRect();
      box.style.position = 'fixed';
      box.style.margin   = '0';
      box.style.left     = r.left + 'px';
      box.style.top      = r.top  + 'px';
    }
    const ox = e.clientX - parseFloat(box.style.left);
    const oy = e.clientY - parseFloat(box.style.top);
    handle.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    function onMove(e) {
      box.style.left = Math.max(0, Math.min(window.innerWidth  - box.offsetWidth,  e.clientX - ox)) + 'px';
      box.style.top  = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - oy)) + 'px';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
