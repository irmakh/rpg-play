// Written by Irmak Hakman — 2026-11-12 13:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Magic items from books, for the treasury's 3rd Party item catalogue
 * (server/routes/book-items.js).
 *
 * Two ways in:
 *   - the 5etools core data (items.json, items-base.json, magicvariants.json
 *     in the public GitHub repository 5etools-mirror-3/5etools-src), fetched
 *     for one import, used and dropped — nothing is written to disk;
 *   - a 5etools homebrew JSON file the DM uploads ({ _meta, item, itemGroup,
 *     magicvariant, baseitem }), read the same way and not kept either.
 *
 * Only magic items come in: anything with a rarity other than "none" or
 * "unknown", plus the generic variants ("+1 Weapon", "Flame Tongue") as one
 * generic item each. What is stored is the 5etools object with its `_copy`
 * and base item (damage, AC, properties) resolved; toTreasuryFields() turns it
 * into the treasury's own fields when the DM adds a copy to a pile.
 */

export const MIRROR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
const TIMEOUT_MS = 60 * 1000;
const MAX_FILE_BYTES = 24 * 1024 * 1024;       // items.json is about 3 MB
const FIRST = ['XDMG', 'DMG', 'XGE', 'TCE', 'XPHB', 'PHB'];
const MAX_COPY_DEPTH = 5;
const NOT_MAGIC = new Set(['none', 'unknown', '']);

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()} (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`${url.split('/').pop()} is unexpectedly large`);
  try { return JSON.parse(text); } catch { throw new Error(`${url.split('/').pop()} is not valid JSON`); }
}

const clone = o => JSON.parse(JSON.stringify(o));
const arr = v => (Array.isArray(v) ? v : []);
const keyOf = (name, source) => `${String(name || '').trim().toLowerCase()}|${String(source || '').toLowerCase()}`;
const refKey = ref => { const [n, s] = String(ref || '').split('|'); return keyOf(n, s || 'phb'); };

export const isMagic = it => !!it && typeof it === 'object' && typeof it.name === 'string' && it.name.trim() !== ''
  && !NOT_MAGIC.has(String(it.rarity ?? '').toLowerCase());

/** Book code -> readable name, from 5etools' own book and adventure lists. */
async function bookNames(fetchImpl) {
  const names = {};
  for (const [file, key] of [['books.json', 'book'], ['adventures.json', 'adventure']]) {
    try {
      const d = await getJson(`${MIRROR}/${file}`, fetchImpl);
      for (const b of arr(d && d[key])) if (b && b.id && b.name) names[b.id] = String(b.name);
    } catch { /* names are a nicety: the code still shows */ }
  }
  return names;
}

/** The three core files, in memory: { items, base, variants }. */
async function loadCore(fetchImpl) {
  const [items, base, variants] = await Promise.all([
    getJson(`${MIRROR}/items.json`, fetchImpl),
    getJson(`${MIRROR}/items-base.json`, fetchImpl),
    getJson(`${MIRROR}/magicvariants.json`, fetchImpl),
  ]);
  return {
    items: [...arr(items && items.item), ...arr(items && items.itemGroup)],
    base: arr(base && base.baseitem),
    variants: arr(variants && variants.magicvariant),
  };
}

// ── Building the stored item ──────────────────────────────────────────────────

/** The item with its `_copy` applied (own fields win), or null when the original is missing. */
function resolveCopy(it, byKey, depth = 0) {
  if (!it._copy) return it;
  if (depth > MAX_COPY_DEPTH) return null;
  const base = byKey.get(keyOf(it._copy.name, it._copy.source));
  if (!base) return null;
  const from = resolveCopy(base, byKey, depth + 1);
  if (!from) return null;
  const out = clone(from);
  for (const k of ['reprintedAs', 'srd', 'srd52', 'basicRules', 'basicRules2024', 'otherSources', 'referenceSources', 'page', 'lootTables']) delete out[k];
  for (const [k, v] of Object.entries(it)) if (k !== '_copy') out[k] = clone(v);
  return out;
}

// What a magic weapon or armour takes from its base item ("longsword|phb").
const FROM_BASE = ['type', 'dmg1', 'dmg2', 'dmgType', 'property', 'ac', 'weaponCategory', 'range', 'strength', 'stealth'];
function withBase(it, baseByKey) {
  if (!it.baseItem) return it;
  const b = baseByKey.get(refKey(it.baseItem));
  if (!b) return it;
  const out = { ...it, _baseName: b.name };
  for (const k of FROM_BASE) if (out[k] === undefined && b[k] !== undefined) out[k] = clone(b[k]);
  return out;
}

