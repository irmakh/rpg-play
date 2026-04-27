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

function parseDiceCommand(text) {
  const m = text.match(/^\/r(?:oll)?\s+(\d+)?d(\d+)\s*([+-]\d+)?\s*(.*)?$/i);
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

function _makeDieEl(sides, value, size, dur) {
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
      `<polygon points="${pts}" fill="#0f3460" stroke="#c8a04a" stroke-width="2.5" filter="url(#${fid})"/>` +
      `<text x="50" y="${ty}" text-anchor="middle" dominant-baseline="middle" ` +
      `font-size="26" font-weight="bold" fill="#c8a04a" font-family="Segoe UI,sans-serif">${rnd}</text></svg>`;
    wrap.appendChild(inner);
    return { container: wrap, animEl: inner, textEl: inner.querySelector('text'), isCube: false };
  }
}

function showDiceAnimation(sides, dieResults, modifier, total, label, duration, usedIdx = -1) {
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
    const reveals = [];
    for (let i = 0; i < shown; i++) {
      const { container, animEl, textEl, isCube } = _makeDieEl(sides, arr[i], size, dur);
      row.appendChild(container);
      void animEl.offsetWidth;
      animEl.classList.add('rolling');
      const isDimmed = shown > 1 && usedIdx >= 0 && i !== usedIdx;
      reveals.push({ textEl, val: arr[i], isCube, container, isDimmed });
      if (!isCube) {
        const el = textEl;
        const id = setInterval(() => { el.textContent = Math.ceil(Math.random() * sides); }, 100);
        _polyIntervals.push(id);
      }
    }
    document.getElementById('dice-overlay').classList.add('active');
    setTimeout(() => {
      _polyIntervals.forEach(clearInterval); _polyIntervals = [];
      reveals.forEach(({ textEl, val, container, isDimmed }) => {
        textEl.textContent = val;
        if (isDimmed) container.style.cssText += ';opacity:0.35;filter:blur(1.5px);transition:opacity .4s,filter .4s';
      });
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
  document.getElementById('dice-row').innerHTML = '';
  if (_diceResolveFn) { _diceResolveFn(); _diceResolveFn = null; }
}
