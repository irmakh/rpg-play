// Written by Irmak Hakman — 2026-11-01 17:55
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Notifications — the emitter.
 *
 * Routes tell people things by calling ctx.notify(); everything else (who it
 * reaches, how it is stored, how it gets to the browser) lives here. It is
 * shaped exactly like ctx.broadcast(): one call, no awaiting, never throws into
 * its caller. A notification failing must not fail the thing it was announcing.
 *
 * Addressing
 *   to: 'dm'                    the DM of this campaign
 *   to: 'all'                   every character, plus the DM
 *   to: 'players'               every character, not the DM
 *   to: '<charId>'              one character
 *   to: ['<id>', '<id>', 'dm']  an explicit list
 *
 * Priority
 *   'alert'  pops a toast, chimes, and raises a native notification
 *   'feed'   silent; it only shows up in the bell
 *
 * `exclude` drops a recipient — used so the person who caused something is not
 * told about their own action.
 */

// The DM has no character id, so deliveries addressed to them use this key.
export const DM_RECIPIENT = 'dm';

// How many events a campaign keeps. Older ones (and their deliveries) are
// dropped on write, so the table cannot grow forever.
const KEEP_EVENTS = 300;

// Repeats of the same kind from the same person inside this window fold into
// one row that counts up. A combat round produces a dozen rolls; without this
// the bell would be useless the moment dice were included.
const COALESCE_MS = 45000;
// How many event lines a folded row keeps (see n.line); older ones are counted.
const MAX_LINES = 12;

