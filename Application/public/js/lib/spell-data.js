// Written by Irmak Hakman — 2026-11-11 17:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

// ── Spells: one shape for every page ──────────────────────────────────────────
// A character's spells are `_spells`: a JSON list of spell objects. Until v320
// each spell was a 15-element array read by position all over the app
// ([lvl, name, time, range, conc, ritual, notes, prepared, school, v, s, m,
// material, actionCategory, duration]). normalizeSpell() reads both, so old
// sheets, old backups and old XML files keep working; everything else in the
// app only ever sees the object.
//
// The campaign's spell library holds 5etools spell objects as imported
// (server/routes/spells.js). spellFrom5e() turns one into a sheet spell.
//
// Classic script, no DOM: loaded by the sheet, the table, the console and the
// DM spell library, and tested in a vm (tests/unit/spell-data.test.js).
// Depends on nothing; escapes its own output.

const SPELL_SCHOOLS = [
  ['Abj', 'Abjuration'], ['Conj', 'Conjuration'], ['Div', 'Divination'], ['Ench', 'Enchantment'],
  ['Evoc', 'Evocation'], ['Illu', 'Illusion'], ['Necro', 'Necromancy'], ['Trans', 'Transmutation'],
];
// 5etools writes the school as one letter.
const SPELL_SCHOOL_5E = { A: 'Abj', C: 'Conj', D: 'Div', E: 'Ench', V: 'Evoc', I: 'Illu', N: 'Necro', T: 'Trans' };

const SPELL_CAST_TYPES = [
  ['action', 'Action'], ['bonus', 'Bonus Action'], ['reaction', 'Reaction'],
  ['minute', 'Minutes'], ['hour', 'Hours'], ['other', 'Other'],
];

// Where a spell comes from — the "source" the feedback asked for. `detail` says
// which one: "Magic Initiate", "Wizard", "High Elf", "Pact of the Tome".
const SPELL_SOURCE_KINDS = [
  ['class', 'Class'], ['subclass', 'Subclass'], ['feat', 'Feat'], ['species', 'Species'],
  ['feature', 'Class feature'], ['item', 'Item'], ['other', 'Other'],
];

