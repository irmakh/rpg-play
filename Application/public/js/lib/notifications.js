// ── Notifications ─────────────────────────────────────────────────────────────
// The bell, its panel, and the toasts that pop when something lands.
//
// A page opts in by having an element with [data-notif-bell] — the same
// no-per-page-wiring trick as #campaign-badge in realtime.js. Everything else
// (fetching, live delivery, read state, sound, mutes) happens here.
//
// Read state is the SERVER's, not this browser's: seenAt lives on the delivery
// row, so a notification you read on your phone is read on your laptop too, and
// clearing site data cannot resurrect a week of old alerts. Only the mute
// settings are local, because they are a per-device preference.

const NOTIF_MUTE_KEY = 'notifMutes';
const NOTIF_POLL_MS  = 120000;   // safety net; realtime does the real work

let _notifItems   = [];
let _notifUnread  = 0;
let _notifOpen    = false;
let _notifMe      = null;        // my recipient key: a charId, or 'dm'
let _notifReady   = false;
let _notifAudioCtx = null;

// ── Who am I, and how do I prove it ──────────────────────────────────────────
function _notifSession() {
  try { return JSON.parse(sessionStorage.getItem('rpgSession') || 'null') || {}; } catch { return {}; }
}

function notifHeaders() {
  const s = _notifSession();
  const h = {};
  if (s.role === 'dm') {
    h['X-Master-Password'] = s.masterPw || sessionStorage.getItem('dmMasterPw') || '';
  } else if (s.role === 'character' && s.characterId) {
    h['X-Character-Id'] = s.characterId;
    if (s.charPw) h['X-Character-Password'] = s.charPw;
  }
  return h;
}

/** The recipient key the server addresses me by, or null if I am nobody. */
function notifRecipientKey() {
  const s = _notifSession();
  if (s.role === 'dm') return 'dm';
  if (s.role === 'character' && s.characterId) return String(s.characterId);
  return null;
}

// ── Mute settings (per device, unlike read state) ────────────────────────────
function notifMutes() {
  try { return JSON.parse(localStorage.getItem(NOTIF_MUTE_KEY) || '{}') || {}; } catch { return {}; }
}
function notifSetMute(key, muted) {
  const m = notifMutes();
  m[key] = !!muted;
  try { localStorage.setItem(NOTIF_MUTE_KEY, JSON.stringify(m)); } catch {}
  _notifRenderPanel();
}
/** 'sound' and 'popup' are delivery switches; a kind can be silenced by name. */
function notifMuted(key) { return !!notifMutes()[key]; }

// ── Presentation ─────────────────────────────────────────────────────────────
const NOTIF_ICONS = {
  'loot-granted': '💰', 'loot-declined': '📭', 'loot-requested': '🙋',
  'handout': '📜', 'your-turn': '⚔️', 'combat-started': '⚔️',
  'dice': '🎲', 'chat': '💬', 'music': '🎵', 'damage': '🩸', 'healing': '💚',
  'condition': '🌀', 'shop-open': '🛒', 'shop-closed': '🛒', 'calendar': '📅',
};
function notifIcon(kind) { return NOTIF_ICONS[kind] || '🔔'; }

function notifAgo(iso) {
  const s = String(iso || '');
  const t = new Date(s + (s && !s.endsWith('Z') && s.includes('T') ? 'Z' : '')).getTime();
  if (!t) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h';
  return Math.floor(secs / 86400) + 'd';
}

function _notifEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Chime ────────────────────────────────────────────────────────────────────
// Synthesised rather than a file: two short notes, no asset to ship or cache,
// and it respects the same local volume the music player uses.
function notifChime() {
  if (notifMuted('sound')) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _notifAudioCtx = _notifAudioCtx || new Ctx();
    const ctx = _notifAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    let vol = 100;
    try { const v = localStorage.getItem('localVolume'); if (v !== null) vol = parseInt(v, 10); } catch {}
    const gainMax = Math.max(0, Math.min(1, (vol / 100) * 0.18));
    if (!gainMax) return;
    [[880, 0], [1174.7, 0.09]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainMax, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    });
  } catch {}
}

