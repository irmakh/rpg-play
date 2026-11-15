// Written by Irmak Hakman — 2026-11-15 14:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/local-content.js — a server's own setting content, read from a folder
 * kept out of the repository. The content here is invented.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadLocalContent, localContentScript, calendarText } from '../../lib/local-content.js';

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-local-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
const quiet = () => {};
const months = Array.from({ length: 12 }, (_, i) => ({ name: `Moon ${i + 1}`, epithet: i ? '' : 'The First' }));

describe('loadLocalContent', () => {
  it('without a folder there is nothing, and that is not an error', () => {
    const logs = [];
    expect(loadLocalContent('', { log: l => logs.push(l) })).toMatchObject({ calendar: null, summons: null, classes: null });
    expect(loadLocalContent('/no/such/dir', { log: l => logs.push(l) }).calendar).toBeNull();
    expect(logs.join('\n')).toMatch(/not found/);
  });
  it('reads each file it knows, and skips one it cannot parse', () => {
    const logs = [];
    const dir = folder({
      'calendar.json': { eraSuffix: 'AR', weekName: 'Span', months, yearNames: { 700: 'Year of the Bell', bad: 'x' } },
      'summons.json': '{ not json',
      'classes.json': { Tinker: { saves: ['con', 'int', 'luck'], hitDie: 'd8', spellAbility: 'Intelligence' }, _about: 'x' },
    });
    const lc = loadLocalContent(dir, { log: l => logs.push(l) });
    expect(lc.calendar).toMatchObject({ eraSuffix: 'AR', weekName: 'Span', yearNames: { 700: 'Year of the Bell' } });
    expect(lc.calendar.months[0]).toEqual({ num: 1, name: 'Moon 1', epithet: 'The First' });
    expect(lc.summons).toBeNull();
    expect(lc.classes).toEqual({ Tinker: { saves: ['con', 'int'], hitDie: 'd8', spellAbility: 'Intelligence' } });
    expect(logs.join('\n')).toMatch(/summons\.json skipped/);
  });
  it('drops a month list that is not twelve long, and odd values', () => {
    const lc = loadLocalContent(folder({ 'calendar.json': { months: [{ name: 'Only' }], eraSuffix: 42, defaultYear: -3 } }), { log: quiet });
    expect(lc.calendar.months).toBeUndefined();
    expect(lc.calendar.eraSuffix).toBe('');
    expect(lc.calendar.defaultYear).toBeUndefined();
  });
});

describe('localContentScript', () => {
  it('is empty when there is nothing for the pages', () => {
    expect(localContentScript(null)).toBe('');
    expect(localContentScript({ calendar: null, classes: null, summons: { spells: {} } })).toBe('');
  });
  it('can never close its own script element', () => {
    const s = localContentScript({ calendar: { eraSuffix: '</script><script>alert(1)' }, classes: null });
    expect(s.startsWith('<script>window.RPG_LOCAL=')).toBe(true);
    expect(s.match(/<\/script>/g)).toHaveLength(1);
    expect(s).toContain('\u003c/script>');
  });
});

describe('calendarText', () => {
  it('writes years and festivals the campaign way, or plainly', () => {
    const own = calendarText({ calendar: { eraSuffix: 'AR', festivals: [{ key: 'greengrass', name: 'Bloomtide' }] } });
    expect(own.year(700)).toBe('700 AR');
    expect(own.festival('greengrass')).toBe('Bloomtide');
    expect(own.festival('midsummer')).toBe('Midsummer');
    const plain = calendarText(null);
    expect(plain.year(700)).toBe('700');
    expect(plain.festival('greengrass')).toBe('Spring Festival');
  });
});