/** A generic variant ("+1 Weapon") as one item: its `inherits` with {=key} filled in. */
function fromVariant(v) {
  const inh = v && v.inherits;
  if (!inh || !inh.source || !v.name) return null;
  const out = { name: v.name, source: inh.source, type: 'GV', requires: v.requires || [], excludes: v.excludes };
  for (const [k, x] of Object.entries(inh)) if (!/^name(Prefix|Suffix|Remove)$/.test(k)) out[k] = clone(x);
  const fill = s => s.replace(/\{=(\w+)(?:\/\w+)?\}/g, (m, k) => (inh[k] != null && typeof inh[k] !== 'object' ? String(inh[k]) : ''));
  const walk = x => (typeof x === 'string' ? fill(x) : Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x);
  out.entries = walk(arr(out.entries));
  return out;
}

/**
 * Every magic item of the given lists, resolved: [{ name, source, rarity, data }].
 * `wanted(source)` picks the books; `lookup` holds every item a `_copy` or a
 * base item may point at.
 */
function build({ items, variants, base }, wanted, lookup) {
  const byKey = new Map();
  for (const it of [...lookup.items, ...items]) if (it && it.name) byKey.set(keyOf(it.name, it.source), it);
  const baseByKey = new Map();
  for (const b of [...lookup.base, ...base]) if (b && b.name) baseByKey.set(keyOf(b.name, b.source), b);
  for (const b of [...lookup.base, ...base]) if (b && b.name && !byKey.has(keyOf(b.name, b.source))) byKey.set(keyOf(b.name, b.source), b);

  const out = [];
  let unresolved = 0;
  for (const raw of items) {
    if (!raw || !wanted(raw.source)) continue;
    const r = resolveCopy(raw, byKey);
    if (!r) { unresolved++; continue; }
    if (!isMagic(r)) continue;
    out.push(withBase(r, baseByKey));
  }
  for (const v of variants) {
    const it = fromVariant(v);
    if (it && wanted(it.source) && isMagic(it)) out.push(it);
  }
  return {
    items: out.map(d => ({ name: d.name.trim(), source: String(d.source), rarity: String(d.rarity || '').toLowerCase(), data: d })),
    unresolved,
  };
}

// ── 5etools core books ────────────────────────────────────────────────────────

/** The books with magic items: [{ code, name, count }], core books first. */
export async function listItemBooks(fetchImpl = fetch) {
  const [core, names] = await Promise.all([loadCore(fetchImpl), bookNames(fetchImpl)]);
  const { items } = build(core, () => true, { items: [], base: [] });
  const counts = {};
  for (const it of items) counts[it.source] = (counts[it.source] || 0) + 1;
  const rank = c => { const i = FIRST.indexOf(c); return i < 0 ? FIRST.length : i; };
  return Object.entries(counts).map(([code, count]) => ({ code, name: names[code] || code, count }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name));
}

/** Every magic item of the chosen books: { items, books: [{ code, name, count }], unresolved }. */
export async function fetchItemBooks(codes, fetchImpl = fetch) {
  const [core, names] = await Promise.all([loadCore(fetchImpl), bookNames(fetchImpl)]);
  const all = build(core, () => true, { items: [], base: [] });
  const have = new Set(all.items.map(i => i.source));
  const want = (Array.isArray(codes) ? codes : []).map(String);
  for (const c of want) if (!have.has(c)) throw new Error(`Unknown book: ${c}`);
  const set = new Set(want);
  const items = all.items.filter(i => set.has(i.source));
  const books = want.map(code => ({ code, name: names[code] || code, count: items.filter(i => i.source === code).length }));
  return { items: items.map(i => ({ ...i, bookName: names[i.source] || i.source })), books, unresolved: all.unresolved };
}

// ── Homebrew upload ───────────────────────────────────────────────────────────

/**
 * The magic items of an uploaded 5etools homebrew file. A `_copy` or base item
 * pointing at the core books is looked up in the core data, fetched only when
 * the file needs it. -> { items, books, skipped, unresolved }
 */
