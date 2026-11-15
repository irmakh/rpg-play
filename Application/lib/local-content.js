// Written by Irmak Hakman — 2026-11-15 14:30
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * A server's own setting content: the campaign calendar's names, summon spells
 * beyond the SRD, extra classes. It lives in a folder outside the public
 * repository (LOCAL_CONTENT_DIR, git-ignored as Application/local-content/),
 * so the code ships SRD-only defaults and a server that has the folder gets its
 * own content back.
 *
 *   calendar.json   month / festival / year names, week name, era suffix
 *   summons.json    { spells: { name: rule }, addCreatures: { spell: [names] } }
 *   classes.json    { ClassName: { saves, hitDie, spellAbility } }
 *
 * Read once at start-up; restart the server after editing a file. A missing
 * folder or file means the defaults; a file that cannot be read or parsed is
 * logged and skipped, never fatal.
 */
import fs from 'fs';
import path from 'path';

const FILES = ['calendar', 'summons', 'classes'];
const MAX_BYTES = 512 * 1024;

function readJson(file, log) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    if (st.size > MAX_BYTES) { log(`local-content: ${path.basename(file)} is too large, skipped`); return null; }
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    if (e.code !== 'ENOENT') log(`local-content: ${path.basename(file)} skipped (${e.message})`);
    return null;
  }
}

/** Keep only what each file is allowed to hold, so nothing odd reaches a page. */
function cleanCalendar(c) {
  if (!c) return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const out = {
    eraSuffix: str(c.eraSuffix, 12),
    weekName: str(c.weekName, 20),
    defaultYear: parseInt(c.defaultYear) > 0 ? parseInt(c.defaultYear) : undefined,
    leapEveryYears: parseInt(c.leapEveryYears) > 0 ? parseInt(c.leapEveryYears) : undefined,
  };
  if (Array.isArray(c.months) && c.months.length === 12) {
    out.months = c.months.map((m, i) => ({ num: i + 1, name: str(m && m.name, 40) || `Month ${i + 1}`, epithet: str(m && m.epithet, 60) }));
  }
  if (Array.isArray(c.festivals)) {
    out.festivals = c.festivals.filter(f => f && typeof f.key === 'string').slice(0, 20).map(f => ({
      key: f.key.slice(0, 40), name: str(f.name, 60) || f.key,
      afterMonth: parseInt(f.afterMonth) || 1, leapYearsOnly: !!(f.leapYearsOnly ?? f.every4Years),
    }));
  }
  if (c.yearNames && typeof c.yearNames === 'object') {
    out.yearNames = {};
    for (const [y, n] of Object.entries(c.yearNames).slice(0, 2000)) {
      if (/^-?\d{1,6}$/.test(y) && typeof n === 'string') out.yearNames[y] = n.slice(0, 80);
    }
  }
  return out;
}

function cleanClasses(c) {
  if (!c) return null;
  const out = {};
  const ABIL = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  for (const [name, v] of Object.entries(c)) {
    if (name.startsWith('_') || !v || typeof v !== 'object') continue;
    out[name.slice(0, 40)] = {
      saves: Array.isArray(v.saves) ? v.saves.filter(s => ABIL.has(s)).slice(0, 6) : [],
      hitDie: /^d(4|6|8|10|12|20)$/.test(v.hitDie) ? v.hitDie : '',
      spellAbility: typeof v.spellAbility === 'string' ? v.spellAbility.slice(0, 20) : '',
    };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Read the folder. Returns { dir, calendar, summons, classes } — each null when
 * absent — and never throws.
 */
export function loadLocalContent(dir, { log = console.log } = {}) {
  const empty = { dir: '', calendar: null, summons: null, classes: null };
  if (!dir) return empty;
  let st;
  try { st = fs.statSync(dir); } catch { log(`local-content: ${dir} not found, using the built-in defaults`); return empty; }
  if (!st.isDirectory()) { log(`local-content: ${dir} is not a folder, using the built-in defaults`); return empty; }
  const raw = Object.fromEntries(FILES.map(f => [f, readJson(path.join(dir, f + '.json'), log)]));
  const out = { dir, calendar: cleanCalendar(raw.calendar), summons: raw.summons, classes: cleanClasses(raw.classes) };
  const have = FILES.filter(f => out[f]);
  log(`local-content: ${have.length ? have.join(', ') : 'nothing'} loaded from ${dir}`);
  return out;
}

/**
 * The part of it the pages need, as an inline script for the <head>:
 * window.RPG_LOCAL = { calendar, classes }. Empty when there is nothing to send.
 * `<` is escaped so no value can close the script element.
 */
export function localContentScript(lc) {
  if (!lc || (!lc.calendar && !lc.classes)) return '';
  const data = { calendar: lc.calendar || null, classes: lc.classes || null };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>window.RPG_LOCAL=${json};</script>`;
}

/** "1492 DR" / "1492", and a festival's shown name — for server-made text. */
export function calendarText(lc) {
  const cal = (lc && lc.calendar) || {};
  const era = cal.eraSuffix || '';
  const year = y => (era ? `${y} ${era}` : String(y));
  const DEFAULT_FEST = { midwinter: 'Midwinter', greengrass: 'Spring Festival', midsummer: 'Midsummer',
    shieldmeet: 'Leap Day', highharvestide: 'Harvest Festival', feast_of_moon: 'Moon Festival' };
  const festival = key => ((cal.festivals || []).find(f => f.key === key) || {}).name || DEFAULT_FEST[key] || key;
  return { year, festival };
}
