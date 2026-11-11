// Written by Irmak Hakman — 2026-11-11 18:14
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The 5etools bestiary books, fetched for an import and then thrown away.
 *
 * Source: the 5etools data files in the public GitHub repository
 * 5etools-mirror-3/5etools-src, as for spells (lib/spell-source.js). Used by
 * the DM's "Import from books" on the Monsters page (server/routes/
 * official-monsters.js). Everything is held in memory for one import; nothing
 * is written to disk and nothing from that repository lands in this project.
 *
 * Adventure books mostly describe their monsters as a copy of another book's
 * ("Anastrasya Karelova" is the Monster Manual's Vampire Spawn with her name
 * in the text). Those `_copy` entries are resolved here — the other book is
 * fetched too when needed, used, and dropped — so every imported monster is a
 * whole stat block.
 */

export const MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
const TIMEOUT_MS = 60 * 1000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;      // the largest bestiary file is about 2 MB
const BOOK_FILE = /^bestiary-[a-z0-9-]+\.json$/;
const FIRST = ['XMM', 'MM', 'MPMM', 'VGM', 'MTF'];
const MAX_COPY_DEPTH = 5;

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()} (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`${url.split('/').pop()} is unexpectedly large`);
  try { return JSON.parse(text); } catch { throw new Error(`${url.split('/').pop()} is not valid JSON`); }
}

/** Book code -> readable name, from 5etools' own book and adventure lists. */
async function bookNames(fetchImpl) {
  const names = {};
  for (const [file, key] of [['books.json', 'book'], ['adventures.json', 'adventure']]) {
    try {
      const d = await getJson(`${MIRROR}/${file}`, fetchImpl);
      for (const b of (d && Array.isArray(d[key]) ? d[key] : [])) if (b && b.id && b.name) names[b.id] = String(b.name);
    } catch { /* names are a nicety: the code still shows */ }
  }
  return names;
}

