// Written by Irmak Hakman — 2026-11-15 12:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The "Give" dialog: hand one inventory item, or coins, to another character.
 * Shared by the character sheet (Inventory tab) and the table's right panel
 * (Items tab), so both offer the same choices and the same wording.
 *
 *   openGiveDialog({ fromId, item, headers, onDone })            one item
 *   openGiveDialog({ fromId, wallet: { cp, sp, ep, gp, pp }, headers, onDone })   coins
 *
 * `headers` is the page's own credential headers (the server checks that the
 * caller is the giver's player or the DM: POST /api/characters/:id/give).
 * onDone({ given, to }) runs after the server has moved it; the page's
 * 'characters' update then repaints both sheets. Errors stay in the dialog.
 * Needs esc.js and the page's .modal-overlay / .modal-box styles.
 */
const GIVE_COINS = [['pp', 'PP'], ['gp', 'GP'], ['ep', 'EP'], ['sp', 'SP'], ['cp', 'CP']];

// The dialog's few styles, added once, so neither page's stylesheet has to carry them.
function _giveStyles() {
  if (document.getElementById('give-dlg-css')) return;
  const st = document.createElement('style');
  st.id = 'give-dlg-css';
  st.textContent = `
    #give-dlg .give-what { margin: 0 0 8px; }
    #give-dlg .give-to { width: 100%; box-sizing: border-box; margin-bottom: 10px; }
    #give-dlg .give-coins { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
    #give-dlg .give-coin { display: flex; flex-direction: column; align-items: stretch; gap: 2px; text-align: center; }
    #give-dlg .give-coin input { width: 100%; box-sizing: border-box; text-align: center; }
    #give-dlg .give-have { font-size: calc(10px * var(--fs, 1)); opacity: .65; }
    #give-dlg .give-note { margin: 8px 0 0; font-size: calc(11px * var(--fs, 1)); opacity: .75; }
    #give-dlg .give-err { margin: 8px 0 0; color: var(--blood, #c0392b); font-size: calc(12px * var(--fs, 1)); }
    @media (max-width: 380px) { #give-dlg .give-coins { grid-template-columns: repeat(3, minmax(0, 1fr)); } }`;
  document.head.appendChild(st);
}

async function openGiveDialog({ fromId, item = null, wallet = null, headers = {}, onDone = null } = {}) {
  if (!fromId || (!item && !wallet)) return;
  document.getElementById('give-dlg')?.remove();
  _giveStyles();

  let people = [];
  try {
    const r = await fetch('/api/characters', { headers });
    if (r.ok) people = (await r.json()).filter(c => c && String(c.id) !== String(fromId));
  } catch {}
  // Player characters first, then NPCs; each list by name (the server sorts by name).
  people.sort((a, b) => (a.char_type === 'npc') - (b.char_type === 'npc'));

  const wrap = document.createElement('div');
  wrap.id = 'give-dlg';
  wrap.className = 'modal-overlay';
  wrap.style.display = 'flex';
  wrap.style.zIndex = '10000';
  const options = people.map(c =>
    `<option value="${esc(String(c.id))}">${esc(c.name || 'Unnamed')}${c.char_type === 'npc' ? ' (NPC)' : ''}</option>`).join('');
  const coinsHtml = wallet
    ? `<div class="give-coins">` + GIVE_COINS.map(([k, l]) => {
        const have = Math.max(0, parseInt(wallet[k]) || 0);
        return `<label class="give-coin"><span class="lbl">${l}</span>`
          + `<input type="number" min="0" max="${have}" step="1" value="" placeholder="0" data-coin="${k}" ${have ? '' : 'disabled'}>`
          + `<span class="give-have">of ${have}</span></label>`;
      }).join('') + `</div>`
    : '';
  const what = item
    ? `<p class="give-what">Give <strong>${esc(item.name || 'this item')}</strong> to:</p>`
    : `<p class="give-what">Give coins to:</p>`;
  wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="give-title" style="max-width:calc(420px*var(--fs, 1));width:92%">
      <div class="ct" id="give-title">${item ? 'Give Item' : 'Give Coins'}</div>
      <div class="modal-body">
        ${what}
        ${people.length
          ? `<select id="give-to" class="give-to" aria-label="Who receives it">${options}</select>`
          : `<p class="give-err">There is nobody else in this campaign to give it to.</p>`}
        ${coinsHtml}
        ${item && item.equipped ? '<p class="give-note">You are wearing it. It comes off when you hand it over.</p>' : ''}
        <p class="give-err" id="give-err" hidden></p>
      </div>
      <div class="modal-btns">
        <button type="button" class="btn char-btn" data-give="no">Cancel</button>
        <button type="button" class="btn char-btn primary" data-give="yes" ${people.length ? '' : 'disabled'}>Give</button>
      </div>
    </div>`;

  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const showErr = msg => { const el = wrap.querySelector('#give-err'); el.textContent = msg; el.hidden = false; };

  async function submit(btn) {
    const to = wrap.querySelector('#give-to')?.value;
    if (!to) return;
    const body = { to };
    if (item) {
      body.itemId = item.id;
    } else {
      const coins = {};
      let any = false;
      for (const inp of wrap.querySelectorAll('[data-coin]')) {
        const n = inp.value === '' ? 0 : Number(inp.value);
        if (!Number.isInteger(n) || n < 0) return showErr('Coins must be whole numbers.');
        if (n > (parseInt(inp.max) || 0)) return showErr(`You only have ${parseInt(inp.max) || 0} ${inp.dataset.coin.toUpperCase()}.`);
        coins[inp.dataset.coin] = n;
        if (n) any = true;
      }
      if (!any) return showErr('Choose how many coins to give.');
      body.coins = coins;
    }
    btn.disabled = true;
    try {
      const r = await fetch(`/api/characters/${encodeURIComponent(fromId)}/give`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { btn.disabled = false; return showErr(res.error || 'Could not give it.'); }
      close();
      if (typeof onDone === 'function') onDone(res);
    } catch {
      btn.disabled = false;
      showErr('Connection error.');
    }
  }

  wrap.addEventListener('click', e => {
    if (e.target === wrap) return close();
    const b = e.target.closest('[data-give]');
    if (!b) return;
    if (b.dataset.give === 'yes') submit(b); else close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  (wrap.querySelector('[data-coin]:not([disabled])') || wrap.querySelector('#give-to') || wrap.querySelector('[data-give="no"]')).focus();
}
