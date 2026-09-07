'use strict';

// TLS trust for self-hosted servers.
//
// The production server terminates TLS itself and is commonly reached by IP.
// A public CA cannot issue a certificate for a bare IP address, so Chromium
// will reject it. Rather than globally disabling verification (which would also
// silently accept a real man-in-the-middle), the user is asked once per host and
// the approved fingerprint is pinned in the config. If that fingerprint ever
// changes, the prompt comes back.

const { session, dialog } = require('electron');
const config = require('./config');

const NET_OK = 0;          // trust this certificate
const NET_REJECT = -2;     // reject it
const NET_USE_CHROMIUM = -3; // defer to Chromium's own verification

const pending = new Map(); // hostname -> Promise<boolean>, so N parallel requests prompt once

function fingerprintOf(cert) {
  return (cert && cert.fingerprint) || '';
}

function describe(hostname, cert, errorCode) {
  const lines = [
    `Server: ${hostname}`,
    `Issued to: ${(cert && cert.subjectName) || 'unknown'}`,
    `Issued by: ${(cert && cert.issuerName) || 'unknown'}`,
  ];
  if (cert && cert.validStart && cert.validExpiry) {
    const fmt = (s) => new Date(s * 1000).toLocaleDateString();
    lines.push(`Valid: ${fmt(cert.validStart)} – ${fmt(cert.validExpiry)}`);
  }
  lines.push(`Fingerprint: ${fingerprintOf(cert)}`);
  lines.push('', `Reason it failed: ${errorCode}`);
  return lines.join('\n');
}

async function askUser(hostname, cert, errorCode) {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Do not connect', 'Trust this certificate'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Certificate could not be verified',
    message: `The certificate for ${hostname} is not trusted.`,
    detail:
      describe(hostname, cert, errorCode) +
      '\n\nThis is expected for a self-hosted server reached by IP address, or one ' +
      'using a self-signed certificate. Only continue if this is your own server ' +
      'and the fingerprint above is the one you expect.',
  });
  return response === 1;
}

function trust(hostname, fingerprint) {
  const trusted = config.get('trustedCerts') || {};
  trusted[hostname] = fingerprint;
  config.set('trustedCerts', trusted);
}

function isTrusted(hostname, fingerprint) {
  const trusted = config.get('trustedCerts') || {};
  return !!fingerprint && trusted[hostname] === fingerprint;
}

function forget(hostname) {
  const trusted = config.get('trustedCerts') || {};
  delete trusted[hostname];
  config.set('trustedCerts', trusted);
}

function forgetAll() {
  config.set('trustedCerts', {});
}

function install() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const { hostname, certificate, verificationResult, errorCode } = request;

    if (verificationResult === 'net::OK') return callback(NET_USE_CHROMIUM);

    const fingerprint = fingerprintOf(certificate);
    if (isTrusted(hostname, fingerprint)) return callback(NET_OK);

    if (pending.has(hostname)) {
      pending.get(hostname).then((ok) => callback(ok ? NET_OK : NET_REJECT));
      return;
    }

    const p = askUser(hostname, certificate, errorCode || verificationResult)
      .then((approved) => {
        if (approved) trust(hostname, fingerprint);
        return approved;
      })
      .catch(() => false)
      .finally(() => { pending.delete(hostname); });

    pending.set(hostname, p);
    p.then((ok) => callback(ok ? NET_OK : NET_REJECT));
  });
}

module.exports = { install, trust, isTrusted, forget, forgetAll };