/** The books on offer: [{ code, name, file }], core books first. */
export async function listBestiaryBooks(fetchImpl = fetch) {
  const [index, names] = await Promise.all([getJson(`${MIRROR}/bestiary/index.json`, fetchImpl), bookNames(fetchImpl)]);
  const books = [];
  for (const [code, file] of Object.entries(index || {})) {
    if (typeof file !== 'string' || !BOOK_FILE.test(file)) continue;
    books.push({ code, name: names[code] || code, file });
  }
  const rank = b => { const i = FIRST.indexOf(b.code); return i < 0 ? FIRST.length : i; };
  return books.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Every monster in the chosen books, whole: { monsters: [{ name, source, cr,
 * type, data }], books: [{ code, name, count }], unresolved: [names] }.
 * Unknown codes are refused rather than guessed at.
 */
export async function fetchBestiaryBooks(codes, fetchImpl = fetch) {
  const all = await listBestiaryBooks(fetchImpl);
  const want = Array.isArray(codes) && codes.length ? codes.map(String) : all.map(b => b.code);
  const chosen = [];
  for (const code of want) {
    const b = all.find(x => x.code === code);
    if (!b) throw new Error(`Unknown book: ${code}`);
    if (!chosen.includes(b)) chosen.push(b);
  }
  const loaded = new Map();   // code -> monster list
  const load = async b => {
    if (loaded.has(b.code)) return loaded.get(b.code);
    const d = await getJson(`${MIRROR}/bestiary/${b.file}`, fetchImpl);
    const list = d && Array.isArray(d.monster) ? d.monster.filter(m => m && typeof m === 'object' && m.name) : [];
    loaded.set(b.code, list);
    return list;
  };
  for (const b of chosen) await load(b);
  // The books the copies point at, fetched too (only to resolve them).
  for (let round = 0; round < MAX_COPY_DEPTH; round++) {
    const need = new Set();
    for (const list of loaded.values()) for (const m of list) {
      const src = m._copy && m._copy.source;
      if (src && !loaded.has(src)) need.add(src);
    }
    const books = [...need].map(c => all.find(b => b.code === c)).filter(Boolean);
    if (!books.length) break;
    for (const b of books) await load(b);
  }
  const byKey = new Map();
  for (const list of loaded.values()) for (const m of list) byKey.set(`${String(m.name).toLowerCase()}|${m.source}`, m);

  const monsters = [];
  const books = [];
  const unresolved = [];
  for (const b of chosen) {
    let count = 0;
    for (const raw of loaded.get(b.code)) {
      const m = resolveCopy(raw, byKey);
      if (!m) { unresolved.push(raw.name); continue; }
      monsters.push(toRow(m, b.code));
      count++;
    }
    books.push({ code: b.code, name: b.name, count });
  }
  return { monsters, books, unresolved };
}

/** A resolved 5etools monster -> the row the official_monsters table keeps. */
export function toRow(m, code) {
  const data = { ...m };
  delete data._copy; delete data._versions; delete data._isCopy;
  const cr = data.cr && typeof data.cr === 'object' ? data.cr.cr : data.cr;
  let type = data.type;
  if (type && typeof type === 'object') type = type.type;
  if (type && typeof type === 'object') type = Array.isArray(type.choose) ? type.choose.join('/') : '';
  return { name: String(m.name), source: String(m.source || code), cr: cr == null ? '?' : String(cr), type: String(type || ''), data };
}

// ── _copy / _mod ──────────────────────────────────────────────────────────────
const clone = o => JSON.parse(JSON.stringify(o));
const TEXT_PROPS = ['action', 'bonus', 'reaction', 'trait', 'legendary', 'mythic', 'variant', 'spellcasting',
  'actionHeader', 'bonusHeader', 'reactionHeader', 'legendaryHeader', 'mythicHeader'];
const ABIL = { acrobatics: 'dex', 'animal handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight of hand': 'dex', stealth: 'dex', survival: 'wis' };

/** The monster with its `_copy` applied, or null when the original cannot be found. */
export function resolveCopy(m, byKey, depth = 0) {
  if (!m._copy) return m;
  if (depth > MAX_COPY_DEPTH) return null;
  const ref = m._copy;
  const baseRaw = byKey.get(`${String(ref.name || '').toLowerCase()}|${ref.source}`);
  if (!baseRaw) return null;
  const base = resolveCopy(baseRaw, byKey, depth + 1);
  if (!base) return null;
  const out = clone(base);
  for (const k of ['reprintedAs', 'srd', 'srd52', 'basicRules', 'basicRules2024', 'otherSources', 'referenceSources',
                   'hasFluff', 'hasFluffImages', 'hasToken', 'isNamedCreature', 'isNpc', 'shortName', 'page']) delete out[k];
  for (const [k, v] of Object.entries(m)) if (k !== '_copy') out[k] = clone(v);
  if (ref._mod) applyMods(out, ref._mod);
  delete out._copy;
  return out;
}

function _replaceOutsideTags(s, re, withText) {
  return String(s).split(/(\{@[^}]*\})/g).map(part => (part.startsWith('{@') ? part : part.replace(re, withText))).join('');
}
function _walkStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => _walkStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = k === 'name' && typeof x === 'string' ? x : _walkStrings(x, fn); return o; }
  return v;
}
const _arr = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const _named = (list, name) => list.findIndex(x => x && typeof x === 'object' && String(x.name || '').toLowerCase() === String(name).toLowerCase());

function applyMods(out, mods) {
  for (const [prop, val] of Object.entries(mods)) {
    for (const mod of _arr(val)) {
      if (mod === 'remove') { delete out[prop]; continue; }
      if (!mod || typeof mod !== 'object') continue;
      try {
        if (prop === '*') { for (const p of TEXT_PROPS) if (out[p] !== undefined) applyMod(out, p, mod); }
        else if (prop === '_') applyRootMod(out, mod);
        else applyMod(out, prop, mod);
      } catch { /* one odd modification does not lose the monster */ }
    }
  }
}

