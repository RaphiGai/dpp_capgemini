'use strict';

/**
 * Loads runtime secrets from a bound Cloud Foundry user-provided service
 * (default name: `dpp-secrets`) into `process.env`.
 *
 * Rationale: keeping `QR_TOKEN_HMAC_SECRET` and `PUBLIC_BASE_URL` out of
 * `mta.yaml` means they are not committed to git and can be rotated via
 * `cf uups dpp-secrets -p '{...}'` without redeploying the app.
 *
 * Precedence: existing `process.env` values win, so local `.env` files and
 * CI variables stay authoritative for dev/test. VCAP-provided values are
 * only used to fill in gaps in production.
 */

const SERVICE_NAME = process.env.SECRETS_SERVICE_NAME || 'dpp-secrets';
const KNOWN_KEYS = [
  'QR_TOKEN_HMAC_SECRET', 'PUBLIC_BASE_URL', 'SESSION_SECRET',
  // Outbound email (self-service password reset) — projected from dpp-secrets on BTP.
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM',
  'PASSWORD_RESET_TTL_MIN',
];

function findUserProvided(vcap, name) {
  const entries = vcap['user-provided'];
  if (!Array.isArray(entries)) return null;
  return entries.find((e) => e.name === name || e.instance_name === name) || null;
}

function load() {
  const raw = process.env.VCAP_SERVICES;
  if (!raw) return { applied: [], skipped: KNOWN_KEYS };

  let vcap;
  try {
    vcap = JSON.parse(raw);
  } catch (err) {
    console.warn(`[secrets] VCAP_SERVICES is not valid JSON — ${err.message}`);
    return { applied: [], skipped: KNOWN_KEYS };
  }

  const binding = findUserProvided(vcap, SERVICE_NAME);
  if (!binding || !binding.credentials) {
    console.warn(`[secrets] user-provided service '${SERVICE_NAME}' not bound — relying on process.env`);
    return { applied: [], skipped: KNOWN_KEYS };
  }

  const applied = [];
  const skipped = [];
  for (const key of KNOWN_KEYS) {
    const value = binding.credentials[key];
    if (typeof value !== 'string' || !value) {
      skipped.push(key);
      continue;
    }
    if (process.env[key]) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    applied.push(key);
  }
  if (applied.length) {
    console.log(`[secrets] loaded ${applied.join(', ')} from '${SERVICE_NAME}'`);
  }
  return { applied, skipped };
}

module.exports = { load, SERVICE_NAME, KNOWN_KEYS };
