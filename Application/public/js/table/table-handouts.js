// ── Handouts on the table screen ──────────────────────────────────────────────
// A handout pops up the moment the DM hands it out, and again when they confirm
// the outcome — the second time is when the real body actually arrives.
//
// Players only; the DM authors and resolves handouts on /handouts.html, and
// popping their own handouts at them mid-session would be noise.

let _tblHandouts = [];
let _tblHandoutShown = new Set();   // ids already popped this session
let _tblHandoutQueue = [];

// charHeaders() already carries X-Character-Id + X-Character-Password.
const tblHandoutHeaders = () => charHeaders();

/** A handout is worth showing once its body exists, or when it invites a roll. */
function _tblHandoutIsShowable(h) {
  return h.canRoll || h.outcome === 'success' || h.outcome === 'fail';
}

// Each state change deserves its own pop, so the key includes the outcome.
function _tblHandoutKey(h) { return h.id + ':' + h.outcome; }

async function loadTableHandouts({ popNew = true } = {}) {
  if (isDM() || !sessionCharId) return;
  try {
    const res = await fetch('/api/handouts', { headers: tblHandoutHeaders() });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list)) return;

    const fresh = [];
    for (const h of list) {
      if (!_tblHandoutIsShowable(h)) continue;
      const key = _tblHandoutKey(h);
      if (_tblHandoutShown.has(key)) continue;
      _tblHandoutShown.add(key);
      fresh.push(h);
    }
    _tblHandouts = list;
    if (popNew && fresh.length) {
      _tblHandoutQueue.push(...fresh);
      if (!document.getElementById('handout-card')) _tblHandoutNext();
    }
  } catch {}
}

function _tblHandoutNext() {
  const h = _tblHandoutQueue.shift();
  if (h) showHandoutCard(h);
}

/**
 * Draggable card, deliberately NOT closed by an outside click — a handout is
 * something you read, and dismissing it by accident while leaning on the mouse
 * would be maddening. Same call the DM's image reveal makes.
 */
function showHandoutCard(h) {
  closeHandoutCard();

  const card = document.createElement('div');
  card.id = 'handout-card';
  card.innerHTML = `
    <div class="ho-card-hdr" id="handout-card-drag">
      <span class="ho-card-title">📜 ${esc(h.title)}</span>
      <button class="ho-card-x" onclick="closeHandoutCard()" title="Close">✕</button>
    </div>
    <div class="ho-card-body" id="handout-card-body">${_tblHandoutBody(h)}</div>`;
  document.body.appendChild(card);
  _tblHandoutMakeDraggable(card, document.getElementById('handout-card-drag'));
}

function _tblHandoutBody(h) {
  if (h.canRoll) {
    return `
      <div class="ho-card-prompt">${esc(h.promptText || 'Something here rewards a closer look.')}</div>
      <button class="btn primary" style="margin-top:10px" onclick="tblRollHandout('${escJs(h.id)}',this)">🔍 Examine</button>`;
  }
  if (h.awaitingDm) {
    return `
      <div class="ho-card-prompt">${esc(h.promptText || '')}</div>
      <div class="ho-card-wait">You study it closely…</div>`;
  }
  const img = h.imageMedium || h.imageUrl;
  return `
    ${img ? `<img class="ho-card-img" src="${esc(img)}" alt=""
                  onclick="lightboxOpen('${escJs(h.imageUrl || h.imageMedium)}')">` : ''}
    <div class="ho-card-text">${esc(h.text || '')}</div>`;
}

async function tblRollHandout(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Blind: the response carries no total, and none is rendered.
    await fetch(`/api/handouts/${encodeURIComponent(id)}/roll`, {
      method: 'POST', headers: tblHandoutHeaders(), body: JSON.stringify({}),
    });
  } catch {}
  const body = document.getElementById('handout-card-body');
  if (body) {
    body.innerHTML = '<div class="ho-card-wait">You study it closely…</div>';
  }
  // The DM's confirmation arrives later as a `handouts` event and re-pops it.
  loadTableHandouts({ popNew: false });
}

function closeHandoutCard() {
  const el = document.getElementById('handout-card');
  if (el) el.remove();
  if (_tblHandoutQueue.length) setTimeout(_tblHandoutNext, 200);
}

function _tblHandoutMakeDraggable(card, handle) {
  if (!handle) return;
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.addEventListener('mousedown', e => {
    if (e.target.classList.contains('ho-card-x')) return;
    dragging = true;
    const r = card.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    card.style.transform = 'none';
    card.style.left = ox + 'px';
    card.style.top = oy + 'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    card.style.left = (ox + e.clientX - sx) + 'px';
    card.style.top = (oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}
