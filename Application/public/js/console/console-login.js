// Written by Irmak Hakman — 2026-10-10 23:39
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
const ConsoleLogin = (function () {
  const CHANNEL = 'rpg-console-session';
  let _bc = null;
  let _opts = {};
  let _capChar = null, _capDm = null;
  let _setupId = null, _setupTicket = null;
  let _campaign = null;       // {id, name} of the campaign this login is for

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
  function buildGate(title, sub) {
    const gate = document.createElement('div');
    gate.className = 'c-gate cx';
    gate.id = 'c-gate';
    gate.innerHTML = `
      <div class="c-login">
        <div>
          <h1 class="c-title" data-el="title"></h1>
          <p class="c-sub" data-el="sub"></p>
        </div>
        <!-- Shown only when the server hosts more than one campaign -->
        <div class="c-field" data-el="campaign-field" hidden>
          <label for="c-login-campaign">Campaign</label>
          <select class="c-input" id="c-login-campaign"></select>
        </div>
        <div class="c-seg" role="tablist" aria-label="Who is logging in">
          <button type="button" role="tab" data-who="character" aria-selected="true">Character</button>
          <button type="button" role="tab" data-who="dm" aria-selected="false">Dungeon Master</button>
        </div>

        <form class="c-login-form" data-form="character" novalidate>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="c-field">
                <label for="c-login-char">Character</label>
                <select class="c-input" id="c-login-char"><option value="">Loading…</option></select>
              </div>
              <div class="c-field">
                <label for="c-login-char-pw">Password</label>
                <input class="c-input" id="c-login-char-pw" type="password" autocomplete="current-password">
              </div>
            </div>
            <div class="c-login-col">
              <div data-el="cap-char"></div>
              <p class="c-err" data-el="err-char" role="alert"></p>
              <button type="submit" class="c-btn primary block">Log in</button>
            </div>
          </div>
        </form>

        <form class="c-login-form" data-form="setup" novalidate hidden>
          <p class="c-sub"><strong data-el="setup-name"></strong> has no password yet. Choose one to continue.</p>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="c-field">
                <label for="c-login-new1">New password</label>
                <input class="c-input" id="c-login-new1" type="password" autocomplete="new-password">
              </div>
              <div class="c-field">
                <label for="c-login-new2">Type it again</label>
                <input class="c-input" id="c-login-new2" type="password" autocomplete="new-password">
              </div>
            </div>
            <div class="c-login-col">
              <p class="c-err" data-el="err-setup" role="alert"></p>
              <button type="submit" class="c-btn primary block">Set password and log in</button>
              <button type="button" class="c-btn plain block" data-el="setup-back">Back</button>
            </div>
          </div>
        </form>

        <form class="c-login-form" data-form="dm" novalidate hidden>
          <div class="c-login-cols">
            <div class="c-login-col">
              <div class="c-field">
                <label for="c-login-dm-pw">Dungeon Master password</label>
                <input class="c-input" id="c-login-dm-pw" type="password" autocomplete="current-password">
              </div>
            </div>
            <div class="c-login-col">
              <div data-el="cap-dm"></div>
              <p class="c-err" data-el="err-dm" role="alert"></p>
              <button type="submit" class="c-btn primary block">Log in</button>
            </div>
          </div>
        </form>
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
    const campSel = byId('c-login-campaign');
    async function loadCampaigns() {
      let list = [], current = null;
      try {
        const [listRes, curRes] = await Promise.all([fetch('/api/campaigns'), fetch('/api/campaign/current')]);
        if (listRes.ok) list = await listRes.json();
        if (curRes.ok) current = await curRes.json();      // 409 when none is chosen yet
      } catch {}
      _campaign = current ? { id: current.id, name: current.name } : null;
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
        const r = await AuthUI.login({ type: 'character', characterId, password }, _capChar);
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
        const r = await AuthUI.setFirstPassword(_setupId, pw1, _setupTicket);
        if (!r.ok) { err.textContent = r.message; return; }
        finish({ role: 'character', characterId: r.data.characterId, characterName: r.data.characterName, charPw: r.data.token });
      });
    });
    el('setup-back').addEventListener('click', () => {
      _setupId = _setupTicket = null;
      byId('c-login-char-pw').value = '';
      show('character');
    });

    form('dm').addEventListener('submit', e => {
      e.preventDefault();
      const err = el('err-dm');
      const password = byId('c-login-dm-pw').value;
      err.textContent = '';
      if (!password) { err.textContent = 'Enter the Dungeon Master password.'; return; }
      guarded(e.target, async () => {
        const r = await AuthUI.login({ type: 'dm', password }, _capDm);
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

    showGate();
    // Another console window on this device may already be logged in: ask it.
    announce('SESSION_REQUEST');
    return null;
  }

  /** Ends the session on the server and on every console screen on this device. */
  function logout() {
    const sess = session();
    if (sess) AuthUI.logout(tokenOf(sess));
    announce('SESSION_LOGOUT');
    clear();
    location.reload();
  }

  return { init, logout, session };
})();
