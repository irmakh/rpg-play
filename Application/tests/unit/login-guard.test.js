/**
 * Failed-login throttling (lib/login-guard.js).
 *
 * The shape that matters in practice: players at one table share a home IP, so
 * one of them mistyping must lock only their own account, while one machine
 * walking through many accounts gets the whole address locked.
 */
import { describe, it, expect } from 'vitest';
import { createLoginGuard, clientIp } from '../../lib/login-guard.js';

function make(over = {}) {
  let t = 0;
  const g = createLoginGuard({ now: () => t, ...over });
  return { g, tick: ms => { t += ms; } };
}

const MIN = 60 * 1000;

describe('pair lock (IP + account)', () => {
  it('locks on the fifth failure for a minute', () => {
    const { g } = make();
    for (let i = 0; i < 4; i++) expect(g.fail('ip', 'char:a').locked).toBe(false);
    const fifth = g.fail('ip', 'char:a');
    expect(fifth).toMatchObject({ locked: true, justLocked: true, retryAfterSec: 60 });
    expect(g.check('ip', 'char:a').locked).toBe(true);
  });

  it('lets the account in again once the lock runs out', () => {
    const { g, tick } = make();
    for (let i = 0; i < 5; i++) g.fail('ip', 'char:a');
    tick(MIN + 1);
    expect(g.check('ip', 'char:a').locked).toBe(false);
  });

  it('doubles the lock on each repeat, up to 30 minutes', () => {
    const { g, tick } = make();
    const lengths = [];
    for (let round = 0; round < 7; round++) {
      let last;
      for (let i = 0; i < 5; i++) last = g.fail('ip', 'char:a');
      lengths.push(last.retryAfterSec);
      tick(last.retryAfterSec * 1000 + 1);
    }
    expect(lengths).toEqual([60, 120, 240, 480, 960, 1800, 1800]);
  });

  it('forgets failures older than 15 minutes', () => {
    const { g, tick } = make();
    for (let i = 0; i < 4; i++) g.fail('ip', 'char:a');
    tick(15 * MIN + 1);
    expect(g.fail('ip', 'char:a').locked).toBe(false);
  });

  it('leaves other accounts on the same IP alone', () => {
    const { g } = make();
    for (let i = 0; i < 5; i++) g.fail('home', 'char:a');
    expect(g.check('home', 'char:a').locked).toBe(true);
    expect(g.check('home', 'char:b').locked).toBe(false);
    expect(g.check('home', 'dm:c1').locked).toBe(false);
  });

  it('a success clears that pair', () => {
    const { g } = make();
    for (let i = 0; i < 4; i++) g.fail('ip', 'char:a');
    g.succeed('ip', 'char:a');
    for (let i = 0; i < 4; i++) expect(g.fail('ip', 'char:a').locked).toBe(false);
  });
});

describe('IP lock', () => {
  it('locks the whole address after 25 failures across accounts', () => {
    const { g } = make();
    for (let i = 0; i < 24; i++) g.fail('bot', `char:${i}`);
    expect(g.check('bot', 'char:fresh').locked).toBe(false);
    g.fail('bot', 'char:24');
    expect(g.check('bot', 'char:fresh').locked).toBe(true);
    expect(g.check('elsewhere', 'char:fresh').locked).toBe(false);
  });

  it('is not reset by logging into your own account', () => {
    const { g } = make({ ipMax: 5, pairMax: 100 });
    for (let i = 0; i < 4; i++) g.fail('ip', 'char:victim');
    g.succeed('ip', 'char:mine');
    expect(g.fail('ip', 'char:victim').locked).toBe(true);
  });
});

describe('DM alert', () => {
  it('fires once per window when one account reaches five wrong passwords', () => {
    const { g, tick } = make();
    const alerts = [];
    for (let i = 0; i < 7; i++) alerts.push(g.fail(`ip${i}`, 'dm:c1').alert);   // across IPs
    expect(alerts).toEqual([false, false, false, false, true, false, false]);
    tick(15 * MIN + 1);
    for (let i = 0; i < 4; i++) g.fail('x', 'dm:c1');
    expect(g.fail('x', 'dm:c1').alert).toBe(true);
  });

  it('ignores failures marked not alertable (a wrong captcha answer)', () => {
    const { g } = make();
    for (let i = 0; i < 10; i++) expect(g.fail(`ip${i}`, 'dm:c1', { alertable: false }).alert).toBe(false);
  });
});