function _spEsc(s) {
  return (s == null || s === false ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _spStr(v, n) { return v == null ? '' : String(v).slice(0, n); }
function _spInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
function _spTruthy(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

/** A new id for a spell on a sheet. */
function spellNewId() {
  return 'sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** The casting type a free-text casting time ("1 Bonus Action", "10 minutes") stands for. */
function spellCastFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return 'action';
  if (/bonus/.test(t)) return 'bonus';
  if (/reaction/.test(t)) return 'reaction';
  if (/hour/.test(t)) return 'hour';
  if (/minute|\bmin\b/.test(t)) return 'minute';
  if (/action/.test(t)) return 'action';
  return 'other';
}

/** "Abjuration" -> "Abj"; anything already short, or unknown, passes through. */
function spellSchoolCode(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (SPELL_SCHOOL_5E[s]) return SPELL_SCHOOL_5E[s];
  const hit = SPELL_SCHOOLS.find(([code, name]) => code.toLowerCase() === s.toLowerCase() || name.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : s.slice(0, 8);
}

/**
 * A spell as the sheet keeps it, from either the old 15-element array or an
 * object (possibly partial, possibly from an older or newer version). Always
 * returns a complete object; never throws.
 */
function normalizeSpell(x) {
  if (Array.isArray(x)) {
    const time = _spStr(x[2], 80);
    // The old row had a separate "show in Actions" choice (index 13). When the
    // casting-time text says nothing clear, that choice decides the type.
    let cast = spellCastFromText(time);
    if ((cast === 'other' || !time.trim()) && ['action', 'bonus', 'reaction'].includes(x[13])) cast = x[13];
    x = {
      level: x[0], name: x[1], castText: time, cast, range: x[3],
      conc: x[4], ritual: x[5], notes: x[6], prepared: x[7], school: x[8],
      v: x[9], s: x[10], m: x[11], material: x[12], duration: x[14],
    };
  }
  const o = (x && typeof x === 'object') ? x : {};
  const castOk = SPELL_CAST_TYPES.some(([k]) => k === o.cast);
  const src = (o.source && typeof o.source === 'object') ? o.source : {};
  const kindOk = SPELL_SOURCE_KINDS.some(([k]) => k === src.kind);
  const uses = _spInt(o.uses, 0, 99, 0);
  return {
    id: _spStr(o.id, 40) || spellNewId(),
    libId: _spStr(o.libId, 64),
    book: _spStr(o.book, 40),
    name: _spStr(o.name, 120).trim(),
    level: _spInt(o.level, 0, 9, 0),
    school: spellSchoolCode(o.school),
    cast: castOk ? o.cast : spellCastFromText(o.castText),
    castText: _spStr(o.castText, 300),   // a reaction's trigger can be long
    ritual: _spTruthy(o.ritual),
    conc: _spTruthy(o.conc),
    range: _spStr(o.range, 80),
    duration: _spStr(o.duration, 80),
    v: _spTruthy(o.v), s: _spTruthy(o.s), m: _spTruthy(o.m),
    material: _spStr(o.material, 300),
    prepared: _spTruthy(o.prepared),
    noSlot: _spTruthy(o.noSlot),
    // Always prepared (a feat, subclass feature or item grants it): ready without
    // preparing and not counted among prepared spells; it still uses slots.
    alwaysPrepared: _spTruthy(o.alwaysPrepared),
    uses,
    // A spell with no use count (a Mystic Arcanum) still records one use.
    used: Math.min(_spInt(o.used, 0, 99, 0), uses || 1),
    recharge: o.recharge === 'short' || o.recharge === 'long' ? o.recharge : '',
    source: { kind: kindOk ? src.kind : '', detail: _spStr(src.detail, 80) },
    notes: _spStr(o.notes, 4000),
    // The 5etools text, for library spells: kept so the card and (in the next
    // release) the damage buttons can read it without the library.
    entries: Array.isArray(o.entries) ? o.entries : [],
    higher: Array.isArray(o.higher) ? o.higher : [],
  };
}

/** A sheet's `_spells` value (JSON string or array) as a list of spell objects. */
function parseSpellList(v) {
  let list = v;
  if (typeof v === 'string') { try { list = JSON.parse(v || '[]'); } catch { list = []; } }
  return Array.isArray(list) ? list.filter(Boolean).map(normalizeSpell) : [];
}

// ── 5etools -> sheet ──────────────────────────────────────────────────────────
const _SP_UNIT = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction', minute: 'minute', hour: 'hour', round: 'round' };

function _sp5eTime(t) {
  if (!t) return { cast: 'action', castText: '' };
  const n = t.number || 1;
  const unit = String(t.unit || 'action');
  let label = _SP_UNIT[unit] || unit;
  if (unit === 'minute' || unit === 'hour' || unit === 'round') label += n === 1 ? '' : 's';
  let text = `${n} ${label}`;
  if (t.condition) text += ', ' + spellInlineText(t.condition);
  const cast = unit === 'bonus' ? 'bonus' : unit === 'reaction' ? 'reaction' : unit === 'action' ? 'action'
             : unit === 'minute' ? 'minute' : unit === 'hour' ? 'hour' : 'other';
  return { cast, castText: text };
}

function _sp5eDistance(d) {
  if (!d) return '';
  switch (d.type) {
    case 'self': return 'Self';
    case 'touch': return 'Touch';
    case 'sight': return 'Sight';
    case 'unlimited': return 'Unlimited';
    case 'feet': return `${d.amount} feet`;
    case 'miles': return `${d.amount} mile${d.amount === 1 ? '' : 's'}`;
    default: return d.amount != null ? `${d.amount} ${d.type}` : String(d.type || '');
  }
}

function _sp5eRange(r) {
  if (!r) return '';
  if (r.type === 'special') return 'Special';
  if (r.type === 'point') return _sp5eDistance(r.distance);
  // An area around the caster: "Self (15-foot cone)".
  const d = r.distance || {};
  const shape = { radius: 'radius', sphere: 'sphere', cone: 'cone', line: 'line', cube: 'cube',
                  hemisphere: 'hemisphere', cylinder: 'cylinder', emanation: 'emanation' }[r.type] || r.type;
  const unit = d.type === 'miles' ? 'mile' : 'foot';
  return d.amount != null ? `Self (${d.amount}-${unit} ${shape})` : `Self (${shape})`;
}

function _sp5eDuration(list) {
  const d = Array.isArray(list) ? list[0] : null;
  if (!d) return { duration: '', conc: false };
  switch (d.type) {
    case 'instant': return { duration: 'Instantaneous', conc: false };
    case 'permanent': {
      const ends = Array.isArray(d.ends) ? d.ends : [];
      const txt = ends.includes('dispel') ? (ends.includes('trigger') ? 'Until dispelled or triggered' : 'Until dispelled') : 'Permanent';
      return { duration: txt, conc: false };
    }
    case 'special': return { duration: 'Special', conc: !!d.concentration };
    case 'timed': {
      const t = d.duration || {};
      const n = t.amount || 1;
      const unit = String(t.type || '');
      const txt = `${t.upTo ? 'Up to ' : ''}${n} ${unit}${n === 1 ? '' : 's'}`;
      return { duration: txt, conc: !!d.concentration };
    }
    default: return { duration: String(d.type || ''), conc: !!d.concentration };
  }
}

function _sp5eMaterial(m) {
  if (!m) return { m: false, material: '' };
  if (typeof m === 'string') return { m: true, material: m };
  if (typeof m === 'object') return { m: true, material: String(m.text || '') };
  return { m: true, material: '' };
}

/**
 * A sheet spell from a library spell (5etools object). `libId` links it back
 * to the library row; `source` and `prepared` start empty for the player.
 */
function spellFrom5e(raw, libId) {
  const o = raw || {};
  const time = _sp5eTime(Array.isArray(o.time) ? o.time[0] : null);
  const dur = _sp5eDuration(o.duration);
  const comp = o.components || {};
  const mat = _sp5eMaterial(comp.m);
  return normalizeSpell({
    libId: libId || '',
    book: [o.source, o.page ? 'p' + o.page : ''].filter(Boolean).join(' '),
    name: o.name,
    level: o.level,
    school: SPELL_SCHOOL_5E[o.school] || o.school || '',
    cast: time.cast, castText: time.castText,
    ritual: !!(o.meta && o.meta.ritual),
    conc: dur.conc,
    range: _sp5eRange(o.range),
    duration: dur.duration,
    v: !!comp.v, s: !!comp.s, m: mat.m, material: mat.material,
    entries: Array.isArray(o.entries) ? o.entries : [],
    higher: Array.isArray(o.entriesHigherLevel) ? o.entriesHigherLevel : [],
  });
}

/** Class names a library spell is on, for the library's filter ("Wizard", "Cleric"…). */
function spellClasses(raw) {
  const c = raw && raw.classes;
  const names = new Set();
  for (const x of (c && Array.isArray(c.fromClassList) ? c.fromClassList : [])) if (x && x.name) names.add(String(x.name));
  for (const x of (c && Array.isArray(c.fromClassListVariant) ? c.fromClassListVariant : [])) if (x && x.name) names.add(String(x.name));
  return [...names].sort();
}

// ── Text ──────────────────────────────────────────────────────────────────────
/**
 * One line of 5etools text as safe HTML: escaped first, then the {@tag …}
 * markers turned into plain emphasis. Nothing here can produce a link, a
 * script or an attribute.
 */
function spellInlineHTML(s) {
  const escaped = _spEsc(s);
  return escaped.replace(/\{@(\w+)\s([^}]*)\}/g, (_, tag, content) => {
    const p = content.split('|');
    switch (tag) {
      case 'b': case 'bold': return '<b>' + p[0] + '</b>';
      case 'i': case 'italic': return '<i>' + p[0] + '</i>';
      case 'damage': case 'dice': case 'd20': return '<b>' + p[0] + '</b>';
      case 'scaledamage': case 'scaledice': return '<b>' + (p[2] || p[0]) + '</b>';
      case 'hit': return (parseInt(p[0], 10) >= 0 ? '+' : '') + p[0];
      case 'dc': return 'DC ' + p[0];
      case 'spell': case 'condition': case 'creature': case 'item': case 'status': case 'sense':
      case 'skill': case 'action': case 'variantrule': case 'hazard': case 'disease': case 'feat':
        return '<em>' + (p[2] || p[0]) + '</em>';
      default: return p[2] || p[0] || content;
    }
  }).replace(/\{@\w+\}/g, '');
}

/** The same line as plain text (no markup at all) — for titles and chat meta. */
function spellInlineText(s) {
  return String(s == null ? '' : s).replace(/\{@(\w+)\s([^}]*)\}/g, (_, tag, content) => {
    const p = content.split('|');
    if (tag === 'scaledamage' || tag === 'scaledice') return p[2] || p[0];
    if (tag === 'dc') return 'DC ' + p[0];
    return p[2] && /^(spell|condition|creature|item|status|sense|skill|action|variantrule|feat)$/.test(tag) ? p[2] : p[0];
  }).replace(/\{@\w+\}/g, '');
}

/** 5etools entries (strings, lists, named sub-entries, tables) as safe HTML. */
function spellTextHTML(entries, depth) {
  const d = depth || 0;
  if (d > 6 || !Array.isArray(entries)) return '';
  return entries.map(e => {
    if (typeof e === 'string') return '<p>' + spellInlineHTML(e) + '</p>';
    if (!e || typeof e !== 'object') return '';
    if (e.type === 'list' && Array.isArray(e.items)) {
      return '<ul>' + e.items.map(i => '<li>' + (typeof i === 'string'
        ? spellInlineHTML(i)
        : (i && i.name ? '<b>' + spellInlineHTML(i.name) + '.</b> ' : '') + spellTextHTML(i && (i.entries || (i.entry ? [i.entry] : [])), d + 1)) + '</li>').join('') + '</ul>';
    }
    if (e.type === 'table' && Array.isArray(e.rows)) {
      const head = Array.isArray(e.colLabels) ? '<tr>' + e.colLabels.map(c => '<th>' + spellInlineHTML(c) + '</th>').join('') + '</tr>' : '';
      const rows = e.rows.map(r => '<tr>' + (Array.isArray(r) ? r : []).map(c =>
        '<td>' + (typeof c === 'string' || typeof c === 'number' ? spellInlineHTML(c) : spellInlineHTML(c && (c.roll ? (c.roll.exact ?? `${c.roll.min}–${c.roll.max}`) : ''))) + '</td>').join('') + '</tr>').join('');
      return '<table>' + (e.caption ? '<caption>' + spellInlineHTML(e.caption) + '</caption>' : '') + head + rows + '</table>';
    }
    if (Array.isArray(e.entries)) {
      const title = e.name ? '<b><i>' + spellInlineHTML(e.name) + '.</i></b> ' : '';
      const inner = spellTextHTML(e.entries, d + 1);
      // A named block reads as one paragraph that starts with its name.
      if (!title) return inner;
      return inner.startsWith('<p>') ? '<p>' + title + inner.slice(3) : '<p>' + title + '</p>' + inner;
    }
    if (e.entry) return spellTextHTML([e.entry], d + 1);
    return '';
  }).join('');
}

/** The spell's description and higher-level text, as safe HTML. */
function spellDescHTML(sp) {
  const s = sp || {};
  return spellTextHTML(s.entries) + spellTextHTML(s.higher);
}

// ── Labels ────────────────────────────────────────────────────────────────────
function spellLevelLabel(level) {
  const n = parseInt(level, 10) || 0;
  return n === 0 ? 'Cantrip' : `Level ${n}`;
}
function spellCastLabel(sp) {
  const s = sp || {};
  const base = (SPELL_CAST_TYPES.find(([k]) => k === s.cast) || [null, ''])[1];
  if (s.cast === 'minute' || s.cast === 'hour' || s.cast === 'other') return s.castText || base;
  return base;
}
function spellSourceLabel(src) {
  const s = src || {};
  const kind = (SPELL_SOURCE_KINDS.find(([k]) => k === s.kind) || [null, ''])[1];
  if (kind && s.detail) return `${kind}: ${s.detail}`;
  return kind || s.detail || '';
}
function spellSchoolName(code) {
  return (SPELL_SCHOOLS.find(([c]) => c === code) || [null, code || ''])[1];
}
function spellComponentsLabel(sp) {
  const s = sp || {};
  const parts = [s.v && 'V', s.s && 'S', s.m && 'M'].filter(Boolean).join(', ');
  return parts + (s.m && s.material ? ` (${s.material})` : '');
}

// ── Readiness ─────────────────────────────────────────────────────────────────
/**
 * Can this spell be cast today without changing preparation? A cantrip, a
 * spell that needs no slot, or — for a character who prepares — a prepared one.
 * `prepares` false (Warlock, Sorcerer style) makes every spell ready.
 */
function spellIsReady(sp, prepares) {
  if (!sp) return false;
  if (sp.level === 0 || sp.noSlot || sp.alwaysPrepared) return true;
  return prepares === false ? true : !!sp.prepared;
}

/**
 * Whether this character prepares spells. The sheet stores the opposite,
 * `sp-no-prep` ("knows its spells, no preparing"), so a sheet that never had
 * the box — every sheet before v320 — keeps preparing as it always did.
 */
function spellPrepares(data) {
  if (_spTruthy(data ? data['sp-no-prep'] : false)) return false;
  // Warlocks and Sorcerers know their spells: every one is always ready.
  const f = spellCasterFlags(data);
  return !(f.warlock || f.sorcerer);
}

// ── Class rules: Warlock and Sorcerer (v325) ──────────────────────────────────
// Read from the sheet's Class field, so a Warlock or Sorcerer gets them without
// switching anything on. The keys live on the sheet with the other spell data:
//   pact-slots, pact-level, pact-used     Warlock Pact Magic
//   sorc-points, sorc-used                Sorcerer sorcery points (max, spent)
//   mm-<key>                              a Metamagic option the Sorcerer knows

/** Which of the two the character is (multiclass included): { warlock, sorcerer }. */
function spellCasterFlags(data) {
  const d = data || {};
  const c = [d.class, d['class-name'], d['class-1'], d.subclass].map(v => String(v || '')).join(' ').toLowerCase();
  return { warlock: /warlock/.test(c), sorcerer: /sorcerer/.test(c) };
}

/** Pact Magic slots per Warlock level: [slots, slot level] (PHB table). */
const WARLOCK_PACT_TABLE = [null, [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];

/** The Warlock's pact slots, or null: { total, used, left, level }. */
function spellPactFrom(data) {
  if (!spellCasterFlags(data).warlock) return null;
  const total = Math.max(0, parseInt(data['pact-slots'], 10) || 0);
  const level = Math.max(0, Math.min(5, parseInt(data['pact-level'], 10) || 0));
  if (!total || !level) return null;
  const used = Math.min(total, Math.max(0, parseInt(data['pact-used'], 10) || 0));
  return { total, used, left: total - used, level };
}

/** The Sorcerer's sorcery points, or null: { max, used, left }. */
function spellSorcFrom(data) {
  if (!spellCasterFlags(data).sorcerer) return null;
  const max = Math.max(0, parseInt(data['sorc-points'], 10) || 0);
  if (!max) return null;
  const used = Math.min(max, Math.max(0, parseInt(data['sorc-used'], 10) || 0));
  return { max, used, left: max - used };
}

/** Metamagic options (2024 costs): [key, name, points]. Twinned costs 1 since 2024. */
const SPELL_METAMAGIC = [
  ['careful', 'Careful Spell', 1], ['distant', 'Distant Spell', 1], ['empowered', 'Empowered Spell', 1],
  ['extended', 'Extended Spell', 1], ['heightened', 'Heightened Spell', 2], ['quickened', 'Quickened Spell', 2],
  ['seeking', 'Seeking Spell', 1], ['subtle', 'Subtle Spell', 1], ['transmuted', 'Transmuted Spell', 1],
  ['twinned', 'Twinned Spell', 1],
];

/** Every Metamagic option, as a function so the server's vm copy can read it (a const is not). */
function spellMetamagicList() { return SPELL_METAMAGIC.map(([key, name, cost]) => ({ key, name, cost })); }

/** The Metamagic options this Sorcerer knows: [{ key, name, cost }]. */
function spellKnownMetamagic(data) {
  if (!spellCasterFlags(data).sorcerer) return [];
  return SPELL_METAMAGIC.filter(([k]) => _spTruthy(data['mm-' + k])).map(([key, name, cost]) => ({ key, name, cost }));
}

// ── Slots from level (v326) ───────────────────────────────────────────────────
// Spell slots by caster level, levels 1-9 (the full caster table). A half
// caster uses it at half its level rounded up, a third caster (Eldritch
// Knight, Arcane Trickster) at a third rounded up from level 3; multiclass
// characters add full levels, half levels rounded up and third levels rounded
// down into one caster level (2024 rules). Warlock levels give pact slots
// instead, and Sorcerer levels sorcery points (from level 2).
const FULL_CASTER_SLOTS = [null,
  [2,0,0,0,0,0,0,0,0], [3,0,0,0,0,0,0,0,0], [4,2,0,0,0,0,0,0,0], [4,3,0,0,0,0,0,0,0], [4,3,2,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0], [4,3,3,1,0,0,0,0,0], [4,3,3,2,0,0,0,0,0], [4,3,3,3,1,0,0,0,0], [4,3,3,3,2,0,0,0,0],
  [4,3,3,3,2,1,0,0,0], [4,3,3,3,2,1,0,0,0], [4,3,3,3,2,1,1,0,0], [4,3,3,3,2,1,1,0,0], [4,3,3,3,2,1,1,1,0],
  [4,3,3,3,2,1,1,1,0], [4,3,3,3,2,1,1,1,1], [4,3,3,3,3,1,1,1,1], [4,3,3,3,3,2,1,1,1], [4,3,3,3,3,2,2,1,1]];
const _SP_CASTER_KIND = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full',
  paladin: 'half', ranger: 'half', artificer: 'half', warlock: 'pact', fighter: 'third', rogue: 'third',
};

/**
 * The character's classes and their levels, from the Class field:
 * "Wizard 5 / Cleric 3" -> [{ name: 'wizard', level: 5 }, { name: 'cleric', level: 3 }].
 * A plain "Wizard" takes the sheet's Level field.
 */
function spellClassLevels(data) {
  const d = data || {};
  const text = String(d.class || '').toLowerCase();
  const out = [];
  const re = /(bard|cleric|druid|sorcerer|wizard|paladin|ranger|artificer|warlock|fighter|rogue|barbarian|monk)\D{0,3}?(\d{1,2})/g;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], level: Math.min(20, parseInt(m[2], 10)) });
  if (out.length) return out;
  const names = text.match(/bard|cleric|druid|sorcerer|wizard|paladin|ranger|artificer|warlock|fighter|rogue|barbarian|monk/g) || [];
  const lvl = Math.max(0, Math.min(20, parseInt(d.level || d['total-level'] || d['char-level'], 10) || 0));
  return names.length && lvl ? [{ name: names[0], level: lvl }] : [];
}

