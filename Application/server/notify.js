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
   * @param {string|string[]} [n.exclude] recipients to skip
   * @returns {string|null} the notification id, or null if it reached nobody
   */
  function notify(n) {
    try {
      const recipients = resolveRecipients(n.to, n.exclude);
      if (recipients.length === 0) return null;

      const createdAt = new Date().toISOString();

      // Fold into the previous one where the caller asked for it, rather than
      // stacking a dozen near-identical rows. The existing deliveries are
      // reused and marked unread again, so the row resurfaces with a new count.
      if (n.coalesce && n.actorName) {
        const since = new Date(Date.now() - COALESCE_MS).toISOString();
        const prev = ldb.findRecentNotification(n.kind || '', n.actorName, since);
        if (prev) {
          const count = (prev.count || 1) + 1;
          const title = n.coalesceTitle
            ? String(n.coalesceTitle).replace('{count}', String(count))
            : String(n.title || '');
          const body = n.coalesceBody !== undefined ? String(n.coalesceBody) : String(n.body || '');
          ldb.bumpNotification(prev.id, { title, body, createdAt });
          ldb.resetNotificationSeen(prev.id);
          broadcast('notification', {
            id: prev.id, recipients,
            kind: prev.kind, priority: prev.priority, title, body,
            data: n.data || {}, actorName: prev.actorName, createdAt, count,
          });
          return prev.id;
        }
      }

      const id = genId();
      const row = {
        kind: n.kind || '',
        priority: n.priority === 'alert' ? 'alert' : 'feed',
        title: String(n.title || '').slice(0, 200),
        body: String(n.body || '').slice(0, 500),
        dataJson: JSON.stringify(n.data || {}),
        actorName: String(n.actorName || '').slice(0, 120),
        createdAt,
      };

      ldb.createNotification(id, row);
      for (const r of recipients) ldb.addNotificationRecipient(genId(), id, r);
      ldb.pruneNotifications(KEEP_EVENTS);

      // One event on the wire carrying its recipient list; each client keeps
      // only what is addressed to it. Sending per-recipient events instead
      // would put another client's business on everyone else's connection.
      broadcast('notification', {
        id, recipients,
        kind: row.kind, priority: row.priority, title: row.title, body: row.body,
        data: n.data || {}, actorName: row.actorName, createdAt,
      });
      return id;
    } catch (err) {
      // Never let announcing a thing break the thing.
      console.error('notify:', err);
      return null;
    }
  }

  return notify;
}