export async function parseHomebrew(file, fetchImpl = fetch) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('That is not a 5etools homebrew file.');
  const items = [...arr(file.item), ...arr(file.itemGroup)].filter(x => x && typeof x === 'object');
  const variants = arr(file.magicvariant).filter(x => x && typeof x === 'object');
  const base = arr(file.baseitem).filter(x => x && typeof x === 'object');
  if (!items.length && !variants.length) throw new Error('No items found in that file.');
  if (items.length + variants.length > 20000) throw new Error('That file has too many items.');

  const local = new Set([...items, ...base].map(x => keyOf(x.name, x.source)));
  const needsCore = items.some(x => (x._copy && !local.has(keyOf(x._copy.name, x._copy.source))) || (x.baseItem && !local.has(refKey(x.baseItem))));
  let lookup = { items: [], base: [] };
  if (needsCore) { try { lookup = await loadCore(fetchImpl); } catch { /* resolve what the file itself holds */ } }

  const { items: out, unresolved } = build({ items, variants, base }, () => true, lookup);
  const names = {};
  for (const s of arr(file._meta && file._meta.sources)) if (s && s.json) names[s.json] = String(s.full || s.abbreviation || s.json);
  const counts = {};
  for (const it of out) counts[it.source] = (counts[it.source] || 0) + 1;
  const books = Object.entries(counts).map(([code, count]) => ({ code, name: names[code] || code, count }));
  return {
    items: out.map(i => ({ ...i, bookName: names[i.source] || i.source })),
    books,
    skipped: items.length + variants.length - out.length - unresolved,
    unresolved,
  };
}

// ── Into the treasury's fields ────────────────────────────────────────────────

const ATK = { m: 'Melee Weapon Attack:', r: 'Ranged Weapon Attack:', mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:',
  'm,r': 'Melee or Ranged Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:' };
const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

function tagText(tag, body) {
  const p = String(body || '').split('|');
  switch (tag) {
    case 'dice': case 'damage': case 'd20': case 'autodice': return p[1] || p[0];
    case 'hit': return p[1] || (/^[+-]/.test(p[0]) ? p[0] : `+${p[0]}`);
    case 'dc': return p[1] || `DC ${p[0]}`;
    case 'chance': return p[1] || `${p[0]} percent`;
    case 'recharge': return p[0] ? `(Recharge ${p[0]}–6)` : '(Recharge 6)';
    case 'scaledice': case 'scaledamage': return p[3] || p[2] || p[0];
    case 'atk': case 'atkr': return ATK[p[0]] || '';
    case 'h': return 'Hit: ';
    case 'm': return 'Miss: ';
    case 'actSave': return `${ABIL[p[0]] || p[0]} Saving Throw:`;
    case 'actSaveFail': return 'Failure:';
    case 'actSaveSuccess': return 'Success:';
    case 'actSaveSuccessOrFail': return 'Failure or Success:';
    case 'actTrigger': return 'Trigger:';
    case 'actResponse': return 'Response:';
    case 'quickref': return p[4] || p[0];
    case 'filter': case 'b': case 'bold': case 'i': case 'italic': case 'u': case 'underline':
    case 's': case 'strike': case 'note': case 'sup': case 'sub': case 'code': return p[0];
    default: return p[2] || p[0];
  }
}

