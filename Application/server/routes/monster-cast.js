// Written by Irmak Hakman — 2026-11-11 17:45
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Monster spellcasting (release 3 of the spellcasting redesign) — DM only.
 *
 *   POST /api/table/tokens/:id/cast        { spellId, useKey, mode, slotLevel }
 *   POST /api/table/tokens/:id/spell-rest  every spell use of that token back
 *   POST /api/table/spell-rest             the same for every monster token
 *
 * The monster's spells come from its stat block (5etools `spellcasting`), and
 * what is left from the TOKEN's own `spellUses`, so two tokens of one monster
 * run out separately. The rules are monsterSpellRows() in
 * public/js/lib/spell-data.js — the same code the pop-up greys spells with.
 *
 * The card goes to chat under the token's identifier (players never see a
 * monster's real name), and only to the DM when the token is hidden. A token's
 * spell uses are the DM's business: players are sent the token without them.
 */
import { SpellData as SD } from '../../lib/spell-data-node.js';

const BOOK_ORDER = ['XPHB', 'PHB'];

/** The library's version of a spell the stat block names: its own book, then XPHB, PHB, any. */
export function libraryLookup(ldb) {
  return (name, source) => {
    const rows = ldb.findSpellsByName(name);
    if (!rows.length) return null;
    const rank = r => (source && r.source === source ? -1 : (BOOK_ORDER.indexOf(r.source) + 1 || BOOK_ORDER.length + 1));
    rows.sort((a, b) => rank(a) - rank(b));
    return { id: rows[0].id, data: rows[0].data };
  };
}

export default function register(app, ctx) {
  const { ldb, genId, masterAuth, broadcast } = ctx;

  const withoutUses = t => { if (!t) return t; const { spellUses, ...rest } = t; return rest; };

  // The DM gets the token as it is; players a copy without its spell uses, or
  // nothing (token-removed) when it is hidden.
  function broadcastUses(tok) {
    const hidden = !tok.visible;
    broadcast('table', { action: 'token-updated', token: tok }, undefined, {
      dmOnly: true,
      forOthers: hidden ? { action: 'token-removed', id: tok.id } : { action: 'token-updated', token: withoutUses(tok) },
    });
  }

  function monsterData(tok) {
    const mon = tok && tok.linkedId ? ldb.getMonster(tok.linkedId) : null;
    if (!mon) return null;
    try { return JSON.parse(mon.dataJson || '{}'); } catch { return null; }
  }

  app.post('/api/table/tokens/:id/cast', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      const data = monsterData(tok);
      if (!data || !SD.monsterSpellcasting(data).groups.length) return res.status(400).json({ error: 'This token has no spells to cast.' });
      const b = req.body || {};
      const findLib = libraryLookup(ldb);
      const rows = SD.monsterSpellRows(data, tok.spellUses, findLib);
      const row = rows.find(r => r.s.id === String(b.spellId || ''));
      if (!row) return res.status(404).json({ error: 'That spell is not in this monster\'s stat block.' });
      const mode = String(b.mode || '');
      const slotLevel = parseInt(b.slotLevel, 10);
      const opt = row.how.options.find(o => o.mode === mode && (mode !== 'slot' || o.level === slotLevel));
      if (!opt) return res.status(400).json({ error: `${row.s.name} cannot be cast that way.` });
      if (!opt.available) return res.status(409).json({ error: mode === 'slot' ? `No level ${slotLevel} slots left.` : `${row.s.name} has no uses left.`, code: 'SPENT' });

      // Spend it on this token.
      let changed = false;
      const uses = SD.parseSpellUses(tok.spellUses);
      if (opt.useKey) {
        uses[opt.useKey] = (parseInt(uses[opt.useKey], 10) || 0) + 1;
        const spellUses = JSON.stringify(uses);
        ldb.updateTableToken(tok.id, { spellUses });
        tok.spellUses = spellUses;
        changed = true;
      }
      if (changed) broadcastUses(tok);

      // The card.
      const sc = SD.monsterSpellcasting(data);
      const castLevel = mode === 'slot' ? opt.level : row.s.level;
      const cr = parseFloat(data.cr && typeof data.cr === 'object' ? data.cr.cr : data.cr) || 1;
      const info = SD.spellCastInfo(row.s, row.lib ? row.lib.data : null, castLevel, sc.casterLevel || Math.max(1, Math.round(cr)));
      const hidden = !tok.visible;
      const sender = String(tok.label || String(tok.name || 'Monster').split(' ').pop() || 'Monster').slice(0, 40);
      const entry = {
        id: genId(),
        type: 'spell',
        sender,
        charId: '',
        tokenId: tok.id,
        spell: {
          name: row.s.name, level: row.s.level, castLevel, mode,
          school: SD.spellSchoolName(row.s.school),
          castText: row.s.castText || SD.spellCastLabel(row.s),
          range: row.s.range, duration: row.s.duration, conc: row.s.conc, ritual: row.s.ritual,
          components: SD.spellComponentsLabel(row.s),
        },
        desc: String(SD.spellDescHTML(row.s) || '').slice(0, 8000),
        attack: info.attack,
        attackBonus: info.attack ? sc.hit : '',
        save: info.save,
        saveDc: info.save ? sc.dc : '',
        damage: info.damage,
        damageType: info.damageType,
        healing: info.healing,
        ...(hidden ? { dmOnly: true } : {}),
        timestamp: new Date().toISOString(),
      };
      ldb.appendChatLog(entry);
      broadcast('chat', entry, undefined, hidden ? { dmOnly: true } : {});
      res.json({ ok: true, spellUses: tok.spellUses || '', entry });
    } catch (err) { console.error('POST /api/table/tokens/:id/cast:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Rest: every spell use back, for one token.
  app.post('/api/table/tokens/:id/spell-rest', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const tok = ldb.getTableToken(req.params.id);
      if (!tok) return res.status(404).json({ error: 'Not found' });
      if (tok.spellUses) {
        ldb.updateTableToken(tok.id, { spellUses: '' });
        tok.spellUses = '';
        broadcastUses(tok);
      }
      res.json({ ok: true });
    } catch (err) { console.error('POST /api/table/tokens/:id/spell-rest:', err); res.status(500).json({ error: 'Server error' }); }
  });

  // Rest: every monster token on the table.
  app.post('/api/table/spell-rest', (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      let n = 0;
      for (const tok of ldb.listTableTokens()) {
        if (!tok.spellUses) continue;
        ldb.updateTableToken(tok.id, { spellUses: '' });
        tok.spellUses = '';
        broadcastUses(tok);
        n++;
      }
      res.json({ ok: true, rested: n });
    } catch (err) { console.error('POST /api/table/spell-rest:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
