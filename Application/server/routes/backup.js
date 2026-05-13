import express from 'express';

export default function register(app, ctx) {
  const {
    ldb, idb, DB_PROVIDER,
    masterAuth,
    processImageSizes, saveUploadFile, readUploadAsBase64,
    IMAGE_MIME, extToMime,
    mediaDb,
    broadcast,
    path, fs, __dirname,
  } = ctx;

  const BACKUP_PARTS = ['characters', 'monsters', 'shop', 'loot', 'maps'];

  function _sharedMediaWithData(rows) {
    return rows.map(r => {
      const s = r.data.toString();
      const dataB64 = s.startsWith('FILE:') ? readUploadAsBase64(s.slice(5)) : Buffer.from(r.data).toString('base64');
      return { id: r.id, mime_type: r.mime_type, dataB64, created_at: r.created_at };
    });
  }

  async function buildBackupPart(partName) {
    const timestamp = new Date().toISOString();
    const base = { version: '1.0', type: partName, timestamp, dbProvider: DB_PROVIDER };
    switch (partName) {
      case 'characters': {
        if (DB_PROVIDER === 'localdb') {
          const { characters, media } = ldb.exportAll();
          return { ...base, characters, media: media.map(r => ({
            id: r.id, charId: r.charId, originalName: r.originalName,
            mimeType: r.mimeType, dataUrl: r.dataUrl,
            isPortrait: r.isPortrait, createdAt: r.createdAt,
            dataB64: readUploadAsBase64(r.dataUrl),
          })) };
        }
        const [cr, mr] = await Promise.all([idb.query({ characters: {} }), idb.query({ media: {} })]);
        return { ...base, characters: cr.characters || [], media: mr.media || [] };
      }
      case 'monsters': {
        if (DB_PROVIDER === 'localdb') {
          const monsterRows = ldb.listMonsters();
          const monsters = await Promise.all(monsterRows.map(async m => {
            let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
            const { portraitThumb, portraitMedium, ...dWithoutThumbs } = d;
            return { ...m, dataJson: JSON.stringify(dWithoutThumbs), portraitB64: readUploadAsBase64(d.portrait) };
          }));
          return { ...base, monsters };
        }
        const mr = await idb.query({ monsters: {} });
        return { ...base, monsters: mr.monsters || [] };
      }
      case 'shop': {
        if (DB_PROVIDER === 'localdb') {
          return { ...base, shopConfig: [ldb.getShopConfig()], shopItems: ldb.listShopItems(), purchaseLogs: ldb.listPurchaseLogs() };
        }
        const [cr, ir, lr] = await Promise.all([idb.query({ shopConfig: {} }), idb.query({ shopItems: {} }), idb.query({ purchaseLogs: {} })]);
        return { ...base, shopConfig: cr.shopConfig || [], shopItems: ir.shopItems || [], purchaseLogs: lr.purchaseLogs || [] };
      }
      case 'loot': {
        if (DB_PROVIDER === 'localdb') {
          return { ...base, lootItems: ldb.listLootItems(), lootLogs: ldb.listLootLogs() };
        }
        const [ir, lr] = await Promise.all([idb.query({ lootItems: {} }), idb.query({ lootLogs: {} })]);
        return { ...base, lootItems: ir.lootItems || [], lootLogs: lr.lootLogs || [] };
      }
      case 'maps': {
        const preparedMaps = DB_PROVIDER === 'localdb' ? ldb.listPreparedMaps() : [];
        const mapMediaIds = new Set(preparedMaps.map(m => 'prep-map-' + m.id));
        const mapIds = [...mapMediaIds];
        let mapRows = [], chatRows = [];
        if (mapIds.length > 0) {
          const ph = mapIds.map(() => '?').join(',');
          mapRows  = mediaDb.prepare(`SELECT id, mime_type, data, created_at FROM shared_media WHERE id IN (${ph})`).all(...mapIds);
          chatRows = mediaDb.prepare(`SELECT id, mime_type, data, created_at FROM shared_media WHERE id NOT IN (${ph})`).all(...mapIds);
        } else {
          chatRows = mediaDb.prepare('SELECT id, mime_type, data, created_at FROM shared_media').all();
        }
        return {
          ...base,
          preparedMaps,
          mapImages: _sharedMediaWithData(mapRows),
          chatMedia: _sharedMediaWithData(chatRows),
        };
      }
      default: throw new Error('Unknown backup part: ' + partName);
    }
  }

  let _backupRunning = false;

  app.get('/api/admin/backup', async (req, res) => {
    if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const part = (req.query.part || '').trim();
    if (!BACKUP_PARTS.includes(part)) return res.status(400).json({ error: `Invalid part. Choose one of: ${BACKUP_PARTS.join(', ')}` });
    if (_backupRunning) return res.status(409).json({ error: 'Backup already in progress — please wait.' });
    _backupRunning = true;
    try {
      const data = await buildBackupPart(part);
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="dnd-backup-${part}-${date}.json"`);
      res.json(data);
    } catch (err) {
      console.error('Backup error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Backup failed: ' + err.message });
    } finally {
      _backupRunning = false;
    }
  });

  app.post('/api/admin/restore', express.json({ limit: '200mb' }), async (req, res) => {
    try {
      if (!masterAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const backup = req.body;
      if (!backup || !backup.version) return res.status(400).json({ error: 'Invalid backup file' });

      function writeUploadFile(fileUrl, dataB64) {
        if (!fileUrl || !dataB64 || !fileUrl.startsWith('/uploads/')) return;
        const absPath = path.join(__dirname, 'public', fileUrl);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, Buffer.from(dataB64, 'base64'));
      }

      if (backup.type && (BACKUP_PARTS.includes(backup.type) || backup.type === 'monster')) {
        if (DB_PROVIDER === 'localdb') {
          switch (backup.type) {
            case 'characters': {
              const restoredMedia = [];
              for (const r of (backup.media || [])) {
                writeUploadFile(r.dataUrl, r.dataB64);
                let thumbUrl = '', mediumUrl = '';
                if (IMAGE_MIME.has(r.mimeType) && r.dataB64) {
                  try {
                    const buf = Buffer.from(r.dataB64, 'base64');
                    const baseId = path.basename(r.dataUrl, path.extname(r.dataUrl));
                    const urls = await processImageSizes(r.mimeType, buf, 'characters', baseId);
                    thumbUrl = urls.thumb; mediumUrl = urls.medium;
                  } catch {}
                }
                restoredMedia.push({ ...r, thumbUrl, mediumUrl });
              }
              ldb.importCharacters(backup.characters, restoredMedia);
              broadcast('characters', { action: 'reload' });
              break;
            }
            case 'monster':
            case 'monsters': {
              const restoredMonsters = [];
              for (const m of (backup.monsters || [])) {
                let d = {}; try { d = JSON.parse(m.dataJson || '{}'); } catch {}
                if (m.portraitB64 && d.portrait) {
                  writeUploadFile(d.portrait, m.portraitB64);
                  try {
                    const buf = Buffer.from(m.portraitB64, 'base64');
                    const baseId = path.basename(d.portrait, path.extname(d.portrait));
                    const urls = await processImageSizes(extToMime(d.portrait), buf, 'monsters', baseId);
                    d.portraitThumb = urls.thumb;
                    d.portraitMedium = urls.medium;
                  } catch {}
                }
                restoredMonsters.push({ ...m, dataJson: JSON.stringify(d) });
              }
              ldb.importMonsters(restoredMonsters);
              broadcast('monsters', { action: 'reload' });
              break;
            }
            case 'shop': {
              ldb.importShop(backup.shopConfig, backup.shopItems, backup.purchaseLogs);
              broadcast('shop', { action: 'reload' });
              break;
            }
            case 'loot': {
              ldb.importLoot(backup.lootItems, backup.lootLogs);
              broadcast('loot', { action: 'reload' });
              break;
            }
            case 'maps': {
              ldb.importMaps(backup.preparedMaps);
              const checkMedia = mediaDb.prepare('SELECT id FROM shared_media WHERE id = ?');
              const insMedia   = mediaDb.prepare('INSERT OR IGNORE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
              for (const r of [...(backup.mapImages || []), ...(backup.chatMedia || [])]) {
                if (r.id && r.mime_type && r.dataB64 && !checkMedia.get(r.id)) {
                  const subdir = r.id.startsWith('prep-map-') ? 'maps' : 'media';
                  const fileUrl = saveUploadFile(subdir, r.id, r.mime_type, r.dataB64);
                  insMedia.run(r.id, r.mime_type, Buffer.from('FILE:' + fileUrl), r.created_at || Date.now());
                }
              }
              broadcast('table', { action: 'map-updated' });
              break;
            }
          }
        } else {
          const ops = [];
          if (backup.type === 'characters') {
            const [exC, exM] = await Promise.all([idb.query({ characters: {} }), idb.query({ media: {} })]);
            ops.push(...(exC.characters || []).map(r => idb.tx.characters[r.id].delete()));
            ops.push(...(exM.media || []).map(r => idb.tx.media[r.id].delete()));
            ops.push(...(backup.characters || []).map(r => idb.tx.characters[r.id].update({ name: r.name || '', dataJson: r.dataJson || '{}', charType: r.charType || 'pc', passwordHash: r.passwordHash || '', createdAt: r.createdAt })));
            ops.push(...(backup.media || []).map(r => idb.tx.media[r.id].update({ charId: r.charId || '', name: r.originalName || '', mimeType: r.mimeType || '', dataJson: r.dataUrl || '', createdAt: r.createdAt })));
            broadcast('characters', { action: 'reload' });
          } else if (backup.type === 'monsters' || backup.type === 'monster') {
            const exM = await idb.query({ monsters: {} });
            ops.push(...(exM.monsters || []).map(r => idb.tx.monsters[r.id].delete()));
            ops.push(...(backup.monsters || []).map(r => idb.tx.monsters[r.id].update({ name: r.name || '', cr: r.cr || '?', dataJson: r.dataJson || '{}', createdAt: r.createdAt })));
            broadcast('monsters', { action: 'reload' });
          } else if (backup.type === 'shop') {
            const [exI, exL] = await Promise.all([idb.query({ shopItems: {} }), idb.query({ purchaseLogs: {} })]);
            ops.push(...(exI.shopItems || []).map(r => idb.tx.shopItems[r.id].delete()));
            ops.push(...(exL.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].delete()));
            ops.push(...(backup.shopConfig || []).map(r => idb.tx.shopConfig[r.id].update({ isOpen: !!r.isOpen })));
            ops.push(...(backup.shopItems || []).map(r => idb.tx.shopItems[r.id].update({ name: r.name || '', itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light', acBase: r.acBase ?? 10, valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1, acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0, requiresAttunement: !!r.requiresAttunement, notes: r.notes || '', weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '', weaponPropertiesJson: r.weaponPropertiesJson || '[]', tag: r.tag || '', createdAt: r.createdAt })));
            ops.push(...(backup.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', qty: r.qty || 1, totalCp: r.totalCp || 0, purchasedAt: r.purchasedAt || r.createdAt })));
            broadcast('shop', { action: 'reload' });
          } else if (backup.type === 'loot') {
            const [exI, exL] = await Promise.all([idb.query({ lootItems: {} }), idb.query({ lootLogs: {} })]);
            ops.push(...(exI.lootItems || []).map(r => idb.tx.lootItems[r.id].delete()));
            ops.push(...(exL.lootLogs || []).map(r => idb.tx.lootLogs[r.id].delete()));
            ops.push(...(backup.lootItems || []).map(r => idb.tx.lootItems[r.id].update({ name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt })));
            ops.push(...(backup.lootLogs || []).map(r => idb.tx.lootLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', claimedAt: r.claimedAt || r.createdAt })));
            broadcast('loot', { action: 'reload' });
          }
          for (let i = 0; i < ops.length; i += 100) await idb.transact(ops.slice(i, i + 100));
        }
        return res.json({ ok: true, type: backup.type });
      }

      // ── Legacy full backup ─────────────────────────────────────────────────────
      const rawData = backup[backup.dbProvider] || backup.localdb || backup.instantdb;
      if (!rawData) return res.status(400).json({ error: 'No data found in backup' });
      const data = { ...rawData };
      if (data.media) data.media = data.media.map(m => ({ ...m, originalName: m.originalName || m.name || '', dataUrl: m.dataUrl || m.dataJson || '' }));

      if (DB_PROVIDER === 'localdb') {
        ldb.importAll(data);
      } else {
        const [exChars, exMedia, exShopItems, exPurchLogs, exLootItems, exLootLogs, exMonsters] = await Promise.all([
          idb.query({ characters: {} }), idb.query({ media: {} }), idb.query({ shopItems: {} }),
          idb.query({ purchaseLogs: {} }), idb.query({ lootItems: {} }), idb.query({ lootLogs: {} }), idb.query({ monsters: {} }),
        ]);
        const delOps = [
          ...(exChars.characters || []).map(r => idb.tx.characters[r.id].delete()),
          ...(exMedia.media || []).map(r => idb.tx.media[r.id].delete()),
          ...(exShopItems.shopItems || []).map(r => idb.tx.shopItems[r.id].delete()),
          ...(exPurchLogs.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].delete()),
          ...(exLootItems.lootItems || []).map(r => idb.tx.lootItems[r.id].delete()),
          ...(exLootLogs.lootLogs || []).map(r => idb.tx.lootLogs[r.id].delete()),
          ...(exMonsters.monsters || []).map(r => idb.tx.monsters[r.id].delete()),
        ];
        const insOps = [
          ...(data.characters || []).map(r => idb.tx.characters[r.id].update({ name: r.name || '', dataJson: r.dataJson || '{}', charType: r.charType || 'pc', passwordHash: r.passwordHash || '', createdAt: r.createdAt })),
          ...(data.media || []).map(r => idb.tx.media[r.id].update({ charId: r.charId || '', name: r.originalName || '', mimeType: r.mimeType || '', dataJson: r.dataUrl || '', createdAt: r.createdAt })),
          ...(data.shopConfig || []).map(r => idb.tx.shopConfig[r.id].update({ isOpen: !!r.isOpen })),
          ...(data.shopItems || []).map(r => idb.tx.shopItems[r.id].update({ name: r.name || '', itemType: r.itemType || 'wondrous', armorType: r.armorType || 'light', acBase: r.acBase ?? 10, valueCp: r.valueCp ?? 0, quantity: r.quantity ?? 1, acBonus: r.acBonus ?? 0, initBonus: r.initBonus ?? 0, speedBonus: r.speedBonus ?? 0, requiresAttunement: !!r.requiresAttunement, notes: r.notes || '', weaponAtk: r.weaponAtk || '', weaponDmg: r.weaponDmg || '', weaponPropertiesJson: r.weaponPropertiesJson || '[]', createdAt: r.createdAt })),
          ...(data.purchaseLogs || []).map(r => idb.tx.purchaseLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', qty: r.qty || 1, totalCp: r.totalCp || 0, purchasedAt: r.purchasedAt || r.createdAt })),
          ...(data.lootItems || []).map(r => idb.tx.lootItems[r.id].update({ name: r.name || '', description: r.description || '', visible: !!r.visible, descVisible: !!r.descVisible, tag: r.tag || '', createdAt: r.createdAt })),
          ...(data.lootLogs || []).map(r => idb.tx.lootLogs[r.id].update({ charId: r.charId || '', charName: r.charName || '', itemName: r.itemName || '', claimedAt: r.claimedAt || r.createdAt })),
          ...(data.monsters || []).map(r => idb.tx.monsters[r.id].update({ name: r.name || '', cr: r.cr || '?', dataJson: r.dataJson || '{}', createdAt: r.createdAt })),
        ];
        const allOps = [...delOps, ...insOps];
        for (let i = 0; i < allOps.length; i += 100) await idb.transact(allOps.slice(i, i + 100));
      }

      if (backup.sqlite && Array.isArray(backup.sqlite.shared_media)) {
        mediaDb.prepare('DELETE FROM shared_media').run();
        const insMedia = mediaDb.prepare('INSERT OR REPLACE INTO shared_media (id, mime_type, data, created_at) VALUES (?, ?, ?, ?)');
        for (const r of backup.sqlite.shared_media) {
          if (r.id && r.mime_type && r.data) insMedia.run(r.id, r.mime_type, Buffer.from(r.data, 'base64'), r.created_at || Date.now());
        }
      }

      broadcast('characters', { action: 'reload' });
      broadcast('shop', { action: 'reload' });
      broadcast('loot', { action: 'reload' });
      broadcast('initiative', { action: 'reload' });
      broadcast('table', { action: 'state-updated' });
      broadcast('table', { action: 'map-updated' });
      res.json({ ok: true });
    } catch (err) { console.error('Restore error:', err); res.status(500).json({ error: 'Restore failed: ' + err.message }); }
  });
}
