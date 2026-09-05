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

// ── Right-panel Handouts tab ──────────────────────────────────────────────────
// The fifth tab on the character sheet in the right panel, beside Items. It
// serves two audiences from one place:
//
//   player, own token   their handouts — Examine while pending, then the body
//                       they earned once the DM has confirmed
//   DM, a PC's token    the same character's handouts plus the controls to run
//                       them: hand out, see the roll, tag Success or Fail,
//                       grant a re-roll, take it back
//
// That is what lets a DM run handouts from the map screen without opening
// /handouts.html.

let _sideHandouts = [];        // raw API rows (DM shape or player shape)
let _sideHandoutsFor = null;   // charId the cache belongs to
let _sideHandoutsLoading = false;

// The right panel is narrow, so rows collapse to a single title line. Anything
// that wants attention opens itself; everything else stays shut until clicked.
// Explicit clicks are remembered so a repaint (or a realtime refresh) does not
// snap a row the DM just opened back closed.
const _sideHandoutOpen = new Set();     // ids explicitly opened
const _sideHandoutShut = new Set();     // ids explicitly closed

function _sideHandoutWantsAttention(h, rec) {
  if (isDM()) return !!rec && rec.outcome === 'rolled';
  return h.canRoll || ((h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt);
}
function _sideHandoutIsOpen(h, rec) {
  if (_sideHandoutOpen.has(h.id)) return true;
  if (_sideHandoutShut.has(h.id)) return false;
  return _sideHandoutWantsAttention(h, rec);
}
function toggleSideHandout(id) {
  // Toggle from what is actually on screen, not just from the explicit sets. A
  // row that opened itself (because it wants attention) is in neither set, so
  // keying off _sideHandoutOpen alone would swallow the first click and take
  // two presses to close.
  const { given } = _sideHandoutSplit(_sideCharId);
  const entry = given.find(({ h }) => h.id === id);
  const isOpen = entry ? _sideHandoutIsOpen(entry.h, entry.rec) : _sideHandoutOpen.has(id);
  if (isOpen) { _sideHandoutOpen.delete(id); _sideHandoutShut.add(id); }
  else { _sideHandoutShut.delete(id); _sideHandoutOpen.add(id); }
  refreshSideHandoutsPane();
}
/** Collapse or expand every row at once. */
function setAllSideHandouts(open) {
  _sideHandoutOpen.clear(); _sideHandoutShut.clear();
  const { given } = _sideHandoutSplit(_sideCharId);
  for (const { h } of given) (open ? _sideHandoutOpen : _sideHandoutShut).add(h.id);
  refreshSideHandoutsPane();
}

/** What this character holds, and (DM only) what they could still be given. */
function _sideHandoutSplit(charId) {
  if (isDM()) {
    const given = [], available = [];
    for (const h of _sideHandouts) {
      const rec = (h.recipients || []).find(r => r.charId === charId);
      if (rec) given.push({ h, rec }); else available.push(h);
    }
    return { given, available };
  }
  return { given: _sideHandouts.map(h => ({ h, rec: null })), available: [] };
}

/** Badge number: whatever needs someone's attention. */
function sideHandoutBadge(charId) {
  if (!charId) return 0;
  const { given } = _sideHandoutSplit(charId);
  if (isDM()) return given.filter(({ rec }) => rec.outcome === 'rolled').length;
  return given.filter(({ h }) =>
    h.canRoll || ((h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt)).length;
}

async function loadSideHandouts(charId, { rerender = true } = {}) {
  if (!charId || _sideHandoutsLoading) return;
  _sideHandoutsLoading = true;
  try {
    const res = await fetch('/api/handouts', { headers: authHeaders() });
    _sideHandouts = res.ok ? await res.json() : [];
    if (!Array.isArray(_sideHandouts)) _sideHandouts = [];
  } catch { _sideHandouts = []; }
  _sideHandoutsFor = charId;
  _sideHandoutsLoading = false;
  if (rerender) refreshSideHandoutsPane();
}

/** Repaints just the pane and its badge, leaving the rest of the sheet alone. */
function refreshSideHandoutsPane() {
  const charId = _sideCharId;
  if (!charId) return;
  const pane = document.getElementById('rp-tab-handouts');
  if (pane) pane.innerHTML = renderSideHandoutsPane(charId);
  const btn = document.getElementById('rp-tabbtn-handouts');
  if (btn) {
    const n = sideHandoutBadge(charId);
    btn.textContent = n ? 'Handouts (' + n + ')' : 'Handouts';
    btn.classList.toggle('rp-tab-alert', n > 0);
  }
}

function renderSideHandoutsPane(charId) {
  if (!charId) return '<div class="rp-tab-empty">No character.</div>';
  if (_sideHandoutsFor !== charId) return '<div class="rp-tab-empty">Loading…</div>';

  const { given, available } = _sideHandoutSplit(charId);
  let html = '';

  // Toolbar: the modal (multi-character hand-out) plus expand/collapse all.
  html += '<div class="ho-rp-bar">'
    + (isDM() ? '<button class="btn sm primary" onclick="openHandoutModal()">＋ Hand out…</button>' : '')
    + '<span style="flex:1"></span>'
    + (given.length
        ? '<button class="btn sm" title="Expand all" onclick="setAllSideHandouts(true)">⌄</button>'
          + '<button class="btn sm" title="Collapse all" onclick="setAllSideHandouts(false)">⌃</button>'
        : '')
    + '</div>';

  html += given.length
    ? given.map(({ h, rec }) => isDM() ? _sideHandoutDmRow(h, rec, charId) : _sideHandoutPlayerRow(h)).join('')
    : '<div class="rp-tab-empty">Nothing handed to this character yet.</div>';

  // DM only: the quick per-character Give list, kept alongside the modal.
  if (isDM()) {
    html += '<div class="rp-flat-hdr">Give To This Character</div><div class="rp-blk-body">';
    html += available.length
      ? available.map(h =>
          '<div class="ho-rp-avail">'
          + '<span class="ho-rp-avail-name" title="' + esc(h.title) + '">' + esc(h.title) + '</span>'
          + '<button class="btn sm" onclick="sideHandoutGive(\'' + escJs(h.id) + '\',\'' + escJs(charId) + '\')">Give</button>'
          + '</div>').join('')
      : '<div class="ho-rp-none">Every handout is already with this character.</div>';
    html += '<div class="ho-rp-none" style="margin-top:6px">'
          + '<a href="/handouts.html" style="color:var(--ac)">Manage handouts →</a></div></div>';
  }
  return html;
}

/** DM row: the roll, the DC's suggestion, and the buttons that resolve it. */
function _sideHandoutDmRow(h, rec, charId) {
  const rolled = rec.rollTotal != null;
  const suggest = (rec.suggested && rec.outcome === 'rolled')
    ? '<span class="ho-rp-suggest">suggests ' + (rec.suggested === 'success' ? '✅' : '❌') + '</span>'
    : '';
  const check = h.checkSkill >= 0
    ? esc(h.checkSkillName) + (h.checkDc ? ' DC ' + h.checkDc : '')
    : 'No check';
  const tag = (o, cls, label, title) =>
    '<button class="btn sm ' + cls + '"' + (title ? ' title="' + title + '"' : '')
    + ' onclick="sideHandoutTag(\'' + escJs(h.id) + '\',\'' + escJs(charId) + '\',\'' + o + '\')">' + label + '</button>';

  const open = _sideHandoutIsOpen(h, rec);
  return '<div class="ho-rp-item' + (open ? ' open' : '') + '">'
    + '<div class="ho-rp-top" onclick="toggleSideHandout(\'' + escJs(h.id) + '\')" title="' + (open ? 'Collapse' : 'Expand') + '">'
    +   '<span class="ho-rp-caret">' + (open ? '⌄' : '›') + '</span>'
    +   '<span class="ho-rp-title">' + esc(h.title) + '</span>'
    +   '<span class="ho-rp-pill ' + esc(rec.outcome) + '">' + esc(rec.outcome) + '</span>'
    + '</div>'
    + (open
        ? '<div class="ho-rp-detail-wrap">'
          + '<div class="ho-rp-sub">' + check
          +   (rolled
                ? ' · rolled <b>' + rec.rollTotal + '</b> <span class="ho-rp-detail">' + esc(rec.rollDetail || '') + '</span>'
                : ' · not rolled')
          +   suggest
          + '</div>'
          + '<div class="ho-rp-btns">'
          +   tag('success', 'ho-ok', 'Success')
          +   tag('fail', 'ho-bad', 'Fail')
          +   (rolled ? tag('pending', '', '↺', 'Clear the roll so they can try again') : '')
          +   '<button class="btn sm" title="Take it back" onclick="sideHandoutRecall(\'' + escJs(h.id) + '\',\'' + escJs(charId) + '\')">✕</button>'
          + '</div>'
          + '</div>'
        : '')
    + '</div>';
}

/** Player row: exactly the state the server permitted — never both bodies. */
function _sideHandoutPlayerRow(h) {
  const unread = (h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt;
  let body;
  if (h.canRoll) {
    body = '<div class="ho-rp-prompt">' + esc(h.promptText || 'Something here rewards a closer look.') + '</div>'
         + '<button class="btn sm primary" style="margin-top:6px" onclick="sideHandoutExamine(\'' + escJs(h.id) + '\',this)">🔍 Examine</button>';
  } else if (h.awaitingDm) {
    body = '<div class="ho-rp-prompt">' + esc(h.promptText || '') + '</div>'
         + '<div class="ho-rp-wait">You study it closely…</div>';
  } else {
    const img = h.imageMedium || h.imageThumb;
    body = (img
        ? '<img class="ho-rp-img" src="' + esc(img) + '" alt="" onclick="lightboxOpen(\'' + escJs(h.imageUrl || h.imageMedium) + '\')">'
        : '')
      + '<div class="ho-rp-body">' + esc(h.text || '') + '</div>';
  }
  const open = _sideHandoutIsOpen(h, null);
  return '<div class="ho-rp-item' + (unread ? ' unread' : '') + (open ? ' open' : '') + '">'
    + '<div class="ho-rp-top" onclick="toggleSideHandout(\'' + escJs(h.id) + '\')" title="' + (open ? 'Collapse' : 'Expand') + '">'
    +   '<span class="ho-rp-caret">' + (open ? '⌄' : '›') + '</span>'
    +   '<span class="ho-rp-title">' + esc(h.title) + '</span>'
    +   (unread ? '<span class="ho-rp-new">new</span>' : '')
    + '</div>'
    + (open ? '<div class="ho-rp-detail-wrap">' + body + '</div>' : '')
    + '</div>';
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function sideHandoutGive(handoutId, charId) {
  try {
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/hand-out', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ charIds: [charId] }),
    });
  } catch {}
  await loadSideHandouts(charId);
}

async function sideHandoutTag(handoutId, charId, outcome) {
  try {
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recipients/' + encodeURIComponent(charId), {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ outcome }),
    });
  } catch {}
  await loadSideHandouts(charId);
}

