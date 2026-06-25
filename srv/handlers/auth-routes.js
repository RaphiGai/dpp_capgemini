'use strict';

const express = require('express');
const session = require('../lib/session');
const credentials = require('../lib/credentials');
const email = require('../lib/email');

/**
 * App-managed login endpoints (US1.1 / US1.2 / US1.3), mounted on the Express
 * app from srv/server.js `cds.on('bootstrap')` — i.e. OUTSIDE the per-service
 * auth gate, like /public/* and /healthz. They issue/clear the signed
 * `dpp_session` cookie that srv/auth/session-auth.js consumes.
 *
 *   GET  /login                 → login mask (or change-password mask on ?reset=1)
 *   POST /auth/login            → verify credentials → session cookie (or pwreset)
 *   POST /auth/change-password  → forced first-login change / voluntary change
 *   POST /auth/logout           → clear cookie, back to /login
 */

const COOKIE_NAME = 'dpp_session';
const POST_LOGIN_REDIRECT = process.env.POST_LOGIN_REDIRECT || '/';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/' });
}

function fullSessionToken(user) {
  return session.sign(
    {
      uid: user.ID,
      sub: user.external_user_id || user.username,
      email: user.email,
      role: user.role,
      tenant: user.tenant,
    },
    { scope: 'full' }
  );
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function page(title, bodyInner) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f4f5f7;margin:0;
       display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;padding:2rem 2.25rem;border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.08);width:320px}
  h1{font-size:1.15rem;margin:0 0 1.25rem}
  label{display:block;font-size:.8rem;color:#444;margin:.75rem 0 .25rem}
  input{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:6px;font-size:.95rem}
  button{margin-top:1.25rem;width:100%;padding:.6rem;border:0;border-radius:6px;background:#0a6ed1;color:#fff;
         font-size:.95rem;cursor:pointer}
  .err{background:#ffe9e9;color:#a30000;padding:.5rem .65rem;border-radius:6px;font-size:.85rem;margin-bottom:.5rem}
  .hint{color:#666;font-size:.75rem;margin-top:1rem}
</style></head><body><div class="card">${bodyInner}</div></body></html>`;
}

function renderLogin({ error } = {}) {
  return page('Sign in — DPP', `
    <h1>Sign in</h1>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="post" action="/auth/login">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" autofocus required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>`);
}

function renderReset({ error } = {}) {
  return page('Change password — DPP', `
    <h1>Change password</h1>
    <div class="hint">Please set a new password to complete sign-in.</div>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="post" action="/auth/change-password">
      <label for="currentPassword">Current (temporary) password</label>
      <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
      <label for="newPassword">New password</label>
      <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required>
      <button type="submit">Set password</button>
      <div class="hint">At least 10 characters, including a letter and a digit.</div>
    </form>`);
}

/** The SPA fetches with Accept: application/json → JSON responses; browsers posting
 *  the server-rendered form get 302 redirects + HTML. */
function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json');
}

function register(app) {
  // Accept both the SPA's JSON bodies and the server-rendered form's urlencoded bodies.
  const parse = [express.json(), express.urlencoded({ extended: false })];

  app.get('/login', (req, res) => {
    res.type('html').send(req.query.reset ? renderReset({}) : renderLogin({}));
  });

  app.post('/auth/login', parse, async (req, res) => {
    const { username, password } = req.body || {};
    let result;
    try {
      result = await credentials.verifyLogin(String(username || ''), String(password || ''));
    } catch (e) {
      console.error('[auth] login error:', e.message);
      if (wantsJson(req)) return res.status(500).json({ ok: false, error: 'Sign-in is currently unavailable. Please try again later.' });
      return res.status(500).type('html').send(renderLogin({ error: 'Sign-in is currently unavailable. Please try again later.' }));
    }
    if (!result.ok) {
      const msg = result.locked
        ? 'Your account is temporarily locked. Please try again later.'
        : 'Invalid username or password.';
      if (wantsJson(req)) return res.status(401).json({ ok: false, error: msg });
      return res.status(401).type('html').send(renderLogin({ error: msg }));
    }

    if (result.user.mustReset) {
      const token = session.sign({ uid: result.user.ID, sub: result.user.username }, { scope: 'pwreset' });
      setSessionCookie(res, token, session.PWRESET_TTL_SECONDS);
      if (wantsJson(req)) return res.json({ ok: true, mustReset: true });
      return res.redirect(302, '/login?reset=1');
    }

    setSessionCookie(res, fullSessionToken(result.user), session.FULL_TTL_SECONDS);
    if (wantsJson(req)) return res.json({ ok: true, mustReset: false });
    return res.redirect(302, POST_LOGIN_REDIRECT);
  });

  app.post('/auth/change-password', parse, async (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    const payload = token ? session.verify(token) : null;
    if (!payload || !payload.uid) {
      if (wantsJson(req)) return res.status(401).json({ ok: false, error: 'Your session has expired. Please sign in again.' });
      return res.status(401).type('html').send(renderLogin({ error: 'Your session has expired. Please sign in again.' }));
    }

    const { currentPassword, newPassword } = req.body || {};
    try {
      await credentials.changePassword(payload.uid, String(currentPassword || ''), String(newPassword || ''));
    } catch (e) {
      if (wantsJson(req)) return res.status(e.status || 400).json({ ok: false, error: e.message });
      return res.status(e.status || 400).type('html').send(renderReset({ error: e.message }));
    }

    // Issue a full session now that the password is set.
    const user = await credentials.sessionUser(payload.uid);
    setSessionCookie(res, fullSessionToken(user), session.FULL_TTL_SECONDS);
    if (wantsJson(req)) return res.json({ ok: true });
    return res.redirect(302, POST_LOGIN_REDIRECT);
  });

  app.post('/auth/logout', parse, (req, res) => {
    clearSessionCookie(res);
    if (wantsJson(req)) return res.json({ ok: true });
    return res.redirect(302, '/login');
  });

  // ----- Self-service password reset (US: email reset link) -----
  // Step 1: the user submits username + email. If both match an active account, we mint a
  // single-use, time-limited token and email a reset link. The password is NOT changed yet.
  // (Per product decision, a non-match returns a concrete error rather than a generic one.)
  app.post('/auth/request-password-reset', parse, async (req, res) => {
    const { username, email: emailAddr } = req.body || {};
    let user;
    try {
      user = await credentials.findActiveByUsernameAndEmail(String(username || ''), String(emailAddr || ''));
    } catch (e) {
      console.error('[auth] reset request error:', e.message);
      return res.status(500).json({ ok: false, error: 'Password reset is currently unavailable. Please try again later.' });
    }
    if (!user) {
      return res.status(400).json({ ok: false, error: 'Username and email do not match an account.' });
    }
    try {
      const token = await credentials.createPasswordResetToken(user.ID);
      const base = process.env.PUBLIC_BASE_URL || '';
      const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      await email.sendPasswordResetEmail(user.email, { link, displayName: user.display_name });
    } catch (e) {
      console.error('[auth] reset request error:', e.message);
      return res.status(500).json({ ok: false, error: 'Password reset is currently unavailable. Please try again later.' });
    }
    return res.json({ ok: true });
  });

  // Step 2: the user opens the emailed link and sets a new password. The token is consumed
  // (single-use); on success the user can sign in normally.
  app.post('/auth/reset-password', parse, async (req, res) => {
    const { token, newPassword } = req.body || {};
    try {
      await credentials.consumePasswordResetToken(String(token || ''), String(newPassword || ''));
    } catch (e) {
      return res.status(e.status || 400).json({ ok: false, error: e.message });
    }
    return res.json({ ok: true });
  });
}

module.exports = { register };