/** 5etools {@tags} as plain words. */
export function plainText(s) {
  let t = String(s ?? '');
  for (let i = 0; i < 20 && /\{@\w+/.test(t); i++) t = t.replace(/\{@(\w+)(?: ([^{}]*))?\}/g, (m, tag, body) => tagText(tag, body));
  return t.replace(/\{=\w+\}/g, '').replace(/[ \t]+/g, ' ').trim();
}

function cellText(c) {
  if (c && typeof c === 'object' && c.roll) {
    const r = c.roll;
    return r.exact != null ? String(r.exact) : `${r.min}–${r.max}`;
  }
  if (c && typeof c === 'object') return entriesText(c.entry ?? c.entries ?? '').replace(/\n+/g, ' ');
  return plainText(c);
}

/** Paragraphs of plain text from 5etools entries (lists become bullet lines, tables pipe rows). */
export function entriesText(entries) {
  const blocks = [];
  const add = s => { if (s && s.trim()) blocks.push(s.trim()); };
  const walk = (e, lead) => {
    if (e == null) return;
    if (typeof e === 'string') { add((lead ? `${lead} ` : '') + plainText(e)); return; }
    if (Array.isArray(e)) { e.forEach((x, i) => walk(x, i === 0 ? lead : '')); return; }
    if (typeof e !== 'object') return;
    const name = e.name ? `${plainText(e.name)}.` : '';
    switch (e.type) {
      case 'list':
        add(arr(e.items).map(x => '• ' + (typeof x === 'string' ? plainText(x)
          : `${x.name ? plainText(x.name) + '. ' : ''}${entriesText(x.entry ?? x.entries ?? '').replace(/\n+/g, ' ')}`)).join('\n'));
        return;
      case 'table': {
        const rows = [];
        if (e.caption) rows.push(plainText(e.caption));
        if (arr(e.colLabels).length) rows.push(e.colLabels.map(plainText).join(' | '));
        for (const r of arr(e.rows)) rows.push(arr(Array.isArray(r) ? r : r && r.row).map(cellText).join(' | '));
        add(rows.join('\n'));
        return;
      }
      case 'item': case 'itemSub': case 'itemSpell':
        walk(e.entry ?? e.entries, name);
        return;
      case 'image': case 'hr': case 'gallery': case 'abilityDc': case 'abilityAttackMod': case 'abilityGeneric':
      case 'refOptionalfeature': case 'refClassFeature': case 'refSubclassFeature': case 'statblock': case 'statblockInline':
        return;
      default:
        if (e.entries !== undefined) walk(e.entries, [lead, name].filter(Boolean).join(' '));
        else if (e.entry !== undefined) walk(e.entry, [lead, name].filter(Boolean).join(' '));
        else if (e.items !== undefined) walk(e.items, name);
    }
  };
  walk(entries, '');
  return blocks.join('\n\n');
}

const TYPE_LABEL = { M: 'Weapon', R: 'Weapon', A: 'Ammunition', AF: 'Ammunition', LA: 'Armor', MA: 'Armor', HA: 'Armor', S: 'Shield',
  P: 'Potion', RG: 'Ring', WD: 'Wand', RD: 'Rod', SC: 'Scroll', INS: 'Instrument', SCF: 'Spellcasting focus', G: 'Adventuring gear',
  TAH: 'Tack and harness', OTH: 'Other', T: 'Tool', AT: "Artisan's tools", GS: 'Gaming set', FD: 'Food and drink', EXP: 'Explosive' };
const DMG_TYPE = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing',
  I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' };
const PROP = { F: 'Finesse', A: 'Ammunition', V: 'Versatile', '2H': 'Two-Handed', L: 'Light', H: 'Heavy', T: 'Thrown', R: 'Reach', LD: 'Loading' };
const PROP_ORDER = ['Finesse', 'Ammunition', 'Versatile', 'Two-Handed', 'Light', 'Heavy', 'Thrown', 'Reach', 'Loading', 'Range'];

const code = t => String(t || '').split('|')[0];
const int = v => { const n = parseInt(String(v ?? '').replace(/^\+/, ''), 10); return Number.isFinite(n) ? n : 0; };

/** What a generic variant goes with: 'weapon' | 'armor' | 'shield' | 'ammo' | '' and a phrase ("any sword"). */
function variantTarget(d) {
  const req = arr(d.requires);
  const words = [];
  let kind = '';
  for (const r of req) {
    if (!r || typeof r !== 'object') continue;
    const t = code(r.type);
    // Named base items ({ name: 'Longsword', source: 'XPHB' }).
    if (typeof r.name === 'string' && r.name) {
      const n = r.name.toLowerCase();
      const k = /shield/.test(n) ? 'shield' : /armor|mail|plate|breastplate|leather|hide|splint/.test(n) ? 'armor' : 'weapon';
      kind = kind || k;
      words.push(n);
      continue;
    }
    if (r.weapon || r.sword || r.axe || r.bow || r.crossbow || r.spear || r.polearm || r.mace || r.hammer || t === 'M' || t === 'R' || r.weaponCategory) {
      kind = kind || 'weapon';
      words.push(r.sword ? 'sword' : r.axe ? 'axe' : r.bow ? 'bow' : r.crossbow ? 'crossbow' : r.weaponCategory ? `${r.weaponCategory} weapon` : 'weapon');
    } else if (t === 'A' || t === 'AF') { kind = kind || 'ammo'; words.push('ammunition'); }
    else if (t === 'S') { kind = kind || 'shield'; words.push('shield'); }
    else if (r.armor || t === 'LA' || t === 'MA' || t === 'HA') { kind = kind || 'armor'; words.push(t === 'HA' ? 'heavy armor' : t === 'MA' ? 'medium armor' : t === 'LA' ? 'light armor' : 'armor'); }
  }
  const uniq = [...new Set(words)];
  const list = uniq.length > 1 ? `${uniq.slice(0, -1).join(', ')} or ${uniq[uniq.length - 1]}` : uniq[0] || '';
  return { kind, phrase: list ? `any ${list}` : '' };
}

/** "Wondrous item, rare (requires attunement by a wizard)". */
export function itemHeader(d) {
  const t = code(d.type);
  let label;
  if (t === 'GV') { const v = variantTarget(d); label = `${v.kind === 'ammo' ? 'Ammunition' : v.kind === 'shield' ? 'Shield' : v.kind === 'armor' ? 'Armor' : 'Weapon'}${v.phrase ? ` (${v.phrase})` : ''}`; }
  else if (d.wondrous) label = d.tattoo ? 'Wondrous item (tattoo)' : 'Wondrous item';
  else if (d.staff) label = 'Staff';
  else {
    label = TYPE_LABEL[t] || 'Item';
    if (t === 'LA' || t === 'MA' || t === 'HA') label = `Armor (${d._baseName ? d._baseName.toLowerCase() : { LA: 'light', MA: 'medium', HA: 'heavy' }[t]})`;
    else if (d._baseName && (t === 'M' || t === 'R' || t === 'A' || t === 'S') && d._baseName.toLowerCase() !== label.toLowerCase()) label += ` (${d._baseName.toLowerCase()})`;
  }
  const r = String(d.rarity || '').toLowerCase();
  const rarity = r === 'unknown (magic)' ? 'rarity unknown' : r === 'varies' ? 'rarity varies' : r;
  let att = '';
  if (d.reqAttune === true) att = ' (requires attunement)';
  else if (d.reqAttune === 'optional') att = ' (attunement optional)';
  else if (typeof d.reqAttune === 'string' && d.reqAttune) att = ` (requires attunement ${plainText(d.reqAttune)})`;
  return `${label}${rarity ? `, ${rarity}` : ''}${att}`;
}

/** The treasury's kind for a stored item: weapon | armor | shield | potion | wondrous | other. */
export function itemKind(d) {
  const t = code(d.type);
  if (t === 'GV') { const k = variantTarget(d).kind; return k === 'ammo' || !k ? 'other' : k; }
  if (t === 'M' || t === 'R') return 'weapon';
  if (t === 'LA' || t === 'MA' || t === 'HA') return 'armor';
  if (t === 'S') return 'shield';
  if (t === 'P') return 'potion';
  if (d.wondrous || d.staff || ['RG', 'WD', 'RD', 'SCF', 'INS'].includes(t)) return 'wondrous';
  return 'other';
}

/**
 * The fields of a treasury item for a stored book item. The result goes
 * through the treasury's own sanitizeFields() before it is written.
 */
export function toTreasuryFields(d) {
  const t = code(d.type);
  const itemType = itemKind(d);
  const f = {
    name: String(d.name || '').trim().slice(0, 120),
    itemType,
    armorType: { LA: 'light', MA: 'medium', HA: 'heavy' }[t] || 'light',
    acBase: 10,
    acBonus: int(d.bonusAc),
    spellAtkBonus: int(d.bonusSpellAttack),
    spellDcBonus: int(d.bonusSpellSaveDc),
    requiresAttunement: !!d.reqAttune && d.reqAttune !== 'optional',
    valueCp: Number.isFinite(d.value) && d.value > 0 ? Math.round(d.value) : 0,
    charges: Math.max(0, Math.min(999, int(d.charges))),
    chargesRecharge: d.recharge && int(d.charges) ? 'long' : '',
    weaponAtk: '', weaponDmg: '', weaponProperties: [],
    speedBonus: 0,
  };
  if (itemType === 'armor' && t !== 'GV') f.acBase = int(d.ac) || 10;
  if (itemType === 'shield') f.acBonus = (t === 'GV' ? 2 : (int(d.ac) || 2)) + int(d.bonusAc);
  if (itemType === 'weapon' || (t === 'GV' && variantTarget(d).kind === 'ammo')) {
    // A plain number, as the treasury editor's number field keeps it ("2", not "+2").
    const atk = int(d.bonusWeapon) || int(d.bonusWeaponAttack);
    f.weaponAtk = atk ? String(atk) : '';
    if (d.dmg1) f.weaponDmg = `${d.dmg1}${DMG_TYPE[d.dmgType] ? ' ' + DMG_TYPE[d.dmgType] : ''}`;
    const props = new Set(arr(d.property).map(p => PROP[code(typeof p === 'object' ? p.uid : p)]).filter(Boolean));
    if (t === 'R' || d.range) props.add('Range');
    f.weaponProperties = PROP_ORDER.filter(p => props.has(p)).slice(0, 3);
  }
  const ms = d.modifySpeed && d.modifySpeed.bonus;
  if (ms && typeof ms === 'object') f.speedBonus = int(ms['*'] ?? ms.walk);

  const parts = [itemHeader(d)];
  if (t === 'GV' && itemType === 'armor') parts.push('Generic: set the base armor and its AC on this copy.');
  if (t === 'GV' && itemType === 'weapon') parts.push('Generic: set the weapon’s damage and properties on this copy.');
  const body = entriesText(d.entries);
  if (body) parts.push(body);
  f.description = parts.join('\n\n');
  return f;
}
