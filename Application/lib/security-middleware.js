/**
 * Request-level hardening: response headers, request body limits, and the gate
 * that turns a stale credential into a clean "log in again".
 */
import express from 'express';
import { credentialHeader } from './auth.js';

/**
 * Headers for every response.
 *
 * The Content-Security-Policy deliberately has no script-src: the pages use
 * inline onclick handlers throughout, which a script policy would break. What it
 * does set costs nothing and closes real doors — no framing by other sites
 * (clickjacking), no <base> hijack, no plugins, no form posting off-site.
 *
 * HSTS only when this server itself speaks HTTPS; sending it over plain HTTP in
 * local dev would do nothing useful and could pin a dev hostname.
 */
export function securityHeaders({ hsts = false } = {}) {
  const csp = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'";
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', csp);
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

/**
 * JSON body parsing with a limit that depends on who is asking.
 *
 * Every request used to be allowed 200 MB. Uploads really are that big (a map,
 * a backup restore), but nobody else needs more than a few KB, and an anonymous
 * 200 MB body is a free way to exhaust the server's memory. So:
 *
 *   big   a request carrying a live session token, or a path on `bigPaths`
 *         (the few upload routes that have no login today: stories, chat image)
 *   small everything else
 *
 * Routes that already set their own, smaller express.json limit keep it: once
 * this parser has run the body is marked parsed and theirs does nothing.
 */
export function jsonBody({ smallLimit = '1mb', bigLimit = '200mb', bigPaths = [], hasSession = () => false } = {}) {
  const small = express.json({ limit: smallLimit });
  const big   = express.json({ limit: bigLimit });
  return (req, res, next) => {
    const useBig = bigPaths.some(re => re.test(req.path)) || hasSession(req);
    return (useBig ? big : small)(req, res, next);
  };
}

/** JSON errors for body-parser failures, instead of express's HTML page. */
export function bodyErrors() {
  return (err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That request is too large.', code: 'TOO_LARGE' });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
    return next(err);
  };
}

/**
 * Refuses an API request whose credential header holds something that is not a
 * live session for this campaign: an expired or revoked token, a token from
 * another campaign, or — the case every open tab hits once after this release —
 * a plain password left in sessionStorage. The client's fetch interceptor
 * (js/lib/realtime.js) turns the code into a trip to the login page.
 *
 * Requests with no credential header pass untouched: plenty of endpoints are
 * public, and their routes decide for themselves.
 */
export function sessionGate({ auth, exempt = [] }) {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/') || exempt.some(re => re.test(req.path))) return next();
    if (!credentialHeader(req, 'x-master-password') && !credentialHeader(req, 'x-character-password')) return next();
    if (auth.credentialsValid(req)) return next();
    return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'SESSION_EXPIRED' });
  };
}
