/**
 * In-house maths captcha.
 *
 * A login costs one solved sum. The sum is drawn from hand-coded stroke glyphs,
 * each one jittered, rotated, scaled and shifted on every render, laid over
 * noise curves and dots, and then RASTERISED TO PNG with sharp. The page only
 * ever receives pixels: there is no text, no <path> data and no font for a
 * script to read the answer out of. (sharp is already a dependency; it renders
 * the SVG through librsvg.)
 *
 * Honest limits: this stops scripted password guessing and form-filling bots,
 * which is the job here. It is not a defence against someone willing to train an
 * OCR model on it — nothing in-house is — which is why every login is ALSO
 * rate-limited by lib/login-guard.js.
 *
 * Challenges live in memory: single-use, five-minute expiry. Losing them on a
 * restart costs a player one "new problem" click.
 */
import crypto from 'crypto';
import sharp from 'sharp';

const TTL_MS           = 5 * 60 * 1000;
const MAX_OUTSTANDING  = 5000;
// Generous on purpose: a whole table of players on one home Wi-Fi shares an IP,
// and every login page load plus every "new problem" click issues one.
const ISSUE_WINDOW_MS  = 5 * 60 * 1000;
const ISSUE_MAX_PER_IP = 60;

// Drawn at 220x70 CSS px, rasterised at 2x so it stays crisp on a phone.
const W = 220, H = 70, SCALE = 2;

// Colours mirror public/css/tokens.css — an SVG handed to librsvg cannot read
// a CSS custom property, so each is copied with the token it stands for.
const BG     = '#101A2C';   // --slate
const INKS   = ['#E6EDF7', '#E0A93F', '#F2C468', '#CFE0FF'];  // --bone, --arc, --arc-hi, --lift (opaque)
const NOISE  = '#7F8FA8';   // --ash
const EDGE   = '#E6EDF733'; // --rule-hi

/**
 * Glyphs on a 10 x 16 box, as strokes (each an array of [x, y] points).
 * Hand-drawn shapes rather than a font: a font would put the same outline on
 * the page every time, and a font file is exactly what an OCR pass is built for.
 *
 * A stroke of more than two points is drawn smoothed through its midpoints,
 * which rounds every corner. So the angular digits (1, 2, 4, 5, 7) are split
 * into straight two-point strokes wherever they have a real corner: smoothed,
 * a 7 read as a question mark in testing.
 */
const GLYPHS = {
  '0': [[[5, 1], [8, 2.5], [9, 8], [8, 13.5], [5, 15], [2, 13.5], [1, 8], [2, 2.5], [5, 1]]],
  '1': [[[2.5, 4], [5.5, 1]], [[5.5, 1], [5.5, 15]], [[2.5, 15], [8.5, 15]]],
  '2': [[[1.5, 4], [3, 1.5], [6, 1], [8.5, 3], [8.5, 6], [1.5, 15]], [[1.5, 15], [9, 15]]],
  '3': [[[1.5, 2.5], [4.5, 1], [8, 2], [8.5, 5], [5, 7.8]], [[5, 7.8], [8.5, 10], [8.5, 13], [5, 15], [1.5, 13.5]]],
  '4': [[[7, 15], [7, 1]], [[7, 1], [1, 11]], [[1, 11], [9.5, 11]]],
  '5': [[[8.5, 1], [2, 1]], [[2, 1], [1.5, 7]], [[1.5, 7], [5, 6], [8.5, 8], [8.5, 12.5], [5.5, 15], [1.5, 14]]],
  '6': [[[8, 2], [5, 1], [2, 3], [1, 9], [2, 13.5], [5, 15], [8, 13.5], [8.8, 10.5], [7.5, 8], [5, 7.2], [2, 8.5], [1.2, 10]]],
  '7': [[[1, 1], [9, 1]], [[9, 1], [4, 15]]],
  '8': [[[5, 7.5], [2, 5.8], [2, 2.5], [5, 1], [8, 2.5], [8, 5.8], [5, 7.5], [1.5, 10], [1.5, 13.3], [5, 15], [8.5, 13.3], [8.5, 10], [5, 7.5]]],
  '9': [[[8.8, 6], [7.5, 8], [5, 8.8], [2, 7.5], [1.2, 4.5], [2.5, 1.8], [5, 1], [8, 2.5], [9, 7], [8, 13], [5, 15], [2, 14]]],
  '+': [[[5, 3.5], [5, 12.5]], [[0.5, 8], [9.5, 8]]],
  '-': [[[0.5, 8], [9.5, 8]]],
  'x': [[[1.5, 4], [8.5, 12]], [[8.5, 4], [1.5, 12]]],
  '=': [[[1, 6], [9, 6]], [[1, 10], [9, 10]]],
  '?': [[[1.8, 4], [3, 1.5], [5.5, 1], [8.3, 2.5], [8.3, 5.5], [5, 8], [5, 11]], [[5, 14.2], [5, 15]]],
};

