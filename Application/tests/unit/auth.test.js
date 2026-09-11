/**
 * Token-based authorisation (lib/auth.js).
 *
 * The rule under test: the credential headers accept ONLY a live session, and
 * a session only opens what it belongs to — its own campaign, its own
 * character. A plain password in a header is no longer a credential at all.
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createSessionStore } from '../../lib/sessions.js';
import { createAuth, credentialHeader } from '../../lib/auth.js';

const CHARS = {
  c1:   { id: 'c1',   passwordHash: 'salt:hash' },
  c2:   { id: 'c2',   passwordHash: 'salt:hash' },
  open: { id: 'open', passwordHash: '' },
};

function setup() {
  const sessions = createSessionStore(new Database(':memory:'));
  const auth = createAuth({
    sessions,
    campaignIdFromReq: req => req.campaign,
    getCharacter: async id => CHARS[id] || null,
  });
  const tok = (role, campaignId = 'A', charId = '') => sessions.create({ role, campaignId, charId }).token;
  return { sessions, auth, tok };
}

const req = (headers = {}, campaign = 'A') => ({ headers, campaign });
const dmHdr = t => ({ 'x-master-password': t });
const chHdr = t => ({ 'x-character-password': t });

describe('masterAuth', () => {
  it("accepts this campaign's DM session and a super-admin session", () => {
    const { auth, tok } = setup();
    expect(auth.masterAuth(req(dmHdr(tok('dm', 'A'))))).toBe(true);
    expect(auth.masterAuth(req(dmHdr(tok('admin', ''))))).toBe(true);
  });

  it("refuses another campaign's DM session", () => {
    const { auth, tok } = setup();
    expect(auth.masterAuth(req(dmHdr(tok('dm', 'B')), 'A'))).toBe(false);
  });

  it('refuses a character session, a plain password and nothing at all', () => {
    const { auth, tok } = setup();
    expect(auth.masterAuth(req(dmHdr(tok('character', 'A', 'c1'))))).toBe(false);
    expect(auth.masterAuth(req(dmHdr('15243')))).toBe(false);
    expect(auth.masterAuth(req({}))).toBe(false);
  });

  it('resolves a header once per request, however often it is asked', () => {
    const { sessions, tok } = setup();
    const spy = { resolve: vi.fn(t => sessions.resolve(t)) };
    const auth = createAuth({ sessions: spy, campaignIdFromReq: r => r.campaign, getCharacter: async () => null });
    const r = req(dmHdr(tok('dm')));
    auth.masterAuth(r); auth.masterAuth(r); auth.credentialsValid(r);
    expect(spy.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('charAuth', () => {
  it('leaves a character with no password open, as before', async () => {
    const { auth } = setup();
    expect(await auth.charAuth('open', req({}))).toBe(200);
  });

  it("accepts the character's own session", async () => {
    const { auth, tok } = setup();
    expect(await auth.charAuth('c1', req(chHdr(tok('character', 'A', 'c1'))))).toBe(200);
  });

  it("refuses another character's session", async () => {
    const { auth, tok } = setup();
    expect(await auth.charAuth('c1', req(chHdr(tok('character', 'A', 'c2'))))).toBe(401);
  });

  it('accepts a DM session in either header — the sheet sends it as X-Character-Password', async () => {
    const { auth, tok } = setup();
    expect(await auth.charAuth('c1', req(chHdr(tok('dm'))))).toBe(200);
    expect(await auth.charAuth('c1', req(dmHdr(tok('dm'))))).toBe(200);
  });

  it("refuses the same character's session from another campaign", async () => {
    const { auth, tok } = setup();
    expect(await auth.charAuth('c1', req(chHdr(tok('character', 'B', 'c1'))))).toBe(401);
  });

  it('refuses a plain password and 404s an unknown character', async () => {
    const { auth } = setup();
    expect(await auth.charAuth('c1', req(chHdr('the-real-password')))).toBe(401);
    expect(await auth.charAuth('ghost', req({}))).toBe(404);
  });
});

describe('callerFor', () => {
  it('says whether the caller is the DM or the character itself', () => {
    const { auth, tok } = setup();
    expect(auth.callerFor(req(dmHdr(tok('dm'))), 'c1')).toMatchObject({ isDm: true, isSelf: false });
    expect(auth.callerFor(req(chHdr(tok('character', 'A', 'c1'))), 'c1')).toMatchObject({ isDm: false, isSelf: true });
    expect(auth.callerFor(req(chHdr(tok('character', 'A', 'c2'))), 'c1')).toMatchObject({ isDm: false, isSelf: false });
    expect(auth.callerFor(req({}), 'c1')).toMatchObject({ session: null, isDm: false, isSelf: false });
  });
});

describe('credentialsValid (the session gate)', () => {
  it('passes a live session of this campaign, and a super-admin anywhere', () => {
    const { auth, tok } = setup();
    expect(auth.credentialsValid(req(dmHdr(tok('dm'))))).toBe(true);
    expect(auth.credentialsValid(req(dmHdr(tok('admin', ''))))).toBe(true);
  });

  it('fails a plain password — what every pre-v226 tab still holds', () => {
    const { auth } = setup();
    expect(auth.credentialsValid(req(dmHdr('15243')))).toBe(false);
    expect(auth.credentialsValid(req(chHdr('secret')))).toBe(false);
  });

  it('fails a session from another campaign', () => {
    const { auth, tok } = setup();
    expect(auth.credentialsValid(req(chHdr(tok('character', 'B', 'c1')), 'A'))).toBe(false);
  });

  it('with no campaign in context, only asks that the session is live', () => {
    const { auth, tok } = setup();
    expect(auth.credentialsValid(req(dmHdr(tok('dm', 'B')), null))).toBe(true);
    expect(auth.credentialsValid(req(dmHdr('rpgs_revoked'), null))).toBe(false);
  });
});

describe('credentialHeader', () => {
  it("ignores the 'null' and 'undefined' strings a stale page can send", () => {
    expect(credentialHeader(req(dmHdr('null')), 'x-master-password')).toBe('');
    expect(credentialHeader(req(dmHdr('undefined')), 'x-master-password')).toBe('');
    expect(credentialHeader(req(dmHdr('  rpgs_x  ')), 'x-master-password')).toBe('rpgs_x');
  });
});