export default function makeNotify(ctx) {
  const { ldb, broadcast, genId } = ctx;

  function characterIds() {
    try { return ldb.listCharacters().map(c => c.id); } catch { return []; }
  }

  /** Turns an audience into the concrete list of recipient keys. */
  function resolveRecipients(to, exclude) {
    let list;
    if (Array.isArray(to)) list = to.slice();
    else if (to === 'all') list = [...characterIds(), DM_RECIPIENT];
    else if (to === 'players') list = characterIds();
    else if (to) list = [to];
    else list = [];

    const drop = new Set(Array.isArray(exclude) ? exclude : (exclude ? [exclude] : []));
    return [...new Set(list.filter(r => r && !drop.has(r)))];
  }

  /**
   * Announce something.
   * @param {object} n
   * @param {string|string[]} n.to        audience — see the header
   * @param {string} n.kind               machine name, e.g. 'loot-granted'
   * @param {string} n.title              one line, shown in bold
   * @param {string} [n.body]             one more line of detail
   * @param {'alert'|'feed'} [n.priority] default 'feed'
   * @param {object} [n.data]             { href } to open when clicked
   * @param {string} [n.actorName]        who caused it
   * @param {boolean} [n.coalesce]        fold into this actor's previous one of
   *                                      the same kind, if it is recent
   * @param {string} [n.coalesceTitle]    wording for a folded row; {count} is
   *                                      replaced with how many it stands for
   * @param {string} [n.coalesceBody]     body for a folded row
   * @param {string} [n.line]             this event in one line ("18 (Longsword
   *                                      Dmg)"). Given, a folded row's body lists
   *                                      every event's line, newest first, rather
   *                                      than only the latest (coalesceBody)
   * @param {string[]} [n.lines]          several rolls in one event (a group
   *                                      save): each is a line, and each counts,
   *                                      so a 3-token save is "rolled 3 times"
   * @param {string} [n.toastTitle]       the pop-up's wording for this event, if
   * @param {string} [n.toastBody]        it differs from title/body
   * @param {string|string[]} [n.exclude] recipients to skip
   * @returns {string|null} the notification id, or null if it reached nobody
   */
  function notify(n) {
    try {
      const recipients = resolveRecipients(n.to, n.exclude);
      if (recipients.length === 0) return null;

      const createdAt = new Date().toISOString();
      // The rolls this event carries, one line each, and how many it counts for.
      const newLines = (Array.isArray(n.lines) ? n.lines : (n.line ? [n.line] : []))
        .map(l => String(l).slice(0, 120)).slice(0, MAX_LINES);
      const weight = Math.max(1, newLines.length);
      // This one event in its own words, for the pop-up: a folded row speaks
      // for the whole burst, a pop-up only for what just came.
      const latest = {
        title: String(n.toastTitle ?? n.title ?? '').slice(0, 200),
        body: String(n.toastBody ?? n.body ?? '').slice(0, 500),
      };
      const listBody = (lines, count) =>
        lines.join('\n') + (count > lines.length ? `\n… and ${count - lines.length} earlier` : '');

      // Fold into the previous one where the caller asked for it, rather than
      // stacking a dozen near-identical rows. The existing deliveries are
      // reused and marked unread again, so the row resurfaces with a new count.
      if (n.coalesce && n.actorName) {
        const since = new Date(Date.now() - COALESCE_MS).toISOString();
        let prev = ldb.findRecentNotification(n.kind || '', n.actorName, since);
        // Only into a row with exactly this audience. A DM-only roll (a blind
        // handout check, a monster's initiative) folded into a row the players
        // hold would put its result in their bell; a public roll folded into a
        // DM-only row would never reach them.
        if (prev) {
          const had = [...new Set(ldb.listNotificationRecipients(prev.id))].sort().join(',');
          if (had !== [...recipients].sort().join(',')) prev = null;
        }
        if (prev) {
          const count = (prev.count || 1) + weight;
          const title = n.coalesceTitle
            ? String(n.coalesceTitle).replace('{count}', String(count))
            : String(n.title || '');
          let body = n.coalesceBody !== undefined ? String(n.coalesceBody) : String(n.body || '');
          let dataJson;
          if (newLines.length) {
            let prevData = {};
            try { prevData = JSON.parse(prev.dataJson || '{}') || {}; } catch {}
            const lines = [...newLines, ...(Array.isArray(prevData.lines) ? prevData.lines : [])]
              .slice(0, MAX_LINES);
            body = listBody(lines, count);
            dataJson = JSON.stringify({ ...prevData, ...(n.data || {}), lines });
          }
          ldb.bumpNotification(prev.id, { title, body: body.slice(0, 2000), createdAt, dataJson, count });
          ldb.resetNotificationSeen(prev.id);
          broadcast('notification', {
            id: prev.id, recipients,
            kind: prev.kind, priority: prev.priority, title, body,
            data: n.data || {}, actorName: prev.actorName, createdAt, count, latest,
          }, undefined, { to: recipients });
          return prev.id;
        }
      }

      const id = genId();
      // A new row that already stands for several rolls (a group save) reads
      // like a folded one: "DM rolled 3 times" over a line per roll.
      const many = weight > 1;
      const row = {
        kind: n.kind || '',
        priority: n.priority === 'alert' ? 'alert' : 'feed',
        title: String(many && n.coalesceTitle
          ? String(n.coalesceTitle).replace('{count}', String(weight)) : (n.title || '')).slice(0, 200),
        body: (many ? listBody(newLines, weight) : String(n.body || '')).slice(0, 2000),
        dataJson: JSON.stringify(newLines.length ? { ...(n.data || {}), lines: newLines } : (n.data || {})),
        actorName: String(n.actorName || '').slice(0, 120),
        createdAt,
        count: weight,
      };

      ldb.createNotification(id, row);
      for (const r of recipients) ldb.addNotificationRecipient(genId(), id, r);
      ldb.pruneNotifications(KEEP_EVENTS);

      // One event, delivered only to the connections it is addressed to. The
      // server knows who each connection is since v237 (lib/realtime-audience.js);
      // before that this went to every socket in the campaign with its recipient
      // list, and each page merely hid what was not its own — so anyone watching
      // the socket read everyone's notifications.
      broadcast('notification', {
        id, recipients,
        kind: row.kind, priority: row.priority, title: row.title, body: row.body,
        data: n.data || {}, actorName: row.actorName, createdAt, count: weight, latest,
      }, undefined, { to: recipients });
      return id;
    } catch (err) {
      // Never let announcing a thing break the thing.
      console.error('notify:', err);
      return null;
    }
  }

  return notify;
}
