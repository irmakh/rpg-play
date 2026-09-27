// Written by Irmak Hakman — 2026-09-26 17:05
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * lib/realtime-audience.js — who a live event reaches, per connection.
 *
 * Until v237 anyone could open the live stream, every event went to every
 * connection in the campaign, and the one filter (dmOnly) trusted a role the
 * page typed into its own URL. Hidden tokens, DM-only rolls and everyone's
 * notifications were all on the wire. These pin the rules that replaced that.
 */
import { describe, it, expect } from 'vitest';
import { identityFromSession, payloadFor, tokenFromQuery, isDmIdentity } from '../../lib/realtime-audience.js';

const A = 'camp-a', B = 'camp-b';
const dm     = identityFromSession({ role: 'dm', campaignId: A }, A);
const gerion = identityFromSession({ role: 'character', campaignId: A, charId: 'c1', charName: 'Gerion' }, A);
const aliyr  = identityFromSession({ role: 'character', campaignId: A, charId: 'c2' }, A);
const admin  = identityFromSession({ role: 'admin', campaignId: '' }, A);
const P = { hello: 1 };

describe('identityFromSession', () => {
  it('turns a DM session into the dm key', () => {
    expect(dm).toMatchObject({ campaignId: A, role: 'dm', key: 'dm' });
  });

  it("turns a character session into that character's key", () => {
    expect(gerion).toMatchObject({ role: 'character', key: 'c1', charId: 'c1', charName: 'Gerion' });
  });

  it('lets the super-admin listen to any campaign, as the DM would', () => {
    expect(admin).toMatchObject({ campaignId: A, role: 'admin', key: 'dm' });
    expect(isDmIdentity(admin)).toBe(true);
  });

  it("refuses a session from another campaign — a token only opens its own table", () => {
    expect(identityFromSession({ role: 'dm', campaignId: B }, A)).toBeNull();
    expect(identityFromSession({ role: 'character', campaignId: B, charId: 'c1' }, A)).toBeNull();
  });

  it('refuses no session, no campaign, and a character session with no character', () => {
    expect(identityFromSession(null, A)).toBeNull();
    expect(identityFromSession({ role: 'dm', campaignId: A }, '')).toBeNull();
    expect(identityFromSession({ role: 'character', campaignId: A, charId: '' }, A)).toBeNull();
  });
});

describe('payloadFor', () => {
  it('sends nothing to a connection with no identity — the anonymous listener', () => {
    expect(payloadFor(null, A, P)).toBeNull();
  });

  it("never crosses campaigns", () => {
    expect(payloadFor(dm, B, P)).toBeNull();
  });

  it('sends an ordinary event to everyone in the campaign', () => {
    expect(payloadFor(gerion, A, P)).toBe(P);
    expect(payloadFor(dm, A, P)).toBe(P);
  });

  it('keeps dmOnly for the DM and the super-admin', () => {
    expect(payloadFor(dm, A, P, { dmOnly: true })).toBe(P);
    expect(payloadFor(admin, A, P, { dmOnly: true })).toBe(P);
    expect(payloadFor(gerion, A, P, { dmOnly: true })).toBeNull();
  });

  it("gives players the substitute — a hidden token arrives as 'token-removed'", () => {
    const gone = { action: 'token-removed', id: 't1' };
    expect(payloadFor(gerion, A, P, { dmOnly: true, forOthers: gone })).toBe(gone);
    expect(payloadFor(dm, A, P, { dmOnly: true, forOthers: gone })).toBe(P);
  });

  it("lets a hidden token's owner keep seeing their own token", () => {
    const opts = { dmOnly: true, alsoFor: 'c1', forOthers: { action: 'token-removed' } };
    expect(payloadFor(gerion, A, P, opts)).toBe(P);
    expect(payloadFor(aliyr, A, P, opts).action).toBe('token-removed');
  });

  it('delivers a notification only to the keys it names', () => {
    expect(payloadFor(gerion, A, P, { to: ['c1'] })).toBe(P);
    expect(payloadFor(aliyr, A, P, { to: ['c1'] })).toBeNull();
    expect(payloadFor(dm, A, P, { to: ['c1'] })).toBeNull();      // the DM is addressed as 'dm'
    expect(payloadFor(dm, A, P, { to: ['dm', 'c2'] })).toBe(P);
  });
});

describe('tokenFromQuery', () => {
  it('reads ?token=, and treats the strings a stale page sends as nothing', () => {
    expect(tokenFromQuery({ token: ' rpgs_abc ' })).toBe('rpgs_abc');
    expect(tokenFromQuery({ token: 'null' })).toBe('');
    expect(tokenFromQuery({ token: 'undefined' })).toBe('');
    expect(tokenFromQuery({})).toBe('');
    expect(tokenFromQuery(null)).toBe('');
  });
});
