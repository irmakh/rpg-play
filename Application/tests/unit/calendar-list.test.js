// Written by Irmak Hakman — 2026-10-11 18:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for the pure half of js/lib/calendar-list.js — what both
 * calendars use to decide which events to show and in what order.
 *
 * The file's second half touches the page, so only the slice above the
 * "The list on a page" marker is run here, on top of the real fr_calendar.js.
 * If the marker is renamed the slice is the whole file and loading still
 * works, but the guard below fails loudly.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public', p), 'utf-8');

const SRC = read('js/lib/calendar-list.js');
const MARK = '// ── The list on a page';
if (!SRC.includes(MARK)) throw new Error('calendar-list.js: "The list on a page" marker not found');

const ctx = createContext({ console });
runInContext(read('js/lib/esc.js'), ctx);
runInContext(read('js/lib/fr_calendar.js'), ctx);
runInContext(SRC.slice(0, SRC.indexOf(MARK))
  + '\n;globalThis.__c = { calOrdinal, calKind, calVisibility, calFilterEvents, calGroupByDay, calKindsIn, calAuthorsIn, calScopeHeading, calRowHTML, calGroupsHTML };', ctx);
const C = ctx.__c;

const ev = (id, over = {}) => ({
  id, title: 'Event ' + id, description: '', eventType: 'event', isPublic: true,
  frYear: 1492, frMonth: 5, frDay: 10, frFestival: '', authorCharId: '', authorName: '', media: [], ...over,
});
const today = { frYear: 1492, frMonth: 5, frDay: 10, frFestival: '' };
const view  = { type: 'month', month: 5, year: 1492 };

describe('calOrdinal', () => {
  it('runs in calendar order, festivals in their place', () => {
    const o = d => C.calOrdinal({ frYear: 1492, frFestival: '', ...d });
    expect(o({ frMonth: 1, frDay: 30 })).toBeLessThan(o({ frMonth: null, frDay: null, frFestival: 'midwinter' }));
    expect(o({ frMonth: null, frDay: null, frFestival: 'midwinter' })).toBeLessThan(o({ frMonth: 2, frDay: 1 }));
    expect(o({ frMonth: 12, frDay: 30 })).toBeLessThan(C.calOrdinal({ frYear: 1493, frMonth: 1, frDay: 1, frFestival: '' }));
  });
});

describe('kind and visibility', () => {
  it('treats anything a character wrote as a journal', () => {
    expect(C.calKind(ev('a', { eventType: 'combat' }))).toBe('combat');
    expect(C.calKind(ev('b', { eventType: 'combat', authorCharId: 'c1' }))).toBe('journal');
  });
  it('names the four audiences', () => {
    expect(C.calVisibility(ev('a'))).toBe('public');
    expect(C.calVisibility(ev('a', { isPublic: false }))).toBe('dm');
    expect(C.calVisibility(ev('a', { authorCharId: 'c1' }))).toBe('shared');
    expect(C.calVisibility(ev('a', { authorCharId: 'c1', isPublic: false }))).toBe('private');
  });
});

describe('calFilterEvents', () => {
  const events = [
    ev('past',   { frDay: 2 }),
    ev('today',  { title: 'Ambush at the ford', eventType: 'combat' }),
    ev('later',  { frDay: 20, isPublic: false }),
    ev('next',   { frMonth: 6, frDay: 1, description: 'The ford again' }),
    ev('fest',   { frMonth: null, frDay: null, frFestival: 'greengrass' }),
    ev('diary',  { frDay: 20, authorCharId: 'c1', authorName: 'Vesper' }),
    ev('old',    { frYear: 1491 }),
  ];
  const ids = f => Array.from(C.calFilterEvents(events, { view, today, ...f })).map(e => e.id).sort();

  it('month: only the month on show, never a festival or another year', () => {
    expect(ids({ scope: 'month' })).toEqual(['diary', 'later', 'past', 'today']);
  });
  it('day: the selected day, or today when none is selected', () => {
    expect(ids({ scope: 'day' })).toEqual(['today']);
    expect(ids({ scope: 'day', selected: { frYear: 1492, frMonth: 5, frDay: 20, frFestival: '' } })).toEqual(['diary', 'later']);
    expect(ids({ scope: 'day', selected: { frYear: 1492, frMonth: null, frDay: null, frFestival: 'greengrass' } })).toEqual(['fest']);
  });
  it('upcoming: today and everything after it', () => {
    expect(ids({ scope: 'upcoming' })).toEqual(['diary', 'later', 'next', 'today']);
  });
  it('all: everything', () => {
    expect(ids({ scope: 'all' })).toHaveLength(7);
  });
  it('searches titles, text and authors, ignoring case', () => {
    expect(ids({ scope: 'all', q: 'FORD' })).toEqual(['next', 'today']);
    expect(ids({ scope: 'all', q: 'vesper' })).toEqual(['diary']);
    expect(ids({ scope: 'all', q: '   ' })).toHaveLength(7);
  });
  it('narrows by kind, audience and author together', () => {
    expect(ids({ scope: 'all', kind: 'combat' })).toEqual(['today']);
    expect(ids({ scope: 'all', kind: 'journal' })).toEqual(['diary']);
    expect(ids({ scope: 'all', vis: 'dm' })).toEqual(['later']);
    expect(ids({ scope: 'all', author: 'c1' })).toEqual(['diary']);
    expect(ids({ scope: 'all', author: 'dm' })).not.toContain('diary');
    expect(ids({ scope: 'month', kind: 'journal', author: 'dm' })).toEqual([]);
  });
});

