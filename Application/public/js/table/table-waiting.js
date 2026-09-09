// ── Waiting screens ───────────────────────────────────────────────────────────
// A waiting screen parks the table on a full-bleed image between scenes.
//
// Players get the image over the map and the left panel, and keep the character
// panel on the right so they can still roll and act. The DM keeps the map and
// carries on arranging it; only a banner tells them the players cannot see it.
//
// Shared by table.html and console/table-console.html, which loads the same
// table modules — so the console's map screen is covered by this same code.
//
// The hiding itself is NOT done here. The server withholds the map and other
// players' tokens from players outright (see GET /api/table in
// server/routes/table.js); this module is only the presentation of that.

let _waitingActive = null;   // the active screen record, or null

function isWaitingScreenActive() { return !!_waitingActive; }

/** Ask the server what is showing. Called once on load, before the map. */
async function initWaitingScreen() {
  try {
    const r = await fetch('/api/table/waiting-screen');
    if (r.ok) applyWaitingScreen((await r.json()).active, { initial: true });
  } catch {}
}

/**
 * Show or hide the waiting screen for this client.
 * @param {object|null} ws        the active screen, or null to close
 * @param {object} [opts]
 * @param {boolean} [opts.initial] true on first load, when there is no previous
 *   state to reconcile and no need to refetch the table
 */
