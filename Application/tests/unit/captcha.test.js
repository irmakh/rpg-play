/**
 * The in-house maths captcha (lib/captcha.js).
 *
 * What matters: the sums are fair (answers 0..99, never negative), the image
 * never carries the answer in a readable form, and a challenge can be used
 * exactly once and only for five minutes — that is what makes every password
 * guess cost one solved sum.
 */
import { describe, it, expect } from 'vitest';
import { makeProblem, renderSvg, renderPng, createCaptchaStore } from '../../lib/captcha.js';

/** Deterministic [0,1) source so a failing case can be replayed. */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function makeStore(over = {}) {
  let t = 1_000_000;
  const store = createCaptchaStore({ now: () => t, ...over });
  return { store, advance: ms => { t += ms; } };
}

describe('makeProblem', () => {
  it('always matches its own sum, with answers between 0 and 99', () => {
    const rnd = lcg(7);
    for (let i = 0; i < 5000; i++) {
      const p = makeProblem(rnd);
      const expected = p.op === '+' ? p.a + p.b : p.op === '-' ? p.a - p.b : p.a * p.b;
      expect(p.answer).toBe(expected);
      expect(p.answer).toBeGreaterThanOrEqual(0);
      expect(p.answer).toBeLessThanOrEqual(99);
      expect(p.text).toBe(`${p.a}${p.op}${p.b}=?`);
    }
  });

  it('uses addition, subtraction and multiplication', () => {
    const rnd = lcg(11);
    const ops = new Set(Array.from({ length: 300 }, () => makeProblem(rnd).op));
    expect([...ops].sort()).toEqual(['+', '-', 'x']);
  });
});

describe('renderSvg', () => {
  const problem = { a: 17, b: 4, op: '+', answer: 21, text: '17+4=?' };

  it('draws the sum as strokes — no text, no font, nothing to read back', () => {
    const svg = renderSvg(problem, lcg(3));
    expect(svg).not.toMatch(/<text|<tspan|font-family|<title|<desc/);
    expect(svg).not.toContain('17+4');
    expect(svg).toMatch(/<path /);
  });

  it('never draws the same sum the same way twice', () => {
    expect(renderSvg(problem, lcg(1))).not.toBe(renderSvg(problem, lcg(2)));
  });
});

describe('renderPng', () => {
  it('rasterises to a real PNG, so the page only ever gets pixels', async () => {
    const png = await renderPng(makeProblem(lcg(5)), lcg(9));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(1000);
  });
});

describe('createCaptchaStore', () => {
  it('accepts the right answer exactly once', async () => {
    const { store } = makeStore();
    const c = await store.issue('10.0.0.1');
    const answer = String(store._answerOf(c.id));
    expect(store.verify(c.id, answer)).toEqual({ ok: true });
    expect(store.verify(c.id, answer)).toEqual({ ok: false, code: 'CAPTCHA_EXPIRED' });
  });

  it('spends the challenge on a wrong answer too', async () => {
    const { store } = makeStore();
    const c = await store.issue('10.0.0.1');
    const answer = store._answerOf(c.id);
    expect(store.verify(c.id, String(answer + 1)).code).toBe('CAPTCHA_WRONG');
    expect(store.verify(c.id, String(answer)).code).toBe('CAPTCHA_EXPIRED');
  });

  it('tolerates surrounding spaces but not anything else', async () => {
    const { store } = makeStore();
    const a = await store.issue('ip');
    expect(store.verify(a.id, ` ${store._answerOf(a.id)} `).ok).toBe(true);
    const b = await store.issue('ip');
    expect(store.verify(b.id, `${store._answerOf(b.id)}abc`).code).toBe('CAPTCHA_WRONG');
    const c = await store.issue('ip');
    expect(store.verify(c.id, '').code).toBe('CAPTCHA_WRONG');
  });

  it('expires after five minutes', async () => {
    const { store, advance } = makeStore();
    const c = await store.issue('ip');
    const answer = String(store._answerOf(c.id));
    advance(5 * 60 * 1000);
    expect(store.verify(c.id, answer).code).toBe('CAPTCHA_EXPIRED');
  });

  it('asks for a captcha when none was sent', () => {
    const { store } = makeStore();
    expect(store.verify(undefined, '4').code).toBe('CAPTCHA_REQUIRED');
  });

  it('returns an image and an expiry, never the answer', async () => {
    const { store } = makeStore();
    const c = await store.issue('ip');
    expect(Object.keys(c).sort()).toEqual(['expiresIn', 'id', 'image']);
    expect(c.image).toMatch(/^data:image\/png;base64,/);
  });

  it('rate-limits issuing per IP and says when to come back', async () => {
    const { store, advance } = makeStore({ issueMaxPerIp: 3, issueWindowMs: 60_000 });
    for (let i = 0; i < 3; i++) expect((await store.issue('a')).id).toBeTruthy();
    const refused = await store.issue('a');
    expect(refused.error).toBe('RATE');
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.retryAfterSec).toBeLessThanOrEqual(60);
    expect((await store.issue('b')).id).toBeTruthy();   // another address is unaffected
    advance(60_001);
    expect((await store.issue('a')).id).toBeTruthy();
  });

  it('caps outstanding challenges by dropping the oldest', async () => {
    const { store } = makeStore({ maxOutstanding: 3 });
    const first = await store.issue('ip');
    for (let i = 0; i < 3; i++) await store.issue('ip');
    expect(store.size()).toBe(3);
    expect(store.verify(first.id, '0').code).toBe('CAPTCHA_EXPIRED');
  });
});
