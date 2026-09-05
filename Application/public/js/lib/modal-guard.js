// ── Modal dismissal guard ─────────────────────────────────────────────────────
//
// Stops a half-filled modal from being thrown away by an accidental gesture.
// Two things go wrong with the usual `onclick="if(event.target===this)close()"`
// backdrop handler:
//
//   1. A stray click on the backdrop silently discards everything typed.
//
//   2. Selecting text inside the modal and releasing the mouse past the edge of
//      the box ALSO closes it. `click` fires on the nearest common ancestor of
//      the mousedown and mouseup targets, so a drag that starts in a textarea
//      and ends on the backdrop reports the backdrop as its target — which is
//      indistinguishable from a real outside click if you only look at `click`.
//      This is the one that feels like "it just vanished".
//
// The guard fixes both: a dismissal only counts when the press *and* the release
// happened on the backdrop, and once the user has typed into the modal it asks
// before discarding. Escape is covered too, on the capture phase, so a page's
// own Escape handler never gets the chance to close a dirty modal.
//
// Usage:
//   guardModal('cal-event-modal', calCloseEventModal);                  // backdrop + Escape
//   guardModal('edit-modal', closeEditModal, { backdrop: false });      // Escape only
//
// Registering a modal here REPLACES its inline backdrop handler — remove the
// `onclick` from the element, or the two will fight and the inline one wins.

(function () {
  const FIELDS = 'textarea, input[type=text], input[type=password], input[type=number], ' +
                 'input[type=search], input[type=email], input[type=url], input[type=tel], input:not([type])';

  const DISCARD_PROMPT = 'Discard unsaved changes?';

  // overlay element -> { closeFn, touched, backdrop }
  const guarded = new Map();

  // NOT offsetParent: every one of these overlays is position:fixed, and a fixed
  // element reports offsetParent === null even when it is plainly on screen.
  // getClientRects() is honest about fixed positioning and about display:none on
  // an ancestor.
  function isVisible(el) {
    if (!el) return false;
    if (el.getClientRects().length > 0) return true;
    try { return getComputedStyle(el).display !== 'none'; } catch { return false; }
  }

  /** True once the user has typed into this modal since it was last opened. */
  function isDirty(el) {
    const g = guarded.get(el);
    return !!(g && g.touched);
  }

  /** Ask before throwing away typed input. Clean modals close with no prompt. */
  function mayClose(el) {
    if (!isDirty(el)) return true;
    return window.confirm(DISCARD_PROMPT);
  }

  function close(el) {
    const g = guarded.get(el);
    if (!g) return;
    g.touched = false;
    try { g.closeFn(); } catch (err) { console.error('modal-guard close failed', err); }
  }

  function guardModal(idOrEl, closeFn, opts) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el || guarded.has(el)) return el;
    const backdrop = !opts || opts.backdrop !== false;
    const g = { closeFn, touched: false, backdrop };
    guarded.set(el, g);

    // Any keystroke in a field marks the modal dirty. `input` covers typing,
    // paste and autofill; `change` catches selects and file pickers.
    el.addEventListener('input', () => { g.touched = true; });
    el.addEventListener('change', () => { g.touched = true; });

    // Reopening must start clean. Modals are shown by flipping an inline style
    // or a class, so watch both and reset the moment the modal goes away.
    try {
      new MutationObserver(() => { if (!isVisible(el)) g.touched = false; })
        .observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch {}

    if (backdrop) {
      // Remember where the press landed; a press inside the box means whatever
      // follows is a drag, not a dismissal.
      let pressedBackdrop = false;
      el.addEventListener('mousedown', e => { pressedBackdrop = e.target === el; });
      el.addEventListener('touchstart', e => { pressedBackdrop = e.target === el; }, { passive: true });
      el.addEventListener('click', e => {
        if (e.target !== el) return;          // click landed inside the box
        if (!pressedBackdrop) return;         // drag started inside — not a dismissal
        pressedBackdrop = false;
        if (mayClose(el)) close(el);
      });
    }
    return el;
  }

  // Escape, on the capture phase so it runs before the page's own keydown
  // handler.
  //
  // While a registered modal is open the guard OWNS the key: a clean modal
  // closes at once, a dirty one asks first, and either way the event is
  // swallowed so a page handler cannot close the modal behind our back. When no
  // registered modal is open the key is left completely alone — table.html in
  // particular binds Escape to cancelling placement mode, the draw tool and the
  // lightbox, and none of that may be disturbed.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const [el, g] of guarded) {
      if (!isVisible(el)) continue;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!g.touched || window.confirm(DISCARD_PROMPT)) close(el);
      return;
    }
  }, true);

  window.guardModal = guardModal;
  window.modalIsDirty = isDirty;
})();