/**
 * What the level tables give this character:
 *   { known, slots: [9 totals], pact: { slots, level } | null, sorc: number | null }
 * `known` is false when no spellcasting class was found (nothing should change then).
 */
function spellAutoSlots(data) {
  const sub = String((data && data.subclass) || '').toLowerCase();
  const classes = spellClassLevels(data);
  let full = 0, half = 0, third = 0, casters = 0, single = null;
  let pact = null, sorc = null;
  for (const c of classes) {
    let kind = _SP_CASTER_KIND[c.name];
    // Fighters and Rogues cast only as Eldritch Knights and Arcane Tricksters.
    if (kind === 'third' && !(c.name === 'fighter' ? /eldritch knight/.test(sub) : /arcane trickster/.test(sub))) kind = null;
    if (c.name === 'sorcerer') sorc = c.level >= 2 ? c.level : 0;
    if (kind === 'pact') { const t = WARLOCK_PACT_TABLE[c.level]; pact = t ? { slots: t[0], level: t[1] } : null; continue; }
    if (!kind) continue;
    casters++; single = { kind, level: c.level };
    if (kind === 'full') full += c.level;
    else if (kind === 'half') half += c.level;
    else third += c.level;
  }
  let level = 0;
  if (casters === 1) {
    level = single.kind === 'full' ? single.level
      : single.kind === 'half' ? Math.ceil(single.level / 2)
      : (single.level >= 3 ? Math.ceil(single.level / 3) : 0);
  } else if (casters > 1) {
    level = full + Math.ceil(half / 2) + Math.floor(third / 3);
  }
  const slots = (FULL_CASTER_SLOTS[Math.min(20, level)] || [0, 0, 0, 0, 0, 0, 0, 0, 0]).slice();
  return { known: casters > 0 || !!pact || sorc !== null, slots, pact, sorc };
}

