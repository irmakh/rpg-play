/**
 * Token-based authorisation checks.
 *
 * The browser sends its session token in the same two headers that used to
 * carry passwords — X-Master-Password and X-Character-Password — so none of the
 * frontend's ~180 header call sites had to change. What changed is what the
 * server accepts there: ONLY a live session token (lib/sessions.js). A password
 * in a header is simply not a credential any more; passwords are checked at
 * login, behind the captcha and the lockout, and nowhere else.
 *
 * masterAuth() keeps its name, signature and SYNC return so the ~100 existing
 * `if (!masterAuth(req))` call sites are untouched.
 */

/** A header value, ignoring the 'null'/'undefined' strings a stale page can send. */
export function credentialHeader(req, name) {
  const v = req?.headers?.[name];
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return (t === 'null' || t === 'undefined') ? '' : t;
}

/**
 * @param {object} deps
 * @param {{resolve:(t:string)=>object|null}} deps.sessions
 * @param {(req)=>string|null} deps.campaignIdFromReq  the campaign this request is for
 * @param {(id:string)=>Promise<object|null>} deps.getCharacter
 */
export function createAuth({ sessions, campaignIdFromReq, getCharacter }) {
  // One request can be asked about several times (the session gate, then the
  // route); resolve each header once.
  const cache = new WeakMap();
  function sessionFromHeader(req, name) {
    const token = credentialHeader(req, name);
    if (!token) return null;
    let per = cache.get(req);
    if (!per) { per = {}; cache.set(req, per); }
    if (!(name in per)) per[name] = sessions.resolve(token);
    return per[name];
  }

  /** The session behind either credential header, DM header first. */
  function sessionFromReq(req) {
    return sessionFromHeader(req, 'x-master-password') || sessionFromHeader(req, 'x-character-password');
  }

  // A DM session only ever holds a real campaign id — /api/auth/login is not
  // campaign-exempt, so it cannot run without one — so the empty case can only
  // match itself (a test app with no campaign header), never a real campaign.
  const isDmFor = (s, campaignId) =>
    !!s && (s.role === 'admin' || (s.role === 'dm' && s.campaignId === String(campaignId || '')));

  /** The DM of this request's campaign, or the super-admin. */
  function masterAuth(req) {
    return isDmFor(sessionFromHeader(req, 'x-master-password'), campaignIdFromReq(req));
  }

  /** The DM of a named campaign (the registry routes), or the super-admin. */
  function campaignDmAuth(req, campaignId) {
    return isDmFor(sessionFromHeader(req, 'x-master-password'), campaignId);
  }

  function isAdmin(req) {
    return sessionFromHeader(req, 'x-master-password')?.role === 'admin';
  }

  /**
   * 200 / 401 / 404 — same contract as before.
   * A character with no password is open to anyone (unchanged). Otherwise either
   * header may carry that character's own token, or a DM/admin token: the
   * character sheet sends the DM's credential as X-Character-Password.
   */
  async function charAuth(charId, req) {
    const char = await getCharacter(charId);
    if (!char) return 404;
    if (!char.passwordHash) return 200;
    const campaignId = campaignIdFromReq(req);
    for (const name of ['x-character-password', 'x-master-password']) {
      const s = sessionFromHeader(req, name);
      if (!s) continue;
      if (isDmFor(s, campaignId)) return 200;
      if (s.role === 'character' && s.charId === char.id && s.campaignId === String(campaignId || '')) return 200;
    }
    return 401;
  }

  /**
   * Who is calling, relative to one character: the session (or null), whether
   * it is this campaign's DM/super-admin, and whether it is that character.
   */
  function callerFor(req, charId) {
    const campaignId = String(campaignIdFromReq(req) || '');
    const s = sessionFromReq(req);
    return {
      session: s,
      isDm: isDmFor(s, campaignId),
      isSelf: !!s && s.role === 'character' && s.charId === String(charId) && s.campaignId === campaignId,
    };
  }

  /**
   * Are the credentials this request carries still good? Only asked when a
   * credential header is non-empty. False for an unknown or expired token, for
   * a plain password left in a stale tab, and for a token from another
   * campaign — the session gate turns that into 401 SESSION_EXPIRED.
   */
  function credentialsValid(req) {
    const campaignId = campaignIdFromReq(req);
    for (const name of ['x-master-password', 'x-character-password']) {
      if (!credentialHeader(req, name)) continue;
      const s = sessionFromHeader(req, name);
      if (!s) return false;
      // With no campaign in context (the registry routes) there is nothing to
      // compare against; those routes check the campaign named in their URL.
      if (s.role !== 'admin' && campaignId && s.campaignId !== campaignId) return false;
    }
    return true;
  }

  /** Any live session at all, whatever campaign — used to size the body limit. */
  function hasAnySession(req) {
    return !!sessionFromReq(req);
  }

  return { sessionFromReq, masterAuth, campaignDmAuth, isAdmin, charAuth, callerFor, credentialsValid, hasAnySession };
}