function applyMod(out, prop, mod) {
  const items = _arr(mod.items);
  switch (mod.mode) {
    case 'replaceTxt': {
      if (!mod.replace) return;
      const re = new RegExp(mod.replace, String(mod.flags || '').replace(/[^gimsuy]/g, '') + (String(mod.flags || '').includes('g') ? '' : 'g'));
      out[prop] = _walkStrings(out[prop], s => _replaceOutsideTags(s, re, String(mod.with ?? '')));
      return;
    }
    case 'appendArr': out[prop] = [..._arr(out[prop]), ...items]; return;
    case 'prependArr': out[prop] = [...items, ..._arr(out[prop])]; return;
    case 'insertArr': { const a = _arr(out[prop]).slice(); a.splice(Math.max(0, mod.index | 0), 0, ...items); out[prop] = a; return; }
    case 'appendIfNotExistsArr': { const a = _arr(out[prop]).slice(); for (const it of items) if (_named(a, it && it.name) < 0) a.push(it); out[prop] = a; return; }
    case 'replaceArr':
    case 'replaceOrAppendArr': {
      const a = _arr(out[prop]).slice();
      const r = mod.replace;
      const i = r && typeof r === 'object' && r.index != null ? r.index | 0 : _named(a, r);
      if (i >= 0 && i < a.length) a.splice(i, 1, ...items);
      else if (mod.mode === 'replaceOrAppendArr') a.push(...items);
      out[prop] = a; return;
    }
    case 'removeArr': {
      let a = _arr(out[prop]).slice();
      for (const n of _arr(mod.names)) { const i = _named(a, n); if (i >= 0) a.splice(i, 1); }
      for (const it of _arr(mod.items)) a = a.filter(x => JSON.stringify(x) !== JSON.stringify(it) && !(typeof it === 'string' && x === it));
      out[prop] = a; return;
    }
    default: return;
  }
}

function _profBonus(cr) {
  const c = parseFloat(String(cr && typeof cr === 'object' ? cr.cr : cr).replace('1/8', '0.125').replace('1/4', '0.25').replace('1/2', '0.5'));
  if (!isFinite(c)) return 2;
  return Math.max(2, Math.floor((Math.max(1, c) - 1) / 4) + 2);
}
const _sign = n => (n >= 0 ? '+' : '') + n;

function applyRootMod(out, mod) {
  switch (mod.mode) {
    case 'setProp': {
      const path = String(mod.prop || '').split('.').filter(Boolean);
      if (!path.length) return;
      let o = out;
      for (const k of path.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
      o[path.at(-1)] = clone(mod.value);
      return;
    }
    case 'addSkills': {
      const pb = _profBonus(out.cr);
      out.skill = { ...(out.skill || {}) };
      for (const [name, lvl] of Object.entries(mod.skills || {})) {
        const ab = ABIL[name.toLowerCase()];
        if (!ab) continue;
        out.skill[name] = _sign(Math.floor(((out[ab] || 10) - 10) / 2) + pb * (Number(lvl) || 1));
      }
      return;
    }
    case 'scalarAddProp':
    case 'scalarMultProp': {
      const p = mod.prop;
      if (p && typeof out[p] === 'object') for (const [k, v] of Object.entries(out[p])) {
        const n = parseInt(v, 10);
        if (isFinite(n)) out[p][k] = typeof v === 'string' ? _sign(mod.mode === 'scalarAddProp' ? n + mod.scalar : Math.floor(n * mod.scalar)) : (mod.mode === 'scalarAddProp' ? n + mod.scalar : Math.floor(n * mod.scalar));
      }
      return;
    }
    case 'replaceSpells':
    case 'addSpells':
    case 'removeSpells': {
      const sc = Array.isArray(out.spellcasting) && out.spellcasting[0];
      if (!sc) return;
      const edit = (list, changes) => {
        let a = _arr(list).slice();
        if (mod.mode === 'addSpells') return [...a, ..._arr(changes)];
        for (const c of _arr(changes)) {
          if (mod.mode === 'removeSpells') { a = a.filter(x => x !== c); continue; }
          const i = a.indexOf(c && c.replace);
          if (i >= 0) a.splice(i, 1, ..._arr(c.with));
        }
        return a;
      };
      if (mod.will) sc.will = edit(sc.will, mod.will);
      for (const period of ['daily', 'rest', 'weekly']) if (mod[period]) {
        sc[period] = { ...(sc[period] || {}) };
        for (const [k, v] of Object.entries(mod[period])) sc[period][k] = edit(sc[period][k], v);
      }
      if (mod.spells) {
        sc.spells = { ...(sc.spells || {}) };
        for (const [lvl, v] of Object.entries(mod.spells)) {
          const cur = sc.spells[lvl] || { spells: [] };
          const changes = v && v.spells ? v.spells : v;
          sc.spells[lvl] = { ...cur, ...(v && v.slots != null ? { slots: v.slots } : {}), spells: edit(cur.spells, changes) };
        }
      }
      return;
    }
    default: return;
  }
}