/** Font of Magic: sorcery points it costs to create a slot of each level (1-5). */
const SORC_SLOT_COST = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

/**
 * A Warlock's Mystic Arcanum: a spell of level 6-9 cast once per long rest
 * without a slot. Any Warlock spell that high counts — unless its source names
 * another class (a multiclass Wizard's 6th-level spell is not an Arcanum).
 */
function spellIsArcanum(sp, data) {
  if (!sp || sp.level < 6 || sp.noSlot || !spellCasterFlags(data).warlock) return false;
  const src = sp.source || {};
  return !(src.kind === 'class' && src.detail && !/warlock/i.test(src.detail));
}

/** The Actions-tab group a spell belongs to: 'action' | 'bonus' | 'reaction' | ''. */
function spellActionCategory(sp) {
  return sp && (sp.cast === 'action' || sp.cast === 'bonus' || sp.cast === 'reaction') ? sp.cast : '';
}

/** Prepared spells of level 1+, the number the sheet's "Prepared" box counts. */
function spellPreparedCount(list) {
  return (list || []).filter(s => s && s.level > 0 && s.prepared && !s.noSlot && !s.alwaysPrepared).length;
}

// ── Casting (release 2) ───────────────────────────────────────────────────────
// Shared by the Cast a Spell pop-up (what to grey out) and the server's
// POST /api/characters/:id/cast (what to allow), so the two cannot disagree.