describe('listLocks and unlock (the maintenance page)', () => {
  it('lists an account lock with its details', () => {
    const { g, tick } = make();
    for (let i = 0; i < 4; i++) { g.fail('1.2.3.4', 'char:c1:a'); tick(1000); }
    g.fail('1.2.3.4', 'char:c1:a');
    expect(g.listLocks()).toEqual([expect.objectContaining({
      kind: 'pair', ip: '1.2.3.4', account: 'char:c1:a',
      timesLocked: 1, failures: 5, retryAfterSec: 60,
      firstFailAt: 0, lastFailAt: 4000, lockedAt: 4000, lockedUntil: 64000,
    })]);
  });

  it('lists a whole-address lock', () => {
    const { g } = make({ ipMax: 3, pairMax: 100 });
    for (const acct of ['char:c1:a', 'char:c1:b', 'dm:c1']) g.fail('9.9.9.9', acct);
    expect(g.listLocks()).toEqual([expect.objectContaining({ kind: 'ip', ip: '9.9.9.9', account: '', failures: 3 })]);
  });

  it('drops locks once they have run out', () => {
    const { g, tick } = make();
    for (let i = 0; i < 5; i++) g.fail('ip', 'char:c1:a');
    tick(MIN + 1);
    expect(g.listLocks()).toEqual([]);
  });

  it('unlocks one account, and its next lock starts at a minute again', () => {
    const { g, tick } = make();
    for (let i = 0; i < 5; i++) g.fail('ip', 'char:c1:a');
    tick(MIN + 1);
    let last;
    for (let i = 0; i < 5; i++) last = g.fail('ip', 'char:c1:a');
    expect(last.retryAfterSec).toBe(120);                       // escalated
    expect(g.unlock({ ip: 'ip', account: 'char:c1:a' })).toBe(1);
    expect(g.check('ip', 'char:c1:a').locked).toBe(false);
    for (let i = 0; i < 4; i++) g.fail('ip', 'char:c1:a');
    expect(g.fail('ip', 'char:c1:a').retryAfterSec).toBe(60);  // back to the start
  });

  it('unlocks a whole address: its own lock and every account lock on it', () => {
    const { g } = make({ ipMax: 6, pairMax: 3 });
    for (let i = 0; i < 3; i++) g.fail('x', 'char:c1:a');
    for (let i = 0; i < 3; i++) g.fail('x', 'char:c1:b');       // 6 on x: the address locks too
    for (let i = 0; i < 3; i++) g.fail('y', 'char:c1:a');       // someone else, elsewhere
    expect(g.listLocks().filter(l => l.ip === 'x')).toHaveLength(3);
    expect(g.unlock({ ip: 'x' })).toBe(3);
    expect(g.listLocks().map(l => l.ip)).toEqual(['y']);
    expect(g.check('x', 'char:c1:a').locked).toBe(false);
  });

  it('returns 0 for an address or account it does not know', () => {
    const { g } = make();
    expect(g.unlock({ ip: 'nobody' })).toBe(0);
    expect(g.unlock({ ip: 'nobody', account: 'dm:c1' })).toBe(0);
    expect(g.unlock({})).toBe(0);
  });
});

describe('housekeeping', () => {
  it('sweeps entries that no longer hold anything', () => {
    const { g, tick } = make();
    for (let i = 0; i < 5; i++) g.fail('ip', 'char:a');
    expect(g.size()).toBeGreaterThan(0);
    tick(60 * MIN);
    g.sweep();
    expect(g.size()).toBe(0);
  });
});

describe('clientIp', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }, socket: { remoteAddress: '203.0.113.9' } };

  it('uses the socket address by default — X-Forwarded-For is client-controlled', () => {
    expect(clientIp(req)).toBe('203.0.113.9');
  });

  it('believes X-Forwarded-For only behind a declared proxy', () => {
    expect(clientIp(req, true)).toBe('6.6.6.6');
  });
});
