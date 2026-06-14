'use strict';

const { createHmac, timingSafeEqual } = require('crypto');

/**
 * Stateless session tokens for the app-managed authentication.
 *
 *   token = base64url(JSON payload) . base64url(hmac-sha256(secret, body))
 *
 * Signed with SESSION_SECRET (from the bound `dpp-secrets` service via
 * srv/lib/secrets.js). No external JWT dependency — same HMAC approach as
 * srv/lib/token.js. The cookie carrying this token is HttpOnly/Secure/SameSite.
 *
 * Two scopes:
 *   - 'full'    : authenticated app session (default TTL 8h)
 *   - 'pwreset' : short-lived (15min); ONLY authorizes the change-password step,
 *                 never app access — enforced by srv/auth/session-auth.js.
 */

const FULL_TTL_SECONDS = 8 * 60 * 60;
const PWRESET_TTL_SECONDS = 15 * 60;

// Dev/test fallback so a fresh clone (no local .env, which is gitignored) can log
// in out of the box. In production a real SESSION_SECRET is still mandatory.
const DEV_SESSION_SECRET = 'dpp-dev-session-secret-do-not-use-in-production';

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== 'production') return DEV_SESSION_SECRET;
  throw new Error('SESSION_SECRET must be set to at least 16 characters');
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signBody(body, secret = getSecret()) {
  return base64url(createHmac('sha256', secret).update(body).digest());
}

/**
 * @param {object} claims    e.g. { uid, sub, role, tenant }
 * @param {object} [opts]    { scope = 'full', ttlSeconds, now }
 */
function sign(claims, opts = {}) {
  const scope = opts.scope || 'full';
  const ttl = opts.ttlSeconds || (scope === 'pwreset' ? PWRESET_TTL_SECONDS : FULL_TTL_SECONDS);
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const payload = { ...claims, scope, iat, exp: iat + ttl };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${signBody(body)}`;
}

/**
 * Returns the payload object if the token is well-formed, correctly signed and
 * not expired; otherwise null. Never throws on malformed input.
 */
function verify(token, opts = {}) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected;
  try {
    expected = signBody(body);
  } catch {
    return null; // secret missing
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

module.exports = { sign, verify, FULL_TTL_SECONDS, PWRESET_TTL_SECONDS };
