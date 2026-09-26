// Written by Irmak Hakman — 2026-09-26 16:15

// ── Stories: who is asking ────────────────────────────────────────────────────
//
// Every /api/stories request needs a live session since v233 — the DM's or any
// character's in this campaign. The three Stories pages load none of the other
// pages' auth code, so this is theirs: the stored session, the headers that
// carry it, and a fetch() that sends them.
//
// A tab that logged in anywhere else already holds rpgSession and walks straight
// in. Otherwise the Stories password gate starts a session of its own
// (POST /api/auth/verify-any answers with a token since v235) and it is stored
// the same way, so the rest of the app recognises it too.
//
// The old 'storiesAuth' flag is ignored on purpose: it proved a password was
// typed once, and the server no longer accepts that as a login.

/** The DM or character session this tab holds, or null. */
function storiesSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('rpgSession') || 'null');
    if (s && (s.role === 'dm' || s.role === 'character')) return s;
  } catch {}
  return null;
}

/** Credential headers for a Stories request, merged over `extra`. */
function storiesHeaders(extra = {}) {
  const s = storiesSession();
  const h = { ...extra };
  if (s && s.role === 'dm' && s.masterPw) h['X-Master-Password'] = s.masterPw;
  if (s && s.role === 'character') {
    if (s.characterId) h['X-Character-Id'] = s.characterId;
    if (s.charPw) h['X-Character-Password'] = s.charPw;
  }
  return h;
}

/**
 * fetch() with this tab's session attached. A 401 means the session has gone
 * (expired, logged out elsewhere) — drop it and show the password gate again,
 * rather than leaving the page silently empty.
 */
async function storiesFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: storiesHeaders(opts.headers || {}) });
  if (res.status === 401 && typeof storiesShowGate === 'function') {
    try { sessionStorage.removeItem('rpgSession'); } catch {}
    storiesShowGate();
  }
  return res;
}

/** The campaign this browser has selected — the cookie the picker sets. */
function _storiesCampaign() {
  const m = /(?:^|;\s*)campaign=([^;]*)/.exec(document.cookie || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Keep the session the Stories gate just started, in the same shape the
 * campaign picker stores one (js/campaigns.js _storeSession), so every other
 * page in this tab treats it as an ordinary login.
 */
function storiesStoreSession(data) {
  if (!data || !data.token) return false;
  const sess = data.role === 'dm'
    ? { role: 'dm', masterPw: data.token }
    : { role: 'character', characterId: data.characterId, characterName: data.characterName || '', charPw: data.token };
  sess.loginAt = Date.now();
  sess.campaignId = _storiesCampaign();
  try { sessionStorage.setItem('rpgSession', JSON.stringify(sess)); } catch { return false; }
  return true;
}
