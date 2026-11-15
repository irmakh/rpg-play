// Written by Irmak Hakman — 2026-11-15 14:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

'use strict';

/*
 * The campaign calendar: 12 months of 30 days, three 10-day weeks each, with
 * festival days between some months and one extra festival in leap years.
 *
 * The names are the campaign's own. The built-in ones below are generic; a
 * server with a local-content folder (lib/local-content.js) puts that
 * campaign's calendar into every page as window.RPG_LOCAL.calendar, and it
 * replaces them here. Festival KEYS never change — saved dates refer to them —
 * only the names shown for them do.
 */
const _CAL = (typeof window !== 'undefined' && window.RPG_LOCAL && window.RPG_LOCAL.calendar) || null;

const _CAL_DEFAULT_MONTHS = Array.from({ length: 12 }, (_, i) => ({ num: i + 1, name: `Month ${i + 1}`, epithet: '' }));

// afterMonth = falls after the last day of that month; every4Years = leap years only.
const _CAL_DEFAULT_FESTIVALS = [
  { key: 'midwinter',      name: 'Midwinter',        afterMonth: 1,  every4Years: false },
  { key: 'greengrass',     name: 'Spring Festival',  afterMonth: 4,  every4Years: false },
  { key: 'midsummer',      name: 'Midsummer',        afterMonth: 7,  every4Years: false },
  { key: 'shieldmeet',     name: 'Leap Day',         afterMonth: 7,  every4Years: true  },
  { key: 'highharvestide', name: 'Harvest Festival', afterMonth: 9,  every4Years: false },
  { key: 'feast_of_moon',  name: 'Moon Festival',    afterMonth: 11, every4Years: false },
];

function _calMonths(list) {
  if (!Array.isArray(list) || list.length !== 12) return null;
  const out = list.map((m, i) => ({ num: i + 1, name: String((m && m.name) || `Month ${i + 1}`), epithet: String((m && m.epithet) || '') }));
  return out;
}
function _calFestivals(list) {
  if (!Array.isArray(list)) return null;
  const known = new Set(_CAL_DEFAULT_FESTIVALS.map(f => f.key));
  const out = list.filter(f => f && known.has(f.key)).map(f => ({
    key: f.key,
    name: String(f.name || f.key),
    afterMonth: Math.min(12, Math.max(1, parseInt(f.afterMonth) || 1)),
    every4Years: !!(f.leapYearsOnly ?? f.every4Years),
  }));
  return out.length ? out : null;
}

const FR_MONTHS    = (_CAL && _calMonths(_CAL.months)) || _CAL_DEFAULT_MONTHS;
const FR_FESTIVALS = (_CAL && _calFestivals(_CAL.festivals)) || _CAL_DEFAULT_FESTIVALS;
// Names for particular years ("Year of …"), shown beside the number.
const FR_YEAR_NAMES = (_CAL && _CAL.yearNames && typeof _CAL.yearNames === 'object') ? _CAL.yearNames : {};
// What follows a year number ("1492 DR"); none by default.
const CAL_ERA = (_CAL && typeof _CAL.eraSuffix === 'string') ? _CAL.eraSuffix.trim().slice(0, 12) : '';
// What a 10-day week is called.
const CAL_WEEK = (_CAL && typeof _CAL.weekName === 'string' && _CAL.weekName.trim()) ? _CAL.weekName.trim().slice(0, 20) : 'Week';
// The year a fresh campaign starts in.
const CAL_DEFAULT_YEAR = (_CAL && parseInt(_CAL.defaultYear) > 0) ? parseInt(_CAL.defaultYear) : 1492;
const _CAL_LEAP = (_CAL && parseInt(_CAL.leapEveryYears) > 0) ? parseInt(_CAL.leapEveryYears) : 4;

function frIsLeapYear(y) { return y % _CAL_LEAP === 0; }

/** "1492" or "1492 DR", as the campaign writes its years. */
function frYearLabel(y) { return CAL_ERA ? `${y} ${CAL_ERA}` : String(y); }

function frYearName(y) {
  const n = FR_YEAR_NAMES[y];
  return n ? `${frYearLabel(y)} — ${n}` : frYearLabel(y);
}

/** "Mirtul — The Melting", or just the name when the month has no epithet. */
function frMonthTitle(num) {
  const m = FR_MONTHS.find(x => x.num === num);
  if (!m) return '?';
  return m.epithet ? `${m.name} — ${m.epithet}` : m.name;
}

/** "1st. Week" … for the three rows of a month grid. */
function frWeekLabels() {
  return ['1st', '2nd', '3rd'].map(o => `${o}. ${CAL_WEEK}`);
}

/**
 * Fill the calendar's dropdowns and labels in a page from the names above:
 * <select data-cal="months">, <select data-cal="festivals"> and
 * <span data-cal="era"> (which shows " (DR)" when the campaign has an era).
 */
function frFillCalendarControls(root) {
  const r = root || document;
  r.querySelectorAll('select[data-cal="months"]').forEach(sel => {
    const v = sel.value;
    sel.innerHTML = FR_MONTHS.map(m => `<option value="${m.num}">${esc(m.name)}</option>`).join('');
    if (v) sel.value = v;
  });
  r.querySelectorAll('select[data-cal="festivals"]').forEach(sel => {
    const v = sel.value;
    sel.innerHTML = FR_FESTIVALS.map(f => `<option value="${f.key}">${esc(f.name)}${f.every4Years ? ' (leap years)' : ''}</option>`).join('');
    if (v) sel.value = v;
  });
  r.querySelectorAll('[data-cal="era"]').forEach(el => { el.textContent = CAL_ERA ? ` (${CAL_ERA})` : ''; });
  r.querySelectorAll('input[data-cal="year"]').forEach(inp => { if (!inp.dataset.calSet) { inp.value = CAL_DEFAULT_YEAR; inp.dataset.calSet = '1'; } });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => frFillCalendarControls());
}

