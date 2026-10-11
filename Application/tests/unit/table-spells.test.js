// Written by Irmak Hakman — 2026-10-11 21:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Unit tests for the Spells tab builders in js/table/table-utils.js:
 * spellShown / spellCounts (what the spellbook filter and search let through)
 * and spellSlotsHTML / spellbookHTML (the markup the right panel and its
 * pop-out show). Loaded as the real file, on top of the real esc.js.
 */
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(resolve(__dirname, '../../public', p), 'utf-8');

const ctx = createContext({ console, document: { getElementById: () => null }, setTimeout: () => 0, clearTimeout: () => {} });
runInContext(read('js/lib/esc.js'), ctx);
runInContext(read('js/table/table-utils.js'), ctx);
const { spellShown, spellCounts, spellSlotsHTML, spellbookHTML } = ctx;

// A sheet spell row: [level, name, time, range, conc, ritual, notes, prepared, ...]
const sp = (level, name, prepared, { conc = false, ritual = false } = {}) =>
  [String(level), name, 'Action', '60 ft', conc, ritual, '', prepared, 'Evocation'];
const BOOK = [
  sp(0, 'Fire Bolt', true),
  sp(1, 'Magic Missile', true),
  sp(1, 'Detect Magic', false, { conc: true, ritual: true }),
  null,                                   // a hole in the list must not break anything
  sp(2, 'Misty Step', false),
  sp(2, 'Mirror Image', true),
];
const count = (html, re) => (html.match(re) || []).length;

describe('spellShown', () => {
  it('filters by prepared, not prepared and all', () => {
    const names = f => BOOK.filter(s => spellShown(s, f, '')).map(s => s[1]);
    expect(names('prepared')).toEqual(['Fire Bolt', 'Magic Missile', 'Mirror Image']);
    expect(names('unprepared')).toEqual(['Detect Magic', 'Misty Step']);
    expect(names('all')).toHaveLength(5);
  });
  it('searches the name, ignoring case and stray spaces, together with the filter', () => {
    expect(spellShown(BOOK[1], 'all', '  MISS ')).toBe(true);
    expect(spellShown(BOOK[1], 'all', 'step')).toBe(false);
    expect(spellShown(BOOK[4], 'prepared', 'step')).toBe(false);   // matches, but is not prepared
    expect(spellShown(BOOK[4], 'unprepared', 'step')).toBe(true);
  });
  it('never shows an empty row', () => {
    expect(spellShown(null, 'all', '')).toBe(false);
  });
});

describe('spellCounts', () => {
  it('counts each filter', () => {
    expect(spellCounts(BOOK)).toEqual({ prepared: 3, unprepared: 2, all: 5 });
    expect(spellCounts([])).toEqual({ prepared: 0, unprepared: 0, all: 0 });
  });
});

