// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