async function sideHandoutRecall(handoutId, charId) {
  try {
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recall', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ charId }),
    });
  } catch {}
  await loadSideHandouts(charId);
}

async function sideHandoutExamine(handoutId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Blind: no number comes back, and none is rendered.
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/roll', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({}),
    });
  } catch {}
  await loadSideHandouts(_sideCharId);
}

/** Opening the tab counts as reading whatever is readable. */
async function sideHandoutsMarkSeen() {
  if (isDM() || !_sideCharId) return;
  const unread = _sideHandouts.filter(h =>
    (h.outcome === 'success' || h.outcome === 'fail') && !h.seenAt);
  if (!unread.length) return;
  for (const h of unread) {
    try {
      await fetch('/api/handouts/' + encodeURIComponent(h.id) + '/seen', { method: 'POST', headers: authHeaders() });
      h.seenAt = new Date().toISOString();
    } catch {}
  }
  refreshSideHandoutsPane();
}

// ── Hand-out modal (DM) ───────────────────────────────────────────────────────
// One dialog for the whole life of a handout: pick it, give it to any mix of
// characters, then watch the checks land and resolve them — without a token
// selected and without leaving the map.
//
// Each character appears once. Whether they hold the handout decides what their
// row is: a tick box to give it to them, or their roll, the DC's suggestion and
// the buttons that resolve it. Rolls arrive over the `handouts` realtime event,
// so the roster updates itself while it sits open.