function frMonthName(num) { return FR_MONTHS.find(m => m.num === num)?.name || '?'; }

function frFestivalName(key) { return FR_FESTIVALS.find(f => f.key === key)?.name || key; }

function frFormatDate(d) {
  if (!d) return '—';
  if (d.frFestival) return `${frFestivalName(d.frFestival)}, ${frYearLabel(d.frYear)}`;
  return `${d.frDay} ${frMonthName(d.frMonth)}, ${frYearLabel(d.frYear)}`;
}

function frDatesEqual(a, b) {
  if (!a || !b) return false;
  if (a.frYear !== b.frYear) return false;
  if (a.frFestival || b.frFestival) return (a.frFestival || '') === (b.frFestival || '') && !a.frMonth && !b.frMonth;
  return a.frMonth === b.frMonth && a.frDay === b.frDay;
}

function frFestivalsAfterMonth(monthNum, year) {
  return FR_FESTIVALS.filter(f => {
    if (f.afterMonth !== monthNum) return false;
    if (f.every4Years && !frIsLeapYear(year)) return false;
    return true;
  });
}

// Ordered sequence of pages (months + festivals interleaved) for a given year
function frYearPages(year) {
  const pages = [];
  for (const m of FR_MONTHS) {
    pages.push({ type: 'month', month: m.num });
    for (const f of frFestivalsAfterMonth(m.num, year)) {
      pages.push({ type: 'festival', festival: f.key });
    }
  }
  return pages;
}

// Navigate view one step in direction (+1 forward / -1 back)
function frNavigate(view, dir) {
  const pages = frYearPages(view.year);
  const idx = pages.findIndex(p =>
    p.type === view.type &&
    (p.type === 'month' ? p.month === view.month : p.festival === view.festival)
  );
  if (idx === -1) return { ...frYearPages(view.year)[0], year: view.year };
  const next = idx + dir;
  if (next < 0) {
    const py = frYearPages(view.year - 1);
    return { ...py[py.length - 1], year: view.year - 1 };
  }
  if (next >= pages.length) {
    return { ...frYearPages(view.year + 1)[0], year: view.year + 1 };
  }
  return { ...pages[next], year: view.year };
}

// Convert a date object to its corresponding calendar view page
function frDateToView(d) {
  if (!d || !d.frYear) return { type: 'month', month: 1, year: CAL_DEFAULT_YEAR };
  if (d.frFestival) return { type: 'festival', festival: d.frFestival, year: d.frYear };
  return { type: 'month', month: d.frMonth || 1, year: d.frYear };
}

// Advance one day forward in the FR calendar
function frNextDay(d) {
  const year = d.frYear;
  const pages = frYearPages(year);
  if (d.frFestival) {
    const pIdx = pages.findIndex(p => p.type === 'festival' && p.festival === d.frFestival);
    const next = pages[pIdx + 1];
    if (!next) return { frYear: year + 1, frMonth: 1, frDay: 1, frFestival: '' };
    if (next.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: next.festival };
    return { frYear: year, frMonth: next.month, frDay: 1, frFestival: '' };
  }
  if (d.frDay < 30) return { frYear: year, frMonth: d.frMonth, frDay: d.frDay + 1, frFestival: '' };
  const mIdx = pages.findIndex(p => p.type === 'month' && p.month === d.frMonth);
  const next = pages[mIdx + 1];
  if (!next) return { frYear: year + 1, frMonth: 1, frDay: 1, frFestival: '' };
  if (next.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: next.festival };
  return { frYear: year, frMonth: next.month, frDay: 1, frFestival: '' };
}

// Step one day backward in the FR calendar
function frPrevDay(d) {
  const year = d.frYear;
  const pages = frYearPages(year);
  if (d.frFestival) {
    const pIdx = pages.findIndex(p => p.type === 'festival' && p.festival === d.frFestival);
    if (pIdx <= 0) {
      const py = frYearPages(year - 1);
      const last = py[py.length - 1];
      if (last.type === 'festival') return { frYear: year - 1, frMonth: null, frDay: null, frFestival: last.festival };
      return { frYear: year - 1, frMonth: last.month, frDay: 30, frFestival: '' };
    }
    const prev = pages[pIdx - 1];
    if (prev.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: prev.festival };
    return { frYear: year, frMonth: prev.month, frDay: 30, frFestival: '' };
  }
  if (d.frDay > 1) return { frYear: year, frMonth: d.frMonth, frDay: d.frDay - 1, frFestival: '' };
  const mIdx = pages.findIndex(p => p.type === 'month' && p.month === d.frMonth);
  if (mIdx <= 0) {
    const py = frYearPages(year - 1);
    const last = py[py.length - 1];
    if (last.type === 'festival') return { frYear: year - 1, frMonth: null, frDay: null, frFestival: last.festival };
    return { frYear: year - 1, frMonth: last.month, frDay: 30, frFestival: '' };
  }
  const prev = pages[mIdx - 1];
  if (prev.type === 'festival') return { frYear: year, frMonth: null, frDay: null, frFestival: prev.festival };
  return { frYear: year, frMonth: prev.month, frDay: 30, frFestival: '' };
}
