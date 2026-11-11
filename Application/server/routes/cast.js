// Written by Irmak Hakman — 2026-11-11 21:15
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Casting a spell — POST /api/characters/:id/cast.
 *
 *   { spellId, name, level, mode: 'slot'|'free'|'ritual'|'cantrip', slotLevel }
 *
 * The server decides, with the same rules the Cast a Spell pop-up shows
 * (spellCastOptions in public/js/lib/spell-data.js): the spell must be ready,
 * and a slot of the chosen level (the spell's own or higher) must be left, or
 * the spell's own free use. It then spends exactly that, saves the sheet,
 * posts a spell card to the chat and tells the other screens. Two casts at
 * once cannot both spend the last slot: the check and the write happen in one
 * synchronous step on the stored sheet, not on what a page last saw.
 *
 * `name` and `level` find the spell when its id has changed — a sheet still
 * holding pre-v320 spell rows gets new ids every time it is read, until the
 * first save stores them; this is that save.
 */
import { SpellData as SD } from '../../lib/spell-data-node.js';

const MODES = new Set(['slot', 'free', 'ritual', 'cantrip']);
const MAX_DESC = 8000;

export default function register(app, ctx) {
  const { ldb, genId, masterAuth, sessionAuth, charAuth, getCharacter, broadcast } = ctx;

  app.post('/api/characters/:id/cast', async (req, res) => {
    try {
      const charId = String(req.params.id);
      // A login to this campaign, and this character's (or the DM's).
      if (!masterAuth(req)) {
        if (!sessionAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
        const st = await charAuth(charId, req);
        if (st !== 200) return res.status(st).json({ error: st === 404 ? 'Not found' : 'Unauthorized' });
      }
      const b = req.body || {};
      const mode = String(b.mode || '');
      if (!MODES.has(mode)) return res.status(400).json({ error: 'mode must be slot, free, ritual or cantrip' });
      const slotLevel = parseInt(b.slotLevel, 10);

      const char = await getCharacter(charId);
      if (!char) return res.status(404).json({ error: 'Not found' });
      let data = {};
      try { data = JSON.parse(char.dataJson || '{}'); } catch {}
      const list = SD.parseSpellList(data._spells);
      const wasArrays = typeof data._spells === 'string' && /^\s*\[\s*\[/.test(data._spells);

      let sp = list.find(s => s.id === String(b.spellId || ''));
      if (!sp && b.name) {
        const n = String(b.name).trim().toLowerCase();
        const lv = parseInt(b.level, 10);
        sp = list.find(s => s.name.toLowerCase() === n && (!Number.isInteger(lv) || s.level === lv));
      }
      if (!sp) return res.status(404).json({ error: 'That spell is not on this sheet.' });

      const opts = SD.spellCastOptions(sp, data);
      if (!opts.options.length) return res.status(409).json({ error: `${sp.name}: ${opts.reason}`, code: 'NOT_READY' });
      const opt = opts.options.find(o => o.mode === mode && (mode !== 'slot' || o.level === slotLevel));
      if (!opt) {
        return res.status(400).json({ error: mode === 'slot' ? `${sp.name} cannot be cast with a level ${slotLevel || '?'} slot.` : `${sp.name} cannot be cast that way.` });
      }
      if (!opt.available) {
        return res.status(409).json({ error: mode === 'slot' ? `No level ${slotLevel} slots left.` : (mode === 'free' ? `${sp.name} has no uses left.` : opts.reason), code: 'SPENT' });
      }

      // Spend it.
      const keys = [];
      if (mode === 'slot') {
        const k = `slot-${slotLevel}-used`;
        data[k] = String((parseInt(data[k], 10) || 0) + 1);
        keys.push(k);
      } else if (mode === 'free' && sp.uses) {
        sp.used = Math.min(sp.uses, sp.used + 1);
        keys.push('_spells');
      }
      if (wasArrays && !keys.includes('_spells')) keys.push('_spells');
      if (keys.includes('_spells')) data._spells = JSON.stringify(list);
      if (keys.length) {
        ldb.updateCharacter(charId, { dataJson: JSON.stringify(data) });
        broadcast('characters', { action: 'updated', id: charId, keys });
      }

      // The card.
      const castLevel = mode === 'slot' ? slotLevel : sp.level;
      const lib = sp.libId ? ldb.getSpell(sp.libId) : null;
      const charLevel = parseInt(data.level || data['total-level'] || data['char-level'], 10) || 1;
      const info = SD.spellCastInfo(sp, lib ? lib.data : null, castLevel, charLevel);
      const entry = {
        id: genId(),
        type: 'spell',
        sender: String(char.name || 'Unnamed').slice(0, 40),
        charId,
        spell: {
          name: sp.name, level: sp.level, castLevel, mode,
          school: SD.spellSchoolName(sp.school),
          castText: sp.castText || SD.spellCastLabel(sp),
          range: sp.range, duration: sp.duration, conc: sp.conc, ritual: sp.ritual,
          components: SD.spellComponentsLabel(sp),
        },
        // Built escaped by spellDescHTML; every chat page also sanitises it.
        desc: String(SD.spellDescHTML(sp) || '').slice(0, MAX_DESC),
        attack: info.attack,
        attackBonus: info.attack ? String(data['sp-atk'] ?? '').slice(0, 8) : '',
        save: info.save,
        saveDc: info.save ? String(data['sp-dc'] ?? '').slice(0, 4) : '',
        damage: info.damage,
        damageType: info.damageType,
        healing: info.healing,
        timestamp: new Date().toISOString(),
      };
      ldb.appendChatLog(entry);
      broadcast('chat', entry);

      ctx.notify?.({
        to: 'all', exclude: [charId], kind: 'chat', actorName: entry.sender, priority: 'feed',
        title: `${entry.sender} cast ${sp.name}`,
        body: castLevel > sp.level ? `at level ${castLevel}` : '',
        coalesce: true,
        coalesceTitle: `${entry.sender} — {count} spells`,
        coalesceBody: `Latest: ${sp.name}`,
        line: sp.name,
        data: { href: '/table.html' },
      });

      const changed = {};
      for (const k of keys) changed[k] = data[k];
      res.json({ ok: true, keys, data: changed, entry });
    } catch (err) { console.error('POST /api/characters/:id/cast:', err); res.status(500).json({ error: 'Server error' }); }
  });
}