/** The character's slot levels that have any slots: [{ level, total, used, left }]. */
function spellSlotsFrom(data) {
  const out = [];
  for (let l = 1; l <= 9; l++) {
    const total = Math.max(0, parseInt(data && data[`slot-${l}-total`], 10) || 0);
    if (!total) continue;
    const used = Math.min(total, Math.max(0, parseInt(data[`slot-${l}-used`], 10) || 0));
    out.push({ level: l, total, used, left: total - used });
  }
  return out;
}

/**
 * The ways this spell can be cast right now.
 *   { castable, reason, options: [{ mode, level, available, left, label }], best }
 * mode: 'cantrip' | 'free' (its own use, or at will) | 'slot' | 'ritual'.
 * A levelled spell may use a slot of its level OR HIGHER (upcasting); it
 * cannot be cast when every such level is spent. `best` is the option the
 * pop-up starts on: its own free use, else the lowest open slot, else ritual.
 */
function spellCastOptions(sp, data) {
  const out = { castable: false, reason: '', options: [], best: null, ritualOnly: false };
  if (!sp) { out.reason = 'Unknown spell'; return out; }
  if (!spellIsReady(sp, spellPrepares(data))) {
    // A ritual you have not prepared can still be cast — as a ritual, never with a slot.
    if (sp.ritual && sp.level > 0) {
      out.ritualOnly = true;
      out.options.push({ mode: 'ritual', level: sp.level, available: true, label: 'As a ritual (no slot, +10 minutes)' });
      out.castable = true;
      out.best = out.options[0];
      return out;
    }
    out.reason = 'Not prepared';
    return out;
  }
  if (sp.level === 0) {
    out.options.push({ mode: 'cantrip', level: 0, available: true, label: 'Cantrip' });
  } else if (spellIsArcanum(sp, data)) {
    // Mystic Arcanum: once per long rest, no slot; never with a pact slot (they stop at 5).
    const left = 1 - Math.min(1, sp.used);
    out.options.push({ mode: 'free', level: sp.level, available: left > 0, left,
      label: `Mystic Arcanum (${left} of 1 left)` });
    if (!left) { out.reason = 'Arcanum used — back after a long rest'; return out; }
  } else {
    if (sp.noSlot) {
      const atWill = !sp.uses;
      const left = atWill ? null : sp.uses - sp.used;
      out.options.push({ mode: 'free', level: sp.level, available: atWill || left > 0, left,
        label: atWill ? 'No slot (at will)' : `No slot (${left} of ${sp.uses} left)` });
    }
    // Pact Magic: every pact slot is the pact level, and a spell cast with one is cast at it.
    const pact = spellPactFrom(data);
    if (pact && pact.level >= sp.level) {
      out.options.push({ mode: 'pact', level: pact.level, available: pact.left > 0, left: pact.left,
        label: `Pact slot, level ${pact.level} (${pact.left} of ${pact.total} left)` });
    }
    for (const s of spellSlotsFrom(data)) {
      if (s.level < sp.level) continue;
      out.options.push({ mode: 'slot', level: s.level, available: s.left > 0, left: s.left,
        label: `Level ${s.level} slot (${s.left} of ${s.total} left)` });
    }
    if (sp.ritual) out.options.push({ mode: 'ritual', level: sp.level, available: true, label: 'As a ritual (no slot, +10 minutes)' });
  }
  const open = out.options.filter(o => o.available);
  out.castable = open.length > 0;
  out.best = open.find(o => o.mode === 'free' || o.mode === 'cantrip')
    || open.find(o => o.mode === 'pact') || open.find(o => o.mode === 'slot') || open[0] || null;
  if (!out.castable && !out.reason) {
    const anySlot = spellSlotsFrom(data).some(s => s.level >= sp.level) || out.options.some(o => o.mode === 'pact');
    out.reason = sp.noSlot && sp.uses && !anySlot ? 'No uses left' : 'No spell slots left';
  }
  return out;
}

