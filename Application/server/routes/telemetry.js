// Written by Irmak Hakman — 2026-09-27 18:14
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

/**
 * Install-report collector: the receiving end of lib/telemetry.js and of the
 * desktop client's launch report.
 *
 * Runs on the licensor's server only; everywhere else the route does not
 * exist and POST /api/telemetry/ping is a plain 404. The reports are listed
 * on the maintenance page (GET /api/maintenance/installs, super-admin only).
 *
 * No login — installs out in the world have none on this server — so every
 * field is checked and cut to size, and each address may report 30 times an
 * hour.
 */
import { clientIp } from '../../lib/login-guard.js';
import { verifyPassword } from '../../lib/passwords.js';

const COLLECTOR_KEY_HASH = '979677dc07d5516d22240f5c648bf925:28aefcc5338948f13d2cc9467503f546428b267015016fd48583b7661c1f89dea34c3f7db65dcbfb3bc5e6eb8912d9bcc08eb6648592d6020ae13a39ba84085b';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['server', 'desktop']);
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
const count = v => (Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);

/** A cleaned report, or null when it is not one. */
export function cleanReport(body) {
  if (!body || typeof body !== 'object') return null;
  const installId = str(body.installId, 36).toLowerCase();
  const kind = str(body.kind, 16);
  if (!UUID.test(installId) || !KINDS.has(kind)) return null;
  return {
    installId, kind,
    version: str(body.version, 32),
    platform: str(body.platform, 64),
    node: str(body.node, 32),
    campaigns: count(body.campaigns),
    characters: count(body.characters),
    activeUsers7d: count(body.activeUsers7d),
    hosts: Array.isArray(body.hosts) ? body.hosts.slice(0, 5).map(h => str(h, 253).toLowerCase()).filter(Boolean) : [],
    serverHost: str(body.serverHost, 253).toLowerCase(),
  };
}

/** True only for the key whose scrypt hash is COLLECTOR_KEY_HASH. */
export function collectorKeyValid(key, keyHash = COLLECTOR_KEY_HASH) {
  const k = String(key ?? '').trim();
  return !!k && verifyPassword(k, keyHash);
}

export function collectorEnabled(env = process.env) {
  return collectorKeyValid(env.TELEMETRY_COLLECTOR);
}

export default function register(app, ctx) {
  const { cdb, TRUST_PROXY } = ctx;
  const hits = new Map();   // ip -> [timestamps]

  function limited(ip, now = Date.now()) {
    const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 10000) hits.clear();   // memory bound; worst case a few extra reports
    return recent.length > RATE_MAX;
  }

  app.post('/api/telemetry/ping', (req, res) => {
    const ip = str(clientIp(req, TRUST_PROXY), 64);
    if (limited(ip)) return res.status(429).json({ error: 'Too many reports' });
    const report = cleanReport(req.body);
    if (!report) return res.status(400).json({ error: 'Bad report' });
    try {
      cdb.upsertInstall({ ...report, lastIp: ip });
    } catch (err) {
      console.warn('[telemetry] could not store a report:', err.message);
      return res.status(500).json({ error: 'Not stored' });
    }
    res.json({ ok: true });
  });
}
