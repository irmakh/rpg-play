// Written by Irmak Hakman — 2026-09-27 17:26
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Install reporting: once at startup and then once a day, tell the licensor's
 * server that this install exists and roughly how much it is used.
 *
 * Documented in README.md ("Install reporting") and announced in one log line
 * at startup. TELEMETRY=off in .env switches it off entirely.
 *
 * What is sent — and nothing else:
 *   installId      random UUID made on first run (campaigns.db `settings`)
 *   kind           "server"
 *   version        FRONTEND_VERSION
 *   node, platform Node version, OS and CPU architecture
 *   campaigns, characters, activeUsers7d   counts only, never names
 *   hosts          up to 5 Host headers this server was reached by since boot
 *
 * It never blocks startup and never throws: a report that fails is simply
 * tried again the next day.
 */

export const DEFAULT_TELEMETRY_URL = 'https://dnd.kimse.me';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOSTS = 5;

export function telemetryEnabled(env = process.env) {
  const v = String(env.TELEMETRY ?? '').trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(v);
}

/** Remembers the first few distinct Host headers this server answers to. */
export function createHostTracker(max = MAX_HOSTS) {
  const hosts = new Set();
  return {
    middleware(req, res, next) {
      if (hosts.size < max) {
        const h = String(req.headers.host || '').trim().toLowerCase().slice(0, 253);
        if (h) hosts.add(h);
      }
      next();
    },
    list: () => [...hosts],
  };
}

/**
 * @param deps.getInstallId      () => string
 * @param deps.countCampaigns    () => number
 * @param deps.countCharacters   () => number
 * @param deps.countActiveUsers  () => number
 * @param deps.hosts             () => string[]
 * @param deps.version           frontend version number
 */
export function buildPayload(deps) {
  const safe = fn => { try { return fn(); } catch { return null; } };
  return {
    installId: deps.getInstallId(),
    kind: 'server',
    version: String(deps.version),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    campaigns: safe(deps.countCampaigns),
    characters: safe(deps.countCharacters),
    activeUsers7d: safe(deps.countActiveUsers),
    hosts: (safe(deps.hosts) || []).slice(0, MAX_HOSTS),
  };
}

export async function sendReport(url, payload, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/telemetry/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start reporting. Returns a stop() function, or null when switched off.
 * The first report goes out a minute after boot, so hosts have been seen.
 */
export function startTelemetry(deps, { env = process.env, log = console.log, fetchImpl = fetch,
                                       firstDelayMs = 60 * 1000, intervalMs = DAY_MS } = {}) {
  if (!telemetryEnabled(env)) return null;
  const url = String(env.TELEMETRY_URL || DEFAULT_TELEMETRY_URL).trim();
  //log(`Install report: sending anonymous usage counts to ${url} once a day (set TELEMETRY=off to disable)`);

  const run = () => { sendReport(url, buildPayload(deps), { fetchImpl }).catch(() => {}); };
  const first = setTimeout(run, firstDelayMs);
  const every = setInterval(run, intervalMs);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
