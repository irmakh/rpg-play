// Written by Irmak Hakman — 2026-11-12 12:52
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * A confirmation in the page's own modal style, for steps that cannot be undone.
 *
 *   if (!await confirmDialog({ title, message, confirmText: 'Remove', danger: true })) return;
 *
 * Resolves true on the confirm button, false on Cancel, Escape or a click on
 * the backdrop. `message` is plain text; blank lines start a new paragraph.
 * Needs esc.js (esc) and the .modal-overlay / .modal-box styles of the page.
 */
function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay';
    wrap.style.display = 'flex';
    wrap.style.zIndex = '10000';
    const paras = String(message).split(/\n\s*\n/).map(p => `<p style="margin:0 0 var(--s2, 8px)">${esc(p.trim())}</p>`).join('');
    wrap.innerHTML = `<div class="modal-box" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" style="max-width:calc(440px*var(--fs, 1));width:92%">
        <div class="ct" id="cd-title">${esc(title)}</div>
        <div class="modal-body">${paras}</div>
        <div class="modal-btns">
          <button type="button" class="btn" data-cd="no">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-cd="yes">${esc(confirmText)}</button>
        </div>
      </div>`;
    const done = ok => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(ok);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) return done(false);
      const b = e.target.closest('[data-cd]');
      if (b) done(b.dataset.cd === 'yes');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-cd="no"]').focus();   // the safe choice has focus
  });
}
