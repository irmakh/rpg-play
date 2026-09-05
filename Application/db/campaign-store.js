/**
 * Campaign data-file store.
 *
 * Owns the on-disk layout for per-campaign data and hands out cached database
 * handles:
 *
 *   Application/data/campaigns/<campaignId>/
 *       localdb.db     core campaign state (characters, table, treasury, ...)
 *       media.db       chat images + the table map blob
 *       stories.db     the comic/story builder
 *       aiDM.db        AI DM sessions
 *
 * Handles are opened lazily on first use and cached for the process lifetime —
 * better-sqlite3 connections are cheap and a campaign that is touched once is
 * usually touched again.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { openCampaignDb } from './localdb.js';
import { openMediaDb }    from './mediadb.js';
import { openStoriesDb }  from './storiesdb.js';
import { openAiDmDb }     from '../aiDM/db.js';
import * as cdb           from './campaignsdb.js';
import { LEGACY_CAMPAIGN_ID } from './campaignsdb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const APP_DIR    = path.join(__dirname, '..');
// CAMPAIGN_DATA_DIR lets tests (and an alternative deployment layout) put the
// per-campaign files somewhere other than Application/data/campaigns.
const CAMPAIGNS_DIR = process.env.CAMPAIGN_DATA_DIR || path.join(APP_DIR, 'data', 'campaigns');

export const DB_FILES = {
  local:   'localdb.db',
  media:   'media.db',
  stories: 'stories.db',
  aidm:    'aiDM.db',
};

export function campaignDir(campaignId) {
  // Campaign ids are UUIDs we generate, but never build a path from unvalidated
  // input — a stray separator would escape the data directory.
  if (!/^[A-Za-z0-9._-]+$/.test(String(campaignId || ''))) {
    throw new Error(`invalid campaign id: ${campaignId}`);
  }
  return path.join(CAMPAIGNS_DIR, String(campaignId));
}

// campaignId -> { ldb, mdb, sdb, adb }
const cache = new Map();

/**
 * Opens (and caches) every database for one campaign. Creating the directory is
 * enough to provision a campaign — each open*Db runs CREATE TABLE IF NOT EXISTS
 * against a fresh file, producing the full current schema.
 */
export function getCampaignData(campaignId) {
  const hit = cache.get(campaignId);
  if (hit) return hit;

  const dir = campaignDir(campaignId);
  fs.mkdirSync(dir, { recursive: true });

  const data = {
    campaignId,
    ldb: openCampaignDb(path.join(dir, DB_FILES.local)),
    mdb: openMediaDb(path.join(dir, DB_FILES.media)),
    sdb: openStoriesDb(path.join(dir, DB_FILES.stories)),
    adb: openAiDmDb(path.join(dir, DB_FILES.aidm)),
  };
  cache.set(campaignId, data);
  return data;
}

/** Closes and forgets a campaign's handles — call before deleting its files. */
export function releaseCampaign(campaignId) {
  const data = cache.get(campaignId);
  if (!data) return;
  for (const key of ['ldb', 'mdb', 'sdb', 'adb']) { try { data[key].close(); } catch {} }
  cache.delete(campaignId);
}

/** Removes a campaign's entire data directory. Irreversible. */
export function destroyCampaignData(campaignId) {
  releaseCampaign(campaignId);
  fs.rmSync(campaignDir(campaignId), { recursive: true, force: true });
}

/** Byte size of a campaign's data files — shown on the campaign detail panel. */
export function campaignDataSize(campaignId) {
  let total = 0;
  try {
    const dir = campaignDir(campaignId);
    for (const f of fs.readdirSync(dir)) {
      try { total += fs.statSync(path.join(dir, f)).size; } catch {}
    }
  } catch {}
  return total;
}

// ── One-time bootstrap ────────────────────────────────────────────────────────

/**
 * Creates the first campaign and moves the pre-multi-tenant databases into it.
 *
 * Runs only when the registry is empty, so it is a no-op on every later boot.
 * The legacy files are COPIED, not moved: the originals stay where they are as
 * an untouched rollback until you are satisfied the migration is good.
 *
 * @param defaultDmPassword  plaintext DM password for the migrated campaign
 */
export function bootstrapCampaigns({ legacyName, defaultDmPassword, log = console.log } = {}) {
  if (cdb.countCampaigns() > 0) return null;

  const campaign = cdb.createCampaign({
    id: LEGACY_CAMPAIGN_ID,
    name: legacyName || 'For the Glory of Amn',
    description: 'The original campaign — all data from before campaigns existed.',
    dmPassword: defaultDmPassword,
  });

  const dir = campaignDir(campaign.id);
  fs.mkdirSync(dir, { recursive: true });

  // Legacy location -> new per-campaign filename
  const moves = [
    [path.join(APP_DIR, 'localdb.db'),        DB_FILES.local],
    [path.join(APP_DIR, 'media.db'),          DB_FILES.media],
    [path.join(APP_DIR, 'stories.db'),        DB_FILES.stories],
    [path.join(APP_DIR, 'aiDM', 'aiDM.db'),   DB_FILES.aidm],
  ];
  for (const [from, name] of moves) {
    const to = path.join(dir, name);
    if (fs.existsSync(to)) continue;          // never overwrite migrated data
    if (!fs.existsSync(from)) continue;       // fresh install — schema is created on open
    fs.copyFileSync(from, to);
    log(`[campaigns] migrated ${path.basename(from)} -> ${campaign.name}`);
  }

  log(`[campaigns] bootstrapped "${campaign.name}" (${campaign.id})`);
  return campaign;
}
