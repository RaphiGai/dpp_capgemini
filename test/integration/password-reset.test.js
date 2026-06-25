'use strict';

// Self-service password reset via emailed link: request (username+email → token),
// then consume (token + new password). Token is single-use and time-limited.

const cds = require('@sap/cds');
const credentials = require('../../srv/lib/credentials');

const { POST, axios } = cds.test().in(__dirname + '/../..');

const alice = { auth: { username: 'alice.advanced', password: 'x' } }; // ORG-A advanced

// Raw POST that never throws on non-2xx, so we can assert on the status directly.
const post = (url, body) => axios.post(url, body, { validateStatus: () => true });

async function makeUser(suffix) {
  const r = await POST(
    '/odata/v4/dpp/createUser',
    {
      username: `reset.${suffix}`,
      email: `reset.${suffix}@greenline.test`,
      displayName: `Reset ${suffix}`,
      role: 'company_user'
    },
    alice
  );
  return r.data; // { userId, username, email, tempPassword }
}

describe('Self-service password reset', () => {
  test('request with matching username + email issues a reset token', async () => {
    const u = await makeUser('a');
    const r = await post('/auth/request-password-reset', { username: u.username, email: u.email });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);

    const { Users } = cds.entities('dpp');
    const row = await SELECT.one.from(Users).columns('reset_token_hash', 'reset_token_expires').where({ ID: u.userId });
    expect(row.reset_token_hash).toBeTruthy();
    expect(row.reset_token_expires).toBeTruthy();
  });

  test('request with a wrong email returns a concrete error (400)', async () => {
    const u = await makeUser('b');
    const r = await post('/auth/request-password-reset', { username: u.username, email: 'wrong@greenline.test' });
    expect(r.status).toBe(400);
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toMatch(/do not match/i);
  });

  test('a valid token sets a new password; user can log in; token is single-use', async () => {
    const u = await makeUser('c');
    const token = await credentials.createPasswordResetToken(u.userId);
    const newPassword = 'NewPassw0rd';

    const r1 = await post('/auth/reset-password', { token, newPassword });
    expect(r1.status).toBe(200);
    expect(r1.data.ok).toBe(true);

    // The new password works and there is no forced follow-up reset.
    const login = await post('/auth/login', { username: u.username, password: newPassword });
    expect(login.status).toBe(200);
    expect(login.data).toMatchObject({ ok: true, mustReset: false });

    // The original temp password no longer works.
    const oldLogin = await post('/auth/login', { username: u.username, password: u.tempPassword });
    expect(oldLogin.status).toBe(401);

    // The token cannot be reused.
    const r2 = await post('/auth/reset-password', { token, newPassword: 'AnotherPass1' });
    expect(r2.status).toBe(400);
  });

  test('a weak new password is rejected', async () => {
    const u = await makeUser('d');
    const token = await credentials.createPasswordResetToken(u.userId);
    const r = await post('/auth/reset-password', { token, newPassword: 'short' });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/at least|letter|digit/i);
  });

  test('an expired token is rejected', async () => {
    const u = await makeUser('e');
    const token = await credentials.createPasswordResetToken(u.userId);
    const { Users } = cds.entities('dpp');
    await UPDATE(Users).set({ reset_token_expires: new Date(Date.now() - 1000).toISOString() }).where({ ID: u.userId });

    const r = await post('/auth/reset-password', { token, newPassword: 'NewPassw0rd' });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/invalid or has expired/i);
  });
});