function applyWaitingScreen(ws, opts = {}) {
  const was = _waitingActive;
  _waitingActive = ws || null;

  if (_waitingActive) _renderWaitingOverlay(_waitingActive);
  else _removeWaitingOverlay();

  _renderDmBanner();

  // Opening and closing changes what the server will hand this client, so the
  // table has to be re-read. Deliberately a refetch and never a reload: a
  // reload would restart the music and re-run the audio-owner election in
  // js/lib/music-sync.js, which is audible.
  if (!opts.initial && !!was !== !!_waitingActive && typeof fetchAll === 'function') {
    // The refetch re-renders the panels, so open the character panel again
    // once the new token list has actually landed.
    Promise.resolve(fetchAll()).then(() => {
      if (_waitingActive && !isDM()) _openCharacterPanel();
    });
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────
// Scoped to #table-wrap, never position:fixed over the viewport. #bg-music and
// #now-playing-bar are siblings OUTSIDE #table-wrap, so this leaves the music
// playing and its track name, seek bar and volume slider reachable — which is
// what players most want during a break.
function _renderWaitingOverlay(ws) {
  if (isDM()) { _removeWaitingOverlay(); return; }   // the DM keeps working

  const wrap = document.getElementById('table-wrap');
  if (!wrap) return;

  let el = document.getElementById('waiting-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'waiting-overlay';
    el.innerHTML =
      '<img id="waiting-overlay-img" alt="">' +
      '<div id="waiting-overlay-caption"></div>';
    wrap.appendChild(el);
  }

  const img = document.getElementById('waiting-overlay-img');
  const src = ws.imageUrl || ws.imageMedium || '';
  if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
  if (img) img.style.display = src ? '' : 'none';

  const cap = document.getElementById('waiting-overlay-caption');
  if (cap) {
    const text = ws.caption || '';
    cap.textContent = text;
    cap.style.display = text ? '' : 'none';
  }

  _openCharacterPanel();
}

/**
 * Make sure the character panel is actually there.
 *
 * On the modern theme the right panel is collapsed until a token is selected
 * (`.rp-open`, css/table-theme-modern.css), and there is no map left to click
 * to open it — so without this a player would be left with the image and
 * nothing else, which is the opposite of the point.
 */
async function _openCharacterPanel() {
  // Open it ON the player's own character rather than the "select a token"
  // placeholder — there is no map left to click, so nothing else would.
  //
  // openHpPanel() is async and closes the panel again for a token it does not
  // consider yours, and the table refetch re-renders underneath it, so the
  // class is (re)applied LAST and the whole thing is idempotent. Getting this
  // order wrong leaves the player with an image and no way to roll.
  if (typeof tokens !== 'undefined' && typeof isMyToken === 'function' && typeof openHpPanel === 'function') {
    const mine = tokens.find(t => isMyToken(t));
    if (mine) {
      if (typeof selectedTokenId !== 'undefined') selectedTokenId = mine.id;
      try { await openHpPanel(mine); } catch {}
    }
  }
  if (typeof loadSideQroll === 'function') { try { await loadSideQroll(); } catch {} }

  const sp = document.getElementById('side-panel');
  if (sp) { sp.style.display = ''; sp.classList.add('rp-open'); }
  if (typeof updateZoomFloat === 'function') updateZoomFloat();
}

function _removeWaitingOverlay() {
  document.getElementById('waiting-overlay')?.remove();
}

// ── DM banner ─────────────────────────────────────────────────────────────────
// The DM sees the map as normal, so without this it is genuinely easy to leave
// the players parked and wonder why nobody is reacting.
function _renderDmBanner() {
  const bar = document.getElementById('waiting-dm-banner');
  if (!isDM() || !_waitingActive) { bar?.remove(); return; }
  if (bar) {
    const label = bar.querySelector('.wdb-name');
    if (label) label.textContent = _waitingActive.name || 'Waiting screen';
    return;
  }
  const wrap = document.getElementById('table-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.id = 'waiting-dm-banner';
  el.innerHTML =
    '<span class="wdb-dot"></span>' +
    '<span>Players are on <b class="wdb-name">' + esc(_waitingActive.name || 'Waiting screen') + '</b>' +
    ' — they cannot see the map</span>' +
    '<button class="btn sm" onclick="closeWaitingScreen()">Bring them back</button>';
  wrap.appendChild(el);
}

// ── DM controls ───────────────────────────────────────────────────────────────
let _waitingList = [];

async function openWaitingPicker() {
  if (!isDM()) return;
  const modal = document.getElementById('waiting-picker-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const body = document.getElementById('waiting-picker-body');
  if (body) body.innerHTML = '<div class="wp-empty">Loading…</div>';
  try {
    const r = await fetch('/api/waiting-screens', { headers: dmHeaders() });
    const data = r.ok ? await r.json() : { screens: [] };
    _waitingList = data.screens || [];
    _renderWaitingPicker(data.activeId || '');
  } catch {
    if (body) body.innerHTML = '<div class="wp-empty">Could not load waiting screens.</div>';
  }
}

function closeWaitingPicker() {
  const m = document.getElementById('waiting-picker-modal');
  if (m) m.style.display = 'none';
}

function _renderWaitingPicker(activeId) {
  const body = document.getElementById('waiting-picker-body');
  if (!body) return;
  if (_waitingList.length === 0) {
    body.innerHTML =
      '<div class="wp-empty">No waiting screens yet.<br>' +
      '<a href="/waiting-screens.html">Create one →</a></div>';
    return;
  }
  body.innerHTML = _waitingList.map(w => {
    const on = w.id === activeId;
    const thumb = w.imageThumb || w.imageMedium || w.imageUrl || '';
    return (
      '<button class="wp-card' + (on ? ' active' : '') + '"' +
      ' onclick="showWaitingScreen(\'' + escJs(w.id) + '\')">' +
        (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '<div class="wp-noimg">no image</div>') +
        '<div class="wp-name">' + esc(w.name || 'Untitled') + '</div>' +
        (on ? '<div class="wp-badge">Showing</div>' : '') +
      '</button>'
    );
  }).join('');
}

async function showWaitingScreen(id) {
  if (!isDM()) return;
  try {
    const r = await fetch('/api/table/waiting-screen', {
      method: 'POST', headers: dmHeaders(), body: JSON.stringify({ id }),
    });
    if (r.ok) {
      // The DM's own client is not driven by the broadcast it just caused.
      applyWaitingScreen((await r.json()).active);
      closeWaitingPicker();
    }
  } catch {}
}

async function closeWaitingScreen() {
  if (!isDM()) return;
  try {
    const r = await fetch('/api/table/waiting-screen', {
      method: 'POST', headers: dmHeaders(), body: JSON.stringify({ id: '' }),
    });
    if (r.ok) { applyWaitingScreen(null); closeWaitingPicker(); }
  } catch {}
}