describe('spellSlotsHTML', () => {
  const slots = [{ level: 1, total: 4, used: 1 }, { level: 2, total: 2, used: 2 }];
  it('is empty when there are no slots', () => {
    expect(spellSlotsHTML([], true)).toBe('');
  });
  it('draws every slot and says how many are left in words', () => {
    const html = spellSlotsHTML(slots, true);
    expect(count(html, /class="rp-slot-pip(?: used)?"/g)).toBe(6);
    expect(count(html, /class="rp-slot-pip used"/g)).toBe(3);
    expect(html).toContain('<b>3</b> of 4 left');
    expect(html).toContain('<b>0</b> of 2 left');
  });
  it('marks a level with nothing left', () => {
    const html = spellSlotsHTML(slots, true);
    expect(count(html, /rp-slot-row spent/g)).toBe(1);
  });
  it('keeps the click order the panel relies on: open slots first, then spent', () => {
    const html = spellSlotsHTML([{ level: 3, total: 3, used: 1 }], true);
    const pips = html.match(/<span class="rp-slot-pip(?: used)?"[^>]*>/g);
    expect(pips.map(p => /used/.test(p.match(/class="[^"]*"/)[0]))).toEqual([false, false, true]);
    expect(pips[2]).toContain('clickSpellSlotPip(3,2)');
  });
  it('gives a viewer who may not edit no click handlers', () => {
    const html = spellSlotsHTML(slots, false);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('click a slot');
  });
  it('never shows more spent than the level holds', () => {
    const html = spellSlotsHTML([{ level: 1, total: 2, used: 9 }], true);
    expect(html).toContain('<b>0</b> of 2 left');
    expect(count(html, /class="rp-slot-pip used"/g)).toBe(2);
  });
});

describe('spellbookHTML', () => {
  const shownRows = html => count(html, /<div class="rp-sb-row[^"]*" data-idx="\d+">/g);
  it('is empty for a character with no spells', () => {
    expect(spellbookHTML([], { filter: 'all' })).toBe('');
    expect(spellbookHTML([null], { filter: 'all' })).toBe('');
  });
  it('holds every spell and hides what the filter leaves out', () => {
    const html = spellbookHTML(BOOK, { filter: 'prepared', query: '', spAtk: '+5' });
    expect(count(html, /class="rp-sb-row/g)).toBe(5);
    expect(shownRows(html)).toBe(3);
    expect(spellbookHTML(BOOK, { filter: 'all' }).includes('style="display:none"')).toBe(true);   // only the "no match" line
    expect(shownRows(spellbookHTML(BOOK, { filter: 'all' }))).toBe(5);
    expect(shownRows(spellbookHTML(BOOK, { filter: 'unprepared' }))).toBe(2);
  });
  it('groups by level in order, cantrips first, and counts what is on show', () => {
    const html = spellbookHTML(BOOK, { filter: 'all' });
    const heads = html.match(/<div class="rp-sb-lvl">[^<]+/g).map(h => h.replace(/<[^>]+>/, '').trim());
    expect(heads).toEqual(['Cantrips', 'Level 1', 'Level 2']);
    expect(html).toContain('Level 1 <span class="rp-sb-n">2</span>');
    const prepared = spellbookHTML(BOOK, { filter: 'prepared' });
    expect(prepared).toContain('Level 1 <span class="rp-sb-n">1</span>');
  });
  it('hides a level with nothing to show, and says so when nothing matches at all', () => {
    const html = spellbookHTML(BOOK, { filter: 'unprepared' });
    expect(html).toMatch(/<div class="rp-sb-group" style="display:none"><div class="rp-sb-lvl">Cantrips/);
    expect(html).toContain('<div class="rp-tab-empty rp-sb-none" style="display:none">');
    const none = spellbookHTML(BOOK, { filter: 'all', query: 'zzz' });
    expect(shownRows(none)).toBe(0);
    expect(none).toContain('<div class="rp-tab-empty rp-sb-none">No spells match.');
  });
  it('points each row at its place in the full list, so chat gets the right spell', () => {
    const html = spellbookHTML(BOOK, { filter: 'all' });
    expect(html).toContain('data-idx="4"');
    expect(html).toContain('postSpellInfoFromAll(4)" title="Send to chat">Misty Step');
    expect(html).not.toContain('data-idx="3"');
  });
  it('marks unprepared spells, concentration and rituals', () => {
    const html = spellbookHTML(BOOK, { filter: 'all' });
    expect(count(html, /rp-sb-row unprep/g)).toBe(2);
    expect(count(html, /rp-sb-flag conc/g)).toBe(1);
    expect(count(html, /rp-sb-flag rit/g)).toBe(1);
  });
  it('shows the filter in use, with counts, and keeps the search text', () => {
    const html = spellbookHTML(BOOK, { filter: 'unprepared', query: 'st"ep' });
    expect(html).toMatch(/class="rp-sb-f on" data-f="unprepared"[^>]*>Not prepared <span class="rp-sb-fc">2</);
    expect(html).toMatch(/data-f="prepared"[^>]*>Prepared <span class="rp-sb-fc">3</);
    expect(html).toContain('value="st&quot;ep"');
  });
  it('offers a spell attack only when the character has one', () => {
    expect(spellbookHTML(BOOK, { filter: 'all', spAtk: '+5' })).toContain('rp-sb-atk');
    expect(spellbookHTML(BOOK, { filter: 'all', spAtk: null })).not.toContain('rp-sb-atk');
  });
  it('escapes names and levels typed on the sheet', () => {
    const html = spellbookHTML([['<b>9</b>', '<img src=x onerror=alert(1)>', '', '', false, false, '', true]], { filter: 'all', spAtk: '+1' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>9</b>');
  });
});