describe('calGroupByDay', () => {
  it('puts events under their day, days in order', () => {
    const groups = Array.from(C.calGroupByDay([
      ev('c', { frMonth: 6, frDay: 1 }), ev('a', { frDay: 3 }), ev('b', { frDay: 3 }),
      ev('f', { frMonth: null, frDay: null, frFestival: 'greengrass' }),
    ]));
    expect(groups.map(g => g.key)).toEqual(['1492-5-3', '1492-F-greengrass', '1492-6-1'].sort((x, y) =>
      groups.find(g => g.key === x).ordinal - groups.find(g => g.key === y).ordinal));
    expect(groups[0].key).toBe('1492-F-greengrass');   // Greengrass falls before Mirtul
    expect(groups.find(g => g.key === '1492-5-3').events.map(e => e.id)).toEqual(['a', 'b']);
  });
});

describe('pickers and headings', () => {
  it('offers only the kinds and authors that exist', () => {
    const events = [ev('a', { eventType: 'rest' }), ev('b', { authorCharId: 'c2', authorName: 'Oren' }), ev('c', { authorCharId: 'c2', authorName: 'Oren' })];
    expect(Array.from(C.calKindsIn(events))).toEqual(['journal', 'rest']);
    expect(Array.from(C.calAuthorsIn(events)).map(a => a.name)).toEqual(['Oren']);
  });
  it('says what is on show', () => {
    expect(C.calScopeHeading({ scope: 'month', view })).toBe('Events in Mirtul 1492 DR');
    expect(C.calScopeHeading({ scope: 'day', today })).toBe('Events on 10 Mirtul, 1492 DR');
    expect(C.calScopeHeading({ scope: 'all' })).toBe('All events');
  });
});

describe('rows', () => {
  const o = { name: 'dm', dm: true, today, open: {} };
  it('escapes what people typed', () => {
    const html = C.calRowHTML(ev('x', { title: '<img src=x onerror=alert(1)>', description: '<b>hi</b>', authorCharId: 'c1', authorName: '<i>N</i>' }), o);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>hi</b>');
    expect(html).not.toContain('<i>N</i>');
  });
  it('keeps a row open when it was open before', () => {
    expect(C.calRowHTML(ev('x'), { ...o, open: { x: true } })).toContain('<details class="cal-row" open');
    expect(C.calRowHTML(ev('x'), o)).not.toContain(' open ');
  });
  it('shows players no "Public" badge, but does mark a private journal', () => {
    const p = { ...o, dm: false };
    expect(C.calRowHTML(ev('x'), p)).not.toContain('cal-event-badge');
    expect(C.calRowHTML(ev('x', { authorCharId: 'c1', isPublic: false }), p)).toContain('Private');
    expect(C.calRowHTML(ev('x', { isPublic: false }), o)).toContain('DM Only');
  });
  it('marks today and counts the day', () => {
    const html = C.calGroupsHTML(Array.from(C.calGroupByDay([ev('a'), ev('b'), ev('c', { frDay: 11 })])), o);
    expect(html.match(/cal-day-hdr-today/g)).toHaveLength(1);
    expect(html).toContain('<span class="cal-day-hdr-count">2</span>');
  });
});
