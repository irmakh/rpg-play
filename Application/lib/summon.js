// Written by Irmak Hakman — 2026-11-12 20:25
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Summon spells: which of the campaign's monsters a spell calls up, and that
 * monster as a companion for the caster's sheet (`_companions`).
 *
 * The monsters searched are the campaign's 3rd Party ones — only the books
 * imported into it; nothing is fetched. A creature in several books is
 * offered once (bestOfEach).
 *
 * Used by POST /api/characters/:id/cast (server/routes/cast.js). Pure — no
 * database, no request — so the rules are tested on their own
 * (tests/unit/summon.test.js).
 *
 * A spell is a summon spell when it is in SUMMON_RULES by name, or when its row
 * on the sheet is ticked "Summons a creature" (`summon`). Its candidates are
 * the campaign monsters that:
 *   - the spell's text names ({@creature Bestial Spirit|XPHB}, Find Familiar's
 *     Bat, Cat, Owl…), or
 *   - say they are summoned by it (5etools `summonedBySpell`), or
 *   - fit its rule: creature type and highest CR, which can grow with the slot
 *     (Conjure Elemental: an elemental of CR up to the slot level), or the
 *     {@filter …challenge rating=[&0]|type=beast} the spell's text carries.
 * With one candidate the cast adds it to the companions straight away; with
 * several the player picks one of those — never any other monster, which the
 * server checks again when the pick comes back.
 */

const lc = s => String(s || '').trim().toLowerCase();

// ── The built-in summon spells ────────────────────────────────────────────────
// names: stat blocks the spell uses; types + maxCr: what else it may call
// (maxCr a number, or a function of the slot level). Both 2014 and 2024 names.
const FAMILIARS = ['Bat', 'Cat', 'Crab', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Poisonous Snake',
  'Venomous Snake', 'Fish', 'Quipper', 'Rat', 'Raven', 'Sea Horse', 'Spider', 'Weasel'];
const SPIRIT = n => ({ names: [n] });

export const SUMMON_RULES = {
  'find familiar':            { names: FAMILIARS, types: ['beast'], maxCr: 0 },
  'flock of familiars':       { names: FAMILIARS, types: ['beast'], maxCr: 0 },
  'find steed':               { names: ['Otherworldly Steed', 'Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff', 'Riding Horse'] },
  'find greater steed':       { names: ['Griffon', 'Pegasus', 'Peryton', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'] },
  'conjure animals':          { types: ['beast'], maxCr: 2 },
  'conjure woodland beings':  { types: ['fey'], maxCr: 2 },
  'conjure minor elementals': { types: ['elemental'], maxCr: 2 },
  'conjure elemental':        { types: ['elemental'], maxCr: lv => lv },
  'conjure fey':              { types: ['fey', 'beast'], maxCr: lv => lv },
  'conjure celestial':        { types: ['celestial'], maxCr: lv => (lv >= 9 ? 5 : 4) },
  'summon lesser demons':     { types: ['fiend'], maxCr: 1 },
  'summon greater demon':     { types: ['fiend'], maxCr: lv => lv + 1 },
  'infernal calling':         { types: ['fiend'], maxCr: lv => lv + 1 },
  'animate dead':             { names: ['Skeleton', 'Zombie'] },
  'create undead':            { names: ['Ghoul', 'Ghast', 'Wight', 'Mummy'] },
  'giant insect':             { names: ['Giant Centipede', 'Giant Spider', 'Giant Wasp', 'Giant Scorpion'] },
  'tiny servant':             { names: ['Tiny Servant'] },
  'summon beast':             SPIRIT('Bestial Spirit'),
  'summon fey':               SPIRIT('Fey Spirit'),
  'summon undead':            SPIRIT('Undead Spirit'),
  'summon celestial':         SPIRIT('Celestial Spirit'),
  'summon fiend':             { names: ['Fiendish Spirit', 'Fiend Spirit'] },
  'summon construct':         SPIRIT('Construct Spirit'),
  'summon elemental':         SPIRIT('Elemental Spirit'),
  'summon aberration':        { names: ['Aberrant Spirit', 'Aberration Spirit'] },
  'summon draconic spirit':   { names: ['Draconic Spirit'] },
  'summon dragon':            { names: ['Draconic Spirit'] },
  'summon shadowspawn':       { names: ['Shadow Spirit'] },
};

/** Is this sheet spell a summon spell? */
export function isSummonSpell(sp) {
  return !!sp && (!!sp.summon || Object.prototype.hasOwnProperty.call(SUMMON_RULES, lc(sp.name)));
}

// ── Reading 5etools data ──────────────────────────────────────────────────────
function textOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => textOf(x, out));
  else if (v && typeof v === 'object') {
    for (const k of ['entries', 'items', 'entry']) if (v[k]) textOf(v[k], out);
  }
  return out;
}

