// Written by Irmak Hakman — 2026-09-27 11:57
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── HTML escape ───────────────────────────────────────────────────────────────
// null / undefined / false become ''; everything else — 0 included, which the
// old `s||''` turned into an empty string — is shown as its text.
function esc(s) {
  return (s == null || s === false ? '' : String(s))
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Escape a value embedded in a single-quoted JS string inside an HTML attribute ──
// e.g.  onclick="fn('${escJs(value)}')"
// HTML-entity escaping alone is NOT enough here: the browser decodes entities
// (&#39; -> ') BEFORE the inline JS is parsed, so a bare quote would still break the
// string literal. We backslash-escape the JS metacharacters first, then HTML-escape
// the structural chars so the attribute itself stays well-formed.
function escJs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
