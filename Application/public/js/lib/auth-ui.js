/**
 * Login helpers shared by every page that asks for a password.
 *
 *   AuthUI.captcha(el, opts)   mounts the maths captcha into `el`
 *   AuthUI.login(body, cap)    POST /api/auth/login with the captcha answer
 *   AuthUI.adminLogin(pw, cap) POST /api/auth/admin-login
 *   AuthUI.verifyAny(pw, cap)  POST /api/auth/verify-any (the Stories gate)
 *   AuthUI.setFirstPassword(charId, pw, ticket, headers)
 *   AuthUI.logout(token)       ends a session on the server
 *
 * Self-contained on purpose — its own <style>, its own icon — because it is
 * loaded by pages that do not share a stylesheet or the icon sprite: the
 * console PWA, the AI DM and the Stories pages. Colours are the tokens.css
 * variables, with fallbacks for a page that does not link tokens.css.
 *
 * Every login answer carries a SESSION TOKEN. Pages store it exactly where they
 * used to store the typed password (rpgSession.masterPw / .charPw and the
 * legacy dmMasterPw / tableMasterPw keys), so every existing request header
 * keeps working and now carries the token instead.
 */
(function () {
  if (window.AuthUI) return;

  const STYLE = `
.authui-cap{margin-bottom:14px}
.authui-cap-lbl{display:block;font-size:10px;color:var(--bone,#E6EDF7);margin-bottom:4px}
.authui-cap-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.authui-cap-img{display:block;width:220px;max-width:calc(100% - 48px);height:auto;aspect-ratio:22/7;
  border-radius:var(--r-md,6px);background:var(--slate-hi,#1B2740);transition:opacity .15s}
.authui-cap-img.loading{opacity:.35}
.authui-cap-new{flex:none;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;
  padding:0;border-radius:var(--r-sm,3px);border:1px solid var(--rule-hi,#E6EDF733);background:transparent;
  color:var(--ash,#7F8FA8);cursor:pointer}
.authui-cap-new:hover,.authui-cap-new:focus-visible{color:var(--bone,#E6EDF7);background:var(--wash,#E6EDF70F)}
.authui-cap input.authui-cap-ans{letter-spacing:.06em}
`;

  function injectStyle() {
    if (document.getElementById('authui-style')) return;
    const s = document.createElement('style');
    s.id = 'authui-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const REFRESH_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" '
    + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

  const IMG_ALT = 'A maths problem. Type its answer in the box below.';
  let _uid = 0;

  /**
   * Mounts the captcha into `el`: the picture, a "new problem" button and the
   * answer box.
   * @param {HTMLElement} el
   * @param {{onEnter?: Function, lazy?: boolean}} [opts]
   *   onEnter  called when Enter is pressed in the answer box (submit the form)
   *   lazy     do not fetch a problem until ensure() — for a form in a hidden tab
   */
  function captcha(el, opts = {}) {
    if (!el) return null;
    injectStyle();
    const inputId = `authui-cap-${++_uid}`;
    el.classList.add('authui-cap');
    el.innerHTML = `
      <label class="authui-cap-lbl" for="${inputId}">Solve the maths problem</label>
      <div class="authui-cap-row">
        <img class="authui-cap-img" alt="${IMG_ALT}" width="220" height="70">
        <button type="button" class="authui-cap-new" title="New problem" aria-label="Show a new problem">${REFRESH_SVG}</button>
      </div>
      <input class="authui-cap-ans" id="${inputId}" type="text" inputmode="numeric" pattern="-?[0-9]*"
             autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="4" placeholder="Answer">`;
    const img = el.querySelector('img');
    const btn = el.querySelector('button');
    const input = el.querySelector('input');
    let id = '';
    let pending = null;

    function reload() {
      input.value = '';
      id = '';
      img.classList.add('loading');
      pending = (async () => {
        try {
          const res = await fetch('/api/auth/captcha', { cache: 'no-store' });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) { img.removeAttribute('src'); img.alt = d.error || 'Could not load a problem.'; return; }
          id = d.id;
          img.src = d.image;
          img.alt = IMG_ALT;
        } catch {
          img.removeAttribute('src');
          img.alt = 'Could not load a problem — check the connection.';
        } finally {
          img.classList.remove('loading');
          pending = null;
        }
      })();
      return pending;
    }

    btn.addEventListener('click', () => { reload(); input.focus(); });
    if (typeof opts.onEnter === 'function') {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); opts.onEnter(); } });
    }
    if (!opts.lazy) reload();

    return {
      values: () => ({ captchaId: id, captchaAnswer: input.value.trim() }),
      reload,
      ensure: () => (id || pending ? pending : reload()),
      focus: () => input.focus(),
      input,
    };
  }

  /**
   * POSTs a login form. Resolves { ok, status, data, message } and never throws.
   * After a refused attempt the captcha is reloaded: each one is single-use, so
   * the next try needs a new sum.
   */
  async function post(url, body, cap, headers = {}) {
    const vals = cap ? cap.values() : {};
    if (cap && !vals.captchaAnswer) {
      cap.focus();
      return { ok: false, status: 0, data: {}, message: 'Solve the maths problem first.' };
    }
    let res;
    let data = {};
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ...body, ...vals }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      if (cap) cap.reload();
      return { ok: false, status: 0, data: {}, message: 'Connection error.' };
    }
    if (cap && (!res.ok || data.needsSetup)) cap.reload();
    return { ok: res.ok, status: res.status, data, message: res.ok ? '' : (data.error || 'Login failed.') };
  }

  const login      = (body, cap, headers) => post('/api/auth/login', body, cap, headers);
  const adminLogin = (password, cap)      => post('/api/auth/admin-login', { password }, cap);
  const verifyAny  = (password, cap)      => post('/api/auth/verify-any', { password }, cap);

  /**
   * Sets a character's FIRST password with the ticket the login answered
   * `needsSetup` with. Resolves like post(); on success `data.token` is the new
   * session, so the player is not asked for a second captcha.
   */
  async function setFirstPassword(charId, newPassword, setupTicket, headers = {}) {
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(charId)}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ new_password: newPassword, setupTicket }),
      });
      const data = await res.json().catch(() => ({}));
      let message = '';
      if (!res.ok) {
        message = data.code === 'SETUP_TICKET'
          ? 'That took too long. Go back and log in again.'
          : (data.error || 'Failed to set password.');
      }
      return { ok: res.ok && !!data.token, status: res.status, data, message };
    } catch {
      return { ok: false, status: 0, data: {}, message: 'Connection error.' };
    }
  }

  /** Ends a session on the server. Fire-and-forget; survives the page unloading. */
  function logout(token) {
    if (!token || !String(token).startsWith('rpgs_')) return;
    try {
      fetch('/api/auth/logout', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    } catch {}
  }

  /** The DM session this tab already holds (rpgSession or the legacy key), if any. */
  function storedDmToken() {
    let t = '';
    try {
      const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
      if (s && s.role === 'dm') t = s.masterPw || '';
    } catch {}
    if (!t) t = sessionStorage.getItem('dmMasterPw') || '';
    return String(t).startsWith('rpgs_') ? t : '';
  }

  /**
   * The password gate on the DM tool pages (dm, treasury, monsters, prepare-map,
   * events, playlists).
   *
   *   start()   with a stored DM session, checks it is still live and unlocks
   *             straight away; otherwise mounts the captcha and waits for the form
   *   submit()  the form's Login: captcha + password -> a session token
   *
   * `onUnlock(token)` receives the TOKEN, which the page keeps in its masterPw
   * variable exactly where the typed password used to go.
   */
  function dmGate({ capEl, pwInput, errEl, onUnlock, probe = '/api/treasury/all' }) {
    let cap = null;
    const mount = () => { if (!cap) cap = captcha(capEl, { onEnter: submit }); };

    async function submit() {
      if (errEl) errEl.textContent = '';
      const pw = pwInput ? pwInput.value : '';
      if (!pw) { if (errEl) errEl.textContent = 'Enter the DM password.'; return; }
      mount();
      const r = await login({ type: 'dm', password: pw }, cap);
      if (!r.ok) { if (errEl) errEl.textContent = r.message; return; }
      if (pwInput) pwInput.value = '';
      sessionStorage.setItem('dmMasterPw', r.data.token);
      await onUnlock(r.data.token);
    }

    async function start() {
      const saved = storedDmToken();
      if (saved) {
        try {
          const res = await fetch(probe, { headers: { 'X-Master-Password': saved } });
          if (res.ok) { await onUnlock(saved); return; }
        } catch {}
      }
      mount();
    }

    return { submit, start };
  }

  window.AuthUI = { captcha, login, adminLogin, verifyAny, setFirstPassword, logout, dmGate, storedDmToken };
})();
