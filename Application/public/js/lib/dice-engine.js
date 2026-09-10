// ── Shared dice math ──────────────────────────────────────────────────────────
function parseDice(expr) {
  if (!expr) return null;
  const cleaned = String(expr).trim().replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)((?:[+\-]\d+)*)/);
  if (!m) {
    const flat = parseInt(cleaned);
    if (!isNaN(flat)) return { total: flat, detail: String(flat) };
    return null;
  }
  const num = parseInt(m[1]), die = parseInt(m[2]);
  let mod = 0;
  (m[3] || '').match(/[+\-]\d+/g)?.forEach(s => { mod += parseInt(s); });
  const rolls = Array.from({ length: num }, () => Math.ceil(Math.random() * die));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  let detail = `${num}d${die}(${rolls.join(',')})`;
  if (mod !== 0) detail += (mod > 0 ? '+' : '') + mod;
  return { total, detail, rolls, die, num, mod, diceExpr: `${num}d${die}` };
}

// ── Typed damage ──────────────────────────────────────────────────────────────
// A damage expression is a comma-separated list of parts, each "<dice> <type>":
//   "1d6 piercing, 2d8 fire"   "1d8+3 slashing"   "2d6"   "1d4 fire, 5 cold"
// A part with no type is GENERIC — the roll still tracks it as its own part so
// the breakdown lines up with the typed ones.
//
// Split in two on purpose: parseDamageSpec() is pure (safe to unit-test and to
// call from parseDiceCommand, which has always been pure), rollDamageSpec()
// does the randomness.
const DMG_GENERIC = 'generic';

// Recognised 5e types, used only to tidy capitalisation on display. An
// unrecognised word is still accepted and shown as typed — the field is free text.
const DMG_TYPES = ['acid','bludgeoning','cold','fire','force','lightning','necrotic',
                   'piercing','poison','psychic','radiant','slashing','thunder','healing'];

function _dmgCleanType(raw) {
  let t = String(raw || '').trim().replace(/\s+/g, ' ');
  // "fire damage" and a bare "damage" are noise from stat-block prose — drop the word.
  t = t.replace(/\s*\bdamage\b\s*$/i, '').trim();
  if (!t) return DMG_GENERIC;
  const lower = t.toLowerCase();
  return DMG_TYPES.includes(lower) ? lower : lower.slice(0, 24);
}

// One part: "1d8+3 slashing" | "2d6" | "5 cold" | "+2 fire"
function _dmgParsePart(seg) {
  const s = String(seg || '').trim();
  if (!s) return null;
  const dice = s.match(/^(\d*)\s*[dD]\s*(\d+)((?:\s*[+-]\s*\d+)*)\s*(.*)$/);
  if (dice) {
    const count = Math.max(1, Math.min(100, parseInt(dice[1] || '1')));
    const sides = parseInt(dice[2]);
    if (!sides) return null;
    let modifier = 0;
    (dice[3] || '').replace(/\s+/g, '').match(/[+-]\d+/g)?.forEach(x => { modifier += parseInt(x); });
    return { count, sides, modifier, flat: 0, type: _dmgCleanType(dice[4]) };
  }
  const flat = s.match(/^([+-]?\d+)\s*(.*)$/);
  if (flat) return { count: 0, sides: 0, modifier: 0, flat: parseInt(flat[1]), type: _dmgCleanType(flat[2]) };
  return null;
}

// Pure. Returns null when any part of the string is not rollable.
function parseDamageSpec(expr) {
  if (expr == null) return null;
  const segs = String(expr).split(',').map(s => s.trim()).filter(Boolean);
  if (!segs.length) return null;
  const parts = [];
  for (const seg of segs) {
    const p = _dmgParsePart(seg);
    if (!p) return null;   // one bad part invalidates the whole expression
    parts.push(p);
  }
  return {
    parts,
    multi: parts.length > 1,
    typed: parts.some(p => p.type !== DMG_GENERIC)
  };
}

