// Written by Irmak Hakman — 2026-10-15 19:44
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Console login (shared by every console screen) ───────────────────────────
// The launcher, the map screen and the info panel each used to carry their own
// copy of this form - about 200 lines of markup, styles and script apiece. This
// is the one copy. A page loads it in <head> (after js/lib/auth-ui.js) and calls
// ConsoleLogin.init() from an inline script at the top of <body>:
//
//   ConsoleLogin.init({ title: 'Map screen' });
//
// If a session is already stored, init() returns it and draws nothing. If not,
// it covers the page with the login form and, after a successful login, either
// calls onLogin(session) or - the default - reloads so the page starts clean.
//
// The session it stores is the same object the rest of the app reads:
// sessionStorage.rpgSession = { role:'dm', masterPw:<token> } or
// { role:'character', characterId, characterName, charPw:<token> }. The
// "password" fields hold a SESSION TOKEN (rpgs_...) since v226, never a password.
//
// Console screens on the SAME device share one login through a BroadcastChannel
// (the Thor runs the map and the info panel as two windows). The session never
// travels through the server relay.
//
// In the Android console app (window.RpgNative) the login is REMEMBERED: it asks
// the server for a session with no fixed end (90 days unused, lib/sessions.js)
// and keeps a copy in localStorage, which the app keeps between starts. It is
// put back into sessionStorage as this file loads - before any other script
// reads it - and is gone on logout, or when the server ends the session
// (js/lib/realtime.js _dropStoredSession). A browser never does any of this.
const ConsoleLogin = (function () {
  const CHANNEL = 'rpg-console-session';
  let _bc = null;
  let _opts = {};
  let _capChar = null, _capDm = null;
  let _setupId = null, _setupTicket = null;
  let _campaign = null;       // {id, name} of the campaign this login is for

  const IN_APP = typeof window !== 'undefined' && !!window.RpgNative;
  const REMEMBER_KEY = 'rpgConsoleSession';

  // ── Stored session ─────────────────────────────────────────────────────────
  function session() {
    try {
      const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
      return s && s.role ? s : null;
    } catch { return null; }
  }

  function tokenOf(s) { return s ? (s.role === 'dm' ? s.masterPw : s.charPw) || '' : ''; }

  function store(sess) {
    sessionStorage.setItem('rpgSession', JSON.stringify(sess));
    if (IN_APP) { try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(sess)); } catch {} }
    // The table modules read the DM token from these two keys as well.
    if (sess.role === 'dm') {
      sessionStorage.setItem('tableMasterPw', sess.masterPw);
      sessionStorage.setItem('dmMasterPw', sess.masterPw);
    } else {
      sessionStorage.removeItem('tableMasterPw');
      sessionStorage.removeItem('dmMasterPw');
    }
  }

  function clear() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch {}
    sessionStorage.removeItem('rpgSession');
    sessionStorage.removeItem('tableMasterPw');
    sessionStorage.removeItem('dmMasterPw');
  }

  // Two sessions are "the same login" when they are the same role holding the
  // same token (DM) or the same character. Used to ignore our own echo.
  function sameLogin(a, b) {
    if (!a || !b || a.role !== b.role) return false;
    return a.role === 'dm' ? a.masterPw === b.masterPw : a.characterId === b.characterId;
  }

  // The app's remembered login, back in place before anything reads it.
  if (IN_APP && !session()) {
    try {
      const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
      if (saved && saved.role && String(tokenOf(saved)).startsWith('rpgs_')) store(saved);
    } catch {}
  }

  // ── Same-device sync ───────────────────────────────────────────────────────
  function openChannel() {
    if (_bc) return;
    try { _bc = new BroadcastChannel(CHANNEL); } catch { return; }
    _bc.onmessage = ev => {
      try {
        const d = ev.data || {};
        if (d.type === 'SESSION_REQUEST') {
          const mine = session();
          if (mine) _bc.postMessage({ type: 'SESSION_SYNC', session: mine });
        } else if (d.type === 'SESSION_SYNC' && d.session) {
          if (sameLogin(session(), d.session)) return;
          store(d.session);
          location.reload();
        } else if (d.type === 'SESSION_LOGOUT') {
          if (!session()) return;
          clear();
          location.reload();
        }
      } catch {}
    };
  }

  function announce(type, sess) {
    if (_bc) try { _bc.postMessage(sess ? { type, session: sess } : { type }); } catch {}
  }

  // ── The form ───────────────────────────────────────────────────────────────
  // Built with DOM calls for anything a player typed (a character's name); the
  // static skeleton is a fixed string with no interpolated data.
  // The look is the main login page's (login.html): a panel on the ground, the
  // RPG Play mark, a two-way Character / Dungeon Master switch, the gold Log in
  // button. Its styles are in css/console/console.css (.c-gate), on the shared
  // tokens, so a display template recolours it the same way.
  function buildGate(title, sub) {
    const gate = document.createElement('div');
    gate.className = 'c-gate';
    gate.id = 'c-gate';
    gate.innerHTML = `
      <div class="c-login">
        <div class="lg-logo">
          <h1><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-swords"></use></svg> RPG Play</h1>
          <p data-el="title"></p>
        </div>
        <!-- Shown only when the server hosts more than one campaign -->
        <div class="lg-field" data-el="campaign-field" hidden>
          <label for="c-login-campaign">Campaign</label>
          <select id="c-login-campaign"></select>
        </div>
        <!-- A live super-admin session on this device: no password needed. -->
        <div data-el="admin-enter" hidden>
          <p class="lg-err" data-el="err-admin" role="alert"></p>
          <button type="button" class="lg-btn" data-el="as-admin">Enter as super admin</button>
          <p class="lg-hint">You are logged in as super admin: you enter the chosen campaign as its DM.</p>
          <button type="button" class="lg-btn lg-btn-back" data-el="use-password">Log in with a password instead</button>
        </div>
        <div class="lg-tabs" role="tablist" aria-label="Who is logging in">
          <button type="button" role="tab" data-who="character" aria-selected="true">Character</button>
          <button type="button" role="tab" data-who="dm" aria-selected="false">Dungeon Master</button>
        </div>

        <form class="c-login-form" data-form="character" novalidate>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="lg-field">
                <label for="c-login-char">Character</label>
                <select id="c-login-char"><option value="">Loading…</option></select>
              </div>
              <div class="lg-field">
                <label for="c-login-char-pw">Password</label>
                <input id="c-login-char-pw" type="password" placeholder="Enter password…" autocomplete="current-password">
              </div>
            </div>
            <div class="c-login-col">
              <div data-el="cap-char"></div>
              <p class="lg-err" data-el="err-char" role="alert"></p>
              <button type="submit" class="lg-btn">Login</button>
            </div>
          </div>
        </form>

        <form class="c-login-form" data-form="setup" novalidate hidden>
          <div class="lg-step"><strong data-el="setup-name"></strong> has no password yet. Set one to continue.</div>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="lg-field">
                <label for="c-login-new1">New Password</label>
                <input id="c-login-new1" type="password" placeholder="Choose a password…" autocomplete="new-password">
              </div>
              <div class="lg-field">
                <label for="c-login-new2">Confirm Password</label>
                <input id="c-login-new2" type="password" placeholder="Confirm password…" autocomplete="new-password">
              </div>
            </div>
            <div class="c-login-col">
              <p class="lg-err" data-el="err-setup" role="alert"></p>
              <button type="submit" class="lg-btn">Set Password &amp; Login</button>
              <button type="button" class="lg-btn lg-btn-back" data-el="setup-back">Back</button>
            </div>
          </div>
        </form>

        <form class="c-login-form" data-form="dm" novalidate hidden>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="lg-field">
                <label for="c-login-dm-pw">Master Password</label>
                <input id="c-login-dm-pw" type="password" placeholder="Enter master password…" autocomplete="current-password">
              </div>
            </div>
            <div class="c-login-col">
              <div data-el="cap-dm"></div>
              <p class="lg-err" data-el="err-dm" role="alert"></p>
              <button type="submit" class="lg-btn">Login as DM</button>
            </div>
          </div>
        </form>

        <p class="lg-hint" data-el="sub"></p>
        <!-- The display template button (js/lib/template.js) -->
        <div class="lg-tpl" data-tpl-slot></div>
      </div>`;
    gate.querySelector('[data-el="title"]').textContent = title;
    gate.querySelector('[data-el="sub"]').textContent = sub;
    return gate;
  }

  function showGate() {
    let gate = document.getElementById('c-gate');
    if (gate) return gate;
    gate = buildGate(_opts.title || 'RPG Console', _opts.sub || 'Log in to continue.');
    document.body.appendChild(gate);

    const el   = name => gate.querySelector(`[data-el="${name}"]`);
    const form = name => gate.querySelector(`[data-form="${name}"]`);
    const byId = id => gate.querySelector('#' + id);

    // Which of the three forms is showing. 'setup' keeps the Character tab lit.
    function show(which) {
      for (const f of ['character', 'setup', 'dm']) form(f).hidden = f !== which;
      gate.querySelectorAll('[data-who]').forEach(b =>
        b.setAttribute('aria-selected', String(b.dataset.who === (which === 'dm' ? 'dm' : 'character'))));
      if (which === 'dm') { _capDm.ensure(); byId('c-login-dm-pw').focus(); }
      if (which === 'setup') byId('c-login-new1').focus();
    }

    gate.querySelectorAll('[data-who]').forEach(b => b.addEventListener('click', () => show(b.dataset.who)));

    _capChar = AuthUI.captcha(el('cap-char'), {});
    // lazy: do not spend a captcha on a tab the player may never open.
    _capDm   = AuthUI.captcha(el('cap-dm'), { lazy: true });

    // Player characters only - an NPC has no player to log in as it. The list
    // is the chosen campaign's: the server scopes it by the campaign cookie.
    function loadCharacters() {
      const sel = byId('c-login-char');
      if (!_campaign) { sel.replaceChildren(new Option('Choose a campaign first', '')); return; }
      sel.replaceChildren(new Option('Loading…', ''));
      fetch('/api/characters').then(r => (r.ok ? r.json() : Promise.reject()))
        .then(chars => {
          const pcs = chars.filter(c => c.char_type === 'pc');
          sel.replaceChildren(...(pcs.length
            ? pcs.map(c => new Option(c.name || '', c.id))
            : [new Option('No characters in this campaign', '')]));
        })
        .catch(() => { sel.replaceChildren(new Option('Could not load characters', '')); });
    }

    // Which campaign. A server may host several, each with its own characters
    // and its own DM password; the choice is kept in a cookie the server reads
    // on every request (POST /api/campaigns/:id/enter sets it). With a single
    // campaign there is nothing to choose and the field stays hidden.
    // Like login.html: the campaign's name under the mark, once there is one.
    function showCampaign() {
      el('title').textContent = (_opts.title || 'RPG Console') + (_campaign ? ' · ' + _campaign.name : '');
    }

    const campSel = byId('c-login-campaign');
    async function loadCampaigns() {
      let list = [], current = null;
      try {
        const [listRes, curRes] = await Promise.all([fetch('/api/campaigns'), fetch('/api/campaign/current')]);
        if (listRes.ok) list = await listRes.json();
        if (curRes.ok) current = await curRes.json();      // 409 when none is chosen yet
      } catch {}
      _campaign = current ? { id: current.id, name: current.name } : null;
      showCampaign();
      if (list.length > 1) {
        // Names go in as text - a DM typed them.
        campSel.replaceChildren(...(current ? [] : [new Option('Choose a campaign', '')]),
                                ...list.map(c => new Option(c.name || '', c.id)));
        campSel.value = current ? current.id : '';
        el('campaign-field').hidden = false;
      }
      loadCharacters();
    }
    campSel.addEventListener('change', async () => {
      const id = campSel.value;
      if (!id) return;
      try {
        const res = await fetch('/api/campaigns/' + encodeURIComponent(id) + '/enter', { method: 'POST' });
        if (!res.ok) throw new Error();
        const c = await res.json();
        _campaign = { id: c.id, name: c.name };
        showCampaign();
        // The placeholder has done its job once a campaign is chosen.
        if (campSel.options[0] && campSel.options[0].value === '') campSel.remove(0);
      } catch {
        _campaign = null;
        el('err-char').textContent = el('err-dm').textContent = 'Could not open that campaign.';
      }
      loadCharacters();
    });
    loadCampaigns();

    // Disable the form's submit button while a request is in flight.
    async function guarded(f, fn) {
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try { await fn(); } finally { btn.disabled = false; }
    }

    form('character').addEventListener('submit', e => {
      e.preventDefault();
      const err = el('err-char');
      const characterId = byId('c-login-char').value;
      const password = byId('c-login-char-pw').value;
      err.textContent = '';
      if (!characterId) { err.textContent = 'Choose a character.'; return; }
      if (!password)    { err.textContent = 'Enter your password.'; return; }
      guarded(e.target, async () => {
        const r = await AuthUI.login({ type: 'character', characterId, password, remember: IN_APP }, _capChar);
        if (r.data.needsSetup) {
          _setupId = r.data.characterId;
          _setupTicket = r.data.setupTicket || null;
          el('setup-name').textContent = r.data.characterName || 'This character';
          byId('c-login-new1').value = byId('c-login-new2').value = '';
          el('err-setup').textContent = '';
          show('setup');
          return;
        }
        if (!r.ok) { err.textContent = r.message; return; }
        finish({ role: 'character', characterId: r.data.characterId, characterName: r.data.characterName, charPw: r.data.token });
      });
    });

    form('setup').addEventListener('submit', e => {
      e.preventDefault();
      const err = el('err-setup');
      const pw1 = byId('c-login-new1').value, pw2 = byId('c-login-new2').value;
      err.textContent = '';
      if (!pw1)           { err.textContent = 'Enter a password.'; return; }
      if (pw1 !== pw2)    { err.textContent = 'The two passwords do not match.'; return; }
      if (pw1.length < 3) { err.textContent = 'Use at least 3 characters.'; return; }
      guarded(e.target, async () => {
        const r = await AuthUI.setFirstPassword(_setupId, pw1, _setupTicket, {}, { remember: IN_APP });
        if (!r.ok) { err.textContent = r.message; return; }
        finish({ role: 'character', characterId: r.data.characterId, characterName: r.data.characterName, charPw: r.data.token });
      });
    });
    el('setup-back').addEventListener('click', () => {
      _setupId = _setupTicket = null;
      byId('c-login-char-pw').value = '';
      show('character');
    });

    // A live super-admin session on this device enters any campaign as its DM
    // with no password: then that is all the form offers (the password login
    // stays one tap away).
    const tabs = gate.querySelector('.lg-tabs');
    function passwordLogin(on) {
      el('admin-enter').hidden = on;
      tabs.hidden = !on;
      if (on) show('character');
      else for (const f of ['character', 'setup', 'dm']) form(f).hidden = true;
    }
    el('use-password').addEventListener('click', () => passwordLogin(true));
    el('as-admin').addEventListener('click', async () => {
      const token = AuthUI.adminToken();
      if (!_campaign) { el('err-admin').textContent = 'Choose a campaign first.'; return; }
      if (!token || !(await AuthUI.adminTokenWorks(token))) {
        el('err-admin').textContent = 'The super admin session has ended. Log in on the maintenance page again.';
        passwordLogin(true);
        return;
      }
      finish({ role: 'dm', masterPw: token, superAdmin: true });
    });
    (async () => {
      const token = AuthUI.adminToken();
      if (token && await AuthUI.adminTokenWorks(token)) passwordLogin(false);
    })();

    form('dm').addEventListener('submit', e => {
      e.preventDefault();
      const err = el('err-dm');
      const password = byId('c-login-dm-pw').value;
      err.textContent = '';
      if (!password) { err.textContent = 'Enter the Dungeon Master password.'; return; }
      guarded(e.target, async () => {
        const r = await AuthUI.login({ type: 'dm', password, remember: IN_APP }, _capDm);
        if (!r.ok) { err.textContent = r.message; return; }
        finish({ role: 'dm', masterPw: r.data.token });
      });
    });

    return gate;
  }

  function finish(sess) {
    // The session remembers its campaign: js/lib/realtime.js drops a session
    // that turns up in a different campaign's pages.
    if (_campaign) { sess.campaignId = _campaign.id; sess.campaignName = _campaign.name; }
    store(sess);
    announce('SESSION_SYNC', sess);      // same device only
    if (typeof _opts.onLogin === 'function') {
      document.getElementById('c-gate')?.remove();
      window.RpgTemplate?.remount();     // its button was on the form
      _opts.onLogin(sess);
    } else {
      location.reload();
    }
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  /**
   * @param {{title?: string, sub?: string, onLogin?: (session: object) => void}} [opts]
   *   onLogin  called after a successful login instead of reloading the page
   * @returns the stored session, or null when the login form is now showing
   */
  function init(opts = {}) {
    _opts = opts;
    openChannel();

    let sess = session();
    // A tab from before v226 holds a plain password where the token belongs.
    // The server no longer accepts it, so drop it and ask again.
    if (sess && !String(tokenOf(sess)).startsWith('rpgs_')) { clear(); sess = null; }
    if (sess) return sess;

    // In the app with both screens open, only the top screen asks; this one
    // waits for it (the app knows which is which).
    if (IN_APP && typeof RpgNative.isLoginScreen === 'function' && !RpgNative.isLoginScreen()) showWaitGate();
    else showGate();
    // Another console window on this device may already be logged in: ask it.
    announce('SESSION_REQUEST');
    // In the app, a login on the other screen also lands in localStorage (the
    // remembered copy). Follow it from there too, in case the channel between
    // the two screens does not carry it.
    if (IN_APP) {
      window.addEventListener('storage', e => {
        if (e.key !== REMEMBER_KEY && e.key !== 'rpgApp:rpgSession') return;
        if (!session() && e.newValue) location.reload();
      });
    }
    return null;
  }

  /**
   * The bottom screen while the top one shows the login form: one form, not
   * two. It follows the login as soon as it happens; "Log in here instead" is
   * for when the top screen is not there to use.
   */
  function showWaitGate() {
    if (document.getElementById('c-gate')) return;
    const gate = document.createElement('div');
    gate.className = 'c-gate';
    gate.id = 'c-gate';
    gate.innerHTML = `
      <div class="c-login">
        <div class="lg-logo">
          <h1><svg class="lt-icon" aria-hidden="true" focusable="false"><use href="#i-swords"></use></svg> RPG Play</h1>
          <p data-el="title"></p>
        </div>
        <p class="lg-hint">Log in on the top screen. This screen follows as soon as you do.</p>
        <button type="button" class="lg-btn lg-btn-back" data-el="here">Log in here instead</button>
      </div>`;
    gate.querySelector('[data-el="title"]').textContent = _opts.title || 'RPG Console';
    gate.querySelector('[data-el="here"]').addEventListener('click', () => { gate.remove(); showGate(); });
    document.body.appendChild(gate);
  }

  /** Ends the session on the server and on every console screen on this device. */
  function logout() {
    const sess = session();
    // A campaign opened with the super admin's session leaves that session alive.
    if (sess && !sess.superAdmin) AuthUI.logout(tokenOf(sess));
    announce('SESSION_LOGOUT');
    clear();
    location.reload();
  }

  return { init, logout, session };
})();

// A top-level const is not a window property, and the Android app's "Switch
// campaign" calls window.ConsoleLogin.logout() from outside the page.
window.ConsoleLogin = ConsoleLogin;