// ── Monsters (release 3, v329) ────────────────────────────────────────────────
// A monster's spellcasting is the 5etools `spellcasting` list on its data: at
// will spells, X/day (shared, or "each"), and — in older stat blocks — slots
// per spell level. Each TOKEN keeps its own uses in `spellUses` (a JSON object
// use key -> times used), so two Mages run out separately. Empty means full.

/** "{@spell Fire Bolt|XPHB}" -> { name: 'Fire Bolt', source: 'XPHB' }. */
function _spRef(ref) {
  const s = typeof ref === 'string' ? ref : (ref && (ref.entry || ref.name)) || '';
  const m = /\{@spell ([^}|]+)(?:\|([^}|]*))?/.exec(s);
  return m ? { name: m[1].trim(), source: (m[2] || '').trim() } : { name: spellInlineText(s).replace(/\*/g, '').trim(), source: '' };
}

/**
 * A monster's spellcasting, as groups:
 *   { dc, hit, casterLevel, groups: [{ key, kind, label, max, each, level, entry, spells: [{name, source}] }] }
 * kind: 'will' | 'daily' (also per-rest / weekly) | 'cantrip' | 'slot'.
 */
/** Every string inside a 5etools entry (strings, {entries}, list items "name entry"). */
function _spEntryStrings(e, out = []) {
  if (typeof e === 'string') out.push(e);
  else if (Array.isArray(e)) e.forEach(x => _spEntryStrings(x, out));
  else if (e && typeof e === 'object') {
    if (e.name && (e.entry || e.entries) && e.type === 'item') {
      const body = []; _spEntryStrings(e.entry || e.entries, body);
      out.push(`${e.name} ${body.join(' ')}`);
    } else { _spEntryStrings(e.entries, out); _spEntryStrings(e.entry, out); _spEntryStrings(e.items, out); }
  }
  return out;
}

/** "{@spell Ray of Frost|XPHB} (3d8), Mage Hand" -> ['{@spell Ray of Frost|XPHB}', 'Mage Hand']. */
function _spListRefs(text) {
  const tags = text.match(/\{@spell [^}]+\}/g);
  if (tags) return tags;
  return text.replace(/\([^)]*\)/g, '').replace(/\*/g, '').split(/,|;|\band\b/)
    .map(x => x.trim().replace(/\.$/, '')).filter(x => x && x.length < 60);
}

/**
 * A stat block whose spellcasting is only TEXT (an action or trait named
 * "Spellcasting" / "Innate Spellcasting" — the 2024 layout, hand-made monsters,
 * and any monster saved by the monster editor) -> the 5etools `spellcasting`
 * shape. Lines it reads: "At will: …", "N/day (each): …", "N/rest", "N/week",
 * "Cantrips (at will): …", "3rd level (2 slots): …". The rest is the header
 * (DC, to hit, caster level).
 */
function monsterSpellcastingFromText(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  for (const sec of ['trait', 'action', 'bonus', 'reaction', 'legendary']) {
    for (const e of (Array.isArray(data[sec]) ? data[sec] : [])) {
      if (!e || !/spellcasting/i.test(String(e.name || ''))) continue;
      const sc = { name: e.name, headerEntries: [], displayAs: sec };
      // Each list starts at its label, wherever the line breaks fall.
      const text = _spEntryStrings(e.entries || e.entry).join('\n');
      const LABEL = /(at will|cantrips(?:\s*\(at will\))?|\d+\s*\/\s*(?:day|long rest|short rest|rest|week)(?:\s+each)?|\d+(?:st|nd|rd|th)[\s-]level(?:\s*\(\s*\d+\s*slots?\s*\))?)\s*:/gi;
      const marks = [];
      let m;
      while ((m = LABEL.exec(text))) marks.push({ at: m.index, end: LABEL.lastIndex, label: m[1].toLowerCase() });
      if (!marks.length) continue;
      sc.headerEntries.push(text.slice(0, marks[0].at).trim());
      let any = false;
      marks.forEach((mk, i) => {
        const body = text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : text.length).split(/\n\s*\n/)[0];
        const refs = _spListRefs(body);
        if (!refs.length) return;
        any = true;
        const lab = mk.label;
        let x;
        if (lab === 'at will') (sc.will = sc.will || []).push(...refs);
        else if (lab.startsWith('cantrip')) ((sc.spells = sc.spells || {})[0] = { spells: refs });
        else if ((x = /^(\d+)\s*\/\s*(day|long rest|short rest|rest|week)(\s+each)?/.exec(lab))) {
          const period = x[2] === 'day' ? 'daily' : x[2] === 'week' ? 'weekly' : 'rest';
          const key = x[1] + (x[3] ? 'e' : '');
          const by = (sc[period] = sc[period] || {});
          (by[key] = by[key] || []).push(...refs);
        } else if ((x = /^(\d+)(?:st|nd|rd|th)[\s-]level(?:\s*\(\s*(\d+)\s*slots?)?/.exec(lab))) {
          (sc.spells = sc.spells || {})[x[1]] = { slots: parseInt(x[2], 10) || 0, spells: refs };
        }
      });
      if (any) out.push(sc);
    }
  }
  return out;
}