let _hoModalPick = null;              // handout id selected in the modal
const _hoModalChecked = new Set();    // charIds ticked, kept across repaints

function openHandoutModal(preselectId) {
  if (!isDM()) return;
  if (preselectId !== undefined) { _hoModalPick = preselectId || null; _hoModalChecked.clear(); }
  let modal = document.getElementById('handout-give-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'handout-give-modal';
    modal.className = 'ho-modal';
    // Backdrop click closes: nothing here is typed, so there is no work to lose.
    modal.addEventListener('click', e => { if (e.target === modal) closeHandoutModal(); });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  renderHandoutModal();
  _hoModalLoad();
}

function handoutModalIsOpen() {
  const m = document.getElementById('handout-give-modal');
  return !!m && m.style.display === 'flex';
}

/** Refetch the catalogue, then repaint if the dialog is still up. */
async function _hoModalLoad() {
  try {
    const res = await fetch('/api/handouts', { headers: authHeaders() });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        _sideHandouts = list;
        if (_sideCharId) _sideHandoutsFor = _sideCharId;
      }
    }
  } catch {}
  if (handoutModalIsOpen()) renderHandoutModal();
}

function closeHandoutModal() {
  const m = document.getElementById('handout-give-modal');
  if (m) m.style.display = 'none';
}