// ── Native / browser popups ──────────────────────────────────────────────────
// Only while the page is in the background: a popup for something the user is
// already looking at is just noise.
function notifPopup(n) {
  if (notifMuted('popup') || !document.hidden) return;
  try {
    if (window.rpgDesktop && typeof window.rpgDesktop.notify === 'function') {
      window.rpgDesktop.notify({
        title: n.title, body: n.body || '',
        href: (n.data && n.data.href) || '',
        newWindow: !!(n.data && n.data.window),
      });
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const pop = new Notification(n.title, { body: n.body || '', tag: n.id, silent: true });
    pop.onclick = () => {
      window.focus();
      notifFollow(n.data);
      pop.close();
    };
  } catch {}
}

/** Asks the browser for permission, from a click so the prompt is allowed. */
function notifRequestPermission() {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().then(() => _notifRenderPanel());
  } catch {}
}

// ── Where a notification takes you ───────────────────────────────────────────
/**
 * Follow a notification's link.
 *
 * `data.window` names a window to open instead of navigating: the music player
 * belongs in its own window, and replacing the character sheet you were reading
 * with it is not what "now playing" should do. The name is reused, so clicking
 * the same kind twice focuses the window you already have rather than stacking
 * a new one. A blocked popup falls back to navigating, which beats doing
 * nothing at all.
 */
function notifFollow(data) {
  const href = data && data.href;
  if (!href) return;
  if (data.window) {
    try {
      const win = window.open(href, String(data.window),
                              'width=440,height=620,resizable=yes,scrollbars=no');
      if (win) { try { win.focus(); } catch {} return; }
    } catch {}
  }
  if (location.pathname !== href) location.href = href;
}

// ── Toast ────────────────────────────────────────────────────────────────────
function notifToast(n) {
  let host = document.getElementById('notif-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'notif-toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'notif-toast';
  el.innerHTML =
    `<span class="notif-toast-icon">${notifIcon(n.kind)}</span>` +
    `<div class="notif-toast-text"><div class="notif-toast-title">${_notifEsc(n.title)}</div>` +
    (n.body ? `<div class="notif-toast-body">${_notifEsc(n.body)}</div>` : '') + '</div>';
  if (n.data && n.data.href) {
    el.style.cursor = 'pointer';
    el.onclick = () => notifFollow(n.data);
  }
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6000);
}

// ── Bell + panel ─────────────────────────────────────────────────────────────
function _notifBells() { return [...document.querySelectorAll('[data-notif-bell]')]; }

function _notifRenderCount() {
  for (const bell of _notifBells()) {
    let pill = bell.querySelector('.notif-count');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'notif-count';
      bell.appendChild(pill);
    }
    pill.textContent = _notifUnread > 99 ? '99+' : String(_notifUnread);
    pill.style.display = _notifUnread ? '' : 'none';
    bell.classList.toggle('has-unread', _notifUnread > 0);
  }
}

function _notifPanel() {
  let panel = document.getElementById('notif-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.innerHTML =
      `<div class="notif-hdr">
         <span class="notif-hdr-title">Notifications</span>
         <button class="notif-link" onclick="notifMarkAll()">Mark all read</button>
         <button class="notif-link" onclick="notifClear()" title="Remove these from your list">Clear</button>
         <button class="notif-link" onclick="notifToggleSettings()" title="Sound and popups">⚙</button>
       </div>
       <div id="notif-settings" style="display:none"></div>
       <div id="notif-list"></div>`;
    document.body.appendChild(panel);
    // A click anywhere else closes it, but not a click on a bell (that toggles).
    document.addEventListener('click', (e) => {
      if (!_notifOpen) return;
      if (panel.contains(e.target) || e.target.closest('[data-notif-bell]')) return;
      notifClose();
    });
  }
  return panel;
}

