// Written by Irmak Hakman — 2026-11-16 16:05
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

import {
  parseTimers, setTimer, pruneTimers, markTurnStart, resolveAsk, turnEnd, parseConditions,
} from '../../lib/cond-timers.js';
import { provenCharId } from '../../lib/caller.js';

/**
 * Combat bookkeeping on table tokens (v360): condition durations and
 * concentration.
 *
 * Durations (lib/cond-timers.js): when a token's turn starts, every timed
 * condition on it is marked to be asked about; the token's controller (or the
 * DM) answers "now", "at end of turn" or "skip". The initiative routes call
 * ctx.onTurnChange() so this happens exactly once per turn, whoever's screen
 * is open.
 *
 * Concentration: a token concentrating on a spell owes a Constitution save
 * each time it takes damage (DC half the damage, at least 10). The token
 * routes call ctx.combatFieldsFor() before saving an HP change, which queues
 * the save on the token; its controller rolls it and reports the result here.
 * Dropping to 0 HP ends concentration outright.
 *
 * Registered after server/routes/table.js, which provides ctx.broadcastToken.
 */
export default function register(app, ctx) {
  const { ldb, masterAuth, sessionAuth } = ctx;

  const announce = (tok, extra = {}) => {
    const payload = { action: 'token-updated', token: tok, ...extra };
    if (typeof ctx.broadcastToken === 'function') ctx.broadcastToken(tok, payload);
    else ctx.broadcast('table', payload);
  };

  // The DM, or the player the token belongs to: their character's token, or a
  // token assigned to them (a companion, a monster the DM handed over).
  async function controls(tok, req) {
    if (!tok) return false;
    if (masterAuth(req)) return true;
    if (!sessionAuth(req)) return false;
    const me = await provenCharId(req, ctx);
    if (!me) return false;
    if (tok.assignedCharId) return String(tok.assignedCharId) === me;
    return (tok.type === 'character' || tok.type === 'npc') && String(tok.linkedId || '') === me;
  }

  function parseChecks(v) {
    let a = v;
    if (typeof a === 'string') { try { a = JSON.parse(a || '[]'); } catch { a = []; } }
    return Array.isArray(a) ? a.filter(c => c && c.dc > 0).map(c => ({ dc: parseInt(c.dc), damage: parseInt(c.damage) || 0 })) : [];
  }

  const concentrationDc = (damage) => Math.max(10, Math.floor((parseInt(damage) || 0) / 2));

  /**
   * Extra fields to save with a token update: timers of removed conditions go,
   * and damage to a concentrating token queues a save (or, at 0 HP, ends it).
   */
  ctx.combatFieldsFor = (tok, update) => {
    const extra = {};
    if (!tok || !update) return extra;
    if (update.conditions !== undefined) {
      const was = parseTimers(tok.condTimers);
      const now = pruneTimers(was, update.conditions);
      if (Object.keys(now).length !== Object.keys(was).length) extra.condTimers = JSON.stringify(now);
    }
    if (tok.concentration && (update.hpCurrent !== undefined || update.hpTemp !== undefined)) {
      const hpAfter = update.hpCurrent !== undefined ? update.hpCurrent : (tok.hpCurrent || 0);
      const before = (tok.hpCurrent || 0) + (tok.hpTemp || 0);
      const after = hpAfter + (update.hpTemp !== undefined ? update.hpTemp : (tok.hpTemp || 0));
      const damage = before - after;
      if (damage > 0) {
        if (hpAfter <= 0) { extra.concentration = ''; extra.concChecks = '[]'; }
        else extra.concChecks = JSON.stringify([...parseChecks(tok.concChecks), { dc: concentrationDc(damage), damage }].slice(-5));
      }
    }
    return extra;
  };

  /**
   * A concentration spell was cast: the caster's tokens now concentrate on it.
   * A new one replaces the old (the rules allow only one), and any saves still
   * owed for the old one go with it. Called by the cast routes.
   */
  ctx.startConcentration = (toks, spell) => {
    const name = String(spell || '').trim().slice(0, 80);
    if (!name) return;
    for (const t of toks || []) {
      if (!t) continue;
      const fields = { concentration: name, concChecks: '[]' };
      ldb.updateTableToken(t.id, fields);
      announce({ ...t, ...fields }, t.concentration && t.concentration !== name ? { concEnded: t.concentration } : {});
    }
  };

  /**
   * The turn moved from one initiative entry to another. The outgoing turn's
   * "at end of turn" answers take effect; the incoming turn's timed conditions
   * are asked about. Going back a turn (rewind) only re-asks, it never ticks.
   */
  ctx.onTurnChange = (prevId, nextId, { rewind = false } = {}) => {
    try {
      if (prevId && prevId !== nextId) {
        for (const t of ldb.getTableTokensByInitId(prevId)) {
          let timers, ended = [], changed;
          if (rewind) {
            timers = parseTimers(t.condTimers);
            changed = Object.values(timers).some(x => x.ask || x.atEnd);
            for (const k of Object.keys(timers)) timers[k] = { ...timers[k], ask: false, atEnd: false };
          } else {
            ({ timers, ended, changed } = turnEnd(t.condTimers));
          }
          if (!changed) continue;
          const fields = { condTimers: JSON.stringify(timers) };
          if (ended.length) fields.conditions = JSON.stringify(parseConditions(t.conditions).filter(c => !ended.includes(c)));
          ldb.updateTableToken(t.id, fields);
          announce({ ...t, ...fields }, ended.length ? { condEnded: ended } : {});
        }
      }
      if (nextId) {
        for (const t of ldb.getTableTokensByInitId(nextId)) {
          const live = pruneTimers(t.condTimers, t.conditions);
          if (!Object.keys(live).length) continue;
          const fields = { condTimers: JSON.stringify(markTurnStart(live)) };
          ldb.updateTableToken(t.id, fields);
          announce({ ...t, ...fields });
        }
      }
    } catch (err) { console.error('onTurnChange:', err); }
  };

  // POST /api/table/tokens/:id/condition-timer { condition, rounds }
  // Give a condition the token has a duration in rounds; 0 clears it.
  app.post('/api/table/tokens/:id/condition-timer', async (req, res) => {
    try {
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      if (!(await controls(tok, req))) return res.status(401).json({ error: 'Unauthorized' });
      const name = String((req.body || {}).condition || '');
      if (!parseConditions(tok.conditions).includes(name)) return res.status(400).json({ error: 'The token does not have that condition' });
      const timers = setTimer(pruneTimers(tok.condTimers, tok.conditions), name, (req.body || {}).rounds);
      const fields = { condTimers: JSON.stringify(timers) };
      ldb.updateTableToken(tok.id, fields);
      announce({ ...tok, ...fields });
      res.json({ ok: true, condTimers: timers });
    } catch (err) { console.error('POST condition-timer:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/table/tokens/:id/condition-ask { condition, choice: now|end|skip }
  // The answer to "Poisoned has 2 rounds left" at the start of the token's turn.
  app.post('/api/table/tokens/:id/condition-ask', async (req, res) => {
    try {
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      if (!(await controls(tok, req))) return res.status(401).json({ error: 'Unauthorized' });
      const { condition, choice } = req.body || {};
      const timers = parseTimers(tok.condTimers);
      const t = timers[String(condition || '')];
      // Already answered (on another screen): nothing to do, and no error.
      if (!t || !t.ask) return res.json({ ok: true, already: true });
      const r = resolveAsk(timers, String(condition), choice);
      if (!r.changed) return res.status(400).json({ error: 'Choose now, end or skip' });
      const fields = { condTimers: JSON.stringify(r.timers) };
      if (r.ended.length) fields.conditions = JSON.stringify(parseConditions(tok.conditions).filter(c => !r.ended.includes(c)));
      ldb.updateTableToken(tok.id, fields);
      announce({ ...tok, ...fields }, r.ended.length ? { condEnded: r.ended } : {});
      res.json({ ok: true, ended: r.ended, condTimers: r.timers });
    } catch (err) { console.error('POST condition-ask:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/table/tokens/:id/concentration { spell }  ('' stops concentrating)
  // A new concentration spell replaces the old one, as the rules say.
  app.post('/api/table/tokens/:id/concentration', async (req, res) => {
    try {
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      if (!(await controls(tok, req))) return res.status(401).json({ error: 'Unauthorized' });
      const spell = String((req.body || {}).spell || '').trim().slice(0, 80);
      const fields = { concentration: spell, concChecks: '[]' };
      ldb.updateTableToken(tok.id, fields);
      announce({ ...tok, ...fields }, tok.concentration && tok.concentration !== spell ? { concEnded: tok.concentration } : {});
      res.json({ ok: true, replaced: tok.concentration && tok.concentration !== spell ? tok.concentration : '' });
    } catch (err) { console.error('POST concentration:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // POST /api/table/tokens/:id/conc-check { total }  — the CON save, rolled.
  // Settles the oldest save owed: at or above its DC the spell holds; below,
  // concentration ends and any other saves owed go with it.
  app.post('/api/table/tokens/:id/conc-check', async (req, res) => {
    try {
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      if (!(await controls(tok, req))) return res.status(401).json({ error: 'Unauthorized' });
      const checks = parseChecks(tok.concChecks);
      if (!checks.length || !tok.concentration) return res.json({ ok: true, already: true });
      const total = parseInt((req.body || {}).total);
      if (!Number.isFinite(total)) return res.status(400).json({ error: 'total required' });
      const [first, ...rest] = checks;
      const passed = total >= first.dc;
      const fields = passed
        ? { concChecks: JSON.stringify(rest) }
        : { concentration: '', concChecks: '[]' };
      ldb.updateTableToken(tok.id, fields);
      announce({ ...tok, ...fields }, passed ? {} : { concEnded: tok.concentration });
      res.json({ ok: true, passed, dc: first.dc, spell: tok.concentration });
    } catch (err) { console.error('POST conc-check:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
