// ── Panel pop-out ───────────────────────────────────────────────────────────
// Pops the left panel, right panel, or chat bar out into its own browser window.
// The REAL panel DOM node is moved into the pop-out window (not a copy), so it
// keeps updating live: the opener's document.getElementById / querySelector(All)
// are patched to also search open pop-out windows, which means every existing
// render path and SSE handler transparently targets the panel wherever it lives.
// Closing the pop-out window (or toggling the button again) docks the panel back
// into its exact original position.
(function () {
  const PANELS = {
    'left-panel': { title: 'Initiative & Tools',  w: 300, h: 760, btn: 'btn-pop-left'  },
    'side-panel': { title: 'Character / Details',  w: 320, h: 760, btn: 'btn-pop-right' },
    'chat-bar':   { title: 'Chat',                 w: 460, h: 540, btn: 'btn-pop-chat'  },
  };

  // id -> { win, placeholder, node, cssText, timer }
  const _popouts = {};
  let _patched = false;

  function _anyOpen() {
    for (const id in _popouts) { const w = _popouts[id].win; if (w && !w.closed) return true; }
    return false;
  }
  function _popupDocs() {
    const out = [];
    for (const id in _popouts) {
      const w = _popouts[id].win;
      if (w && !w.closed && w.document) out.push(w.document);
    }
    return out;
  }

  // Patch the opener's lookup methods so panel content living in a pop-out window
  // is still found by all the code that renders into it. No-ops (native path) when
  // nothing is popped out, so there is zero behaviour change in the common case.
  function _patchLookups() {
    if (_patched) return;
    _patched = true;
    const d = document;
    const _gebi = Document.prototype.getElementById;
    const _qs   = Document.prototype.querySelector;
    const _qsa  = Document.prototype.querySelectorAll;

    d.getElementById = function (id) {
      const el = _gebi.call(this, id);
      if (el || !_anyOpen()) return el;
      for (const pd of _popupDocs()) { const e = pd.getElementById(id); if (e) return e; }
      return el;
    };
    d.querySelector = function (sel) {
      const el = _qs.call(this, sel);
      if (el || !_anyOpen()) return el;
      for (const pd of _popupDocs()) { try { const e = pd.querySelector(sel); if (e) return e; } catch {} }
      return el;
    };
    d.querySelectorAll = function (sel) {
      const main = _qsa.call(this, sel);
      if (!_anyOpen()) return main;
      let extra = null;
      for (const pd of _popupDocs()) {
        try {
          const nl = pd.querySelectorAll(sel);
          if (nl.length) { if (!extra) extra = []; for (let i = 0; i < nl.length; i++) extra.push(nl[i]); }
        } catch {}
      }
      return extra ? [...main, ...extra] : main;
    };
  }

  // Window-control methods must never be clobbered, or an inline handler in the
  // pop-out could end up closing/moving the wrong window.
  const _DENY = new Set([
    'close', 'open', 'focus', 'blur', 'print', 'stop', 'alert', 'confirm', 'prompt',
    'postMessage', 'moveTo', 'moveBy', 'resizeTo', 'resizeBy', 'scroll', 'scrollTo',
    'scrollBy', 'find', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
  ]);
  // Copy the opener's global functions onto the pop-out window so inline on*
  // handlers (which resolve names in the pop-out's scope) reach the app code.
  // The functions themselves still run in the opener realm, so their `document`
  // is the opener's patched document — which finds the moved node.
  function _exposeGlobals(win) {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (_DENY.has(k)) continue;
      let v;
      try { v = window[k]; } catch { continue; }
      if (typeof v !== 'function') continue;
      try { win[k] = v; } catch {}
    }
  }

  function _markBtn(id, on) {
    const b = document.getElementById(PANELS[id].btn);
    if (b) b.classList.toggle('pop-active', on);
  }

  function _nudgeLayout() {
    if (typeof updateZoomFloat === 'function') { try { updateZoomFloat(); } catch {} }
    try { window.dispatchEvent(new Event('resize')); } catch {}
  }

  function _popOut(id) {
    const cfg = PANELS[id];
    if (!cfg || _popouts[id]) return;
    const node = document.getElementById(id);
    if (!node) return;
    _patchLookups();

    const win = window.open(
      '', 'popout-' + id,
      `width=${cfg.w},height=${cfg.h},resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no`
    );
    if (!win) { alert('Pop-out was blocked by the browser. Allow pop-ups for this site, then try again.'); return; }

    const theme = document.body.dataset.theme || 'classic';
    win.document.open();
    win.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + cfg.title + '</title>' +
      '<link rel="stylesheet" href="/css/table.css">' +
      '<link rel="stylesheet" href="/css/table-theme-modern.css">' +
      '<style>' +
        'html,body{margin:0;height:100%;overflow:hidden;background:var(--bg2,#1e1e1e)}' +
        '#po-host{position:fixed;inset:0;display:flex;flex-direction:column}' +
        '#po-host>*{flex:1 1 auto;min-height:0;width:100%!important;max-width:none!important;' +
          'height:auto!important;border:0!important;box-shadow:none!important}' +
        '#po-host>#chat-bar{display:flex;flex-direction:column}' +
        '#po-host #chat-body-wrap{flex:1 1 auto;min-height:0}' +
        '#po-host #chat-log{flex:1 1 auto;min-height:0;height:auto!important;max-height:none!important}' +
        '#po-host .resize-handle-h,#po-host .resize-handle,#po-host #rh-chat,' +
        '#po-host #rh-left,#po-host #rh-right{display:none!important}' +
      '</style></head><body><div id="po-host"></div></body></html>'
    );
    win.document.close();
    win.document.body.dataset.theme = theme;
    win.document.body.className = document.body.className;

    // Remember the original slot, then physically move the node into the pop-out.
    const placeholder = document.createComment('popout:' + id);
    node.parentNode.insertBefore(placeholder, node);
    _popouts[id] = { win, placeholder, node, cssText: node.style.cssText, timer: null };

    const host = win.document.getElementById('po-host');
    win.document.adoptNode(node);
    host.appendChild(node);
    node.style.display = '';   // make sure it is visible even if it was toggled off

    _exposeGlobals(win);
    _markBtn(id, true);
    _nudgeLayout();

    // Chat should open scrolled to the newest message (after layout settles).
    if (id === 'chat-bar') {
      setTimeout(() => { const log = node.querySelector('.chat-log'); if (log) log.scrollTop = log.scrollHeight; }, 80);
    }

    // Dock back the instant the window starts closing — the node is still alive
    // in the popup document here, which is far more reliable than re-homing an
    // orphaned node after the close poll notices (that left the panel inert).
    const onClose = () => _dock(id);
    try { win.addEventListener('pagehide', onClose); } catch {}
    try { win.addEventListener('beforeunload', onClose); } catch {}

    // Fallback poll in case pagehide/beforeunload doesn't fire.
    _popouts[id].timer = setInterval(() => {
      const rec = _popouts[id];
      if (rec && rec.win.closed) _dock(id);
    }, 600);
    try { win.focus(); } catch {}
  }

  function _dock(id) {
    const rec = _popouts[id];
    if (!rec) return;
    delete _popouts[id];
    if (rec.timer) clearInterval(rec.timer);

    // Pull the node back into the opener document and restore its exact slot.
    try { document.adoptNode(rec.node); } catch {}
    rec.node.style.cssText = rec.cssText || '';
    if (rec.placeholder && rec.placeholder.parentNode) {
      rec.placeholder.parentNode.replaceChild(rec.node, rec.placeholder);
    } else {
      document.body.appendChild(rec.node);
    }
    try { if (rec.win && !rec.win.closed) rec.win.close(); } catch {}
    _markBtn(id, false);
    _nudgeLayout();
    // Docked chat should show the newest message, not jump back to the top.
    if (id === 'chat-bar') {
      const log = rec.node.querySelector('.chat-log');
      if (log) setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    }
    // Let panels that cache per-token state rebind to the freshly re-homed DOM.
    try { window.dispatchEvent(new CustomEvent('popout-docked', { detail: { id } })); } catch {}
  }

  function togglePopout(id) {
    if (_popouts[id]) _dock(id);
    else _popOut(id);
  }

  // Don't leave orphaned pop-outs behind if the table page is reloaded/closed.
  window.addEventListener('beforeunload', () => {
    for (const id in _popouts) { try { _popouts[id].win.close(); } catch {} }
  });

  window.togglePopout = togglePopout;
  window.dockAllPopouts = function () { for (const id in _popouts) _dock(id); };
})();