// Rolls a parsed spec. Shape mirrors parseDice() (total/detail) and adds the
// per-type breakdown plus `groups`, which is what showDiceGroups() renders.
function rollDamageSpec(spec) {
  if (!spec || !spec.parts || !spec.parts.length) return null;
  const parts = spec.parts.map(p => {
    if (!p.sides) {
      return { ...p, rolls: [], total: p.flat, detail: String(p.flat), dice: String(p.flat) };
    }
    const rolls = Array.from({ length: p.count }, () => Math.ceil(Math.random() * p.sides));
    const total = rolls.reduce((a, b) => a + b, 0) + p.modifier;
    let detail = `${p.count}d${p.sides}(${rolls.join(',')})`;
    if (p.modifier !== 0) detail += (p.modifier > 0 ? '+' : '') + p.modifier;
    const dice = `${p.count}d${p.sides}` + (p.modifier ? (p.modifier > 0 ? '+' : '') + p.modifier : '');
    return { ...p, rolls, total, detail, dice };
  });
  const total = parts.reduce((a, p) => a + p.total, 0);
  return {
    parts,
    total,
    multi: spec.multi,
    typed: spec.typed,
    detail:  parts.map(p => p.type === DMG_GENERIC ? p.detail : `${p.detail} ${p.type}`).join(' · '),
    summary: parts.map(p => p.type === DMG_GENERIC ? String(p.total) : `${p.total} ${p.type}`).join(' · '),
    groups:  parts.map(p => ({ sides: p.sides, results: p.rolls, modifier: p.modifier,
                               total: p.total, type: p.type, dice: p.dice })),
  };
}

// Parse + roll in one step — the form the weapon and monster damage buttons use.
function parseDamage(expr) {
  const spec = parseDamageSpec(expr);
  return spec ? rollDamageSpec(spec) : null;
}

// The per-part breakdown carried on a chat entry. Kept small on purpose — the
// chat store whitelists fields and this rides alongside the legacy dice/results,
// so an old client still shows a sensible total.
function _dmgChatParts(dmg) {
  return dmg.parts.map(p => ({
    dice: p.dice, type: p.type, results: p.rolls, modifier: p.modifier, total: p.total
  }));
}

// Fields every damage-roll chat post shares. `first` keeps the legacy
// dice/results/modifier contract; `parts` is only attached when it adds something.
function dmgChatPayload(dmg, label, extra = {}) {
  const first = dmg.parts[0];
  return {
    dice: first.dice || String(dmg.total),
    results: first.rolls.length ? first.rolls : [first.total],
    modifier: first.modifier || 0,
    total: dmg.total,
    label,
    ...(dmg.multi || dmg.typed ? { parts: _dmgChatParts(dmg) } : {}),
    ...extra
  };
}

// Every part of a damage list starts with a dice or flat expression. A label
// never does, which is what lets /r stay backwards compatible below.
function _dmgLooksLikePart(s) {
  return /^\d*\s*[dD]\s*\d+/.test(s) || /^[+-]?\d+(\s|$)/.test(s);
}

/**
 * Chat commands. Returns null when `text` is not a roll command.
 *
 * Damage-typed forms carry a `damage` spec (from parseDamageSpec) alongside the
 * legacy `count`/`sides`/`modifier`/`label` fields, which are filled from the
 * FIRST part so existing callers that destructure them keep working:
 *
 *   /dmg 1d6 piercing, 2d8 fire   always typed, single or multi part
 *   /r 1d6 piercing, 2d8 fire     typed — 2+ comma-separated parts is unambiguous
 *   /r 2d6 Sneak Attack           UNCHANGED: trailing words are still a label
 */