function _notifRenderPanel() {
  const panel = _notifPanel();
  const list = panel.querySelector('#notif-list');
  if (!list) return;

  if (_notifItems.length === 0) {
    list.innerHTML = '<div class="notif-empty">Nothing yet.</div>';
  } else {
    list.innerHTML = _notifItems.map(n => `
      <div class="notif-row${n.seen ? '' : ' unread'}" data-row="${_notifEsc(n.rowId)}"
           onclick="notifOpenItem('${_notifEsc(n.rowId)}')">
        <span class="notif-row-icon">${notifIcon(n.kind)}</span>
        <div class="notif-row-text">
          <div class="notif-row-title">${_notifEsc(n.title)}${
            n.count > 1 ? `<span class="notif-row-count">×${n.count}</span>` : ''}</div>
          ${n.body ? `<div class="notif-row-body">${_notifEsc(n.body)}</div>` : ''}
        </div>
        <span class="notif-row-when">${_notifEsc(notifAgo(n.createdAt))}</span>
      </div>`).join('');
  }

  const settings = panel.querySelector('#notif-settings');
  if (settings && settings.style.display !== 'none') {
    const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    const desktop = !!(window.rpgDesktop && window.rpgDesktop.notify);
    settings.innerHTML = `
      <label class="notif-set"><input type="checkbox" ${notifMuted('sound') ? '' : 'checked'}
        onchange="notifSetMute('sound', !this.checked)"> Chime on important ones</label>
      <label class="notif-set"><input type="checkbox" ${notifMuted('popup') ? '' : 'checked'}
        onchange="notifSetMute('popup', !this.checked)"> Popup when this window is in the background</label>
      <div class="notif-set-note">${desktop
        ? 'Desktop app: popups use Windows notifications.'
        : perm === 'granted' ? 'Browser notifications are allowed.'
        : perm === 'denied' ? 'Your browser is blocking notifications.'
        : perm === 'unsupported' ? 'This browser has no notification support.'
        : '<button class="notif-link" onclick="notifRequestPermission()">Allow browser notifications</button>'}</div>`;
  }
}

function notifToggleSettings() {
  const el = _notifPanel().querySelector('#notif-settings');
  el.style.display = el.style.display === 'none' ? '' : 'none';
  _notifRenderPanel();
}

function notifOpen() {
  _notifOpen = true;
  const panel = _notifPanel();
  panel.classList.add('open');
  // Anchor under whichever bell is on this page. Positioned from the LEFT and
  // clamped to the viewport: the bell sits at the far left of the character
  // sheet's bar and at the far right of the DM header, and anchoring by `right`
  // put the panel completely off-screen in the first case.
  const bell = _notifBells()[0];
  if (bell && window.innerWidth > 520) {
    const r = bell.getBoundingClientRect();
    const w = panel.offsetWidth || 330;
    // Prefer hanging under the bell's left edge; slide it back on screen if that
    // would overflow, and never let it start off the left edge either.
    const left = Math.min(Math.max(8, Math.round(r.left)), Math.max(8, window.innerWidth - w - 8));
    panel.style.top = Math.round(r.bottom + 6) + 'px';
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
  } else {
    // Narrow screens: let the stylesheet's full-width sheet rules apply.
    panel.style.left = '';
    panel.style.right = '';
    panel.style.top = '';
  }
  _notifRenderPanel();
  notifLoad();
}

function notifClose() {
  _notifOpen = false;
  _notifPanel().classList.remove('open');
}

function notifToggle() { _notifOpen ? notifClose() : notifOpen(); }

