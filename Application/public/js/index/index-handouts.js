// ── Handouts tab (player) ─────────────────────────────────────────────────────
// Everything the DM has handed this character, newest first. The server has
// already redacted each one to the outcome this character earned: a handout
// still awaiting a check carries neither body, so there is nothing here to hide.

let _handouts = [];
let _handoutsLoading = false;

function handoutAuthHeaders() {
  // Same idiom as loadMedia(): the character's own password, falling back to the
  // master password when a DM is looking at the sheet (charAuth accepts either).
  const h = { 'Content-Type': 'application/json' };
  if (currentCharId) h['X-Character-Id'] = currentCharId;
  if (charPasswords[currentCharId]) h['X-Character-Password'] = charPasswords[currentCharId];
  else if (indexMasterPw()) h['X-Character-Password'] = indexMasterPw();
  return h;
}

async function loadHandouts() {
  if (!currentCharId || _handoutsLoading) return;
  _handoutsLoading = true;
  try {
    const res = await fetch('/api/handouts', { headers: handoutAuthHeaders() });
    if (!res.ok) { _handouts = []; }
    else {
      const all = await res.json();
      // A DM viewing the page gets the DM shape (which has `recipients`); the
      // tab is the player view, so ignore anything that is not player-shaped.
      _handouts = Array.isArray(all) ? all.filter(h => !h.recipients) : [];
    }
  } catch { _handouts = []; }
  _handoutsLoading = false;
  renderHandouts();
  updateHandoutBadge();
}

/** Unread = resolved (readable) and not yet opened. */
function unreadHandoutCount() {
  return _handouts.filter(h => (h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt).length;
}

function updateHandoutBadge() {
  const btn = document.getElementById('tab-btn-handouts');
  if (!btn) return;
  const n = unreadHandoutCount();
  btn.textContent = n ? `📜 Handouts (${n})` : '📜 Handouts';
  btn.classList.toggle('has-unread', n > 0);
}

function renderHandouts() {
  const box = document.getElementById('handouts-list');
  if (!box) return;

  if (!_handouts.length) {
    box.innerHTML = '<div style="color:var(--ash);font-size:12px;padding:14px 0;text-align:center">'
      + 'Nothing has been handed to you yet.</div>';
    return;
  }

  box.innerHTML = _handouts.map(h => {
    const resolved = h.outcome === 'success' || h.outcome === 'fail';
    const unread = resolved && !h.seenAt;

    let body;
    if (h.canRoll) {
      // Blind check: no skill name, no DC, no number — just an invitation.
      body = `
        <div class="ho-prompt">${esc(h.promptText || 'Something here rewards a closer look.')}</div>
        <button class="add-btn" style="margin-top:8px" onclick="rollHandout('${escJs(h.id)}',this)">🔍 Examine</button>`;
    } else if (h.awaitingDm) {
      body = `
        <div class="ho-prompt">${esc(h.promptText || '')}</div>
        <div class="ho-wait">You study it closely… <span class="muted">waiting for the DM</span></div>`;
    } else if (resolved) {
      body = `
        ${h.imageMedium || h.imageUrl
          ? `<img class="ho-img" src="${esc(h.imageMedium || h.imageUrl)}" alt=""
                  onclick="lightboxOpen('${escJs(h.imageUrl || h.imageMedium)}')">`
          : ''}
        <div class="ho-body">${esc(h.text || '')}</div>`;
    } else {
      body = `<div class="ho-prompt">${esc(h.promptText || '')}</div>`;
    }

    return `
      <div class="ho-item${unread ? ' unread' : ''}" id="ho-${esc(h.id)}">
        <div class="ho-head">
          <span class="ho-title">${esc(h.title)}</span>
          ${h.tag ? `<span class="ho-tag">${esc(h.tag)}</span>` : ''}
          ${unread ? '<span class="ho-new">new</span>' : ''}
        </div>
        ${body}
      </div>`;
  }).join('');

  // Only a VISIBLE tab counts as reading. renderHandouts() also runs on a
  // background refresh (character select, or a `handouts` realtime event), and
  // marking seen there would silently consume the handout — suppressing the
  // pop-up on the table screen for something the player never actually saw.
  if (handoutsTabVisible()) markHandoutsSeen();
}

function handoutsTabVisible() {
  const pane = document.getElementById('tab-handouts');
  return !!pane && pane.classList.contains('active');
}

async function markHandoutsSeen() {
  const unread = _handouts.filter(h => (h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt);
  if (!unread.length) return;
  for (const h of unread) {
    try {
      await fetch(`/api/handouts/${encodeURIComponent(h.id)}/seen`, { method: 'POST', headers: handoutAuthHeaders() });
      h.seenAt = new Date().toISOString();
    } catch {}
  }
  updateHandoutBadge();
}

async function rollHandout(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(`/api/handouts/${encodeURIComponent(id)}/roll`, {
      method: 'POST', headers: handoutAuthHeaders(), body: JSON.stringify({}),
    });
    // The response carries no total on purpose — the check is blind.
    if (!res.ok && res.status !== 409) {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Examine'; }
      return;
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Examine'; }
    return;
  }
  await loadHandouts();
}
