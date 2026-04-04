/**
 * Clears all data from InstantDB namespaces, then exits.
 * Run: node clear-db.js
 */
import 'dotenv/config';
import { init } from '@instantdb/admin';

const APP_ID      = process.env.INSTANT_APP_ID    || '78945351-e9c4-4172-adac-b6c4b481a73f';
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
if (!ADMIN_TOKEN) { console.error('INSTANT_ADMIN_TOKEN required'); process.exit(1); }

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

async function clearNamespace(name) {
  const result = await db.query({ [name]: {} });
  const records = result[name] || [];
  if (records.length === 0) { console.log(`  ${name}: nothing to delete`); return; }
  // Delete in batches of 200 to stay within transaction limits
  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200);
    await db.transact(batch.map(r => db.tx[name][r.id].delete()));
  }
  console.log(`  ✓ ${name}: deleted ${records.length} record(s)`);
}

async function main() {
  console.log('=== Clearing InstantDB ===\n');
  await clearNamespace('characters');
  await clearNamespace('media');
  await clearNamespace('shopItems');
  await clearNamespace('purchaseLogs');
  console.log('\n✅ Database cleared.');
}

main().catch(err => { console.error(err); process.exit(1); });
