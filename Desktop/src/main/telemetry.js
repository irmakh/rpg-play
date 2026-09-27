// Written by Irmak Hakman — 2026-09-27 17:36
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

'use strict';

// Install report: at launch, at most once a day, tell the licensor's server
// that this copy of the desktop client exists. Documented in the README and
// switched off with "Send an anonymous install report" in Settings.
//
// Sent — and nothing else: a random install id (made on first run, kept in
// config.json), "desktop", the app version, OS + architecture, and the HOST
// part of the configured server URL. It never delays startup and never shows
// an error: a report that fails is tried again at the next launch.

const crypto = require('crypto');
const { app, net } = require('electron');
const config = require('./config');

const REPORT_URL = 'https://dnd.kimse.me/api/telemetry/ping';
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

function serverHost(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function buildPayload() {
  let installId = config.get('installId');
  if (!installId) {
    installId = crypto.randomUUID();
    config.set('installId', installId);
  }
  return {
    installId,
    kind: 'desktop',
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    serverHost: serverHost(config.get('serverUrl')),
  };
}

function post(payload) {
  return new Promise((resolve) => {
    let request;
    try {
      request = net.request({ method: 'POST', url: REPORT_URL });
    } catch { return resolve(false); }
    const timer = setTimeout(() => { try { request.abort(); } catch {} resolve(false); }, TIMEOUT_MS);
    request.setHeader('Content-Type', 'application/json');
    request.on('response', (res) => {
      clearTimeout(timer);
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      res.on('error', () => resolve(false));
    });
    request.on('error', () => { clearTimeout(timer); resolve(false); });
    request.end(JSON.stringify(payload));
  });
}

async function reportOnLaunch(now = Date.now()) {
  if (config.get('telemetryEnabled') === false) return false;
  if (now - (Number(config.get('lastReportAt')) || 0) < DAY_MS) return false;
  const ok = await post(buildPayload());
  if (ok) config.set('lastReportAt', now);
  return ok;
}

module.exports = { reportOnLaunch, buildPayload, serverHost, REPORT_URL };
