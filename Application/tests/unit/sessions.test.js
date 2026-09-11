/**
 * Login sessions (lib/sessions.js) and first-password setup tickets.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createSessionStore, createSetupTickets, isSessionToken, hashToken } from '../../lib/sessions.js';

const HOUR = 60 * 60 * 1000;

function make(over = {}) {
  let t = 1_700_000_000_000;
  const db = new Database(':memory:');
  const s = createSessionStore(db, { now: () => t, ...over });
  return { s, db, tick: ms => { t += ms; } };
}

describe('tokens', () => {
  it('issues rpgs_ tokens and stores only their hash', () => {
    const { s, db } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'dm' });
    expect(isSessionToken(token)).toBe(true);
    const rows = db.prepare('SELECT * FROM sessions').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('gives every login a different token', () => {
    const { s } = make();
    const a = s.create({ campaignId: 'c1', role: 'dm' }).token;
    const b = s.create({ campaignId: 'c1', role: 'dm' }).token;
    expect(a).not.toBe(b);
  });

  it('resolves a live token to its owner, name included', () => {
    const { s } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'character', charId: 'ch9', charName: 'Zed' });
    expect(s.resolve(token)).toMatchObject({ role: 'character', campaignId: 'c1', charId: 'ch9', charName: 'Zed' });
  });

  it('adds the charName column to a sessions table created before it existed', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE sessions (tokenHash TEXT PRIMARY KEY, campaignId TEXT DEFAULT '', role TEXT NOT NULL,
      charId TEXT DEFAULT '', createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
      ip TEXT DEFAULT '', userAgent TEXT DEFAULT '')`);
    const s = createSessionStore(db);
    const { token } = s.create({ campaignId: 'c1', role: 'character', charId: 'a', charName: 'Aliyr' });
    expect(s.resolve(token).charName).toBe('Aliyr');
  });

  it('resolves nothing for a password, garbage or an unknown token', () => {
    const { s } = make();
    for (const v of ['15243', '', null, undefined, 'rpgs_', 'rpgs_unknown', 'x'.repeat(500)]) {
      expect(s.resolve(v)).toBeNull();
    }
  });

  it('refuses an unknown role', () => {
    const { s } = make();
    expect(() => s.create({ campaignId: 'c1', role: 'god' })).toThrow();
  });
});

describe('lifetime', () => {
  it('ends after 24 hours idle, and the row goes with it', () => {
    const { s, db, tick } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'dm' });
    tick(24 * HOUR);
    expect(s.resolve(token)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(0);
  });

  it('slides: use keeps it alive', () => {
    const { s, tick } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'dm' });
    tick(23 * HOUR); expect(s.resolve(token)).not.toBeNull();
    tick(23 * HOUR); expect(s.resolve(token)).not.toBeNull();
  });

  it('ends after 7 days however busy', () => {
    const { s, tick } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'dm' });
    for (let h = 0; h < 7 * 24; h += 12) { tick(12 * HOUR); s.resolve(token); }
    expect(s.resolve(token)).toBeNull();
  });

  it('sweeps expired rows', () => {
    const { s, tick } = make();
    s.create({ campaignId: 'c1', role: 'dm' });
    s.create({ campaignId: 'c1', role: 'dm' });
    tick(25 * HOUR);
    expect(s.sweep()).toBe(2);
    expect(s.count()).toBe(0);
  });
});

describe('revoking', () => {
  it('ends one session', () => {
    const { s } = make();
    const { token } = s.create({ campaignId: 'c1', role: 'dm' });
    expect(s.revoke(token)).toBe(true);
    expect(s.resolve(token)).toBeNull();
  });

  it("ends a character's sessions except the one kept", () => {
    const { s } = make();
    const keep = s.create({ campaignId: 'c1', role: 'character', charId: 'a' });
    const other = s.create({ campaignId: 'c1', role: 'character', charId: 'a' });
    const elsewhere = s.create({ campaignId: 'c2', role: 'character', charId: 'a' });
    const bystander = s.create({ campaignId: 'c1', role: 'character', charId: 'b' });
    expect(s.revokeCharacter('c1', 'a', keep.tokenHash)).toBe(1);
    expect(s.resolve(keep.token)).not.toBeNull();
    expect(s.resolve(other.token)).toBeNull();
    expect(s.resolve(elsewhere.token)).not.toBeNull();
    expect(s.resolve(bystander.token)).not.toBeNull();
  });

  it("ends a campaign's DM sessions and nothing else", () => {
    const { s } = make();
    const dm = s.create({ campaignId: 'c1', role: 'dm' });
    const player = s.create({ campaignId: 'c1', role: 'character', charId: 'a' });
    const otherDm = s.create({ campaignId: 'c2', role: 'dm' });
    s.revokeCampaignRole('c1', 'dm');
    expect(s.resolve(dm.token)).toBeNull();
    expect(s.resolve(player.token)).not.toBeNull();
    expect(s.resolve(otherDm.token)).not.toBeNull();
  });

  it('ends every session of a deleted campaign', () => {
    const { s } = make();
    const a = s.create({ campaignId: 'c1', role: 'dm' });
    const b = s.create({ campaignId: 'c1', role: 'character', charId: 'x' });
    const c = s.create({ campaignId: 'c2', role: 'dm' });
    expect(s.revokeCampaign('c1')).toBe(2);
    expect(s.resolve(a.token)).toBeNull();
    expect(s.resolve(b.token)).toBeNull();
    expect(s.resolve(c.token)).not.toBeNull();
  });
});

describe('setup tickets', () => {
  function tickets() {
    let t = 0;
    return { st: createSetupTickets({ now: () => t }), tick: ms => { t += ms; } };
  }

  it('work once, for the character and campaign they were issued to', () => {
    const { st } = tickets();
    const ticket = st.issue('c1', 'a');
    expect(st.consume(ticket, 'c1', 'a')).toBe(true);
    expect(st.consume(ticket, 'c1', 'a')).toBe(false);
  });

  it('refuse another character or campaign, and are spent by trying', () => {
    const { st } = tickets();
    const t1 = st.issue('c1', 'a');
    expect(st.consume(t1, 'c1', 'b')).toBe(false);
    expect(st.consume(t1, 'c1', 'a')).toBe(false);
    const t2 = st.issue('c1', 'a');
    expect(st.consume(t2, 'c2', 'a')).toBe(false);
  });

  it('expire after 10 minutes', () => {
    const { st, tick } = tickets();
    const ticket = st.issue('c1', 'a');
    tick(10 * 60 * 1000);
    expect(st.consume(ticket, 'c1', 'a')).toBe(false);
  });

  it('refuse a missing ticket', () => {
    const { st } = tickets();
    expect(st.consume(undefined, 'c1', 'a')).toBe(false);
  });
});