// ── Actions ──────────────────────────────────────────────────────────────────
async function notifOpenItem(rowId) {
  const n = _notifItems.find(i => i.rowId === rowId);
  if (!n) return;
  if (!n.seen) {
    n.seen = true;
    _notifUnread = Math.max(0, _notifUnread - 1);
    _notifRenderCount();
    _notifRenderPanel();
    try {
      await fetch('/api/notifications/' + encodeURIComponent(rowId) + '/seen',
                  { method: 'POST', headers: notifHeaders() });
    } catch {}
  }
  notifFollow(n.data);
}

async function notifMarkAll() {
  for (const n of _notifItems) n.seen = true;
  _notifUnread = 0;
  _notifRenderCount();
  _notifRenderPanel();
  try { await fetch('/api/notifications/seen-all', { method: 'POST', headers: notifHeaders() }); } catch {}
}

async function notifClear() {
  _notifItems = [];
  _notifUnread = 0;
  _notifRenderCount();
  _notifRenderPanel();
  try { await fetch('/api/notifications', { method: 'DELETE', headers: notifHeaders() }); } catch {}
}

async function notifLoad() {
  if (!_notifMe) return;
  try {
    const res = await fetch('/api/notifications?limit=50', { headers: notifHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    _notifItems = data.items || [];
    _notifUnread = data.unread || 0;
    _notifRenderCount();
    if (_notifOpen) _notifRenderPanel();
  } catch {}
}

// ── Live delivery ────────────────────────────────────────────────────────────
// Called by each page's realtime handler map. One event carries its recipient
// list; a client keeps only what is addressed to it.
function handleNotification(payload) {
  if (!_notifMe || !payload) return;
  const mine = Array.isArray(payload.recipients) && payload.recipients.includes(_notifMe);
  if (!mine) return;

  const item = {
    rowId: 'live-' + payload.id, id: payload.id, kind: payload.kind, priority: payload.priority,
    title: payload.title, body: payload.body, data: payload.data || {},
    actorName: payload.actorName, createdAt: payload.createdAt, count: payload.count || 1, seen: false,
  };

  // A coalesced event arrives under the id it folded into. Replace that row and
  // move it to the top rather than stacking a near-duplicate; it counts as
  // unread again, but only once no matter how many events it now stands for.
  const existing = _notifItems.findIndex(i => i.id === payload.id);
  if (existing !== -1) {
    const was = _notifItems[existing];
    item.rowId = was.rowId;                    // keep the delivery id we can mark read
    _notifItems.splice(existing, 1);
    _notifItems.unshift(item);
    if (was.seen) _notifUnread += 1;           // it had been read; now it is new again
  } else {
    _notifItems.unshift(item);
    _notifUnread += 1;
  }
  _notifRenderCount();
  if (_notifOpen) _notifRenderPanel();

  if (payload.priority === 'alert') {
    notifToast(item);
    notifChime();
    notifPopup(item);
  }
  // Replace the optimistic row with the real one, so marking it read addresses
  // a delivery the server knows about.
  notifLoad();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function initNotifications() {
  if (_notifReady) return;
  _notifMe = notifRecipientKey();
  const bells = _notifBells();
  if (!_notifMe || bells.length === 0) return;    // nobody to tell, or nowhere to show it
  _notifReady = true;

  for (const bell of bells) {
    bell.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); notifToggle(); });
  }

  // Pages that already talk to the server add `notification` to their own
  // handler map. Pages that have no realtime connection of their own opt in
  // with data-notif-bell="connect" and get one just for this — an explicit
  // marker rather than a guess, so no page ends up with two sockets.
  if (bells.some(b => b.getAttribute('data-notif-bell') === 'connect')
      && typeof connectRealtime === 'function') {
    connectRealtime({ notification: (p) => handleNotification(p) });
  }

  _notifRenderCount();
  notifLoad();
  // A backstop for a dropped realtime connection; the live path does the work.
  setInterval(notifLoad, NOTIF_POLL_MS);
}

document.addEventListener('DOMContentLoaded', initNotifications);