// Operators stay nearly upright and a touch bolder than the digits: tilted
// far, a + reads as a x, and the one-stroke minus got lost among the noise.
const OPERATORS = new Set(['+', '-', 'x', '=']);

function cryptoRandom() { return crypto.randomInt(0, 0x100000000) / 0x100000000; }

/** Integer in [lo, hi], inclusive. */
function int(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
function range(rnd, lo, hi) { return lo + rnd() * (hi - lo); }
function pick(rnd, list) { return list[Math.floor(rnd() * list.length)]; }

/**
 * One sum: two numbers with +, − or ×. Answers stay in 0..99 — subtraction never
 * goes negative, multiplication stays within the times tables.
 */
export function makeProblem(rnd = cryptoRandom) {
  const op = pick(rnd, ['+', '-', 'x']);
  let a, b, answer;
  if (op === '+')      { a = int(rnd, 1, 20); b = int(rnd, 1, 20); answer = a + b; }
  else if (op === '-') { a = int(rnd, 2, 20); b = int(rnd, 1, a);  answer = a - b; }
  else                 { a = int(rnd, 2, 9);  b = int(rnd, 2, 9);  answer = a * b; }
  return { a, b, op, answer, text: `${a}${op}${b}=?` };
}

const f = n => n.toFixed(1);

/** A stroke through its points, smoothed through the midpoints so it looks drawn. */
function strokePath(pts) {
  if (pts.length === 2) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${f(last[0])} ${f(last[1])}`;
}

/** Places one glyph: jitter each point, then rotate/scale about its centre and move it. */
function placeGlyph(rnd, strokes, x, y, scale, angleDeg) {
  const a = angleDeg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return strokes.map(stroke => stroke.map(([px, py]) => {
    const jx = px + range(rnd, -0.45, 0.45) - 5;
    const jy = py + range(rnd, -0.45, 0.45) - 8;
    return [x + (jx * cos - jy * sin) * scale, y + (jx * sin + jy * cos) * scale];
  }));
}

/** The SVG for a problem. Exported for tests; the page only ever gets the PNG. */
export function renderSvg(problem, rnd = cryptoRandom) {
  const chars = problem.text.split('');
  const parts = [];

  // Background noise first, so the sum sits on top of it.
  for (let i = 0, n = int(rnd, 30, 45); i < n; i++) {
    parts.push(`<circle cx="${f(range(rnd, 0, W))}" cy="${f(range(rnd, 0, H))}" r="${f(range(rnd, 0.6, 1.6))}" fill="${NOISE}" opacity="${f(range(rnd, 0.35, 0.7))}"/>`);
  }
  for (let i = 0, n = int(rnd, 3, 5); i < n; i++) {
    const y0 = range(rnd, 5, H - 5), y1 = range(rnd, 5, H - 5);
    parts.push(`<path d="M${f(-5)} ${f(y0)}C${f(range(rnd, 40, 90))} ${f(range(rnd, 0, H))} ${f(range(rnd, 130, 180))} ${f(range(rnd, 0, H))} ${f(W + 5)} ${f(y1)}" stroke="${NOISE}" stroke-width="${f(range(rnd, 1, 2.2))}" fill="none" opacity="${f(range(rnd, 0.35, 0.6))}"/>`);
  }
  // Decoys: fragments of real glyphs, faint, so stroke-matching finds extra shapes.
  const glyphKeys = Object.keys(GLYPHS);
  for (let i = 0, n = int(rnd, 2, 3); i < n; i++) {
    const g = GLYPHS[pick(rnd, glyphKeys)];
    const stroke = [pick(rnd, g)];
    const placed = placeGlyph(rnd, stroke, range(rnd, 10, W - 10), range(rnd, 12, H - 12), range(rnd, 1.2, 1.8), range(rnd, -40, 40));
    parts.push(`<path d="${strokePath(placed[0])}" stroke="${NOISE}" stroke-width="${f(range(rnd, 1.2, 1.8))}" fill="none" stroke-linecap="round" opacity="0.28"/>`);
  }

  // The sum itself: glyphs laid left to right with their own size, tilt and baseline.
  const advance = 27;
  let x = (W - advance * chars.length) / 2 + advance / 2 + range(rnd, -6, 6);
  for (const ch of chars) {
    const g = GLYPHS[ch];
    const op = OPERATORS.has(ch);
    const scale = range(rnd, 1.8, 2.25);
    const tilt = op ? range(rnd, -5, 5) : range(rnd, -14, 14);
    const placed = placeGlyph(rnd, g, x + range(rnd, -3, 3), H / 2 + range(rnd, -6, 6), scale, tilt);
    const ink = pick(rnd, INKS);
    const width = f(op ? range(rnd, 3.2, 3.8) : range(rnd, 2.4, 3.4));
    for (const s of placed) {
      parts.push(`<path d="${strokePath(s)}" stroke="${ink}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    x += advance + range(rnd, -2.5, 2.5);
  }

  // One thin line through the whole sum: a person reads straight through it,
  // but it joins the glyphs together for anything trying to cut them apart.
  const sy = H / 2 + range(rnd, -8, 8);
  parts.push(`<path d="M8 ${f(sy)}Q${f(W / 2)} ${f(sy + range(rnd, -14, 14))} ${f(W - 8)} ${f(sy + range(rnd, -6, 6))}" stroke="${pick(rnd, INKS)}" stroke-width="1.3" fill="none" opacity="0.8"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${BG}" stroke="${EDGE}"/>`
    + parts.join('')
    + '</svg>';
}

export async function renderPng(problem, rnd = cryptoRandom) {
  return sharp(Buffer.from(renderSvg(problem, rnd))).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]     clock, injectable for tests
 * @param {() => number} [opts.random]  [0,1) source, injectable for tests
 */
export function createCaptchaStore({
  now = Date.now,
  random = cryptoRandom,
  ttlMs = TTL_MS,
  maxOutstanding = MAX_OUTSTANDING,
  issueWindowMs = ISSUE_WINDOW_MS,
  issueMaxPerIp = ISSUE_MAX_PER_IP,
} = {}) {
  const challenges = new Map();   // id -> { answer, expires }
  const issued = new Map();       // ip -> [issue timestamps]
  let issuesSinceSweep = 0;

  function sweep() {
    const t = now();
    for (const [id, c] of challenges) if (c.expires <= t) challenges.delete(id);
    for (const [ip, list] of issued) {
      const kept = list.filter(ts => t - ts < issueWindowMs);
      if (kept.length) issued.set(ip, kept); else issued.delete(ip);
    }
    issuesSinceSweep = 0;
  }

  /**
   * A new challenge for this IP, or `{ error: 'RATE', retryAfterSec }` when the
   * IP has asked for too many in the window.
   */
  async function issue(ip = '') {
    const t = now();
    if (++issuesSinceSweep >= 100) sweep();

    const recent = (issued.get(ip) || []).filter(ts => t - ts < issueWindowMs);
    if (recent.length >= issueMaxPerIp) {
      issued.set(ip, recent);
      return { error: 'RATE', retryAfterSec: Math.max(1, Math.ceil((recent[0] + issueWindowMs - t) / 1000)) };
    }
    recent.push(t);
    issued.set(ip, recent);

    if (challenges.size >= maxOutstanding) sweep();
    // Still full: drop the oldest. Map iteration is insertion order.
    while (challenges.size >= maxOutstanding) challenges.delete(challenges.keys().next().value);

    const problem = makeProblem(random);
    const id = crypto.randomBytes(16).toString('base64url');
    challenges.set(id, { answer: problem.answer, expires: t + ttlMs });
    const png = await renderPng(problem, random);
    return { id, image: `data:image/png;base64,${png.toString('base64')}`, expiresIn: Math.round(ttlMs / 1000) };
  }

  /**
   * Checks an answer. SINGLE-USE: the challenge is gone after this call whatever
   * the outcome, so each password guess costs one solved sum.
   * @returns {{ok:true}|{ok:false, code:'CAPTCHA_REQUIRED'|'CAPTCHA_EXPIRED'|'CAPTCHA_WRONG'}}
   */
  function verify(id, answer) {
    if (!id) return { ok: false, code: 'CAPTCHA_REQUIRED' };
    const key = String(id);
    const c = challenges.get(key);
    if (!c) return { ok: false, code: 'CAPTCHA_EXPIRED' };
    challenges.delete(key);
    if (c.expires <= now()) return { ok: false, code: 'CAPTCHA_EXPIRED' };
    const typed = String(answer ?? '').trim();
    if (!/^-?\d{1,4}$/.test(typed) || Number(typed) !== c.answer) return { ok: false, code: 'CAPTCHA_WRONG' };
    return { ok: true };
  }

  return {
    issue, verify, sweep,
    size: () => challenges.size,
    /** Tests only — never wire this to a route. */
    _answerOf: id => challenges.get(String(id))?.answer,
  };
}