/** The creatures a spell's text names: {@creature Owl|XMM} → "owl". */
export function creaturesInText(text) {
  return [...creatureSources(text).keys()];
}
/** The same, with the book each is named from: Map "owl" → "xmm" ('' when none). */
function creatureSources(text) {
  const out = new Map();
  const re = /\{@creature\s+([^}|]+)(?:\|([^}|]*))?[^}]*\}/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) if (!out.has(lc(m[1]))) out.set(lc(m[1]), lc(m[2]));
  return out;
}

// The books a creature is preferred from when several have it: the one the
// spell names, then the newest core books (2024 before 2014).
const BOOK_ORDER = ['xmm', 'xphb', 'mm', 'mpmm', 'tce', 'ftd', 'vgm', 'mtf'];

/** One monster per name: the copy from the book the spell names, else the first of BOOK_ORDER, else any. */
export function bestOfEach(list, wanted = new Map()) {
  const rank = m => {
    const src = lc(m.source || (m.data && m.data.source));
    const w = wanted.get(lc(m.name));
    const i = BOOK_ORDER.indexOf(src);
    return (w && src === w ? 0 : 100) + (i < 0 ? BOOK_ORDER.length : i);
  };
  const best = new Map();
  for (const m of list) {
    const k = lc(m.name);
    const cur = best.get(k);
    if (!cur || rank(m) < rank(cur)) best.set(k, m);
  }
  return [...best.values()];
}

/** {@filter …|bestiary|challenge rating=[&0]|type=beast…} → { types, maxCr }. */
export function filterInText(text) {
  const m = /\{@filter\s[^}]*\|bestiary\|([^}]*)\}/i.exec(String(text || ''));
  if (!m) return null;
  const out = {};
  const cr = /challenge rating=\[?&?([\d/]+)(?:;([\d/]+))?\]?/i.exec(m[1]);
  if (cr) out.maxCr = crNum(cr[2] || cr[1]);
  const ty = /(?:^|\|)type=([a-z;]+)/i.exec(m[1]);
  if (ty) out.types = ty[1].toLowerCase().split(';').filter(Boolean);
  return Object.keys(out).length ? out : null;
}

export function crNum(cr) {
  if (cr && typeof cr === 'object') cr = cr.cr;
  const s = String(cr ?? '').trim();
  if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split('/').map(Number); return b ? a / b : NaN; }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function typeOf(d) {
  const t = d && d.type;
  if (typeof t === 'string') return lc(t);
  if (t && typeof t.type === 'string') return lc(t.type);
  if (t && t.type && Array.isArray(t.type.choose)) return t.type.choose.map(lc);
  return '';
}
const isSwarm = d => !!(d && d.type && typeof d.type === 'object' && d.type.swarmSize);
const baseName = n => lc(n).replace(/\s*\([^)]*\)\s*$/, '');

// ── Candidates ────────────────────────────────────────────────────────────────
/**
 * The campaign monsters a cast of `sp` at `castLevel` may summon.
 * monsters: [{ id, name, cr, data }]; libData: the spell's library entry, if any.
 */
