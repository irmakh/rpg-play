// Written by Irmak Hakman — 2026-10-11 17:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── The calendar's event list ─────────────────────────────────────────────────
// One list for both calendars: the DM's (events.html) and the players' (the
// Calendar tab of index.html). It shows events grouped under their day, one
// line each until opened, and can be narrowed by a search box, by kind, by who
// may see them, by author, and by how much of the calendar it covers (the
// selected day, the month on show, everything from today on, or all of it).
//
// Needs fr_calendar.js (dates) and the page's own esc() / escJs().
//
// The helpers down to the "The list on a page" marker are pure — they take
// events and dates and return values — and tests/unit/calendar-list.test.js
// runs that slice on its own.

const CAL_SCOPES = [
  { key: 'day',      label: 'Day' },
  { key: 'month',    label: 'Month' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all',      label: 'All' },
];

function calEventDate(e) {
  return { frYear: e.frYear, frMonth: e.frMonth ?? null, frDay: e.frDay ?? null, frFestival: e.frFestival || '' };
}

// A date's place in its year, counting festival days in their real position.
function calDayOfYear(d) {
  let n = 0;
  for (const p of frYearPages(d.frYear)) {
    if (p.type === 'month') {
      if (!d.frFestival && p.month === d.frMonth) return n + (d.frDay || 1);
      n += 30;
    } else {
      if (d.frFestival === p.festival) return n + 1;
      n += 1;
    }
  }
  return n;
}

// One number per day that sorts the way the calendar runs.
function calOrdinal(d) { return d.frYear * 1000 + calDayOfYear(d); }

function calDateKey(d) {
  return d.frFestival ? `${d.frYear}-F-${d.frFestival}` : `${d.frYear}-${d.frMonth}-${d.frDay}`;
}

// A player's journal is its own kind, whatever type it was saved with.
function calKind(e) { return e.authorCharId ? 'journal' : (e.eventType || 'event'); }

// Who may read it: a DM event is 'public' or 'dm'; a journal 'shared' or 'private'.
function calVisibility(e) {
  if (e.authorCharId) return e.isPublic ? 'shared' : 'private';
  return e.isPublic ? 'public' : 'dm';
}

function calInView(d, view) {
  if (!view || d.frYear !== view.year) return false;
  if (view.type === 'festival') return d.frFestival === view.festival;
  return !d.frFestival && d.frMonth === view.month;
}

/**
 * The events a list should show.
 * f: { scope, view, selected, today, q, kind, vis, author }
 *   scope 'day' uses `selected`, or `today` when no day is selected.
 *   author is a character id, or 'dm' for events that are not journals.
 */
function calFilterEvents(events, f) {
  const q = String(f.q || '').trim().toLowerCase();
  const day = f.selected || f.today;
  const from = f.today ? calOrdinal(f.today) : 0;
  return (events || []).filter(e => {
    const d = calEventDate(e);
    if (f.scope === 'day' && !(day && frDatesEqual(d, day))) return false;
    if (f.scope === 'month' && !calInView(d, f.view)) return false;
    if (f.scope === 'upcoming' && calOrdinal(d) < from) return false;
    if (f.kind && calKind(e) !== f.kind) return false;
    if (f.vis && calVisibility(e) !== f.vis) return false;
    if (f.author && (e.authorCharId || 'dm') !== f.author) return false;
    if (q) {
      const hay = `${e.title || ''}\n${e.description || ''}\n${e.authorName || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Events gathered under their day, days in calendar order.
function calGroupByDay(events) {
  const groups = new Map();
  for (const e of events || []) {
    const d = calEventDate(e);
    const key = calDateKey(d);
    if (!groups.has(key)) groups.set(key, { key, date: d, ordinal: calOrdinal(d), events: [] });
    groups.get(key).events.push(e);
  }
  return [...groups.values()].sort((a, b) => a.ordinal - b.ordinal);
}

// What the kind and author pickers can offer: only what the events contain.
function calKindsIn(events) {
  return [...new Set((events || []).map(calKind))].sort();
}
function calAuthorsIn(events) {
  const seen = new Map();
  for (const e of events || []) {
    if (e.authorCharId && !seen.has(e.authorCharId)) seen.set(e.authorCharId, e.authorName || 'Journal');
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function calScopeHeading(f) {
  if (f.scope === 'day') {
    const d = f.selected || f.today;
    return d ? `Events on ${frFormatDate(d)}` : 'Events';
  }
  if (f.scope === 'upcoming') return f.today ? `Events from ${frFormatDate(f.today)} on` : 'Upcoming events';
  if (f.scope === 'all') return 'All events';
  if (f.view && f.view.type === 'festival') return `Events on ${frFestivalName(f.view.festival)}, ${f.view.year} DR`;
  return f.view ? `Events in ${frMonthName(f.view.month)} ${f.view.year} DR` : 'Events';
}

function calHasFilters(s) { return !!(s.q || s.kind || s.vis || s.author); }

const CAL_VIS_LABEL = { public: 'Public', dm: 'DM Only', shared: 'Shared', private: 'Private' };

// One event as a closed line that opens to its text, attachments and buttons.
function calRowHTML(e, o) {
  const vis = calVisibility(e);
  const media = Array.isArray(e.media) ? e.media.length : 0;
  // Players never see DM-only events, so "Public" on every row would be noise.
  const badge = (o.dm || vis === 'private')
    ? `<span class="cal-event-badge ${e.isPublic ? 'pub' : 'priv'}">${CAL_VIS_LABEL[vis]}</span>` : '';
  const author = e.authorCharId ? `<span class="cal-row-author">${esc(e.authorName || 'Journal')}</span>` : '';
  const body = (e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : '')
    + (media && o.mediaHTML ? o.mediaHTML(e.media) : '')
    + (o.actionsHTML ? o.actionsHTML(e) : '');
  return `<details class="cal-row"${o.open && o.open[e.id] ? ' open' : ''} ontoggle="calListToggled('${escJs(o.name)}','${escJs(e.id)}',this.open)">`
    + `<summary><span class="cal-row-title">${esc(e.title)}</span>`
    + `<span class="cal-row-kind">${esc(calKind(e))}</span>${author}`
    + (media ? `<span class="cal-row-media" title="${media} attachment${media === 1 ? '' : 's'}">📎 ${media}</span>` : '')
    + badge + `</summary>`
    + `<div class="cal-row-body">${body || '<div class="cal-empty">No details.</div>'}</div></details>`;
}

function calGroupsHTML(groups, o) {
  return groups.map(g => {
    const today = o.today && frDatesEqual(g.date, o.today);
    const d = g.date;
    const pick = `calListPickDay('${escJs(o.name)}',${d.frYear},${d.frMonth ?? 'null'},${d.frDay ?? 'null'},'${escJs(d.frFestival || '')}')`;
    return `<section class="cal-day-group${today ? ' is-today' : ''}">`
      + `<div class="cal-day-hdr" onclick="${pick}" title="Show this day">`
      + `<span class="cal-day-hdr-date">${esc(frFormatDate(d))}</span>`
      + (today ? '<span class="cal-day-hdr-today">Today</span>' : '')
      + (o.weatherHTML ? o.weatherHTML(g.key) : '')
      + `<span class="cal-day-hdr-count">${g.events.length}</span></div>`
      + g.events.map(e => calRowHTML(e, o)).join('')
      + `</section>`;
  }).join('');
}

// ── The list on a page ────────────────────────────────────────────────────────
// calListCreate(name, cfg) wires one list to a page. cfg:
//   toolsEl, listEl, titleEl   element ids
//   events() view() selected() today()   the page's current data
//   dm                         true on the DM's page (visibility filter + badges)
//   actionsHTML(e)             the Edit / Delete buttons, or ''
//   mediaHTML(media)           the attachments row
//   weatherHTML(dateKey)       a weather mark for a day header, or ''
//   onPickDay(date)            a day header was clicked
//   onScope(scope)             the scope switch was used
const _calLists = {};

function calListCreate(name, cfg) {
  const list = {
    name, cfg,
    state: { scope: 'month', q: '', kind: '', vis: '', author: '', open: {} },
    built: false,
  };
  list.filter = () => ({
    scope: list.state.scope, view: cfg.view(), selected: cfg.selected(), today: cfg.today(),
    q: list.state.q, kind: list.state.kind, vis: list.state.vis, author: list.state.author,
  });
  list.setScope = (scope) => { list.state.scope = scope; list.render(); };
  list.render = () => _calListRender(list);
  _calLists[name] = list;
  return list;
}

function _calListBuildTools(list) {
  const el = document.getElementById(list.cfg.toolsEl);
  if (!el) return;
  const n = escJs(list.name);
  el.innerHTML =
    `<input type="search" class="cal-tool-search" placeholder="Search events…" aria-label="Search events" `
    + `oninput="calListSet('${n}','q',this.value)">`
    + `<div class="cal-tool-scope" role="group" aria-label="How much to show">`
    + CAL_SCOPES.map(s => `<button type="button" data-scope="${s.key}" onclick="calListScope('${n}','${s.key}')">${s.label}</button>`).join('')
    + `</div>`
    + `<select data-pick="kind" aria-label="Kind" onchange="calListSet('${n}','kind',this.value)"></select>`
    + (list.cfg.dm ? `<select data-pick="vis" aria-label="Who can see it" onchange="calListSet('${n}','vis',this.value)"></select>` : '')
    + `<select data-pick="author" aria-label="Author" onchange="calListSet('${n}','author',this.value)"></select>`;
  list.built = true;
}

// The pickers are refilled on every render (events come and go) but the search
// box is left alone, so typing in it never loses the cursor.
function _calListFillPick(el, key, first, options, value) {
  const sel = el.querySelector(`select[data-pick="${key}"]`);
  if (!sel) return;
  sel.innerHTML = `<option value="">${first}</option>`
    + options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  sel.value = options.some(o => o.value === value) ? value : '';
  sel.style.display = options.length > 1 || value ? '' : 'none';
}

function _calListRender(list) {
  const { cfg, state } = list;
  if (!list.built) _calListBuildTools(list);
  const events = cfg.events() || [];
  const tools = document.getElementById(cfg.toolsEl);
  if (tools) {
    tools.querySelectorAll('.cal-tool-scope button').forEach(b => b.classList.toggle('on', b.dataset.scope === state.scope));
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    _calListFillPick(tools, 'kind', 'All kinds', calKindsIn(events).map(k => ({ value: k, label: cap(k) })), state.kind);
    _calListFillPick(tools, 'vis', 'Any visibility',
      [...new Set(events.map(calVisibility))].map(v => ({ value: v, label: CAL_VIS_LABEL[v] })), state.vis);
    const authors = calAuthorsIn(events).map(a => ({ value: a.id, label: a.name }));
    _calListFillPick(tools, 'author', 'Anyone', authors.length ? [{ value: 'dm', label: 'DM' }, ...authors] : [], state.author);
  }

  const f = list.filter();
  const shown = calFilterEvents(events, f);
  const titleEl = document.getElementById(cfg.titleEl);
  if (titleEl) {
    titleEl.textContent = calScopeHeading(f) + (shown.length ? ` · ${shown.length}` : '');
  }
  const el = document.getElementById(cfg.listEl);
  if (!el) return;
  if (!shown.length) {
    el.innerHTML = `<div class="cal-empty">${calHasFilters(state)
      ? `Nothing matches. <a href="#" onclick="calListClear('${escJs(list.name)}');return false">Clear search and filters</a>`
      : 'No events recorded for this period.'}</div>`;
    return;
  }
  el.innerHTML = calGroupsHTML(calGroupByDay(shown), {
    name: list.name, dm: !!cfg.dm, today: cfg.today(), open: state.open,
    actionsHTML: cfg.actionsHTML, mediaHTML: cfg.mediaHTML, weatherHTML: cfg.weatherHTML,
  });
}

// Inline-handler entry points.
function calListSet(name, key, value) {
  const list = _calLists[name];
  if (!list) return;
  list.state[key] = value;
  list.render();
}
function calListScope(name, scope) {
  const list = _calLists[name];
  if (!list) return;
  list.state.scope = scope;
  if (list.cfg.onScope) list.cfg.onScope(scope);
  list.render();
}
function calListClear(name) {
  const list = _calLists[name];
  if (!list) return;
  Object.assign(list.state, { q: '', kind: '', vis: '', author: '' });
  const box = document.querySelector(`#${list.cfg.toolsEl} .cal-tool-search`);
  if (box) box.value = '';
  list.render();
}
// Remember which rows are open, so a refresh from the server does not shut them.
function calListToggled(name, id, open) {
  const list = _calLists[name];
  if (!list) return;
  if (open) list.state.open[id] = true; else delete list.state.open[id];
}
function calListPickDay(name, year, month, day, festival) {
  const list = _calLists[name];
  if (!list || !list.cfg.onPickDay) return;
  list.cfg.onPickDay({ frYear: year, frMonth: month, frDay: day, frFestival: festival || '' });
}