/** Remember ticks before a repaint so a roll landing does not clear them. */
function _hoModalCaptureChecks() {
  const boxes = document.querySelectorAll('#handout-give-modal .ho-mo-cb');
  if (!boxes.length) return;
  _hoModalChecked.clear();
  boxes.forEach(cb => { if (cb.checked) _hoModalChecked.add(cb.value); });
}

function renderHandoutModal() {
  const modal = document.getElementById('handout-give-modal');
  if (!modal) return;
  _hoModalCaptureChecks();

  const chars = (_charList || []).filter(c => (c.char_type || c.charType || 'pc') === 'pc');
  const picked = _sideHandouts.find(h => h.id === _hoModalPick) || null;

  const handoutRows = _sideHandouts.length
    ? _sideHandouts.map(h => {
        const recs = h.recipients || [];
        const waiting = recs.filter(r => r.outcome === 'rolled').length;
        const check = h.checkSkill >= 0
          ? esc(h.checkSkillName) + (h.checkDc ? ' DC ' + h.checkDc : '')
          : 'No check';
        return '<button class="ho-mo-pick' + (_hoModalPick === h.id ? ' active' : '') + '"'
          + ' onclick="hoModalPick(\'' + escJs(h.id) + '\')">'
          + '<span class="ho-mo-pick-name">' + esc(h.title)
          + (waiting ? '<span class="ho-mo-wait">' + waiting + ' waiting</span>' : '')
          + '</span>'
          + '<span class="ho-mo-pick-sub">' + check + (recs.length ? ' · with ' + recs.length : '') + '</span>'
          + '</button>';
      }).join('')
    : '<div class="ho-rp-none">No handouts yet. <a href="/handouts.html" style="color:var(--ac)">Create one →</a></div>';

  const recById = new Map((picked ? picked.recipients || [] : []).map(r => [r.charId, r]));
  const anySuggested = [...recById.values()].some(r => r.outcome === 'rolled' && r.suggested);
  const anyToGive = chars.some(c => !recById.has(c.id));

  const charRows = !chars.length
    ? '<div class="ho-rp-none">No player characters in this campaign.</div>'
    : !picked
      ? '<div class="ho-rp-none">Pick a handout above.</div>'
      : chars.map(c => {
          const rec = recById.get(c.id);
          if (!rec) {
            // Not a recipient yet — offer to give it to them.
            return '<label class="ho-mo-char">'
              + '<input type="checkbox" class="ho-mo-cb" value="' + esc(c.id) + '"'
              + (_hoModalChecked.has(c.id) ? ' checked' : '') + '>'
              + '<span class="ho-mo-name">' + esc(c.name) + '</span>'
              + '<span class="ho-mo-note">not handed out</span>'
              + '</label>';
          }
          return _hoModalRecipientRow(c, rec, picked);
        }).join('');

  modal.innerHTML =
      '<div class="ho-mo-box">'
    +   '<div class="ho-mo-hdr">'
    +     '<span class="ho-mo-title">📜 Handouts</span>'
    +     '<button class="btn sm" onclick="closeHandoutModal()">✕</button>'
    +   '</div>'
    +   '<div class="ho-mo-body">'
    +     '<div class="ho-mo-lbl">Handout</div>'
    +     '<div class="ho-mo-list">' + handoutRows + '</div>'
    +     '<div class="ho-mo-lbl" style="margin-top:12px">Characters &amp; Results'
    +       '<span class="ho-mo-bulk">'
    +         (anySuggested ? '<button class="btn sm" onclick="hoModalApplySuggested()">Apply suggested</button>' : '')
    +         (anyToGive ? '<button class="btn sm" onclick="hoModalAll(true)">All</button>'
                         + '<button class="btn sm" onclick="hoModalAll(false)">None</button>' : '')
    +       '</span>'
    +     '</div>'
    +     '<div class="ho-mo-chars">' + charRows + '</div>'
    +     '<div class="ho-mo-status" id="ho-mo-status"></div>'
    +   '</div>'
    +   '<div class="ho-mo-ft">'
    +     '<button class="btn primary" id="ho-mo-go" onclick="hoModalSubmit()"'
    +       (picked && anyToGive ? '' : ' disabled') + '>Hand Out</button>'
    +     '<button class="btn" onclick="closeHandoutModal()">Cancel</button>'
    +   '</div>'
    + '</div>';
}

