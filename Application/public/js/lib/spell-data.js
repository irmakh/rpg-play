// Written by Irmak Hakman — 2026-11-11 18:30
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
    uses,
    used: Math.min(_spInt(o.used, 0, 99, 0), uses),
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
  if (sp.level === 0 || sp.noSlot) return true;
  return prepares === false ? true : !!sp.prepared;
}

/**
 * Whether this character prepares spells. The sheet stores the opposite,
 * `sp-no-prep` ("knows its spells, no preparing"), so a sheet that never had
 * the box — every sheet before v320 — keeps preparing as it always did.
 */
function spellPrepares(data) {
  return !_spTruthy(data ? data['sp-no-prep'] : false);
}

/** The Actions-tab group a spell belongs to: 'action' | 'bonus' | 'reaction' | ''. */
function spellActionCategory(sp) {
  return sp && (sp.cast === 'action' || sp.cast === 'bonus' || sp.cast === 'reaction') ? sp.cast : '';
}

/** Prepared spells of level 1+, the number the sheet's "Prepared" box counts. */
function spellPreparedCount(list) {
  return (list || []).filter(s => s && s.level > 0 && s.prepared && !s.noSlot).length;
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
  const out = { castable: false, reason: '', options: [], best: null };
  if (!sp) { out.reason = 'Unknown spell'; return out; }
  if (!spellIsReady(sp, spellPrepares(data))) { out.reason = 'Not prepared'; return out; }
  if (sp.level === 0) {
    out.options.push({ mode: 'cantrip', level: 0, available: true, label: 'Cantrip' });
  } else {
    if (sp.noSlot) {
      const atWill = !sp.uses;
      const left = atWill ? null : sp.uses - sp.used;
      out.options.push({ mode: 'free', level: sp.level, available: atWill || left > 0, left,
        label: atWill ? 'No slot (at will)' : `No slot (${left} of ${sp.uses} left)` });
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
    || open.find(o => o.mode === 'slot') || open[0] || null;
  if (!out.castable) out.reason = sp.noSlot && sp.uses && !spellSlotsFrom(data).some(s => s.level >= sp.level)
    ? 'No uses left' : 'No spell slots left';
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