function monsterSpellcasting(data) {
  const out = { dc: '', hit: '', casterLevel: 0, groups: [] };
  const list = Array.isArray(data && data.spellcasting) && data.spellcasting.length
    ? data.spellcasting : monsterSpellcastingFromText(data);
  list.forEach((sc, i) => {
    if (!sc || typeof sc !== 'object') return;
    const head = JSON.stringify(sc.headerEntries || []);
    const dc = /\{@dc (\d+)/.exec(head) || /\bDC\s*(\d+)/i.exec(head); if (dc && !out.dc) out.dc = dc[1];
    const hit = /\{@hit ([+-]?\d+)/.exec(head) || /([+-]\d+) to hit/i.exec(head); if (hit && !out.hit) out.hit = (parseInt(hit[1], 10) >= 0 ? '+' : '') + parseInt(hit[1], 10);
    const lvl = /(\d+)(?:st|nd|rd|th)-level spellcaster/.exec(head); if (lvl && !out.casterLevel) out.casterLevel = parseInt(lvl[1], 10);
    const refs = arr => (Array.isArray(arr) ? arr : []).map(_spRef).filter(r => r.name);
    if (Array.isArray(sc.will) && sc.will.length) out.groups.push({ key: `${i}:will`, kind: 'will', label: 'At will', max: null, each: false, level: 0, entry: i, spells: refs(sc.will) });
    for (const [period, word] of [['daily', 'day'], ['rest', 'rest'], ['weekly', 'week']]) {
      const by = sc[period];
      if (!by || typeof by !== 'object') continue;
      // Larger counts first, as stat blocks list them (JS would put a bare "1" key first).
      for (const [k, arr] of Object.entries(by).sort((x, y) => (parseInt(y[0], 10) || 1) - (parseInt(x[0], 10) || 1))) {
        const n = parseInt(k, 10) || 1;
        const each = /e$/.test(k);
        out.groups.push({ key: `${i}:${period}:${k}`, kind: 'daily', label: `${n}/${word}${each ? ' each' : ''}`, max: n, each, level: 0, entry: i, spells: refs(arr) });
      }
    }
    if (sc.spells && typeof sc.spells === 'object') {
      for (const [l, sd] of Object.entries(sc.spells)) {
        const level = parseInt(l, 10) || 0;
        if (!sd) continue;
        if (level === 0) out.groups.push({ key: `${i}:s0`, kind: 'cantrip', label: 'Cantrips', max: null, each: false, level: 0, entry: i, spells: refs(sd.spells) });
        else out.groups.push({ key: `${i}:s${level}`, kind: 'slot', label: `Level ${level}`, max: parseInt(sd.slots, 10) || 0, each: false, level, entry: i, spells: refs(sd.spells) });
      }
    }
  });
  return out;
}

/** A token's spellUses value (JSON string or object) as an object. */
function parseSpellUses(v) {
  let o = v;
  if (typeof v === 'string') { try { o = JSON.parse(v || '{}'); } catch { o = {}; } }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}

/**
 * Every spell a monster can cast, ready for the Cast a Spell pop-up:
 *   [{ s: spell object (id = "<group key>|<name>"), group, lib, how: { castable, reason, options, best } }]
 * findLib(name, source) returns the library's { id, data } or null; a spell
 * not in the library still casts, with its name only. Options carry `useKey`,
 * the key in spellUses that the cast spends.
 */
function monsterSpellRows(data, usesValue, findLib) {
  const sc = monsterSpellcasting(data);
  const uses = parseSpellUses(usesValue);
  const used = k => Math.max(0, parseInt(uses[k], 10) || 0);
  const slotGroups = sc.groups.filter(g => g.kind === 'slot');
  const rows = [];
  for (const g of sc.groups) {
    for (const ref of g.spells) {
      const lib = typeof findLib === 'function' ? findLib(ref.name, ref.source) : null;
      const s = lib && lib.data ? spellFrom5e(lib.data, lib.id) : normalizeSpell({ name: ref.name, level: g.level });
      if (g.kind === 'slot' || g.kind === 'cantrip') s.level = g.level;
      s.id = `${g.key}|${ref.name}`;
      s.prepared = true;
      const options = [];
      if (g.kind === 'will') options.push({ mode: 'will', level: s.level, available: true, useKey: '', label: 'At will' });
      else if (g.kind === 'cantrip') options.push({ mode: 'cantrip', level: 0, available: true, useKey: '', label: 'Cantrip' });
      else if (g.kind === 'daily') {
        const useKey = g.each ? `${g.key}|${ref.name.toLowerCase()}` : g.key;
        const left = Math.max(0, g.max - used(useKey));
        options.push({ mode: 'daily', level: s.level, available: left > 0, left, useKey, label: `${g.label} (${left} of ${g.max} left)` });
      } else {
        // A slotted spell may use a slot of its level or higher, from the same stat block entry.
        for (const sg of slotGroups) {
          if (sg.entry !== g.entry || sg.level < g.level || !sg.max) continue;
          const left = Math.max(0, sg.max - used(sg.key));
          options.push({ mode: 'slot', level: sg.level, available: left > 0, left, useKey: sg.key, label: `Level ${sg.level} slot (${left} of ${sg.max} left)` });
        }
      }
      const open = options.filter(o => o.available);
      rows.push({ s, group: g, lib: lib || null, how: {
        castable: open.length > 0,
        reason: open.length ? '' : (g.kind === 'daily' ? 'No uses left' : 'No spell slots left'),
        options, best: open[0] || null, ritualOnly: false,
      } });
    }
  }
  return rows;
}

/** How many uses a monster token has spent, for its panel: [{ label, left, max }]. */
function monsterSpellUsage(data, usesValue) {
  const sc = monsterSpellcasting(data);
  const uses = parseSpellUses(usesValue);
  const out = [];
  for (const g of sc.groups) {
    if (g.kind === 'slot' && g.max) out.push({ label: `Level ${g.level} slots`, left: Math.max(0, g.max - (parseInt(uses[g.key], 10) || 0)), max: g.max });
    if (g.kind === 'daily') {
      if (g.each) for (const r of g.spells) out.push({ label: `${r.name} (${g.label})`, left: Math.max(0, g.max - (parseInt(uses[`${g.key}|${r.name.toLowerCase()}`], 10) || 0)), max: g.max });
      else out.push({ label: `${g.spells.map(r => r.name).join(', ')} (${g.label})`, left: Math.max(0, g.max - (parseInt(uses[g.key], 10) || 0)), max: g.max });
    }
  }
  return out;
}

/** "8d6" + "1d6" x2 -> "10d6"; anything that does not combine is added on. */
function _spAddDice(base, step, times) {
  if (!times || !step) return base;
  const m = /^(\d+)d(\d+)$/.exec(String(step).replace(/\s/g, ''));
  const b = /^(\d+)d(\d+)(.*)$/.exec(String(base).replace(/\s/g, ''));
  if (m && b && m[2] === b[2]) return `${parseInt(b[1], 10) + parseInt(m[1], 10) * times}d${b[2]}${b[3]}`;
  if (m) return `${base}+${parseInt(m[1], 10) * times}d${m[2]}`;
  return base;
}

const _SP_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/**
 * What a cast spell does, for the chat card's buttons:
 *   { attack: 'ranged'|'melee'|null, save: 'Dexterity'|null,
 *     damage: '10d6'|null, damageType: 'fire'|'', healing: bool }
 * `raw` is the library's 5etools object when the spell is linked (it names
 * the attack, save and damage type exactly); without it the spell's own text
 * is read. Damage scales with the slot (5etools {@scaledamage}) and, for a
 * cantrip, with the character's level (scalingLevelDice).
 */
function spellCastInfo(sp, raw, castLevel, charLevel) {
  const s = sp || {};
  const r = raw || {};
  const text = JSON.stringify(s.entries || []) + ' ' + String(s.notes || '');
  const higher = JSON.stringify(s.higher || []);
  const out = { attack: null, save: null, damage: null, damageType: '', healing: false };

  const atk = Array.isArray(r.spellAttack) ? r.spellAttack[0] : null;
  if (atk === 'R' || /ranged spell attack/i.test(text)) out.attack = 'ranged';
  else if (atk === 'M' || /melee spell attack/i.test(text)) out.attack = 'melee';

  const sv = Array.isArray(r.savingThrow) ? String(r.savingThrow[0] || '') : '';
  const svText = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(text);
  const save = sv || (svText ? svText[1] : '');
  if (save && _SP_ABILITIES.includes(save.toLowerCase())) out.save = save.charAt(0).toUpperCase() + save.slice(1).toLowerCase();

  let m = /\{@damage ([^}|]+)/.exec(text);
  const heals = (Array.isArray(r.miscTags) && r.miscTags.includes('HL')) || /regains? (?:a number of )?hit points/i.test(text);
  if (!m && heals) { m = /\{@dice ([^}|]+)/.exec(text); out.healing = !!m; }
  if (!m && !s.entries?.length) m = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/.exec(String(s.notes || ''));   // a typed spell's notes
  if (m) out.damage = m[1].replace(/\s+/g, '');

  // A cantrip grows with the character's level.
  if (s.level === 0 && r.scalingLevelDice) {
    const sc = Array.isArray(r.scalingLevelDice) ? r.scalingLevelDice[0] : r.scalingLevelDice;
    const table = sc && sc.scaling ? sc.scaling : null;
    if (table) {
      const lv = Math.max(1, parseInt(charLevel, 10) || 1);
      let best = null;
      for (const k of Object.keys(table).map(Number).sort((a, b) => a - b)) if (k <= lv) best = table[k];
      if (best) out.damage = String(best).replace(/\s+/g, '');
    }
  }

  // A levelled spell cast with a higher slot: {@scaledamage base|from-to|step}.
  const sd = /\{@scale(?:damage|dice) ([^}|]+)\|(\d+)(?:-\d+)?\|([^}|]+)/.exec(higher);
  if (out.damage && sd && castLevel > (parseInt(sd[2], 10) || s.level)) {
    out.damage = _spAddDice(out.damage, sd[3].trim(), castLevel - (parseInt(sd[2], 10) || s.level));
  }

  const types = Array.isArray(r.damageInflict) ? r.damageInflict : [];
  const dt = /\{@damage [^}]+\}\s+([A-Za-z]+) damage/.exec(text);
  out.damageType = out.healing ? 'healing' : (types.length ? types.join('/') : (dt ? dt[1].toLowerCase() : ''));
  return out;
}