function parseDiceCommand(text) {
  const t = String(text == null ? '' : text).trim();

  // /dmg | /damage — always a typed damage roll.
  const dm = t.match(/^\/(?:dmg|damage)\s+(.+)$/i);
  if (dm) {
    const spec = parseDamageSpec(dm[1]);
    if (!spec) return null;
    const first = spec.parts[0];
    return {
      count: first.count || 1, sides: first.sides, modifier: first.modifier,
      label: null, damage: spec, expr: dm[1].trim()
    };
  }

  // /r with 2+ comma-separated parts that each open with a dice expression.
  const rm = t.match(/^\/r(?:oll)?\s+(.+)$/i);
  if (rm && rm[1].includes(',')) {
    const segs = rm[1].split(',').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2 && segs.every(_dmgLooksLikePart)) {
      const spec = parseDamageSpec(rm[1]);
      if (spec) {
        const first = spec.parts[0];
        return {
          count: first.count || 1, sides: first.sides, modifier: first.modifier,
          label: null, damage: spec, expr: rm[1].trim()
        };
      }
    }
  }

  const m = t.match(/^\/r(?:oll)?\s+(\d+)?d(\d+)\s*([+-]\d+)?\s*(.*)?$/i);
  if (!m) return null;
  return {
    count: Math.max(1, Math.min(20, parseInt(m[1] || '1'))),
    sides: parseInt(m[2]),
    modifier: parseInt(m[3] || '0'),
    label: (m[4] || '').trim() || null
  };
}

function advClose() {
  document.getElementById('adv-modal').style.display = 'none';
  rollPending = null;
}

// ── 3D Dice Animation ─────────────────────────────────────────────────────────
const DICE_POLY_POINTS = {
  4:   '50,8 93,83 7,83',
  8:   '50,5 90,50 50,95 10,50',
  10:  '50,5 90,30 80,85 20,85 10,30',
  12:  '50,6 81,19 94,50 81,81 50,94 19,81 6,50 19,19',
  20:  '50,5 90,27 90,73 50,95 10,73 10,27',
  100: '50,6 76,14 92,36 92,64 76,86 50,94 24,86 8,64 8,36 24,14',
};
const DICE_TEXT_Y = { 4: 62, 8: 52, 10: 55, 12: 52, 20: 52, 100: 52 };

let _diceResolveFn = null;
let _diceAutoClose = null;
let _polyIntervals = [];
const MAX_DICE_SHOW = 8;

// 3D CSS d20 (icosahedron) — adapted from the "3d d20 die with pure CSS" CodePen
// by Vicente Mundim. 20 triangular <figure> faces numbered 1–20 via a CSS counter;
// the die tumbles with the `d20-roll` keyframe, then lands by setting data-face=N
// (the matching face rotates to the front). Built at a fixed 200px coordinate
// system and scaled down to fit the engine's requested size.
function _makeD20El(value, size, dur) {
  const k = size / 200;
  const scene = document.createElement('div');
  scene.style.cssText = `position:relative;width:${size}px;height:${size}px;flex-shrink:0`;
  const stage = document.createElement('div');
  stage.className = 'd20-stage';
  stage.style.cssText = `position:absolute;top:0;left:0;width:200px;height:200px;transform:scale(${k});transform-origin:top left`;
  const die = document.createElement('div');
  die.className = 'd20-die';
  die.style.setProperty('--roll-dur', `${dur}ms`);
  for (let i = 0; i < 20; i++) {
    const f = document.createElement('figure');
    f.className = 'd20-face';
    die.appendChild(f);
  }
  stage.appendChild(die);
  scene.appendChild(stage);
  return {
    container: scene,
    animEl: die,
    textEl: null,
    isCube: false,
    reveal: (val) => { die.classList.remove('rolling'); die.setAttribute('data-face', String(val)); }
  };
}

