/**
 * One-time migration: SQLite → InstantDB
 * Run once: node migrate.js
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { init, id as genId } from '@instantdb/admin';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const APP_ID      = process.env.INSTANT_APP_ID    || '78945351-e9c4-4172-adac-b6c4b481a73f';
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
if (!ADMIN_TOKEN) { console.error('INSTANT_ADMIN_TOKEN required'); process.exit(1); }

const db     = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
const sqlite = new Database(path.join(__dirname, 'characters.db'));

async function migrate() {
  console.log('=== InstantDB Migration ===\n');

  // ── Characters ──
  const characters = sqlite.prepare('SELECT * FROM characters').all();
  const charIdMap  = new Map(); // old integer id → new UUID

  console.log(`Migrating ${characters.length} character(s)…`);
  for (const c of characters) {
    const newId = genId();
    charIdMap.set(c.id, newId);
    await db.transact([db.tx.characters[newId].update({
      name:         c.name,
      dataJson:     c.data || '{}',
      charType:     c.char_type || 'pc',
      passwordHash: c.password_hash || '',
      createdAt:    new Date().toISOString(),
    })]);
    console.log(`  ✓ ${c.name}  (${c.id} → ${newId})`);
  }

  // ── Media ──
  const media = sqlite.prepare('SELECT * FROM media').all();
  console.log(`\nMigrating ${media.length} media record(s)…`);
  for (const m of media) {
    const newCharId = charIdMap.get(m.char_id);
    if (!newCharId) { console.warn(`  ⚠ Skipping media ${m.id}: char ${m.char_id} not found`); continue; }
    const newId = genId();
    await db.transact([db.tx.media[newId].update({
      charId:       newCharId,
      originalName: m.original_name,
      mimeType:     m.mime_type,
      dataUrl:      m.data_url,
      isPortrait:   !!m.is_portrait,
      createdAt:    m.created_at || new Date().toISOString(),
    })]);
    console.log(`  ✓ ${m.original_name}`);
  }

  // ── Shop items ──
  const shopItems = sqlite.prepare('SELECT * FROM shop_items').all();
  console.log(`\nMigrating ${shopItems.length} shop item(s)…`);
  for (const item of shopItems) {
    const newId = genId();
    await db.transact([db.tx.shopItems[newId].update({
      name:                item.name,
      itemType:            item.item_type    || 'wondrous',
      armorType:           item.armor_type   || 'light',
      acBase:              item.ac_base      ?? 10,
      valueCp:             item.value_cp     ?? 0,
      quantity:            item.quantity     ?? 1,
      acBonus:             item.ac_bonus     ?? 0,
      initBonus:           item.init_bonus   ?? 0,
      speedBonus:          item.speed_bonus  ?? 0,
      requiresAttunement:  !!item.requires_attunement,
      notes:               item.notes        || '',
      weaponAtk:           item.weapon_atk   || '',
      weaponDmg:           item.weapon_dmg   || '',
      weaponPropertiesJson: item.weapon_properties || '[]',
      createdAt:           item.created_at   || new Date().toISOString(),
    })]);
    console.log(`  ✓ ${item.name}`);
  }

  // ── Purchase logs ──
  const logs = sqlite.prepare('SELECT * FROM purchase_logs').all();
  console.log(`\nMigrating ${logs.length} purchase log(s)…`);
  for (const log of logs) {
    const newCharId = charIdMap.get(log.char_id) || String(log.char_id);
    await db.transact([db.tx.purchaseLogs[genId()].update({
      charId:      newCharId,
      charName:    log.char_name,
      itemName:    log.item_name,
      qty:         log.qty,
      totalCp:     log.total_cp,
      purchasedAt: log.purchased_at || new Date().toISOString(),
    })]);
    console.log(`  ✓ ${log.char_name} → ${log.item_name}`);
  }

  sqlite.close();
  console.log('\n✅ Migration complete!');
  console.log(`   Characters: ${characters.length}, Media: ${media.length}, Shop: ${shopItems.length}, Logs: ${logs.length}`);
}

migrate().catch(err => { console.error(err); process.exit(1); });
