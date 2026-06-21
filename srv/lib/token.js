'use strict';

const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('crypto');

/**
 * QR-token helpers.
 *
 * Two formats, both signed and both verified the same way (HMAC over the part left
 * of the dot — so the signature covers the whole payload and cannot be forged):
 *
 *   structured : dpp~<gtin>~<sku>~<batch_number>~<serial>~<yyyymmdd>~<nonce>.<sig>
 *   legacy     : <uuid-v4>.<sig>
 *
 * The structured token carries the product / variant / batch / item / creation-date
 * the passport refers to (readable business codes), plus a random nonce so it stays
 * globally unique (and a fresh one is minted on regeneration). The HMAC prefix lets
 * the public endpoint reject random guesses cheaply and makes tokens unforgeable, so
 * the visible structure cannot be abused to enumerate other items. Resolution is still
 * an exact match on the stored `DPPs.qr_token` — the embedded fields are informational.
 *
 * The secret comes from QR_TOKEN_HMAC_SECRET — see .env.example.
 */
// Dev/test fallback so a fresh clone (no local .env) works out of the box; a real
// secret is still mandatory in production.
const DEV_QR_SECRET = 'dpp-dev-qr-hmac-secret-do-not-use-in-production';

// Marks a structured token and gives it a friendly, human-recognisable scheme tag.
const STRUCTURED_PREFIX = 'dpp';
const SEG_MAX = 32; // bound each segment so the token stays within DPPs.qr_token

function getSecret() {
  const s = process.env.QR_TOKEN_HMAC_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== 'production') return DEV_QR_SECRET;
  throw new Error('QR_TOKEN_HMAC_SECRET must be set to at least 16 characters');
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** HMAC-SHA256 of any payload string, base64url-encoded. */
function sign(payload, secret = getSecret()) {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

/** URL-safe, delimiter-free ('~') and separator-free ('.') segment; bounded length. */
function seg(v) {
  if (v == null) return '';
  return String(v)
    .replace(/[^A-Za-z0-9-]+/g, '-') // spaces, dots, slashes, '~', … → '-'
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SEG_MAX);
}

/** ISO date/timestamp → 'YYYYMMDD' (or '' if not a valid date). */
function yyyymmdd(v) {
  const s = String(v || '').slice(0, 10).replace(/-/g, '');
  return /^\d{8}$/.test(s) ? s : '';
}

function hasContext(ctx) {
  return !!ctx && [ctx.gtin, ctx.sku, ctx.batch_number, ctx.serial, ctx.date].some(Boolean);
}

function buildPayload(ctx) {
  return [
    STRUCTURED_PREFIX,
    seg(ctx.gtin),
    seg(ctx.sku),
    seg(ctx.batch_number),
    seg(ctx.serial),
    yyyymmdd(ctx.date),
    base64url(randomBytes(6)) // nonce → uniqueness + unpredictability
  ].join('~');
}

/**
 * Mint a signed QR token. With business context → a readable, structured token;
 * without → a random legacy token (used by item-less contexts and tests).
 * @param {{ gtin?, sku?, batch_number?, serial?, date? }} [ctx]
 */
function generate(ctx) {
  const payload = hasContext(ctx) ? buildPayload(ctx) : randomUUID();
  return `${payload}.${sign(payload)}`;
}

/** Verify the signature. Returns the signed payload (truthy) or null. Both formats. */
function verify(token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  // timingSafeEqual requires equal-length Buffers.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? payload : null;
}

/** Decode the structured fields from a token (null for legacy/invalid). Informational only. */
function decode(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const payload = token.slice(0, token.lastIndexOf('.'));
  const p = payload.split('~');
  if (p[0] !== STRUCTURED_PREFIX) return null;
  return {
    gtin: p[1] || null,
    sku: p[2] || null,
    batch_number: p[3] || null,
    serial: p[4] || null,
    date: p[5] || null,
    nonce: p[6] || null
  };
}

module.exports = { generate, verify, sign, decode, signUuid: sign };