// 3D CSS d10 (pentagonal trapezohedron) — adapted from the matching CodePen by
// Vicente Mundim. 10 kite faces numbered 0–9 via a CSS counter. Our engine rolls
// d10 values 1–10, so it lands on face = value % 10 (a rolled 10 shows "0", the
// real-world d10 convention; the result readout still shows 10).
function _makeD10El(value, size, dur) {
  const k = size / 200;
  const scene = document.createElement('div');
  scene.style.cssText = `position:relative;width:${size}px;height:${size}px;flex-shrink:0`;
  const stage = document.createElement('div');
  stage.className = 'd10-stage';
  stage.style.cssText = `position:absolute;top:0;left:0;width:200px;height:200px;transform:scale(${k});transform-origin:top left`;
  const die = document.createElement('div');
  die.className = 'd10-die';
  die.style.setProperty('--roll-dur', `${dur}ms`);
  for (let i = 0; i < 10; i++) {
    const f = document.createElement('figure');
    f.className = 'd10-face';
    die.appendChild(f);
  }
  stage.appendChild(die);
  scene.appendChild(stage);
  return {
    container: scene,
    animEl: die,
    textEl: null,
    isCube: false,
    reveal: (val) => { die.classList.remove('rolling'); die.setAttribute('data-face', String(val % 10)); }
  };
}

function _makeDieEl(sides, value, size, dur) {
  if (sides === 20) return _makeD20El(value, size, dur);
  if (sides === 10) return _makeD10El(value, size, dur);
  const isD6 = sides === 6;
  if (isD6) {
    const tz = size / 2;
    const faceTransforms = [
      `translateZ(${tz}px)`, `rotateY(180deg) translateZ(${tz}px)`,
      `rotateY(90deg) translateZ(${tz}px)`, `rotateY(-90deg) translateZ(${tz}px)`,
      `rotateX(90deg) translateZ(${tz}px)`, `rotateX(-90deg) translateZ(${tz}px)`,
    ];
    const faceVals = [value, ...Array.from({length:5}, () => Math.ceil(Math.random() * 6))];
    const fs = Math.round(size * 0.25);
    const br = Math.round(size * 0.12);
    const scene = document.createElement('div');
    scene.style.cssText = `perspective:700px;width:${size}px;height:${size}px;flex-shrink:0`;
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    cube.style.cssText = `width:${size}px;height:${size}px`;
    cube.style.setProperty('--roll-dur', `${dur}ms`);
    faceTransforms.forEach((t, i) => {
      const face = document.createElement('div');
      face.className = 'dice-face';
      face.style.cssText = `width:${size}px;height:${size}px;transform:${t};font-size:${fs}px;border-radius:${br}px`;
      face.textContent = faceVals[i];
      cube.appendChild(face);
    });
    scene.appendChild(cube);
    return { container: scene, animEl: cube, textEl: cube.children[0], isCube: true };
  } else {
    const pts = DICE_POLY_POINTS[sides] || DICE_POLY_POINTS[20];
    const ty  = DICE_TEXT_Y[sides] || 52;
    const fid = `dg${Math.random().toString(36).slice(2,7)}`;
    const rnd = Math.ceil(Math.random() * sides);
    const wrap  = document.createElement('div');
    wrap.style.cssText = `perspective:700px;flex-shrink:0`;
    const inner = document.createElement('div');
    inner.className = 'dice-poly-inner';
    inner.style.setProperty('--roll-dur', `${dur}ms`);
    inner.innerHTML =
      `<svg width="${size}" height="${size}" viewBox="-5 -5 110 110">` +
      `<defs><filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feGaussianBlur stdDeviation="3" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
      `<polygon points="${pts}" fill="var(--slate-hi)" stroke="var(--rule-hi)" stroke-width="2.5" filter="url(#${fid})"/>` +
      `<text x="50" y="${ty}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-size="26" font-weight="bold" fill="var(--bone)" font-family="var(--ui)">${rnd}</text></svg>`;
    wrap.appendChild(inner);
    return { container: wrap, animEl: inner, textEl: inner.querySelector('text'), isCube: false };
  }
}

