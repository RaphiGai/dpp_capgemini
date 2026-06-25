'use strict';

/**
 * Outbound email via nodemailer.
 *
 * - Production / BTP: real SMTP when MAIL_HOST is configured (host/port/secure/auth
 *   from MAIL_* env vars — set them on BTP via env or a user-provided service).
 * - Local dev: no SMTP configured → a `jsonTransport` that does not actually send, plus
 *   the message link is logged to the server console so the flow is testable without a
 *   mailbox.
 * - Tests (NODE_ENV=test): no-op.
 */

let _transport;

function smtpConfigured() {
  return !!process.env.MAIL_HOST;
}

function getTransport() {
  if (_transport) return _transport;
  const nodemailer = require('nodemailer');
  if (smtpConfigured()) {
    _transport = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587', 10),
      secure: String(process.env.MAIL_SECURE || '').toLowerCase() === 'true',
      auth: process.env.MAIL_USER
        ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD }
        : undefined,
    });
  } else {
    // Dev fallback — serialises the mail instead of sending it.
    _transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return _transport;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Send the self-service password-reset email containing the time-limited reset link.
 * @param {string} to            recipient (the account's registered email)
 * @param {{ link: string, displayName?: string }} opts
 */
async function sendPasswordResetEmail(to, { link, displayName }) {
  if (process.env.NODE_ENV === 'test') return; // tests never send

  const from = process.env.MAIL_FROM || 'no-reply@dpp-studio.example';
  const name = displayName || 'there';
  const subject = 'Reset your DPP Studio password';
  const text = [
    `Hi ${name},`,
    '',
    'We received a request to reset your DPP Studio password.',
    'Open the link below to choose a new password. The link expires in 1 hour.',
    '',
    link,
    '',
    'If you did not request this, you can safely ignore this email — your password stays unchanged.',
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>We received a request to reset your DPP Studio password. Use the link below to choose a new password. It expires in 1 hour.</p>
<p><a href="${escapeHtml(link)}">Reset my password</a></p>
<p style="color:#666;font-size:12px">If you did not request this, you can safely ignore this email — your password stays unchanged.</p>`;

  try {
    await getTransport().sendMail({ from, to, subject, text, html });
  } catch (err) {
    console.error('[email] password-reset send failed:', err && err.message);
  }
  // Dev visibility: without SMTP the mail is not delivered, so surface the link.
  if (!smtpConfigured()) {
    console.log(`[email][dev] password reset link for ${to}: ${link}`);
  }
}

module.exports = { sendPasswordResetEmail };
