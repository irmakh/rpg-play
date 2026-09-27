// Written by Irmak Hakman — 2026-09-26 16:50
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Who a live event reaches — decided on the server, per connection.
 *
 * Until v237 the live stream (SSE /api/events and the /ws socket) needed no
 * login: anyone could pick a campaign and listen. And the stream carried the
 * secrets themselves — hidden monster tokens with their names and positions,
 * DM-only rolls (a handout's blind check included), every notification with its
 * text — while each page merely declined to show them. The one server-side
 * filter, dmOnly, trusted a `role` the client typed into its own URL.
 *
 * Now a connection is only accepted with a live session, its identity comes
 * from that session, and every broadcast asks this module what — if anything —
 * each connection receives. The rules are pure so they can be tested without
 * a socket (tests/unit/realtime-audience.test.js).
 *
 * A connection's identity is { campaignId, role, key }:
 *   role  'dm' | 'admin' | 'character'
 *   key   the notification address it answers to — 'dm' for the DM or the
 *         super-admin, else the character id (server/notify.js key space)
 */

/** A session (lib/sessions.js) as a connection identity, or null. */
export function identityFromSession(session, campaignId) {
  if (!session) return null;
  const cid = String(campaignId || '');
  if (session.role === 'admin') return { campaignId: cid, role: 'admin', key: 'dm', charId: '', charName: '' };
  // A session belongs to one campaign; listening to another with it is refused.
  if (!cid || session.campaignId !== cid) return null;
  if (session.role === 'dm') return { campaignId: cid, role: 'dm', key: 'dm', charId: '', charName: '' };
  if (session.role === 'character' && session.charId) {
    return { campaignId: cid, role: 'character', key: String(session.charId), charId: String(session.charId), charName: session.charName || '' };
  }
  return null;
}

export const isDmIdentity = (id) => !!id && (id.role === 'dm' || id.role === 'admin');

/**
 * What this connection receives for one broadcast: the payload, a substitute,
 * or null for nothing.
 *
 * @param {object|null} id        the connection's identity
 * @param {string}      campaignId the campaign the event belongs to
 * @param {*}           payload
 * @param {object}      [opts]
 * @param {boolean}     [opts.dmOnly]    only the DM (or super-admin) of that campaign
 * @param {string[]}    [opts.to]        only these notification keys ('dm', char ids)
 * @param {*}           [opts.forOthers] what everyone left out by dmOnly gets
 *   instead — e.g. a hidden token goes to the DM in full and to players as
 *   'token-removed', so a token the DM hides disappears from their screens.
 * @param {string}      [opts.alsoFor]   a character key that is let through a
 *   dmOnly filter — the player a hidden token is assigned to still sees it.
 */
export function payloadFor(id, campaignId, payload, opts = {}) {
  if (!id || id.campaignId !== String(campaignId || '')) return null;
  if (Array.isArray(opts.to)) {
    return opts.to.map(String).includes(id.key) ? payload : null;
  }
  if (opts.dmOnly && !isDmIdentity(id) && !(opts.alsoFor && id.key === String(opts.alsoFor))) {
    return opts.forOthers === undefined ? null : opts.forOthers;
  }
  return payload;
}

/**
 * The session token a live connection presents. EventSource and WebSocket
 * cannot send headers, so it travels as `?token=`. It is kept off the
 * maintenance page and never logged.
 */
export function tokenFromQuery(q) {
  const t = q && typeof q.token === 'string' ? q.token.trim() : '';
  return t && t !== 'null' && t !== 'undefined' ? t : '';
}