export function summonCandidates(sp, libData, castLevel, monsters) {
  const key = lc(sp && sp.name);
  const rule = SUMMON_RULES[key] || {};
  const text = textOf([sp && sp.entries, sp && sp.higher, libData && libData.entries, libData && libData.entriesHigherLevel]).join('\n');
  const tagged = creatureSources(text);
  const names = new Set([...(rule.names || []).map(lc), ...tagged.keys()]);
  const filt = filterInText(text);
  const types = rule.types || (filt && filt.types) || null;
  let maxCr = typeof rule.maxCr === 'function' ? rule.maxCr(castLevel) : rule.maxCr;
  if (maxCr == null && filt && filt.maxCr != null) maxCr = filt.maxCr;

  const out = [];
  for (const m of monsters || []) {
    const d = m.data || {};
    const nm = lc(m.name || d.name);
    const by = lc(String(d.summonedBySpell || '').split('|')[0]);
    let ok = names.has(nm) || names.has(baseName(nm)) || (by && by === key);
    if (!ok && types && maxCr != null && !isSwarm(d)) {
      const t = typeOf(d);
      const cr = crNum(m.cr ?? d.cr);
      ok = (Array.isArray(t) ? t.some(x => types.includes(x)) : types.includes(t)) && Number.isFinite(cr) && cr <= maxCr;
    }
    if (ok) out.push(m);
  }
  return bestOfEach(out, tagged).sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
}

const crText = v => (v && typeof v === 'object' ? String(v.cr ?? '') : String(v ?? '')).replace(/^\?$/, '');

/** What the picker shows of a candidate. */
export function candidateSummary(m) {
  const d = m.data || {};
  const c = monsterToCompanion(m, {});
  const t = typeOf(d);
  return {
    id: m.id, name: c.name, cr: crText(m.cr ?? d.cr), source: String(m.source || d.source || ''),
    type: Array.isArray(t) ? t.join('/') : t, hp: c.hpMax, ac: c.ac, speed: c.speed,
    portraitThumb: c.portraitThumb || c.portrait || '',
  };
}

// ── Monster → companion ───────────────────────────────────────────────────────
const SIZE = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 };

/** Strip 5etools tags to their text: {@condition Prone|XPHB} → Prone. */
export function plain(s) {
  return String(s || '')
    .replace(/\{@(?:atkr?|atk)\s+([^}]*)\}/gi, (_, a) => (/r/.test(a) ? 'Ranged' : 'Melee') + ' Attack:')
    .replace(/\{@hit\s+([+-]?\d+)\}/gi, (_, n) => (n >= 0 ? '+' : '') + parseInt(n, 10))
    .replace(/\{@h\}/gi, 'Hit: ')
    .replace(/\{@actTrigger\}/gi, 'Trigger:').replace(/\{@actResponse\}/gi, 'Response:')
    .replace(/\{@\w+\s+([^}|]*)(?:\|[^}]*)?\}/g, '$1')
    .replace(/\{@\w+\}/g, '')
    .replace(/[ \t]+/g, ' ').trim();
}

/** A number from a spell-scaled value: "30 + 5 for each spell level above 2" at level 4 → 40. */
function scaled(text, lv) {
  const s = String(text || '');
  const each = /(\d+)\D*?\+\s*(\d+)\s+for each (?:spell )?level above\s+(\d+)/i.exec(s);
  if (each) return parseInt(each[1], 10) + parseInt(each[2], 10) * Math.max(0, (lv || 0) - parseInt(each[3], 10));
  const per = /(\d+)\s*\+\s*(\d+)\s+(?:per|for each|times the) spell(?:'s)? level/i.exec(s);
  if (per) return parseInt(per[1], 10) + parseInt(per[2], 10) * (lv || 0);
  const plus = /(\d+)\s*\+\s*the (?:spell'?s? )?level of the spell|(\d+)\s*\+\s*the spell'?s level/i.exec(s);
  if (plus) return parseInt(plus[1] || plus[2], 10) + (lv || 0);
  const n = /\d+/.exec(s);
  return n ? parseInt(n[0], 10) : 0;
}

/** Dice with summonSpellLevel filled in and the plain numbers added up: "1d8 + 4 + 3" → "1d8+7". */
function dice(expr, lv) {
  const s = String(expr || '').replace(/summonSpellLevel/gi, String(lv || 0)).replace(/\s+/g, '');
  const terms = s.match(/[+-]?[^+-]+/g) || [];
  let flat = 0;
  const kept = [];
  for (const t of terms) {
    if (/^[+-]?\d+$/.test(t)) flat += parseInt(t, 10);
    else kept.push(t.replace(/^\+/, ''));
  }
  if (!kept.length) return String(flat);
  return kept.join('+').replace(/\+-/g, '-') + (flat ? (flat > 0 ? '+' : '') + flat : '');
}

/** "…{@h}7 ({@damage 1d10 + 2}) piercing damage plus 3 ({@damage 1d6}) fire damage" → "1d10+2 piercing, 1d6 fire". */
export function damageOf(text, lv) {
  const t = String(text || '');
  const parts = [];
  const re = /\{@damage\s+([^}|]+)[^}]*\}/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 24), m.index);
    if (/\bor\b[^.]*\($/i.test(before)) continue;           // a versatile alternative
    const d = dice(m[1], lv);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 48);
    const ty = /^\s*\)?\s*([A-Za-z]+)\s+damage/.exec(after);
    parts.push(ty ? `${d} ${ty[1].toLowerCase()}` : d);
  }
  if (parts.length) return parts.join(', ');
  const flat = /\{@h\}\s*(\d+)\s+([A-Za-z]+)\s+damage/i.exec(t);
  return flat ? `${flat[1]} ${flat[2].toLowerCase()}` : '';
}

