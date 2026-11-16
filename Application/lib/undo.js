// Written by Irmak Hakman — 2026-11-16 12:10
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Undo for actions that happen at once (a give, a token removed, a treasury
 * item deleted). The route that does the action registers how to reverse it
 * and returns { undoId, undoUntil } with its response; the page shows a notice
 * with an Undo button, and POST /api/undo/:id (server/routes/undo.js) runs the
 * reverse.
 *
 * Who may undo: the person who did it, or the DM of that campaign. An entry is
 * bound to the campaign it was made in, so an id from one campaign can never
 * reverse anything in another.
 *
 * Entries live in memory only. A restart forgets them, which is the same as
 * the window running out: the action simply stays done.
 *
 * The page shows the button for UNDO_WINDOW_MS; the server keeps the entry a
 * few seconds longer (GRACE_MS) so a click in the last second still works.
 * onExpire runs when an entry ends without being undone (time ran out, or the
 * reverse failed): a deleted treasury item's image files are removed only
 * then, so undoing it can bring them back.
 */
import crypto from 'crypto';

export const UNDO_WINDOW_MS = 15000;
const GRACE_MS = 5000;
const MAX_ENTRIES = 500;   // a runaway client cannot grow this without bound

/** A reverse that cannot run any more (the item was given on, the coins spent). */
export class UndoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createUndoRegistry({ now = () => Date.now(), windowMs = UNDO_WINDOW_MS, setTimer = setTimeout } = {}) {
  const entries = new Map();

  function finish(id, e) {
    entries.delete(id);
    if (typeof e.onExpire === 'function') {
      try { e.onExpire(); } catch (err) { console.error('undo onExpire:', err); }
    }
  }

  function sweep() {
    const t = now();
    for (const [id, e] of entries) if (t > e.expiresAt) finish(id, e);
  }

  /**
   * campaignId: the campaign the action happened in.
   * ownerCharId: the character who did it ('' when the DM did).
   * run: async () => any. Throws UndoError when the reverse is no longer possible.
   * Returns { undoId, undoUntil } for the response.
   */
  function register({ campaignId, ownerCharId = '', label = '', run, onExpire }) {
    sweep();
    if (entries.size >= MAX_ENTRIES) {
      const [oldId, oldE] = entries.entries().next().value;
      finish(oldId, oldE);
    }
    const id = crypto.randomBytes(12).toString('base64url');
    const t = now();
    entries.set(id, {
      campaignId: String(campaignId || ''), ownerCharId: String(ownerCharId || ''),
      label: String(label || ''), run, onExpire, expiresAt: t + windowMs + GRACE_MS,
    });
    // Image files wait for the entry to end, so make sure it does end even
    // when nobody registers or undoes anything afterwards.
    if (typeof onExpire === 'function') {
      const timer = setTimer(sweep, windowMs + GRACE_MS + 50);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    return { undoId: id, undoUntil: t + windowMs };
  }

  /**
   * caller: { campaignId, isDm, charId }.
   * Returns { status, error? , label?, result? }.
   */
  async function undo(id, caller) {
    sweep();
    const e = entries.get(String(id || ''));
    if (!e || e.campaignId !== String(caller.campaignId || '')) {
      return { status: 410, error: 'It is too late to undo that' };
    }
    const mine = e.ownerCharId && e.ownerCharId === String(caller.charId || '');
    if (!caller.isDm && !mine) {
      return { status: 403, error: 'Only the person who did it, or the DM, can undo that' };
    }
    entries.delete(id);
    try {
      const result = await e.run();
      return { status: 200, label: e.label, result };
    } catch (err) {
      // Not undone, so whatever was waiting for the entry to end goes ahead now.
      if (typeof e.onExpire === 'function') {
        try { e.onExpire(); } catch (err2) { console.error('undo onExpire:', err2); }
      }
      if (err instanceof UndoError) return { status: err.status, error: err.message };
      throw err;
    }
  }

  return { register, undo, sweep, size: () => entries.size };
}
