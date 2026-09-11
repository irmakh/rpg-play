/**
 * Logging in.
 *
 * Every form that takes a password ends up here, and every one of them:
 *   1. refuses while this IP is locked out for this account (lib/login-guard.js)
 *   2. requires a solved maths captcha — single-use, so each guess costs a sum
 *   3. checks the password with async scrypt (never blocking other players)
 *   4. on success returns a SESSION TOKEN (lib/sessions.js)
 *
 * The browser keeps that token where it used to keep the password, and every
 * other endpoint accepts only tokens. So these routes are the only place a
 * password is ever tested.
 *
 * Every outcome is written to the login audit (campaigns.db auth_events), and
 * the DM is told when one account collects five wrong passwords in 15 minutes.
 */
import { clientIp } from '../../lib/login-guard.js';
import { credentialHeader } from '../../lib/auth.js';

const CAPTCHA_MESSAGES = {
  CAPTCHA_REQUIRED: 'Solve the maths problem to continue.',
  CAPTCHA_EXPIRED:  'That maths problem expired. Try the new one.',
  CAPTCHA_WRONG:    'Wrong answer to the maths problem. Try the new one.',
};

function waitText(sec) {
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'}`;
  const m = Math.ceil(sec / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

export default function register(app, ctx) {
  const {
    getCharacter, ldb, captcha, loginGuard, sessions, setupTickets, audit,
    checkDmPassword, verifyPasswordAsync, isSuperAdminPassword, superAdminEnabled,
    currentCampaignId, TRUST_PROXY,
  } = ctx;

  const ipOf = req => clientIp(req, TRUST_PROXY);
  const uaOf = req => String(req.headers['user-agent'] || '');
  // Outside a campaign (admin login with no campaign picked) there is none.
  const campaignNow = () => { try { return currentCampaignId() || ''; } catch { return ''; } };

  function record(req, ev) {
    try { audit?.record({ ip: ipOf(req), userAgent: uaOf(req), campaignId: campaignNow(), ...ev }); } catch {}
  }

  function refuseLocked(res, retryAfterSec) {
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `Too many attempts. Try again in ${waitText(retryAfterSec)}.`,
      code: 'LOCKED', retryAfter: retryAfterSec,
    });
  }

  /**
   * Records a failed attempt and says whether the caller is now locked out.
   * `alertWho` marks a WRONG PASSWORD (not a wrong sum) and names the account
   * for the DM's alert.
   */
  function failed(req, account, ev) {
    const { alertWho, ...rest } = ev;
    const r = loginGuard.fail(ipOf(req), account, { alertable: !!alertWho });
    record(req, rest);
    if (r.justLocked) record(req, { ...rest, kind: 'locked' });
    if (r.alert && typeof ctx.notify === 'function') {
      ctx.notify({
        to: 'dm', kind: 'security', priority: 'alert',
        title: 'Repeated failed logins',
        body: `Someone entered the wrong password for ${alertWho} 5 times in 15 minutes.`,
      });
    }
    return r;
  }

  /** True when it has already answered: wrong, expired or missing captcha. */
  function captchaRefused(req, res, account, ev) {
    const { captchaId, captchaAnswer } = req.body || {};
    const cap = captcha.verify(captchaId, captchaAnswer);
    if (cap.ok) return false;
    // No captcha at all is a malformed request (a stale page), not a guess.
    if (cap.code !== 'CAPTCHA_REQUIRED') {
      const r = failed(req, account, { ...ev, kind: 'captcha-fail' });
      if (r.locked) { refuseLocked(res, r.retryAfterSec); return true; }
    }
    res.status(400).json({ error: CAPTCHA_MESSAGES[cap.code], code: cap.code });
    return true;
  }

  function startSession(req, { role, campaignId, charId = '', charName = '' }) {
    return sessions.create({ campaignId, role, charId, charName, ip: ipOf(req), userAgent: uaOf(req) });
  }

  // ── Captcha ─────────────────────────────────────────────────────────────────
  app.get('/api/auth/captcha', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const c = await captcha.issue(ipOf(req));
      if (c.error) {
        res.setHeader('Retry-After', String(c.retryAfterSec));
        return res.status(429).json({
          error: `Too many new problems requested. Try again in ${waitText(c.retryAfterSec)}.`,
          code: 'CAPTCHA_RATE', retryAfter: c.retryAfterSec,
        });
      }
      res.json(c);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── DM or character login ───────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { type, characterId, password } = req.body || {};
      if (type !== 'dm' && type !== 'character') return res.status(400).json({ error: 'Invalid login type' });
      if (type === 'character' && !characterId) return res.status(400).json({ error: 'characterId required' });

      const campaignId = campaignNow();
      const ip = ipOf(req);
      const account = type === 'dm' ? `dm:${campaignId}` : `char:${campaignId}:${characterId}`;
      const ev = { role: type, charId: type === 'character' ? String(characterId) : '' };

      const lock = loginGuard.check(ip, account);
      if (lock.locked) return refuseLocked(res, lock.retryAfterSec);
      if (captchaRefused(req, res, account, ev)) return;

      if (type === 'dm') {
        if (!password || !(await checkDmPassword(password, campaignId))) {
          const r = failed(req, account, { ...ev, kind: 'login-fail', alertWho: 'the DM' });
          if (r.locked) return refuseLocked(res, r.retryAfterSec);
          return res.status(401).json({ error: 'Wrong password' });
        }
        loginGuard.succeed(ip, account);
        const s = startSession(req, { role: 'dm', campaignId });
        record(req, { ...ev, kind: 'login' });
        return res.json({ ok: true, role: 'dm', token: s.token, expiresAt: s.expiresAt });
      }

      const char = await getCharacter(characterId);
      if (!char) return res.status(404).json({ error: 'Character not found' });
      ev.charName = char.name || '';

      // The DM password unlocks any character, even one with no password yet.
      const viaDm = !!password && await checkDmPassword(password, campaignId);
      if (!viaDm) {
        if (!char.passwordHash) {
          // Unclaimed: the player chooses a password next. The ticket carries
          // this solved captcha over to that request (see createSetupTickets).
          const setupTicket = setupTickets.issue(campaignId, char.id);
          record(req, { ...ev, kind: 'setup-started' });
          return res.json({ needsSetup: true, characterId: char.id, characterName: char.name, setupTicket });
        }
        if (!password || !(await verifyPasswordAsync(password, char.passwordHash))) {
          const r = failed(req, account, { ...ev, kind: 'login-fail', alertWho: char.name || 'a character' });
          if (r.locked) return refuseLocked(res, r.retryAfterSec);
          return res.status(401).json({ error: 'Wrong password' });
        }
      }
      loginGuard.succeed(ip, account);
      const s = startSession(req, { role: 'character', campaignId, charId: char.id, charName: char.name || '' });
      record(req, { ...ev, kind: viaDm ? 'login-as-dm' : 'login' });
      return res.json({
        ok: true, role: 'character', characterId: char.id, characterName: char.name,
        token: s.token, expiresAt: s.expiresAt,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Super-admin login ───────────────────────────────────────────────────────
  // Works with no campaign selected: the maintenance page and creating or
  // deleting a campaign are server-wide.
  app.post('/api/auth/admin-login', async (req, res) => {
    try {
      if (!superAdminEnabled) {
        return res.status(503).json({
          error: 'The admin password is not configured on this server (MASTER_PASSWORD).',
          code: 'ADMIN_DISABLED',
        });
      }
      const { password } = req.body || {};
      const ip = ipOf(req);
      const account = 'admin';
      const ev = { role: 'admin' };

      const lock = loginGuard.check(ip, account);
      if (lock.locked) return refuseLocked(res, lock.retryAfterSec);
      if (captchaRefused(req, res, account, ev)) return;

      if (!isSuperAdminPassword(password)) {
        const r = failed(req, account, { ...ev, kind: 'login-fail' });
        if (r.locked) return refuseLocked(res, r.retryAfterSec);
        return res.status(401).json({ error: 'Wrong admin password' });
      }
      loginGuard.succeed(ip, account);
      const s = startSession(req, { role: 'admin', campaignId: '' });
      record(req, { ...ev, kind: 'login', campaignId: '' });
      res.json({ ok: true, role: 'admin', token: s.token, expiresAt: s.expiresAt });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Logout ──────────────────────────────────────────────────────────────────
  // Ends the session on the server, so a copied token stops working too.
  app.post('/api/auth/logout', (req, res) => {
    try {
      const token = String(req.body?.token || '')
        || credentialHeader(req, 'x-master-password') || credentialHeader(req, 'x-character-password');
      const s = sessions.resolve(token);
      if (s) {
        sessions.revoke(token);
        record(req, { kind: 'logout', role: s.role, charId: s.charId, charName: s.charName, campaignId: s.campaignId });
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });

  // ── Stories gate ────────────────────────────────────────────────────────────
  // Accepts the DM password or any character's. Same captcha and lockout as a
  // login; checks stop at the first match and never block the event loop.
  app.post('/api/auth/verify-any', async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: 'password required' });
      const campaignId = campaignNow();
      const ip = ipOf(req);
      const account = `stories:${campaignId}`;
      const ev = { role: 'stories' };

      const lock = loginGuard.check(ip, account);
      if (lock.locked) return refuseLocked(res, lock.retryAfterSec);
      if (captchaRefused(req, res, account, ev)) return;

      let ok = await checkDmPassword(password, campaignId);
      if (!ok) {
        for (const c of ldb.listCharacters()) {
          if (c.passwordHash && await verifyPasswordAsync(password, c.passwordHash)) { ok = true; break; }
        }
      }
      if (!ok) {
        const r = failed(req, account, { ...ev, kind: 'login-fail', alertWho: 'the Stories page' });
        if (r.locked) return refuseLocked(res, r.retryAfterSec);
        return res.status(401).json({ error: 'Wrong password' });
      }
      loginGuard.succeed(ip, account);
      record(req, { ...ev, kind: 'login' });
      return res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
  });
}