/** A character who already holds it: their roll, the suggestion, the verdict. */
function _hoModalRecipientRow(c, rec, h) {
  const rolled = rec.rollTotal != null;
  const tag = (o, cls, label, title) =>
    '<button class="btn sm ' + cls + '"' + (title ? ' title="' + title + '"' : '')
    + ' onclick="hoModalTag(\'' + escJs(h.id) + '\',\'' + escJs(c.id) + '\',\'' + o + '\')">' + label + '</button>';

  return '<div class="ho-mo-rec ' + esc(rec.outcome) + '">'
    + '<div class="ho-mo-rec-top">'
    +   '<span class="ho-mo-name">' + esc(c.name) + '</span>'
    +   '<span class="ho-rp-pill ' + esc(rec.outcome) + '">' + esc(rec.outcome) + '</span>'
    + '</div>'
    + '<div class="ho-mo-rec-sub">'
    +   (rolled
        ? 'rolled <b>' + rec.rollTotal + '</b> <span class="ho-rp-detail">' + esc(rec.rollDetail || '') + '</span>'
          + (rec.suggested && rec.outcome === 'rolled'
              ? '<span class="ho-rp-suggest">suggests ' + (rec.suggested === 'success' ? '✅' : '❌') + '</span>'
              : '')
        : (h.checkSkill >= 0 ? 'waiting for them to examine it' : 'no check needed'))
    + '</div>'
    + '<div class="ho-mo-rec-btns">'
    +   tag('success', 'ho-ok', 'Success')
    +   tag('fail', 'ho-bad', 'Fail')
    +   (rolled ? tag('pending', '', '↺', 'Clear the roll so they can try again') : '')
    +   '<button class="btn sm" title="Take it back" onclick="hoModalRecall(\'' + escJs(h.id) + '\',\'' + escJs(c.id) + '\')">✕</button>'
    + '</div>'
    + '</div>';
}

function hoModalPick(id) {
  _hoModalPick = id;
  _hoModalChecked.clear();
  renderHandoutModal();
}

function hoModalAll(on) {
  document.querySelectorAll('#handout-give-modal .ho-mo-cb').forEach(cb => { cb.checked = on; });
  _hoModalCaptureChecks();
}

function _hoModalStatus(msg, cls) {
  const el = document.getElementById('ho-mo-status');
  if (el) { el.textContent = msg || ''; el.className = 'ho-mo-status ' + (cls || ''); }
}

async function hoModalSubmit() {
  if (!_hoModalPick) return;
  _hoModalCaptureChecks();
  const ids = [..._hoModalChecked];
  if (!ids.length) { _hoModalStatus('Tick at least one character.', 'err'); return; }

  const btn = document.getElementById('ho-mo-go');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/handouts/' + encodeURIComponent(_hoModalPick) + '/hand-out', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ charIds: ids }),
    });
    if (!res.ok) throw new Error('failed');
    _hoModalChecked.clear();
    _hoModalStatus('Handed to ' + ids.length + ' character' + (ids.length === 1 ? '' : 's') + '.', 'ok');
    await _hoModalLoad();
    if (_sideCharId) loadSideHandouts(_sideCharId);
  } catch {
    _hoModalStatus('Could not hand it out.', 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** The gate: nothing a player can read changes until this runs. */
async function hoModalTag(handoutId, charId, outcome) {
  try {
    const res = await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recipients/' + encodeURIComponent(charId), {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ outcome }),
    });
    if (!res.ok) throw new Error('failed');
    _hoModalStatus('', '');
  } catch { _hoModalStatus('Could not set the outcome.', 'err'); }
  await _hoModalLoad();
  if (_sideCharId) loadSideHandouts(_sideCharId);
}

async function hoModalApplySuggested() {
  const h = _sideHandouts.find(x => x.id === _hoModalPick);
  if (!h) return;
  const todo = (h.recipients || []).filter(r => r.outcome === 'rolled' && r.suggested);
  if (!todo.length) return;
  for (const r of todo) {
    try {
      await fetch('/api/handouts/' + encodeURIComponent(h.id) + '/recipients/' + encodeURIComponent(r.charId), {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ outcome: r.suggested }),
      });
    } catch {}
  }
  _hoModalStatus('Applied ' + todo.length + ' suggested outcome' + (todo.length === 1 ? '' : 's') + '.', 'ok');
  await _hoModalLoad();
  if (_sideCharId) loadSideHandouts(_sideCharId);
}

async function hoModalRecall(handoutId, charId) {
  try {
    await fetch('/api/handouts/' + encodeURIComponent(handoutId) + '/recall', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ charId }),
    });
  } catch {}
  await _hoModalLoad();
  if (_sideCharId) loadSideHandouts(_sideCharId);
}