function attacksOf(d, lv, spellAtk) {
  const out = [];
  for (const a of [].concat(d.action || [], d.bonus || [])) {
    if (!a || typeof a !== 'object') continue;
    const text = textOf(a.entries).join(' ');
    let toHit = '';
    const hit = /\{@hit\s+([+-]?\d+)\}/i.exec(text) || /([+-]\d+)\s+to hit/i.exec(text);
    if (hit) toHit = String(parseInt(hit[1], 10));
    else if (/\{@hitYourSpellAttack/i.test(text) || /your spell attack modifier/i.test(text)) toHit = String(parseInt(spellAtk, 10) || 0);
    else continue;
    out.push({ name: plain(a.name).replace(/\.$/, '').slice(0, 60), toHit, damage: damageOf(text, lv).slice(0, 80) });
    if (out.length >= 20) break;
  }
  return out;
}

function notesOf(d, spellNote) {
  const lines = spellNote ? [spellNote] : [];
  const sec = (list, title) => {
    const rows = (list || []).filter(x => x && typeof x === 'object')
      .map(x => `${plain(x.name).replace(/\.$/, '')}. ${plain(textOf(x.entries).join(' '))}`);
    if (rows.length) lines.push((title ? title + ':\n' : '') + rows.join('\n'));
  };
  sec(d.trait);
  sec((d.action || []).filter(a => !/\{@(?:hit|atk|atkr)\b/i.test(textOf(a.entries).join(' '))), 'Actions');
  sec(d.bonus, 'Bonus Actions');
  sec(d.reaction, 'Reactions');
  return lines.join('\n\n').slice(0, 2000);
}

const upload = v => (typeof v === 'string' && v.startsWith('/uploads/') ? v : '');

// ── The full stat block ───────────────────────────────────────────────────────
// What the table shows of a companion made from a monster: its abilities,
// saves, skills, senses, traits and actions, like a monster's own panel.
const BLOCK_KEYS = ['name', 'source', 'size', 'type', 'alignment', 'cr', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha',
  'save', 'skill', 'senses', 'passive', 'languages', 'immune', 'resist', 'vulnerable', 'conditionImmune',
  'trait', 'action', 'bonus', 'reaction', 'spellcasting', 'initiative'];
export const MAX_BLOCK_CHARS = 24000;

function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => mapStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = mapStrings(v[k], fn); return o; }
  return v;
}

/**
 * The monster's stat block for this summon: the slot's numbers filled in —
 * HP and AC as worked out, "summonSpellLevel" in the dice, and the caster's
 * spell attack where the block says "your spell attack modifier". Null when
 * it would be too large to keep on the sheet.
 */
