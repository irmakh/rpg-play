// Written by Irmak Hakman — 2026-11-16 14:40
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * The character a request proves to be, or ''.
 *
 * Pages send X-Character-Id with their credential. A character with a
 * password is proven by charAuth (its own session, or the DM's); one without
 * a password only by a session that is that character, since charAuth lets
 * anyone through for it.
 *
 * Used where a route has to know WHO is asking, not only whether they may:
 * undo (lib/undo.js) and ending a turn (server/routes/initiative.js).
 */
export async function provenCharId(req, { getCharacter, charAuth, auth }) {
  const id = String(req.headers['x-character-id'] || '');
  if (!id) return '';
  const rec = await getCharacter(id);
  if (!rec) return '';
  if (rec.passwordHash) return (await charAuth(id, req)) === 200 ? id : '';
  return auth && auth.callerFor(req, id).isSelf ? id : '';
}
