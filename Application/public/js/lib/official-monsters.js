// Written by Irmak Hakman — 2026-11-11 18:21
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Official monsters in the DM's monster pickers (table Add Token, Prepare Map).
 * There can be thousands, so a picker never loads them all: it
 * searches the server as the DM types (GET /api/monsters/official) and loads
 * the one picked in full (GET /api/monsters/:id), which then behaves like any
 * of the DM's own monsters. Read-only: copy one on the Monsters page to edit it.
 *
 *   OfficialMonsters.searchInto(query, headers, render, pickFn, { hint })
 *       render(html) is called with a list section (rows call pickFn(id, el)),
 *       or with the hint while the query is too short.
 *   await OfficialMonsters.get(id, headers) -> { id, name, cr, data, official } | null
 */
const OfficialMonsters = (() => {
  const MIN_CHARS = 2;
  const LIMIT = 30;
  const full = new Map();
  let timer = null, seq = 0;

  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const j = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const note = t => `<div class="om-note">${h(t)}</div>`;

  async function search(q, headers, limit = LIMIT) {
    const r = await fetch(`/api/monsters/official?q=${encodeURIComponent(q)}&limit=${limit}`, { headers: headers || {} });
    if (!r.ok) return { rows: [], total: 0 };
    return r.json();
  }

  function sectionHTML(res, pickFn) {
    const rows = res.rows || [];
    if (!rows.length) return '';
    const more = res.total > rows.length ? `<div class="om-note">${res.total - rows.length} more — type more of the name.</div>` : '';
    return `<div class="om-hdr">Official monsters</div>`
      + rows.map(m => `<div class="qroll-row om-row" role="button" tabindex="0" data-mid="${h(m.id)}"
          onclick="${pickFn}('${j(m.id)}', this)" onkeydown="if(event.key==='Enter'){event.preventDefault();${pickFn}('${j(m.id)}', this)}">
          <span class="om-name">${h(m.name)}</span>
          <span class="om-src" title="Book">${h(m.source)}</span>
          <span class="om-cr">CR ${h(m.cr || '?')}</span>
        </div>`).join('') + more;
  }

  /** Debounced search; render(html) gets '' for a short query or no hits. */
  function searchInto(q, headers, render, pickFn, opts) {
    clearTimeout(timer);
    const query = String(q || '').trim();
    const mine = ++seq;
    if (query.length < MIN_CHARS) { render(note((opts && opts.hint) || 'Type 2 or more letters to search the official monsters too.')); return; }
    timer = setTimeout(async () => {
      try {
        const res = await search(query, typeof headers === 'function' ? headers() : headers);
        if (mine === seq) render(sectionHTML(res, pickFn));
      } catch { if (mine === seq) render(''); }
    }, 250);
  }

  async function get(id, headers) {
    if (full.has(id)) return full.get(id);
    try {
      const r = await fetch(`/api/monsters/${encodeURIComponent(id)}`, { headers: (typeof headers === 'function' ? headers() : headers) || {} });
      if (!r.ok) return null;
      const m = await r.json();
      full.set(id, m);
      return m;
    } catch { return null; }
  }

  return { search, searchInto, sectionHTML, get, MIN_CHARS };
})();