function showDiceAnimation(sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
  // Dice animation toggle (table screen): when off, skip the visual entirely
  if (typeof window !== 'undefined' && window.diceAnimEnabled === false) return Promise.resolve();
  const arr = Array.isArray(dieResults) ? dieResults : [dieResults];
  return new Promise(resolve => {
    if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
    _polyIntervals.forEach(clearInterval); _polyIntervals = [];
    if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
    _diceResolveFn = resolve;
    const dur   = duration ?? (1000 + Math.random() * 2000);
    const shown = Math.min(arr.length, MAX_DICE_SHOW);
    const size  = shown === 1 ? 120 : shown === 2 ? 100 : shown <= 4 ? 80 : 60;
    const diceLabel = arr.length > 1 ? `${arr.length}d${sides}` : `d${sides}`;
    document.getElementById('dice-type-lbl').textContent = diceLabel;
    const bigEl = document.getElementById('dice-result-big');
    const subEl = document.getElementById('dice-result-sub');
    bigEl.textContent = total;
    bigEl.className   = 'dice-result-big';
    const usedVal = usedIdx >= 0 ? arr[usedIdx] : arr[0];
    if (sides === 20 && usedVal === 20) bigEl.classList.add('nat20');
    else if (sides === 20 && usedVal === 1) bigEl.classList.add('nat1');
    subEl.className = 'dice-result-sub';
    let sub = label || diceLabel;
    if (modifier !== 0) sub += (modifier > 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`) + ` = ${total}`;
    subEl.textContent = sub;
    const row = document.getElementById('dice-row');
    row.innerHTML = '';
    row.classList.remove('dice-row-grouped');
    const reveals = [];
    for (let i = 0; i < shown; i++) {
      const { container, animEl, textEl, isCube, reveal } = _makeDieEl(sides, arr[i], size, dur);
      row.appendChild(container);
      void animEl.offsetWidth;
      animEl.classList.add('rolling');
      const isDimmed = shown > 1 && usedIdx >= 0 && i !== usedIdx;
      reveals.push({ textEl, val: arr[i], isCube, container, isDimmed, reveal });
      // Polygon dice show the rolling value via a cycling number; dice that supply
      // their own reveal() (the 3D d20) render the result by rotating a face instead.
      if (!isCube && !reveal) {
        const el = textEl;
        const id = setInterval(() => { el.textContent = Math.ceil(Math.random() * sides); }, 100);
        _polyIntervals.push(id);
      }
    }
    document.getElementById('dice-overlay').classList.add('active');
    setTimeout(() => {
      _polyIntervals.forEach(clearInterval); _polyIntervals = [];
      reveals.forEach(({ textEl, val, container, isDimmed, reveal }) => {
        if (reveal) reveal(val);
        else textEl.textContent = val;
        if (isDimmed) container.style.cssText += ';opacity:0.35;filter:blur(1.5px);transition:opacity .4s,filter .4s';
      });
      bigEl.classList.add('show');
      subEl.classList.add('show');
      if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
      _diceAutoClose = setTimeout(dismissDiceOverlay, 2500);
    }, dur);
  });
}

/**
 * Multi-type damage overlay: every damage part rolls in ONE overlay, each group
 * captioned with its type and its own subtotal, with the grand total underneath.
 *
 * `groups` is what rollDamageSpec() puts in .groups —
 *   [{ sides, results[], modifier, total, type, dice }]
 * A group with sides 0 is a flat part (e.g. "5 cold") and renders as a plain chip.
 */
function showDiceGroups(groups, total, label, duration) {
  if (typeof window !== 'undefined' && window.diceAnimEnabled === false) return Promise.resolve();
  const list = (groups || []).filter(Boolean);
  if (!list.length) return Promise.resolve();
  return new Promise(resolve => {
    if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
    _polyIntervals.forEach(clearInterval); _polyIntervals = [];
    if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
    _diceResolveFn = resolve;
    const dur = duration ?? (1000 + Math.random() * 2000);

    // One shared die-size budget across all groups so a 5-part roll stays on screen.
    const totalDice = list.reduce((n, g) => n + ((g.results || []).length || 1), 0);
    const size = totalDice <= 2 ? 90 : totalDice <= 4 ? 72 : totalDice <= 6 ? 60 : 48;

    document.getElementById('dice-type-lbl').textContent =
      list.map(g => g.dice || String(g.total)).join(' + ');
    const bigEl = document.getElementById('dice-result-big');
    const subEl = document.getElementById('dice-result-sub');
    bigEl.textContent = total;
    bigEl.className = 'dice-result-big';
    subEl.className = 'dice-result-sub';
    subEl.textContent = label || '';

    const row = document.getElementById('dice-row');
    row.innerHTML = '';
    row.classList.add('dice-row-grouped');
    const reveals = [];
    let budget = MAX_DICE_SHOW;

    list.forEach(g => {
      const wrap = document.createElement('div');
      wrap.className = 'dice-group';
      const diceWrap = document.createElement('div');
      diceWrap.className = 'dice-group-dice';
      const results = g.results || [];

      if (!g.sides || !results.length) {
        // Flat damage — nothing to tumble, show the value as a chip.
        const chip = document.createElement('div');
        chip.className = 'dice-flat-chip';
        chip.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px`;
        chip.textContent = g.total;
        diceWrap.appendChild(chip);
      } else {
        const shown = Math.max(1, Math.min(results.length, budget));
        budget = Math.max(0, budget - shown);
        for (let i = 0; i < shown; i++) {
          const { container, animEl, textEl, isCube, reveal } = _makeDieEl(g.sides, results[i], size, dur);
          diceWrap.appendChild(container);
          void animEl.offsetWidth;
          animEl.classList.add('rolling');
          reveals.push({ textEl, val: results[i], reveal });
          if (!isCube && !reveal) {
            const el = textEl, sides = g.sides;
            const id = setInterval(() => { el.textContent = Math.ceil(Math.random() * sides); }, 100);
            _polyIntervals.push(id);
          }
        }
        if (results.length > shown) {
          const more = document.createElement('div');
          more.className = 'dice-group-more';
          more.textContent = `+${results.length - shown}`;
          diceWrap.appendChild(more);
        }
      }

      wrap.appendChild(diceWrap);
      // An untyped part gets no caption — a lone "1d8" roll then looks exactly
      // as it did before typed damage existed, rather than saying GENERIC.
      if (g.type && g.type !== DMG_GENERIC) {
        const cap = document.createElement('div');
        cap.className = 'dice-group-cap';
        cap.textContent = g.type;
        wrap.appendChild(cap);
      }
      // With one part the subtotal IS the grand total shown below — don't say it twice.
      if (list.length > 1) {
        const sub = document.createElement('div');
        sub.className = 'dice-group-sub';
        sub.textContent = g.total;
        wrap.appendChild(sub);
      }
      row.appendChild(wrap);
    });

    document.getElementById('dice-overlay').classList.add('active');
    setTimeout(() => {
      _polyIntervals.forEach(clearInterval); _polyIntervals = [];
      reveals.forEach(({ textEl, val, reveal }) => {
        if (reveal) reveal(val);
        else if (textEl) textEl.textContent = val;
      });
      row.querySelectorAll('.dice-group-sub').forEach(el => el.classList.add('show'));
      bigEl.classList.add('show');
      subEl.classList.add('show');
      if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
      _diceAutoClose = setTimeout(dismissDiceOverlay, 2500);
    }, dur);
  });
}

function dismissDiceOverlay() {
  if (_diceAutoClose) { clearTimeout(_diceAutoClose); _diceAutoClose = null; }
  _polyIntervals.forEach(clearInterval); _polyIntervals = [];
  document.getElementById('dice-overlay').classList.remove('active');
  const row = document.getElementById('dice-row');
  row.innerHTML = '';
  row.classList.remove('dice-row-grouped');
  if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
}
