'use strict';

const { randomUUID, createHmac, timingSafeEqual } = require('crypto');

/**
 * QR-token helpers.
 *
 *   token = <uuid-v4>.<base64url(hmac-sha256(secret, uuid-v4))>
 *
 * The HMAC prefix lets the public endpoint reject random guesses cheaply, so
 * customers can keep using tokens in printed QR codes even if their DB IDs
 * leak. The secret comes from QR_TOKEN_HMAC_SECRET — see .env.example.
 */
function getSecret() {
  const s = process.env.QR_TOKEN_HMAC_SECRET;
  if (!s || s.length < 16) {
    throw new Error('QR_TOKEN_HMAC_SECRET must be set to at least 16 characters');
  }
  return s;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signUuid(uuid, secret = getSecret()) {
  return base64url(createHmac('sha256', secret).update(uuid).digest());
}

function generate() {
  const uuid = randomUUID();
  return `${uuid}.${signUuid(uuid)}`;
}

function verify(token) {
  if (typeof token !== 'string' || token.length < 36) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const uuid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signUuid(uuid);
  if (sig.length !== expected.length) return null;
  // timingSafeEqual requires equal-length Buffers
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? uuid : null;
}

module.exports = { generate, verify, signUuid };