export function statBlockOf(d, opts = {}) {
  const lv = opts.castLevel || 0;
  const atk = parseInt(opts.spellAtk, 10) || 0;
  const out = {};
  for (const k of BLOCK_KEYS) if (d[k] !== undefined) out[k] = d[k];
  const filled = mapStrings(out, s => s
    .replace(/\{@hitYourSpellAttack[^}]*\}/gi, `{@hit ${atk}}`)
    .replace(/\{@(damage|dice)\s+([^}|]*summonSpellLevel[^}|]*)([^}]*)\}/gi, (_, t, e, rest) => `{@${t} ${dice(e, lv)}${rest}}`)
    .replace(/\bsummonSpellLevel\b/g, String(lv)));
  filled.hp = { average: opts.hpMax || 0 };
  filled.ac = [opts.ac || 10];
  const json = JSON.stringify(filled);
  return json.length <= MAX_BLOCK_CHARS ? filled : null;
}

/**
 * A campaign monster as a sheet companion.
 * opts: { castLevel, spellName, spellAtk, existing } — `existing` is the
 * companion it replaces, whose id, turn order and own picture are kept.
 */
export function monsterToCompanion(m, opts = {}) {
  const d = (m && m.data) || {};
  const lv = opts.castLevel || 0;
  const hp = d.hp || {};
  const hpMax = Number.isFinite(hp.average) ? hp.average : scaled(hp.special, lv);
  const ac0 = Array.isArray(d.ac) ? d.ac[0] : d.ac;
  const ac = typeof ac0 === 'number' ? ac0
    : ac0 && typeof ac0 === 'object' ? (Number.isFinite(ac0.ac) ? ac0.ac : scaled(ac0.special, lv)) : scaled(ac0, lv);
  const sp = d.speed || {};
  const spd = v => (typeof v === 'number' ? v : v && typeof v.number === 'number' ? v.number : 0);
  const speed = spd(sp.walk) || Math.max(0, spd(sp.fly), spd(sp.swim), spd(sp.climb), spd(sp.burrow));
  const dex = parseInt(d.dex, 10);
  const size = SIZE[String((Array.isArray(d.size) ? d.size[0] : d.size) || 'M').toUpperCase()] || 1;
  const ex = opts.existing || null;
  const portrait = upload(d.portrait), portraitThumb = upload(d.portraitThumb || d.portrait);
  const note = opts.spellName ? `Summoned with ${opts.spellName}${lv ? ` (level ${lv})` : ''}.` : '';
  const hpN = Math.max(0, hpMax || 0);
  const block = statBlockOf(d, { castLevel: lv, spellAtk: opts.spellAtk, hpMax: hpN, ac: ac || 0 });
  return {
    id: ex && ex.id ? String(ex.id) : '',
    monsterId: String(m.id || ''),
    name: String(m.name || d.name || 'Companion').slice(0, 60),
    hpMax: hpN,
    ac: ac || '',
    speed: speed || 30,
    initBonus: Number.isFinite(dex) ? Math.floor((dex - 10) / 2) : 0,
    initMode: ex && ex.initMode === 'own' ? 'own' : 'shared',
    size,
    attacks: attacksOf(d, lv, opts.spellAtk),
    // With the full stat block kept, the notes need not repeat its traits.
    notes: block ? note : notesOf(d, note),
    ...(block ? { statBlock: block } : {}),
    // A picture the player gave it themselves stays; otherwise the monster's.
    portrait: (ex && ex.portrait) || portrait,
    portraitThumb: ex && ex.portrait ? ex.portraitThumb || '' : portraitThumb,
  };
}

/**
 * Put a companion made from monster `m` into the sheet's list: the one already
 * made from that monster (or with its name) is updated in place, else it is
 * added. Returns { list, companion, updated }.
 */
export function upsertCompanion(list, m, opts, newId) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const name = lc(m.name || (m.data && m.data.name));
  let i = arr.findIndex(c => c && c.monsterId && String(c.monsterId) === String(m.id));
  if (i < 0) i = arr.findIndex(c => c && lc(c.name) === name);
  const existing = i >= 0 ? arr[i] : null;
  const c = monsterToCompanion(m, { ...opts, existing });
  if (!c.id) c.id = newId;
  if (i >= 0) arr[i] = c; else arr.push(c);
  return { list: arr, companion: c, updated: i >= 0 };
}
